import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PracticeSharePayload } from "../../domain/share";
import type { SemanticDigest } from "../../domain/digest/canonical";
import { PRODUCTION_SUBSTRATE_ENVIRONMENT_VARIABLES } from "./config";

vi.mock("server-only", () => ({}));
vi.mock("pg", () => ({ Pool: vi.fn(function () { throw new Error("TEST_DATABASE_CONNECTION_BLOCKED"); }) }));
const digest = "0".repeat(64) as SemanticDigest;
const payload: PracticeSharePayload = {
  schemaVersion: 3, title: "Development share", tempo: { beatUnit: 4, dotted: false, bpm: 80 },
  key: { tonic: { step: "C", alter: 0 }, mode: "major" }, presetId: "standard",
  arrangementArtifactDigest: digest, effectiveChordTimelineDigest: digest,
  arrangement: {
    measures: [{ index: 0, sourceMeasureNumber: 1, lyricVerseIndex: 1, timeSignature: [4, 4], duration: [4, 1] }],
    tracks: [{ kind: "source-lead", label: "Lead", events: [{ kind: "note", occurrenceIndex: 0, offset: [0, 1], duration: [4, 1], pitch: ["C", 0, 4] }] }],
  }, lyrics: [], rightsShareConfirmed: true,
};
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("HM_DEV_MEMORY_PERSISTENCE", "1");
  vi.stubEnv("DATABASE_URL", "");
  for (const name of ["S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]) vi.stubEnv(name, "");
  PRODUCTION_SUBSTRATE_ENVIRONMENT_VARIABLES.filter(name => name !== "DATABASE_URL").forEach((name, index) => vi.stubEnv(name, Buffer.alloc(32, index + 1).toString("base64url")));
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("explicit development memory persistence", () => {
  it("issues sessions and creates, reads and deletes stored shares without DB or S3", async () => {
    const { getProductionServices } = await import("./services");
    const services = await getProductionServices();
    const issued = await services.sessions.issue();
    expect(await services.sessions.verify(issued.token)).toEqual(issued.record);
    const share = await services.shares.create({ ownerSessionId: issued.record.id, payload, rightsBasis: "self-authored", forceStore: true });
    expect(share.kind).toBe("store");
    if (share.kind !== "store") throw new Error("EXPECTED_STORED_SHARE");
    const again = await getProductionServices();
    expect(again).toBe(services);
    expect(await again.shares.read(share.token)).toEqual(payload);
    await again.shares.ownerDelete(share.token, share.ownerDeleteSecret);
    await expect(services.shares.read(share.token)).rejects.toThrow("SHARE_UNAVAILABLE");
    const { Pool } = await import("pg");
    expect(Pool).not.toHaveBeenCalled();
  });
  it.each(["production", "test", ""]) ("rejects the flag in %s before touching persistence", async mode => {
    vi.stubEnv("NODE_ENV", mode);
    const { getProductionServices } = await import("./services");
    expect(() => getProductionServices()).toThrow("requires NODE_ENV=development");
    const { Pool } = await import("pg");
    expect(Pool).not.toHaveBeenCalled();
  });
  it("rejects production even after a development service has been cached", async () => {
    const { getProductionServices } = await import("./services");
    await getProductionServices();
    vi.stubEnv("NODE_ENV", "production");
    expect(() => getProductionServices()).toThrow("requires NODE_ENV=development");
  });
  it("does not fall back to memory when the flag is absent and the DB fails", async () => {
    vi.stubEnv("HM_DEV_MEMORY_PERSISTENCE", "0");
    vi.stubEnv("DATABASE_URL", "postgresql://example.invalid/test");
    const { getProductionServices } = await import("./services");
    await expect(getProductionServices()).rejects.toThrow("TEST_DATABASE_CONNECTION_BLOCKED");
    const { Pool } = await import("pg");
    expect(Pool).toHaveBeenCalledWith({ connectionString: "postgresql://example.invalid/test", max: 3, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000, statement_timeout: 5000, query_timeout: 6000 });
  });
  it("still requires valid independent security keys", async () => {
    vi.stubEnv("SHARE_ENCRYPTION_KEY", "");
    const { getProductionServices } = await import("./services");
    await expect(getProductionServices()).rejects.toThrow("SHARE_ENCRYPTION_KEY");
  });
});
