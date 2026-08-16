import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { S3Client } from "@aws-sdk/client-s3";
import { MemoryGovernanceStore } from "../persistence/memory-store.test-adapter";
import type { PrivateRowId } from "../persistence/store";
import { S3OwnedObjectStore } from "./s3-owned-object-store";

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
    const created = await store.put({ ownerSessionId: owner, bytes, contentType: "application/octet-stream" });
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
    const created = await store.put({ ownerSessionId: owner, bytes: Uint8Array.of(1), contentType: "application/octet-stream" });
    await expect(store.delete(created.id, owner, new Date("2026-01-01T00:00:00.000Z"))).rejects.toThrow("S3_DELETE_FAILED");
    expect(records.objects.get(created.id)?.lifecycle).toBe("delete-pending");
    await expect(store.delete(created.id, owner, new Date("2026-01-01T00:00:01.000Z"))).resolves.toBeUndefined();
    expect(records.objects.get(created.id)?.lifecycle).toBe("deleted");
    expect(records.audits).toEqual([expect.objectContaining({ eventKind: "object-delete", objectReferenceId: created.id, outcome: "accepted" })]);
    await store.delete(created.id, owner, new Date("2026-01-01T00:00:02.000Z"));
    expect(deleteAttempts).toBe(2);
    expect(records.audits).toHaveLength(1);
  });
});
