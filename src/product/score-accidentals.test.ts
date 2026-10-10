import { readFileSync } from "node:fs";
import abcjs from "abcjs";
import { expect, it } from "vitest";
import type { ArrangementRenderDocument } from "../domain/generation/model";
import type { KeySignature, SpelledPitch } from "../domain/pitch";
import { fraction } from "../domain/fraction";
import { musicalRange } from "../domain/time";
import { prepareQuickHarmony, generateQuickHarmony } from "./quick-harmony";
import { materializeActiveArrangement } from "./render";
import { arrangementRenderDocumentToAbc } from "./score-adapter";
import { buildPlaybackPlan } from "./playback-plan";
import { exportArrangementMusicXml } from "./musicxml-export";
import { exportHarmonyProject } from "./project-transfer";

async function fixture(name = "4-4-1", octave = 4) {
  const xml = readFileSync(new URL(`./fixtures/wag11/${name}.musicxml`, import.meta.url), "utf8").replaceAll("<octave>4</octave>", `<octave>${octave}</octave>`);
  const prep = await prepareQuickHarmony({bytes:new TextEncoder().encode(xml),fileName:"accidental-exercise.musicxml"});
  const result = await generateQuickHarmony(prep,{parts:["alto","tenor"],rightsConfirmed:true,confirmedAt:"2026-10-10T00:00:00.000Z"});
  if (result.status !== "complete" && result.status !== "partial") throw new Error(result.status);
  const project=result.project, materialized=materializeActiveArrangement(project,"standard");
  return {project,materialized,result,notation:{title:project.source.title,key:project.source.defaultKey,tempo:project.source.defaultTempo}};
}

function roundTrip(data: Awaited<ReturnType<typeof fixture>>, document = data.materialized.document, key = data.notation.key) {
  const abc=arrangementRenderDocumentToAbc(document,data.materialized.trackRoles,{...data.notation,key});
  const tune=abcjs.parseOnly(abc)[0];
  expect(tune.warnings ?? []).toEqual([]);
  const audio=tune.setUpAudio({chordsOff:true});
  const plan=buildPlaybackPlan(document,data.materialized.trackRoles);
  expect(audio.tracks).toHaveLength(plan.trackIds.length);
  for (const [i,id] of plan.trackIds.entries()) {
    const actual=audio.tracks[i].filter(e=>e.cmd==="note");
    const expected=plan.events.filter(e=>e.trackId===id);
    expect(actual.map(e=>e.pitch),id).toEqual(expected.map(e=>e.midi));
    for (const [j,note] of actual.entries()) {
      expect(note.start*4,id).toBeCloseTo(expected[j].startQuarter,5);
      expect(note.duration*4,id).toBeCloseTo(expected[j].durationQuarter,5);
    }
  }
  return abc;
}

it.each(["4-4","3-4","12-8"].flatMap(m=>[1,2,3].map(i=>`${m}-${i}`)))("%s: abcjs sounding pitches including treble-8 agree with the engine; serialization changes no authority",async name=>{
  const data=await fixture(name), {document,trackRoles}=data.materialized;
  const before=await exportHarmonyProject(data.project), rendered=JSON.stringify(data.materialized);
  const xml=exportArrangementMusicXml(document,trackRoles,data.notation), plan=buildPlaybackPlan(document,trackRoles);
  roundTrip(data);
  expect(await exportHarmonyProject(data.project)).toBe(before);
  expect(JSON.stringify(data.materialized)).toBe(rendered);
  expect(exportArrangementMusicXml(document,trackRoles,data.notation)).toBe(xml);
  expect(buildPlaybackPlan(document,trackRoles)).toEqual(plan);
});

it("round-trips a partial result with an absent harmony",async()=>{
  const data=await fixture("4-4-1",3);
  expect(data.result.status).toBe("partial");
  roundTrip(data);
});

it.each([
  [{tonic:{step:"G",alter:0},mode:"major"},"F",1],
  [{tonic:{step:"F",alter:0},mode:"major"},"B",-1],
  [{tonic:{step:"D",alter:0},mode:"minor"},"B",-1],
] as const)("omits key accidentals and tracks changes by octave in %j",async(key,step,alter)=>{
  const data=await fixture();
  const pitches: SpelledPitch[]=[
    {step,alter,octave:4},{step,alter:0,octave:4},{step,alter,octave:5},{step,alter:0,octave:4},
    {step,alter,octave:4},{step,alter:2,octave:4},{step,alter:-2,octave:4},{step,alter,octave:4},
  ];
  const document=melody(data.materialized.document,pitches);
  const abc=roundTrip(data,document,key as KeySignature);
  const voice=abc.split("[V:lead] ")[1].split("\n")[0];
  expect(voice.startsWith(`${step}4 =${step}4 ${step.toLowerCase()}4 ${step}4 |`)).toBe(true);
  expect(voice).toContain(`^^${step}4 __${step}4`);
});

function melody(document: ArrangementRenderDocument, pitches: readonly SpelledPitch[]) {
  const seed=document.sourceLeadTrack.atoms[0];
  return {...document,effectiveChordTimeline:{...document.effectiveChordTimeline,spans:[]},sourceLeadTrack:{...document.sourceLeadTrack,
    atoms:pitches.map((pitch,i)=>({...seed,id:`accidental:${i}`,pitch,lyricTokenIds:[],tiedFromPrevious:false,tiedToNext:false,
      range:musicalRange({performanceMeasureIndex:Math.floor(i/4),offset:fraction(i%4)}, {performanceMeasureIndex:Math.floor(i/4),offset:fraction(i%4+1)},document.measures.map(m=>m.duration))}))}};
}

it("carries a chromatic tie across the bar but resets following attacks, including a new accidental",async()=>{
  const data=await fixture();
  const pitches=Array.from({length:8},(_,i): SpelledPitch=>({step:"F",alter:i>=3&&i<=5?1:0,octave:4}));
  const original=melody(data.materialized.document,pitches);
  const document={...original,sourceLeadTrack:{...original.sourceLeadTrack,atoms:original.sourceLeadTrack.atoms.map((atom,i)=>({...atom,tiedToNext:i===3,tiedFromPrevious:i===4}))}};
  const abc=roundTrip(data,document,{tonic:{step:"C",alter:0},mode:"major"});
  expect(abc).toContain("F4 F4 F4 ^F4- | F4 ^F4 =F4 F4 |");
});
