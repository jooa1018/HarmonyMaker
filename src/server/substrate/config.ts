export const PRODUCTION_SUBSTRATE_ENVIRONMENT_VARIABLES = Object.freeze([
  "DATABASE_URL",
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
] as const);

export type ProductionSubstrateEnvironmentVariable =
  (typeof PRODUCTION_SUBSTRATE_ENVIRONMENT_VARIABLES)[number];

export interface ProductionSubstrateConfig {
  readonly database: {
    readonly connectionString: string;
  };
  readonly objectStore: {
    readonly endpoint: string;
    readonly region: string;
    readonly bucket: string;
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
  };
}

export class ProductionSubstrateConfigurationError extends Error {
  readonly code = "PRODUCTION_SUBSTRATE_CONFIGURATION_MISSING" as const;

  constructor(readonly missingVariables: readonly ProductionSubstrateEnvironmentVariable[]) {
    super(`missing required production substrate configuration: ${missingVariables.join(",")}`);
    this.name = "ProductionSubstrateConfigurationError";
  }
}

type Environment = Readonly<Record<string, string | undefined>>;

function present(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

/**
 * Resolves the only production persistence substrate allowed by the v0 plan.
 * This function deliberately has no in-memory or local-filesystem fallback.
 */
export function loadProductionSubstrateConfig(
  environment: Environment = process.env,
): ProductionSubstrateConfig {
  const missingVariables = PRODUCTION_SUBSTRATE_ENVIRONMENT_VARIABLES.filter(
    (name) => !present(environment[name]),
  );
  if (missingVariables.length > 0) {
    throw new ProductionSubstrateConfigurationError(missingVariables);
  }

  return Object.freeze({
    database: Object.freeze({ connectionString: environment.DATABASE_URL as string }),
    objectStore: Object.freeze({
      endpoint: environment.S3_ENDPOINT as string,
      region: environment.S3_REGION as string,
      bucket: environment.S3_BUCKET as string,
      accessKeyId: environment.S3_ACCESS_KEY_ID as string,
      secretAccessKey: environment.S3_SECRET_ACCESS_KEY as string,
    }),
  });
}
