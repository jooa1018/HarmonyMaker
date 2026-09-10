"use client";
import { replayStructuralRecovery, structuralCandidateXml, validateStructuralRecovery } from "./structural-recovery";
import type { StoredStructuralRecovery } from "./structural-recovery-store";
import { saveStructuralRecovery } from "./structural-recovery-store";

export async function exportStructuralBundle(entry: StoredStructuralRecovery): Promise<string> {
  const state = await replayStructuralRecovery(entry.workspace), result = await validateStructuralRecovery(entry.workspace);
  const pages = await Promise.all(entry.pages.map(async (p) => {
    const dataUrl = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(r.error); r.readAsDataURL(p.blob); });
    return { pageIndex: p.pageIndex, rawDigest: p.rawDigest, canonicalPageDigest: p.canonicalPageDigest, mimeType: p.mimeType, dataUrl };
  }));
  return JSON.stringify({ version: "hm-structural-recovery-bundle-v1", workspace: entry.workspace, pages,
    candidate: { status: "unconfirmed-recovery-candidate", xml: structuralCandidateXml(state, entry.workspace.documents[0].recovery.originalXml), revisionDigest: result.digest, issues: result.issues, overfull: result.overfull } });
}
export async function importStructuralBundle(file: File): Promise<StoredStructuralRecovery> {
  if (file.size > 64_000_000) throw new RangeError("RECOVERY_BUNDLE_LIMIT");
  const value = JSON.parse(await file.text());
  if (value?.version !== "hm-structural-recovery-bundle-v1" || !Array.isArray(value.pages) || !value.pages.length || value.pages.length > 12) throw new RangeError("RECOVERY_BUNDLE_INVALID");
  await replayStructuralRecovery(value.workspace);
  const pages = value.pages.map((p: { pageIndex: number; rawDigest: string; canonicalPageDigest: string; mimeType: "image/png" | "image/jpeg"; dataUrl: string }) => {
    if (typeof p.dataUrl !== "string" || !p.dataUrl.startsWith(`data:${p.mimeType};base64,`) || p.dataUrl.length > 44_000_000) throw new RangeError("RECOVERY_BUNDLE_PAGE_INVALID");
    const raw = atob(p.dataUrl.slice(p.dataUrl.indexOf(",") + 1));
    const { dataUrl: omitted, ...page } = p; void omitted;
    return { ...page, blob: new Blob([Uint8Array.from(raw, (c) => c.charCodeAt(0))], { type: p.mimeType }) };
  });
  // Opening a bundle creates a branch of its audit history. Never overwrite newer local work.
  const id = crypto.randomUUID();
  const entry = { id, workspace: { ...value.workspace, id }, pages, storageRevision: 0, updatedAt: new Date().toISOString() } as StoredStructuralRecovery;
  await saveStructuralRecovery(entry);
  return entry;
}
