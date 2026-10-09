import { canonicalJson } from "../../domain/digest/canonical";
import type { SongSourceDocument } from "../../domain/source/model";
import { normalizeImportedSource } from "../review/finalize";
import { parseImmutableScoreWorkspace, replayScoreWorkspace } from "./journal";
import type { ChordResolutionPolicy } from "../../domain/harmony/chord-timeline";
import { replayAutoDraftWorkspace, projectScoreWorkspace, workspaceProjectionMetadata } from "./projection";
import type { PerformerProfile } from "../../domain/performer";
const verifiedPolicies = new WeakMap<SongSourceDocument, { proof: string; initialPickup?: string; performers: string }>();

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
    const auto=metadata.version==="hm-workspace-auto-draft-v1";
    if(auto!==(source.importInfo.importerVersion==="hm-workspace-auto-draft-v1"))return false;
    const workspace=await parseImmutableScoreWorkspace(metadata.proof);
    const draft=auto?await replayAutoDraftWorkspace(workspace,metadata.autoDraft!.marker):await projectScoreWorkspace(workspace);
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
      && canonicalJson(source.composer??null)===canonicalJson(draft.composer??null)
      && canonicalJson(source.importInfo.originalFileName??null)===canonicalJson(draft.originalFileName??null)
      && canonicalJson(source.rights)===canonicalJson({...draft.rights!,allowedUses:[...draft.rights!.allowedUses].sort()});
    // The arrangement choices come from the same request that produced the
    // projection: the sealed workspace request, or the auto-draft request.
    if(valid)verifiedPolicies.set(source,{proof:metadata.proof,initialPickup:auto?draft.chordResolutionPolicy?.initialPickup:(await replayScoreWorkspace(workspace)).request.initialPickup,
      performers:canonicalJson(draft.performerSlots.slice(0,draft.singerCount).map(slot=>slot.profile??null))});
    return valid;
  } catch {return false;}
}

/** Automatic drafts bind the project performers (source-Lead span + part
 * preset) to the sealed auto-draft request; they cannot be edited silently. */
export async function workspaceSourcePerformersMatch(source: SongSourceDocument, performers: readonly PerformerProfile[]): Promise<boolean> {
  if (source.importInfo?.sourceKind !== "score-workspace" || source.importInfo.workspaceMetadata.version !== "hm-workspace-auto-draft-v1") return true;
  const proof = source.importInfo.workspaceMetadata.proof;
  let cached = verifiedPolicies.get(source);
  if (!cached || cached.proof !== proof) {
    if (!await validateWorkspaceSourceIntegrity(source)) return false;
    cached = verifiedPolicies.get(source);
  }
  return cached !== undefined && cached.performers === canonicalJson(performers);
}
