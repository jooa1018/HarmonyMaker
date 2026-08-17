"use client";

import type { OmrProviderResult } from "./contracts";

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
  readonly key: typeof RECORD_KEY;
  readonly handoffId: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly bytes: Blob;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly recoveryAttempts: number;
  readonly omrProviderResult?: OmrProviderResult;
  readonly pageImages?: readonly Blob[];
}

export interface OmrImportHandoff {
  readonly handoffId: string;
  readonly file: File;
  readonly omrProviderResult?: OmrProviderResult;
  readonly pageImages: readonly Blob[];
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
  readonly fileName: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
  readonly omrProviderResult?: OmrProviderResult;
  readonly pageImages?: readonly { readonly bytes: Uint8Array; readonly mimeType: "image/png" | "image/jpeg" }[];
}): Promise<void> {
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
      ...(input.pageImages ? { pageImages: input.pageImages.map((page) => new Blob([page.bytes.slice().buffer as ArrayBuffer], { type: page.mimeType })) } : {}),
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
    return {
      handoffId,
      file: new File([stored.bytes], stored.fileName, { type: stored.mimeType }),
      ...(stored.omrProviderResult ? { omrProviderResult: stored.omrProviderResult } : {}),
      pageImages: stored.pageImages ?? [],
    };
  } finally {
    db.close();
  }
}

export async function recordOmrImportHandoffFailure(handoffId: string): Promise<void> {
  const db = await database();
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(RECORD_KEY);
    const stored = await new Promise<StoredHandoff | undefined>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as StoredHandoff | undefined);
      request.onerror = () => reject(request.error ?? new Error("OMR_HANDOFF_READ_FAILED"));
    });
    if (stored?.handoffId === handoffId) {
      const failures = (stored.recoveryAttempts ?? 0) + 1;
      if (evaluateOmrHandoffRecovery(stored.expiresAt, failures, new Date().toISOString()) === "available") store.put({ ...stored, recoveryAttempts: failures });
      else store.delete(RECORD_KEY);
    }
    await transactionDone(transaction);
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
