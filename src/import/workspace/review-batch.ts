import { applyWorkspaceCommands, replayScoreWorkspace } from "./journal";
import { workspaceEvidenceDigest } from "./input";
import { deriveWorkspaceCapabilities } from "./review";
import type { ScoreWorkspace, WorkspaceOperation } from "./model";

/** Explicit UI-selected facts, using the existing per-issue attestation contract.
 * The caller persists only the returned workspace, so a failed item saves none.
 * Original raw issues/scopes are preserved; versioned dependencies are derived
 * by journal replay, never supplied or approved by this batch helper. */
export async function attestWorkspaceIssues(
  workspace: ScoreWorkspace, expected: { revision: number; digest: string }, issueIds: readonly string[],
  meta: Pick<WorkspaceOperation, "id" | "note" | "actor" | "at">,
): Promise<ScoreWorkspace> {
  if (workspace.revision !== expected.revision || workspace.digest !== expected.digest) throw new RangeError("WORKSPACE_STALE_REVISION");
  if (!Array.isArray(issueIds) || !issueIds.length || issueIds.length > 128 || new Set(issueIds).size !== issueIds.length
    || typeof meta.note !== "string" || meta.note.trim().length < 8) throw new RangeError("WORKSPACE_REVIEW_SELECTION_INVALID");
  const state = await replayScoreWorkspace(workspace), evidence = await workspaceEvidenceDigest(workspace.origin);
  const pending = new Set((await deriveWorkspaceCapabilities(state,evidence)).pendingIssues.map(issue=>issue.id));
  const issues = issueIds.map(id => state.issues.find(issue => issue.id === id));
  for (const issue of issues) if (!issue || issue.requiredAction !== "compare" || !pending.has(issue.id)) {
    throw new RangeError("WORKSPACE_REVIEW_SELECTION_INVALID");
  }
  return applyWorkspaceCommands(workspace,expected,issues.map((issue,index)=>({
    command:{kind:"attest",purpose:"issue",issueId:issue!.id,scope:issue!.scope},
    meta:{...meta,id:`${meta.id}:${index}`,note:`${issue!.id} · ${issue!.evidenceRef} · ${meta.note}`},
  })));
}
