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

export type OmrFreshStartReason = "stale-recovery-handle" | "retired-create-replay";

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

export async function acquireOmrJob<TStatus>(input: {
  readonly storage: OmrBrowserStorage;
  readonly createStorageKey: string;
  readonly recoveryStorageKey: string;
  readonly forceFresh: boolean;
  readonly createRequest: () => Readonly<Record<string, unknown>>;
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
  const request = !input.forceFresh && stored
    ? JSON.parse(stored) as Readonly<Record<string, unknown>>
    : input.createRequest();
  if (input.forceFresh || !stored) input.storage.setItem(input.createStorageKey, JSON.stringify(request));

  let created: { readonly handle: string };
  try {
    created = await input.create(request);
  } catch (error) {
    if (!isRetiredCreateReplay(error)) throw error;
    input.storage.removeItem(input.createStorageKey);
    input.storage.removeItem(input.recoveryStorageKey);
    return { kind: "fresh-start-required", reason: "retired-create-replay" };
  }
  input.storage.setItem(input.recoveryStorageKey, created.handle);
  input.storage.removeItem(input.createStorageKey);
  return { kind: "acquired", handle: created.handle };
}
