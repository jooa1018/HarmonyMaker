import type { LocalProjectRecord } from "../../product/local-project-store";
import { confirmShareRights, materializePracticeShare } from "../../product/practice-share";
import { materializeActiveArrangement } from "../../product/render";
import { encodeProductUrlShare, urlShareFits } from "../../product/share-url";
import { allowShareCreateFreshIntent, bindShareCreateSession, completeShareCreateRecovery, IndexedDbShareCreateRecoveryStore, prepareShareCreateRecovery, type ShareCreateRecoveryStore } from "../../product/share-create-recovery";
import { completedShareRecoveryTransport, dispatchShareCreateReadOnlyRecovery, dispatchShareCreateRecovery, dispatchShareOwnerReconciliation, pendingShareRecoveryTransport } from "../../product/share-create-api";

export type CreatedLink = { status: "created"; url: string; stored: boolean; expiresAt?: string };
export type CreateLinkOutcome = CreatedLink | { status: "retry" | "fresh"; code: string };
export async function createResultShare(record: LocalProjectRecord, explicitFreshIntent: boolean, dependencies: {
  origin: string;
  fetcher?: typeof fetch;
  recoveryStore?: ShareCreateRecoveryStore;
  fits?: typeof urlShareFits;
}): Promise<CreateLinkOutcome> {
  const source = record.project;
  const workspace = source.source.importInfo?.sourceKind === "score-workspace";
  const project = workspace ? source : confirmShareRights(source, new Date().toISOString());
  const presetId = project.selectedPresetId ?? "standard";
  const payload = materializePracticeShare({ project, presetId, materialized: materializeActiveArrangement(project, presetId), playbackDefaults: { speedPercent: 100, accompanimentEnabled: true }, ...(workspace ? { workspaceShareConfirmedForThisExport: true as const } : {}) });
  const encoded = encodeProductUrlShare(payload);
  if ((dependencies.fits ?? urlShareFits)(encoded)) return { status: "created", stored: false, url: `${dependencies.origin}/share#p=${encoded}` };
  const store = dependencies.recoveryStore ?? new IndexedDbShareCreateRecoveryStore();
  const fetcher = dependencies.fetcher ?? fetch;
  let envelope = await prepareShareCreateRecovery({ store, projectId: record.projectId, canonicalRequest: { payload, rightsBasis: project.source.rights.basis }, explicitFreshIntent, generateId: () => crypto.randomUUID(), now: new Date() });
  const response = await fetcher("/api/session", { method: "POST" });
  const session = await response.json() as { csrfToken?: string; sessionAuthority?: string; expiresAt?: string };
  if (!response.ok || !session.csrfToken || !session.sessionAuthority || !session.expiresAt) throw new Error("SHARE_SESSION_UNAVAILABLE");
  if (completedShareRecoveryTransport(envelope, session.sessionAuthority) === "owner-reconcile") {
    const outcome = await dispatchShareOwnerReconciliation({ envelope, fetcher });
    if (outcome.kind === "active" && envelope.createdResponse) return { status: "created", stored: true, url: `${dependencies.origin}/share?token=${encodeURIComponent(envelope.createdResponse.token)}` };
    if (outcome.kind === "fresh-allowed") {
      await allowShareCreateFreshIntent({ store, envelope, reason: outcome.reason === "owner-deleted" ? "owner-deleted" : "retired-replay", now: new Date() });
      return { status: "fresh", code: outcome.code };
    }
    return { status: "retry", code: "code" in outcome ? outcome.code : "SHARE_RECONCILE_UNCERTAIN" };
  }
  // Read presentation-only expiry without changing the durable recovery schema.
  let expiresAt: string | undefined;
  const withExpiry: typeof fetch = async (input, init) => {
    const result = await fetcher(input, init);
    if (result.ok) {
      try { const body = await result.clone().json(); if (typeof body.share?.expiresAt === "string" && Number.isFinite(Date.parse(body.share.expiresAt))) expiresAt = body.share.expiresAt; } catch { /* The public API classifier handles uncertain responses. */ }
    }
    return result;
  };
  const crossSession = pendingShareRecoveryTransport(envelope, session.sessionAuthority) === "cross-session-recovery";
  if (!crossSession) envelope = await bindShareCreateSession({ store, envelope, sessionAuthority: session.sessionAuthority, sessionExpiresAt: session.expiresAt, now: new Date() });
  const outcome = await (crossSession ? dispatchShareCreateReadOnlyRecovery : dispatchShareCreateRecovery)({ envelope, csrfToken: session.csrfToken, fetcher: withExpiry });
  if (outcome.kind === "completed") {
    await completeShareCreateRecovery({ store, envelope, response: outcome.response, now: new Date() });
    return { status: "created", stored: true, url: `${dependencies.origin}/share?token=${encodeURIComponent(outcome.response.token)}`, ...(expiresAt ? { expiresAt } : {}) };
  }
  if (outcome.kind === "fresh-allowed") {
    await allowShareCreateFreshIntent({ store, envelope, reason: outcome.code === "SHARE_CREATE_DETERMINISTIC_NO_EFFECT" ? "deterministic-no-effect" : "retired-replay", now: new Date() });
    return { status: "fresh", code: outcome.code };
  }
  return { status: "retry", code: outcome.code };
}
