import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relative: string) => readFile(path.join(root, relative), "utf8");

describe("Node/deployment/pretraffic runtime contract", () => {
  it("pins Node 22 consistently and keeps ordinary Vercel build database-free", async () => {
    const packageJson = JSON.parse(await read("package.json")) as { engines?: { node?: string }; scripts?: Record<string, string> };
    const vercel = JSON.parse(await read("vercel.json")) as { buildCommand?: string; crons?: Array<{ path: string; schedule: string }> };
    expect(packageJson.engines?.node).toBe("22.x");
    expect(packageJson.scripts?.migrate).toContain("scripts/migrate.mjs");
    expect(vercel.buildCommand).toBeUndefined();
    expect(vercel.crons).toEqual([{ path: "/api/internal/cleanup", schedule: "0 0 * * *" }]);
  });

  it("uses an explicit migration command and verify-only runtime composition", async () => {
    const [script, services, runbook] = await Promise.all([
      read("scripts/migrate.mjs"), read("src/server/substrate/services.ts"), read("docs/implementation/PRETRAFFIC_MIGRATION_RUNBOOK.md"),
    ]);
    expect(script).toContain("applyMigrations");
    expect(script).toContain("verifyMigrations");
    expect(services).toContain("await verifyMigrations(pool)");
    expect(services).not.toContain("applyMigrations");
    expect(runbook).toContain("DATABASE_URL=<target PostgreSQL 17 URL> npm run migrate");
    expect(runbook).toContain("일반 `next build`와 Vercel Preview build는 데이터베이스에 연결하거나 DDL을 실행하지 않는다");
  });
});
