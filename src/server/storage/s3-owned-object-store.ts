import "server-only";

import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { binaryDigest, semanticDigest, type BinaryDigest } from "../../domain/digest/canonical";
import type { GovernanceStore, PrivateRowId } from "../persistence/store";
import { generateOpaqueToken } from "../security/crypto-core";
import type { OwnedObjectPut, OwnedObjectRead, OwnedObjectStore } from "./owned-object-store";

function validContentType(value: string): boolean { return /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/iu.test(value); }
const PUBLICATION_LEASE_MS = 5 * 60 * 1_000;
const PUBLICATION_CLEANUP_LEASE_MS = 5 * 60 * 1_000;

function objectNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { readonly name?: string; readonly $metadata?: { readonly httpStatusCode?: number } };
  return candidate.name === "NotFound" || candidate.name === "NoSuchKey" || candidate.$metadata?.httpStatusCode === 404;
}

export class S3OwnedObjectStore implements OwnedObjectStore {
  constructor(private readonly client: S3Client, private readonly bucket: string, private readonly records: GovernanceStore) {}

  async put(input: OwnedObjectPut) {
    if (!validContentType(input.contentType)) throw new RangeError("OBJECT_CONTENT_TYPE_INVALID");
    if (input.publicationId.length < 1 || input.publicationId.length > 256) throw new RangeError("OBJECT_PUBLICATION_ID_INVALID");
    const bytes = Uint8Array.from(input.bytes);
    const digest = await binaryDigest(bytes);
    const objectKey = `objects/${await semanticDigest({ projectionSchema: "hm-owned-object-publication-v1", ownerSessionId: input.ownerSessionId, publicationId: input.publicationId })}`;
    let publicationToken = generateOpaqueToken();
    let publicationGeneration = 1;
    const createdAt = new Date();
    const publicationInput = {
      ownerSessionId: input.ownerSessionId, objectKey, contentType: input.contentType,
      byteSize: bytes.byteLength, binaryDigest: digest, lifecycle: "upload-pending" as const,
      publicationToken, publicationLeaseExpiresAt: new Date(createdAt.getTime() + PUBLICATION_LEASE_MS).toISOString(),
      publicationGeneration, publicationPutMayStillComplete: true,
      createdAt: createdAt.toISOString(), ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    };
    let reference;
    const exact = (candidate: Awaited<ReturnType<GovernanceStore["findObjectReferenceByKey"]>>): boolean => candidate !== undefined
      && candidate.objectKey === objectKey && candidate.binaryDigest === digest
      && candidate.byteSize === bytes.byteLength && candidate.contentType === input.contentType
      && candidate.expiresAt === input.expiresAt;
    const prior = await this.records.findObjectReferenceByKey(objectKey, input.ownerSessionId);
    if (prior) {
      if (!exact(prior)) throw new RangeError("OBJECT_PUBLICATION_CONFLICT");
      if (prior.lifecycle === "active") return prior;
      if (prior.lifecycle === "deleted" || prior.lifecycle === "tombstone-pending") {
        const restarted = await this.records.restartObjectPublication({
          id: prior.id, ownerSessionId: input.ownerSessionId, objectKey, contentType: input.contentType,
          byteSize: bytes.byteLength, binaryDigest: digest, publicationToken,
          publicationLeaseExpiresAt: publicationInput.publicationLeaseExpiresAt, at: createdAt.toISOString(),
        });
        if (!restarted) throw new RangeError("OBJECT_PUBLICATION_PENDING");
        reference = await this.records.findObjectReference(prior.id, input.ownerSessionId);
        if (!reference || reference.lifecycle !== "upload-pending" || reference.publicationToken !== publicationToken) throw new RangeError("OBJECT_PUBLICATION_PENDING");
        publicationGeneration = reference.publicationGeneration ?? 0;
      } else {
        if (prior.lifecycle !== "upload-pending" || !prior.publicationToken || prior.publicationGeneration === undefined) throw new RangeError("OBJECT_PUBLICATION_PENDING");
        publicationToken = prior.publicationToken;
        publicationGeneration = prior.publicationGeneration;
        const begun = await this.records.beginObjectPublicationAttempt({
          id: prior.id, ownerSessionId: input.ownerSessionId, publicationToken, publicationGeneration,
          publicationLeaseExpiresAt: publicationInput.publicationLeaseExpiresAt, at: createdAt.toISOString(),
        });
        if (!begun) throw new RangeError("OBJECT_PUBLICATION_PENDING");
        reference = await this.records.findObjectReference(prior.id, input.ownerSessionId);
        if (!reference) throw new RangeError("OBJECT_PUBLICATION_PENDING");
      }
    } else {
      try {
        reference = await this.records.createObjectReference(publicationInput);
      } catch (error) {
        const inspected = await this.records.findObjectReferenceByKey(objectKey, input.ownerSessionId).catch(() => undefined);
        if (!exact(inspected)) throw error;
        if (inspected!.lifecycle === "active") return inspected!;
        if (inspected!.lifecycle !== "upload-pending" || inspected!.publicationToken !== publicationToken || inspected!.publicationGeneration === undefined) throw error;
        reference = inspected!;
        publicationGeneration = inspected!.publicationGeneration!;
      }
    }
    try {
      await this.client.send(new PutObjectCommand({
        Bucket: this.bucket, Key: objectKey, Body: bytes, ContentType: input.contentType,
        Metadata: { "hm-sha256": digest, "hm-byte-size": String(bytes.byteLength), ...(input.expiresAt ? { "hm-expires-at": input.expiresAt } : {}) },
      }));
    } catch (error) {
      const disposition = await this.records.settleObjectPublicationPut({
        id: reference.id, ownerSessionId: input.ownerSessionId, publicationToken, publicationGeneration, at: new Date().toISOString(),
      }).catch(() => "superseded" as const);
      if (disposition === "active") {
        const active = await this.records.findObjectReference(reference.id, input.ownerSessionId).catch(() => undefined);
        if (exact(active) && active?.lifecycle === "active") return active;
      }
      if (disposition === "delete-required") await this.deletePublication(reference.id, input.ownerSessionId, new Date()).catch(() => undefined);
      throw error;
    }
    let publicationDisposition: "active" | "delete-required" | "superseded";
    try {
      publicationDisposition = await this.records.completeObjectPublication({
        id: reference.id, ownerSessionId: input.ownerSessionId, publicationToken, publicationGeneration, at: new Date().toISOString(),
      });
    } catch (error) {
      const inspected = await this.records.findObjectReference(reference.id, input.ownerSessionId).catch(() => undefined);
      if (inspected?.lifecycle === "active" && exact(inspected)) return inspected;
      if (inspected?.lifecycle === "tombstone-pending"
        && (inspected.publicationToken === publicationToken || inspected.publicationPredecessorToken === publicationToken)) {
        const disposition = await this.records.settleObjectPublicationPut({
          id: reference.id, ownerSessionId: input.ownerSessionId, publicationToken, publicationGeneration, at: new Date().toISOString(),
        }).catch(() => "superseded" as const);
        if (disposition === "delete-required") await this.deletePublication(reference.id, input.ownerSessionId, new Date()).catch(() => undefined);
      }
      throw error;
    }
    const inspected = await this.records.findObjectReference(reference.id, input.ownerSessionId);
    if (publicationDisposition === "active" && inspected?.lifecycle === "active" && exact(inspected)) return inspected;
    if (publicationDisposition === "delete-required") {
      await this.deletePublication(reference.id, input.ownerSessionId, new Date());
      throw new Error("OBJECT_PUBLICATION_DELETED");
    }
    if (inspected?.lifecycle === "active" && exact(inspected)) return inspected;
    throw new Error("OBJECT_PUBLICATION_SUPERSEDED");
  }

  private async deletePublication(referenceId: PrivateRowId, ownerSessionId: PrivateRowId, now: Date): Promise<void> {
    let record = await this.records.findObjectReference(referenceId, ownerSessionId);
    if (!record || record.lifecycle === "deleted" || record.lifecycle === "active" && record.publicationPredecessorToken === undefined) return;

    if (record.lifecycle === "tombstone-pending" && record.publicationDeleteConfirmedAt
      && record.publicationPutMayStillComplete === true && record.publicationToken && record.publicationGeneration !== undefined) {
      try {
        await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: record.objectKey }));
      } catch (error) {
        if (objectNotFound(error)) return;
        throw error;
      }
      const observed = await this.records.settleObjectPublicationPut({
        id: record.id, ownerSessionId, publicationToken: record.publicationToken,
        publicationGeneration: record.publicationGeneration, at: now.toISOString(),
      });
      if (observed === "active" || observed === "superseded") return;
      record = await this.records.findObjectReference(referenceId, ownerSessionId);
      if (!record) return;
    }

    if (record.publicationGeneration === undefined) throw new Error("OBJECT_PUBLICATION_AUTHORITY_MISSING");
    const cleanupToken = generateOpaqueToken();
    const claimed = await this.records.claimObjectPublicationCleanup({
      id: record.id, ownerSessionId, objectKey: record.objectKey, publicationGeneration: record.publicationGeneration,
      publicationCleanupToken: cleanupToken,
      publicationCleanupLeaseExpiresAt: new Date(now.getTime() + PUBLICATION_CLEANUP_LEASE_MS).toISOString(), now: now.toISOString(),
    });
    if (!claimed) {
      const inspected = await this.records.findObjectReference(referenceId, ownerSessionId);
      if (!inspected || inspected.lifecycle === "deleted" || inspected.lifecycle === "active") return;
      throw new Error("OBJECT_PUBLICATION_CLEANUP_PENDING");
    }
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: record.objectKey }));
    } catch (error) {
      await this.records.releaseObjectPublicationCleanup({
        id: record.id, ownerSessionId, publicationGeneration: record.publicationGeneration, publicationCleanupToken: cleanupToken,
      }).catch(() => undefined);
      throw error;
    }
    const completed = await this.records.completeObjectPublicationCleanup({
      id: record.id, ownerSessionId, objectKey: record.objectKey, publicationGeneration: record.publicationGeneration,
      publicationCleanupToken: cleanupToken, at: now.toISOString(),
    });
    if (completed === "deleted") {
      await this.records.createAudit({ eventKind: "object-delete", objectReferenceId: record.id, outcome: "accepted", createdAt: now.toISOString() });
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
    if (["upload-pending", "tombstone-pending"].includes(record.lifecycle) || (record.lifecycle === "active" && record.publicationPredecessorToken !== undefined)) {
      await this.deletePublication(referenceId, ownerSessionId, now);
      return;
    }
    await this.records.transitionObjectReference({ id: record.id, ownerSessionId, lifecycle: "delete-pending", at: now.toISOString() });
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: record.objectKey }));
    await this.records.transitionObjectReference({ id: record.id, ownerSessionId, lifecycle: "deleted", at: now.toISOString() });
    await this.records.createAudit({ eventKind: "object-delete", objectReferenceId: record.id, outcome: "accepted", createdAt: now.toISOString() });
  }
}
