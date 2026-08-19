"use client";

import { binaryDigest, isSha256LowerHex, semanticDigest, type BinaryDigest, type SemanticDigest } from "../../domain/digest/canonical";
import type { ImageQualityReport } from "../../domain/omr/image-quality";
import type { InputSourceKind } from "../../domain/omr/input";

const DATABASE_NAME = "harmonymaker-omr-active-job-v1";
const STORE_NAME = "active-job";
const RECORD_KEY = "active";
const MANIFEST_VERSION = "hm-omr-browser-job-manifest-v1" as const;

export type OmrBrowserManifestLifecycle = "create-pending" | "bound" | "completed" | "terminal" | "delete-pending";

export interface OmrBrowserPendingDeletion {
  readonly vendorStatus: "deleted" | "not-supported" | "failed";
  readonly nextAttemptAt?: string;
}

export interface OmrBrowserPendingUploadRetry {
  readonly code: "OMR_PROVIDER_BINDING_UNAVAILABLE";
  readonly attempt: number;
  readonly nextAttemptAt: string;
}

export interface OmrBrowserManifestPage {
  readonly pageIndex: number;
  readonly rawDigest: BinaryDigest;
  readonly canonicalPageDigest: BinaryDigest;
  readonly mimeType: "image/png" | "image/jpeg";
  readonly bytes: Blob;
  readonly width: number;
  readonly height: number;
  readonly clientQuality: ImageQualityReport;
  readonly quality: ImageQualityReport;
  readonly warnAcknowledged: boolean;
  readonly duplicateConfirmed: boolean;
  readonly previewIdentity: string;
  readonly uploadIdentity: string;
}

export interface OmrBrowserJobManifest {
  readonly key: typeof RECORD_KEY;
  readonly version: typeof MANIFEST_VERSION;
  readonly manifestId: string;
  readonly manifestDigest: SemanticDigest;
  readonly createdAt: string;
  readonly sourceKind: Exclude<InputSourceKind, "musicxml" | "mxl">;
  readonly capabilitySnapshotDigest: SemanticDigest;
  readonly createStorageKey: string;
  readonly recoveryStorageKey: string;
  readonly lifecycle: OmrBrowserManifestLifecycle;
  readonly jobHandle?: string;
  readonly pendingUploadRetry?: OmrBrowserPendingUploadRetry;
  readonly pendingDeletion?: OmrBrowserPendingDeletion;
  readonly pages: readonly OmrBrowserManifestPage[];
}

type ManifestPageInput = Omit<OmrBrowserManifestPage, "bytes" | "previewIdentity" | "uploadIdentity"> & {
  readonly bytes: Uint8Array;
};

function manifestProjection(manifest: Omit<OmrBrowserJobManifest, "manifestDigest" | "key" | "lifecycle" | "jobHandle" | "pendingUploadRetry" | "pendingDeletion">) {
  return {
    projectionSchema: MANIFEST_VERSION,
    manifestId: manifest.manifestId,
    createdAt: manifest.createdAt,
    sourceKind: manifest.sourceKind,
    capabilitySnapshotDigest: manifest.capabilitySnapshotDigest,
    createStorageKey: manifest.createStorageKey,
    recoveryStorageKey: manifest.recoveryStorageKey,
    pages: manifest.pages.map((page) => ({
      pageIndex: page.pageIndex,
      rawDigest: page.rawDigest,
      canonicalPageDigest: page.canonicalPageDigest,
      mimeType: page.mimeType,
      width: page.width,
      height: page.height,
      clientQuality: page.clientQuality,
      quality: page.quality,
      warnAcknowledged: page.warnAcknowledged,
      duplicateConfirmed: page.duplicateConfirmed,
      previewIdentity: page.previewIdentity,
      uploadIdentity: page.uploadIdentity,
    })),
  };
}

function recordShape(value: unknown): value is OmrBrowserJobManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<OmrBrowserJobManifest>;
  if (record.key !== RECORD_KEY || record.version !== MANIFEST_VERSION
    || typeof record.manifestId !== "string" || record.manifestId.length < 1 || record.manifestId.length > 128
    || !isSha256LowerHex(record.manifestDigest)
    || typeof record.createdAt !== "string" || !Number.isFinite(Date.parse(record.createdAt))
    || !["digital-pdf", "scanned-pdf", "camera-photo"].includes(String(record.sourceKind))
    || !isSha256LowerHex(record.capabilitySnapshotDigest)
    || typeof record.createStorageKey !== "string" || record.createStorageKey.length < 1 || record.createStorageKey.length > 2048
    || typeof record.recoveryStorageKey !== "string" || record.recoveryStorageKey !== `${record.createStorageKey}:recovered-handle`
    || !["create-pending", "bound", "completed", "terminal", "delete-pending"].includes(String(record.lifecycle))
    || (record.jobHandle !== undefined && (typeof record.jobHandle !== "string" || record.jobHandle.length < 1 || record.jobHandle.length > 2048))
    || (record.lifecycle !== "create-pending" && !record.jobHandle)
    || (record.pendingUploadRetry !== undefined && (
      record.lifecycle !== "bound"
      || record.pendingUploadRetry.code !== "OMR_PROVIDER_BINDING_UNAVAILABLE"
      || !Number.isSafeInteger(record.pendingUploadRetry.attempt) || record.pendingUploadRetry.attempt < 1
      || !Number.isFinite(Date.parse(record.pendingUploadRetry.nextAttemptAt))
    ))
    || (record.lifecycle === "delete-pending") !== (record.pendingDeletion !== undefined)
    || (record.pendingDeletion !== undefined && (
      !["deleted", "not-supported", "failed"].includes(String(record.pendingDeletion.vendorStatus))
      || (record.pendingDeletion.nextAttemptAt !== undefined
        && !Number.isFinite(Date.parse(record.pendingDeletion.nextAttemptAt)))
    ))
    || !Array.isArray(record.pages) || record.pages.length < 1 || record.pages.length > 12) return false;
  const uploadIdentities = new Set<string>();
  return record.pages.every((page, pageIndex) => {
    if (!page || typeof page !== "object" || page.pageIndex !== pageIndex
      || !isSha256LowerHex(page.rawDigest) || !isSha256LowerHex(page.canonicalPageDigest)
      || (page.mimeType !== "image/png" && page.mimeType !== "image/jpeg")
      || !(page.bytes instanceof Blob) || page.bytes.type !== page.mimeType || page.bytes.size < 1
      || !Number.isSafeInteger(page.width) || page.width < 1
      || !Number.isSafeInteger(page.height) || page.height < 1
      || typeof page.warnAcknowledged !== "boolean" || typeof page.duplicateConfirmed !== "boolean"
      || typeof page.previewIdentity !== "string" || page.previewIdentity !== `omr-preview:${page.pageIndex}:${page.rawDigest}`
      || typeof page.uploadIdentity !== "string" || page.uploadIdentity.length < 1 || page.uploadIdentity.length > 256
      || uploadIdentities.has(page.uploadIdentity)) return false;
    uploadIdentities.add(page.uploadIdentity);
    return true;
  });
}

export function recoverableOmrManifestStorageKeys(value: unknown): {
  readonly createStorageKey?: string;
  readonly recoveryStorageKey?: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Readonly<Record<string, unknown>>;
  const createStorageKey = typeof record.createStorageKey === "string"
    && record.createStorageKey.length > 0 && record.createStorageKey.length <= 2_048
    ? record.createStorageKey : undefined;
  const recoveryStorageKey = createStorageKey && typeof record.recoveryStorageKey === "string"
    && record.recoveryStorageKey === `${createStorageKey}:recovered-handle`
    ? record.recoveryStorageKey : undefined;
  return {
    ...(createStorageKey ? { createStorageKey } : {}),
    ...(recoveryStorageKey ? { recoveryStorageKey } : {}),
  };
}

export async function validateOmrBrowserJobManifest(value: unknown): Promise<boolean> {
  if (!recordShape(value)) return false;
  try {
    for (const page of value.pages) {
      if (await binaryDigest(new Uint8Array(await page.bytes.arrayBuffer())) !== page.rawDigest) return false;
    }
    const {
      key: _key, lifecycle: _lifecycle, jobHandle: _jobHandle,
      pendingUploadRetry: _pendingUploadRetry, pendingDeletion: _pendingDeletion,
      manifestDigest: _digest, ...immutable
    } = value;
    void _key; void _lifecycle; void _jobHandle; void _pendingUploadRetry; void _pendingDeletion; void _digest;
    return await semanticDigest(manifestProjection(immutable)) === value.manifestDigest;
  } catch {
    return false;
  }
}

export async function createOmrBrowserJobManifest(input: {
  readonly sourceKind: Exclude<InputSourceKind, "musicxml" | "mxl">;
  readonly capabilitySnapshotDigest: SemanticDigest;
  readonly createStorageKey: string;
  readonly pages: readonly ManifestPageInput[];
  readonly now?: string;
}): Promise<OmrBrowserJobManifest> {
  const manifestId = crypto.randomUUID();
  const createdAt = input.now ?? new Date().toISOString();
  const pages = input.pages.map((page, pageIndex): OmrBrowserManifestPage => ({
    ...page,
    pageIndex,
    bytes: new Blob([page.bytes.slice().buffer as ArrayBuffer], { type: page.mimeType }),
    previewIdentity: `omr-preview:${pageIndex}:${page.rawDigest}`,
    uploadIdentity: `omr-upload:${manifestId}:${pageIndex}:${crypto.randomUUID()}`,
  }));
  const immutable = {
    version: MANIFEST_VERSION,
    manifestId,
    createdAt,
    sourceKind: input.sourceKind,
    capabilitySnapshotDigest: input.capabilitySnapshotDigest,
    createStorageKey: input.createStorageKey,
    recoveryStorageKey: `${input.createStorageKey}:recovered-handle`,
    pages,
  } as const;
  const manifest: OmrBrowserJobManifest = {
    key: RECORD_KEY,
    ...immutable,
    manifestDigest: await semanticDigest(manifestProjection(immutable)),
    lifecycle: "create-pending",
  };
  if (!await validateOmrBrowserJobManifest(manifest)) throw new RangeError("OMR_BROWSER_MANIFEST_INVALID");
  return manifest;
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("OMR_BROWSER_MANIFEST_DATABASE_FAILED"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("OMR_BROWSER_MANIFEST_TRANSACTION_FAILED"));
    transaction.onabort = () => reject(transaction.error ?? new DOMException("OMR_BROWSER_MANIFEST_TRANSACTION_ABORTED", "AbortError"));
  });
}

async function readRecord(db: IDBDatabase): Promise<unknown> {
  const transaction = db.transaction(STORE_NAME, "readonly");
  const request = transaction.objectStore(STORE_NAME).get(RECORD_KEY);
  const result = await new Promise<unknown>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("OMR_BROWSER_MANIFEST_READ_FAILED"));
  });
  await transactionDone(transaction);
  return result;
}

export async function readOmrBrowserJobManifest(): Promise<OmrBrowserJobManifest | undefined> {
  const db = await database();
  try {
    const record = await readRecord(db);
    if (record === undefined) return undefined;
    if (!await validateOmrBrowserJobManifest(record)) throw new RangeError("OMR_BROWSER_MANIFEST_INVALID");
    return record as OmrBrowserJobManifest;
  } finally { db.close(); }
}

export async function persistNewOmrBrowserJobManifest(manifest: OmrBrowserJobManifest): Promise<void> {
  if (!await validateOmrBrowserJobManifest(manifest) || manifest.lifecycle !== "create-pending" || manifest.jobHandle) {
    throw new RangeError("OMR_BROWSER_MANIFEST_INVALID");
  }
  const db = await database();
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(RECORD_KEY);
    request.onsuccess = () => {
      const existing = request.result as Partial<OmrBrowserJobManifest> | undefined;
      if (existing && existing.manifestDigest !== manifest.manifestDigest) {
        transaction.abort();
        return;
      }
      if (!existing) store.add(manifest);
    };
    await transactionDone(transaction).catch((error) => {
      throw error instanceof Error && error.name === "AbortError"
        ? new RangeError("OMR_BROWSER_MANIFEST_ACTIVE") : error;
    });
  } finally { db.close(); }
}

export async function bindOmrBrowserJobManifest(manifestDigest: SemanticDigest, jobHandle: string): Promise<OmrBrowserJobManifest> {
  if (!jobHandle) throw new RangeError("OMR_BROWSER_MANIFEST_BINDING_INVALID");
  const db = await database();
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(RECORD_KEY);
    let bound: OmrBrowserJobManifest | undefined;
    request.onsuccess = () => {
      const existing = request.result as OmrBrowserJobManifest | undefined;
      if (!existing || existing.manifestDigest !== manifestDigest
        || (existing.jobHandle !== undefined && existing.jobHandle !== jobHandle)
        || !["create-pending", "bound"].includes(existing.lifecycle)) {
        transaction.abort();
        return;
      }
      bound = { ...existing, lifecycle: "bound", jobHandle };
      store.put(bound);
    };
    await transactionDone(transaction).catch((error) => {
      throw error instanceof Error && error.name === "AbortError"
        ? new RangeError("OMR_BROWSER_MANIFEST_BINDING_CONFLICT") : error;
    });
    if (!bound || !await validateOmrBrowserJobManifest(bound)) throw new RangeError("OMR_BROWSER_MANIFEST_BINDING_CONFLICT");
    return bound;
  } finally { db.close(); }
}

export async function markOmrBrowserJobManifest(
  manifestDigest: SemanticDigest,
  lifecycle: "completed" | "terminal",
): Promise<OmrBrowserJobManifest> {
  const db = await database();
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(RECORD_KEY);
    let marked: OmrBrowserJobManifest | undefined;
    request.onsuccess = () => {
      const existing = request.result as OmrBrowserJobManifest | undefined;
      if (!existing || existing.manifestDigest !== manifestDigest || !existing.jobHandle
        || existing.lifecycle === "create-pending"
        || existing.lifecycle === "delete-pending"
        || (existing.lifecycle === "completed" && lifecycle === "terminal")
        || (existing.lifecycle === "terminal" && lifecycle === "completed")) {
        transaction.abort();
        return;
      }
      marked = existing.lifecycle === lifecycle && existing.pendingUploadRetry === undefined
        ? existing : { ...existing, lifecycle, pendingUploadRetry: undefined };
      store.put(marked);
    };
    await transactionDone(transaction).catch((error) => {
      throw error instanceof Error && error.name === "AbortError"
        ? new RangeError("OMR_BROWSER_MANIFEST_BINDING_CONFLICT") : error;
    });
    if (!marked || !await validateOmrBrowserJobManifest(marked)) throw new RangeError("OMR_BROWSER_MANIFEST_BINDING_CONFLICT");
    return marked;
  } finally { db.close(); }
}

export async function markOmrBrowserJobDeletePending(
  manifestDigest: SemanticDigest,
  pendingDeletion: OmrBrowserPendingDeletion,
): Promise<OmrBrowserJobManifest> {
  if (!pendingDeletion.vendorStatus
    || (pendingDeletion.nextAttemptAt !== undefined && !Number.isFinite(Date.parse(pendingDeletion.nextAttemptAt)))) {
    throw new RangeError("OMR_BROWSER_MANIFEST_BINDING_CONFLICT");
  }
  const db = await database();
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(RECORD_KEY);
    let marked: OmrBrowserJobManifest | undefined;
    request.onsuccess = () => {
      const existing = request.result as OmrBrowserJobManifest | undefined;
      if (!existing || existing.manifestDigest !== manifestDigest || !existing.jobHandle
        || existing.lifecycle === "create-pending") {
        transaction.abort();
        return;
      }
      marked = {
        ...existing, lifecycle: "delete-pending", pendingUploadRetry: undefined,
        pendingDeletion: structuredClone(pendingDeletion),
      };
      store.put(marked);
    };
    await transactionDone(transaction).catch((error) => {
      throw error instanceof Error && error.name === "AbortError"
        ? new RangeError("OMR_BROWSER_MANIFEST_BINDING_CONFLICT") : error;
    });
    if (!marked || !await validateOmrBrowserJobManifest(marked)) throw new RangeError("OMR_BROWSER_MANIFEST_BINDING_CONFLICT");
    return marked;
  } finally { db.close(); }
}

export async function setOmrBrowserUploadRetry(
  manifestDigest: SemanticDigest,
  retry: OmrBrowserPendingUploadRetry | undefined,
): Promise<OmrBrowserJobManifest> {
  if (retry !== undefined && (retry.code !== "OMR_PROVIDER_BINDING_UNAVAILABLE"
    || !Number.isSafeInteger(retry.attempt) || retry.attempt < 1
    || !Number.isFinite(Date.parse(retry.nextAttemptAt)))) {
    throw new RangeError("OMR_BROWSER_UPLOAD_RETRY_INVALID");
  }
  const db = await database();
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(RECORD_KEY);
    let updated: OmrBrowserJobManifest | undefined;
    request.onsuccess = () => {
      const existing = request.result as OmrBrowserJobManifest | undefined;
      if (!existing || existing.manifestDigest !== manifestDigest || !existing.jobHandle
        || existing.lifecycle !== "bound") {
        transaction.abort();
        return;
      }
      updated = { ...existing, pendingUploadRetry: retry === undefined ? undefined : structuredClone(retry) };
      store.put(updated);
    };
    await transactionDone(transaction).catch((error) => {
      throw error instanceof Error && error.name === "AbortError"
        ? new RangeError("OMR_BROWSER_MANIFEST_BINDING_CONFLICT") : error;
    });
    if (!updated || !await validateOmrBrowserJobManifest(updated)) {
      throw new RangeError("OMR_BROWSER_MANIFEST_BINDING_CONFLICT");
    }
    return updated;
  } finally { db.close(); }
}

export async function clearOmrBrowserJobManifest(expectedManifestDigest?: SemanticDigest): Promise<{
  readonly createStorageKey?: string;
  readonly recoveryStorageKey?: string;
} | undefined> {
  const db = await database();
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(RECORD_KEY);
    let removedKeys: { readonly createStorageKey?: string; readonly recoveryStorageKey?: string } | undefined;
    request.onsuccess = () => {
      const existing = request.result as OmrBrowserJobManifest | undefined;
      if (!existing) return;
      if (expectedManifestDigest && existing.manifestDigest !== expectedManifestDigest) {
        transaction.abort();
        return;
      }
      removedKeys = recoverableOmrManifestStorageKeys(existing);
      store.delete(RECORD_KEY);
    };
    await transactionDone(transaction).catch((error) => {
      throw error instanceof Error && error.name === "AbortError"
        ? new RangeError("OMR_BROWSER_MANIFEST_BINDING_CONFLICT") : error;
    });
    return removedKeys;
  } finally { db.close(); }
}
