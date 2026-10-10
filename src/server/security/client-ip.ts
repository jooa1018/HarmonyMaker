import "server-only";
import { normalizeClientIp } from "./ip-address";
export { normalizeClientIp } from "./ip-address";
import type { ApiRequestContext } from "../http/request-context";

export function resolveClientIp(request: Request, context: Pick<ApiRequestContext, "requestId" | "path">,
  environment: Readonly<Record<string, string | undefined>> = process.env): string | undefined {
  const header = (environment.TRUSTED_CLIENT_IP_HEADER?.trim() || (environment.VERCEL === "1" ? "x-real-ip" : "")).toLowerCase();
  if (header && (!/^[a-z0-9-]+$/u.test(header) || ["x-forwarded-for", "forwarded"].includes(header))) {
    throw new RangeError("TRUSTED_CLIENT_IP_HEADER_INVALID");
  }
  const raw = header ? request.headers.get(header) : null;
  const ip = raw === null ? undefined : normalizeClientIp(raw);
  if (!ip) console.warn(JSON.stringify({ event: "client-ip-unavailable", timestamp: new Date().toISOString(), requestId: context.requestId, path: context.path,
    reason: !header ? "unconfigured" : raw === null ? "missing" : "invalid", quota: "unknown-ip-global" }));
  return ip;
}
