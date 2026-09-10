"use client";
import { binaryDigest } from "../../domain/digest/canonical";
import type { OmrHandoffPageImage } from "../../domain/omr/browser-handoff";
import { replayStructuralRecovery, type StructuralRecovery } from "./structural-recovery";

export interface StoredStructuralRecovery {
  readonly id: string; readonly storageRevision: number; readonly updatedAt: string;
  readonly workspace: StructuralRecovery; readonly pages: readonly OmrHandoffPageImage[];
}
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("harmonymaker-structural-recovery-v1", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("drafts", { keyPath: "id" });
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
}
async function validate(value: StoredStructuralRecovery): Promise<void> {
  if (!value || value.id !== value.workspace.id || !Number.isSafeInteger(value.storageRevision) || value.storageRevision < 0 || !Number.isFinite(Date.parse(value.updatedAt))
    || !Array.isArray(value.pages) || value.pages.length > 12) throw new RangeError("RECOVERY_STORAGE_INVALID");
  await replayStructuralRecovery(value.workspace);
  let bytes = 0;
  for (const [i, p] of value.pages.entries()) {
    if (p.pageIndex !== i || !(p.blob instanceof Blob) || !["image/png", "image/jpeg"].includes(p.mimeType) || p.blob.type !== p.mimeType || !p.blob.size
      || await binaryDigest(new Uint8Array(await p.blob.arrayBuffer())) !== p.rawDigest) throw new RangeError("RECOVERY_PAGE_BINDING_INVALID");
    bytes += p.blob.size;
  }
  if (bytes > 32_000_000) throw new RangeError("RECOVERY_PAGE_LIMIT");
}
export async function saveStructuralRecovery(value: StoredStructuralRecovery, expectedRevision?: number): Promise<void> {
  await validate(value); const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("drafts", "readwrite"), store = tx.objectStore("drafts"), get = store.get(value.id);
      get.onsuccess = () => {
        const old = get.result as StoredStructuralRecovery | undefined;
        if (old ? expectedRevision !== old.storageRevision || value.storageRevision !== old.storageRevision + 1 : expectedRevision !== undefined || value.storageRevision !== 0) {
          reject(new RangeError("RECOVERY_CONCURRENT_EDIT_RELOAD_REQUIRED")); tx.abort(); return;
        }
        store.put(value);
      };
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
export async function loadStructuralRecoveries(): Promise<readonly StoredStructuralRecovery[]> {
  const db = await database();
  try {
    const values = await new Promise<StoredStructuralRecovery[]>((resolve, reject) => {
      const req = db.transaction("drafts").objectStore("drafts").getAll(); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
    for (const value of values) await validate(value);
    return values.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } finally { db.close(); }
}
