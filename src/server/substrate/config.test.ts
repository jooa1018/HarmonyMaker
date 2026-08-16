import { describe, expect, it } from "vitest";

import {
  loadProductionSubstrateConfig,
  ProductionSubstrateConfigurationError,
  PRODUCTION_SUBSTRATE_ENVIRONMENT_VARIABLES,
} from "./config";

const completeEnvironment = {
  DATABASE_URL: "postgresql://example.invalid/harmonymaker",
  S3_ENDPOINT: "https://objects.example.invalid",
  S3_REGION: "test-region-1",
  S3_BUCKET: "harmonymaker-test",
  S3_ACCESS_KEY_ID: "test-access-key",
  S3_SECRET_ACCESS_KEY: "test-secret-key",
  SESSION_TOKEN_HMAC_KEY: Buffer.alloc(32, 1).toString("base64url"),
  CSRF_HMAC_KEY: Buffer.alloc(32, 2).toString("base64url"),
  SHARE_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64url"),
  SHARE_TOKEN_HMAC_KEY: Buffer.alloc(32, 4).toString("base64url"),
  OWNER_DELETE_HMAC_KEY: Buffer.alloc(32, 5).toString("base64url"),
  QUOTA_IP_HMAC_KEY: Buffer.alloc(32, 6).toString("base64url"),
  INTERNAL_OPERATIONS_KEY: Buffer.alloc(32, 7).toString("base64url"),
} as const;

describe("production substrate configuration", () => {
  it("derives PostgreSQL and S3-compatible configuration only from the named environment contract", () => {
    const config = loadProductionSubstrateConfig(completeEnvironment);

    expect(config.database.connectionString).toBe(completeEnvironment.DATABASE_URL);
    expect(config.objectStore.bucket).toBe(completeEnvironment.S3_BUCKET);
    expect(config.secrets.shareEncryptionKey).toHaveLength(32);
    expect(Object.keys(config)).toEqual(["database", "objectStore", "secrets"]);
  });

  it("fails closed instead of selecting a production memory or filesystem fallback", () => {
    expect(() => loadProductionSubstrateConfig({})).toThrow(
      ProductionSubstrateConfigurationError,
    );

    try {
      loadProductionSubstrateConfig({ DATABASE_URL: completeEnvironment.DATABASE_URL });
      throw new Error("expected production substrate configuration to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ProductionSubstrateConfigurationError);
      expect((error as ProductionSubstrateConfigurationError).missingVariables).toEqual(
        PRODUCTION_SUBSTRATE_ENVIRONMENT_VARIABLES.filter((name) => name !== "DATABASE_URL"),
      );
    }
  });

  it("treats blank values as missing", () => {
    expect(() => loadProductionSubstrateConfig({
      ...completeEnvironment,
      S3_BUCKET: "   ",
    })).toThrow("missing required production substrate configuration: S3_BUCKET");
  });

  it.each(PRODUCTION_SUBSTRATE_ENVIRONMENT_VARIABLES)("fails closed when %s is missing", (name) => {
    const environment: Record<string, string> = { ...completeEnvironment };
    delete environment[name];
    expect(() => loadProductionSubstrateConfig(environment)).toThrow(name);
  });

  it("rejects invalid secret encoding and length", () => {
    expect(() => loadProductionSubstrateConfig({
      ...completeEnvironment,
      SHARE_ENCRYPTION_KEY: "short",
    })).toThrow("invalid key length or encoding: SHARE_ENCRYPTION_KEY");
    expect(() => loadProductionSubstrateConfig({
      ...completeEnvironment,
      CSRF_HMAC_KEY: "not+base64url",
    })).toThrow("invalid base64url key encoding: CSRF_HMAC_KEY");
  });
});
