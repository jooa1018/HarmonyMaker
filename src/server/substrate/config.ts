export const PRODUCTION_SUBSTRATE_ENVIRONMENT_VARIABLES = Object.freeze([
  "DATABASE_URL",
  "SESSION_TOKEN_HMAC_KEY",
  "CSRF_HMAC_KEY",
  "SHARE_ENCRYPTION_KEY",
  "SHARE_TOKEN_HMAC_KEY",
  "OWNER_DELETE_HMAC_KEY",
  "QUOTA_IP_HMAC_KEY",
  "INTERNAL_OPERATIONS_KEY",
] as const);

export type ProductionSubstrateEnvironmentVariable =
  (typeof PRODUCTION_SUBSTRATE_ENVIRONMENT_VARIABLES)[number];

export interface ProductionSubstrateConfig {
  readonly database: {
    readonly connectionString: string;
  };
  readonly secrets: {
    readonly sessionTokenHmacKey: Uint8Array;
    readonly csrfHmacKey: Uint8Array;
    readonly shareEncryptionKey: Uint8Array;
    readonly shareTokenHmacKey: Uint8Array;
    readonly ownerDeleteHmacKey: Uint8Array;
    readonly quotaIpHmacKey: Uint8Array;
    readonly internalOperationsKey: Uint8Array;
  };
}

export class ProductionSubstrateConfigurationError extends Error {
  readonly code = "PRODUCTION_SUBSTRATE_CONFIGURATION_MISSING" as const;

  constructor(
    readonly missingVariables: readonly ProductionSubstrateEnvironmentVariable[],
    reason = "missing required production substrate configuration",
  ) {
    super(`${reason}: ${missingVariables.join(",")}`);
    this.name = "ProductionSubstrateConfigurationError";
  }
}

type Environment = Readonly<Record<string, string | undefined>>;

function present(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

function decodeSecret(environment: Environment, name: ProductionSubstrateEnvironmentVariable): Uint8Array {
  const value = environment[name] as string;
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new ProductionSubstrateConfigurationError([name], "invalid base64url key encoding");
  }
  const bytes = Buffer.from(value, "base64url");
  const validLength = name === "SHARE_ENCRYPTION_KEY" ? bytes.byteLength === 32 : bytes.byteLength >= 32;
  if (bytes.toString("base64url") !== value || !validLength) {
    throw new ProductionSubstrateConfigurationError([name], "invalid key length or encoding");
  }
  return Uint8Array.from(bytes);
}

/**
 * Resolves PostgreSQL and independent security keys for production.
 * This function deliberately has no in-memory or local-filesystem fallback.
 */
export function loadProductionSubstrateConfig(
  environment: Environment = process.env,
): ProductionSubstrateConfig {
  developmentMemoryPersistenceEnabled(environment);
  const missingVariables = PRODUCTION_SUBSTRATE_ENVIRONMENT_VARIABLES.filter(
    (name) => !present(environment[name]),
  );
  if (missingVariables.length > 0) {
    throw new ProductionSubstrateConfigurationError(missingVariables);
  }

  return Object.freeze({
    database: Object.freeze({ connectionString: environment.DATABASE_URL as string }),
    secrets: loadPersistenceSecrets(environment),
  });
}

export function developmentMemoryPersistenceEnabled(environment: Environment = process.env): boolean {
  if (environment.HM_DEV_MEMORY_PERSISTENCE !== "1") return false;
  if (environment.NODE_ENV !== "development") {
    throw new ProductionSubstrateConfigurationError([], "development memory persistence requires NODE_ENV=development");
  }
  return true;
}

/** Development still uses independent session/encryption keys; only persistence is replaced. */
export function loadPersistenceSecrets(environment: Environment = process.env): ProductionSubstrateConfig["secrets"] {
  const missing = PRODUCTION_SUBSTRATE_ENVIRONMENT_VARIABLES.filter(name => name !== "DATABASE_URL" && !present(environment[name]));
  if (missing.length) throw new ProductionSubstrateConfigurationError(missing);
  return Object.freeze({
    sessionTokenHmacKey: decodeSecret(environment, "SESSION_TOKEN_HMAC_KEY"),
    csrfHmacKey: decodeSecret(environment, "CSRF_HMAC_KEY"),
    shareEncryptionKey: decodeSecret(environment, "SHARE_ENCRYPTION_KEY"),
    shareTokenHmacKey: decodeSecret(environment, "SHARE_TOKEN_HMAC_KEY"),
    ownerDeleteHmacKey: decodeSecret(environment, "OWNER_DELETE_HMAC_KEY"),
    quotaIpHmacKey: decodeSecret(environment, "QUOTA_IP_HMAC_KEY"),
    internalOperationsKey: decodeSecret(environment, "INTERNAL_OPERATIONS_KEY"),
  });
}
