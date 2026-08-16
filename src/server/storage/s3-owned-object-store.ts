import "server-only";

import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { binaryDigest, type BinaryDigest } from "../../domain/digest/canonical";
import type { GovernanceStore, PrivateRowId } from "../persistence/store";
import { generateOpaqueToken } from "../security/crypto-core";
import type { OwnedObjectPut, OwnedObjectRead, OwnedObjectStore } from "./owned-object-store";

function validContentType(value: string): boolean { return /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/iu.test(value); }

export class S3OwnedObjectStore implements OwnedObjectStore {
  constructor(private readonly client: S3Client, private readonly bucket: string, private readonly records: GovernanceStore) {}

  async put(input: OwnedObjectPut) {
    if (!validContentType(input.contentType)) throw new RangeError("OBJECT_CONTENT_TYPE_INVALID");
    const bytes = Uint8Array.from(input.bytes);
    const digest = await binaryDigest(bytes);
    const objectKey = `objects/${generateOpaqueToken()}`;
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket, Key: objectKey, Body: bytes, ContentType: input.contentType,
      Metadata: { "hm-sha256": digest, "hm-byte-size": String(bytes.byteLength), ...(input.expiresAt ? { "hm-expires-at": input.expiresAt } : {}) },
    }));
    try {
      return await this.records.createObjectReference({
        ownerSessionId: input.ownerSessionId, objectKey, contentType: input.contentType,
        byteSize: bytes.byteLength, binaryDigest: digest, lifecycle: "active",
        createdAt: new Date().toISOString(), ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
      });
    } catch (error) {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey })).catch(() => undefined);
      throw error;
    }
  }
  private async owned(referenceId: PrivateRowId, ownerSessionId: PrivateRowId) {
    const record = await this.records.findObjectReference(referenceId, ownerSessionId);
    if (!record || record.lifecycle !== "active") throw new RangeError("OBJECT_UNAVAILABLE");
    return record;
  }
  async get(referenceId: PrivateRowId, ownerSessionId: PrivateRowId): Promise<OwnedObjectRead> {
    const record = await this.owned(referenceId, ownerSessionId);
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: record.objectKey }));
    if (!response.Body) throw new RangeError("OBJECT_UNAVAILABLE");
    const bytes = Uint8Array.from(await response.Body.transformToByteArray());
    const digest = await binaryDigest(bytes);
    if (bytes.byteLength !== record.byteSize || digest !== record.binaryDigest || response.ContentType !== record.contentType) throw new RangeError("OBJECT_INTEGRITY_FAILED");
    return { bytes, contentType: record.contentType, binaryDigest: digest };
  }
  async head(referenceId: PrivateRowId, ownerSessionId: PrivateRowId): Promise<{ readonly contentType: string; readonly binaryDigest: BinaryDigest; readonly byteSize: number; readonly expiresAt?: string }> {
    const record = await this.owned(referenceId, ownerSessionId);
    const response = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: record.objectKey }));
    if (response.ContentLength !== record.byteSize || response.ContentType !== record.contentType || response.Metadata?.["hm-sha256"] !== record.binaryDigest) throw new RangeError("OBJECT_INTEGRITY_FAILED");
    return { contentType: record.contentType, binaryDigest: record.binaryDigest as BinaryDigest, byteSize: record.byteSize, ...(record.expiresAt ? { expiresAt: record.expiresAt } : {}) };
  }
  async delete(referenceId: PrivateRowId, ownerSessionId: PrivateRowId, now = new Date()): Promise<void> {
    const record = await this.records.findObjectReference(referenceId, ownerSessionId);
    if (!record || record.lifecycle === "deleted") return;
    await this.records.transitionObjectReference({ id: record.id, ownerSessionId, lifecycle: "delete-pending", at: now.toISOString() });
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: record.objectKey }));
    await this.records.transitionObjectReference({ id: record.id, ownerSessionId, lifecycle: "deleted", at: now.toISOString() });
    await this.records.createAudit({ eventKind: "object-delete", objectReferenceId: record.id, outcome: "accepted", createdAt: now.toISOString() });
  }
}
