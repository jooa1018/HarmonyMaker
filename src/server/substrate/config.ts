import { MAX_OMR_DAILY_CREDIT_CEILING } from "../../domain/omr/contracts";

export const PRODUCTION_SUBSTRATE_ENVIRONMENT_VARIABLES = Object.freeze([
  "DATABASE_URL",
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
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

export const OMR_ENVIRONMENT_VARIABLES = Object.freeze([
  "OMR_HANDLE_HMAC_KEY",
  "OMR_VENDOR_JOB_ENCRYPTION_KEY",
  "OMR_DAILY_GLOBAL_CREDIT_CEILING",
  "OMR_PROVIDER_MODE",
] as const);
export const OMR_AUDIVERIS_ENVIRONMENT_VARIABLES = Object.freeze([
  "OMR_AUDIVERIS_BASE_URL",
  "OMR_AUDIVERIS_API_KEY",
  "OMR_AUDIVERIS_CONFIGURATION_GENERATION",
  "OMR_AUDIVERIS_REQUEST_TIMEOUT_MS",
] as const);
export type OmrEnvironmentVariable = (typeof OMR_ENVIRONMENT_VARIABLES)[number];

export interface ProductionAudiverisConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly configurationGeneration: string;
  readonly requestTimeoutMs: number;
}

export interface ProductionOmrConfig {
  readonly handleHmacKey: Uint8Array;
  readonly vendorJobEncryptionKey: Uint8Array;
  readonly dailyGlobalCreditCeiling: number;
  readonly providerMode: "unconfigured" | "reference" | "real";
  readonly audiveris?: ProductionAudiverisConfig;
}

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

function decodeExactOmrSecret(environment: Environment, name: "OMR_HANDLE_HMAC_KEY" | "OMR_VENDOR_JOB_ENCRYPTION_KEY"): Uint8Array {
  const value = environment[name];
  if (!present(value) || !/^[A-Za-z0-9_-]+$/u.test(value)) throw new ProductionSubstrateConfigurationError([], `invalid ${name}`);
  const bytes = Buffer.from(value, "base64url");
  if (bytes.byteLength !== 32 || bytes.toString("base64url") !== value) throw new ProductionSubstrateConfigurationError([], `invalid ${name}`);
  return Uint8Array.from(bytes);
}

/** OMR configuration is loaded only by OMR routes; Product Core stays independently usable. */
export function loadProductionOmrConfig(environment: Environment = process.env): ProductionOmrConfig {
  const missing = OMR_ENVIRONMENT_VARIABLES.filter((name) => !present(environment[name]));
  if (missing.length > 0) throw new ProductionSubstrateConfigurationError([], `missing OMR configuration: ${missing.join(",")}`);
  const providerMode = environment.OMR_PROVIDER_MODE;
  if (providerMode !== "unconfigured" && providerMode !== "reference" && providerMode !== "real") throw new ProductionSubstrateConfigurationError([], "invalid OMR_PROVIDER_MODE");
  if (providerMode === "reference" && environment.NODE_ENV === "production") throw new ProductionSubstrateConfigurationError([], "reference OMR provider is prohibited in production");
  const dailyGlobalCreditCeiling = Number(environment.OMR_DAILY_GLOBAL_CREDIT_CEILING);
  if (!Number.isSafeInteger(dailyGlobalCreditCeiling) || dailyGlobalCreditCeiling <= 0
    || dailyGlobalCreditCeiling > MAX_OMR_DAILY_CREDIT_CEILING) throw new ProductionSubstrateConfigurationError([], "invalid OMR_DAILY_GLOBAL_CREDIT_CEILING");

  let audiveris: ProductionAudiverisConfig | undefined;
  if (providerMode === "real") {
    const missingAudiveris = OMR_AUDIVERIS_ENVIRONMENT_VARIABLES.filter((name) => !present(environment[name]));
    if (missingAudiveris.length > 0) throw new ProductionSubstrateConfigurationError([], `missing Audiveris OMR configuration: ${missingAudiveris.join(",")}`);
    let baseUrl: URL;
    try { baseUrl = new URL(environment.OMR_AUDIVERIS_BASE_URL as string); }
    catch { throw new ProductionSubstrateConfigurationError([], "invalid OMR_AUDIVERIS_BASE_URL"); }
    const loopback = ["127.0.0.1", "localhost", "::1"].includes(baseUrl.hostname);
    if (!["http:", "https:"].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash
      || (environment.NODE_ENV === "production" && baseUrl.protocol !== "https:" && !loopback)) {
      throw new ProductionSubstrateConfigurationError([], "invalid OMR_AUDIVERIS_BASE_URL");
    }
    const apiKey = environment.OMR_AUDIVERIS_API_KEY as string;
    if (apiKey.length < 32 || apiKey.length > 512) throw new ProductionSubstrateConfigurationError([], "invalid OMR_AUDIVERIS_API_KEY");
    const configurationGeneration = environment.OMR_AUDIVERIS_CONFIGURATION_GENERATION as string;
    if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u.test(configurationGeneration)) {
      throw new ProductionSubstrateConfigurationError([], "invalid OMR_AUDIVERIS_CONFIGURATION_GENERATION");
    }
    const requestTimeoutMs = Number(environment.OMR_AUDIVERIS_REQUEST_TIMEOUT_MS);
    if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1_000 || requestTimeoutMs > 300_000) {
      throw new ProductionSubstrateConfigurationError([], "invalid OMR_AUDIVERIS_REQUEST_TIMEOUT_MS");
    }
    audiveris = Object.freeze({
      baseUrl: baseUrl.toString().replace(/\/$/u, ""),
      apiKey,
      configurationGeneration,
      requestTimeoutMs,
    });
  }

  return Object.freeze({
    handleHmacKey: decodeExactOmrSecret(environment, "OMR_HANDLE_HMAC_KEY"),
    vendorJobEncryptionKey: decodeExactOmrSecret(environment, "OMR_VENDOR_JOB_ENCRYPTION_KEY"),
    dailyGlobalCreditCeiling,
    providerMode,
    ...(audiveris ? { audiveris } : {}),
  });
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
    secrets: Object.freeze({
      sessionTokenHmacKey: decodeSecret(environment, "SESSION_TOKEN_HMAC_KEY"),
      csrfHmacKey: decodeSecret(environment, "CSRF_HMAC_KEY"),
      shareEncryptionKey: decodeSecret(environment, "SHARE_ENCRYPTION_KEY"),
      shareTokenHmacKey: decodeSecret(environment, "SHARE_TOKEN_HMAC_KEY"),
      ownerDeleteHmacKey: decodeSecret(environment, "OWNER_DELETE_HMAC_KEY"),
      quotaIpHmacKey: decodeSecret(environment, "QUOTA_IP_HMAC_KEY"),
      internalOperationsKey: decodeSecret(environment, "INTERNAL_OPERATIONS_KEY"),
    }),
  });
}
