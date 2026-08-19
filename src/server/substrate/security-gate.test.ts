import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { NextRequest } from "next/server";
import { POST as bootstrapSession } from "../../app/api/session/route";
import { MemoryGovernanceStore } from "../persistence/memory-store.test-adapter";
import type { PrivateRowId } from "../persistence/store";
import { CleanupService } from "../cleanup/cleanup-service";
import { MemoryOwnedObjectStore } from "../storage/memory-owned-object-store.test-adapter";
import type { OwnedObjectStore } from "../storage/owned-object-store";

describe("C2 production boundary security gate", () => {
  it("fails closed at request time when production credentials are unavailable", async () => {
    const response = await bootstrapSession(new NextRequest("http://localhost/api/session", { method: "POST", headers: { origin: "http://localhost", host: "localhost" } }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "PERSISTENCE_UNAVAILABLE" } });
  });

  it("rejects foreign-origin session bootstrap before persistence", async () => {
    const response = await bootstrapSession(new NextRequest("http://localhost/api/session", { method: "POST", headers: { origin: "https://foreign.example", host: "localhost" } }));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "ORIGIN_INVALID" } });
  });

  it("keeps server dependencies out of every client module", async () => {
    async function files(root: string): Promise<string[]> {
      const entries = await readdir(root, { withFileTypes: true });
      return (await Promise.all(entries.map((entry) => entry.isDirectory() ? files(path.join(root, entry.name)) : [path.join(root, entry.name)]))).flat();
    }
    const sources = await files(path.join(process.cwd(), "src"));
    const clientModules: string[] = [];
    for (const file of sources.filter((candidate) => /\.(ts|tsx)$/u.test(candidate))) {
      const content = await readFile(file, "utf8");
      if (/^\s*["']use client["'];/u.test(content)) clientModules.push(content);
    }
    expect(clientModules.length).toBeGreaterThan(0);
    for (const source of clientModules) {
      expect(source).not.toMatch(/(?:@\/server|\.\.\/server|node:crypto|from ["']pg["']|@aws-sdk\/client-s3|server-only)/u);
    }
  });

  it("requires Node runtime on every server persistence route", async () => {
    async function routes(root: string): Promise<string[]> {
      const entries = await readdir(root, { withFileTypes: true });
      return (await Promise.all(entries.map((entry) => entry.isDirectory() ? routes(path.join(root, entry.name)) : entry.name === "route.ts" ? [path.join(root, entry.name)] : []))).flat();
    }
    const apiRoutes = await routes(path.join(process.cwd(), "src", "app", "api"));
    for (const route of apiRoutes) expect(await readFile(route, "utf8")).toContain('export const runtime = "nodejs"');
  });

  it("authorizes OMR page PUT before content-length validation or body consumption", async () => {
    const source = await readFile(path.join(process.cwd(), "src", "app", "api", "omr", "jobs", "[handle]", "pages", "[pageIndex]", "route.ts"), "utf8");
    const put = source.slice(source.indexOf("export async function PUT"), source.indexOf("export async function GET"));
    const authorization = put.indexOf("authorizeOmr(request, true)");
    expect(authorization).toBeGreaterThan(0);
    expect(authorization).toBeLessThan(put.indexOf('request.headers.get("content-length")'));
    expect(authorization).toBeLessThan(put.indexOf("request.arrayBuffer()"));
  });

  it("authorizes JSON OMR mutations before bounded stream consumption", async () => {
    for (const segments of [["jobs", "route.ts"], ["jobs", "[handle]", "input", "route.ts"]]) {
      const source = await readFile(path.join(process.cwd(), "src", "app", "api", "omr", ...segments), "utf8");
      const authorization = source.indexOf("authorizeOmr(request, true)");
      const bodyRead = source.indexOf("readBoundedJson(request)");
      expect(authorization).toBeGreaterThan(0);
      expect(bodyRead).toBeGreaterThan(authorization);
    }
  });

  it("runs bounded cleanup deterministically and repeat-safely", async () => {
    const store = new MemoryGovernanceStore();
    await store.createSession({ tokenHash: "expired", csrfNonce: "nonce", createdAt: "2025-01-01T00:00:00.000Z", expiresAt: "2025-02-01T00:00:00.000Z" });
    await store.createObjectReference({ ownerSessionId: "1" as PrivateRowId, logicalPublicationKey: "objects/opaque", objectKey: "objects/opaque", contentType: "application/octet-stream", byteSize: 0, binaryDigest: "0".repeat(64), lifecycle: "active", createdAt: "2025-01-01T00:00:00.000Z", expiresAt: "2025-02-01T00:00:00.000Z" });
    const cleanup = new CleanupService(store, new MemoryOwnedObjectStore(store));
    const dry = await cleanup.run({ now: new Date("2026-01-01T00:00:00.000Z"), batchSize: 10, dryRun: true });
    expect(dry.expiredSessionIds).toHaveLength(1);
    expect(dry.expiredObjectIds).toHaveLength(1);
    const applied = await cleanup.run({ now: new Date("2026-01-01T00:00:00.000Z"), batchSize: 10 });
    expect(applied.expiredSessionIds).toEqual(dry.expiredSessionIds);
    expect(store.objects.get("2" as PrivateRowId)?.lifecycle).toBe("deleted");
    expect(store.audits).toContainEqual(expect.objectContaining({ eventKind: "object-delete", objectReferenceId: "2", outcome: "accepted" }));
    const repeated = await cleanup.run({ now: new Date("2026-01-01T00:00:00.000Z"), batchSize: 10 });
    expect(repeated.expiredSessionIds).toEqual([]);
    expect(repeated.expiredObjectIds).toEqual([]);
  });

  it("isolates object deletion failures and retries pending records within the bound", async () => {
    const store = new MemoryGovernanceStore();
    const owner = "owner" as PrivateRowId;
    const backing = new MemoryOwnedObjectStore(store);
    const expiresAt = "2025-02-01T00:00:00.000Z";
    const records = [
      await backing.put({ ownerSessionId: owner, publicationId: "security-gate-1", bytes: Uint8Array.of(1), contentType: "application/octet-stream", expiresAt }),
      await backing.put({ ownerSessionId: owner, publicationId: "security-gate-2", bytes: Uint8Array.of(2), contentType: "application/octet-stream", expiresAt }),
      await backing.put({ ownerSessionId: owner, publicationId: "security-gate-3", bytes: Uint8Array.of(3), contentType: "application/octet-stream", expiresAt }),
    ];
    let failFirst = true;
    const failing: OwnedObjectStore = {
      put: (input) => backing.put(input), get: (id, sessionId) => backing.get(id, sessionId), head: (id, sessionId) => backing.head(id, sessionId),
      delete: async (id, sessionId, at) => {
        if (id === records[0].id && failFirst) { failFirst = false; throw new Error("S3_DELETE_FAILED"); }
        await backing.delete(id, sessionId, at);
      },
    };
    const cleanup = new CleanupService(store, failing);
    const first = await cleanup.run({ now: new Date("2026-01-01T00:00:00.000Z"), batchSize: 2 });
    expect(first.expiredObjectIds).toEqual([records[0].id, records[1].id]);
    expect(first.failures).toEqual([{ scope: `object:${records[0].id}`, message: "S3_DELETE_FAILED" }]);
    expect(store.objects.get(records[0].id)?.lifecycle).toBe("delete-pending");
    expect(store.objects.get(records[1].id)?.lifecycle).toBe("deleted");
    const retry = await cleanup.run({ now: new Date("2026-01-01T00:00:01.000Z"), batchSize: 2 });
    expect(retry.expiredObjectIds).toEqual([records[0].id, records[2].id]);
    expect(retry.failures).toEqual([]);
    expect(records.map((record) => store.objects.get(record.id)?.lifecycle)).toEqual(["deleted", "deleted", "deleted"]);
    await expect(cleanup.run({ now: new Date("2026-01-01T00:00:02.000Z"), batchSize: 2 })).resolves.toMatchObject({ expiredObjectIds: [], failures: [] });
  });
});
