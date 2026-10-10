import { semanticDigest } from "../../domain/digest/canonical";
import type { QuickHarmonyChoice, QuickHarmonyPreparation, QuickHarmonyResult, QuickHarmonyPartResult } from "../../product/quick-harmony";
import { generateQuickHarmony } from "../../product/quick-harmony";
import { IndexedDbProjectStore } from "../../product/local-project-store";
const recentParts = new Map<string, readonly QuickHarmonyPartResult[]>();
export function generatedParts(projectId: string) { return recentParts.get(projectId); }
export async function quickProjectId(preparation: QuickHarmonyPreparation, choice: QuickHarmonyChoice) {
  if (!preparation.workspace) throw new Error("QUICK_WORKSPACE_UNAVAILABLE");
  const parts = Array.isArray(choice.parts) ? [...new Set(choice.parts)].sort() : [preparation.summary?.recommendedPart ?? "alto"];
  return `quick-${await semanticDigest({ workspaceDigest: preparation.workspace.digest, parts, confirmedAt: choice.confirmedAt, answers: choice.answers ?? {} })}`;
}
export async function generateAndSave(preparation: QuickHarmonyPreparation, choice: QuickHarmonyChoice, dependencies: {
  store?: Pick<IndexedDbProjectStore, "load" | "saveNew">;
  generate?: typeof generateQuickHarmony;
  isCurrent?: () => boolean;
} = {}): Promise<{ status: "saved"; projectId: string } | { status: "cancelled" } | { status: "returned"; result: QuickHarmonyResult }> {
  const store = dependencies.store ?? new IndexedDbProjectStore();
  const isCurrent = dependencies.isCurrent ?? (() => true);
  const projectId = await quickProjectId(preparation, choice);
  if (!isCurrent()) return { status: "cancelled" };
  const existing = await store.load(projectId);
  if (!isCurrent()) return { status: "cancelled" };
  if (existing) return { status: "saved", projectId };
  const result = await (dependencies.generate ?? generateQuickHarmony)(preparation, choice);
  if (!isCurrent()) return { status: "cancelled" };
  if (result.status !== "complete" && result.status !== "partial") return { status: "returned", result };
  try { await store.saveNew({ projectId, updatedAt: choice.confirmedAt, project: result.project }); }
  catch (error) {
    // Another tab may have committed this exact selection. Never replace it.
    if (!(await store.load(projectId))) throw error;
  }
  if (!isCurrent()) return { status: "cancelled" };
  if (recentParts.size >= 10) recentParts.delete(recentParts.keys().next().value!);
  recentParts.set(projectId, result.parts);
  return { status: "saved", projectId };
}
