import { describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { fraction } from "../../domain/fraction";
import { binaryDigest } from "../../domain/digest/canonical";
import { APPLICATION_ALGORITHM_VERSION_REGISTRY as V } from "../../app/algorithm-version-registry";
import { deriveQuickReview, importMusicXml } from "..";
import { validateSongSourceDocumentIntegrity } from "../../domain/source/validation";
import { exportHarmonyProject, importHarmonyProject } from "../../product/project-transfer";
import { createProjectFromQuickReview, generateProjectVariant } from "../../product/workspace";
import { materializeActiveArrangement } from "../../product/render";
import { exportArrangementMusicXml } from "../../product/musicxml-export";
import { originFromMusicXml, originFromLegacyBundle, workspaceEvidenceDigest } from "./input";
import { createImportRecovery } from "../review/recovery";
import { applyStructuralEdit, createStructuralRecovery, replayStructuralRecovery, structuralDigest } from "../review/structural-recovery";
import { applyWorkspaceCommand, createScoreWorkspace, exportScoreWorkspace, parseScoreWorkspace, replayScoreWorkspace } from "./journal";
import { deriveWorkspaceCapabilities, effectiveWorkspaceKey } from "./review";
import { projectScoreWorkspace, validateProjectedWorkspaceDraft } from "./projection";
import { ScoreWorkspaceStore, generatedWorkspaceResultIsCurrent } from "./store";
import type { ScoreWorkspace, WorkspaceCommand } from "./model";
import { confirmShareRights, materializePracticeShare } from "../../product/practice-share";
import { computeSourceProvenanceDigest } from "../../domain/source/provenance";
import { validateWorkspaceSourceIntegrity } from "./source-integrity";
import { IndexedDbProjectStore } from "../../product/local-project-store";

// Independently authored musical fixtures. No private score/XML is committed.
const E=new TextEncoder();
const note=(duration=4,voice=1,step="D",extra="")=>`<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>${duration}</duration><voice>${voice}</voice>${extra}</note>`;
const harmony='<harmony><root><root-step>D</root-step></root><kind>minor</kind></harmony>';
function score({mode="",time=4,extraVoice=false,body=note(),later=""}: {mode?:string;time?:number;extraVoice?:boolean;body?:string;later?:string}={}) {
  return `<score-partwise><work><work-title>Independent boundary fixture</work-title></work><part-list><score-part id="P1"><part-name>Two preserved voices</part-name></score-part></part-list><part id="P1">${Array.from({length:4},(_,i)=>`<measure number="${i+1}">${i===0?`<attributes><divisions>1</divisions><key><fifths>-1</fifths>${mode?`<mode>${mode}</mode>`:""}</key><time><beats>${time}</beats><beat-type>4</beat-type></time></attributes>`:""}${i===2?later:""}${i===0||i===2?harmony:""}${body}${extraVoice?`<backup><duration>4</duration></backup>${note(4,2,"F")}`:""}</measure>`).join("")}</part></score-partwise>`;
}
async function start(xml=score()) {return createScoreWorkspace(await originFromMusicXml(E.encode(xml),"independent.musicxml"),V,"workspace:independent");}
async function act(w:ScoreWorkspace,command:WorkspaceCommand) {return applyWorkspaceCommand(w,w,command,{id:`op:${w.revision}`,note:"독립 fixture 명시적 시험 결정",actor:"ui-test",at:"2026-09-12T09:00:00.000Z"});}
async function state(w:ScoreWorkspace) {return replayScoreWorkspace(w);}
async function caps(w:ScoreWorkspace) {return deriveWorkspaceCapabilities(await state(w),await workspaceEvidenceDigest(w.origin));}
async function select(w:ScoreWorkspace) {const s=await state(w);return act(w,{kind:"lead",lead:s.music!.leadCandidates[0].key,rhythmVoices:[]});}
async function reviewAll(w:ScoreWorkspace) {const s=await state(w);for(const m of s.music!.parts[0].measures)w=await act(w,{kind:"attest",purpose:"music",scope:{kind:"measure",measureId:m.workspaceMeasureId!,voiceKey:s.request.lead!}});return w;}
async function ready(w:ScoreWorkspace) {
  w=await select(w);
  w=await act(w,{kind:"key",contextId:"p0m0:key",key:{tonic:{step:"D",alter:0},mode:"minor"}});
  w=await act(w,{kind:"tempo",tempo:{beatUnit:4,dotted:true,bpm:60}});
  const pitch=(octave:number)=>({step:"C" as const,alter:0 as const,octave});
  w=await act(w,{kind:"performers",count:2,slots:[0,1].map(i=>({id:`pf:${i}`,displayName:`Singer ${i}`,profile:{id:`pf:${i}`,displayName:`Singer ${i}`,hardRange:{low:pitch(3),high:pitch(6)},comfortableRange:{low:pitch(3),high:pitch(6)}}}))});
  w=await act(w,{kind:"rights",rights:{basis:"self-authored",allowedUses:["generation"]}});
  w=await act(w,{kind:"sections",sections:(await state(w)).request.sections.map(s=>({...s,type:"verse",confirmation:"confirmed"})),lyricVerses:{}});
  return reviewAll(w);
}

describe("persistent score boundary",()=>{
  it("invalidates the endpoints and interior of an edited slur, keeping the unrelated measure",async()=>{
    let w=await ready(await start()),s=await state(w);
    const event=(i:number)=>s.music!.parts[0].measures[i].leadEvents[0].workspaceEventId!;
    w=await act(w,{kind:"event-slurs",eventId:event(0),slurs:[{number:2,type:"start"}]});
    w=await act(w,{kind:"event-slurs",eventId:event(2),slurs:[{number:2,type:"stop"}]});
    w=await reviewAll(w);s=await state(w);
    const middle=s.music!.parts[0].measures[1].leadEvents[0];
    w=await act(w,{kind:"note",eventId:middle.workspaceEventId!,value:{kind:"note",pitch:{step:"F",alter:0,octave:4},onset:middle.onset,duration:middle.duration,tieStart:false,tieStop:false}});
    expect((await caps(w)).musicReviews.map(m=>m.current)).toEqual([false,false,false,true]);
    w=await act(w,{kind:"undo"});expect((await caps(w)).musicReviews.every(m=>m.current)).toBe(true);
    w=await act(w,{kind:"redo"});w=await parseScoreWorkspace(await exportScoreWorkspace(w));
    expect((await caps(w)).musicReviews.map(m=>m.current)).toEqual([false,false,false,true]);
  });
  it("rejects changed lyric text even when it leaves the WAG musical digest unchanged",async()=>{
    const w=await ready(await start(score({body:note(4,1,"D",'<lyric number="1"><syllabic>single</syllabic><text>fixture</text></lyric>')})));
    const source=(await deriveQuickReview(await projectScoreWorkspace(w),V)).source!;
    expect(await validateWorkspaceSourceIntegrity(source)).toBe(true);
    const changed=structuredClone(source);
    (changed.sourceMeasures[0].lyricTokens[0] as {text:string}).text="unreviewed replacement";
    expect(changed.revisionDigest).toBe(source.revisionDigest);
    expect(await validateWorkspaceSourceIntegrity(changed)).toBe(false);
  });
  it("projects pitch-free rhythm on the Lead staff and blocks a selected rhythm on another staff",async()=>{
    for(const staff of [1,2]){
      const slash=`<backup><duration>4</duration></backup><note><unpitched><display-step>B</display-step><display-octave>4</display-octave></unpitched><duration>4</duration><voice>2</voice><type>whole</type><staff>${staff}</staff><notehead>slash</notehead></note>`;
      let w=await ready(await start(score({body:note()+slash})));const s=await state(w);
      const rhythm=s.music!.leadCandidates.find(c=>c.key!==s.request.lead)!.key;
      w=await act(w,{kind:"lead",lead:s.request.lead!,rhythmVoices:[rhythm]});w=await reviewAll(w);
      if(staff===2){
        expect((await caps(w)).arrange).toBe(false);await expect(projectScoreWorkspace(w)).rejects.toThrow("NOT_READY");
      }
      else {
        const draft=await projectScoreWorkspace(w),review=await deriveQuickReview(draft,V);
        expect(review.state.readyForPlanning,JSON.stringify(review.diagnostics)).toBe(true);
        const events=review.source!.sourceMeasures.flatMap(m=>m.rhythmVoices!.flatMap(v=>v.events));
        expect(events).toHaveLength(4);expect(events.every(e=>e.kind==="rhythm"&&!("pitch" in e))).toBe(true);
      }
    }
  });
  it("keeps a workspace snapshot exportable after a separate share confirmation", async()=>{
    const w=await ready(await start());
    const draft=await projectScoreWorkspace(w),review=await deriveQuickReview(draft,V);
    const generated=await generateProjectVariant(await createProjectFromQuickReview(draft,review),"standard");
    const project=generated.project, before=await exportHarmonyProject(project);
    expect(()=>confirmShareRights(project,"2026-09-12T12:00:00Z")).toThrow("WORKSPACE_RIGHTS_IMMUTABLE");
    const materialized=materializeActiveArrangement(project,"standard");
    expect(()=>materializePracticeShare({project,presetId:"standard",materialized})).toThrow("SHARE_RIGHTS_REQUIRED");
    const payload=materializePracticeShare({project,presetId:"standard",materialized,workspaceShareConfirmedForThisExport:true});
    expect(payload.rightsShareConfirmed).toBe(true);
    expect(JSON.stringify(payload)).not.toMatch(/workspace|proof|originalFile|sourceKind|base64|sourceEvidence/iu);
    expect(await exportHarmonyProject(project)).toBe(before);
    expect((await importHarmonyProject(before)).source.importInfo?.sourceKind).toBe("score-workspace");
  });
  it("rejects a self-resealed Source whose claimed rights disagree with the workspace request", async()=>{
    const w=await ready(await start());const draft=await projectScoreWorkspace(w);
    const source=(await deriveQuickReview(draft,V)).source!;
    const changed={...source,rights:{...source.rights,allowedUses:[]}};
    const resealed={...changed,sourceProvenanceDigest:await computeSourceProvenanceDigest(changed)};
    expect(await validateWorkspaceSourceIntegrity(resealed)).toBe(false);
  });
  it("atomically refuses an imported project ID collision and retains the previous valid file", async()=>{
    const w=await ready(await start()),draft=await projectScoreWorkspace(w);
    const project=await createProjectFromQuickReview(draft,await deriveQuickReview(draft,V));
    const store=new IndexedDbProjectStore(new IDBFactory());
    const record={projectId:"copy:collision",project,updatedAt:"2026-09-12T12:00:00Z"};
    const results=await Promise.allSettled([store.saveNew(record),store.saveNew({...record,updatedAt:"2026-09-13T12:00:00Z"})]);
    expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    expect(results.filter(r=>r.status==="rejected")).toHaveLength(1);
    expect(await exportHarmonyProject((await store.load(record.projectId))!.project)).toBe(await exportHarmonyProject(project));
    await store.saveNew({...record,projectId:"copy:second"});
    expect(await store.list()).toHaveLength(2);
  });
  it("rejects divergent history, overlong history and a mismatched selection proof", async()=>{
    const w=await ready(await start(score({extraVoice:true}))),s=await state(w);
    const left=await act(w,{kind:"title",title:"left"}),right=await act(w,{kind:"title",title:"right"});
    const store=new ScoreWorkspaceStore(new IDBFactory());
    await store.save({workspace:left,storageRevision:0,updatedAt:"2026-09-12T12:00:00Z"});
    await expect(store.save({workspace:right,storageRevision:1,updatedAt:"2026-09-12T12:01:00Z"},0)).rejects.toThrow("ROLLBACK");
    expect((await store.load(w.id))!.workspace.historyDigest).toBe(left.historyDigest);
    await expect(parseScoreWorkspace(JSON.stringify({...w,operations:Array(2049).fill(w.operations[0]),revision:2049}))).rejects.toThrow("HISTORY_INVALID");
    const draft=await projectScoreWorkspace(w);
    await expect(validateProjectedWorkspaceDraft({...draft,selectedLeadStaffKey:s.music!.leadCandidates[1].key})).rejects.toThrow("SUBSTITUTED");
    await expect(originFromMusicXml(E.encode('<score-partwise>'+ '<nested>'.repeat(130)+'</nested>'.repeat(130)+'</score-partwise>'),"deep.xml")).rejects.toThrow();
  });
  it("keeps the unselected pitched part intact when selecting the second part",async()=>{
    const first=score({mode:"minor"});
    const second=first.match(/<part id="P1">[\s\S]*<\/part>/u)![0].replace('id="P1"','id="P2"').replaceAll('<step>D</step>','<step>F</step>');
    const xml=first.replace('</part-list>','<score-part id="P2"><part-name>Second part</part-name></score-part></part-list>').replace('</score-partwise>',second+'</score-partwise>');
    let w=await ready(await start(xml));let s=await state(w);
    const lead=s.music!.leadCandidates.find(c=>c.partOrdinal===1)!.key;
    w=await act(w,{kind:"lead",lead,rhythmVoices:[]});
    w=await act(w,{kind:"sections",sections:(await state(w)).request.sections.map(section=>({...section,type:"verse",confirmation:"confirmed"})),lyricVerses:{}});
    for(const m of s.music!.parts[1].measures)w=await act(w,{kind:"attest",purpose:"music",scope:{kind:"measure",measureId:m.workspaceMeasureId!,voiceKey:lead}});
    const draft=await projectScoreWorkspace(w),review=await deriveQuickReview(draft,V);
    expect(review.state.readyForPlanning,JSON.stringify(review.diagnostics)).toBe(true);
    expect(review.source!.sourceMeasures.flatMap(m=>m.leadEvents).every(e=>e.kind==="note"&&e.pitch.step==="F")).toBe(true);
    s=await state(await parseScoreWorkspace(await exportScoreWorkspace(w)));
    expect(s.music!.parts[0].measures.flatMap(m=>m.leadEvents)).toHaveLength(4);
  });
  it("distinguishes missing/explicit modes and effective key without rewriting observation or pitch",async()=>{
    for(const [mode,expected]of [["","importer-major-default"],["major","explicit-source-mode"],["minor","explicit-source-mode"]]as const) {
      const w=await start(score({mode})),s=await state(w),m=s.music!.parts[0].measures[0];
      expect(m.keyObservation?.interpretation).toBe(expected);
      expect(effectiveWorkspaceKey(s,m.workspaceMeasureId!)).toEqual(mode?{tonic:{step:mode==="major"?"F":"D",alter:0},mode}:undefined);
    }
    const w=await ready(await start()),s=await state(w);
    expect((await caps(w)).blockers).toEqual([]);
    expect(s.music!.parts[0].measures.every(m=>m.keyObservation?.fifths===-1&&m.keyObservation?.explicitMode===undefined)).toBe(true);
    const projected=await projectScoreWorkspace(w),analysis=await deriveQuickReview(projected,V);
    expect(analysis.diagnostics.map(d=>d.code)).not.toContain("UNSUPPORTED_MODULATION");
    expect(analysis.state.readyForPlanning,JSON.stringify(analysis.diagnostics)).toBe(true);
    expect(analysis.source?.defaultKey).toEqual({tonic:{step:"D",alter:0},mode:"minor"});
    expect(analysis.source?.defaultTempo).toEqual({beatUnit:4,dotted:true,bpm:60});
    expect(await validateSongSourceDocumentIntegrity(analysis.source,V.performanceExpanderVersion)).toBe(true);
  });
  it("keeps actual modulation blocked across explicit key contexts",async()=>{
    const w=await ready(await start(score({mode:"minor",later:'<attributes><key><fifths>1</fifths><mode>major</mode></key></attributes>'})));
    expect((await caps(w)).blockers.some(b=>b.id==="modulation")).toBe(true);
    expect(effectiveWorkspaceKey(await state(w),"p0m2")).toEqual({tonic:{step:"G",alter:0},mode:"major"});
  });
  it("restores explicit minor observations across the legacy serializer without guessing omitted mode",async()=>{
    for(const mode of ["minor",""]) {
      const xml=score({mode}),old=await createStructuralRecovery(`legacy:${mode||"absent"}`,[{id:"d0",recovery:await createImportRecovery(E.encode(xml),"original.musicxml"),failureReason:"independent compatibility fixture"}]);
      const bundle=JSON.stringify({version:"hm-structural-recovery-bundle-v1",workspace:old,pages:[]});
      const origin=await originFromLegacyBundle(bundle,"legacy.json");
      expect(origin.xml).not.toContain("<mode>");
      const w=await createScoreWorkspace(origin,V,`converted:${mode||"absent"}`),s=await state(await parseScoreWorkspace(await exportScoreWorkspace(w)));
      expect(w.origin.legacyBundle).toBe(bundle);
      expect(s.music!.parts[0].measures[0].workspaceMeasureId).toBe("d0:m0");
      expect(s.music!.parts[0].measures[0].keyObservation?.explicitMode).toBe(mode||undefined);
      expect(effectiveWorkspaceKey(s,"d0:m0")).toEqual(mode?{tonic:{step:"D",alter:0},mode:"minor"}:undefined);
    }
  });
  it("retains a conflicting legacy fifths correction separately and refuses silent promotion",async()=>{
    let old=await createStructuralRecovery("legacy:changed-key",[{id:"d0",recovery:await createImportRecovery(E.encode(score({mode:"minor"})),"key.musicxml"),failureReason:"independent compatibility fixture"}]);
    old=await applyStructuralEdit(old,await structuralDigest(await replayStructuralRecovery(old)),{kind:"context",measureId:"d0:m0",numerator:4,denominator:4,fifths:1,extent:fraction(4),implicit:false,label:"1"},"explicit legacy key correction fixture","key-change","2026-09-12T09:00:00Z");
    const bundle=JSON.stringify({version:"hm-structural-recovery-bundle-v1",workspace:old,pages:[]});
    const w=await createScoreWorkspace(await originFromLegacyBundle(bundle,"changed-key.json"),V,"legacy:changed-key"),s=await state(w);
    expect(w.origin.legacyBundle).toBe(bundle);
    expect(s.music!.parts[0].measures[0].keyObservation?.fifths).toBe(-1);
    expect(s.music!.parts[0].measures[0].key).toEqual({tonic:{step:"G",alter:0},mode:"major"});
    expect((await caps(w)).blockers.some(b=>b.id==="legacy-key:d0:m0")).toBe(true);
  });
  it("keeps musical Source and WAG results deterministic across new workspace identities and XML whitespace",async()=>{
    const first=await ready(await start());
    const second=await ready(await createScoreWorkspace(await originFromMusicXml(E.encode(score().replace(/></gu,">\n<")),"another-name.xml"),V,"workspace:second-identity"));
    const outputs=[];
    for(const w of [first,second]){const draft=await projectScoreWorkspace(w),review=await deriveQuickReview(draft,V),project=await createProjectFromQuickReview(draft,review),result=await generateProjectVariant(project,"standard");outputs.push(result.project);}
    expect(outputs[0].source.revisionDigest).toBe(outputs[1].source.revisionDigest);
    expect(outputs[0].variants.standard).toEqual(outputs[1].variants.standard);
    expect(first.origin.xmlDigest).not.toBe(second.origin.xmlDigest);
  });
  it("invalidates only the changed chord carry span; undo/redo/reload match current meaning",async()=>{
    let w=await ready(await start());const base=w;
    const c=(await state(w)).music!.parts[0].measures[0].chords[0];
    w=await act(w,{kind:"chord",measureId:"p0m0",chordId:c.key,text:"Gm",onset:fraction(0)});
    expect((await caps(w)).musicReviews.map(m=>m.current)).toEqual([false,false,true,true]);
    expect(generatedWorkspaceResultIsCurrent({workspace:w,storageRevision:0,updatedAt:"2026-09-12",generation:{projectId:"old",workspaceRevision:base.revision,workspaceDigest:base.digest}})).toBe(false);
    w=await act(w,{kind:"undo"});expect((await caps(w)).musicReviews.every(m=>m.current)).toBe(true);
    w=await act(w,{kind:"redo"});w=await parseScoreWorkspace(await exportScoreWorkspace(w));
    expect((await caps(w)).musicReviews.map(m=>m.current)).toEqual([false,false,true,true]);
    w=await act(w,{kind:"title",title:"Only title changes"});
    expect((await caps(w)).musicReviews.map(m=>m.current)).toEqual([false,false,true,true]);
  });
  it("invalidates tie neighbors, contextual meter and split boundaries without quantizing time",async()=>{
    let w=await ready(await start());const n=(await state(w)).music!.parts[0].measures[1].leadEvents[0];
    w=await act(w,{kind:"note",eventId:n.workspaceEventId!,value:{kind:"note",pitch:{step:"D",alter:0,octave:4},onset:n.onset,duration:n.duration,tieStart:true,tieStop:false}});
    expect((await caps(w)).musicReviews.map(m=>m.current)).toEqual([true,false,false,true]);
    w=await act(w,{kind:"undo"});w=await act(w,{kind:"meter",startMeasureId:"p0m1",endMeasureIdExclusive:"p0m2",time:{numerator:2,denominator:4,beatGroups:[1,1]}});
    expect((await caps(w)).musicReviews.map(m=>m.current)).toEqual([true,false,false,false]);
    let split=await ready(await start(score({body:note(2)+note(2)})));
    split=await act(split,{kind:"split",measureId:"p0m1",at:fraction(2)});
    expect((await state(split)).music!.parts[0].measures).toHaveLength(5);
    expect((await caps(split)).musicReviews.map(m=>m.current)).toEqual([true,false,false,true,true]);
    const rationalXml=score({body:note(1)+note(11)}).replace('<divisions>1</divisions>','<divisions>3</divisions>');
    let rational=await start(rationalXml);const before=(await state(rational)).music!.parts[0].measures[0].leadEvents[0];
    expect(before.duration).toEqual(fraction(1,3));
    rational=await act(rational,{kind:"title",title:"Rational remains exact"});
    expect((await state(await parseScoreWorkspace(await exportScoreWorkspace(rational)))).music!.parts[0].measures[0].leadEvents[0].duration).toEqual(fraction(1,3));
    const unsupported=await ready(await start(rationalXml.replace('</pitch>','</pitch><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>')));
    expect((await caps(unsupported)).blockers.some(b=>b.messageKo.includes("tuplet"))).toBe(true);
    await expect(projectScoreWorkspace(unsupported)).rejects.toThrow("NOT_READY");
  });
  it("preserves two pitched voices and projects only explicitly selected Lead through existing WAG and project codec",async()=>{
    const w=await ready(await start(score({extraVoice:true}))),s=await state(w);
    expect(s.music!.leadCandidates).toHaveLength(2);
    const draft=await projectScoreWorkspace(w),a=await deriveQuickReview(draft,V);
    expect(a.state.readyForPlanning,JSON.stringify(a.diagnostics)).toBe(true);
    expect(a.source!.sourceMeasures[0].leadEvents).toHaveLength(1);
    expect((await state(await parseScoreWorkspace(await exportScoreWorkspace(w)))).music!.parts[0].measures[0].leadEvents).toHaveLength(2);
    expect(a.source!.importInfo?.sourceKind).toBe("score-workspace");
    if(a.source!.importInfo?.sourceKind!=="score-workspace")throw Error("missing honest provenance");
    expect(a.source!.importInfo.workspaceMetadata.excludedVoices).toEqual([s.music!.leadCandidates[1].key]);
    const project=await createProjectFromQuickReview(draft,a),generated=await generateProjectVariant(project,"standard");
    expect(generated.status,JSON.stringify(generated.project.variants.standard?.diagnostics)).not.toBe("blocked");
    const imported=await importHarmonyProject(await exportHarmonyProject(generated.project));
    expect(imported.source.revisionDigest).toBe(project.source.revisionDigest);
    const rendered=materializeActiveArrangement(imported,"standard"),metadata=a.source!.importInfo.workspaceMetadata;
    const xml=exportArrangementMusicXml(rendered.document,rendered.trackRoles,{title:project.source.title,key:project.source.defaultKey,tempo:project.source.defaultTempo,workspaceProjection:metadata});
    const field=/<miscellaneous-field name="harmonymaker-workspace-projection">([^<]+)<\/miscellaneous-field>/u.exec(xml)?.[1];
    expect(field).toBeDefined();
    const selected=JSON.parse(field!.replace(/&quot;/gu,'"').replace(/&amp;/gu,'&'));
    expect(selected.selectedVoices).toEqual(metadata.selectedVoices);
    expect(selected.excludedVoices).toEqual([s.music!.leadCandidates[1].key]);
    expect(selected.range).toBe("whole-score");
  });
  it("retains unknown pitch/overfull/unsupported meter without turning them into rests or allowing arrangement",async()=>{
    const unknown=await start(score({body:'<note><pitch><step>?</step><octave>4</octave></pitch><duration>5</duration><voice>1</voice></note>',time:3}));
    const s=await state(unknown),c=await caps(unknown);
    expect(s.music!.parts[0].measures[0].leadEvents).toHaveLength(0);
    expect(s.music!.parts[0].measures[0].unresolvedEvents?.[0].kind).toBe("unknown");
    expect(c.saveDraft&&c.edit&&c.view&&!c.arrange).toBe(true);
    expect(c.blockers.some(b=>b.id.startsWith("meter:"))).toBe(true);
    const corrected=await act(unknown,{kind:"note",eventId:s.music!.parts[0].measures[0].unresolvedEvents![0].id,value:{kind:"note",pitch:{step:"D",alter:0,octave:4},onset:fraction(0),duration:fraction(5),tieStart:false,tieStop:false}});
    expect((await caps(corrected)).blockers.some(b=>b.id.startsWith("overfull:"))).toBe(true);
  });
  it("preserves fermata-bearing note identity and pitch when only the symbol is corrected",async()=>{
    let w=await start(score({body:note(4,1,"D","<notations><fermata/></notations>")}));
    const before=(await state(w)).music!.parts[0].measures[0].leadEvents[0];
    expect(before.fermata).toBe(true);
    w=await act(w,{kind:"fermata",eventId:before.workspaceEventId!,value:false});
    expect((await state(w)).music!.parts[0].measures[0].leadEvents[0]).toEqual({...before,fermata:false});
  });
  it("requires unknown influence review but ignores explicitly unrelated voice/metadata issues",async()=>{
    let w=await ready(await start(score({extraVoice:true})));const s=await state(w);
    w=await act(w,{kind:"issue",scope:{kind:"metadata"},detail:"제목의 철자 미확정"});
    w=await act(w,{kind:"issue",scope:{kind:"measure",measureId:"p0m0",voiceKey:s.music!.leadCandidates[1].key},detail:"선택 밖 독립 성부 음높이 대조"});
    expect((await caps(w)).arrange).toBe(true);
    w=await act(w,{kind:"issue",scope:{kind:"document"},detail:"재발음에 영향을 줄 수 있는 미확정 곡선"});
    expect((await caps(w)).arrange).toBe(false);
  });
  it("rejects history/origin/projection substitution, stale commands and XML entities",async()=>{
    const w=await ready(await start());
    await expect(applyWorkspaceCommand(w,{...w,revision:0},{kind:"title",title:"bad"},{id:"bad",note:"stale fixture",actor:"ui-test",at:"2026-09-12"})).rejects.toThrow("STALE");
    const history=JSON.parse(await exportScoreWorkspace(w));history.operations[0].note="길이 검사를 통과하는 변조된 사유";
    await expect(parseScoreWorkspace(JSON.stringify(history))).rejects.toThrow();
    for(const field of ["at","actor"]){const tampered=JSON.parse(await exportScoreWorkspace(w));tampered.operations[0][field]=field==="at"?"2026-09-13T09:00:00Z":"user";await expect(parseScoreWorkspace(JSON.stringify(tampered))).rejects.toThrow("SEAL");}
    const changed=JSON.parse(await exportScoreWorkspace(w));changed.origin.xml=changed.origin.xml.replace("Two preserved voices","different evidence");changed.origin.xmlDigest=await binaryDigest(E.encode(changed.origin.xml));
    await expect(parseScoreWorkspace(JSON.stringify(changed))).rejects.toThrow();
    const draft=await projectScoreWorkspace(w);
    await expect(validateProjectedWorkspaceDraft({...draft,defaultTempo:{beatUnit:4,dotted:false,bpm:123}})).rejects.toThrow("SUBSTITUTED");
    const source=(await deriveQuickReview(draft,V)).source!;
    expect(await validateSongSourceDocumentIntegrity({...source,composer:"unreviewed author"},V.performanceExpanderVersion)).toBe(false);
    expect(await validateSongSourceDocumentIntegrity({...source,rights:{...source.rights,allowedUses:[]}},V.performanceExpanderVersion)).toBe(false);
    await expect(originFromMusicXml(E.encode('<!DOCTYPE score-partwise [<!ENTITY secret SYSTEM "file:///secret">]>'+score()),"evil.xml")).rejects.toThrow();
    const raw=(await state(w)).music!;
    expect((await deriveQuickReview(raw,V)).state.readyForPlanning).toBe(false);
  });
  it("persists before project creation and rejects concurrent/stale saves, evidence replacement and storage failure",async()=>{
    const factory=new IDBFactory(),store=new ScoreWorkspaceStore(factory),w=await ready(await start());
    const row={workspace:w,storageRevision:0,updatedAt:"2026-09-12T09:00:00Z"};await store.save(row);
    const loaded=await store.load(w.id);expect(await state(loaded!.workspace)).toEqual(await state(w));
    const next=await act(w,{kind:"title",title:"Durable title"});
    const results=await Promise.allSettled([store.save({...row,workspace:next,storageRevision:1},0),store.save({...row,storageRevision:1},0)]);
    expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    expect(results.filter(r=>r.status==="rejected")).toHaveLength(1);
    await expect(store.save({...row,storageRevision:2},0)).rejects.toThrow("CONCURRENT");
    await expect(store.save({...row,workspace:await start(),storageRevision:2},1)).rejects.toThrow("ROLLBACK");
    const replacement=await start(score({mode:"minor"}));
    await expect(store.save({...row,workspace:replacement,storageRevision:2},1)).rejects.toThrow("CONCURRENT");
    await expect(new ScoreWorkspaceStore(undefined).save(row)).rejects.toThrow("UNAVAILABLE");
  });
  it("keeps the normal MusicXML parser strict for overfull input",async()=>{
    expect((await importMusicXml(E.encode(score({body:note(5)})),{algorithmVersions:V,identityFactory:()=>"strict:test"})).status).toBe("blocked");
  });
  it("does not acknowledge an aborted quota write and detects corrupt stored bytes",async()=>{
    const factory=new IDBFactory(),store=new ScoreWorkspaceStore(factory),w=await start();
    const row={workspace:w,storageRevision:0,updatedAt:"2026-09-12T09:00:00Z"};await store.save(row);
    const next=await act(w,{kind:"title",title:"Must not be falsely saved"});
    const fail=vi.spyOn(IDBObjectStore.prototype,"put").mockImplementationOnce(()=>{throw new DOMException("Synthetic storage quota failure","QuotaExceededError");});
    try{await expect(store.save({...row,workspace:next,storageRevision:1},0)).rejects.toThrow("quota failure");}finally{fail.mockRestore();}
    expect((await store.load(w.id))?.workspace.digest).toBe(w.digest);
    expect((await store.load(w.id))?.storageRevision).toBe(0);
    await new Promise<void>((resolve,reject)=>{
      const open=factory.open("harmonymaker-score-workspaces-v1",1);
      open.onsuccess=()=>{const db=open.result,tx=db.transaction("drafts","readwrite"),s=tx.objectStore("drafts"),get=s.get(w.id);
        get.onsuccess=()=>s.put({...get.result,encoded:get.result.encoded+" "});
        tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error);};};open.onerror=()=>reject(open.error);
    });
    await expect(store.load(w.id)).rejects.toThrow("CORRUPT");
  });
  it("preserves decomposed Unicode in opaque XML through workspace and canonical project export",async()=>{
    const xml=score().replace("Independent boundary fixture","Cafe\u0301 원본");
    const w=await ready(await start(xml));const encoded=await exportScoreWorkspace(w);
    expect(encoded).not.toMatch(/[^\x00-\x7f]/u);
    expect((await parseScoreWorkspace(encoded)).origin.xml).toBe(xml);
    const draft=await projectScoreWorkspace(w),review=await deriveQuickReview(draft,V);
    expect(review.state.readyForPlanning,JSON.stringify(review.diagnostics)).toBe(true);
    const project=await createProjectFromQuickReview(draft,review);
    const roundtrip=await importHarmonyProject(await exportHarmonyProject(project));
    if(roundtrip.source.importInfo?.sourceKind!=="score-workspace")throw Error("provenance lost");
    expect((await parseScoreWorkspace(roundtrip.source.importInfo.workspaceMetadata.proof)).origin.xml).toBe(xml);
  });
});
