import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { NextRequest } from "next/server";
import { POST as bootstrapSession } from "../../app/api/session/route";
import { MemoryGovernanceStore } from "../persistence/memory-store.test-adapter";
import type { PrivateRowId } from "../persistence/store";
import { CleanupService } from "../cleanup/cleanup-service";

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

  it("runs bounded cleanup deterministically and repeat-safely", async () => {
    const store = new MemoryGovernanceStore();
    await store.createSession({ tokenHash: "expired", csrfNonce: "nonce", createdAt: "2025-01-01T00:00:00.000Z", expiresAt: "2025-02-01T00:00:00.000Z" });
    await store.createObjectReference({ ownerSessionId: "1" as PrivateRowId, objectKey: "objects/opaque", contentType: "application/octet-stream", byteSize: 0, binaryDigest: "0".repeat(64), lifecycle: "active", createdAt: "2025-01-01T00:00:00.000Z", expiresAt: "2025-02-01T00:00:00.000Z" });
    const cleanup = new CleanupService(store);
    const dry = await cleanup.run({ now: new Date("2026-01-01T00:00:00.000Z"), batchSize: 10, dryRun: true });
    expect(dry.expiredSessionIds).toHaveLength(1);
    expect(dry.expiredObjectIds).toHaveLength(1);
    const applied = await cleanup.run({ now: new Date("2026-01-01T00:00:00.000Z"), batchSize: 10 });
    expect(applied.expiredSessionIds).toEqual(dry.expiredSessionIds);
    const repeated = await cleanup.run({ now: new Date("2026-01-01T00:00:00.000Z"), batchSize: 10 });
    expect(repeated.expiredSessionIds).toEqual([]);
    expect(repeated.expiredObjectIds).toEqual([]);
  });
});
