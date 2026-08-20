import { semanticDigest, type SemanticDigest } from "../domain/digest/canonical";
import { isPracticeSharePayload, type PracticeSharePayload } from "../domain/share";
import type { RightsBasis } from "../domain/source/model";
import { isShareCreateIdempotencyKey } from "./share-create-key";

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
  /** Durable operation generation and compare-and-swap authority. */
  readonly explicitFreshIntentId: string;
  readonly sessionAuthority?: string;
  readonly sessionExpiresAt?: string;
  readonly createdResponse?: StoredShareCreateResponse;
  /** Append-only local owner-delete authority, retained across a later fresh operation. */
  readonly completedAuthorities: readonly StoredCompletedShareAuthority[];
  readonly freshIntentAuthority?: { readonly reason: ShareFreshIntentReason; readonly grantedAt: string };
  readonly updatedAt: string;
}

interface ClaimOrLoadShareCreateInput {
  readonly projectId: string;
  readonly candidate: ShareCreateRecoveryEnvelope;
  readonly explicitFreshIntent: boolean;
}

export interface ShareCreateRecoveryStore {
  load(projectId: string): Promise<ShareCreateRecoveryEnvelope | undefined>;
  save(envelope: ShareCreateRecoveryEnvelope): Promise<void>;
  claimOrLoad(input: ClaimOrLoadShareCreateInput): Promise<ShareCreateRecoveryEnvelope>;
  compareAndSwap(expectedFreshIntentId: string, envelope: ShareCreateRecoveryEnvelope): Promise<boolean>;
  delete(projectId: string): Promise<void>;
}

export class ShareCreateOperationGate {
  private active = false;
  tryBegin(): boolean { if (this.active) return false; this.active = true; return true; }
  finish(): void { this.active = false; }
}

export function restoredShareCreateUiAuthority(envelope: ShareCreateRecoveryEnvelope): {
  readonly freshIntentAllowed: boolean;
  readonly createdResponse?: StoredShareCreateResponse;
} {
  return {
    freshIntentAllowed: envelope.freshIntentAuthority !== undefined,
    ...(envelope.operationLifecycle === "completed" && envelope.createdResponse ? { createdResponse: envelope.createdResponse } : {}),
  };
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
    && isShareCreateIdempotencyKey(record.idempotencyKey)
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
    && isShareCreateIdempotencyKey(record.idempotencyKey)
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

const indexedDbClaimQueues = new WeakMap<IDBFactory, Map<string, Promise<void>>>();

async function withIndexedDbClaim<T>(factory: IDBFactory, projectId: string, operation: () => Promise<T>): Promise<T> {
  let queues = indexedDbClaimQueues.get(factory);
  if (!queues) {
    queues = new Map();
    indexedDbClaimQueues.set(factory, queues);
  }
  const previous = queues.get(projectId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => gate);
  queues.set(projectId, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (queues.get(projectId) === queued) queues.delete(projectId);
  }
}

function nextFreshEnvelope(candidate: ShareCreateRecoveryEnvelope, previous?: ShareCreateRecoveryEnvelope): ShareCreateRecoveryEnvelope {
  return {
    ...candidate,
    completedAuthorities: previous?.completedAuthorities ?? candidate.completedAuthorities,
  };
}

export class IndexedDbShareCreateRecoveryStore implements ShareCreateRecoveryStore {
  constructor(private readonly factory: IDBFactory | undefined = globalThis.indexedDB) {}

  private async database(): Promise<IDBDatabase> {
    if (!this.factory) throw new RangeError("LOCAL_STORAGE_UNAVAILABLE");
    const request = this.factory.open(DATABASE_NAME, DATABASE_VERSION);
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
  async claimOrLoad(input: ClaimOrLoadShareCreateInput): Promise<ShareCreateRecoveryEnvelope> {
    await validatedEnvelope(input.candidate);
    if (!this.factory) throw new RangeError("LOCAL_STORAGE_UNAVAILABLE");
    return withIndexedDbClaim(this.factory, input.projectId, async () => {
      const database = await this.database();
      let selected: ShareCreateRecoveryEnvelope;
      try {
        const transaction = database.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const raw: unknown = await requestResult(store.get(input.projectId));
        const previous = raw === undefined ? undefined : raw;
        if (previous !== undefined && !validEnvelopeShape(previous)) throw new RangeError("SHARE_CREATE_RECOVERY_INVALID");
        if (previous !== undefined && !input.explicitFreshIntent) {
          selected = structuredClone(previous);
        } else {
          if (input.explicitFreshIntent && previous !== undefined && !previous.freshIntentAuthority) {
            throw new RangeError("SHARE_CREATE_FRESH_INTENT_NOT_AUTHORIZED");
          }
          selected = nextFreshEnvelope(input.candidate, previous);
          store.put(structuredClone(selected));
        }
        await transactionDone(transaction);
      } finally { database.close(); }
      return structuredClone(await validatedEnvelope(selected!));
    });
  }
  async compareAndSwap(expectedFreshIntentId: string, envelope: ShareCreateRecoveryEnvelope): Promise<boolean> {
    await validatedEnvelope(envelope);
    if (!this.factory) throw new RangeError("LOCAL_STORAGE_UNAVAILABLE");
    return withIndexedDbClaim(this.factory, envelope.projectId, async () => {
      const database = await this.database();
      try {
        const transaction = database.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const raw: unknown = await requestResult(store.get(envelope.projectId));
        if (raw === undefined || !validEnvelopeShape(raw) || raw.explicitFreshIntentId !== expectedFreshIntentId) {
          await transactionDone(transaction);
          return false;
        }
        store.put(structuredClone(envelope));
        await transactionDone(transaction);
        return true;
      } finally { database.close(); }
    });
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
  async claimOrLoad(input: ClaimOrLoadShareCreateInput): Promise<ShareCreateRecoveryEnvelope> {
    await validatedEnvelope(input.candidate);
    const previous = this.records.get(input.projectId);
    if (previous && !input.explicitFreshIntent) return structuredClone(await validatedEnvelope(previous));
    if (input.explicitFreshIntent && previous && !previous.freshIntentAuthority) throw new RangeError("SHARE_CREATE_FRESH_INTENT_NOT_AUTHORIZED");
    const selected = nextFreshEnvelope(input.candidate, previous);
    this.records.set(input.projectId, structuredClone(selected));
    return structuredClone(selected);
  }
  async compareAndSwap(expectedFreshIntentId: string, envelope: ShareCreateRecoveryEnvelope): Promise<boolean> {
    await validatedEnvelope(envelope);
    const current = this.records.get(envelope.projectId);
    if (!current || current.explicitFreshIntentId !== expectedFreshIntentId) return false;
    this.records.set(envelope.projectId, structuredClone(envelope));
    return true;
  }
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
  if (!input.explicitFreshIntent) {
    const existing = await input.store.load(input.projectId);
    if (existing) return existing;
  }
  const idempotencyKey = input.generateId();
  if (!isShareCreateIdempotencyKey(idempotencyKey)) throw new RangeError("IDEMPOTENCY_KEY_INVALID");
  const canonicalRequest = structuredClone(input.canonicalRequest);
  const candidate: ShareCreateRecoveryEnvelope = {
    version: SHARE_CREATE_RECOVERY_VERSION,
    projectId: input.projectId,
    canonicalRequest,
    requestDigest: await semanticDigest(canonicalRequest),
    idempotencyKey,
    operationLifecycle: "pending",
    explicitFreshIntentId: input.generateId(),
    completedAuthorities: [],
    updatedAt: input.now.toISOString(),
  };
  return input.store.claimOrLoad({
    projectId: input.projectId,
    candidate,
    explicitFreshIntent: input.explicitFreshIntent,
  });
}

async function persistGenerationUpdate(input: {
  readonly store: ShareCreateRecoveryStore;
  readonly previous: ShareCreateRecoveryEnvelope;
  readonly next: ShareCreateRecoveryEnvelope;
}): Promise<ShareCreateRecoveryEnvelope> {
  if (!await input.store.compareAndSwap(input.previous.explicitFreshIntentId, input.next)) {
    throw new RangeError("SHARE_CREATE_RECOVERY_SUPERSEDED");
  }
  return input.next;
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
  return persistGenerationUpdate({ store: input.store, previous: input.envelope, next });
}

export async function allowShareCreateFreshIntent(input: {
  readonly store: ShareCreateRecoveryStore;
  readonly envelope: ShareCreateRecoveryEnvelope;
  readonly reason: ShareFreshIntentReason;
  readonly now: Date;
}): Promise<ShareCreateRecoveryEnvelope> {
  const next = { ...input.envelope, freshIntentAuthority: { reason: input.reason, grantedAt: input.now.toISOString() }, updatedAt: input.now.toISOString() } as const;
  return persistGenerationUpdate({ store: input.store, previous: input.envelope, next });
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
  return persistGenerationUpdate({ store: input.store, previous: input.envelope, next });
}
