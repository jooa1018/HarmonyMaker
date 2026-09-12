import { canonicalJson } from "../../domain/digest/canonical";
import type { SongSourceDocument } from "../../domain/source/model";
import { normalizeImportedSource } from "../review/finalize";
import { parseScoreWorkspace } from "./journal";
import { projectScoreWorkspace, workspaceProjectionMetadata } from "./projection";

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
    const expected=await workspaceProjectionMetadata(draft,source);
    return canonicalJson(expected)===canonicalJson(metadata)&&canonicalJson(source.title)===canonicalJson(draft.title)
      && canonicalJson(source.composer??null)===canonicalJson(draft.composer??null) && source.importInfo.importerVersion==="hm-workspace-projection-v1"
      && canonicalJson(source.importInfo.originalFileName??null)===canonicalJson(draft.originalFileName??null)
      && canonicalJson(source.rights)===canonicalJson({...draft.rights!,allowedUses:[...draft.rights!.allowedUses].sort()});
  } catch {return false;}
}
