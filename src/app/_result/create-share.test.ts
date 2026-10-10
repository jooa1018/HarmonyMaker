import { readFileSync } from "node:fs";
import { beforeAll, expect, it, vi } from "vitest";
import { importHarmonyProject } from "../../product/project-transfer";
import { MemoryShareCreateRecoveryStore } from "../../product/share-create-recovery";
import type { LocalProjectRecord } from "../../product/local-project-store";
import { createResultShare } from "./create-share";

let record: LocalProjectRecord;
beforeAll(async () => { record = { projectId: "fixture", updatedAt: "2026-10-10T00:00:00.000Z", project: await importHarmonyProject(readFileSync(new URL("../../product/fixtures/auto-draft-v1-auto.json", import.meta.url), "utf8")) }; });
const session = (authority = "session-one-" + "a".repeat(32)) => Response.json({ csrfToken: "csrf", sessionAuthority: authority, expiresAt: "2027-01-01T00:00:00.000Z" });
const completed = () => Response.json({ ok: true, share: { kind: "store", token: "test_token_123", ownerDeleteSecret: "owner_secret_123", expiresAt: "2027-04-08T00:00:00.000Z" } }, { status: 201 });
it("creates a compact inline link without sending anything to the server", async () => {
  const fetcher = vi.fn();
  const result = await createResultShare(record, false, { origin: "https://example.test", fetcher, fits: () => true });
  expect(result).toMatchObject({ status: "created", stored: false, url: expect.stringContaining("/share#p=") });
  expect(fetcher).not.toHaveBeenCalled();
});
it("records owner recovery authority and shows the server expiry without changing its schema", async () => {
  const recoveryStore = new MemoryShareCreateRecoveryStore();
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(session()).mockResolvedValueOnce(completed());
  expect(await createResultShare(record, false, { origin: "https://example.test", fetcher, recoveryStore, fits: () => false })).toEqual({ status: "created", stored: true, url: "https://example.test/share?token=test_token_123", expiresAt: "2027-04-08T00:00:00.000Z" });
  expect((await recoveryStore.load(record.projectId))?.createdResponse).toEqual({ token: "test_token_123", ownerDeleteSecret: "owner_secret_123" });
});
it("retries an uncertain response with the same idempotency key and exact body", async () => {
  const recoveryStore = new MemoryShareCreateRecoveryStore();
  const bodies: unknown[] = [];
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    if (url === "/api/session") return session();
    bodies.push(init?.body);
    if (bodies.length === 1) throw new Error("offline");
    return completed();
  });
  const dependencies = { origin: "https://example.test", fetcher, recoveryStore, fits: () => false };
  expect(await createResultShare(record, false, dependencies)).toMatchObject({ status: "retry", code: "NETWORK_UNCERTAIN" });
  expect(await createResultShare(record, false, dependencies)).toMatchObject({ status: "created" });
  expect(bodies[0]).toBe(bodies[1]);
});
it("uses read-only recovery across sessions instead of a second create", async () => {
  const recoveryStore = new MemoryShareCreateRecoveryStore();
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(session()).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(session("session-two-" + "b".repeat(32))).mockResolvedValueOnce(completed());
  const dependencies = { origin: "https://example.test", fetcher, recoveryStore, fits: () => false };
  await createResultShare(record, false, dependencies);
  await createResultShare(record, false, dependencies);
  expect(fetcher.mock.calls.map(call => call[0])).toEqual(["/api/session", "/api/shares", "/api/session", "/api/shares/recover"]);
});
it("reconciles a completed share after session change and requires explicit fresh intent after retirement", async () => {
  const recoveryStore = new MemoryShareCreateRecoveryStore();
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(session()).mockResolvedValueOnce(completed()).mockResolvedValueOnce(session("session-two-" + "b".repeat(32)))
    .mockResolvedValueOnce(Response.json({ error: { code: "SHARE_CREATE_REPLAY_RETIRED", reason: "expired" } }, { status: 409 }))
    .mockResolvedValueOnce(session("session-two-" + "b".repeat(32))).mockResolvedValueOnce(completed());
  const dependencies = { origin: "https://example.test", fetcher, recoveryStore, fits: () => false };
  await createResultShare(record, false, dependencies);
  const firstKey = (await recoveryStore.load(record.projectId))?.idempotencyKey;
  expect(await createResultShare(record, false, dependencies)).toMatchObject({ status: "fresh" });
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(fetcher.mock.calls[3][0]).toBe("/api/shares/test_token_123/reconcile");
  await createResultShare(record, true, dependencies);
  expect((await recoveryStore.load(record.projectId))?.idempotencyKey).not.toBe(firstKey);
  expect((await recoveryStore.load(record.projectId))?.completedAuthorities).toHaveLength(1);
});
