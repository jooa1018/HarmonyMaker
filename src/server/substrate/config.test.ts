import { describe, expect, it } from "vitest";

import {
  loadProductionOmrConfig,
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

describe("production OMR configuration", () => {
  const environment = {
    OMR_HANDLE_HMAC_KEY: Buffer.alloc(32, 8).toString("base64url"),
    OMR_VENDOR_JOB_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64url"),
    OMR_DAILY_GLOBAL_CREDIT_CEILING: "1000",
    OMR_PROVIDER_MODE: "unconfigured",
    NODE_ENV: "production",
  } as const;

  it("loads independent exact keys and a positive deployment ceiling", () => {
    expect(loadProductionOmrConfig(environment)).toMatchObject({
      dailyGlobalCreditCeiling: 1000,
      providerMode: "unconfigured",
    });
    expect(loadProductionOmrConfig({ ...environment, OMR_DAILY_GLOBAL_CREDIT_CEILING: String(Number.MAX_SAFE_INTEGER) }).dailyGlobalCreditCeiling).toBe(Number.MAX_SAFE_INTEGER);
  });


  it("loads and validates real Audiveris provider configuration", () => {
    const real = loadProductionOmrConfig({
      ...environment,
      OMR_PROVIDER_MODE: "real",
      OMR_AUDIVERIS_BASE_URL: "https://audiveris.example.test",
      OMR_AUDIVERIS_API_KEY: "provider-key-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      OMR_AUDIVERIS_CONFIGURATION_GENERATION: "audiveris-5.10.2-temp-v1",
      OMR_AUDIVERIS_REQUEST_TIMEOUT_MS: "180000",
    });
    expect(real.audiveris).toEqual({
      baseUrl: "https://audiveris.example.test",
      apiKey: "provider-key-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      configurationGeneration: "audiveris-5.10.2-temp-v1",
      requestTimeoutMs: 180000,
    });
    expect(() => loadProductionOmrConfig({ ...environment, OMR_PROVIDER_MODE: "real" })).toThrow("missing Audiveris OMR configuration");
    expect(() => loadProductionOmrConfig({
      ...environment, OMR_PROVIDER_MODE: "real",
      OMR_AUDIVERIS_BASE_URL: "http://remote.example.test",
      OMR_AUDIVERIS_API_KEY: "provider-key-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      OMR_AUDIVERIS_CONFIGURATION_GENERATION: "audiveris-v1",
      OMR_AUDIVERIS_REQUEST_TIMEOUT_MS: "180000",
    })).toThrow("OMR_AUDIVERIS_BASE_URL");
  });

  it("fails closed for missing/invalid values and production reference mode", () => {
    expect(() => loadProductionOmrConfig({})).toThrow("missing OMR configuration");
    expect(() => loadProductionOmrConfig({ ...environment, OMR_HANDLE_HMAC_KEY: Buffer.alloc(31).toString("base64url") })).toThrow("OMR_HANDLE_HMAC_KEY");
    expect(() => loadProductionOmrConfig({ ...environment, OMR_DAILY_GLOBAL_CREDIT_CEILING: "0" })).toThrow("OMR_DAILY_GLOBAL_CREDIT_CEILING");
    expect(() => loadProductionOmrConfig({ ...environment, OMR_DAILY_GLOBAL_CREDIT_CEILING: "9007199254740992" })).toThrow("OMR_DAILY_GLOBAL_CREDIT_CEILING");
    expect(() => loadProductionOmrConfig({ ...environment, OMR_PROVIDER_MODE: "reference" })).toThrow("prohibited in production");
  });
});
