import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { prepareWagLifecycle, primaryPulseAt } from "../grammar/lifecycle";
import { wagInputFromProject } from "./workspace";
import { fraction } from "../domain/fraction";
import { XMLParser } from "fast-xml-parser";
import type { SpelledPitch } from "../domain/pitch";
import { containsPitch, pitchMidiNumber } from "../domain/pitch";
import { HARMONY_PART_PRESETS } from "../domain/part-presets";
import { comparePositions } from "../domain/time";
import { generateQuickHarmony, prepareQuickHarmony } from "./quick-harmony";
import { materializeActiveArrangement } from "./render";
import { exportArrangementMusicXml } from "./musicxml-export";
import { arrangementRenderDocumentToAbc } from "./score-adapter";
import { buildPlaybackPlan, quarterSeconds } from "./playback-plan";
import { exportHarmonyProject, importHarmonyProject } from "./project-transfer";
import { materializePracticeShare } from "./practice-share";
import { materializeSharedPractice } from "./shared-practice";
import { isPracticeSharePayload } from "../domain/share";
import { replayScoreWorkspace } from "../import/workspace/journal";
import { schedulePracticeAudio } from "./practice-audio";

const choice = { rightsConfirmed: true, confirmedAt: "2026-10-10T00:00:00.000Z" } as const;
const fixtures = ["4-4", "3-4", "12-8"].flatMap(m => [1,2,3].map(i => `${m}-${i}`));
const score = (name: string) => readFileSync(new URL(`./fixtures/wag11/${name}.musicxml`, import.meta.url), "utf8");
const prepare = (xml: string) => prepareQuickHarmony({bytes: new TextEncoder().encode(xml), fileName: "original-exercise.musicxml"});

describe("WAG 1.1 fixed parts, written tenor and meters", () => {
  it.each(fixtures)("%s: all three selections preserve roles, ranges, meter, exports and sounding playback", async name => {
    const prep = await prepare(score(name));
    expect(prep.status).toBe("ready");
    for (const parts of [["alto"], ["tenor"], ["alto","tenor"]] as const) {
      const result = await generateQuickHarmony(prep, {...choice, parts});
      expect(result.status, JSON.stringify("parts" in result ? result.parts : result.preparation)).toBe("complete");
      if (result.status !== "complete") throw new Error(result.status);
      expect(result.parts.map(p => [p.part,p.status,p.missingMeasures])).toEqual(parts.map(p => [p,"complete",[]]));
      const project = result.project;
      expect(result.generation.execution.generation.result.versions.grammarVersion).toBe("grammar-v1.1");
      const materialized = materializeActiveArrangement(project,"standard");
      const {document,trackRoles} = materialized;
      const compound = name.startsWith("12");
      expect(document.measures[0].time.beatGroups).toEqual(compound ? [3,3,3,3] : name.startsWith("3") ? [1,1,1] : [1,1,1,1]);
      if (compound) expect(project.source.defaultTempo).toEqual({beatUnit:4,dotted:true,bpm:60});
      const playback = buildPlaybackPlan(document,trackRoles,result.generation.execution.accompaniment);
      expect(playback.totalQuarter).toBe(document.measures.reduce((sum,m)=>sum+m.duration.n/m.duration.d,0));
      expect(quarterSeconds(project.source.defaultTempo,100)).toBeGreaterThan(0);
      for (const [index,part] of parts.entries()) {
        const track=document.generatedHarmonyTracks[index];
        expect(track.notationOctaveShift ?? 0).toBe(part === "tenor" ? -1 : 0);
        const notes=track.events.filter(e=>e.kind==="note");
        expect(notes.length).toBeGreaterThan(0);
        for (const note of notes) {
          expect(containsPitch(HARMONY_PART_PRESETS[part].hardRange,note.pitch)).toBe(true);
          const leads=document.sourceLeadTrack.atoms.filter(a=>a.pitch && comparePositions(a.range.start,note.range.end)<0 && comparePositions(note.range.start,a.range.end)<0);
          for (const lead of leads) expect((pitchMidiNumber(note.pitch)-pitchMidiNumber(lead.pitch!))*(part==="tenor"?1:-1)).toBeGreaterThan(0);
          if (!note.tieStop) expect(playback.events.find(e=>e.eventId===note.id)?.midi).toBe(pitchMidiNumber(note.pitch)+(part==="tenor"?-12:0));
        }
      }
      const metadata={title:project.source.title,key:project.source.defaultKey,tempo:project.source.defaultTempo};
      const xml=exportArrangementMusicXml(document,trackRoles,metadata);
      const abc=arrangementRenderDocumentToAbc(document,trackRoles,metadata);
      expect(xml).toContain("<part-name>멜로디</part-name>");
      expect(abc).toContain('name="멜로디"');
      for (const part of parts) {
        const label = part === "alto" ? "알토" : "테너";
        expect(xml).toContain(`<part-name>${label}</part-name>`);
        expect(abc).toContain(`name="${label}"`);
      }
      expect(xml.includes("<clef-octave-change>-1</clef-octave-change>")).toBe(parts.some(p=>p==="tenor"));
      const exported = new XMLParser({isArray: name => ["part", "measure", "note"].includes(name)}).parse(xml) as {
        "score-partwise": { part: { measure: { note: { pitch?: SpelledPitch }[] }[] }[] };
      };
      for (const [index, part] of parts.entries()) {
        const notes = exported["score-partwise"].part[index + 1].measure.flatMap(measure => measure.note).filter(note => note.pitch);
        const written = document.generatedHarmonyTracks[index].events.filter(event => event.kind === "note");
        expect(notes.map(note => pitchMidiNumber({...note.pitch!, alter: note.pitch!.alter ?? 0}))).toEqual(
          written.map(note => pitchMidiNumber(note.pitch) + (part === "tenor" ? -12 : 0)),
        );
      }
      expect(abc.includes("clef=treble-8")).toBe(parts.some(p=>p==="tenor"));
      const payload=materializePracticeShare({project,presetId:"standard",materialized,workspaceShareConfirmedForThisExport:true});
      expect(payload.arrangement.tracks.map(track=>track.label)).toEqual(["멜로디",...parts.map(part=>part==="alto"?"알토":"테너")]);
      expect(isPracticeSharePayload(payload)).toBe(true);
      const shared=materializeSharedPractice(payload);
      expect(shared.trackRoles.sourceLeadLabel).toBe("멜로디");
      const sounds = (plan: ReturnType<typeof buildPlaybackPlan>) => plan.events.map(e=>[e.startQuarter,e.durationQuarter,e.midi]).sort((a,b)=>a[0]-b[0] || a[1]-b[1] || a[2]-b[2]);
      expect(sounds(buildPlaybackPlan(shared.document,shared.trackRoles))).toEqual(sounds(buildPlaybackPlan(document,trackRoles)));
      expect(arrangementRenderDocumentToAbc(shared.document,shared.trackRoles,metadata).includes("treble-8")).toBe(parts.some(p=>p==="tenor"));
      const encoded=await exportHarmonyProject(project);
      expect(await exportHarmonyProject(await importHarmonyProject(encoded))).toBe(encoded);
      const again=await generateQuickHarmony(prep,{...choice,parts:parts.length===2?["tenor","alto"]:parts});
      if (again.status!=="complete")throw new Error(again.status);
      expect(await exportHarmonyProject(again.project)).toBe(encoded);
      // Optional local listening deliverable; CI never writes outside its tree.
      if (process.env.HM_LISTENING_OUTPUT) {
        mkdirSync(process.env.HM_LISTENING_OUTPUT,{recursive:true});
        writeFileSync(join(process.env.HM_LISTENING_OUTPUT,`${name}-${parts.join("-")}.musicxml`),xml,"utf8");
      }
    }
  },180000);

  it.each([3,5])("octave %i: cannot switch a requested role to hide an out-of-range part", async octave=>{
    const prep=await prepare(score("4-4-1").replaceAll("<octave>4</octave>",`<octave>${octave}</octave>`));
    const result=await generateQuickHarmony(prep,{...choice,parts:["alto","tenor"]});
    expect(result.status).not.toBe("complete");
    if (!("parts" in result))throw new Error(result.status);
    expect(result.parts).toHaveLength(2);
    const absent=result.parts.find(p=>p.part===(octave===3?"alto":"tenor"))!;
    expect(absent.status).not.toBe("complete");
    expect(absent.missingMeasures.length).toBeGreaterThan(0);
    expect(absent.reasonKo).toContain(`${absent.missingMeasures.join("·")}번째 마디에서`);
    expect(absent.reasonKo).not.toMatch(/\d마디/u);
    if (result.status==="partial") {
      for (const m of result.generation.execution.generation.marginals)expect(m.placementRole).toBe(m.track.trackOrdinal===1?"lower":"upper");
    }
  });

  it("auto fixes the default role; single requested tenor never becomes lower",async()=>{
    for (const octave of [3,4,5]) {
      const prep=await prepare(score("4-4-1").replaceAll("<octave>4</octave>",`<octave>${octave}</octave>`));
      for (const parts of ["auto",["tenor"],["alto"]] as const) {
        const result=await generateQuickHarmony(prep,{...choice,parts});
        if (result.status!=="complete" && result.status!=="partial")continue;
        for (const marginal of result.generation.execution.generation.marginals)expect(marginal.placementRole).toBe(result.parts[0].part==="alto"?"lower":"upper");
      }
    }
  });

  it("prepares the marker once and reuses it throughout pulse lookups", async () => {
    const result = await generateQuickHarmony(await prepare(score("4-4-1")), {...choice,parts:["alto","tenor"]});
    if(result.status !== "complete")throw new Error(result.status);
    const input = await wagInputFromProject(result.project,"standard");
    const info = input.source.importInfo;
    if(info?.sourceKind !== "score-workspace")throw new Error("missing marker");
    const marker = info.workspaceMetadata.autoDraft!.marker;
    const spy = vi.spyOn(JSON,"parse");
    try {
      const prepared = await prepareWagLifecycle(input);
      if(prepared.status !== "complete")throw new Error(prepared.status);
      const before = spy.mock.calls.filter(([value]) => value === marker).length;
      expect(before).toBe(1);
      for(let i=0;i<100;i++)expect(primaryPulseAt(prepared.value,{performanceMeasureIndex:0,offset:fraction(0)})).toEqual(fraction(1));
      expect(spy.mock.calls.filter(([value]) => value === marker)).toHaveLength(before);
    } finally { spy.mockRestore(); }
  });

  it.each([3,9])("keeps %i/8 outside supported meters",async beats=>{
    const prep=await prepare(score("12-8-1").replaceAll("<beats>12</beats>",`<beats>${beats}</beats>`));
    expect(prep.status).toBe("unsupported");
    const state = await replayScoreWorkspace(prep.workspace!);
    expect(state.music!.parts[0].measures[0].time.beatGroups).toEqual(Array.from({length:beats/3},()=>3));
  });

  it("practice audio schedules the lowered tenor frequency; octave tampering is rejected",async()=>{
    const result=await generateQuickHarmony(await prepare(score("4-4-1")),{...choice,parts:["tenor"]});
    if(result.status!=="complete")throw new Error(result.status);
    const materialized=materializeActiveArrangement(result.project,"standard");
    const plan=buildPlaybackPlan(materialized.document,materialized.trackRoles);
    const oscillators:{frequency:{value:number}}[]=[];
    const node=()=>({connect(){return this;},disconnect(){},gain:{value:1,setValueAtTime(){},linearRampToValueAtTime(){}}});
    const context={destination:{},createGain:node,createOscillator:()=>{const o={...node(),frequency:{value:0},start(){},stop(){}};oscillators.push(o);return o;}};
    schedulePracticeAudio(context as unknown as BaseAudioContext,plan,{fromQuarter:0,secondsPerQuarter:0.5,startedAt:0,audible:new Set(plan.trackIds),levels:{},masterLevel:1});
    expect(oscillators.map(o=>o.frequency.value)).toEqual(plan.events.map(e=>440*2**((e.midi-69)/12)));
    const tampered=JSON.parse(await exportHarmonyProject(result.project));
    delete tampered.trackPlans[1].notationOctaveShift;
    await expect(importHarmonyProject(JSON.stringify(tampered))).rejects.toThrow("PROJECT_INTEGRITY_INVALID");
  });
});
