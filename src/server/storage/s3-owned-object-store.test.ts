import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { S3Client } from "@aws-sdk/client-s3";
import { MemoryGovernanceStore } from "../persistence/memory-store.test-adapter";
import type { PrivateRowId } from "../persistence/store";
import { S3OwnedObjectStore } from "./s3-owned-object-store";
import type { GovernanceStore } from "../persistence/store";

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
    expect(commands.map((command) => command.constructor.name)).toEqual(["PutObjectCommand", "HeadObjectCommand", "GetObjectCommand", "DeleteObjectCommand"]);
    expect(commands.some((command) => command.constructor.name.includes("List"))).toBe(false);
    const put = commands[0].input;
    expect(put.Key).toMatch(/^objects\/[A-Za-z0-9_-]+$/u);
    expect(put).toMatchObject({ Bucket: "private-bucket", ContentType: "application/octet-stream" });
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
    expect(republished).toMatchObject({ id: created.id, objectKey: created.objectKey, lifecycle: "active" });
  });

  it("keeps Put acknowledgement loss discoverable and resumes the exact key after restart", async () => {
    const objects = new Map<string, Uint8Array>();
    let putThrows = true;
    const calls: string[] = [];
    const fake = { send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      calls.push(command.constructor.name);
      const key = String(command.input.Key);
      if (command.constructor.name === "PutObjectCommand") {
        objects.set(key, Uint8Array.from(command.input.Body as Uint8Array));
        if (putThrows) { putThrows = false; throw new TypeError("put acknowledgement lost"); }
      }
      if (command.constructor.name === "DeleteObjectCommand") objects.delete(key);
      return {};
    } } as unknown as S3Client;
    const records = new MemoryGovernanceStore();
    const owner = "publication-owner" as PrivateRowId;
    const firstProcess = new S3OwnedObjectStore(fake, "private-bucket", records);
    const publication = { ownerSessionId: owner, publicationId: "restart-stable-publication", bytes: Uint8Array.of(7, 8, 9), contentType: "application/octet-stream" } as const;
    await expect(firstProcess.put(publication)).rejects.toThrow("put acknowledgement lost");
    expect([...records.objects.values()]).toEqual([expect.objectContaining({ lifecycle: "upload-pending", publicationToken: expect.any(String) })]);
    expect(objects.size).toBe(1);

    const restarted = new S3OwnedObjectStore(fake, "private-bucket", records);
    const recovered = await restarted.put(publication);
    expect(recovered.lifecycle).toBe("active");
    expect(objects.size).toBe(1);
    expect([...records.objects.values()]).toHaveLength(1);
    expect([...records.objects.values()][0]).toMatchObject({ lifecycle: "active", objectKey: recovered.objectKey });
    expect(calls.filter((name) => name === "PutObjectCommand")).toHaveLength(2);
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
});
