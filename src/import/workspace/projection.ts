import { canonicalJson, semanticDigest } from "../../domain/digest/canonical";
import type { SongSourceDocument, WorkspaceProjectionMetadata } from "../../domain/source/model";
import { assessAutoDraft, autoDraftGeneratable, autoDraftSummary, parseAutoDraftMarker, serializeAutoDraftOptions, type AutoDraftOptions } from "./auto-draft";
import type { MusicXmlImportDraft } from "../musicxml/types";
import { buildImportedSectionOccurrenceReviews } from "../review/occurrences";
import { clean } from "./edit";
import { captureWorkspace, exportScoreWorkspace, parseImmutableScoreWorkspace, parseScoreWorkspace, replayScoreWorkspace, verifiedWorkspaceEvidenceDigest, readVerifiedWorkspace } from "./journal";
import { deriveWorkspaceCapabilities, effectiveWorkspaceKey, selectedWorkspacePart } from "./review";
import type { ScoreWorkspace } from "./model";

export function projectedDraftIdentity(draft:MusicXmlImportDraft):string {
  const {workspaceProof: omitted,...rest}=draft;void omitted;
  return canonicalJson(clean(rest));
}
/** Selection changes the engine projection, never the preserved workspace parts. */
export async function projectScoreWorkspace(value:ScoreWorkspace):Promise<MusicXmlImportDraft> {
  // Capture caller-owned metadata before the first await. A generated draft may
  // reuse its checked projection only while the complete input stays identical.
  const captured=captureWorkspace(value);
  const {state,evidenceDigest}=await readVerifiedWorkspace(value);
  const capabilities=await deriveWorkspaceCapabilities(state,evidenceDigest);
  if(!capabilities.arrange||!state.music) throw new RangeError(`WORKSPACE_NOT_READY:${capabilities.blockers.map(b=>b.id).join(",")}`);
  return finishProjection(value,captured,state);
}
/** Automatic practice draft: same projection, with the request built by the
 * auto-draft contract and its marker sealed in the draft identity. Refuses
 * anything but ready/ready-with-warnings; never writes or needs attestations. */
export async function projectAutoDraftWorkspace(value:ScoreWorkspace,options:AutoDraftOptions={}):Promise<MusicXmlImportDraft> {
  const captured=captureWorkspace(value),marker=serializeAutoDraftOptions(options);
  const assessment=await assessAutoDraft(value,options);
  if(!autoDraftGeneratable(assessment)||!assessment.request) throw new RangeError(`AUTO_DRAFT_NOT_READY:${assessment.status}:${assessment.findings.filter(f=>f.category!=="warning").map(f=>f.code).join(",")}`);
  const {state}=await readVerifiedWorkspace(value);
  return finishProjection(value,captured,{...state,request:assessment.request},marker);
}
async function finishProjection(value:ScoreWorkspace,captured:string,state:Awaited<ReturnType<typeof readVerifiedWorkspace>>["state"],autoDraft?:string):Promise<MusicXmlImportDraft> {
  const originKind=value.origin.kind,performanceVersion=value.algorithmVersions.performanceExpanderVersion;
  if(!state.music)throw new RangeError("WORKSPACE_NOT_READY:uninterpreted");
  const music=state.music,part=selectedWorkspacePart(state)!,req=state.request;
  const selected=new Set([req.lead!,...req.rhythmVoices]);
  const parts=music.parts.map(p=>({...p,measures:p.measures.map(m=>({
    ...m, key:effectiveWorkspaceKey(state,m.workspaceMeasureId!),
    leadEvents:m.leadEvents.filter(e=>p.partOrdinal===part.partOrdinal&&selected.has(e.candidateKey)),
    unresolvedEvents:[],chords:m.chords.map(c=>({...c,confirmation:"confirmed" as const})),
  }))}));
  const occurrences=buildImportedSectionOccurrenceReviews(parts,music.leadCandidates,req.sections,performanceVersion)
    .map(o=>req.lyricVerses[o.key]===undefined?o:{...o,selectedLyricVerse:req.lyricVerses[o.key]});
  const draft:MusicXmlImportDraft={...clean({...music,workspaceInspectionOnly:undefined,
    // Keep the OMR requirement visible; finalization validates the complete new
    // proof rather than relabeling this candidate as a direct XML import.
    localCandidateReviewRequired:originKind!=="musicxml"?true:music.localCandidateReviewRequired,
    recoveryProof:undefined,parts,selectedLeadStaffKey:req.lead,sections:req.sections,sectionOccurrences:occurrences,
    defaultKey:effectiveWorkspaceKey(state,part.measures[0].workspaceMeasureId!),defaultTempo:req.tempo,
    singerCount:req.singerCount,performerSlots:req.performers,rights:req.rights,
    chordResolutionPolicy:req.initialPickup ? { gapPolicy: "carry-until-next", initialPickup: req.initialPickup } : undefined,
    // These imported diagnostics have become derived conditions; all static,
    // uninterpreted diagnostics were gated above, not downgraded to warnings.
    diagnostics:music.diagnostics.filter(d=>!["workspace-overfull","invalid-pitch"].includes(String(d.details?.issue))&&d.code!=="UNSUPPORTED_MODULATION"),
    ...(autoDraft?{workspaceAutoDraft:autoDraft}:{}),
  }),workspaceProof:await exportScoreWorkspace(value)};
  if(captureWorkspace(value)!==captured)throw new RangeError("WORKSPACE_MUTATED_DURING_PROJECTION");
  verified.set(draft,{identity:projectedDraftIdentity(draft),proof:draft.workspaceProof!});
  return draft;
}
// Proof is an immutable string, separate from the musical projection identity.
// Do not clone/escape its megabytes merely to compare the small draft again,
// and never retain a mutable workspace returned to another caller.
const verified=new WeakMap<MusicXmlImportDraft,{identity:string;proof:string}>();
async function validateProjection(draft:MusicXmlImportDraft,immutable:boolean):Promise<ScoreWorkspace> {
  const proof=draft.workspaceProof;
  if(typeof proof!=="string"||!proof||proof.length>64_000_000)throw new RangeError("WORKSPACE_PROJECTION_PROOF_REQUIRED");
  const identity=projectedDraftIdentity(draft),hit=verified.get(draft);
  const workspace=await (immutable?parseImmutableScoreWorkspace:parseScoreWorkspace)(proof);
  if(hit?.proof!==proof||hit.identity!==identity) {
    const expected=draft.workspaceAutoDraft!==undefined
      ? await projectAutoDraftWorkspace(workspace,parseAutoDraftMarker(draft.workspaceAutoDraft))
      : await projectScoreWorkspace(workspace);
    if(identity!==projectedDraftIdentity(expected))throw new RangeError("WORKSPACE_PROJECTION_SUBSTITUTED");
  }
  if(draft.workspaceProof!==proof||projectedDraftIdentity(draft)!==identity)throw new RangeError("WORKSPACE_PROJECTION_MUTATED_DURING_VALIDATION");
  verified.set(draft,{identity,proof});return workspace;
}
/** Preserve the detached mutable result expected by existing callers. */
export function validateProjectedWorkspaceDraft(draft:MusicXmlImportDraft):Promise<ScoreWorkspace> {
  return validateProjection(draft,false);
}
/** Finalization only needs validation; it does not edit a returned workspace. */
export async function assertProjectedWorkspaceDraft(draft:MusicXmlImportDraft):Promise<void> {
  await validateProjection(draft,true);
}

export async function workspaceProjectionMetadata(draft:MusicXmlImportDraft,source:SongSourceDocument):Promise<WorkspaceProjectionMetadata> {
  const workspace=await validateProjection(draft,true),replayed=await replayScoreWorkspace(workspace);
  const autoOptions=draft.workspaceAutoDraft!==undefined?parseAutoDraftMarker(draft.workspaceAutoDraft):undefined;
  const assessment=autoOptions?await assessAutoDraft(workspace,autoOptions):undefined;
  const state=assessment?{...replayed,request:assessment.request!}:replayed,part=selectedWorkspacePart(state)!;
  const selected=[state.request.lead!,...state.request.rhythmVoices];
  const targetMap:{workspaceId:string;sourceId:string;kind:"measure"|"event"|"chord"}[]=[];
  // Match exact musical identity, not XML serialization position. Generated
  // Source IDs remain the existing canonical IDs; editing IDs stay stable.
  for(const [index,m]of source.sourceMeasures.entries()) {
    const original=part.measures[index];targetMap.push({workspaceId:original.workspaceMeasureId!,sourceId:m.id,kind:"measure"});
    for(const e of [...m.leadEvents,...(m.rhythmVoices?.flatMap(v=>v.events)??[])]) {
      const candidates=original.leadEvents.filter(x=>selected.includes(x.candidateKey)&&x.kind===e.kind
        &&canonicalJson(x.onset)===canonicalJson(e.onset)&&canonicalJson(x.duration)===canonicalJson(e.duration)
        &&(x.kind!=="note"||e.kind!=="note"||canonicalJson(x.pitch)===canonicalJson(e.pitch)));
      const lead=m.leadEvents.some(x=>x.id===e.id);
      const rhythm=m.rhythmVoices?.find(v=>v.events.some(x=>x.id===e.id));
      const voiceKey=lead?state.request.lead:state.music!.leadCandidates[(rhythm?.voice??0)-1]?.key;
      const match=candidates.filter(x=>x.candidateKey===voiceKey);
      if(match.length!==1||!match[0].workspaceEventId)throw new RangeError("WORKSPACE_TARGET_MAPPING_AMBIGUOUS");
      targetMap.push({workspaceId:match[0].workspaceEventId,sourceId:e.id,kind:"event"});
    }
    const chordPart=part.measures.some(m=>m.chords.length)?part:state.music!.parts.find(p=>p.measures.some(x=>x.chords.length))??part;
    for(const c of m.chordEvents) {
      const matches=chordPart.measures[index].chords.filter(x=>canonicalJson(x.onset)===canonicalJson(c.onset)&&canonicalJson(x.parseResult)===canonicalJson(c.parseResult));
      if(matches.length!==1)throw new RangeError("WORKSPACE_CHORD_MAPPING_AMBIGUOUS");
      targetMap.push({workspaceId:matches[0].key,sourceId:c.id,kind:"chord"});
    }
  }
  const expectedEvents=part.measures.flatMap(m=>m.leadEvents.filter(e=>selected.includes(e.candidateKey)).map(e=>e.workspaceEventId!)).sort();
  const actualEvents=targetMap.filter(t=>t.kind==="event").map(t=>t.workspaceId).sort();
  if(canonicalJson(expectedEvents)!==canonicalJson(actualEvents))throw new RangeError("WORKSPACE_TARGET_MAPPING_INCOMPLETE");
  return {version:assessment?"hm-workspace-auto-draft-v1" as const:"hm-workspace-projection-v1" as const,originKind:workspace.origin.kind,workspaceId:workspace.id,workspaceRevision:workspace.revision,
    workspaceDigest:workspace.digest,evidenceDigest:await verifiedWorkspaceEvidenceDigest(workspace),requestDigest:await semanticDigest(clean(state.request)),
    initialSourceDigest:source.revisionDigest,selectedVoices:selected,excludedVoices:state.music!.leadCandidates.map(c=>c.key).filter(k=>!selected.includes(k)),
    targetMap,proof:draft.workspaceProof!,...(assessment?{autoDraft:{marker:draft.workspaceAutoDraft!,...autoDraftSummary(assessment)}}:{})};
}
