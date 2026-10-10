import { createScoreWorkspace, applyWorkspaceCommand } from "../../import/workspace/journal";
import { ScoreWorkspaceStore } from "../../import/workspace/store";
import type { ScoreWorkspace } from "../../import/workspace/model";
/** Save a separate editable copy through the public journal/storage API. Never mutate quick:<digest>. */
export async function saveEditableWorkspace(workspace: ScoreWorkspace): Promise<string> {
  const id = crypto.randomUUID();
  let copy = await createScoreWorkspace(workspace.origin, workspace.algorithmVersions, id);
  for (const operation of workspace.operations) {
    copy = await applyWorkspaceCommand(copy, copy, operation.command, { id: operation.id, note: operation.note, actor: operation.actor, at: operation.at });
  }
  await new ScoreWorkspaceStore().save({ workspace: copy, storageRevision: 0, updatedAt: new Date().toISOString() });
  return id;
}
