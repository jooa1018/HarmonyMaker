import { canonicalJson, semanticDigest } from "../../domain/digest/canonical";
import type { SongSourceDocument } from "../../domain/source/model";
import type { MusicXmlImportDraft } from "../musicxml/types";
import { buildImportedSectionOccurrenceReviews } from "../review/occurrences";
import { clean } from "./edit";
import { exportScoreWorkspace, parseScoreWorkspace, replayScoreWorkspace, verifiedWorkspaceEvidenceDigest, readVerifiedWorkspace } from "./journal";
import { deriveWorkspaceCapabilities, effectiveWorkspaceKey, selectedWorkspacePart } from "./review";
import type { ScoreWorkspace } from "./model";

export function projectedDraftIdentity(draft:MusicXmlImportDraft):string {
  const {workspaceProof: omitted,...rest}=draft;void omitted;
  return canonicalJson(clean(rest));
}
/** Selection changes the engine projection, never the preserved workspace parts. */
export async function projectScoreWorkspace(value:ScoreWorkspace):Promise<MusicXmlImportDraft> {
  const {state,evidenceDigest}=await readVerifiedWorkspace(value);
  const capabilities=await deriveWorkspaceCapabilities(state,evidenceDigest);
  if(!capabilities.arrange||!state.music) throw new RangeError(`WORKSPACE_NOT_READY:${capabilities.blockers.map(b=>b.id).join(",")}`);
  const part=selectedWorkspacePart(state)!,req=state.request;
  const selected=new Set([req.lead!,...req.rhythmVoices]);
  const parts=state.music.parts.map(p=>({...p,measures:p.measures.map(m=>({
    ...m, key:effectiveWorkspaceKey(state,m.workspaceMeasureId!),
    leadEvents:m.leadEvents.filter(e=>p.partOrdinal===part.partOrdinal&&selected.has(e.candidateKey)),
    unresolvedEvents:[],chords:m.chords.map(c=>({...c,confirmation:"confirmed" as const})),
  }))}));
  const occurrences=buildImportedSectionOccurrenceReviews(parts,state.music.leadCandidates,req.sections,value.algorithmVersions.performanceExpanderVersion)
    .map(o=>req.lyricVerses[o.key]===undefined?o:{...o,selectedLyricVerse:req.lyricVerses[o.key]});
  const draft:MusicXmlImportDraft=clean({...state.music,workspaceInspectionOnly:undefined,
    // Keep the OMR requirement visible; finalization validates the complete new
    // proof rather than relabeling this candidate as a direct XML import.
    localCandidateReviewRequired:value.origin.kind!=="musicxml"?true:state.music.localCandidateReviewRequired,
    recoveryProof:undefined,parts,selectedLeadStaffKey:req.lead,sections:req.sections,sectionOccurrences:occurrences,
    defaultKey:effectiveWorkspaceKey(state,part.measures[0].workspaceMeasureId!),defaultTempo:req.tempo,
    singerCount:req.singerCount,performerSlots:req.performers,rights:req.rights,
    chordResolutionPolicy:req.initialPickup ? { gapPolicy: "carry-until-next", initialPickup: req.initialPickup } : undefined,
    // These imported diagnostics have become derived conditions; all static,
    // uninterpreted diagnostics were gated above, not downgraded to warnings.
    diagnostics:state.music.diagnostics.filter(d=>!["workspace-overfull","invalid-pitch"].includes(String(d.details?.issue))&&d.code!=="UNSUPPORTED_MODULATION"),
    workspaceProof:await exportScoreWorkspace(value),
  });
  return draft;
}
const verified=new WeakMap<MusicXmlImportDraft,{serialized:string;workspace:ScoreWorkspace}>();
export async function validateProjectedWorkspaceDraft(draft:MusicXmlImportDraft):Promise<ScoreWorkspace> {
  if(!draft.workspaceProof||draft.workspaceProof.length>64_000_000)throw new RangeError("WORKSPACE_PROJECTION_PROOF_REQUIRED");
  const serialized=canonicalJson(clean(draft));const hit=verified.get(draft);if(hit?.serialized===serialized)return hit.workspace;
  const workspace=await parseScoreWorkspace(draft.workspaceProof),expected=await projectScoreWorkspace(workspace);
  if(projectedDraftIdentity(draft)!==projectedDraftIdentity(expected))throw new RangeError("WORKSPACE_PROJECTION_SUBSTITUTED");
  verified.set(draft,{serialized,workspace});return workspace;
}

export async function workspaceProjectionMetadata(draft:MusicXmlImportDraft,source:SongSourceDocument) {
  const workspace=await validateProjectedWorkspaceDraft(draft),state=await replayScoreWorkspace(workspace),part=selectedWorkspacePart(state)!;
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
  return {version:"hm-workspace-projection-v1" as const,originKind:workspace.origin.kind,workspaceId:workspace.id,workspaceRevision:workspace.revision,
    workspaceDigest:workspace.digest,evidenceDigest:await verifiedWorkspaceEvidenceDigest(workspace),requestDigest:await semanticDigest(clean(state.request)),
    initialSourceDigest:source.revisionDigest,selectedVoices:selected,excludedVoices:state.music!.leadCandidates.map(c=>c.key).filter(k=>!selected.includes(k)),
    targetMap,proof:draft.workspaceProof!};
}
