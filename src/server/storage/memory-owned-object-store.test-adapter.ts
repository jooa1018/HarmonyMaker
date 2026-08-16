import { binaryDigest, type BinaryDigest } from "../../domain/digest/canonical";
import type { GovernanceStore, PrivateRowId } from "../persistence/store";
import { generateOpaqueToken } from "../security/crypto-core";
import type { OwnedObjectPut, OwnedObjectRead, OwnedObjectStore } from "./owned-object-store";

/** Explicit test adapter; it is never selected by production composition. */
export class MemoryOwnedObjectStore implements OwnedObjectStore {
  readonly buffers = new Map<string, Uint8Array>();
  constructor(private readonly records: GovernanceStore) {}
  async put(input: OwnedObjectPut) {
    const objectKey = `objects/${generateOpaqueToken()}`;
    const bytes = Uint8Array.from(input.bytes);
    const digest = await binaryDigest(bytes);
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
    this.buffers.delete(record.objectKey);
    await this.records.transitionObjectReference({ id: record.id, ownerSessionId, lifecycle: "deleted", at: now.toISOString() });
  }
}
