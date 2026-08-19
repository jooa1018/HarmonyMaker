import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { S3Client } from "@aws-sdk/client-s3";
import { CleanupService } from "../cleanup/cleanup-service";
import { MemoryGovernanceStore } from "../persistence/memory-store.test-adapter";
import type { PrivateRowId } from "../persistence/store";
import { S3OwnedObjectStore } from "./s3-owned-object-store";
import type { GovernanceStore } from "../persistence/store";

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

interface FakeMaterializedObject {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly metadata: Record<string, string>;
}

class ControllableGenerationS3 {
  readonly objects = new Map<string, FakeMaterializedObject>();
  readonly putStarted = [deferred(), deferred()];
  readonly putGates = [deferred(), deferred()];
  readonly putMetadata: Record<string, string>[] = [];
  readonly deletes: Array<{ readonly key: string; readonly generation?: string }> = [];
  failDeleteGeneration?: string;
  private failedDelete = false;
  private putCalls = 0;

  async send(command: { readonly constructor: { readonly name: string }; readonly input: Record<string, unknown> }): Promise<Record<string, unknown>> {
    const key = String(command.input.Key);
    if (command.constructor.name === "PutObjectCommand") {
      const index = this.putCalls;
      this.putCalls += 1;
      const metadata = command.input.Metadata as Record<string, string>;
      this.putMetadata.push(metadata);
      this.putStarted[index]?.resolve();
      await this.putGates[index]?.promise;
      this.objects.set(key, {
        bytes: Uint8Array.from(command.input.Body as Uint8Array),
        contentType: String(command.input.ContentType),
        metadata,
      });
      return {};
    }
    if (command.constructor.name === "HeadObjectCommand") {
      const object = this.objects.get(key);
      if (!object) throw Object.assign(new Error("not found"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
      return { ContentLength: object.bytes.byteLength, ContentType: object.contentType, Metadata: object.metadata };
    }
    if (command.constructor.name === "DeleteObjectCommand") {
      const generation = this.objects.get(key)?.metadata["hm-publication-generation"];
      this.deletes.push({ key, ...(generation ? { generation } : {}) });
      if (!this.failedDelete && this.failDeleteGeneration !== undefined && generation === this.failDeleteGeneration) {
        this.failedDelete = true;
        throw new Error(`generation ${generation} delete failed`);
      }
      this.objects.delete(key);
    }
    return {};
  }
}

class RejectedDeferredGenerationS3 {
  readonly objects = new Map<string, FakeMaterializedObject>();
  readonly putStarted = [deferred(), deferred()];
  readonly materializationGates = [deferred(), deferred()];
  readonly materialized = [deferred(), deferred()];
  readonly putMetadata: Record<string, string>[] = [];
  readonly deletes: Array<{ readonly key: string; readonly generation?: string }> = [];
  failDeleteGeneration?: string;
  private failedDelete = false;
  private putCalls = 0;

  async send(command: { readonly constructor: { readonly name: string }; readonly input: Record<string, unknown> }): Promise<Record<string, unknown>> {
    const key = String(command.input.Key);
    if (command.constructor.name === "PutObjectCommand") {
      const index = this.putCalls;
      this.putCalls += 1;
      const object = {
        bytes: Uint8Array.from(command.input.Body as Uint8Array),
        contentType: String(command.input.ContentType),
        metadata: command.input.Metadata as Record<string, string>,
      };
      this.putMetadata.push(object.metadata);
      this.putStarted[index]?.resolve();
      void this.materializationGates[index]?.promise.then(() => {
        this.objects.set(key, object);
        this.materialized[index]?.resolve();
      });
      throw new TypeError(`response lost for generation ${index + 1}`);
    }
    if (command.constructor.name === "HeadObjectCommand") {
      const object = this.objects.get(key);
      if (!object) throw Object.assign(new Error("not found"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
      return { ContentLength: object.bytes.byteLength, ContentType: object.contentType, Metadata: object.metadata };
    }
    if (command.constructor.name === "DeleteObjectCommand") {
      const generation = this.objects.get(key)?.metadata["hm-publication-generation"];
      this.deletes.push({ key, ...(generation ? { generation } : {}) });
      if (!this.failedDelete && this.failDeleteGeneration !== undefined && generation === this.failDeleteGeneration) {
        this.failedDelete = true;
        throw new Error(`generation ${generation} delete failed`);
      }
      this.objects.delete(key);
    }
    return {};
  }
}

class AmbiguousDeleteGenerationS3 {
  readonly objects = new Map<string, FakeMaterializedObject>();
  readonly putStarted = [deferred(), deferred(), deferred()];
  readonly putGates = [deferred(), deferred(), deferred()];
  readonly putKeys: string[] = [];
  readonly keyGenerations = new Map<string, string>();
  readonly deleteTargets: string[] = [];
  readonly delayedDeleteGate = deferred();
  readonly delayedDeleteApplied = deferred();
  ambiguousDeleteGeneration?: string;
  applyAmbiguousDelete = true;
  failRetryGeneration?: string;
  private putCalls = 0;
  private ambiguousDeleteIssued = false;
  private retryFailureIssued = false;

  async send(command: { readonly constructor: { readonly name: string }; readonly input: Record<string, unknown> }): Promise<Record<string, unknown>> {
    const key = String(command.input.Key);
    if (command.constructor.name === "PutObjectCommand") {
      const index = this.putCalls++;
      const metadata = command.input.Metadata as Record<string, string>;
      this.putKeys.push(key);
      this.keyGenerations.set(key, metadata["hm-publication-generation"]);
      this.putStarted[index]?.resolve();
      await this.putGates[index]?.promise;
      this.objects.set(key, {
        bytes: Uint8Array.from(command.input.Body as Uint8Array),
        contentType: String(command.input.ContentType),
        metadata,
      });
      return {};
    }
    if (command.constructor.name === "HeadObjectCommand") {
      const object = this.objects.get(key);
      if (!object) throw Object.assign(new Error("not found"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
      return { ContentLength: object.bytes.byteLength, ContentType: object.contentType, Metadata: object.metadata };
    }
    if (command.constructor.name === "GetObjectCommand") {
      const object = this.objects.get(key);
      if (!object) throw Object.assign(new Error("not found"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
      return { ContentType: object.contentType, Body: { transformToByteArray: async () => object.bytes } };
    }
    if (command.constructor.name === "DeleteObjectCommand") {
      const generation = this.keyGenerations.get(key);
      this.deleteTargets.push(key);
      if (!this.ambiguousDeleteIssued && generation === this.ambiguousDeleteGeneration && this.objects.has(key)) {
        this.ambiguousDeleteIssued = true;
        void this.delayedDeleteGate.promise.then(() => {
          if (this.applyAmbiguousDelete) this.objects.delete(key);
          this.delayedDeleteApplied.resolve();
        });
        throw new TypeError(`delete response lost for generation ${generation}`);
      }
      if (!this.retryFailureIssued && generation === this.failRetryGeneration) {
        this.retryFailureIssued = true;
        throw new Error(`delete retry failed for generation ${generation}`);
      }
      this.objects.delete(key);
    }
    return {};
  }
}

describe("production S3-compatible request construction", () => {
  it("uses private point operations only and verifies metadata", async () => {
    const commands: Array<{ constructor: { name: string }; input: Record<string, unknown> }> = [];
    const bytes = new TextEncoder().encode("s3 fixture");
    const fake = { send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      commands.push(command);
      if (command.constructor.name === "HeadObjectCommand") {
        const put = commands.find((item) => item.constructor.name === "PutObjectCommand")!;
        return { ContentLength: bytes.byteLength, ContentType: "application/octet-stream", Metadata: put.input.Metadata };
      }
      if (command.constructor.name === "GetObjectCommand") return { ContentType: "application/octet-stream", Body: { transformToByteArray: async () => bytes } };
      return {};
    } } as unknown as S3Client;
    const records = new MemoryGovernanceStore();
    const store = new S3OwnedObjectStore(fake, "private-bucket", records);
    const owner = "private-owner" as PrivateRowId;
    const created = await store.put({ ownerSessionId: owner, publicationId: "request-construction", bytes, contentType: "application/octet-stream" });
    await expect(store.head(created.id, owner)).resolves.toMatchObject({ byteSize: bytes.byteLength });
    await expect(store.get(created.id, owner)).resolves.toMatchObject({ bytes });
    await store.delete(created.id, owner);
    expect(commands.map((command) => command.constructor.name)).toEqual([
      "PutObjectCommand", "HeadObjectCommand", "HeadObjectCommand", "GetObjectCommand", "HeadObjectCommand", "DeleteObjectCommand",
    ]);
    expect(commands.some((command) => command.constructor.name.includes("List"))).toBe(false);
    const put = commands[0].input;
    expect(put.Key).toMatch(/^objects\/[0-9a-f]{64}\/generations\/1-[0-9a-f]{64}$/u);
    expect(put).toMatchObject({ Bucket: "private-bucket", ContentType: "application/octet-stream" });
    expect(put.Metadata).toMatchObject({
      "hm-publication-generation": "1",
      "hm-publication-authority-digest": expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
  });

  it("leaves a failed S3 deletion pending and completes it idempotently on retry", async () => {
    let deleteAttempts = 0;
    const fake = { send: async (command: { constructor: { name: string } }) => {
      if (command.constructor.name === "DeleteObjectCommand") {
        deleteAttempts += 1;
        if (deleteAttempts === 1) throw new Error("S3_DELETE_FAILED");
      }
      return {};
    } } as unknown as S3Client;
    const records = new MemoryGovernanceStore();
    const store = new S3OwnedObjectStore(fake, "private-bucket", records);
    const owner = "private-owner" as PrivateRowId;
    const publication = { ownerSessionId: owner, publicationId: "delete-retry", bytes: Uint8Array.of(1), contentType: "application/octet-stream" } as const;
    const created = await store.put(publication);
    await expect(store.delete(created.id, owner, new Date("2026-01-01T00:00:00.000Z"))).rejects.toThrow("S3_DELETE_FAILED");
    expect(records.objects.get(created.id)?.lifecycle).toBe("delete-pending");
    await expect(store.delete(created.id, owner, new Date("2026-01-01T00:00:01.000Z"))).resolves.toBeUndefined();
    expect(records.objects.get(created.id)?.lifecycle).toBe("deleted");
    expect(records.audits).toEqual([expect.objectContaining({ eventKind: "object-delete", objectReferenceId: created.id, outcome: "accepted" })]);
    await store.delete(created.id, owner, new Date("2026-01-01T00:00:02.000Z"));
    expect(deleteAttempts).toBe(2);
    expect(records.audits).toHaveLength(1);
    const republished = await store.put(publication);
    expect(republished).toMatchObject({ id: created.id, logicalPublicationKey: created.logicalPublicationKey, lifecycle: "active" });
    expect(republished.objectKey).not.toBe(created.objectKey);
  });

  it("keeps Put acknowledgement loss discoverable and resumes the exact key after restart", async () => {
    const objects = new Map<string, FakeMaterializedObject>();
    const calls: string[] = [];
    const fake = { send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      calls.push(command.constructor.name);
      const key = String(command.input.Key);
      if (command.constructor.name === "PutObjectCommand") {
        objects.set(key, {
          bytes: Uint8Array.from(command.input.Body as Uint8Array),
          contentType: String(command.input.ContentType),
          metadata: command.input.Metadata as Record<string, string>,
        });
        throw new TypeError("put acknowledgement lost");
      }
      if (command.constructor.name === "HeadObjectCommand") {
        const object = objects.get(key);
        if (!object) throw Object.assign(new Error("not found"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
        return { ContentLength: object.bytes.byteLength, ContentType: object.contentType, Metadata: object.metadata };
      }
      if (command.constructor.name === "DeleteObjectCommand") objects.delete(key);
      return {};
    } } as unknown as S3Client;
    const records = new MemoryGovernanceStore();
    const owner = "publication-owner" as PrivateRowId;
    const firstProcess = new S3OwnedObjectStore(fake, "private-bucket", records);
    const publication = { ownerSessionId: owner, publicationId: "restart-stable-publication", bytes: Uint8Array.of(7, 8, 9), contentType: "application/octet-stream" } as const;
    await expect(firstProcess.put(publication)).rejects.toThrow("put acknowledgement lost");
    expect([...records.objects.values()]).toEqual([expect.objectContaining({
      lifecycle: "upload-pending",
      publicationToken: expect.any(String),
      publicationGeneration: 1,
      publicationPutMayStillComplete: true,
    })]);
    expect(objects.size).toBe(1);

    const restarted = new S3OwnedObjectStore(fake, "private-bucket", records);
    const recovered = await restarted.put(publication);
    expect(recovered.lifecycle).toBe("active");
    expect(objects.size).toBe(1);
    expect([...records.objects.values()]).toHaveLength(1);
    expect([...records.objects.values()][0]).toMatchObject({ lifecycle: "active", objectKey: recovered.objectKey });
    expect(calls.filter((name) => name === "PutObjectCommand")).toHaveLength(1);
    expect(calls.filter((name) => name === "HeadObjectCommand")).toHaveLength(1);
    expect(calls.filter((name) => name === "DeleteObjectCommand")).toHaveLength(0);
  });

  it("recovers reference and activation commit acknowledgement loss without deleting the active object", async () => {
    for (const lostMethod of ["createObjectReference", "completeObjectPublication"] as const) {
      const commands: string[] = [];
      const fake = { send: async (command: { constructor: { name: string } }) => { commands.push(command.constructor.name); return {}; } } as unknown as S3Client;
      const records = new MemoryGovernanceStore();
      let loseOnce = true;
      const unstable = new Proxy(records, {
        get(target, property, receiver) {
          if (property === lostMethod) return async (...args: unknown[]) => {
            const result = await (target[lostMethod] as (...values: unknown[]) => Promise<unknown>)(...args);
            if (loseOnce) { loseOnce = false; throw new Error(`${lostMethod} acknowledgement lost`); }
            return result;
          };
          const value = Reflect.get(target, property, receiver) as unknown;
          return typeof value === "function" ? value.bind(target) : value;
        },
      }) as GovernanceStore;
      const store = new S3OwnedObjectStore(fake, "private-bucket", unstable);
      const owner = `owner:${lostMethod}` as PrivateRowId;
      const reference = await store.put({ ownerSessionId: owner, publicationId: `ack-loss:${lostMethod}`, bytes: Uint8Array.of(1), contentType: "application/octet-stream" });
      expect(reference.lifecycle).toBe("active");
      expect(records.objects.get(reference.id)).toMatchObject({ lifecycle: "active", publicationToken: undefined, publicationLeaseExpiresAt: undefined });
      expect(commands.filter((name) => name === "PutObjectCommand")).toHaveLength(1);
      expect(commands).not.toContain("DeleteObjectCommand");
    }
  });

  it("does not create an external object when durable publication intent definitively fails", async () => {
    const fake = { send: vi.fn(async () => ({})) } as unknown as S3Client;
    const records = new MemoryGovernanceStore();
    const unavailable = new Proxy(records, {
      get(target, property, receiver) {
        if (property === "createObjectReference") return async () => { throw new Error("database unavailable"); };
        if (property === "findObjectReferenceByKey") return async () => undefined;
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as GovernanceStore;
    await expect(new S3OwnedObjectStore(fake, "private-bucket", unavailable).put({ ownerSessionId: "owner:db" as PrivateRowId, publicationId: "db-unavailable", bytes: Uint8Array.of(1), contentType: "application/octet-stream" })).rejects.toThrow("database unavailable");
    expect(fake.send).not.toHaveBeenCalled();
  });

  it("keeps a tombstone until a blocked Put materializes and completes the exact second delete", async () => {
    const gate = deferred();
    const putStarted = deferred();
    const objects = new Map<string, { readonly bytes: Uint8Array; readonly contentType: string; readonly metadata: Record<string, string> }>();
    const deletes: string[] = [];
    const records = new MemoryGovernanceStore();
    const fake = { send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      const key = String(command.input.Key);
      if (command.constructor.name === "PutObjectCommand") {
        putStarted.resolve();
        await gate.promise;
        objects.set(key, {
          bytes: Uint8Array.from(command.input.Body as Uint8Array),
          contentType: String(command.input.ContentType),
          metadata: command.input.Metadata as Record<string, string>,
        });
      }
      if (command.constructor.name === "HeadObjectCommand") {
        const object = objects.get(key);
        if (!object) throw Object.assign(new Error("not found"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
        return { ContentLength: object.bytes.byteLength, ContentType: object.contentType, Metadata: object.metadata };
      }
      if (command.constructor.name === "DeleteObjectCommand") { deletes.push(key); objects.delete(key); }
      return {};
    } } as unknown as S3Client;
    const owner = "late-put-owner" as PrivateRowId;
    const store = new S3OwnedObjectStore(fake, "private-bucket", records);
    const publication = { ownerSessionId: owner, publicationId: "late-put-cleanup", bytes: Uint8Array.of(9, 8, 7), contentType: "application/octet-stream" } as const;
    const pending = store.put(publication);
    await putStarted.promise;
    const staged = [...records.objects.values()][0];
    expect(staged).toMatchObject({ lifecycle: "upload-pending", publicationGeneration: 1, publicationPutMayStillComplete: true });

    await new CleanupService(records, store).run({ now: new Date("2030-01-01T00:00:00.000Z") });
    const tombstone = records.objects.get(staged.id);
    expect(tombstone).toMatchObject({ lifecycle: "tombstone-pending", publicationToken: staged.publicationToken, publicationDeleteConfirmedAt: expect.any(String) });
    expect(objects.size).toBe(0);
    expect(deletes).toEqual([staged.objectKey]);

    gate.resolve();
    await expect(pending).rejects.toThrow("OBJECT_PUBLICATION_DELETED");
    expect(objects.size).toBe(0);
    expect(deletes).toEqual([staged.objectKey, staged.objectKey]);
    expect(records.objects.get(staged.id)).toMatchObject({ lifecycle: "deleted", publicationPutMayStillComplete: false });
  });

  it("reclaims a late materialized Put after process replacement by inspecting the durable tombstone", async () => {
    const gate = deferred();
    const putStarted = deferred();
    const objects = new Map<string, { readonly bytes: Uint8Array; readonly contentType: string; readonly metadata: Record<string, string> }>();
    const records = new MemoryGovernanceStore();
    let processReplaced = false;
    const unstable = new Proxy(records, {
      get(target, property, receiver) {
        if (processReplaced && (property === "completeObjectPublication" || property === "settleObjectPublicationPut")) {
          return async () => { throw new Error("process replaced"); };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as GovernanceStore;
    const fake = { send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      const key = String(command.input.Key);
      if (command.constructor.name === "PutObjectCommand") {
        putStarted.resolve();
        await gate.promise;
        objects.set(key, {
          bytes: Uint8Array.from(command.input.Body as Uint8Array),
          contentType: String(command.input.ContentType),
          metadata: command.input.Metadata as Record<string, string>,
        });
      }
      if (command.constructor.name === "HeadObjectCommand") {
        const object = objects.get(key);
        if (!object) throw Object.assign(new Error("not found"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
        return { ContentLength: object.bytes.byteLength, ContentType: object.contentType, Metadata: object.metadata };
      }
      if (command.constructor.name === "DeleteObjectCommand") objects.delete(key);
      return {};
    } } as unknown as S3Client;
    const owner = "restart-late-put-owner" as PrivateRowId;
    const firstProcess = new S3OwnedObjectStore(fake, "private-bucket", unstable);
    const pending = firstProcess.put({ ownerSessionId: owner, publicationId: "restart-late-put", bytes: Uint8Array.of(1, 2), contentType: "application/octet-stream" });
    await putStarted.promise;
    await new CleanupService(records, firstProcess).run({ now: new Date("2030-01-01T00:00:00.000Z") });
    processReplaced = true;
    gate.resolve();
    await expect(pending).rejects.toThrow("process replaced");
    expect(objects.size).toBe(1);
    expect([...records.objects.values()][0]).toMatchObject({ lifecycle: "tombstone-pending", publicationPutMayStillComplete: true });

    const restarted = new S3OwnedObjectStore(fake, "private-bucket", records);
    await new CleanupService(records, restarted).run({ now: new Date("2030-01-01T00:01:00.000Z") });
    expect(objects.size).toBe(0);
    expect([...records.objects.values()][0]).toMatchObject({ lifecycle: "deleted", publicationPutMayStillComplete: false });
  });

  it("retains second-delete failure authority and retries the exact key after restart", async () => {
    const gate = deferred();
    const putStarted = deferred();
    const objects = new Map<string, { readonly bytes: Uint8Array; readonly contentType: string; readonly metadata: Record<string, string> }>();
    let deleteCalls = 0;
    let failLateDelete = true;
    const records = new MemoryGovernanceStore();
    const fake = { send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      const key = String(command.input.Key);
      if (command.constructor.name === "PutObjectCommand") {
        putStarted.resolve();
        await gate.promise;
        objects.set(key, {
          bytes: Uint8Array.from(command.input.Body as Uint8Array),
          contentType: String(command.input.ContentType),
          metadata: command.input.Metadata as Record<string, string>,
        });
      }
      if (command.constructor.name === "HeadObjectCommand") {
        const object = objects.get(key);
        if (!object) throw Object.assign(new Error("not found"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
        return { ContentLength: object.bytes.byteLength, ContentType: object.contentType, Metadata: object.metadata };
      }
      if (command.constructor.name === "DeleteObjectCommand") {
        deleteCalls += 1;
        if (deleteCalls > 1 && failLateDelete) throw new Error("late second delete failed");
        objects.delete(key);
      }
      return {};
    } } as unknown as S3Client;
    const owner = "late-delete-retry-owner" as PrivateRowId;
    const store = new S3OwnedObjectStore(fake, "private-bucket", records);
    const pending = store.put({ ownerSessionId: owner, publicationId: "late-delete-retry", bytes: Uint8Array.of(3), contentType: "application/octet-stream" });
    await putStarted.promise;
    await new CleanupService(records, store).run({ now: new Date("2030-01-01T00:00:00.000Z") });
    gate.resolve();
    await expect(pending).rejects.toThrow("late second delete failed");
    expect(objects.size).toBe(1);
    expect([...records.objects.values()][0]).toMatchObject({ lifecycle: "tombstone-pending", publicationToken: expect.any(String), publicationPutMayStillComplete: false });

    failLateDelete = false;
    await new CleanupService(records, new S3OwnedObjectStore(fake, "private-bucket", records)).run({ now: new Date("2030-01-01T00:01:00.000Z") });
    expect(objects.size).toBe(0);
    expect([...records.objects.values()][0].lifecycle).toBe("deleted");
  });

  it("keeps a rejected dispatched Put uncertain until its late materialization is deleted after restart", async () => {
    const s3 = new RejectedDeferredGenerationS3();
    const fake = s3 as unknown as S3Client;
    const records = new MemoryGovernanceStore();
    const owner = "rejected-late-owner" as PrivateRowId;
    const publication = { ownerSessionId: owner, publicationId: "rejected-late", bytes: Uint8Array.of(1, 9), contentType: "application/octet-stream" } as const;
    const rejected = expect(new S3OwnedObjectStore(fake, "private-bucket", records).put(publication))
      .rejects.toThrow("response lost for generation 1");
    await s3.putStarted[0].promise;
    await rejected;

    const staged = [...records.objects.values()][0];
    expect(staged).toMatchObject({
      lifecycle: "upload-pending",
      publicationGeneration: 1,
      publicationToken: expect.any(String),
      publicationPutMayStillComplete: true,
    });
    const token = staged.publicationToken;
    const cleanupAfterRestart = new CleanupService(records, new S3OwnedObjectStore(fake, "private-bucket", records));
    await cleanupAfterRestart.run({ now: new Date("2030-01-01T00:00:00.000Z") });
    expect(records.objects.get(staged.id)).toMatchObject({
      lifecycle: "tombstone-pending",
      publicationGeneration: 1,
      publicationToken: token,
      publicationPutMayStillComplete: true,
      publicationDeleteConfirmedAt: expect.any(String),
    });
    expect(s3.objects.size).toBe(0);
    expect(s3.deletes).toEqual([{ key: staged.objectKey }]);

    await cleanupAfterRestart.run({ now: new Date("2030-01-01T00:01:00.000Z") });
    expect(records.objects.get(staged.id)).toMatchObject({ lifecycle: "tombstone-pending", publicationToken: token, publicationPutMayStillComplete: true });
    expect(s3.deletes).toHaveLength(2);

    s3.materializationGates[0].resolve();
    await s3.materialized[0].promise;
    expect(s3.objects.size).toBe(1);
    await new CleanupService(records, new S3OwnedObjectStore(fake, "private-bucket", records))
      .run({ now: new Date("2030-01-01T00:02:00.000Z") });
    expect(s3.objects.size).toBe(0);
    expect(s3.deletes.filter((item) => item.generation === "1")).toHaveLength(1);
    expect(records.objects.get(staged.id)).toMatchObject({
      lifecycle: "deleted",
      publicationGeneration: 1,
      publicationToken: undefined,
      publicationPutMayStillComplete: false,
    });
  });

  it("reconciles rejected-before-materialization generations A and B independently", async () => {
    const s3 = new RejectedDeferredGenerationS3();
    const fake = s3 as unknown as S3Client;
    const records = new MemoryGovernanceStore();
    const owner = "rejected-generations-owner" as PrivateRowId;
    const publication = { ownerSessionId: owner, publicationId: "rejected-generations", bytes: Uint8Array.of(2, 8), contentType: "application/octet-stream" } as const;
    const rejectedA = expect(new S3OwnedObjectStore(fake, "private-bucket", records).put(publication))
      .rejects.toThrow("response lost for generation 1");
    await s3.putStarted[0].promise;
    await rejectedA;
    const stagedA = [...records.objects.values()][0];
    const tokenA = stagedA.publicationToken;
    await new CleanupService(records, new S3OwnedObjectStore(fake, "private-bucket", records))
      .run({ now: new Date("2030-01-01T00:00:00.000Z") });

    const rejectedB = expect(new S3OwnedObjectStore(fake, "private-bucket", records).put(publication))
      .rejects.toThrow("response lost for generation 2");
    await s3.putStarted[1].promise;
    await rejectedB;
    await new CleanupService(records, new S3OwnedObjectStore(fake, "private-bucket", records))
      .run({ now: new Date("2031-01-01T00:00:00.000Z") });
    const stagedB = records.objects.get(stagedA.id)!;
    const tokenB = stagedB.publicationToken;
    expect(stagedB).toMatchObject({
      lifecycle: "tombstone-pending",
      publicationGeneration: 2,
      publicationToken: expect.any(String),
      publicationPutMayStillComplete: true,
      publicationPredecessorToken: tokenA,
      publicationPredecessorGeneration: 1,
    });

    s3.materializationGates[0].resolve();
    await s3.materialized[0].promise;
    await new CleanupService(records, new S3OwnedObjectStore(fake, "private-bucket", records))
      .run({ now: new Date("2031-01-01T00:01:00.000Z") });
    expect(records.objects.get(stagedA.id)).toMatchObject({
      lifecycle: "tombstone-pending",
      publicationGeneration: 2,
      publicationToken: tokenB,
      publicationPutMayStillComplete: true,
      publicationPredecessorToken: undefined,
    });
    expect(s3.objects.size).toBe(0);
    expect(s3.deletes.filter((item) => item.generation === "1")).toHaveLength(1);

    s3.materializationGates[1].resolve();
    await s3.materialized[1].promise;
    await new CleanupService(records, new S3OwnedObjectStore(fake, "private-bucket", records))
      .run({ now: new Date("2031-01-01T00:02:00.000Z") });
    expect(s3.objects.size).toBe(0);
    expect(s3.deletes.filter((item) => item.generation === "2")).toHaveLength(1);
    expect(s3.putMetadata.map((metadata) => metadata["hm-publication-generation"])).toEqual(["1", "2"]);
    expect(records.objects.get(stagedA.id)).toMatchObject({
      lifecycle: "deleted",
      publicationGeneration: 2,
      publicationToken: undefined,
      publicationPutMayStillComplete: false,
      publicationPredecessorToken: undefined,
    });
  });

  it("retains rejected Put authority when exact late-materialization deletion fails", async () => {
    const s3 = new RejectedDeferredGenerationS3();
    s3.failDeleteGeneration = "1";
    const fake = s3 as unknown as S3Client;
    const records = new MemoryGovernanceStore();
    const owner = "rejected-delete-retry-owner" as PrivateRowId;
    const publication = { ownerSessionId: owner, publicationId: "rejected-delete-retry", bytes: Uint8Array.of(3, 7), contentType: "application/octet-stream" } as const;
    const rejected = expect(new S3OwnedObjectStore(fake, "private-bucket", records).put(publication))
      .rejects.toThrow("response lost for generation 1");
    await s3.putStarted[0].promise;
    await rejected;
    const staged = [...records.objects.values()][0];
    const token = staged.publicationToken;
    await new CleanupService(records, new S3OwnedObjectStore(fake, "private-bucket", records))
      .run({ now: new Date("2030-01-01T00:00:00.000Z") });
    s3.materializationGates[0].resolve();
    await s3.materialized[0].promise;

    const failed = await new CleanupService(records, new S3OwnedObjectStore(fake, "private-bucket", records))
      .run({ now: new Date("2030-01-01T00:01:00.000Z") });
    expect(failed.failures).toEqual([expect.objectContaining({ message: "generation 1 delete failed" })]);
    expect(s3.objects.size).toBe(1);
    expect(records.objects.get(staged.id)).toMatchObject({
      lifecycle: "tombstone-pending",
      publicationGeneration: 1,
      publicationToken: token,
      publicationPutMayStillComplete: false,
      publicationCleanupToken: undefined,
    });

    await new CleanupService(records, new S3OwnedObjectStore(fake, "private-bucket", records))
      .run({ now: new Date("2030-01-01T00:02:00.000Z") });
    expect(s3.objects.size).toBe(0);
    expect(s3.deletes.filter((item) => item.generation === "1")).toHaveLength(2);
    expect(records.objects.get(staged.id)).toMatchObject({ lifecycle: "deleted", publicationToken: undefined, publicationPutMayStillComplete: false });
  });

  it("reconciles two in-flight generations independently when predecessor A materializes before current B", async () => {
    const s3 = new ControllableGenerationS3();
    const fake = s3 as unknown as S3Client;
    const records = new MemoryGovernanceStore();
    const owner = "two-generation-owner" as PrivateRowId;
    const publication = { ownerSessionId: owner, publicationId: "two-generations", bytes: Uint8Array.of(4, 2), contentType: "application/octet-stream" } as const;
    const firstStore = new S3OwnedObjectStore(fake, "private-bucket", records);
    const first = firstStore.put(publication);
    await s3.putStarted[0].promise;
    const stagedA = [...records.objects.values()][0];
    await new CleanupService(records, firstStore).run({ now: new Date("2030-01-01T00:00:00.000Z") });
    expect(records.objects.get(stagedA.id)).toMatchObject({
      lifecycle: "tombstone-pending",
      publicationPutMayStillComplete: true,
      publicationDeleteConfirmedAt: expect.any(String),
    });

    const secondStore = new S3OwnedObjectStore(fake, "private-bucket", records);
    const second = secondStore.put(publication);
    await s3.putStarted[1].promise;
    await new CleanupService(records, secondStore).run({ now: new Date("2031-01-01T00:00:00.000Z") });
    const stagedB = records.objects.get(stagedA.id)!;
    expect(stagedB).toMatchObject({
      lifecycle: "tombstone-pending",
      publicationGeneration: 2,
      publicationToken: expect.any(String),
      publicationPutMayStillComplete: true,
      publicationPredecessorToken: stagedA.publicationToken,
      publicationPredecessorGeneration: 1,
    });
    const tokenB = stagedB.publicationToken;

    s3.putGates[0].resolve();
    await expect(first).rejects.toThrow("OBJECT_PUBLICATION_DELETED");
    const afterA = records.objects.get(stagedA.id)!;
    expect(afterA).toMatchObject({
      lifecycle: "tombstone-pending",
      publicationGeneration: 2,
      publicationToken: tokenB,
      publicationPutMayStillComplete: true,
      publicationPredecessorToken: undefined,
    });
    expect(s3.objects.size).toBe(0);
    expect(s3.deletes.filter((item) => item.generation === "1")).toHaveLength(1);

    s3.putGates[1].resolve();
    await expect(second).rejects.toThrow("OBJECT_PUBLICATION_DELETED");
    expect(s3.objects.size).toBe(0);
    expect(s3.deletes.filter((item) => item.generation === "2")).toHaveLength(1);
    expect(s3.putMetadata.map((metadata) => metadata["hm-publication-generation"])).toEqual(["1", "2"]);
    expect(new Set(s3.putMetadata.map((metadata) => metadata["hm-publication-authority-digest"])).size).toBe(2);
    expect(records.objects.get(stagedA.id)).toMatchObject({
      lifecycle: "deleted",
      publicationToken: undefined,
      publicationPutMayStillComplete: false,
      publicationPredecessorToken: undefined,
    });
  });

  it("recovers current generation B after it materializes and its process disappears", async () => {
    const s3 = new ControllableGenerationS3();
    const fake = s3 as unknown as S3Client;
    const records = new MemoryGovernanceStore();
    let bProcessGone = false;
    const unstableB = new Proxy(records, {
      get(target, property, receiver) {
        if (bProcessGone && (property === "completeObjectPublication" || property === "settleObjectPublicationPut")) {
          return async () => { throw new Error("generation B process disappeared"); };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as GovernanceStore;
    const owner = "generation-b-restart-owner" as PrivateRowId;
    const publication = { ownerSessionId: owner, publicationId: "generation-b-restart", bytes: Uint8Array.of(6), contentType: "application/octet-stream" } as const;
    const firstStore = new S3OwnedObjectStore(fake, "private-bucket", records);
    const first = firstStore.put(publication);
    await s3.putStarted[0].promise;
    await new CleanupService(records, firstStore).run({ now: new Date("2030-01-01T00:00:00.000Z") });
    const secondStore = new S3OwnedObjectStore(fake, "private-bucket", unstableB);
    const second = secondStore.put(publication);
    await s3.putStarted[1].promise;
    await new CleanupService(records, new S3OwnedObjectStore(fake, "private-bucket", records)).run({ now: new Date("2031-01-01T00:00:00.000Z") });

    s3.putGates[0].resolve();
    await expect(first).rejects.toThrow("OBJECT_PUBLICATION_DELETED");
    bProcessGone = true;
    s3.putGates[1].resolve();
    await expect(second).rejects.toThrow("generation B process disappeared");
    expect(s3.objects.size).toBe(1);
    expect([...records.objects.values()][0]).toMatchObject({ lifecycle: "tombstone-pending", publicationGeneration: 2, publicationPutMayStillComplete: true });

    await new CleanupService(records, new S3OwnedObjectStore(fake, "private-bucket", records)).run({ now: new Date("2031-01-01T00:01:00.000Z") });
    expect(s3.objects.size).toBe(0);
    expect([...records.objects.values()][0]).toMatchObject({ lifecycle: "deleted", publicationPutMayStillComplete: false });
    expect(s3.deletes.filter((item) => item.generation === "2")).toHaveLength(1);
  });

  it("recovers predecessor A by metadata without settling in-flight current B", async () => {
    const s3 = new ControllableGenerationS3();
    const fake = s3 as unknown as S3Client;
    const records = new MemoryGovernanceStore();
    let aProcessGone = false;
    const unstableA = new Proxy(records, {
      get(target, property, receiver) {
        if (aProcessGone && (property === "completeObjectPublication" || property === "settleObjectPublicationPut")) {
          return async () => { throw new Error("generation A process disappeared"); };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as GovernanceStore;
    const owner = "generation-a-restart-owner" as PrivateRowId;
    const publication = { ownerSessionId: owner, publicationId: "generation-a-restart", bytes: Uint8Array.of(8), contentType: "application/octet-stream" } as const;
    const firstStore = new S3OwnedObjectStore(fake, "private-bucket", unstableA);
    const first = firstStore.put(publication);
    await s3.putStarted[0].promise;
    await new CleanupService(records, new S3OwnedObjectStore(fake, "private-bucket", records)).run({ now: new Date("2030-01-01T00:00:00.000Z") });
    const secondStore = new S3OwnedObjectStore(fake, "private-bucket", records);
    const second = secondStore.put(publication);
    await s3.putStarted[1].promise;
    await new CleanupService(records, secondStore).run({ now: new Date("2031-01-01T00:00:00.000Z") });

    aProcessGone = true;
    s3.putGates[0].resolve();
    await expect(first).rejects.toThrow("generation A process disappeared");
    expect(s3.objects.size).toBe(1);
    await new CleanupService(records, new S3OwnedObjectStore(fake, "private-bucket", records)).run({ now: new Date("2031-01-01T00:01:00.000Z") });
    expect(s3.objects.size).toBe(0);
    expect([...records.objects.values()][0]).toMatchObject({
      lifecycle: "tombstone-pending",
      publicationGeneration: 2,
      publicationPutMayStillComplete: true,
      publicationPredecessorToken: undefined,
    });

    s3.putGates[1].resolve();
    await expect(second).rejects.toThrow("OBJECT_PUBLICATION_DELETED");
    expect(s3.objects.size).toBe(0);
    expect([...records.objects.values()][0].lifecycle).toBe("deleted");
  });

  it("retains current generation B cleanup authority when its attributed delete fails", async () => {
    const s3 = new ControllableGenerationS3();
    s3.failDeleteGeneration = "2";
    const fake = s3 as unknown as S3Client;
    const records = new MemoryGovernanceStore();
    const owner = "generation-b-delete-retry-owner" as PrivateRowId;
    const publication = { ownerSessionId: owner, publicationId: "generation-b-delete-retry", bytes: Uint8Array.of(7), contentType: "application/octet-stream" } as const;
    const firstStore = new S3OwnedObjectStore(fake, "private-bucket", records);
    const first = firstStore.put(publication);
    await s3.putStarted[0].promise;
    await new CleanupService(records, firstStore).run({ now: new Date("2030-01-01T00:00:00.000Z") });
    const secondStore = new S3OwnedObjectStore(fake, "private-bucket", records);
    const second = secondStore.put(publication);
    await s3.putStarted[1].promise;
    await new CleanupService(records, secondStore).run({ now: new Date("2031-01-01T00:00:00.000Z") });
    s3.putGates[0].resolve();
    await expect(first).rejects.toThrow("OBJECT_PUBLICATION_DELETED");
    s3.putGates[1].resolve();
    await expect(second).rejects.toThrow("generation 2 delete failed");
    expect(s3.objects.size).toBe(1);
    expect([...records.objects.values()][0]).toMatchObject({
      lifecycle: "tombstone-pending",
      publicationGeneration: 2,
      publicationToken: expect.any(String),
      publicationPutMayStillComplete: false,
      publicationCleanupToken: undefined,
    });

    await new CleanupService(records, new S3OwnedObjectStore(fake, "private-bucket", records)).run({ now: new Date("2031-01-01T00:01:00.000Z") });
    expect(s3.objects.size).toBe(0);
    expect([...records.objects.values()][0].lifecycle).toBe("deleted");
    expect(s3.deletes.filter((item) => item.generation === "2")).toHaveLength(2);
  });

  it("keeps malformed generation metadata under durable tombstone authority", async () => {
    const s3 = new ControllableGenerationS3();
    const fake = s3 as unknown as S3Client;
    const records = new MemoryGovernanceStore();
    let processGone = false;
    const unstable = new Proxy(records, {
      get(target, property, receiver) {
        if (processGone && (property === "completeObjectPublication" || property === "settleObjectPublicationPut")) {
          return async () => { throw new Error("process disappeared"); };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as GovernanceStore;
    const owner = "unknown-metadata-owner" as PrivateRowId;
    const store = new S3OwnedObjectStore(fake, "private-bucket", unstable);
    const pending = store.put({ ownerSessionId: owner, publicationId: "unknown-metadata", bytes: Uint8Array.of(3, 1), contentType: "application/octet-stream" });
    await s3.putStarted[0].promise;
    await new CleanupService(records, new S3OwnedObjectStore(fake, "private-bucket", records)).run({ now: new Date("2030-01-01T00:00:00.000Z") });
    processGone = true;
    s3.putGates[0].resolve();
    await expect(pending).rejects.toThrow("process disappeared");
    const object = [...s3.objects.values()][0];
    delete object.metadata["hm-publication-authority-digest"];

    await new CleanupService(records, new S3OwnedObjectStore(fake, "private-bucket", records)).run({ now: new Date("2030-01-01T00:01:00.000Z") });
    expect(s3.objects.size).toBe(0);
    expect([...records.objects.values()][0]).toMatchObject({ lifecycle: "tombstone-pending", publicationPutMayStillComplete: true });
  });

  it("adopts a newer generation without allowing the delayed predecessor to delete it", async () => {
    const gate = deferred();
    const firstPutStarted = deferred();
    const objects = new Map<string, Uint8Array>();
    const commands: string[] = [];
    let putCalls = 0;
    const records = new MemoryGovernanceStore();
    const fake = { send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      const key = String(command.input.Key);
      commands.push(command.constructor.name);
      if (command.constructor.name === "PutObjectCommand") {
        putCalls += 1;
        if (putCalls === 1) { firstPutStarted.resolve(); await gate.promise; }
        objects.set(key, Uint8Array.from(command.input.Body as Uint8Array));
      }
      if (command.constructor.name === "DeleteObjectCommand") objects.delete(key);
      return {};
    } } as unknown as S3Client;
    const owner = "generation-fence-owner" as PrivateRowId;
    const publication = { ownerSessionId: owner, publicationId: "generation-fence", bytes: Uint8Array.of(5, 5), contentType: "application/octet-stream" } as const;
    const first = new S3OwnedObjectStore(fake, "private-bucket", records).put(publication);
    await firstPutStarted.promise;
    await new CleanupService(records, new S3OwnedObjectStore(fake, "private-bucket", records)).run({ now: new Date("2030-01-01T00:00:00.000Z") });
    const second = await new S3OwnedObjectStore(fake, "private-bucket", records).put(publication);
    expect(second).toMatchObject({ lifecycle: "active", publicationGeneration: 2, publicationPredecessorToken: expect.any(String) });

    gate.resolve();
    await expect(first).resolves.toMatchObject({ id: second.id, lifecycle: "active" });
    expect(objects).toEqual(new Map([[second.objectKey, publication.bytes]]));
    expect(records.objects.get(second.id)).toMatchObject({ lifecycle: "active", publicationPredecessorToken: undefined });
    expect(commands.filter((name) => name === "DeleteObjectCommand")).toHaveLength(2);
  });

  it("isolates generation C from an ambiguous generation A delete that applies after C becomes active", async () => {
    const s3 = new AmbiguousDeleteGenerationS3();
    s3.ambiguousDeleteGeneration = "1";
    const fake = s3 as unknown as S3Client;
    const records = new MemoryGovernanceStore();
    const owner = "ambiguous-delete-isolation-owner" as PrivateRowId;
    const publication = { ownerSessionId: owner, publicationId: "ambiguous-delete-isolation", bytes: Uint8Array.of(9, 1), contentType: "application/octet-stream" } as const;

    const first = new S3OwnedObjectStore(fake, "private-bucket", records).put(publication);
    await s3.putStarted[0].promise;
    await new CleanupService(records, new S3OwnedObjectStore(fake, "private-bucket", records))
      .run({ now: new Date("2030-01-01T00:00:00.000Z") });
    const second = new S3OwnedObjectStore(fake, "private-bucket", records).put(publication);
    await s3.putStarted[1].promise;
    await new CleanupService(records, new S3OwnedObjectStore(fake, "private-bucket", records))
      .run({ now: new Date("2031-01-01T00:00:00.000Z") });

    s3.putGates[0].resolve();
    await expect(first).rejects.toThrow("delete response lost for generation 1");
    const referenceId = [...records.objects.values()][0].id;
    expect((await records.findObjectPublicationGeneration({ id: referenceId, ownerSessionId: owner, publicationGeneration: 1 }))?.deleteOutcome)
      .toBe("outcome-uncertain");

    const third = new S3OwnedObjectStore(fake, "private-bucket", records).put(publication);
    await s3.putStarted[2].promise;
    s3.putGates[2].resolve();
    const activeC = await third;
    expect(activeC).toMatchObject({ lifecycle: "active", publicationGeneration: 3 });
    expect(new Set(s3.putKeys).size).toBe(3);
    expect(s3.putKeys[0]).not.toBe(s3.putKeys[1]);
    expect(s3.putKeys[0]).not.toBe(s3.putKeys[2]);
    expect(s3.putKeys[1]).not.toBe(s3.putKeys[2]);
    await expect(new S3OwnedObjectStore(fake, "private-bucket", records).get(activeC.id, owner)).resolves.toMatchObject({ bytes: publication.bytes });

    s3.delayedDeleteGate.resolve();
    await s3.delayedDeleteApplied.promise;
    expect(s3.objects.has(s3.putKeys[0])).toBe(false);
    expect(s3.objects.has(activeC.objectKey)).toBe(true);
    await expect(new S3OwnedObjectStore(fake, "private-bucket", records).head(activeC.id, owner)).resolves.toMatchObject({ byteSize: 2 });

    s3.putGates[1].resolve();
    await expect(second).resolves.toMatchObject({ id: activeC.id, objectKey: activeC.objectKey, lifecycle: "active" });
    await new CleanupService(records, new S3OwnedObjectStore(fake, "private-bucket", records))
      .run({ now: new Date("2032-01-01T00:00:00.000Z") });
    expect(s3.objects).toEqual(new Map([[activeC.objectKey, expect.objectContaining({ bytes: publication.bytes })]]));
    expect(s3.deleteTargets).not.toContain(activeC.objectKey);
    const generations = await records.listObjectPublicationGenerations({ id: activeC.id, ownerSessionId: owner });
    expect(generations.map((generation) => ({ generation: generation.publicationGeneration, deleted: Boolean(generation.deletedAt) })))
      .toEqual([{ generation: 1, deleted: true }, { generation: 2, deleted: true }, { generation: 3, deleted: false }]);
  });

  it("recovers both applied and non-applied single-generation Delete acknowledgement loss", async () => {
    for (const remoteApplies of [true, false]) {
      const s3 = new AmbiguousDeleteGenerationS3();
      s3.ambiguousDeleteGeneration = "1";
      s3.applyAmbiguousDelete = remoteApplies;
      s3.putGates[0].resolve();
      const fake = s3 as unknown as S3Client;
      const records = new MemoryGovernanceStore();
      const owner = `single-delete-${remoteApplies}` as PrivateRowId;
      const store = new S3OwnedObjectStore(fake, "private-bucket", records);
      const created = await store.put({ ownerSessionId: owner, publicationId: "single-delete", bytes: Uint8Array.of(5), contentType: "application/octet-stream" });
      await expect(store.delete(created.id, owner, new Date("2030-01-01T00:00:00.000Z")))
        .rejects.toThrow("delete response lost for generation 1");
      expect((await records.findObjectPublicationGeneration({ id: created.id, ownerSessionId: owner, publicationGeneration: 1 }))?.deleteOutcome)
        .toBe("outcome-uncertain");
      s3.delayedDeleteGate.resolve();
      await s3.delayedDeleteApplied.promise;
      expect(s3.objects.has(created.objectKey)).toBe(!remoteApplies);

      await new CleanupService(records, new S3OwnedObjectStore(fake, "private-bucket", records))
        .run({ now: new Date("2030-01-01T00:01:00.000Z") });
      expect(s3.objects.size).toBe(0);
      expect(records.objects.get(created.id)?.lifecycle).toBe("deleted");
      expect((await records.findObjectPublicationGeneration({ id: created.id, ownerSessionId: owner, publicationGeneration: 1 })))
        .toMatchObject({ deleteOutcome: "acknowledged", deletedAt: expect.any(String) });
    }
  });

  it("reclaims a three-generation old-key delete retry after process replacement without touching active C", async () => {
    const s3 = new AmbiguousDeleteGenerationS3();
    s3.ambiguousDeleteGeneration = "1";
    const fake = s3 as unknown as S3Client;
    const records = new MemoryGovernanceStore();
    const owner = "three-generation-restart-owner" as PrivateRowId;
    const publication = { ownerSessionId: owner, publicationId: "three-generation-restart", bytes: Uint8Array.of(3, 3), contentType: "application/octet-stream" } as const;

    const first = new S3OwnedObjectStore(fake, "private-bucket", records).put(publication);
    await s3.putStarted[0].promise;
    await new CleanupService(records, new S3OwnedObjectStore(fake, "private-bucket", records)).run({ now: new Date("2030-01-01T00:00:00.000Z") });
    const second = new S3OwnedObjectStore(fake, "private-bucket", records).put(publication);
    await s3.putStarted[1].promise;
    await new CleanupService(records, new S3OwnedObjectStore(fake, "private-bucket", records)).run({ now: new Date("2031-01-01T00:00:00.000Z") });
    s3.putGates[0].resolve();
    await expect(first).rejects.toThrow("delete response lost for generation 1");

    const third = new S3OwnedObjectStore(fake, "private-bucket", records).put(publication);
    await s3.putStarted[2].promise;
    s3.putGates[2].resolve();
    const activeC = await third;
    s3.delayedDeleteGate.resolve();
    await s3.delayedDeleteApplied.promise;
    s3.failRetryGeneration = "2";
    s3.putGates[1].resolve();
    await expect(second).rejects.toThrow("delete retry failed for generation 2");
    expect((await records.findObjectPublicationGeneration({ id: activeC.id, ownerSessionId: owner, publicationGeneration: 2 }))?.deleteOutcome)
      .toBe("outcome-uncertain");

    const restartedCleanup = new CleanupService(records, new S3OwnedObjectStore(fake, "private-bucket", records));
    await expect(restartedCleanup.run({ now: new Date("2032-01-01T00:00:00.000Z") })).resolves.toMatchObject({ failures: [] });
    expect(s3.objects.size).toBe(1);
    expect(s3.objects.has(activeC.objectKey)).toBe(true);
    expect(s3.deleteTargets).not.toContain(activeC.objectKey);
    expect(records.objects.get(activeC.id)).toMatchObject({ lifecycle: "active", objectKey: activeC.objectKey, publicationGeneration: 3 });
    await expect(new S3OwnedObjectStore(fake, "private-bucket", records).get(activeC.id, owner)).resolves.toMatchObject({ bytes: publication.bytes });
  });
});
