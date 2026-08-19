import "server-only";

import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { binaryDigest, semanticDigest, type BinaryDigest } from "../../domain/digest/canonical";
import type { GovernanceStore, ObjectPublicationGenerationRecord, ObjectReferenceRecord, PrivateRowId } from "../persistence/store";
import { generateOpaqueToken } from "../security/crypto-core";
import type { OwnedObjectPut, OwnedObjectRead, OwnedObjectStore } from "./owned-object-store";

function validContentType(value: string): boolean { return /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/iu.test(value); }
const PUBLICATION_LEASE_MS = 5 * 60 * 1_000;
const PUBLICATION_CLEANUP_LEASE_MS = 5 * 60 * 1_000;
type MaterializedGeneration = "exact" | "unknown" | "not-found";

async function logicalPublicationKey(ownerSessionId: PrivateRowId, publicationId: string): Promise<string> {
  return `objects/${await semanticDigest({ projectionSchema: "hm-owned-object-logical-publication-v2", ownerSessionId, publicationId })}`;
}

async function physicalObjectKey(input: {
  readonly logicalPublicationKey: string;
  readonly publicationToken: string;
  readonly publicationGeneration: number;
}): Promise<string> {
  const authority = await semanticDigest({
    projectionSchema: "hm-owned-object-physical-generation-v1",
    logicalPublicationKey: input.logicalPublicationKey,
    publicationToken: input.publicationToken,
    publicationGeneration: input.publicationGeneration,
  });
  return `${input.logicalPublicationKey}/generations/${input.publicationGeneration}-${authority}`;
}

async function publicationAuthorityDigest(input: {
  readonly ownerSessionId: PrivateRowId;
  readonly logicalPublicationKey: string;
  readonly physicalObjectKey: string;
  readonly contentType: string;
  readonly byteSize: number;
  readonly binaryDigest: string;
  readonly publicationToken: string;
  readonly publicationGeneration: number;
}): Promise<string> {
  return semanticDigest({ projectionSchema: "hm-owned-object-publication-authority-v2", ...input });
}

function objectNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { readonly name?: string; readonly $metadata?: { readonly httpStatusCode?: number } };
  return candidate.name === "NotFound" || candidate.name === "NoSuchKey" || candidate.$metadata?.httpStatusCode === 404;
}

export class S3OwnedObjectStore implements OwnedObjectStore {
  constructor(private readonly client: S3Client, private readonly bucket: string, private readonly records: GovernanceStore) {}

  async put(input: OwnedObjectPut): Promise<ObjectReferenceRecord> {
    if (!validContentType(input.contentType)) throw new RangeError("OBJECT_CONTENT_TYPE_INVALID");
    if (input.publicationId.length < 1 || input.publicationId.length > 256) throw new RangeError("OBJECT_PUBLICATION_ID_INVALID");
    const bytes = Uint8Array.from(input.bytes);
    const digest = await binaryDigest(bytes);
    const logicalKey = await logicalPublicationKey(input.ownerSessionId, input.publicationId);
    const createdAt = new Date();
    const at = createdAt.toISOString();
    const publicationLeaseExpiresAt = new Date(createdAt.getTime() + PUBLICATION_LEASE_MS).toISOString();
    let publicationToken = generateOpaqueToken();
    let publicationGeneration = 1;
    let objectKey = await physicalObjectKey({ logicalPublicationKey: logicalKey, publicationToken, publicationGeneration });
    let reference: ObjectReferenceRecord;
    const exact = (candidate: ObjectReferenceRecord | undefined): candidate is ObjectReferenceRecord => candidate !== undefined
      && candidate.logicalPublicationKey === logicalKey && candidate.binaryDigest === digest
      && candidate.byteSize === bytes.byteLength && candidate.contentType === input.contentType
      && candidate.expiresAt === input.expiresAt;

    const prior = await this.records.findObjectReferenceByLogicalKey(logicalKey, input.ownerSessionId);
    if (prior) {
      if (!exact(prior)) throw new RangeError("OBJECT_PUBLICATION_CONFLICT");
      if (prior.lifecycle === "active") return prior;
      if (prior.lifecycle === "deleted" || prior.lifecycle === "tombstone-pending") {
        publicationGeneration = (prior.publicationGeneration ?? 0) + 1;
        objectKey = await physicalObjectKey({ logicalPublicationKey: logicalKey, publicationToken, publicationGeneration });
        let restarted: boolean;
        try {
          restarted = await this.records.restartObjectPublication({
            id: prior.id, ownerSessionId: input.ownerSessionId, logicalPublicationKey: logicalKey, objectKey,
            contentType: input.contentType, byteSize: bytes.byteLength, binaryDigest: digest, publicationToken,
            publicationLeaseExpiresAt, at,
          });
        } catch (error) {
          const inspected = await this.records.findObjectReference(prior.id, input.ownerSessionId).catch(() => undefined);
          if (!exact(inspected) || inspected.lifecycle !== "upload-pending" || inspected.publicationToken !== publicationToken
            || inspected.publicationGeneration !== publicationGeneration || inspected.objectKey !== objectKey) throw error;
          restarted = true;
        }
        if (!restarted) throw new RangeError("OBJECT_PUBLICATION_PENDING");
        const restartedReference = await this.records.findObjectReference(prior.id, input.ownerSessionId);
        if (!exact(restartedReference) || restartedReference.lifecycle !== "upload-pending"
          || restartedReference.publicationToken !== publicationToken || restartedReference.publicationGeneration !== publicationGeneration
          || restartedReference.objectKey !== objectKey) throw new RangeError("OBJECT_PUBLICATION_PENDING");
        reference = restartedReference;
      } else {
        if (prior.lifecycle !== "upload-pending" || !prior.publicationToken || prior.publicationGeneration === undefined) {
          throw new RangeError("OBJECT_PUBLICATION_PENDING");
        }
        publicationToken = prior.publicationToken;
        publicationGeneration = prior.publicationGeneration;
        const generation = await this.records.findObjectPublicationGeneration({ id: prior.id, ownerSessionId: input.ownerSessionId, publicationGeneration });
        if (!generation || generation.publicationToken !== publicationToken || generation.physicalObjectKey !== prior.objectKey) {
          throw new RangeError("OBJECT_PUBLICATION_PENDING");
        }
        objectKey = generation.physicalObjectKey;
        if (generation.publicationPutMayStillComplete) {
          if (await this.inspectMaterializedGeneration(prior, generation) !== "exact") throw new RangeError("OBJECT_PUBLICATION_PENDING");
          const disposition = await this.records.completeObjectPublication({
            id: prior.id, ownerSessionId: input.ownerSessionId, objectKey, publicationToken, publicationGeneration,
            materialized: true, at,
          });
          const recovered = await this.records.findObjectReference(prior.id, input.ownerSessionId);
          if (disposition === "active" && exact(recovered) && recovered.lifecycle === "active") return recovered;
          if (disposition === "delete-required") {
            await this.reconcileGeneration(prior.id, input.ownerSessionId, publicationGeneration, createdAt);
            const active = await this.records.findObjectReference(prior.id, input.ownerSessionId);
            if (exact(active) && active.lifecycle === "active") return active;
            throw new Error("OBJECT_PUBLICATION_DELETED");
          }
          throw new RangeError("OBJECT_PUBLICATION_PENDING");
        }
        let begun: boolean;
        try {
          begun = await this.records.beginObjectPublicationAttempt({
            id: prior.id, ownerSessionId: input.ownerSessionId, publicationToken, publicationGeneration,
            publicationLeaseExpiresAt, at,
          });
        } catch (error) {
          const inspected = await this.records.findObjectPublicationGeneration({ id: prior.id, ownerSessionId: input.ownerSessionId, publicationGeneration }).catch(() => undefined);
          if (!inspected?.publicationPutMayStillComplete || inspected.publicationToken !== publicationToken) throw error;
          begun = true;
        }
        if (!begun) throw new RangeError("OBJECT_PUBLICATION_PENDING");
        reference = prior;
      }
    } else {
      const publicationInput = {
        ownerSessionId: input.ownerSessionId, logicalPublicationKey: logicalKey, objectKey,
        contentType: input.contentType, byteSize: bytes.byteLength, binaryDigest: digest,
        lifecycle: "upload-pending" as const, publicationToken, publicationLeaseExpiresAt,
        publicationGeneration, publicationPutMayStillComplete: true, createdAt: at,
        ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
      };
      try {
        reference = await this.records.createObjectReference(publicationInput);
      } catch (error) {
        const inspected = await this.records.findObjectReferenceByLogicalKey(logicalKey, input.ownerSessionId).catch(() => undefined);
        if (!exact(inspected)) throw error;
        if (inspected.lifecycle === "active") return inspected;
        if (inspected.lifecycle !== "upload-pending" || inspected.publicationToken !== publicationToken
          || inspected.publicationGeneration !== publicationGeneration || inspected.objectKey !== objectKey) throw error;
        reference = inspected;
      }
    }

    const authorityDigest = await publicationAuthorityDigest({
      ownerSessionId: input.ownerSessionId, logicalPublicationKey: logicalKey, physicalObjectKey: objectKey,
      contentType: input.contentType, byteSize: bytes.byteLength, binaryDigest: digest, publicationToken, publicationGeneration,
    });
    const command = new PutObjectCommand({
      Bucket: this.bucket, Key: objectKey, Body: bytes, ContentType: input.contentType,
      Metadata: {
        "hm-sha256": digest, "hm-byte-size": String(bytes.byteLength),
        "hm-publication-generation": String(publicationGeneration),
        "hm-publication-authority-digest": authorityDigest,
        ...(input.expiresAt ? { "hm-expires-at": input.expiresAt } : {}),
      },
    });
    try {
      await this.client.send(command);
    } catch (error) {
      // send() rejection is outcome-uncertain. This generation and its unique physical key remain durable.
      const active = await this.records.findObjectReference(reference.id, input.ownerSessionId).catch(() => undefined);
      if (exact(active) && active.lifecycle === "active") return active;
      throw error;
    }

    let disposition: "active" | "delete-required" | "superseded";
    try {
      disposition = await this.records.completeObjectPublication({
        id: reference.id, ownerSessionId: input.ownerSessionId, objectKey, publicationToken, publicationGeneration,
        materialized: true, at: new Date().toISOString(),
      });
    } catch (error) {
      const inspected = await this.records.findObjectReference(reference.id, input.ownerSessionId).catch(() => undefined);
      if (exact(inspected) && inspected.lifecycle === "active" && inspected.objectKey === objectKey) return inspected;
      const generation = await this.records.findObjectPublicationGeneration({ id: reference.id, ownerSessionId: input.ownerSessionId, publicationGeneration }).catch(() => undefined);
      if (inspected && generation && await this.inspectMaterializedGeneration(inspected, generation) === "exact") {
        const settled = await this.records.settleObjectPublicationPut({
          id: reference.id, ownerSessionId: input.ownerSessionId, objectKey, publicationToken, publicationGeneration,
          materialized: true, at: new Date().toISOString(),
        }).catch(() => "superseded" as const);
        if (settled === "active") {
          const active = await this.records.findObjectReference(reference.id, input.ownerSessionId).catch(() => undefined);
          if (exact(active) && active.lifecycle === "active") return active;
        }
        if (settled === "delete-required") {
          await this.reconcileGeneration(reference.id, input.ownerSessionId, publicationGeneration, new Date()).catch(() => undefined);
        }
      }
      throw error;
    }
    const inspected = await this.records.findObjectReference(reference.id, input.ownerSessionId);
    if (disposition === "active" && exact(inspected) && inspected.lifecycle === "active" && inspected.objectKey === objectKey) return inspected;
    if (disposition === "delete-required") {
      await this.reconcileGeneration(reference.id, input.ownerSessionId, publicationGeneration, new Date());
      const active = await this.records.findObjectReference(reference.id, input.ownerSessionId);
      if (exact(active) && active.lifecycle === "active") return active;
      throw new Error("OBJECT_PUBLICATION_DELETED");
    }
    if (exact(inspected) && inspected.lifecycle === "active") return inspected;
    throw new Error("OBJECT_PUBLICATION_SUPERSEDED");
  }

  private async inspectMaterializedGeneration(reference: ObjectReferenceRecord, generation: ObjectPublicationGenerationRecord): Promise<MaterializedGeneration> {
    let response;
    try {
      response = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: generation.physicalObjectKey }));
    } catch (error) {
      if (objectNotFound(error)) return "not-found";
      throw error;
    }
    const authorityDigest = await publicationAuthorityDigest({
      ownerSessionId: reference.ownerSessionId, logicalPublicationKey: reference.logicalPublicationKey,
      physicalObjectKey: generation.physicalObjectKey, contentType: reference.contentType,
      byteSize: reference.byteSize, binaryDigest: reference.binaryDigest,
      publicationToken: generation.publicationToken, publicationGeneration: generation.publicationGeneration,
    });
    return response.ContentLength === reference.byteSize && response.ContentType === reference.contentType
      && response.Metadata?.["hm-sha256"] === reference.binaryDigest
      && response.Metadata?.["hm-byte-size"] === String(reference.byteSize)
      && response.Metadata?.["hm-publication-generation"] === String(generation.publicationGeneration)
      && response.Metadata?.["hm-publication-authority-digest"] === authorityDigest ? "exact" : "unknown";
  }

  private async reconcileGeneration(referenceId: PrivateRowId, ownerSessionId: PrivateRowId, publicationGeneration: number, now: Date): Promise<void> {
    let reference = await this.records.findObjectReference(referenceId, ownerSessionId);
    let generation = await this.records.findObjectPublicationGeneration({ id: referenceId, ownerSessionId, publicationGeneration });
    if (!reference || !generation || generation.deletedAt) return;
    if (reference.publicationGeneration === publicationGeneration && reference.lifecycle === "active") return;
    if (await this.inspectMaterializedGeneration(reference, generation) === "exact") {
      const disposition = await this.records.settleObjectPublicationPut({
        id: reference.id, ownerSessionId, objectKey: generation.physicalObjectKey,
        publicationToken: generation.publicationToken, publicationGeneration, materialized: true, at: now.toISOString(),
      });
      if (disposition === "active" || disposition === "superseded") return;
      reference = await this.records.findObjectReference(referenceId, ownerSessionId);
      generation = await this.records.findObjectPublicationGeneration({ id: referenceId, ownerSessionId, publicationGeneration });
      if (!reference || !generation || generation.deletedAt) return;
    }
    const cleanupToken = generateOpaqueToken();
    const claimed = await this.records.claimObjectPublicationCleanup({
      id: reference.id, ownerSessionId, objectKey: generation.physicalObjectKey, publicationGeneration,
      publicationCleanupToken: cleanupToken,
      publicationCleanupLeaseExpiresAt: new Date(now.getTime() + PUBLICATION_CLEANUP_LEASE_MS).toISOString(), now: now.toISOString(),
    });
    if (!claimed) return;
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: generation.physicalObjectKey }));
    } catch (error) {
      await this.records.markObjectPublicationDeleteUncertain({
        id: reference.id, ownerSessionId, objectKey: generation.physicalObjectKey, publicationGeneration,
        publicationCleanupToken: cleanupToken, at: new Date().toISOString(),
      }).catch(() => undefined);
      throw error;
    }
    const completed = await this.records.completeObjectPublicationCleanup({
      id: reference.id, ownerSessionId, objectKey: generation.physicalObjectKey, publicationGeneration,
      publicationCleanupToken: cleanupToken, at: new Date().toISOString(),
    });
    if (completed === "reference-deleted") {
      await this.records.createAudit({ eventKind: "object-delete", objectReferenceId: reference.id, outcome: "accepted", createdAt: new Date().toISOString() });
    }
  }

  private async reconcileReference(referenceId: PrivateRowId, ownerSessionId: PrivateRowId, now: Date): Promise<void> {
    const reference = await this.records.findObjectReference(referenceId, ownerSessionId);
    if (!reference) return;
    const generations = await this.records.listObjectPublicationGenerations({ id: referenceId, ownerSessionId });
    for (const generation of generations) {
      if (generation.deletedAt) continue;
      if (generation.publicationGeneration === reference.publicationGeneration && reference.lifecycle === "active") continue;
      await this.reconcileGeneration(referenceId, ownerSessionId, generation.publicationGeneration, now);
    }
  }

  private async owned(referenceId: PrivateRowId, ownerSessionId: PrivateRowId): Promise<{
    readonly reference: ObjectReferenceRecord;
    readonly generation: ObjectPublicationGenerationRecord;
  }> {
    const reference = await this.records.findObjectReference(referenceId, ownerSessionId);
    if (!reference || reference.lifecycle !== "active" || reference.publicationGeneration === undefined) throw new RangeError("OBJECT_UNAVAILABLE");
    const generation = await this.records.findObjectPublicationGeneration({ id: referenceId, ownerSessionId, publicationGeneration: reference.publicationGeneration });
    if (!generation || generation.physicalObjectKey !== reference.objectKey || generation.deletedAt) throw new RangeError("OBJECT_INTEGRITY_FAILED");
    if (await this.inspectMaterializedGeneration(reference, generation) !== "exact") throw new RangeError("OBJECT_INTEGRITY_FAILED");
    return { reference, generation };
  }

  async get(referenceId: PrivateRowId, ownerSessionId: PrivateRowId): Promise<OwnedObjectRead> {
    const { reference, generation } = await this.owned(referenceId, ownerSessionId);
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: generation.physicalObjectKey }));
    if (!response.Body) throw new RangeError("OBJECT_UNAVAILABLE");
    const bytes = Uint8Array.from(await response.Body.transformToByteArray());
    const digest = await binaryDigest(bytes);
    if (bytes.byteLength !== reference.byteSize || digest !== reference.binaryDigest || response.ContentType !== reference.contentType) {
      throw new RangeError("OBJECT_INTEGRITY_FAILED");
    }
    return { bytes, contentType: reference.contentType, binaryDigest: digest };
  }

  async head(referenceId: PrivateRowId, ownerSessionId: PrivateRowId): Promise<{
    readonly contentType: string;
    readonly binaryDigest: BinaryDigest;
    readonly byteSize: number;
    readonly expiresAt?: string;
  }> {
    const { reference } = await this.owned(referenceId, ownerSessionId);
    return { contentType: reference.contentType, binaryDigest: reference.binaryDigest as BinaryDigest,
      byteSize: reference.byteSize, ...(reference.expiresAt ? { expiresAt: reference.expiresAt } : {}) };
  }

  /** Cleanup entry point: old generations are reconciled without changing an active current generation. */
  async cleanup(referenceId: PrivateRowId, ownerSessionId: PrivateRowId, now = new Date()): Promise<void> {
    await this.reconcileReference(referenceId, ownerSessionId, now);
  }

  async delete(referenceId: PrivateRowId, ownerSessionId: PrivateRowId, now = new Date()): Promise<void> {
    const reference = await this.records.findObjectReference(referenceId, ownerSessionId);
    if (!reference || reference.lifecycle === "deleted") return;
    if (reference.lifecycle === "active") {
      await this.records.transitionObjectReference({ id: reference.id, ownerSessionId, lifecycle: "delete-pending", at: now.toISOString() });
    }
    await this.reconcileReference(referenceId, ownerSessionId, now);
  }
}
