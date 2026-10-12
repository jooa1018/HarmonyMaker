import { readFileSync } from "node:fs";
import { beforeAll, expect, it } from "vitest";
import { generateQuickHarmony, prepareQuickHarmony } from "./quick-harmony";
import { materializeActiveArrangement } from "./render";
import { materializePracticeShare } from "./practice-share";
import { materializeSharedPractice } from "./shared-practice";
import { decodePracticeShare, encodePracticeShare, isPracticeSharePayload, type PracticeSharePayload } from "../domain/share";
import { practiceSharePlaintext, PRACTICE_SHARE_MAX_COMPRESSED_BYTES, decompressPracticeShare } from "../domain/share-compression";
import { generateDeterministicAccompaniment } from "../accompaniment/deterministic";
import { arrangementRenderDocumentToAbc } from "./score-adapter";
import { exportArrangementMusicXml } from "./musicxml-export";
import { buildPlaybackPlan } from "./playback-plan";
import { decodeProductUrlShare, encodeProductUrlShare } from "./share-url";
import { exportHarmonyProject } from "./project-transfer";
import type { ArrangementRenderDocument } from "../domain/generation/model";
import { fraction } from "../domain/fraction";

const original = readFileSync(new URL("./fixtures/wag11/4-4-1.musicxml",import.meta.url),"utf8");
const attributes = /<attributes>[\s\S]*?<\/attributes>/u.exec(original)![0];
const chord = "<harmony><root><root-step>C</root-step></root><kind>major</kind></harmony>";
function score(printed = false, repeated = false) {
  const pickup = `<measure number="0" implicit="yes">${attributes}${repeated ? '<barline location="left"><repeat direction="forward"/></barline>' : ""}${printed ? chord : ""}<note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><type>eighth</type><lyric number="1"><text>하나</text></lyric><lyric number="2"><text>둘</text></lyric></note></measure>`;
  const xml = original.replace('<part id="P1">',`<part id="P1">${pickup}`);
  return repeated ? xml.replace("</part>","<barline location=\"right\"><repeat direction=\"backward\"/></barline></part>") : xml;
}
async function generated(xml = score()) {
  const prep = await prepareQuickHarmony({bytes:new TextEncoder().encode(xml),fileName:"public-pickup.musicxml"});
  const result = await generateQuickHarmony(prep,{parts:["alto","tenor"],rightsConfirmed:true,confirmedAt:"2026-10-10T00:00:00.000Z"});
  if (result.status !== "complete" && result.status !== "partial") throw Error(JSON.stringify({status:result.status,reasons:result.preparation.reasons,questions:result.preparation.questions}));
  const project=result.project, materialized=materializeActiveArrangement(project,"standard");
  return { project, materialized, payload:materializePracticeShare({project,presetId:"standard",materialized,workspaceShareConfirmedForThisExport:true}) };
}
let fixture: Awaited<ReturnType<typeof generated>>;
beforeAll(async()=>{fixture=await generated();});

it("round-trips a code-free pickup in V5 with the policy and following chord linkage",async()=>{
  const {project,materialized,payload}=fixture, before=await exportHarmonyProject(project);
  expect(payload.schemaVersion).toBe(5);
  expect("resolutionPolicy" in payload && payload.resolutionPolicy).toEqual(materialized.document.effectiveChordTimeline.resolutionPolicy);
  expect(payload.chords?.[0].origin).toEqual({kind:"arrangement-policy",policy:"anticipate-first-chord",followingSource:0});
  expect(payload.chords?.[1].origin).toEqual({kind:"source-event",source:0});
  expect(decodePracticeShare(encodePracticeShare(payload))).toEqual(payload);
  expect(decodeProductUrlShare(encodeProductUrlShare(payload))).toEqual(payload);
  const shared=materializeSharedPractice(payload), timeline=shared.document.effectiveChordTimeline;
  const policy=timeline.spans[0].origin, following=timeline.spans[1].origin;
  expect(policy.kind).toBe("arrangement-policy"); expect(following.kind).toBe("source-event");
  if (policy.kind==="arrangement-policy" && following.kind==="source-event") expect(policy.followingSourceChordEventId).toBe(following.sourceChordEventId);
  expect(await generateDeterministicAccompaniment(timeline)).toEqual(await generateDeterministicAccompaniment(materialized.document.effectiveChordTimeline));
  const sounds=(d:ArrangementRenderDocument,r:typeof materialized.trackRoles)=>buildPlaybackPlan(d,r).events.map(e=>[e.startQuarter,e.durationQuarter,e.midi]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]||a[2]-b[2]);
  expect(sounds(shared.document,shared.trackRoles)).toEqual(sounds(materialized.document,materialized.trackRoles));
  const notation={title:project.source.title,key:project.source.defaultKey,tempo:project.source.defaultTempo};
  expect(arrangementRenderDocumentToAbc(shared.document,shared.trackRoles,notation)).toBe(arrangementRenderDocumentToAbc(materialized.document,materialized.trackRoles,notation));
  const xml=exportArrangementMusicXml(shared.document,shared.trackRoles,notation);
  expect(xml).toContain("편곡 정책: 첫 코드 선행 적용");
  const first=/<measure number="1"[\s\S]*?<\/measure>/u.exec(xml)![0];
  expect(first).not.toContain("<harmony>");
  expect(await exportHarmonyProject(project)).toBe(before);
  const policySource=materialized.document.effectiveChordTimeline.spans[0].origin;
  if(policySource.kind==="arrangement-policy")expect(encodePracticeShare(payload)).not.toContain(policySource.followingSourceChordEventId);
});

it("keeps an explicitly printed pickup on V4 without policy annotations",async()=>{
  const {payload}=await generated(score(true));
  expect(payload.schemaVersion).toBe(4); expect(payload).not.toHaveProperty("resolutionPolicy");
  expect(payload.chords?.every(c=>c.origin===undefined)).toBe(true);
  const shared=materializeSharedPractice(payload);
  expect(shared.document.effectiveChordTimeline.resolutionPolicy.initialPickup).toBeUndefined();
  expect(arrangementRenderDocumentToAbc(shared.document,shared.trackRoles,payload)).not.toContain("편곡 정책");
});

it("does not extend the engine's initial exception to repeated pickups",async()=>{
  const xml=score().replace('<measure number="0" implicit="yes">','<measure number="0" implicit="yes"><barline location="left"><repeat direction="forward"/></barline>')
    .replace("</measure></part>",'<barline location="right"><repeat direction="backward"/></barline></measure></part>');
  const prep=await prepareQuickHarmony({bytes:new TextEncoder().encode(xml),fileName:"repeated-pickup.musicxml"});
  const r=await generateQuickHarmony(prep,{parts:["alto"],rightsConfirmed:true,confirmedAt:"2026-10-10T00:00:00.000Z"});
  expect(["needs-input","unsupported","blocked"]).toContain(r.status);
});

it("preserves lyric verse indices without applying the pickup policy to a later occurrence",()=>{
  const payload=structuredClone(fixture.payload);
  const secondVerse={...payload,arrangement:{...payload.arrangement,measures:payload.arrangement.measures.map(m=>({...m,lyricVerseIndex:2}))}};
  expect(isPracticeSharePayload(secondVerse)).toBe(true);
  expect(decodePracticeShare(encodePracticeShare(secondVerse)).arrangement.measures.map(m=>m.lyricVerseIndex)).toEqual(secondVerse.arrangement.measures.map(()=>2));
  expect(materializeSharedPractice(secondVerse).document.effectiveChordTimeline.spans.filter(s=>s.origin.kind==="arrangement-policy").every(s=>s.range.start.performanceMeasureIndex===0)).toBe(true);
});

it.each(["version","missing-policy","missing-origin","unknown-policy","missing-anchor","other-chord","later-pickup","nonzero-anchor","unknown-field","full-first-measure","noncanonical-source"] as const)("rejects inconsistent policy metadata: %s",mode=>{
  const value=JSON.parse(encodePracticeShare(fixture.payload));
  if(mode==="version")value.schemaVersion=4;
  if(mode==="missing-policy")delete value.resolutionPolicy;
  if(mode==="missing-origin")delete value.chords[0].origin;
  if(mode==="unknown-policy")value.resolutionPolicy.initialPickup="anything";
  if(mode==="missing-anchor")value.chords[0].origin.followingSource=999;
  if(mode==="other-chord")value.chords[0].symbol="F";
  if(mode==="later-pickup"){value.chords[0].startOccurrenceIndex=1;value.chords[0].endOccurrenceIndex=2;}
  if(mode==="nonzero-anchor")value.chords[1].startOffset=[1,1];
  if(mode==="unknown-field")value.chords[0].origin.ignored=true;
  if(mode==="full-first-measure")value.arrangement.measures[0].duration=[4,1];
  if(mode==="noncanonical-source"){value.chords[0].origin.followingSource=4;value.chords[1].origin.source=4;}
  expect(isPracticeSharePayload(value)).toBe(false);
});

it("preserves carried provenance and verifies its previous/source references",async()=>{
  const {project,materialized}=fixture, doc=materialized.document, timeline=doc.effectiveChordTimeline;
  const previous=timeline.spans[1];
  if(previous.origin.kind!=="source-event")throw Error("source fixture");
  const carried={...timeline.spans[2],parseResult:previous.parseResult,origin:{kind:"carried" as const,carrySource:"gap-policy" as const,originatingSourceChordEventId:previous.origin.sourceChordEventId,previousSpanId:previous.id}};
  const changed={...materialized,document:{...doc,effectiveChordTimeline:{...timeline,spans:timeline.spans.map((s,i)=>i===2?carried:s)}}};
  const payload=materializePracticeShare({project,presetId:"standard",materialized:changed,workspaceShareConfirmedForThisExport:true});
  expect(payload.chords?.[2].origin).toMatchObject({kind:"carried",previous:1,source:0});
  const shared=materializeSharedPractice(payload);
  expect(shared.document.effectiveChordTimeline.spans[2].origin).toMatchObject({kind:"carried",previousSpanId:"share:chord:1",originatingSourceChordEventId:"share:chord-source:0"});
  const wrong=JSON.parse(encodePracticeShare(payload));wrong.chords[2].origin.previous=2;
  expect(isPracticeSharePayload(wrong)).toBe(false);
  const later={...shared.document,measures:shared.document.measures.map((m,i)=>i===0?{...m,duration:fraction(4)}:m)};
  expect(()=>materializePracticeShare({project,presetId:"standard",materialized:{...changed,document:later,trackRoles:shared.trackRoles},workspaceShareConfirmedForThisExport:true})).toThrow("SHARE_ARRANGEMENT_POLICY_INCONSISTENT");
});

it("retains plaintext/compressed limits on the new V5 fields",()=>{
  const huge:PracticeSharePayload={...fixture.payload,lyrics:Array.from({length:140},(_,i)=>({id:`ly:${i}`,text:"가".repeat(2048),verse:1,syllabic:"single",extend:false}))};
  expect(()=>practiceSharePlaintext(huge)).toThrow("SHARE_PAYLOAD_TOO_LARGE");
  expect(()=>decompressPracticeShare(new Uint8Array(PRACTICE_SHARE_MAX_COMPRESSED_BYTES+1))).toThrow("SHARE_PAYLOAD_TOO_LARGE");
});
