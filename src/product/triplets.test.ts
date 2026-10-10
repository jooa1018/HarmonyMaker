import abcjs from "abcjs";
import { expect, it } from "vitest";
import { decodePracticeShare, encodePracticeShare } from "../domain/share";
import { prepareQuickHarmony, generateQuickHarmony } from "./quick-harmony";
import { tripletExercise } from "./fixtures/triplet-exercise";
import { materializeActiveArrangement } from "./render";
import { arrangementRenderDocumentToAbc } from "./score-adapter";
import { buildPlaybackPlan } from "./playback-plan";
import { exportHarmonyProject, importHarmonyProject } from "./project-transfer";
import { exportArrangementMusicXml } from "./musicxml-export";
import { materializePracticeShare } from "./practice-share";
import { materializeSharedPractice } from "./shared-practice";
import { applyWorkspaceCommand, readVerifiedWorkspace } from "../import/workspace/journal";
import { applyRecoveryXmlEdit, createImportRecovery } from "../import/review/recovery";
import { createStructuralRecovery } from "../import/review/structural-recovery";
import { fraction } from "../domain/fraction";
import { readFileSync } from "node:fs";
import { binaryDigest } from "../domain/digest/canonical";
import baseline from "./fixtures/pre-triplet-bytes.json";

async function generate(xml:string,parts:Parameters<typeof generateQuickHarmony>[1]["parts"]=["alto","tenor"]){
  const prep=await prepareQuickHarmony({bytes:new TextEncoder().encode(xml),fileName:"original-triplets.musicxml"});
  expect(prep.status,JSON.stringify(prep)).toBe("ready");
  const result=await generateQuickHarmony(prep,{parts,rightsConfirmed:true,confirmedAt:"2026-10-10T00:00:00.000Z"});
  if(result.status!=="complete"&&result.status!=="partial")throw Error(JSON.stringify(result));
  return result;
}
function checkAbc(abc:string,plan:ReturnType<typeof buildPlaybackPlan>){
  const tune=abcjs.parseOnly(abc)[0]; expect(tune.warnings??[]).toEqual([]);
  const audio=tune.setUpAudio({chordsOff:true});
  for(const [i,id] of plan.trackIds.entries()){
    const actual=audio.tracks[i].filter(e=>e.cmd==="note"),expected=plan.events.filter(e=>e.trackId===id);
    expect(actual.map(e=>e.pitch),id).toEqual(expected.map(e=>e.midi));
    actual.forEach((e,j)=>{expect(e.start*4,id).toBeCloseTo(expected[j].startQuarter,5);expect(e.duration*4,id).toBeCloseTo(expected[j].durationQuarter,5);});
  }
}
it.each((["quarter","eighth","16th"] as const).flatMap(type=>([["alto"],["tenor"],["alto","tenor"]] as const).map(parts=>({type,parts}))))("$type / $parts: exact timing through generation, project, ABC, XML and V5",async({type,parts})=>{
  const result=await generate(tripletExercise(type),parts),project=result.project;
  expect(project.variants.standard).toMatchObject({intentPlan:{grammarVersion:"grammar-v1.2"}});
  expect(result.parts.map(p=>p.part)).toEqual(parts);
  const saved=await exportHarmonyProject(project);
  expect(await exportHarmonyProject(await importHarmonyProject(saved))).toBe(saved);
  expect(await exportHarmonyProject((await generate(tripletExercise(type),parts)).project)).toBe(saved);
  const materialized=materializeActiveArrangement(project,"standard"), {document,trackRoles}=materialized;
  const notation={title:project.source.title,key:project.source.defaultKey,tempo:project.source.defaultTempo};
  const abc=arrangementRenderDocumentToAbc(document,trackRoles,notation);
  expect(abc).toContain("(3:2:");checkAbc(abc,buildPlaybackPlan(document,trackRoles));
  const payload=materializePracticeShare({project,presetId:"standard",materialized,workspaceShareConfirmedForThisExport:true});
  expect(payload.schemaVersion).toBe(5);
  const shared=materializeSharedPractice(decodePracticeShare(encodePracticeShare(payload)));
  expect(arrangementRenderDocumentToAbc(shared.document,shared.trackRoles,notation)).toBe(abc);
  checkAbc(abc,buildPlaybackPlan(shared.document,shared.trackRoles));
  const xml=exportArrangementMusicXml(document,trackRoles,notation);
  expect(xml).toContain("<time-modification>");expect(/<tuplet\b[^>]*type="start"/u.test(xml)).toBe(true);
  const prep=await prepareQuickHarmony({bytes:new TextEncoder().encode(xml),fileName:"exported.musicxml"});
  expect(prep.reasons.filter(r=>r.messageKo.includes("기호"))).toEqual([]);
});
it.each(["quarter","eighth","16th"] as const)("infers an unmarked same-duration %s triple only",async type=>{
  await generate(tripletExercise(type,false));
});

it.each(baseline)("$name preserves pre-triplet project/share/ABC/XML bytes",async expected=>{
  const prep=await prepareQuickHarmony({bytes:new Uint8Array(readFileSync(new URL(`./fixtures/wag11/${expected.name}.musicxml`,import.meta.url))),fileName:`${expected.name}.musicxml`});
  const result=await generateQuickHarmony(prep,{parts:["alto","tenor"],rightsConfirmed:true,confirmedAt:"2026-10-10T00:00:00.000Z"});
  if(result.status!=="complete"&&result.status!=="partial")throw Error(result.status);
  const project=result.project,materialized=materializeActiveArrangement(project,"standard"),notation={title:project.source.title,key:project.source.defaultKey,tempo:project.source.defaultTempo};
  const hash=(text:string)=>binaryDigest(new TextEncoder().encode(text));
  expect(await hash(await exportHarmonyProject(project))).toBe(expected.project);
  expect(await hash(encodePracticeShare(materializePracticeShare({project,presetId:"standard",materialized,workspaceShareConfirmedForThisExport:true})))).toBe(expected.share);
  expect(await hash(arrangementRenderDocumentToAbc(materialized.document,materialized.trackRoles,notation))).toBe(expected.abc);
  expect(await hash(exportArrangementMusicXml(materialized.document,materialized.trackRoles,notation))).toBe(expected.xml);
});

it("preserves an explicit cross-bar mixed-duration 3:2 group with a tie",async()=>{
  const pitch='<pitch><step>E</step><octave>4</octave></pitch>';
  const ordinary=(duration:number,type:string)=>`<note>${pitch}<duration>${duration}</duration><type>${type}</type></note>`;
  const triplet=(duration:number,type:string,boundary?:string,tie?:string)=>`<note>${pitch}<duration>${duration}</duration>${tie?`<tie type="${tie}"/>`:""}<type>${type}</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes><normal-type>quarter</normal-type></time-modification><notations>${boundary?`<tuplet type="${boundary}" number="1"/>`:""}${tie?`<tied type="${tie}"/>`:""}</notations></note>`;
  let measure=0;
  const xml=tripletExercise("quarter").replace(/<measure\b.*?<\/measure>/gu,m=>{
    measure++;
    if(measure>2)return "";
    const prefix=m.slice(0,m.indexOf("<note>"));
    return prefix+(measure===1 ? ordinary(24,"half")+ordinary(12,"quarter")+triplet(8,"quarter","start")+triplet(4,"eighth",undefined,"start") : triplet(4,"eighth",undefined,"stop")+triplet(8,"quarter","stop")+ordinary(12,"quarter").repeat(3))+"</measure>";
  });
  const result=await generate(xml),project=result.project,{document,trackRoles}=materializeActiveArrangement(project,"standard");
  const abc=arrangementRenderDocumentToAbc(document,trackRoles,{title:project.source.title,key:project.source.defaultKey,tempo:project.source.defaultTempo});
  expect(abc).toContain("(3:2:4");checkAbc(abc,buildPlaybackPlan(document,trackRoles));
  expect(await exportHarmonyProject(await importHarmonyProject(await exportHarmonyProject(project)))).toBe(await exportHarmonyProject(project));
  const broken=xml.replace('<tuplet type="stop" number="1"/>',"");
  expect((await prepareQuickHarmony({bytes:new TextEncoder().encode(broken),fileName:"open-cross-bar.musicxml"})).status).toBe("unsupported");
});

it.each(["ratio","duration","normal-type","nested","open","duplicate","dot","grace","cue","ornament","implicit-short"])("rejects unsupported or ambiguous %s without dropping notation",async mode=>{
  let xml=tripletExercise("eighth");
  if(mode==="ratio")xml=xml.replace("<actual-notes>3","<actual-notes>5");
  if(mode==="duration")xml=xml.replace("<duration>4","<duration>5");
  if(mode==="normal-type")xml=xml.replace("<normal-type>eighth","<normal-type>quarter");
  if(mode==="nested")xml=xml.replace('<tuplet type="start" number="1"/>','<tuplet type="start" number="1"/><tuplet type="start" number="2"/>');
  if(mode==="open")xml=xml.replace('<tuplet type="stop" number="1"/>',"");
  if(mode==="duplicate")xml=xml.replace("<actual-notes>3</actual-notes>","<actual-notes>3</actual-notes><actual-notes>5</actual-notes>");
  if(["dot","grace","cue"].includes(mode))xml=xml.replace("<note>",`<note><${mode}/>`);
  if(mode==="ornament")xml=xml.replace("<notations>","<notations><ornaments><trill-mark/></ornaments>");
  if(mode==="implicit-short")xml=tripletExercise("eighth",false).replace(/<note>.*?<\/note>/u,"");
  const prep=await prepareQuickHarmony({bytes:new TextEncoder().encode(xml),fileName:"invalid-triplet.musicxml"});
  expect(prep.status).toBe("unsupported");
});

it("preserves a tuplet rest, ties and slurs in one V5 and keeps exact ABC audio",async()=>{
  let n=0;
  const xml=tripletExercise("eighth").replace(/<note>.*?<\/note>/gu,note=>{
    n++;
    if(n===2)return note.replace(/<pitch>.*?<\/pitch>/u,"<rest/>");
    if(n===1)return note.replace("<notations>",'<notations><slur type="start" number="1"/>');
    if(n===3)return note.replace("<notations>",'<notations><slur type="stop" number="1"/>');
    return note;
  });
  const {project}=await generate(xml),materialized=materializeActiveArrangement(project,"standard");
  const payload=materializePracticeShare({project,presetId:"standard",materialized,workspaceShareConfirmedForThisExport:true});
  const shared=materializeSharedPractice(decodePracticeShare(encodePracticeShare(payload)));
  const abc=arrangementRenderDocumentToAbc(shared.document,shared.trackRoles,{title:project.source.title,key:project.source.defaultKey,tempo:project.source.defaultTempo});
  checkAbc(abc,buildPlaybackPlan(shared.document,shared.trackRoles));
  expect(shared.document.sourceLeadTrack.atoms.some(a=>!a.pitch&&a.tuplets)).toBe(true);
  expect(shared.document.sourceLeadTrack.atoms.some(a=>a.slurs)).toBe(true);
});

it("supports workspace and import recovery pitch edits without losing the group; rejects broken timing and structural recovery",async()=>{
  const xml=tripletExercise("eighth"),prep=await prepareQuickHarmony({bytes:new TextEncoder().encode(xml),fileName:"edit-triplet.musicxml"});
  const workspace=prep.workspace!;
  const event=(await readVerifiedWorkspace(workspace)).state.music!.parts[0].measures[0].leadEvents[0];
  const value={kind:"note" as const,onset:event.onset,duration:event.duration,pitch:{step:"C" as const,alter:0 as const,octave:4},tieStart:false,tieStop:false};
  const changed=await applyWorkspaceCommand(workspace,workspace,{kind:"note",eventId:event.workspaceEventId!,value},{id:"edit:1",actor:"ui-test",at:"2026-10-10T00:00:00.000Z",note:"authored fixture pitch correction"});
  expect((await readVerifiedWorkspace(changed)).state.music!.parts[0].measures[0].leadEvents[0].tuplets).toEqual(event.tuplets);
  await expect(applyWorkspaceCommand(workspace,workspace,{kind:"note",eventId:event.workspaceEventId!,value:{...value,duration:fraction(1)}},{id:"edit:1",actor:"ui-test",at:"2026-10-10T00:00:00.000Z",note:"invalid group"})).rejects.toThrow("WORKSPACE_TUPLET_EDIT_UNSUPPORTED");
  const recoveryEdit={kind:"note" as const,part:0,measure:0,event:0,value:{kind:"note" as const,type:"eighth" as const,dots:0 as const,pitch:value.pitch,tieStart:false,tieStop:false}};
  const edited=applyRecoveryXmlEdit(xml,recoveryEdit);
  await generate(edited);
  expect(()=>applyRecoveryXmlEdit(xml,{...recoveryEdit,value:{...recoveryEdit.value,type:"quarter"}})).toThrow("RECOVERY_TUPLET_EDIT_UNSUPPORTED");
  await expect(createStructuralRecovery("triplet",[{id:"d0",recovery:await createImportRecovery(new TextEncoder().encode(xml),"triplet.musicxml")}])).rejects.toThrow("셋잇단음표가 있는 악보는 구조 복구 편집을 아직 지원하지 않아요.");
});
