import { semanticDigest } from "../../domain/digest/canonical";

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

export type OmrFreshStartReason = "stale-recovery-handle" | "retired-create-replay" | "invalid-persisted-create" | "rejected-create-request";

export type OmrFreshStartState =
  | { readonly mode: "normal" }
  | { readonly mode: "explicit-required"; readonly reason: OmrFreshStartReason };

export function requireExplicitOmrFreshStart(reason: OmrFreshStartReason): OmrFreshStartState {
  return { mode: "explicit-required", reason };
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
    if (isRetiredCreateReplay(error)) {
      input.storage.removeItem(input.createStorageKey);
      input.storage.removeItem(input.recoveryStorageKey);
      return { kind: "fresh-start-required", reason: "retired-create-replay" };
    }
    if (error instanceof OmrApiRequestError && error.status >= 400 && error.status < 500
      && error.status !== 408 && error.status !== 429) {
      return { kind: "fresh-start-required", reason: "rejected-create-request" };
    }
    throw error;
  }
  input.storage.setItem(input.recoveryStorageKey, created.handle);
  input.storage.removeItem(input.createStorageKey);
  return { kind: "acquired", handle: created.handle };
}
