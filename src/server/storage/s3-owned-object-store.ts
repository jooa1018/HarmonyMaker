import "server-only";

import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { binaryDigest, semanticDigest, type BinaryDigest } from "../../domain/digest/canonical";
import type { GovernanceStore, PrivateRowId } from "../persistence/store";
import { generateOpaqueToken } from "../security/crypto-core";
import type { OwnedObjectPut, OwnedObjectRead, OwnedObjectStore } from "./owned-object-store";

function validContentType(value: string): boolean { return /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/iu.test(value); }
const PUBLICATION_LEASE_MS = 5 * 60 * 1_000;

export class S3OwnedObjectStore implements OwnedObjectStore {
  constructor(private readonly client: S3Client, private readonly bucket: string, private readonly records: GovernanceStore) {}

  async put(input: OwnedObjectPut) {
    if (!validContentType(input.contentType)) throw new RangeError("OBJECT_CONTENT_TYPE_INVALID");
    if (input.publicationId.length < 1 || input.publicationId.length > 256) throw new RangeError("OBJECT_PUBLICATION_ID_INVALID");
    const bytes = Uint8Array.from(input.bytes);
    const digest = await binaryDigest(bytes);
    const objectKey = `objects/${await semanticDigest({ projectionSchema: "hm-owned-object-publication-v1", ownerSessionId: input.ownerSessionId, publicationId: input.publicationId })}`;
    let publicationToken = generateOpaqueToken();
    const createdAt = new Date();
    const publicationInput = {
      ownerSessionId: input.ownerSessionId, objectKey, contentType: input.contentType,
      byteSize: bytes.byteLength, binaryDigest: digest, lifecycle: "upload-pending" as const,
      publicationToken, publicationLeaseExpiresAt: new Date(createdAt.getTime() + PUBLICATION_LEASE_MS).toISOString(),
      createdAt: createdAt.toISOString(), ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    };
    let reference;
    const exact = (candidate: Awaited<ReturnType<GovernanceStore["findObjectReferenceByKey"]>>): boolean => candidate !== undefined
      && candidate.objectKey === objectKey && candidate.binaryDigest === digest
      && candidate.byteSize === bytes.byteLength && candidate.contentType === input.contentType;
    const prior = await this.records.findObjectReferenceByKey(objectKey, input.ownerSessionId);
    if (prior) {
      if (!exact(prior)) throw new RangeError("OBJECT_PUBLICATION_CONFLICT");
      if (prior.lifecycle === "active") return prior;
      if (prior.lifecycle === "deleted") {
        const restarted = await this.records.restartObjectPublication({
          id: prior.id, ownerSessionId: input.ownerSessionId, objectKey, contentType: input.contentType,
          byteSize: bytes.byteLength, binaryDigest: digest, publicationToken,
          publicationLeaseExpiresAt: publicationInput.publicationLeaseExpiresAt, at: createdAt.toISOString(),
        });
        if (!restarted) throw new RangeError("OBJECT_PUBLICATION_PENDING");
        reference = await this.records.findObjectReference(prior.id, input.ownerSessionId);
        if (!reference || reference.lifecycle !== "upload-pending" || reference.publicationToken !== publicationToken) throw new RangeError("OBJECT_PUBLICATION_PENDING");
      } else {
        if (prior.lifecycle !== "upload-pending" || !prior.publicationToken) throw new RangeError("OBJECT_PUBLICATION_PENDING");
        reference = prior;
        publicationToken = prior.publicationToken;
      }
    } else {
      try {
        reference = await this.records.createObjectReference(publicationInput);
      } catch (error) {
        const inspected = await this.records.findObjectReferenceByKey(objectKey, input.ownerSessionId).catch(() => undefined);
        if (!exact(inspected)) throw error;
        if (inspected!.lifecycle === "active") return inspected!;
        if (inspected!.lifecycle !== "upload-pending" || !inspected!.publicationToken) throw error;
        reference = inspected!;
        publicationToken = inspected!.publicationToken!;
      }
    }
    const cleanup = async (): Promise<"active" | "cleaned" | "deferred"> => {
      const disposition = await this.records.failObjectPublication({
        id: reference.id, ownerSessionId: input.ownerSessionId, publicationToken, at: new Date().toISOString(),
      }).catch(() => "superseded" as const);
      if (disposition === "active") return "active";
      if (disposition !== "cleanup-required") return "deferred";
      try { await this.delete(reference.id, input.ownerSessionId); return "cleaned"; } catch { return "deferred"; }
    };
    try {
      await this.client.send(new PutObjectCommand({
        Bucket: this.bucket, Key: objectKey, Body: bytes, ContentType: input.contentType,
        Metadata: { "hm-sha256": digest, "hm-byte-size": String(bytes.byteLength), ...(input.expiresAt ? { "hm-expires-at": input.expiresAt } : {}) },
      }));
    } catch (error) {
      // Put acknowledgement is ambiguous. Keep the exact key under durable
      // upload-pending authority so retry can publish that same key, or cleanup
      // can delete it after lease expiry and restart.
      throw error;
    }
    try {
      const completed = await this.records.completeObjectPublication({
        id: reference.id, ownerSessionId: input.ownerSessionId, publicationToken, at: new Date().toISOString(),
      });
      const inspected = await this.records.findObjectReference(reference.id, input.ownerSessionId);
      if ((completed || inspected?.lifecycle === "active") && inspected?.lifecycle === "active"
        && inspected.objectKey === objectKey && inspected.binaryDigest === digest) return inspected;
    } catch (error) {
      const inspected = await this.records.findObjectReference(reference.id, input.ownerSessionId).catch(() => undefined);
      if (inspected?.lifecycle === "active" && inspected.objectKey === objectKey && inspected.binaryDigest === digest) return inspected;
      await cleanup();
      throw error;
    }
    await cleanup();
    throw new Error("OBJECT_PUBLICATION_SUPERSEDED");
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
