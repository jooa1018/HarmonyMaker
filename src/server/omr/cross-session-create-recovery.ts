import "server-only";

import type { Pool } from "pg";

import type { SemanticDigest } from "../../domain/digest/canonical";
import type { PrivateRowId } from "../persistence/store";
import type { OmrCreateClaim, OmrCreateInspection, OmrStore } from "./store";

export interface OmrCreateRecoveryAuthority {
  readonly ownerSessionId: PrivateRowId;
  readonly jobId: PrivateRowId;
  readonly requestDigest: SemanticDigest;
}

export interface OmrCreateRecoveryRegistry {
  withCreateLock<T>(idempotencyKeyHash: string, operation: () => Promise<T>): Promise<T>;
  lookupCreate(idempotencyKeyHash: string): Promise<OmrCreateRecoveryAuthority | undefined>;
  recordCreate(input: OmrCreateRecoveryAuthority & { readonly idempotencyKeyHash: string }): Promise<void>;
  grantSessionAlias(jobId: PrivateRowId, sessionId: PrivateRowId, now: string): Promise<void>;
  aliasOwnerCandidates(sessionId: PrivateRowId): Promise<readonly PrivateRowId[]>;
}

export class MemoryOmrCreateRecoveryRegistry implements OmrCreateRecoveryRegistry {
  private readonly creates = new Map<string, OmrCreateRecoveryAuthority>();
  private readonly aliases = new Map<PrivateRowId, Set<PrivateRowId>>();
  private readonly gates = new Map<string, Promise<void>>();

  async withCreateLock<T>(idempotencyKeyHash: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.gates.get(idempotencyKeyHash) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.then(() => gate);
    this.gates.set(idempotencyKeyHash, queued);
    await previous;
    try { return await operation(); }
    finally {
      release();
      if (this.gates.get(idempotencyKeyHash) === queued) this.gates.delete(idempotencyKeyHash);
    }
  }

  async lookupCreate(idempotencyKeyHash: string): Promise<OmrCreateRecoveryAuthority | undefined> {
    const value = this.creates.get(idempotencyKeyHash);
    return value ? structuredClone(value) : undefined;
  }

  async recordCreate(input: OmrCreateRecoveryAuthority & { readonly idempotencyKeyHash: string }): Promise<void> {
    const prior = this.creates.get(input.idempotencyKeyHash);
    if (prior && (prior.jobId !== input.jobId || prior.requestDigest !== input.requestDigest)) {
      throw new RangeError("OMR_CREATE_RECOVERY_CONFLICT");
    }
    this.creates.set(input.idempotencyKeyHash, {
      ownerSessionId: input.ownerSessionId,
      jobId: input.jobId,
      requestDigest: input.requestDigest,
    });
  }

  async grantSessionAlias(jobId: PrivateRowId, sessionId: PrivateRowId): Promise<void> {
    const authority = [...this.creates.values()].find((candidate) => candidate.jobId === jobId);
    if (!authority) throw new RangeError("OMR_CREATE_RECOVERY_INVALID");
    const owners = this.aliases.get(sessionId) ?? new Set<PrivateRowId>();
    owners.add(authority.ownerSessionId);
    this.aliases.set(sessionId, owners);
  }

  async aliasOwnerCandidates(sessionId: PrivateRowId): Promise<readonly PrivateRowId[]> {
    return [...(this.aliases.get(sessionId) ?? [])];
  }
}

export class PostgresOmrCreateRecoveryRegistry implements OmrCreateRecoveryRegistry {
  constructor(private readonly database: Pool) {}

  async withCreateLock<T>(idempotencyKeyHash: string, operation: () => Promise<T>): Promise<T> {
    const client = await this.database.connect();
    const lockDomain = `hm-omr-create-recovery-v1:${idempotencyKeyHash}`;
    try {
      await client.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [lockDomain]);
      return await operation();
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [lockDomain]).catch(() => undefined);
      client.release();
    }
  }

  async lookupCreate(idempotencyKeyHash: string): Promise<OmrCreateRecoveryAuthority | undefined> {
    const result = await this.database.query(
      `SELECT i.owner_session_id,i.job_id,i.request_digest
       FROM omr_create_idempotency i
       WHERE i.key_hash=$1
       ORDER BY i.job_id`,
      [idempotencyKeyHash],
    );
    if (!result.rows[0]) return undefined;
    if (result.rows.length !== 1) throw new RangeError("OMR_CREATE_RECOVERY_CONFLICT");
    return {
      ownerSessionId: String(result.rows[0].owner_session_id) as PrivateRowId,
      jobId: String(result.rows[0].job_id) as PrivateRowId,
      requestDigest: result.rows[0].request_digest as SemanticDigest,
    };
  }

  async recordCreate(): Promise<void> {
    // omr_create_idempotency is the durable recovery ledger. The per-key
    // advisory lock serializes every production claim before this row exists.
  }

  async grantSessionAlias(jobId: PrivateRowId, sessionId: PrivateRowId, now: string): Promise<void> {
    const result = await this.database.query(
      `INSERT INTO idempotency_records (
         session_id,operation,key_hash,request_digest,state,response_json,
         created_at,claim_expires_at,expires_at
       )
       SELECT $2,'omr-session-alias-v1',$1::text,j.owner_session_id::text,'complete',
         jsonb_build_object('ownerSessionId',j.owner_session_id::text),$3,$3,j.expires_at
       FROM omr_jobs j WHERE j.id=$1::bigint
       ON CONFLICT (session_id,operation,key_hash) DO UPDATE SET
         request_digest=EXCLUDED.request_digest,
         response_json=EXCLUDED.response_json,
         claim_expires_at=EXCLUDED.claim_expires_at,
         expires_at=EXCLUDED.expires_at`,
      [jobId, sessionId, now],
    );
    if (result.rowCount !== 1) throw new RangeError("OMR_CREATE_RECOVERY_INVALID");
  }

  async aliasOwnerCandidates(sessionId: PrivateRowId): Promise<readonly PrivateRowId[]> {
    const result = await this.database.query(
      `SELECT DISTINCT response_json->>'ownerSessionId' AS owner_session_id
       FROM idempotency_records
       WHERE session_id=$1 AND operation='omr-session-alias-v1'
         AND state='complete' AND expires_at > now()
         AND jsonb_typeof(response_json)='object'
       ORDER BY owner_session_id`,
      [sessionId],
    );
    return result.rows.flatMap((row) => typeof row.owner_session_id === "string"
      ? [row.owner_session_id as PrivateRowId]
      : []);
  }
}

async function recoverCreate(
  base: OmrStore,
  registry: OmrCreateRecoveryRegistry,
  input: Parameters<OmrStore["inspectCreate"]>[0],
): Promise<OmrCreateInspection | undefined> {
  const authority = await registry.lookupCreate(input.idempotencyKeyHash);
  if (!authority) return undefined;
  if (authority.requestDigest !== input.requestDigest) return { status: "conflict" };
  const recovered = await base.inspectCreate({ ...input, ownerSessionId: authority.ownerSessionId });
  if (recovered.status === "missing") throw new RangeError("OMR_CREATE_RECOVERY_INVALID");
  if (input.ownerSessionId !== authority.ownerSessionId) {
    await registry.grantSessionAlias(authority.jobId, input.ownerSessionId, input.now);
  }
  return recovered;
}

/**
 * Adds one global high-entropy K1 recovery authority without changing the
 * ordinary OmrStore state machine. The original job owner remains the durable
 * object owner; a replacement anonymous session receives a bounded durable
 * job alias only after presenting the same K1 hash and exact request digest.
 */
export function withCrossSessionOmrCreateRecovery(
  base: OmrStore,
  registry: OmrCreateRecoveryRegistry,
): OmrStore {
  const inspectCreate: OmrStore["inspectCreate"] = async (input) => {
    const direct = await base.inspectCreate(input);
    if (direct.status !== "missing") return direct;
    return await recoverCreate(base, registry, input) ?? direct;
  };

  const claimCreate: OmrStore["claimCreate"] = async (input) => registry.withCreateLock(
    input.idempotencyKeyHash,
    async () => {
      const recovered = await recoverCreate(base, registry, {
        ownerSessionId: input.ownerSessionId,
        idempotencyKeyHash: input.idempotencyKeyHash,
        requestDigest: input.requestDigest,
        vendorCreateLeaseExpiresAt: input.record.vendorCreateLeaseExpiresAt,
        now: input.now,
      });
      if (recovered) {
        if (recovered.status === "missing") throw new RangeError("OMR_CREATE_RECOVERY_INVALID");
        return recovered as OmrCreateClaim;
      }
      const claimed = await base.claimCreate(input);
      if (claimed.status === "claimed") {
        await registry.recordCreate({
          idempotencyKeyHash: input.idempotencyKeyHash,
          ownerSessionId: input.ownerSessionId,
          jobId: claimed.job.id,
          requestDigest: input.requestDigest,
        });
      }
      return claimed;
    },
  );

  const findOwnedByHandleHash: OmrStore["findOwnedByHandleHash"] = async (handleHash, ownerSessionId, includeInactive) => {
    const direct = await base.findOwnedByHandleHash(handleHash, ownerSessionId, includeInactive);
    if (direct) return direct;
    for (const originalOwnerSessionId of await registry.aliasOwnerCandidates(ownerSessionId)) {
      const aliased = await base.findOwnedByHandleHash(handleHash, originalOwnerSessionId, includeInactive);
      if (aliased) return aliased;
    }
    return undefined;
  };

  return new Proxy(base, {
    get(target, property, receiver) {
      if (property === "inspectCreate") return inspectCreate;
      if (property === "claimCreate") return claimCreate;
      if (property === "findOwnedByHandleHash") return findOwnedByHandleHash;
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as OmrStore;
}
