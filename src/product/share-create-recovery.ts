import { semanticDigest, type SemanticDigest } from "../domain/digest/canonical";
import { isPracticeSharePayload, type PracticeSharePayload } from "../domain/share";
import type { RightsBasis } from "../domain/source/model";

export const SHARE_CREATE_RECOVERY_VERSION = 1 as const;
const DATABASE_NAME = "harmonymaker-share-authority-v1";
const DATABASE_VERSION = 1;
const STORE_NAME = "share-create-operations";
const RIGHTS: readonly RightsBasis[] = ["self-authored", "public-domain", "licensed", "user-confirmed-rights"];

export interface CanonicalShareCreateRequest { readonly payload: PracticeSharePayload; readonly rightsBasis: RightsBasis }
export interface StoredShareCreateResponse { readonly token: string; readonly ownerDeleteSecret: string }
export interface StoredCompletedShareAuthority extends StoredShareCreateResponse {
  readonly idempotencyKey: string;
  readonly requestDigest: SemanticDigest;
  readonly completedAt: string;
}
export type ShareFreshIntentReason = "retired-replay" | "deterministic-no-effect" | "owner-deleted";

export interface ShareCreateRecoveryEnvelope {
  readonly version: typeof SHARE_CREATE_RECOVERY_VERSION;
  readonly projectId: string;
  /** Exact frozen POST body, excluding only K1 which is stored beside it. */
  readonly canonicalRequest: CanonicalShareCreateRequest;
  readonly requestDigest: SemanticDigest;
  readonly idempotencyKey: string;
  readonly operationLifecycle: "pending" | "completed";
  readonly explicitFreshIntentId: string;
  readonly sessionAuthority?: string;
  readonly sessionExpiresAt?: string;
  readonly createdResponse?: StoredShareCreateResponse;
  /** Append-only local owner-delete authority, retained across a later fresh operation. */
  readonly completedAuthorities: readonly StoredCompletedShareAuthority[];
  readonly freshIntentAuthority?: { readonly reason: ShareFreshIntentReason; readonly grantedAt: string };
  readonly updatedAt: string;
}

export interface ShareCreateRecoveryStore {
  load(projectId: string): Promise<ShareCreateRecoveryEnvelope | undefined>;
  save(envelope: ShareCreateRecoveryEnvelope): Promise<void>;
  delete(projectId: string): Promise<void>;
}

export class ShareCreateOperationGate {
  private active = false;
  tryBegin(): boolean { if (this.active) return false; this.active = true; return true; }
  finish(): void { this.active = false; }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("INDEXEDDB_FAILED"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("INDEXEDDB_FAILED"));
    transaction.onabort = () => reject(transaction.error ?? new Error("INDEXEDDB_ABORTED"));
  });
}

function validResponse(value: unknown): value is StoredShareCreateResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).every((key) => key === "token" || key === "ownerDeleteSecret")
    && typeof record.token === "string" && /^[A-Za-z0-9_-]{8,512}$/u.test(record.token)
    && typeof record.ownerDeleteSecret === "string" && /^[A-Za-z0-9_-]{8,512}$/u.test(record.ownerDeleteSecret);
}

function validCompletedAuthority(value: unknown): value is StoredCompletedShareAuthority {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 5
    && ["token", "ownerDeleteSecret", "idempotencyKey", "requestDigest", "completedAt"].every((key) => Object.hasOwn(record, key))
    && typeof record.token === "string" && /^[A-Za-z0-9_-]{8,512}$/u.test(record.token)
    && typeof record.ownerDeleteSecret === "string" && /^[A-Za-z0-9_-]{8,512}$/u.test(record.ownerDeleteSecret)
    && typeof record.idempotencyKey === "string" && /^[A-Za-z0-9._:-]{8,128}$/u.test(record.idempotencyKey)
    && typeof record.requestDigest === "string" && /^[0-9a-f]{64}$/u.test(record.requestDigest)
    && typeof record.completedAt === "string" && !Number.isNaN(Date.parse(record.completedAt));
}

function validEnvelopeShape(value: unknown): value is ShareCreateRecoveryEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const request = record.canonicalRequest as Record<string, unknown> | undefined;
  const response = record.createdResponse;
  const authorities = record.completedAuthorities;
  const fresh = record.freshIntentAuthority as Record<string, unknown> | undefined;
  return record.version === SHARE_CREATE_RECOVERY_VERSION
    && typeof record.projectId === "string" && record.projectId.length > 0
    && request !== undefined && request !== null && !Array.isArray(request)
    && Object.keys(request).length === 2 && Object.hasOwn(request, "payload") && Object.hasOwn(request, "rightsBasis")
    && isPracticeSharePayload(request.payload) && RIGHTS.includes(request.rightsBasis as RightsBasis)
    && typeof record.requestDigest === "string" && /^[0-9a-f]{64}$/u.test(record.requestDigest)
    && typeof record.idempotencyKey === "string" && /^[A-Za-z0-9._:-]{8,128}$/u.test(record.idempotencyKey)
    && (record.operationLifecycle === "pending" || record.operationLifecycle === "completed")
    && typeof record.explicitFreshIntentId === "string" && record.explicitFreshIntentId.length > 0
    && (record.sessionAuthority === undefined || (typeof record.sessionAuthority === "string" && record.sessionAuthority.length >= 32))
    && (record.sessionExpiresAt === undefined || (typeof record.sessionExpiresAt === "string" && !Number.isNaN(Date.parse(record.sessionExpiresAt))))
    && (response === undefined || validResponse(response))
    && (record.operationLifecycle !== "completed" || validResponse(response))
    && Array.isArray(authorities) && authorities.every(validCompletedAuthority)
    && new Set(authorities.map((authority) => authority.token)).size === authorities.length
    && (fresh === undefined || ((fresh.reason === "retired-replay" || fresh.reason === "deterministic-no-effect" || fresh.reason === "owner-deleted")
      && typeof fresh.grantedAt === "string" && !Number.isNaN(Date.parse(fresh.grantedAt))))
    && typeof record.updatedAt === "string" && !Number.isNaN(Date.parse(record.updatedAt));
}

async function validatedEnvelope(value: unknown): Promise<ShareCreateRecoveryEnvelope> {
  if (!validEnvelopeShape(value)) throw new RangeError("SHARE_CREATE_RECOVERY_INVALID");
  if (await semanticDigest(value.canonicalRequest) !== value.requestDigest) throw new RangeError("SHARE_CREATE_RECOVERY_DIGEST_MISMATCH");
  return value;
}

export class IndexedDbShareCreateRecoveryStore implements ShareCreateRecoveryStore {
  private async database(): Promise<IDBDatabase> {
    if (typeof indexedDB === "undefined") throw new RangeError("LOCAL_STORAGE_UNAVAILABLE");
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: "projectId" });
    };
    return requestResult(request);
  }
  async load(projectId: string): Promise<ShareCreateRecoveryEnvelope | undefined> {
    const database = await this.database();
    try {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const raw: unknown = await requestResult(transaction.objectStore(STORE_NAME).get(projectId));
      await transactionDone(transaction);
      if (raw === undefined) return undefined;
      return structuredClone(await validatedEnvelope(raw));
    } finally { database.close(); }
  }
  async save(envelope: ShareCreateRecoveryEnvelope): Promise<void> {
    await validatedEnvelope(envelope);
    const database = await this.database();
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(structuredClone(envelope));
      await transactionDone(transaction);
    } finally { database.close(); }
  }
  async delete(projectId: string): Promise<void> {
    const database = await this.database();
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(projectId);
      await transactionDone(transaction);
    } finally { database.close(); }
  }
}

export class MemoryShareCreateRecoveryStore implements ShareCreateRecoveryStore {
  private readonly records = new Map<string, ShareCreateRecoveryEnvelope>();
  async load(projectId: string): Promise<ShareCreateRecoveryEnvelope | undefined> {
    const value = this.records.get(projectId);
    if (!value) return undefined;
    return structuredClone(await validatedEnvelope(value));
  }
  async save(envelope: ShareCreateRecoveryEnvelope): Promise<void> { await validatedEnvelope(envelope); this.records.set(envelope.projectId, structuredClone(envelope)); }
  async delete(projectId: string): Promise<void> { this.records.delete(projectId); }
}

export async function prepareShareCreateRecovery(input: {
  readonly store: ShareCreateRecoveryStore;
  readonly projectId: string;
  readonly canonicalRequest: CanonicalShareCreateRequest;
  readonly explicitFreshIntent: boolean;
  readonly generateId: () => string;
  readonly now: Date;
}): Promise<ShareCreateRecoveryEnvelope> {
  if (!isPracticeSharePayload(input.canonicalRequest.payload) || !RIGHTS.includes(input.canonicalRequest.rightsBasis)) throw new RangeError("SHARE_CREATE_REQUEST_INVALID");
  const previous = await input.store.load(input.projectId);
  if (!input.explicitFreshIntent && previous) return previous;
  if (input.explicitFreshIntent && previous && !previous.freshIntentAuthority) throw new RangeError("SHARE_CREATE_FRESH_INTENT_NOT_AUTHORIZED");
  const idempotencyKey = input.generateId();
  if (!/^[A-Za-z0-9._:-]{8,128}$/u.test(idempotencyKey)) throw new RangeError("IDEMPOTENCY_KEY_INVALID");
  const canonicalRequest = structuredClone(input.canonicalRequest);
  const envelope: ShareCreateRecoveryEnvelope = {
    version: SHARE_CREATE_RECOVERY_VERSION,
    projectId: input.projectId,
    canonicalRequest,
    requestDigest: await semanticDigest(canonicalRequest),
    idempotencyKey,
    operationLifecycle: "pending",
    explicitFreshIntentId: input.generateId(),
    completedAuthorities: previous?.completedAuthorities ?? [],
    updatedAt: input.now.toISOString(),
  };
  await input.store.save(envelope);
  return envelope;
}

export async function bindShareCreateSession(input: {
  readonly store: ShareCreateRecoveryStore;
  readonly envelope: ShareCreateRecoveryEnvelope;
  readonly sessionAuthority: string;
  readonly sessionExpiresAt: string;
  readonly now: Date;
}): Promise<ShareCreateRecoveryEnvelope> {
  if (input.envelope.sessionAuthority && input.envelope.sessionAuthority !== input.sessionAuthority) throw new RangeError("SHARE_CREATE_SESSION_AUTHORITY_CHANGED");
  const next = { ...input.envelope, sessionAuthority: input.sessionAuthority, sessionExpiresAt: input.sessionExpiresAt, updatedAt: input.now.toISOString() };
  await input.store.save(next);
  return next;
}

export async function allowShareCreateFreshIntent(input: {
  readonly store: ShareCreateRecoveryStore;
  readonly envelope: ShareCreateRecoveryEnvelope;
  readonly reason: ShareFreshIntentReason;
  readonly now: Date;
}): Promise<ShareCreateRecoveryEnvelope> {
  const next = { ...input.envelope, freshIntentAuthority: { reason: input.reason, grantedAt: input.now.toISOString() }, updatedAt: input.now.toISOString() } as const;
  await input.store.save(next);
  return next;
}

export async function completeShareCreateRecovery(input: {
  readonly store: ShareCreateRecoveryStore;
  readonly envelope: ShareCreateRecoveryEnvelope;
  readonly response: StoredShareCreateResponse;
  readonly now: Date;
}): Promise<ShareCreateRecoveryEnvelope> {
  if (!validResponse(input.response)) throw new RangeError("SHARE_CREATE_RECOVERY_INVALID");
  if (input.envelope.operationLifecycle === "completed" && input.envelope.createdResponse
    && (input.envelope.createdResponse.token !== input.response.token
      || input.envelope.createdResponse.ownerDeleteSecret !== input.response.ownerDeleteSecret)) {
    throw new RangeError("SHARE_CREATE_REPLAY_AUTHORITY_MISMATCH");
  }
  const authority: StoredCompletedShareAuthority = { ...input.response, idempotencyKey: input.envelope.idempotencyKey, requestDigest: input.envelope.requestDigest, completedAt: input.now.toISOString() };
  const completedAuthorities = [...input.envelope.completedAuthorities.filter((candidate) => candidate.token !== authority.token), authority];
  const next: ShareCreateRecoveryEnvelope = {
    ...input.envelope,
    operationLifecycle: "completed",
    createdResponse: input.response,
    completedAuthorities,
    freshIntentAuthority: undefined,
    updatedAt: input.now.toISOString(),
  };
  await input.store.save(next);
  return next;
}
