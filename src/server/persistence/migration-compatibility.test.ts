import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { applyMigrationsWithClient, migrationChecksum, verifyMigrationsWithClient } from "./migrations";

const inventory = [{ version: 1, name: "first", sql: "SELECT 1" }, { version: 2, name: "second", sql: "SELECT 2" }];
const prefix = () => inventory.map(m => ({ version: m.version, name: m.name, checksum: migrationChecksum(m) }));
const future = (version = 3) => ({ version, name: "future-private-name", checksum: "unknown-future-checksum" });
const client = (rows: Record<string, unknown>[]) => ({ query: vi.fn(async () => ({ rows, rowCount: rows.length })) });
afterEach(() => vi.restoreAllMocks());

describe("runtime schema forward compatibility", () => {
  it("accepts a matching prefix plus newer contiguous versions, reads only, and logs no DB text", async () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const db = client([...prefix(), future(), future(4)]);
    await expect(verifyMigrationsWithClient(db, inventory)).resolves.toBeUndefined();
    expect(db.query).toHaveBeenCalledExactlyOnceWith("SELECT version, name, checksum FROM schema_migrations ORDER BY version");
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls[0][0])).toEqual({ event: "migration-schema-ahead", timestamp: expect.any(String), codeVersion: 2, databaseVersion: 4 });
    expect(log.mock.calls[0][0]).not.toMatch(/private|checksum|SELECT/);
  });
  it("accepts equal schema without warning", async () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(verifyMigrationsWithClient(client(prefix()), inventory)).resolves.toBeUndefined();
    expect(log).not.toHaveBeenCalled();
  });
  it.each([0, 1])("rejects behind schema with %s installed migrations", async count => {
    await expect(verifyMigrationsWithClient(client(prefix().slice(0, count)), inventory)).rejects.toThrow("MIGRATION_REQUIRED");
  });
  it.each(["version", "name", "checksum"])("rejects an ahead DB when a known %s differs", async field => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const rows: Record<string, unknown>[] = [...prefix(), future()];
    rows[0] = { ...rows[0], [field]: field === "version" ? 9 : "different" };
    await expect(verifyMigrationsWithClient(client(rows), inventory)).rejects.toThrow("MIGRATION_HISTORY_DIVERGED");
    expect(log).not.toHaveBeenCalled();
  });
  it("rejects holes in the newer history", async () => {
    await expect(verifyMigrationsWithClient(client([...prefix(), future(4)]), inventory)).rejects.toThrow("MIGRATION_HISTORY_DIVERGED");
  });
  it("keeps missing history classified as migration required", async () => {
    const db = { query: vi.fn(async () => { throw new Error("missing table"); }) };
    await expect(verifyMigrationsWithClient(db, inventory)).rejects.toThrow("MIGRATION_REQUIRED");
  });
  it("does not relax the migration writer or run SQL against an ahead DB", async () => {
    const db = client([...prefix(), future()]);
    await expect(applyMigrationsWithClient(db, inventory)).rejects.toThrow("MIGRATION_HISTORY_DIVERGED");
    const calls = db.query.mock.calls as unknown as string[][];
    expect(calls.at(-1)).toEqual(["ROLLBACK"]);
    expect(calls.some(([sql]) => inventory.some(m => m.sql === sql))).toBe(false);
  });
});
