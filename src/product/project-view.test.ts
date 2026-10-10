import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import type { HarmonyProject } from "../domain/project";
import { generateDeterministicAccompaniment } from "../accompaniment/deterministic";
import { prepareQuickHarmony, generateQuickHarmony } from "./quick-harmony";
import { describeHarmonyProject, projectPracticeView } from "./project-view";
import { exportHarmonyProject, importHarmonyProject } from "./project-transfer";
import { materializeActiveArrangement } from "./render";
import { buildPlaybackPlan } from "./playback-plan";
import * as adapter from "./score-adapter";

const fixture=(name:string)=>readFileSync(new URL(`./fixtures/${name}`,import.meta.url),"utf8");
async function generated(name="4-4-1",octave=4){
  const xml=fixture(`wag11/${name}.musicxml`).replaceAll("<octave>4</octave>",`<octave>${octave}</octave>`);
  const prep=await prepareQuickHarmony({bytes:new TextEncoder().encode(xml),fileName:`${name}.musicxml`});
  const result=await generateQuickHarmony(prep,{parts:["alto","tenor"],rightsConfirmed:true,confirmedAt:"2026-10-10T00:00:00.000Z"});
  if(result.status!=="complete"&&result.status!=="partial")throw new Error(result.status);
  return {prep,result,project:result.project};
}

it.each(["4-4-1","3-4-1","12-8-1"])("reads saved %s and produces the existing full player input",async name=>{
  const {prep,project,result}=await generated(name);
  const before=await exportHarmonyProject(project);
  const restored=await importHarmonyProject(before);
  const summary=describeHarmonyProject(restored);
  expect(summary).toMatchObject({title:prep.summary!.title,keyLabelKo:prep.summary!.keyLabelKo,meters:prep.summary!.meters,measureCount:prep.summary!.measureCount});
  expect(summary.parts).toEqual(result.parts.map(p=>({part:p.part,label:p.part==="alto"?"알토":"테너",role:p.part==="alto"?"lower":"upper",status:p.status,missingMeasures:p.missingMeasures})));
  const view=await projectPracticeView(restored);
  if(view.status!=="available")throw new Error(view.code);
  const materialized=materializeActiveArrangement(restored,"standard");
  expect(view).toEqual({status:"available",abc:adapter.arrangementRenderDocumentToAbc(materialized.document,materialized.trackRoles,{title:project.source.title,key:project.source.defaultKey,tempo:project.source.defaultTempo}),
    plan:buildPlaybackPlan(materialized.document,materialized.trackRoles,await generateDeterministicAccompaniment(materialized.document.effectiveChordTimeline)),tempo:project.source.defaultTempo,identity:`${materialized.artifactDigest}:full`});
  expect(view.plan.trackIds).toContain("track:band");
  expect(await exportHarmonyProject(restored)).toBe(before);
});

it("reads v1.0.1 without renaming, upgrading or changing its serialized bytes",async()=>{
  const bytes=fixture("auto-draft-v1-auto.json");
  const project=await importHarmonyProject(bytes);
  const description=describeHarmonyProject(project);
  expect(description.parts).toHaveLength(1);
  expect(description.parts[0].label).toMatch(/^(Upper|Lower)(\/Lower)? \/ H[12]$/u);
  expect(description.parts[0].part).toBeUndefined();
  expect((await projectPracticeView(project)).status).toBe("available");
  expect(await exportHarmonyProject(project)).toBe(bytes);
});

it("retains requested missing parts when reopening a partial result",async()=>{
  const {project,result}=await generated("4-4-1",3);
  expect(result.status).toBe("partial");
  const description=describeHarmonyProject(await importHarmonyProject(await exportHarmonyProject(project)));
  expect(description.parts.map(p=>({part:p.part,status:p.status,missingMeasures:p.missingMeasures})))
    .toEqual(result.parts.map(({part,status,missingMeasures})=>({part,status,missingMeasures})));
  expect(description.parts).toHaveLength(2);
  expect(description.parts.some(p=>p.status!=="complete")).toBe(true);
});

it("owns concurrent results and captures input before asynchronous accompaniment",async()=>{
  const {project}=await generated();
  const before=await exportHarmonyProject(project);
  const [one,two]=await Promise.all([projectPracticeView(project),projectPracticeView(project)]);
  expect(one).toEqual(two);if(one.status!=="available"||two.status!=="available")throw new Error("unavailable");
  Object.assign(one.plan.trackLabels,{"track:source-lead":"changed"});
  expect(two.plan.trackLabels["track:source-lead"]).toBe("멜로디");
  const pending=projectPracticeView(project);
  const title=project.source.title;
  Object.assign(project.source,{title:"changed while awaiting"});
  expect(await pending).toEqual(two);
  Object.assign(project.source,{title});
  expect(await exportHarmonyProject(project)).toBe(before);
});

it("returns unavailable for missing output and ABC limitations but rejects integrity errors",async()=>{
  const {project}=await generated();
  const empty:HarmonyProject={...project,variants:{standard:{lifecycle:"empty",presetId:"standard",diagnostics:[]}}};
  expect(await projectPracticeView(empty)).toEqual({status:"unavailable",code:"ACTIVE_ARRANGEMENT_UNAVAILABLE"});
  expect(describeHarmonyProject(empty).parts.every(p=>p.status===undefined)).toBe(true);
  const spy=vi.spyOn(adapter,"arrangementRenderDocumentToAbc");
  try {
    spy.mockImplementationOnce(()=>{throw new RangeError("ABC_SERIALIZATION_UNAVAILABLE");});
    expect(await projectPracticeView(project)).toEqual({status:"unavailable",code:"ABC_SERIALIZATION_UNAVAILABLE"});
    spy.mockImplementationOnce(()=>{throw new RangeError("RENDER_DOCUMENT_INVALID");});
    await expect(projectPracticeView(project)).rejects.toThrow("RENDER_DOCUMENT_INVALID");
  } finally {spy.mockRestore();}
  const unverified=JSON.parse(fixture("auto-draft-v1-edited.json"));
  await expect(projectPracticeView(unverified)).rejects.toThrow("EDIT_SNAPSHOT_UNVERIFIED");
  expect(describeHarmonyProject(unverified).title).not.toBeNull();
});

it("never throws while describing incomplete legacy display data",()=>{
  for(const value of [null,{}, {source:{title:"옛 악보",sourceMeasures:[]}}, {source:{title:"",defaultKey:{}}}]){
    expect(()=>describeHarmonyProject(value as unknown as HarmonyProject)).not.toThrow();
  }
  expect(describeHarmonyProject({source:{title:"옛 악보",sourceMeasures:[]}} as unknown as HarmonyProject))
    .toEqual({title:"옛 악보",keyLabelKo:"조성 확인 필요",meters:[],measureCount:0,parts:[]});
});
