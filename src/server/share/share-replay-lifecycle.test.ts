import { describe, expect, it } from "vitest";

import { ensureCurrentShareCreateReplay } from "./idempotent-create";

const replay = { status: 200, body: { ok: true, token: "share-token", ownerDeleteSecret: "owner-secret" } } as const;

describe("current Share lifecycle replay authority", () => {
  it("returns the exact replay only while the durable share remains active", async () => {
    const shares = { reconcileOwnerAuthority: async () => ({ lifecycle: "active" }) } as never;
    await expect(ensureCurrentShareCreateReplay({ result: replay, shares, now: new Date("2026-01-01T00:00:00.000Z") })).resolves.toEqual(replay);
  });

  it.each(["disabled", "deleted", "expired"])("retires a cached replay after the durable lifecycle becomes %s", async (lifecycle) => {
    const shares = { reconcileOwnerAuthority: async () => ({ lifecycle }) } as never;
    await expect(ensureCurrentShareCreateReplay({ result: replay, shares, now: new Date("2026-01-01T00:00:00.000Z") })).resolves.toEqual({
      status: 409,
      body: { ok: false, error: { code: "SHARE_CREATE_REPLAY_RETIRED", messageKo: expect.any(String) } },
    });
  });
});
