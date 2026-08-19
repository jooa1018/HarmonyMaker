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
  lookupCreate(idempotencyKeyHash: string): Promise<OmrCreateRecoveryAuthority | undefined>;
  recordCreate(input: OmrCreateRecoveryAuthority & { readonly idempotencyKeyHash: string }): Promise<void>;
  grantSessionAlias(jobId: PrivateRowId, sessionId: PrivateRowId, now: string): Promise<void>;
  aliasOwnerCandidates(sessionId: PrivateRowId): Promise<readonly PrivateRowId[]>;
}

export class MemoryOmrCreateRecoveryRegistry implements OmrCreateRecoveryRegistry {
  private readonly creates = new Map<string, OmrCreateRecoveryAuthority>();
  private readonly aliases = new Map<PrivateRowId, Set<PrivateRowId>>();

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

  async lookupCreate(idempotencyKeyHash: string): Promise<OmrCreateRecoveryAuthority | undefined> {
    const result = await this.database.query(
      `SELECT i.owner_session_id,i.job_id,i.request_digest
       FROM omr_create_idempotency i
       WHERE i.key_hash=$1`,
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
    // PostgreSQL uses omr_create_idempotency itself as the global recovery
    // ledger. Migration 015 makes key_hash globally unique.
  }

  async grantSessionAlias(jobId: PrivateRowId, sessionId: PrivateRowId, now: string): Promise<void> {
    await this.database.query(
      `INSERT INTO omr_job_session_aliases (job_id,session_id,created_at,last_used_at)
       VALUES ($1,$2,$3,$3)
       ON CONFLICT (job_id,session_id) DO UPDATE SET last_used_at=EXCLUDED.last_used_at`,
      [jobId, sessionId, now],
    );
  }

  async aliasOwnerCandidates(sessionId: PrivateRowId): Promise<readonly PrivateRowId[]> {
    const result = await this.database.query(
      `SELECT DISTINCT j.owner_session_id
       FROM omr_job_session_aliases a
       JOIN omr_jobs j ON j.id=a.job_id
       WHERE a.session_id=$1
       ORDER BY j.owner_session_id`,
      [sessionId],
    );
    return result.rows.map((row) => String(row.owner_session_id) as PrivateRowId);
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

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { readonly code?: unknown }).code === "23505");
}

/**
 * Adds one global high-entropy K1 recovery authority without changing the
 * ordinary OmrStore state machine. The original job owner remains the durable
 * object owner; a replacement anonymous session receives an explicit job
 * alias only after presenting the same K1 hash and exact request digest.
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

  const claimCreate: OmrStore["claimCreate"] = async (input) => {
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
    try {
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
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const concurrent = await recoverCreate(base, registry, {
        ownerSessionId: input.ownerSessionId,
        idempotencyKeyHash: input.idempotencyKeyHash,
        requestDigest: input.requestDigest,
        vendorCreateLeaseExpiresAt: input.record.vendorCreateLeaseExpiresAt,
        now: input.now,
      });
      if (!concurrent || concurrent.status === "missing") throw error;
      return concurrent as OmrCreateClaim;
    }
  };

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
