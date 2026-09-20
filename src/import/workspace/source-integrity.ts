import { canonicalJson } from "../../domain/digest/canonical";
import type { SongSourceDocument } from "../../domain/source/model";
import { normalizeImportedSource } from "../review/finalize";
import { parseScoreWorkspace, replayScoreWorkspace } from "./journal";
import type { ChordResolutionPolicy } from "../../domain/harmony/chord-timeline";
import { projectScoreWorkspace, workspaceProjectionMetadata } from "./projection";
const verifiedPolicies = new WeakMap<SongSourceDocument, { proof: string; initialPickup?: string }>();

/** The project must use the arrangement choice sealed in its workspace request. */
export async function workspaceSourceChordPolicyMatches(source: SongSourceDocument, policy: ChordResolutionPolicy): Promise<boolean> {
  if (source.importInfo?.sourceKind !== "score-workspace") return true;
  const proof = source.importInfo.workspaceMetadata.proof;
  let cached = verifiedPolicies.get(source);
  if (!cached || cached.proof !== proof) {
    if (!await validateWorkspaceSourceIntegrity(source)) return false;
    cached = verifiedPolicies.get(source);
  }
  return cached !== undefined && cached.initialPickup === policy.initialPickup
    && (!cached.initialPickup || policy.gapPolicy === "carry-until-next");
}

/** Verifies the new local provenance separately from the provider OMR contract. */
export async function validateWorkspaceSourceIntegrity(source:SongSourceDocument):Promise<boolean> {
  if(source.importInfo?.sourceKind!=="score-workspace")return true;
  try {
    // v1 sources are immutable input snapshots. Existing generated-output edits
    // remain available; source revisions must return to the persistent workspace.
    if(source.revisionOrdinal!==0)return false;
    const metadata=source.importInfo.workspaceMetadata;
    const workspace=await parseScoreWorkspace(metadata.proof),draft=await projectScoreWorkspace(workspace);
    if(source.documentId!==workspace.id||source.importInfo.rawDigest!==workspace.origin.xmlDigest)return false;
    const normalized=await normalizeImportedSource(draft,workspace.algorithmVersions);
    if(normalized.status!=="complete"||normalized.normalization.musicalSourceDigest!==source.revisionDigest)return false;
    // The WAG semantic digest deliberately omits display lyric text. The
    // immutable workspace contract must still preserve that text and every
    // normalized event, including notation that does not change WAG pitches.
    if(canonicalJson(normalized.normalization.sourceMeasures)!==canonicalJson(source.sourceMeasures))return false;
    for(const field of ["performanceSequence","sectionDefinitions","sectionOccurrences","phraseRegions"] as const)
      if(canonicalJson(normalized.normalization[field])!==canonicalJson(source[field]))return false;
    const expected=await workspaceProjectionMetadata(draft,source);
    // The complete proof was parsed/replayed above. Compare its exact immutable
    // bytes, without re-escaping the large string twice inside the binding.
    const {proof:expectedProof,...expectedBinding}=expected,{proof:actualProof,...actualBinding}=metadata;
    const valid=expectedProof===actualProof&&canonicalJson(expectedBinding)===canonicalJson(actualBinding)&&canonicalJson(source.title)===canonicalJson(draft.title)
      && canonicalJson(source.composer??null)===canonicalJson(draft.composer??null) && source.importInfo.importerVersion==="hm-workspace-projection-v1"
      && canonicalJson(source.importInfo.originalFileName??null)===canonicalJson(draft.originalFileName??null)
      && canonicalJson(source.rights)===canonicalJson({...draft.rights!,allowedUses:[...draft.rights!.allowedUses].sort()});
    if(valid)verifiedPolicies.set(source,{proof:metadata.proof,initialPickup:(await replayScoreWorkspace(workspace)).request.initialPickup});
    return valid;
  } catch {return false;}
}
