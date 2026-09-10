"use client";
import { binaryDigest } from "../../domain/digest/canonical";
import type { OmrProviderResult } from "../../domain/omr/contracts";
import { validateOmrHandoffPageBinding, type OmrHandoffPageImage } from "../../domain/omr/browser-handoff";
import { replayImportRecovery, type ImportRecovery } from "./recovery";

export interface StoredImportRecovery {
  readonly id: string;
  readonly updatedAt: string;
  readonly recovery: ImportRecovery;
  readonly pages: readonly OmrHandoffPageImage[];
  readonly providerResult?: OmrProviderResult;
  /** A rejected fragment cannot prove that the rest of the score was preserved. */
  readonly incompleteReason?: string;
}
const databaseName = "harmonymaker-import-recovery-v1";
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function validate(value: StoredImportRecovery): Promise<void> {
  if (!value || typeof value.id !== "string" || !/^[a-zA-Z0-9:._-]{1,128}$/u.test(value.id)
    || !Number.isFinite(Date.parse(value.updatedAt)) || !Array.isArray(value.pages) || value.pages.length > 12
    || (value.incompleteReason !== undefined && (typeof value.incompleteReason !== "string" || value.incompleteReason.length > 256))) throw new RangeError("RECOVERY_STORAGE_INVALID");
  await replayImportRecovery(value.recovery);
  let total = 0;
  for (const [index, page] of value.pages.entries()) {
    if (page.pageIndex !== index || !(page.blob instanceof Blob) || page.blob.size < 1
      || !["image/jpeg", "image/png"].includes(page.mimeType) || page.blob.type !== page.mimeType
      || await binaryDigest(new Uint8Array(await page.blob.arrayBuffer())) !== page.rawDigest) throw new RangeError("RECOVERY_IMAGE_INVALID");
    total += page.blob.size;
  }
  if (total > 32_000_000) throw new RangeError("RECOVERY_IMAGE_LIMIT");
  if (value.providerResult && (value.incompleteReason !== undefined
    || value.providerResult.rawMusicXml !== value.recovery.originalXml
    || value.providerResult.vendorResultDigest !== value.recovery.originalDigest
    || !await validateOmrHandoffPageBinding(value.pages, value.providerResult))) throw new RangeError("RECOVERY_PROVIDER_BINDING_INVALID");
}
async function writeImportRecovery(value: StoredImportRecovery, preserveExisting: boolean): Promise<void> {
  await validate(value);
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("drafts", "readwrite");
      const drafts = transaction.objectStore("drafts");
      if (!preserveExisting) drafts.put(value);
      else {
        const request = drafts.get(value.id);
        request.onsuccess = () => {
          const existing = request.result as StoredImportRecovery | undefined;
          if (!existing) { drafts.add(value); return; }
          if (existing.recovery.originalDigest !== value.recovery.originalDigest
            || existing.incompleteReason !== value.incompleteReason
            || existing.pages.length !== value.pages.length
            || existing.pages.some((page, index) => page.rawDigest !== value.pages[index].rawDigest
              || page.canonicalPageDigest !== value.pages[index].canonicalPageDigest)) {
            reject(new RangeError("RECOVERY_ORIGINAL_BINDING_CONFLICT"));
            transaction.abort();
          }
          // Re-fetching the same server artifact must never replace a user's edits.
        };
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
}
export async function saveImportRecovery(value: StoredImportRecovery): Promise<void> {
  return writeImportRecovery(value, false);
}
export async function retainImportRecovery(value: StoredImportRecovery): Promise<void> {
  return writeImportRecovery(value, true);
}
export async function loadImportRecoveries(): Promise<readonly StoredImportRecovery[]> {
  const db = await database();
  try {
    const values = await new Promise<StoredImportRecovery[]>((resolve, reject) => {
      const request = db.transaction("drafts").objectStore("drafts").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    for (const value of values) await validate(value);
    return values.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } finally { db.close(); }
}
export async function deleteImportRecovery(id: string): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("drafts", "readwrite");
      transaction.objectStore("drafts").delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}
