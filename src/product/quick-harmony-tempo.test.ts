import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { generateQuickHarmony, prepareQuickHarmony, prepareQuickHarmonyWorkspace, QUICK_HARMONY_TEMPO_MIN, QUICK_HARMONY_TEMPO_MAX, type QuickHarmonyChoice } from "./quick-harmony";
import { readVerifiedWorkspace } from "../import/workspace/journal";
import * as assessment from "../import/workspace/auto-draft";
import { materializeActiveArrangement } from "./render";
import { materializePracticeShare } from "./practice-share";
import { materializeSharedPractice } from "./shared-practice";
import { decodePracticeShare, encodePracticeShare } from "../domain/share";
import { exportArrangementMusicXml } from "./musicxml-export";
import { exportHarmonyProject, importHarmonyProject } from "./project-transfer";
import { projectPracticeView } from "./project-view";
import { buildPlaybackPlan, quarterSeconds } from "./playback-plan";
import { tempoSpec } from "../domain/source/model";

const xml=readFileSync(new URL("./fixtures/wag11/4-4-1.musicxml",import.meta.url),"utf8");
const choice={parts:["alto","tenor"],rightsConfirmed:true,confirmedAt:"2026-10-12T00:00:00.000Z"} as const;
const prepare=(source=xml)=>prepareQuickHarmony({bytes:new TextEncoder().encode(source),fileName:"tempo.musicxml"});

it("reports automatic and score tempos without changing the established default",async()=>{
  expect((await prepare()).summary?.tempo).toEqual({bpm:80,beatUnit:4,dotted:false,origin:"auto"});
  const score=xml.replace("</attributes>",'</attributes><direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>92</per-minute></metronome></direction-type></direction>');
  expect((await prepare(score)).summary?.tempo).toEqual({bpm:92,beatUnit:4,dotted:false,origin:"score"});
});

it.each(["simple","compound"])("records %s tempo as a user edit and round-trips time, XML and share",async kind=>{
  // Use a complete 6/8 bar with six eighth notes, derived from the authored 4/4 exercise.
  const compound=xml.replace("<beats>4</beats><beat-type>4</beat-type>","<beats>6</beats><beat-type>8</beat-type>")
    .replaceAll("<duration>2</duration><type>quarter</type>","<duration>1</duration><type>eighth</type>")
    .replaceAll("</measure>",'<note><rest/><duration>2</duration><type>quarter</type></note></measure>');
  const prep=await prepare(kind==="simple"?xml:compound),before=JSON.stringify(prep.workspace);
  expect(prep.status).toBe("ready");
  const result=await generateQuickHarmony(prep,{...choice,tempo:{bpm:60}});
  if(result.status!=="complete"&&result.status!=="partial")throw Error(result.status);
  const tempo={bpm:60,beatUnit:4 as const,dotted:kind==="compound"};
  expect(result.project.source.defaultTempo).toEqual(tempo);
  expect(result.preparation.details.assessment?.provenance).toContainEqual(expect.objectContaining({field:"tempo",origin:"user-edit",value:tempo}));
  const workspace=result.preparation.workspace!;
  expect(workspace.operations.at(-1)).toMatchObject({command:{kind:"tempo",tempo},actor:"user",at:choice.confirmedAt});
  expect((await readVerifiedWorkspace(workspace)).state.request.tempo).toEqual(tempo);
  expect(JSON.stringify(prep.workspace)).toBe(before);
  const saved=await exportHarmonyProject(result.project);
  expect(await exportHarmonyProject(await importHarmonyProject(saved))).toBe(saved);
  const m=materializeActiveArrangement(result.project,"standard"), notation={title:result.project.source.title,key:result.project.source.defaultKey,tempo};
  const exported=exportArrangementMusicXml(m.document,m.trackRoles,notation);
  expect(exported).toContain(`<per-minute>60</per-minute>`);
  expect(exported).not.toContain("<sound tempo=");
  const reopened=await prepare(exported);
  const importedTempo=(await readVerifiedWorkspace(reopened.workspace!)).state.music!.defaultTempo!;
  expect(importedTempo).toEqual(tempo);
  const share=materializePracticeShare({project:result.project,presetId:"standard",materialized:m,workspaceShareConfirmedForThisExport:true});
  const decoded=decodePracticeShare(encodePracticeShare(share)),shared=materializeSharedPractice(decoded);
  expect(decoded.tempo).toEqual(tempo);
  const view=await projectPracticeView(result.project);if(view.status!=="available")throw Error(view.code);
  expect(view.plan.totalQuarter*quarterSeconds(view.tempo,100)).toBe(kind==="compound"?8:16);
  expect(buildPlaybackPlan(shared.document,shared.trackRoles).totalQuarter).toBe(view.plan.totalQuarter);
});

it.each([19,301,60.5,NaN,Infinity,"60",null,{}, {bpm:60,beatUnit:8}])("rejects invalid tempo %j before generation",async value=>{
  const prep=await prepare();
  const tempo=typeof value==="object"?value:{bpm:value};
  await expect(generateQuickHarmony(prep,{...choice,tempo} as QuickHarmonyChoice)).rejects.toMatchObject({code:"QUICK_HARMONY_CHOICE_INVALID"});
});

it("exports the same inclusive integer limits as the existing tempo editor",()=>{
  expect(tempoSpec(4,false,QUICK_HARMONY_TEMPO_MIN).bpm).toBe(20);
  expect(tempoSpec(4,false,QUICK_HARMONY_TEMPO_MAX).bpm).toBe(300);
  expect(()=>tempoSpec(4,false,QUICK_HARMONY_TEMPO_MIN-1)).toThrow();
  expect(()=>tempoSpec(4,false,QUICK_HARMONY_TEMPO_MAX+1)).toThrow();
});

it("keeps the existing metronome-only maximum dotted tempo readable",async()=>{
  const score=xml.replace("</attributes>",'</attributes><direction><direction-type><metronome><beat-unit>quarter</beat-unit><beat-unit-dot/><per-minute>300</per-minute></metronome></direction-type></direction>');
  const prep=await prepare(score);
  expect(prep.status).toBe("ready");
  expect(prep.summary?.tempo).toEqual({beatUnit:4,dotted:true,bpm:300,origin:"score"});
});

it("omits only a tempo-only AUTOMATIC_VALUES note and retains other automatic findings",async()=>{
  const prep=await prepare(),real=prep.details.assessment!,tempo=real.provenance.find(p=>p.field==="tempo")!;
  const spy=vi.spyOn(assessment,"assessAutoDraft");
  try{
    spy.mockResolvedValueOnce({...real,provenance:[tempo]});
    expect((await prepareQuickHarmonyWorkspace(prep.workspace!)).notes.some(n=>n.id==="automatic-values")).toBe(false);
    spy.mockResolvedValueOnce({...real,provenance:[tempo,{...tempo,field:"sections"}]});
    expect((await prepareQuickHarmonyWorkspace(prep.workspace!)).notes.some(n=>n.id==="automatic-values")).toBe(true);
  }finally{spy.mockRestore();}
});
