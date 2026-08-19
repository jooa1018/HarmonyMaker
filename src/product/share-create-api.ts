import type { StoredShareCreateResponse } from "./share-create-recovery";

export type ShareCreateApiOutcome =
  | { readonly kind: "completed"; readonly response: StoredShareCreateResponse }
  | { readonly kind: "retain"; readonly code: "NETWORK_UNCERTAIN" | "RESPONSE_UNCERTAIN" | "REQUEST_TIMEOUT" | "RATE_LIMITED" | "SERVER_TRANSIENT" | "IDEMPOTENCY_PENDING" }
  | { readonly kind: "fresh-allowed"; readonly code: "SHARE_CREATE_REPLAY_RETIRED" }
  | { readonly kind: "conflict"; readonly code: "IDEMPOTENCY_CONFLICT" }
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

export function classifyShareCreateTransportFailure(_error: unknown): ShareCreateApiOutcome {
  return { kind: "retain", code: "NETWORK_UNCERTAIN" };
}
