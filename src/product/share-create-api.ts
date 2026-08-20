import type { ShareCreateRecoveryEnvelope, StoredShareCreateResponse } from "./share-create-recovery";

export type ShareCreateApiOutcome =
  | { readonly kind: "completed"; readonly response: StoredShareCreateResponse }
  | { readonly kind: "retain"; readonly code: "NETWORK_UNCERTAIN" | "RESPONSE_UNCERTAIN" | "REQUEST_TIMEOUT" | "RATE_LIMITED" | "SERVER_TRANSIENT" | "IDEMPOTENCY_PENDING" }
  | { readonly kind: "fresh-allowed"; readonly code: "SHARE_CREATE_REPLAY_RETIRED" }
  | { readonly kind: "conflict"; readonly code: "IDEMPOTENCY_CONFLICT" }
  | { readonly kind: "rejected"; readonly code: string };

export type ShareOwnerReconcileApiOutcome =
  | { readonly kind: "active" }
  | { readonly kind: "fresh-allowed"; readonly code: "SHARE_CREATE_REPLAY_RETIRED"; readonly reason: "expired" | "owner-deleted" }
  | { readonly kind: "retain"; readonly code: "NETWORK_UNCERTAIN" | "RESPONSE_UNCERTAIN" | "REQUEST_TIMEOUT" | "SERVER_TRANSIENT" }
  | { readonly kind: "rejected"; readonly code: string };

export type ShareCreateReadOnlyRecoveryOutcome =
  | { readonly kind: "completed"; readonly response: StoredShareCreateResponse }
  | { readonly kind: "retain"; readonly code: "NETWORK_UNCERTAIN" | "RESPONSE_UNCERTAIN" | "REQUEST_TIMEOUT" | "RATE_LIMITED" | "SERVER_TRANSIENT" | "IDEMPOTENCY_PENDING" }
  | { readonly kind: "fresh-allowed"; readonly code: "SHARE_CREATE_REPLAY_RETIRED" | "SHARE_CREATE_DETERMINISTIC_NO_EFFECT" }
  | { readonly kind: "conflict"; readonly code: "IDEMPOTENCY_CONFLICT" | "IDEMPOTENCY_AMBIGUOUS" }
  | { readonly kind: "rejected"; readonly code: string };

function errorCode(body: unknown): string | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const error = (body as Record<string, unknown>).error;
  return error && typeof error === "object" && !Array.isArray(error) && typeof (error as Record<string, unknown>).code === "string"
    ? (error as Record<string, unknown>).code as string : undefined;
}

export function classifyShareCreateApiResult(status: number, body: unknown): ShareCreateApiOutcome {
  if ((status === 200 || status === 201) && body && typeof body === "object" && !Array.isArray(body)) {
    const share = (body as { readonly share?: unknown }).share;
    if (share && typeof share === "object" && !Array.isArray(share)) {
      const record = share as Record<string, unknown>;
      if (record.kind === "store" && typeof record.token === "string" && /^[A-Za-z0-9_-]{8,512}$/u.test(record.token)
        && typeof record.ownerDeleteSecret === "string" && /^[A-Za-z0-9_-]{8,512}$/u.test(record.ownerDeleteSecret)) {
        return { kind: "completed", response: { token: record.token, ownerDeleteSecret: record.ownerDeleteSecret } };
      }
    }
    return { kind: "retain", code: "RESPONSE_UNCERTAIN" };
  }
  if (status === 200 || status === 201) return { kind: "retain", code: "RESPONSE_UNCERTAIN" };
  const code = errorCode(body);
  if (code === "SHARE_CREATE_REPLAY_RETIRED") return { kind: "fresh-allowed", code };
  if (code === "IDEMPOTENCY_CONFLICT") return { kind: "conflict", code };
  if (code === "IDEMPOTENCY_PENDING") return { kind: "retain", code };
  if (status === 408) return { kind: "retain", code: "REQUEST_TIMEOUT" };
  if (status === 429) return { kind: "retain", code: "RATE_LIMITED" };
  if (status >= 500) return { kind: "retain", code: "SERVER_TRANSIENT" };
  return { kind: "rejected", code: code ?? "SHARE_CREATE_REJECTED" };
}

export async function readShareCreateApiResponse(response: Response): Promise<ShareCreateApiOutcome> {
  let body: unknown;
  try { body = await response.json(); }
  catch { return classifyShareCreateApiResult(response.status, undefined); }
  return classifyShareCreateApiResult(response.status, body);
}

export function classifyShareCreateTransportFailure(error: unknown): ShareCreateApiOutcome {
  void error;
  return { kind: "retain", code: "NETWORK_UNCERTAIN" };
}

function reconciliationReason(body: unknown): "expired" | "owner-deleted" | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const error = (body as Record<string, unknown>).error;
  if (!error || typeof error !== "object" || Array.isArray(error)) return undefined;
  const reason = (error as Record<string, unknown>).reason;
  return reason === "expired" || reason === "owner-deleted" ? reason : undefined;
}

export function serializedShareCreateRecoveryRequest(envelope: ShareCreateRecoveryEnvelope): string {
  return JSON.stringify({ ...envelope.canonicalRequest, idempotencyKey: envelope.idempotencyKey });
}

export async function dispatchShareCreateRecovery(input: {
  readonly envelope: ShareCreateRecoveryEnvelope;
  readonly csrfToken: string;
  readonly fetcher?: typeof fetch;
  readonly signal?: AbortSignal;
}): Promise<ShareCreateApiOutcome> {
  try {
    const response = await (input.fetcher ?? fetch)("/api/shares", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": input.csrfToken },
      body: serializedShareCreateRecoveryRequest(input.envelope),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    return readShareCreateApiResponse(response);
  } catch (error) { return classifyShareCreateTransportFailure(error); }
}

export function completedShareRecoveryTransport(envelope: ShareCreateRecoveryEnvelope, currentSessionAuthority: string): "idempotent-replay" | "owner-reconcile" {
  return envelope.operationLifecycle === "completed" && envelope.createdResponse
    && envelope.sessionAuthority !== currentSessionAuthority
    ? "owner-reconcile"
    : "idempotent-replay";
}

export function pendingShareRecoveryTransport(envelope: ShareCreateRecoveryEnvelope, currentSessionAuthority: string): "idempotent-replay" | "cross-session-recovery" {
  return envelope.operationLifecycle === "pending" && envelope.sessionAuthority !== undefined
    && envelope.sessionAuthority !== currentSessionAuthority
    ? "cross-session-recovery"
    : "idempotent-replay";
}

export function classifyShareCreateReadOnlyRecoveryResult(status: number, body: unknown): ShareCreateReadOnlyRecoveryOutcome {
  const ordinary = classifyShareCreateApiResult(status, body);
  if (ordinary.kind === "completed" || ordinary.kind === "fresh-allowed") return ordinary;
  const code = errorCode(body);
  if (code === "SHARE_CREATE_DETERMINISTIC_NO_EFFECT") return { kind: "fresh-allowed", code };
  if (code === "IDEMPOTENCY_PENDING") return { kind: "retain", code };
  if (code === "IDEMPOTENCY_CONFLICT" || code === "IDEMPOTENCY_AMBIGUOUS") return { kind: "conflict", code };
  if (status === 408) return { kind: "retain", code: "REQUEST_TIMEOUT" };
  if (status === 429) return { kind: "retain", code: "RATE_LIMITED" };
  if (status >= 500) return { kind: "retain", code: "SERVER_TRANSIENT" };
  if (status === 200) return { kind: "retain", code: "RESPONSE_UNCERTAIN" };
  return { kind: "rejected", code: code ?? "SHARE_CREATE_RECOVERY_REJECTED" };
}

export async function dispatchShareCreateReadOnlyRecovery(input: {
  readonly envelope: ShareCreateRecoveryEnvelope;
  readonly csrfToken: string;
  readonly fetcher?: typeof fetch;
  readonly signal?: AbortSignal;
}): Promise<ShareCreateReadOnlyRecoveryOutcome> {
  if (input.envelope.operationLifecycle !== "pending") return { kind: "rejected", code: "SHARE_CREATE_RECOVERY_INVALID" };
  try {
    const response = await (input.fetcher ?? fetch)("/api/shares/recover", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": input.csrfToken },
      body: JSON.stringify({ idempotencyKey: input.envelope.idempotencyKey, requestDigest: input.envelope.requestDigest }),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    let body: unknown;
    try { body = await response.json(); }
    catch { body = undefined; }
    return classifyShareCreateReadOnlyRecoveryResult(response.status, body);
  } catch { return { kind: "retain", code: "NETWORK_UNCERTAIN" }; }
}

export function classifyShareOwnerReconcileApiResult(status: number, body: unknown): ShareOwnerReconcileApiOutcome {
  if (status === 200 && body && typeof body === "object" && !Array.isArray(body)
    && (body as Record<string, unknown>).ok === true && (body as Record<string, unknown>).state === "active") return { kind: "active" };
  const code = errorCode(body);
  const reason = reconciliationReason(body);
  if (status === 409 && code === "SHARE_CREATE_REPLAY_RETIRED" && reason) return { kind: "fresh-allowed", code, reason };
  if (status === 408) return { kind: "retain", code: "REQUEST_TIMEOUT" };
  if (status >= 500) return { kind: "retain", code: "SERVER_TRANSIENT" };
  if (status === 200) return { kind: "retain", code: "RESPONSE_UNCERTAIN" };
  return { kind: "rejected", code: code ?? "SHARE_OWNER_RECONCILE_REJECTED" };
}

export async function dispatchShareOwnerReconciliation(input: {
  readonly envelope: ShareCreateRecoveryEnvelope;
  readonly fetcher?: typeof fetch;
}): Promise<ShareOwnerReconcileApiOutcome> {
  const responseAuthority = input.envelope.createdResponse;
  if (input.envelope.operationLifecycle !== "completed" || !responseAuthority) return { kind: "rejected", code: "SHARE_OWNER_RECONCILE_INVALID" };
  try {
    const response = await (input.fetcher ?? fetch)(`/api/shares/${encodeURIComponent(responseAuthority.token)}/reconcile`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ownerDeleteSecret: responseAuthority.ownerDeleteSecret }),
    });
    let body: unknown;
    try { body = await response.json(); }
    catch { body = undefined; }
    return classifyShareOwnerReconcileApiResult(response.status, body);
  } catch { return { kind: "retain", code: "NETWORK_UNCERTAIN" }; }
}
