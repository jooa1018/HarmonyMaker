import { semanticDigest } from "../../domain/digest/canonical";
import { OMR_VENDOR_CREATE_DEFINITIVE_REJECTION } from "../../domain/omr/contracts";

export interface OmrApiErrorBody {
  readonly error?: {
    readonly code?: string;
    readonly messageKo?: string;
  };
}

export class OmrApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code?: string,
    readonly messageKo?: string,
  ) {
    super(messageKo ?? code ?? `HTTP ${status}`);
    this.name = "OmrApiRequestError";
  }
}

function errorBody(value: unknown): OmrApiErrorBody["error"] {
  if (!value || typeof value !== "object" || !("error" in value)) return undefined;
  const candidate = (value as { readonly error?: unknown }).error;
  if (!candidate || typeof candidate !== "object") return undefined;
  const code = "code" in candidate && typeof candidate.code === "string" ? candidate.code : undefined;
  const messageKo = "messageKo" in candidate && typeof candidate.messageKo === "string" ? candidate.messageKo : undefined;
  return { ...(code ? { code } : {}), ...(messageKo ? { messageKo } : {}) };
}

export async function readOmrApiJson<T>(response: Response): Promise<T> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new OmrApiRequestError(
      response.status,
      response.ok ? "OMR_API_RESPONSE_INVALID" : undefined,
      response.ok ? "OMR 서버 응답을 확인할 수 없습니다." : undefined,
    );
  }
  if (!response.ok) {
    const error = errorBody(body);
    throw new OmrApiRequestError(response.status, error?.code, error?.messageKo);
  }
  return body as T;
}

export function isUnavailableRecoveryHandle(error: unknown): boolean {
  return error instanceof OmrApiRequestError
    && error.status === 404
    && error.code === "OMR_JOB_UNAVAILABLE";
}

export function isRetiredCreateReplay(error: unknown): boolean {
  return error instanceof OmrApiRequestError
    && error.status === 409
    && error.code === "OMR_CREATE_REPLAY_UNAVAILABLE";
}

/** Browser-side grammar only; the server remains authoritative for signature and expiry. */
export function isOmrJobHandleShape(value: unknown): value is string {
  return typeof value === "string"
    && /^v1\.[A-Za-z0-9_-]{43}\.\d{10,12}\.[a-f0-9]{64}$/u.test(value);
}

export type OmrFreshStartReason = "stale-recovery-handle" | "retired-create-replay" | "invalid-persisted-create" | "pre-dispatch-correction";

export const OMR_CREATE_PRE_DISPATCH_CORRECTION_CODES = Object.freeze([
  "RIGHTS_PROVIDER_TRANSFER_NOT_CONFIRMED",
  "OMR_PAGE_LIMIT_EXCEEDED",
  "OMR_REQUEST_INVALID",
  "OMR_PROVIDER_CONSENT_STALE",
  "OMR_CREDIT_ESTIMATE_REQUIRED",
  "OMR_CREDIT_ESTIMATE_INVALID",
  "OMR_PROVIDER_BINDING_INVALID",
  OMR_VENDOR_CREATE_DEFINITIVE_REJECTION,
] as const);
type OmrCreatePreDispatchCorrectionCode = typeof OMR_CREATE_PRE_DISPATCH_CORRECTION_CODES[number];

export type OmrCreateOutcomePolicy =
  | { readonly kind: "pending"; readonly code: "OMR_IDEMPOTENCY_PENDING"; readonly status: number; readonly messageKo?: string }
  | { readonly kind: "outcome-uncertain"; readonly code: "OMR_VENDOR_CREATE_OUTCOME_UNCERTAIN"; readonly status: number; readonly messageKo?: string }
  | { readonly kind: "reconciliation-required"; readonly code: "OMR_JOB_RECONCILIATION_REQUIRED"; readonly status: number; readonly messageKo?: string }
  | { readonly kind: "quota"; readonly code: "OMR_QUOTA_EXCEEDED" | "OMR_GLOBAL_CREDIT_CEILING_EXCEEDED"; readonly status: number; readonly messageKo?: string }
  | { readonly kind: "deterministic-rejection"; readonly code: string; readonly status: number; readonly messageKo?: string; readonly correction: "preserve-key" | "explicit-reset-allowed" }
  | { readonly kind: "transient"; readonly code: string; readonly status?: number; readonly messageKo?: string };

export function classifyOmrCreateOutcome(error: unknown): "retired" | OmrCreateOutcomePolicy {
  if (isRetiredCreateReplay(error)) return "retired";
  if (!(error instanceof OmrApiRequestError)) {
    return { kind: "transient", code: "OMR_CREATE_TRANSPORT_UNCERTAIN" };
  }
  const common = {
    status: error.status,
    ...(error.messageKo ? { messageKo: error.messageKo } : {}),
  };
  if (error.code === "OMR_IDEMPOTENCY_PENDING") return { kind: "pending", code: error.code, ...common };
  if (error.code === "OMR_VENDOR_CREATE_OUTCOME_UNCERTAIN") return { kind: "outcome-uncertain", code: error.code, ...common };
  if (error.code === "OMR_JOB_RECONCILIATION_REQUIRED") return { kind: "reconciliation-required", code: error.code, ...common };
  if (error.code === "OMR_QUOTA_EXCEEDED" || error.code === "OMR_GLOBAL_CREDIT_CEILING_EXCEEDED") {
    return { kind: "quota", code: error.code, ...common };
  }
  if (error.status === 408 || error.status >= 500) {
    return { kind: "transient", code: error.code ?? "OMR_CREATE_TRANSIENT", ...common };
  }
  const code = error.code ?? "OMR_CREATE_REJECTED";
  return {
    kind: "deterministic-rejection",
    code,
    correction: OMR_CREATE_PRE_DISPATCH_CORRECTION_CODES.includes(code as OmrCreatePreDispatchCorrectionCode)
      ? "explicit-reset-allowed" : "preserve-key",
    ...common,
  };
}

export function canResetOmrCreateAfterCorrection(outcome: OmrCreateOutcomePolicy): boolean {
  return outcome.kind === "deterministic-rejection" && outcome.correction === "explicit-reset-allowed";
}

export function omrCreateCorrectionRequirements(outcome: OmrCreateOutcomePolicy): {
  readonly refreshPreflight: boolean;
  readonly requireTransferReconsent: boolean;
} {
  const staleConsent = outcome.kind === "deterministic-rejection" && outcome.code === "OMR_PROVIDER_CONSENT_STALE";
  return { refreshPreflight: staleConsent, requireTransferReconsent: staleConsent };
}

export async function applyOmrCreateCorrection<TPreflight>(
  outcome: OmrCreateOutcomePolicy,
  input: {
    readonly refreshPreflight: () => Promise<TPreflight>;
    readonly acceptRefreshedPreflight: (preflight: TPreflight) => void;
    readonly revokeTransferConsent: () => void;
  },
): Promise<void> {
  const requirements = omrCreateCorrectionRequirements(outcome);
  if (requirements.refreshPreflight) {
    const refreshed = await input.refreshPreflight();
    input.acceptRefreshedPreflight(refreshed);
  }
  if (requirements.requireTransferReconsent) input.revokeTransferConsent();
}

export type OmrFreshStartState =
  | { readonly mode: "normal" }
  | { readonly mode: "explicit-required"; readonly reason: OmrFreshStartReason };

export function requireExplicitOmrFreshStart(reason: OmrFreshStartReason): OmrFreshStartState {
  return { mode: "explicit-required", reason };
}

export function omrFreshStartAction(state: OmrFreshStartState): "start" | "unlock-correction" {
  return state.mode === "explicit-required" && state.reason === "pre-dispatch-correction"
    ? "unlock-correction" : "start";
}

export function consumeExplicitOmrFreshStart(state: OmrFreshStartState): {
  readonly forceFresh: boolean;
  readonly nextState: OmrFreshStartState;
} {
  return { forceFresh: state.mode === "explicit-required", nextState: { mode: "normal" } };
}

export interface OmrStartInFlightGuard {
  current: boolean;
}

export function tryBeginOmrStart(guard: OmrStartInFlightGuard): boolean {
  if (guard.current) return false;
  guard.current = true;
  return true;
}

export function finishOmrStart(guard: OmrStartInFlightGuard): void {
  guard.current = false;
}

export interface OmrBrowserStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type OmrJobAcquisition<TStatus> =
  | {
    readonly kind: "acquired";
    readonly handle: string;
    readonly recoveredStatus?: TStatus;
  }
  | {
    readonly kind: "fresh-start-required";
    readonly reason: OmrFreshStartReason;
  }
  | {
    readonly kind: "create-preserved";
    readonly outcome: OmrCreateOutcomePolicy;
  };

const PERSISTED_CREATE_VERSION = "hm-omr-browser-create-v1" as const;
interface PersistedOmrCreateEnvelope {
  readonly version: typeof PERSISTED_CREATE_VERSION;
  readonly canonicalInputIdentity: string;
  readonly requestDigest: string;
  readonly request: Readonly<Record<string, unknown>>;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Readonly<Record<string, unknown>>, required: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === required.length && required.every((key) => Object.hasOwn(value, key));
}

function hasValidCreateBasics(request: Readonly<Record<string, unknown>>): boolean {
  return hasExactKeys(request, ["pageCount", "pages", "sourceKind", "rights", "providerTransferConsent", "consentCapabilitySnapshotDigest", "idempotencyKey"])
    && Number.isSafeInteger(request.pageCount) && Number(request.pageCount) > 0
    && Array.isArray(request.pages) && request.pages.length === request.pageCount
    && request.pages.every((page, index) => isRecord(page) && hasExactKeys(page, ["pageIndex", "pageDigest", "mimeType"]) && page.pageIndex === index
      && typeof page.pageDigest === "string" && /^[0-9a-f]{64}$/u.test(page.pageDigest)
      && (page.mimeType === "image/png" || page.mimeType === "image/jpeg"))
    && ["digital-pdf", "scanned-pdf", "camera-photo"].includes(String(request.sourceKind))
    && isRecord(request.rights) && hasExactKeys(request.rights, ["basis", "allowedUses", "confirmedAt"])
    && request.rights.basis === "user-confirmed-rights" && Array.isArray(request.rights.allowedUses)
    && request.rights.allowedUses.length === 2
    && request.rights.allowedUses.every((use) => use === "generation" || use === "provider-transfer")
    && new Set(request.rights.allowedUses).size === 2
    && typeof request.rights.confirmedAt === "string" && Number.isFinite(Date.parse(request.rights.confirmedAt))
    && request.providerTransferConsent === true
    && typeof request.consentCapabilitySnapshotDigest === "string" && /^[0-9a-f]{64}$/u.test(request.consentCapabilitySnapshotDigest)
    && typeof request.idempotencyKey === "string" && /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u.test(request.idempotencyKey);
}

async function parsePersistedCreate(input: {
  readonly serialized: string;
  readonly canonicalInputIdentity: string;
  readonly validateCreateRequest: (request: Readonly<Record<string, unknown>>) => boolean;
}): Promise<Readonly<Record<string, unknown>> | undefined> {
  let parsed: unknown;
  try { parsed = JSON.parse(input.serialized); } catch { return undefined; }
  if (!isRecord(parsed) || parsed.version !== PERSISTED_CREATE_VERSION
    || parsed.canonicalInputIdentity !== input.canonicalInputIdentity
    || typeof parsed.requestDigest !== "string" || !isRecord(parsed.request)
    || !hasValidCreateBasics(parsed.request) || !input.validateCreateRequest(parsed.request)) return undefined;
  return await semanticDigest({ projectionSchema: PERSISTED_CREATE_VERSION, request: parsed.request }) === parsed.requestDigest
    ? parsed.request : undefined;
}

export async function serializeOmrCreateEnvelope(
  canonicalInputIdentity: string,
  request: Readonly<Record<string, unknown>>,
): Promise<string> {
  return JSON.stringify({
    version: PERSISTED_CREATE_VERSION,
    canonicalInputIdentity,
    requestDigest: await semanticDigest({ projectionSchema: PERSISTED_CREATE_VERSION, request }),
    request,
  } satisfies PersistedOmrCreateEnvelope);
}

export async function acquireOmrJob<TStatus>(input: {
  readonly storage: OmrBrowserStorage;
  readonly createStorageKey: string;
  readonly recoveryStorageKey: string;
  readonly canonicalInputIdentity?: string;
  readonly forceFresh: boolean;
  readonly createRequest: () => Readonly<Record<string, unknown>>;
  readonly validateCreateRequest?: (request: Readonly<Record<string, unknown>>) => boolean;
  readonly recover: (handle: string) => Promise<TStatus>;
  readonly create: (request: Readonly<Record<string, unknown>>) => Promise<{ readonly handle: string }>;
  readonly validateCreatedHandle?: (handle: unknown) => handle is string;
}): Promise<OmrJobAcquisition<TStatus>> {
  if (input.forceFresh) {
    input.storage.removeItem(input.createStorageKey);
    input.storage.removeItem(input.recoveryStorageKey);
  } else {
    const recoveryHandle = input.storage.getItem(input.recoveryStorageKey);
    if (recoveryHandle) {
      try {
        return { kind: "acquired", handle: recoveryHandle, recoveredStatus: await input.recover(recoveryHandle) };
      } catch (error) {
        if (!isUnavailableRecoveryHandle(error)) throw error;
        input.storage.removeItem(input.recoveryStorageKey);
        return { kind: "fresh-start-required", reason: "stale-recovery-handle" };
      }
    }
  }

  const stored = input.storage.getItem(input.createStorageKey);
  const canonicalInputIdentity = input.canonicalInputIdentity ?? input.createStorageKey;
  const validateCreateRequest = input.validateCreateRequest ?? (() => true);
  const persisted = !input.forceFresh && stored ? await parsePersistedCreate({
    serialized: stored, canonicalInputIdentity, validateCreateRequest,
  }) : undefined;
  if (!input.forceFresh && stored && !persisted) return { kind: "fresh-start-required", reason: "invalid-persisted-create" };
  const request = persisted ?? input.createRequest();
  if (input.validateCreateRequest && (!hasValidCreateBasics(request) || !validateCreateRequest(request))) throw new RangeError("OMR_CREATE_REQUEST_INVALID");
  if (input.forceFresh || !stored) {
    const envelope: PersistedOmrCreateEnvelope = {
      version: PERSISTED_CREATE_VERSION, canonicalInputIdentity,
      requestDigest: await semanticDigest({ projectionSchema: PERSISTED_CREATE_VERSION, request }), request,
    };
    input.storage.setItem(input.createStorageKey, JSON.stringify(envelope));
  }

  let created: { readonly handle: string };
  try {
    created = await input.create(request);
  } catch (error) {
    const outcome = classifyOmrCreateOutcome(error);
    if (outcome === "retired") {
      input.storage.removeItem(input.createStorageKey);
      input.storage.removeItem(input.recoveryStorageKey);
      return { kind: "fresh-start-required", reason: "retired-create-replay" };
    }
    return { kind: "create-preserved", outcome };
  }
  const createdHandle: unknown = isRecord(created) ? created.handle : undefined;
  if (typeof createdHandle !== "string"
    || (input.validateCreatedHandle && !input.validateCreatedHandle(createdHandle))) {
    return { kind: "create-preserved", outcome: { kind: "transient", code: "OMR_CREATE_RESPONSE_INVALID" } };
  }
  input.storage.setItem(input.recoveryStorageKey, createdHandle);
  input.storage.removeItem(input.createStorageKey);
  return { kind: "acquired", handle: createdHandle };
}
