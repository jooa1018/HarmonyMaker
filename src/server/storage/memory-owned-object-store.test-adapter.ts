import { binaryDigest, semanticDigest, type BinaryDigest } from "../../domain/digest/canonical";
import type { GovernanceStore, PrivateRowId } from "../persistence/store";
import { generateOpaqueToken } from "../security/crypto-core";
import type { OwnedObjectPut, OwnedObjectRead, OwnedObjectStore } from "./owned-object-store";

/** Explicit test adapter; it is never selected by production composition. */
export class MemoryOwnedObjectStore implements OwnedObjectStore {
  readonly buffers = new Map<string, Uint8Array>();
  constructor(private readonly records: GovernanceStore) {}
  async put(input: OwnedObjectPut) {
    if (input.publicationId.length < 1 || input.publicationId.length > 256) throw new RangeError("OBJECT_PUBLICATION_ID_INVALID");
    const objectKey = `objects/${await semanticDigest({ projectionSchema: "hm-owned-object-publication-v1", ownerSessionId: input.ownerSessionId, publicationId: input.publicationId })}`;
    const bytes = Uint8Array.from(input.bytes);
    const digest = await binaryDigest(bytes);
    const existing = await this.records.findObjectReferenceByKey(objectKey, input.ownerSessionId);
    if (existing) {
      if (existing.lifecycle === "active" && existing.binaryDigest === digest && existing.byteSize === bytes.byteLength && existing.contentType === input.contentType) return existing;
      if (existing.lifecycle === "deleted" && existing.binaryDigest === digest && existing.byteSize === bytes.byteLength && existing.contentType === input.contentType) {
        const publicationToken = generateOpaqueToken();
        const restarted = await this.records.restartObjectPublication({
          id: existing.id, ownerSessionId: input.ownerSessionId, objectKey, contentType: input.contentType,
          byteSize: bytes.byteLength, binaryDigest: digest, publicationToken,
          publicationLeaseExpiresAt: "2026-01-01T00:05:00.000Z", at: "2026-01-01T00:00:00.000Z",
        });
        if (!restarted) throw new RangeError("OBJECT_PUBLICATION_CONFLICT");
        this.buffers.set(objectKey, bytes);
        const disposition = await this.records.completeObjectPublication({
          id: existing.id, ownerSessionId: input.ownerSessionId, objectKey, publicationToken,
          publicationGeneration: (existing.publicationGeneration ?? 0) + 1, at: "2026-01-01T00:00:00.000Z",
        });
        if (disposition !== "active") throw new RangeError("OBJECT_PUBLICATION_CONFLICT");
        const active = await this.records.findObjectReference(existing.id, input.ownerSessionId);
        if (active?.lifecycle === "active") return active;
      }
      throw new RangeError("OBJECT_PUBLICATION_CONFLICT");
    }
    this.buffers.set(objectKey, bytes);
    return this.records.createObjectReference({
      ownerSessionId: input.ownerSessionId, objectKey, contentType: input.contentType,
      byteSize: bytes.byteLength, binaryDigest: digest, lifecycle: "active",
      createdAt: "2026-01-01T00:00:00.000Z", ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    });
  }
  private async owned(referenceId: PrivateRowId, ownerSessionId: PrivateRowId) {
    const record = await this.records.findObjectReference(referenceId, ownerSessionId);
    if (!record || record.lifecycle !== "active") throw new RangeError("OBJECT_UNAVAILABLE");
    return record;
  }
  async get(referenceId: PrivateRowId, ownerSessionId: PrivateRowId): Promise<OwnedObjectRead> {
    const record = await this.owned(referenceId, ownerSessionId);
    const bytes = this.buffers.get(record.objectKey);
    if (!bytes || bytes.byteLength !== record.byteSize || await binaryDigest(bytes) !== record.binaryDigest) throw new RangeError("OBJECT_INTEGRITY_FAILED");
    return { bytes: Uint8Array.from(bytes), contentType: record.contentType, binaryDigest: record.binaryDigest as BinaryDigest };
  }
  async head(referenceId: PrivateRowId, ownerSessionId: PrivateRowId) {
    const record = await this.owned(referenceId, ownerSessionId);
    return { contentType: record.contentType, binaryDigest: record.binaryDigest as BinaryDigest, byteSize: record.byteSize, ...(record.expiresAt ? { expiresAt: record.expiresAt } : {}) };
  }
  async delete(referenceId: PrivateRowId, ownerSessionId: PrivateRowId, now = new Date()): Promise<void> {
    const record = await this.records.findObjectReference(referenceId, ownerSessionId);
    if (!record || record.lifecycle === "deleted") return;
    await this.records.transitionObjectReference({ id: record.id, ownerSessionId, lifecycle: "delete-pending", at: now.toISOString() });
    this.buffers.delete(record.objectKey);
    await this.records.transitionObjectReference({ id: record.id, ownerSessionId, lifecycle: "deleted", at: now.toISOString() });
    await this.records.createAudit({ eventKind: "object-delete", objectReferenceId: record.id, outcome: "accepted", createdAt: now.toISOString() });
  }
}
