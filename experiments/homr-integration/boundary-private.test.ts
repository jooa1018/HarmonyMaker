import {readFile,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {describe,it,expect} from "vitest";
import {IDBFactory} from "fake-indexeddb";
import {APPLICATION_ALGORITHM_VERSION_REGISTRY as V} from "../../src/app/algorithm-version-registry";
import {canonicalJson} from "../../src/domain/digest/canonical";
import {compareFractions,addFractions,fraction} from "../../src/domain/fraction";
import {pitchMidiNumber,type SpelledPitch} from "../../src/domain/pitch";
import {originFromLocalCandidate,originFromLegacyBundle,workspaceEvidenceDigest} from "../../src/import/workspace/input";
import {createScoreWorkspace,parseScoreWorkspace,exportScoreWorkspace,replayScoreWorkspace} from "../../src/import/workspace/journal";
import {deriveWorkspaceCapabilities} from "../../src/import/workspace/review";
import {ScoreWorkspaceStore} from "../../src/import/workspace/store";
import {importMusicXml} from "../../src/import/musicxml/parser-core";
import {importHarmonyProject,exportHarmonyProject} from "../../src/product/project-transfer";
import {materializeActiveArrangement} from "../../src/product/render";
import {buildPlaybackPlan,quarterSeconds} from "../../src/product/playback-plan";
import {canonicalRangeDuration} from "../../src/product/timing";
import {replayStructuralRecovery} from "../../src/import/review/structural-recovery";

const root=process.env.HM_BOUNDARY_PRIVATE,input=process.env.HM_BOUNDARY_INPUT,legacy=process.env.HM_BOUNDARY_LEGACY;
const E=new TextEncoder();const read=(path:string)=>readFile(path,"utf8");
const pitch=(p:SpelledPitch)=>`${p.step}${p.alter===1?"#":p.alter===-1?"b":""}${p.octave}`;
const q=(f:{n:number;d:number})=>f.d===1?String(f.n):`${f.n}/${f.d}`;

describe.skipIf(!root||!input||!legacy)("actual preserved boundary evidence (opt-in, never committed)",()=>{
  it("compares UI-exported A to direct original-image observations, Source, render, playback and MusicXML contents",async()=>{
    const w=await parseScoreWorkspace(await read(join(root!,"a-corrected.workspace.json"))),s=await replayScoreWorkspace(w);
    const original=JSON.parse(await read(join(input!,"independent-a.review.json")));
    expect(w.origin.localCandidate).toEqual(original);expect(w.operations.filter(o=>o.command.kind==="note")).toHaveLength(0);
    expect(w.operations.filter(o=>["chord","fermata"].includes(o.command.kind))).toHaveLength(2);
    const project=await importHarmonyProject(await read(join(root!,"a-project.harmonymaker.json")));
    expect(await exportHarmonyProject(project)).toBe(await read(join(root!,"a-project-reloaded.harmonymaker.json")));
    const source=project.source,observed=JSON.parse(await read(join(root!,"a-original-observation.json")));
    expect(source.importInfo?.sourceKind).toBe("score-workspace");
    expect(source.defaultKey).toEqual({tonic:{step:"D",alter:0},mode:"minor"});expect(source.defaultTempo).toEqual(observed.tempo);
    expect(source.sourceMeasures.map(m=>[...m.leadEvents].sort((a,b)=>compareFractions(a.onset,b.onset)).map(e=>e.kind==="note"?`${pitch(e.pitch)}:${q(e.duration)}`:e.kind))).toEqual(observed.measures);
    for(const m of source.sourceMeasures){let cursor=fraction(0);for(const e of [...m.leadEvents].sort((a,b)=>compareFractions(a.onset,b.onset))){expect(e.onset).toEqual(cursor);cursor=addFractions(cursor,e.duration);}expect(cursor).toEqual(fraction(3));}
    expect(source.sourceMeasures.map(m=>m.chordEvents.map(c=>c.parseResult.status==="ok"?c.parseResult.chord.canonicalSymbol:c.parseResult.status))).toEqual(observed.chords.map((x:string)=>[x]));
    expect(s.music!.parts[0].measures.flatMap(m=>m.leadEvents).filter(e=>e.fermata)).toHaveLength(0);
    const materialized=materializeActiveArrangement(project,"standard"),plan=buildPlaybackPlan(materialized.document,materialized.trackRoles);
    expect(plan.totalQuarter).toBe(24);expect(plan.totalQuarter*quarterSeconds(source.defaultTempo,100)).toBe(16);
    const lead=plan.events.filter(e=>e.trackId==="track:source-lead");expect(lead).toHaveLength(30);
    expect(lead.map(e=>e.midi)).toEqual(source.sourceMeasures.flatMap(m=>[...m.leadEvents].sort((a,b)=>compareFractions(a.onset,b.onset)).flatMap(e=>e.kind==="note"?[pitchMidiNumber(e.pitch)]:[])));
    const text=await read(join(root!,"a-arrangement.musicxml")),parsed=await importMusicXml(E.encode(text),{algorithmVersions:V,identityFactory:()=>"export:verification"});
    expect(parsed.status).toBe("review-required");if(parsed.status!=="review-required")throw Error("export parse failed");
    expect(parsed.draft.parts[0].measures.map(m=>m.leadEvents.map(e=>e.kind==="note"?`${pitch(e.pitch)}:${q(e.duration)}`:e.kind))).toEqual(observed.measures);
    for(const [i,track]of materialized.document.generatedHarmonyTracks.entries()) {
      const fromXml=parsed.draft.parts[i+1].measures.flatMap(m=>m.leadEvents.filter(e=>e.kind==="note").map(e=>({m:m.ordinal,p:e.kind==="note"?pitch(e.pitch):"",onset:e.onset,duration:e.duration,tieStart:e.tieStart,tieStop:e.tieStop})));
      expect(fromXml).toEqual(track.events.filter(e=>e.kind==="note").map(e=>({m:e.range.start.performanceMeasureIndex,p:e.kind==="note"?pitch(e.pitch):"",onset:e.range.start.offset,duration:canonicalRangeDuration(materialized.document.measures,e.range),tieStart:e.kind==="note"&&e.tieStart,tieStop:e.kind==="note"&&e.tieStop})));
    }
    expect(text).toContain('harmonymaker-workspace-projection');expect(text).toContain('whole-score');expect(text).toContain('selectedVoices');expect(text).toContain('<mode>minor</mode>');expect(parsed.draft.defaultTempo).toEqual(source.defaultTempo);
    const report={notes:lead.length,chords:observed.chords,sourceRevisionDigest:source.revisionDigest,workspaceRevision:w.revision,workspaceDigest:w.digest,generatedTracks:materialized.document.generatedHarmonyTracks.length,generatedValidity:materialized.validity,totalQuarter:plan.totalQuarter,quarterBpm:90,durationSeconds:16,projectReloadCanonicalEqual:true,originalCandidateUnchanged:true,musicXmlLeadAndGeneratedEventsEqual:true};
    await writeFile(join(root!,"a-content-verification.json"),JSON.stringify(report,null,2));
  });
  it("stores and reloads JPEG/B/C while preserving their musical blockers and original eligibility",async()=>{
    const results=[];
    for(const name of ["user-jpeg","independent-b","holdout-c"]) {
      const bundle=JSON.parse(await read(join(input!,`${name}.review.json`))),w=await createScoreWorkspace(await originFromLocalCandidate(bundle,`${name}.review.json`),V,`private:${name}`);
      const s=await replayScoreWorkspace(w),caps=await deriveWorkspaceCapabilities(s,await workspaceEvidenceDigest(w.origin));
      expect(caps.saveDraft&&caps.view&&!caps.arrange).toBe(true);expect(s.attestations).toHaveLength(0);
      const store=new ScoreWorkspaceStore(new IDBFactory());await store.save({workspace:w,storageRevision:0,updatedAt:"2026-09-12T09:00:00Z"});const loaded=await store.load(w.id);
      expect(canonicalJson(await replayScoreWorkspace(loaded!.workspace))).toBe(canonicalJson(s));
      expect(loaded!.workspace.origin.localCandidate).toEqual(bundle);
      const ui=await parseScoreWorkspace(await read(join(root!,`${name}-ui.workspace.json`))),uiState=await replayScoreWorkspace(ui);
      expect(ui.origin.localCandidate).toEqual(bundle);expect(ui.operations).toHaveLength(0);expect(uiState.attestations).toHaveLength(0);
      const uiCaps=await deriveWorkspaceCapabilities(uiState,await workspaceEvidenceDigest(ui.origin));
      expect(uiCaps.blockers).toEqual(caps.blockers);
      if(name==="independent-b")expect(caps.blockers.some(b=>b.messageKo.includes("3/4"))).toBe(true);
      if(name==="user-jpeg")expect(caps.blockers.some(b=>b.id.startsWith("overfull:"))).toBe(true);
      results.push({name,saveReloadEqual:true,actualUiSavedReloadedExportEqual:true,originUnchanged:true,arrange:false,blockerCount:caps.blockers.length,blockers:caps.blockers,automaticLyricCandidates:s.music?.parts.flatMap(p=>p.measures.flatMap(m=>m.leadEvents)).reduce((n,e)=>n+(e.kind!=="rest"?e.lyrics.length:0),0),attestations:s.attestations.length});
    }
    await writeFile(join(root!,"preserved-case-verification.json"),JSON.stringify(results,null,2));
  });
  it("replays and converts the exact legacy 465-operation bundle without applying it to fresh A",async()=>{
    const text=await read(legacy!),old=JSON.parse(text);expect(old.workspace.operations).toHaveLength(465);
    const prior=await replayStructuralRecovery(old.workspace);
    const w=await createScoreWorkspace(await originFromLegacyBundle(text,"legacy.private.json"),V,"legacy:preserved"),s=await replayScoreWorkspace(w);
    expect(w.origin.legacyBundle).toBe(text);expect(w.operations).toHaveLength(0);expect(s.music?.parts[0].measures.map(m=>m.workspaceMeasureId)).toEqual(prior.measures.map(m=>m.id));
    expect(s.music!.parts[0].measures.flatMap(m=>m.leadEvents).map(e=>e.workspaceEventId).sort()).toEqual(prior.measures.flatMap(m=>m.notes.map(e=>e.id)).sort());
    const roundtrip=await parseScoreWorkspace(await exportScoreWorkspace(w));expect(roundtrip.origin.legacyBundle).toBe(text);
    await writeFile(join(root!,"legacy-conversion-verification.json"),JSON.stringify({legacyOperations:465,preservedOriginalDocuments:old.workspace.documents.length,measures:prior.measures.length,notes:prior.measures.reduce((n,m)=>n+m.notes.length,0),idsMatched:true,exactBundleRetained:true,newOperations:0},null,2));
  },180000);
});
