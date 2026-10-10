import { readFileSync } from "node:fs";
import { beforeAll, expect, it } from "vitest";
import abcjs, { type VoiceItemNote } from "abcjs";
import type { ArrangementRenderDocument } from "../domain/generation/model";
import { fraction } from "../domain/fraction";
import { musicalRange } from "../domain/time";
import { generateQuickHarmony, prepareQuickHarmony } from "./quick-harmony";
import { materializeActiveArrangement } from "./render";
import { arrangementRenderDocumentToAbc } from "./score-adapter";
import { buildPlaybackPlan } from "./playback-plan";
import { exportHarmonyProject } from "./project-transfer";
import { materializePracticeShare } from "./practice-share";
import { materializeSharedPractice } from "./shared-practice";
import { decodeProductUrlShare, encodeProductUrlShare } from "./share-url";

async function fixture() {
  let index=0;
  const xml=readFileSync(new URL("./fixtures/wag11/4-4-1.musicxml",import.meta.url),"utf8")
    .replaceAll("</note>",()=>{
      index++;
      // Deliberately reverse the source verse order.
      return `<lyric number="2"><syllabic>single</syllabic><text>둘${index}</text></lyric><lyric number="1"><syllabic>single</syllabic><text>하나${index}</text></lyric></note>`;
    });
  const preparation=await prepareQuickHarmony({bytes:new TextEncoder().encode(xml),fileName:"lyrics.musicxml"});
  const result=await generateQuickHarmony(preparation,{parts:["alto","tenor"],rightsConfirmed:true,confirmedAt:"2026-10-10T00:00:00.000Z"});
  if(result.status!=="complete"&&result.status!=="partial")throw new Error(result.status);
  const project=result.project;
  const materialized=materializeActiveArrangement(project,"standard");
  const notation={title:project.source.title,tempo:project.source.defaultTempo,key:project.source.defaultKey};
  const payload=materializePracticeShare({project,presetId:"standard",materialized,workspaceShareConfirmedForThisExport:true});
  return {project,materialized,notation,payload};
}
let data:Awaited<ReturnType<typeof fixture>>;
beforeAll(async()=>{data=await fixture();});
const lyricLines=(abc:string)=>abc.split("\n").filter(line=>line.startsWith("w:"));
const withoutLyrics=(abc:string)=>abc.split("\n").filter(line=>!line.startsWith("w:")).join("\n");
function serialize(document:ArrangementRenderDocument) {
  return arrangementRenderDocumentToAbc(document,data.materialized.trackRoles,data.notation);
}
type LyricNote = VoiceItemNote & { lyric?: { syllable: string }[] };
function notes(abc:string): LyricNote[] {
  return abcjs.parseOnly(abc)[0].lines.flatMap(line=>line.staff?.flatMap(staff=>staff.voices?.flatMap(voice=>voice.filter(e=>e.el_type==="note")) ?? []) ?? []);
}
function melodyWords(abc:string) {
  return abcjs.parseOnly(abc)[0].lines.flatMap(line=>line.staff?.[0]?.voices?.[0]?.filter(e=>e.el_type==="note").map(e=>(e as LyricNote).lyric?.map(t=>t.syllable) ?? []) ?? []);
}

it("displays all imported verses in order only below melody without changing project, notes or playback",async()=>{
  const {document}=data.materialized;
  const before=await exportHarmonyProject(data.project);
  const documentBytes=JSON.stringify(document);
  const plan=buildPlaybackPlan(document,data.materialized.trackRoles);
  const abc=serialize(document);
  expect(lyricLines(abc)).toEqual([
    "w: 하나1 하나2 하나3 하나4 | 하나5 하나6 하나7 하나8 | 하나9 하나10 하나11 하나12 | 하나13 하나14 하나15 하나16 |",
    "w: 둘1 둘2 둘3 둘4 | 둘5 둘6 둘7 둘8 | 둘9 둘10 둘11 둘12 | 둘13 둘14 둘15 둘16 |",
  ]);
  expect(abc.indexOf("w:")).toBeGreaterThan(abc.indexOf("[V:lead]"));
  expect(abc.lastIndexOf("w:")).toBeLessThan(abc.indexOf("[V:h1]"));
  expect(melodyWords(abc)).toEqual(Array.from({length:16},(_,i)=>[`하나${i+1}`,`둘${i+1}`]));
  expect(notes(abc).filter(e=>e.lyric?.length)).toHaveLength(16);
  expect(withoutLyrics(abc)).toBe(serialize({...document,lyricTokens:[]}));
  expect(JSON.stringify(document)).toBe(documentBytes);
  expect(buildPlaybackPlan(document,data.materialized.trackRoles)).toEqual(plan);
  expect(await exportHarmonyProject(data.project)).toBe(before);
  expect(serialize(document)).toBe(abc);
});

it("keeps every verse through a real share encode/decode and leaves sounding notes unchanged",()=>{
  const payload=decodeProductUrlShare(encodeProductUrlShare(data.payload));
  const shared=materializeSharedPractice(payload);
  const abc=arrangementRenderDocumentToAbc(shared.document,shared.trackRoles,data.notation);
  expect(lyricLines(abc)).toEqual(lyricLines(serialize(data.materialized.document)));
  expect(melodyWords(abc)).toEqual(melodyWords(serialize(data.materialized.document)));
  const sound=(document:ArrangementRenderDocument,roles:typeof shared.trackRoles)=>buildPlaybackPlan(document,roles).events.map(e=>({midi:e.midi,start:e.startQuarter,duration:e.durationQuarter})).sort((a,b)=>a.start-b.start||a.midi-b.midi);
  expect(sound(shared.document,shared.trackRoles)).toEqual(sound(data.materialized.document,data.materialized.trackRoles));
  expect(payload.schemaVersion).toBe(4);
});

it("does not invent locations for unlinked verses in older shared data",()=>{
  const payload=data.payload;
  if(payload.schemaVersion!==4)throw new Error("fixture version");
  const legacy={...payload,arrangement:{...payload.arrangement,tracks:payload.arrangement.tracks.map(track=>track.kind!=="source-lead"?track:{...track,events:track.events.map(event=>event.kind==="rest"?event:{...event,lyricTokenIds:event.lyricTokenIds?.filter(id=>data.payload.lyrics.find(t=>t.id===id)?.verse===1)})})}};
  const shared=materializeSharedPractice(decodeProductUrlShare(encodeProductUrlShare(legacy)));
  const abc=arrangementRenderDocumentToAbc(shared.document,shared.trackRoles,data.notation);
  expect(lyricLines(abc)).toEqual(lyricLines(serialize(data.materialized.document)).slice(0,1));
  expect(melodyWords(abc)).toEqual(Array.from({length:16},(_,i)=>[`하나${i+1}`]));
});

it("aligns syllables after rests, invisible gaps, ties and repeated occurrences",()=>{
  const base=data.materialized.document;
  const durations=base.measures.map(m=>m.duration);
  const range=(measure:number,start:number,end:number)=>musicalRange({performanceMeasureIndex:measure,offset:fraction(start)},{performanceMeasureIndex:measure,offset:fraction(end)},durations);
  const template=base.sourceLeadTrack.atoms[0];
  const atom=(id:string,measure:number,start:number,end:number,extra={})=>({...template,id,sourceEventId:id,range:range(measure,start,end),lyricTokenIds:[],tiedFromPrevious:false,tiedToNext:false,...extra});
  const atoms=[atom("a",0,0,1,{tiedToNext:true}),atom("a2",0,1,2,{sourceEventId:"a",tiedFromPrevious:true}),atom("r",0,2,3,{pitch:null}),atom("b",0,3,4),atom("c",1,1,2),atom("a-repeat",1,2,3,{sourceEventId:"a"})];
  const lyric=(id:string,text:string,syllabic:"single"|"begin"|"end"="single")=>({id:`ly:${id}`,leadEventId:id,verse:1,text,syllabic,extend:false,emphasis:"none" as const});
  const document={...base,sourceLeadTrack:{...base.sourceLeadTrack,atoms},lyricTokens:[lyric("a","할","begin"),lyric("b","렐","end"),lyric("c","루야")]};
  const abc=serialize(document);
  expect(lyricLines(abc)).toEqual(["w: 할- _ * 렐 | * 루야 할- * | * | * |"]);
  expect(melodyWords(abc).slice(0,8)).toEqual([["할"],[""],[""],["렐"],[""],["루야"],["할"],[""]]);
  expect(withoutLyrics(abc)).toBe(serialize({...document,lyricTokens:[]}));
});

it("escapes ABC lyric controls and newlines without changing source text",()=>{
  const base=data.materialized.document;
  const text="한 말-_~*|%\nV:evil";
  const document={...base,lyricTokens:[{...base.lyricTokens[0],text,verse:1}]};
  const abc=serialize(document);
  expect(lyricLines(abc)).toHaveLength(1);
  expect(abc).not.toContain("\nV:evil");
  expect(melodyWords(abc)[0]).toEqual(["한\u00a0말-_~*|％\u00a0V:evil"]);
  expect(document.lyricTokens[0].text).toBe(text);
  expect(withoutLyrics(abc)).toBe(serialize({...document,lyricTokens:[]}));
});


