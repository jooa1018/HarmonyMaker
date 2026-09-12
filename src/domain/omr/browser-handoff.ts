"use client";

import { binaryDigest, isSha256LowerHex, type BinaryDigest } from "../digest/canonical";
import type { OmrProviderResult } from "./contracts";
import { validateLocalCandidate, type LocalCandidateBundle } from "./local-candidate";

const DATABASE_NAME = "harmonymaker-omr-handoff-v1";
const STORE_NAME = "handoff";
const RECORD_KEY = "pending";
export const OMR_HANDOFF_TTL_MS = 30 * 60 * 1_000;
export const OMR_HANDOFF_MAX_RECOVERY_ATTEMPTS = 3;

export function evaluateOmrHandoffRecovery(expiresAt: string, recoveryAttempts: number, now: string): "available" | "expired" | "attempts-exhausted" {
  if (!Number.isFinite(Date.parse(expiresAt)) || !Number.isFinite(Date.parse(now)) || !Number.isSafeInteger(recoveryAttempts) || recoveryAttempts < 0) throw new RangeError("OMR_HANDOFF_RECORD_INVALID");
  if (expiresAt <= now) return "expired";
  return recoveryAttempts >= OMR_HANDOFF_MAX_RECOVERY_ATTEMPTS ? "attempts-exhausted" : "available";
}

interface StoredHandoff {
  readonly localCandidate?: LocalCandidateBundle;
  readonly key: typeof RECORD_KEY;
  readonly handoffId: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly bytes: Blob;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly recoveryAttempts: number;
  readonly omrProviderResult?: OmrProviderResult;
  readonly pageImages?: readonly OmrHandoffPageImage[];
}

export interface OmrHandoffPageImage {
  readonly pageIndex: number;
  readonly rawDigest: BinaryDigest;
  readonly canonicalPageDigest: BinaryDigest;
  readonly mimeType: "image/png" | "image/jpeg";
  readonly blob: Blob;
}

export interface OmrImportHandoff {
  readonly localCandidate?: LocalCandidateBundle;
  readonly handoffId: string;
  readonly expiresAt: string;
  readonly file: File;
  readonly omrProviderResult?: OmrProviderResult;
  readonly pageImages: readonly OmrHandoffPageImage[];
}

export async function validateOmrHandoffPageBinding(
  pageImages: readonly OmrHandoffPageImage[],
  result: OmrProviderResult,
): Promise<boolean> {
  if (pageImages.length < 1 || pageImages.length > 12) return false;
  const pages = new Map<number, OmrHandoffPageImage>();
  for (const [pageIndex, page] of pageImages.entries()) {
    if (page.pageIndex !== pageIndex || pages.has(page.pageIndex)
      || !isSha256LowerHex(page.rawDigest) || !isSha256LowerHex(page.canonicalPageDigest)
      || (page.mimeType !== "image/png" && page.mimeType !== "image/jpeg")
      || !(page.blob instanceof Blob) || page.blob.type !== page.mimeType || page.blob.size < 1
      || await binaryDigest(new Uint8Array(await page.blob.arrayBuffer())) !== page.rawDigest) return false;
    pages.set(page.pageIndex, page);
  }
  for (const frame of result.evidence.frames) {
    if (frame.coordinateSpace === "processed-pixels") continue;
    const page = pages.get(frame.pageIndex);
    if (!page || frame.imageDigest !== page.canonicalPageDigest) return false;
  }
  return true;
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("OMR_HANDOFF_DATABASE_FAILED"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("OMR_HANDOFF_TRANSACTION_FAILED"));
    transaction.onabort = () => reject(transaction.error ?? new Error("OMR_HANDOFF_TRANSACTION_ABORTED"));
  });
}

export async function storeOmrImportHandoff(input: {
  readonly localCandidate?: LocalCandidateBundle;
  readonly fileName: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
  readonly omrProviderResult?: OmrProviderResult;
  readonly pageImages?: readonly {
    readonly pageIndex: number;
    readonly rawDigest: BinaryDigest;
    readonly canonicalPageDigest: BinaryDigest;
    readonly bytes: Uint8Array;
    readonly mimeType: "image/png" | "image/jpeg";
  }[];
}): Promise<void> {
  const pageImages = input.pageImages?.map((page): OmrHandoffPageImage => ({
    pageIndex: page.pageIndex,
    rawDigest: page.rawDigest,
    canonicalPageDigest: page.canonicalPageDigest,
    mimeType: page.mimeType,
    blob: new Blob([page.bytes.slice().buffer as ArrayBuffer], { type: page.mimeType }),
  }));
  if (input.localCandidate) {
    if (input.omrProviderResult) throw new RangeError("OMR_HANDOFF_BINDING_INVALID");
    await validateLocalCandidateHandoff(input.localCandidate, input.bytes, pageImages ?? []);
  } else if ((input.omrProviderResult === undefined) !== (pageImages === undefined)) throw new RangeError("OMR_HANDOFF_BINDING_INVALID");
  if (input.omrProviderResult) {
    if (await binaryDigest(input.bytes) !== input.omrProviderResult.vendorResultDigest
      || !pageImages || !await validateOmrHandoffPageBinding(pageImages, input.omrProviderResult)) {
      throw new RangeError("OMR_HANDOFF_BINDING_INVALID");
    }
  }
  const db = await database();
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put({
      key: RECORD_KEY,
      handoffId: crypto.randomUUID(),
      fileName: input.fileName.normalize("NFC").slice(0, 255),
      mimeType: input.mimeType,
      bytes: new Blob([input.bytes.slice().buffer as ArrayBuffer], { type: input.mimeType }),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + OMR_HANDOFF_TTL_MS).toISOString(),
      recoveryAttempts: 0,
      ...(input.omrProviderResult ? { omrProviderResult: structuredClone(input.omrProviderResult) } : {}),
      ...(input.localCandidate ? { localCandidate: structuredClone(input.localCandidate) } : {}),
      ...(pageImages ? { pageImages } : {}),
    } satisfies StoredHandoff);
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

export async function takeOmrImportHandoff(): Promise<OmrImportHandoff | undefined> {
  const db = await database();
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const request = transaction.objectStore(STORE_NAME).get(RECORD_KEY);
    const stored = await new Promise<StoredHandoff | undefined>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as StoredHandoff | undefined);
      request.onerror = () => reject(request.error ?? new Error("OMR_HANDOFF_READ_FAILED"));
    });
    const expiresAt = stored?.expiresAt ?? (stored ? new Date(Date.parse(stored.createdAt) + OMR_HANDOFF_TTL_MS).toISOString() : "");
    const recoveryAttempts = stored?.recoveryAttempts ?? 0;
    const handoffId = stored?.handoffId ?? `legacy:${stored?.createdAt ?? "unknown"}`;
    const recovery = stored ? evaluateOmrHandoffRecovery(expiresAt, recoveryAttempts, new Date().toISOString()) : undefined;
    if (stored && recovery !== "available") {
      transaction.objectStore(STORE_NAME).delete(RECORD_KEY);
    }
    await transactionDone(transaction);
    if (!stored || recovery !== "available") return undefined;
    if (stored.localCandidate) {
      if (stored.omrProviderResult) throw new RangeError("OMR_HANDOFF_BINDING_INVALID");
      await validateLocalCandidateHandoff(stored.localCandidate, new Uint8Array(await stored.bytes.arrayBuffer()), stored.pageImages ?? []);
    } else if (stored.omrProviderResult) {
      const fileDigest = await binaryDigest(new Uint8Array(await stored.bytes.arrayBuffer()));
      if (fileDigest !== stored.omrProviderResult.vendorResultDigest || !stored.pageImages
        || !await validateOmrHandoffPageBinding(stored.pageImages, stored.omrProviderResult)) {
        const invalidTransaction = db.transaction(STORE_NAME, "readwrite");
        invalidTransaction.objectStore(STORE_NAME).delete(RECORD_KEY);
        await transactionDone(invalidTransaction);
        throw new RangeError("OMR_HANDOFF_BINDING_INVALID");
      }
    } else if (stored.pageImages) {
      const invalidTransaction = db.transaction(STORE_NAME, "readwrite");
      invalidTransaction.objectStore(STORE_NAME).delete(RECORD_KEY);
      await transactionDone(invalidTransaction);
      throw new RangeError("OMR_HANDOFF_BINDING_INVALID");
    }
    return {
      handoffId,
      expiresAt,
      file: new File([stored.bytes], stored.fileName, { type: stored.mimeType }),
      ...(stored.omrProviderResult ? { omrProviderResult: stored.omrProviderResult } : {}),
      ...(stored.localCandidate ? { localCandidate: stored.localCandidate } : {}),
      pageImages: stored.pageImages ?? [],
    };
  } finally {
    db.close();
  }
}

export async function validateLocalCandidateHandoff(bundle: LocalCandidateBundle, bytes: Uint8Array, pages: readonly OmrHandoffPageImage[]): Promise<void> {
  await validateLocalCandidate(bundle);
  const p = pages[0];
  if (await binaryDigest(bytes) !== bundle.artifacts.candidateXml.sha256 || pages.length !== 1
    || p.pageIndex !== 0 || p.rawDigest !== bundle.image.sha256 || p.canonicalPageDigest !== p.rawDigest
    || p.mimeType !== bundle.image.mimeType || !(p.blob instanceof Blob) || p.blob.type !== p.mimeType
    || await binaryDigest(new Uint8Array(await p.blob.arrayBuffer())) !== p.rawDigest) throw new RangeError("OMR_HANDOFF_BINDING_INVALID");
}

export async function recordOmrImportHandoffFailure(handoffId: string): Promise<boolean> {
  const db = await database();
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(RECORD_KEY);
    const stored = await new Promise<StoredHandoff | undefined>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as StoredHandoff | undefined);
      request.onerror = () => reject(request.error ?? new Error("OMR_HANDOFF_READ_FAILED"));
    });
    let available = false;
    if (stored?.handoffId === handoffId) {
      const failures = (stored.recoveryAttempts ?? 0) + 1;
      available = evaluateOmrHandoffRecovery(stored.expiresAt, failures, new Date().toISOString()) === "available";
      if (available) store.put({ ...stored, recoveryAttempts: failures });
      else store.delete(RECORD_KEY);
    }
    await transactionDone(transaction);
    return available;
  } finally { db.close(); }
}

export async function abandonOmrImportHandoff(handoffId: string): Promise<void> {
  return completeOmrImportHandoff(handoffId);
}

export async function completeOmrImportHandoff(handoffId: string): Promise<void> {
  const db = await database();
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(RECORD_KEY);
    const stored = await new Promise<StoredHandoff | undefined>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as StoredHandoff | undefined);
      request.onerror = () => reject(request.error ?? new Error("OMR_HANDOFF_READ_FAILED"));
    });
    if (stored?.handoffId === handoffId) store.delete(RECORD_KEY);
    await transactionDone(transaction);
  } finally { db.close(); }
}
