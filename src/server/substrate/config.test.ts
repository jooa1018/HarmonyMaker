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
} as const;

describe("production substrate configuration", () => {
  it("derives PostgreSQL and S3-compatible configuration only from the named environment contract", () => {
    const config = loadProductionSubstrateConfig(completeEnvironment);

    expect(config).toEqual({
      database: { connectionString: completeEnvironment.DATABASE_URL },
      objectStore: {
        endpoint: completeEnvironment.S3_ENDPOINT,
        region: completeEnvironment.S3_REGION,
        bucket: completeEnvironment.S3_BUCKET,
        accessKeyId: completeEnvironment.S3_ACCESS_KEY_ID,
        secretAccessKey: completeEnvironment.S3_SECRET_ACCESS_KEY,
      },
    });
    expect(Object.keys(config)).toEqual(["database", "objectStore"]);
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
});
