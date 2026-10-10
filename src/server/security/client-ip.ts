import "server-only";
import { isIP } from "node:net";
import type { ApiRequestContext } from "../http/request-context";

/** Accept only one IP literal; never choose an element from a proxy chain. */
export function normalizeClientIp(value: string): string | undefined {
  const ip = value.trim();
  if (ip.includes("%") || !isIP(ip)) return undefined;
  if (isIP(ip) === 4) return ip;
  const canonical = new URL(`http://[${ip}]`).hostname.slice(1, -1);
  const mapped = /^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/u.exec(canonical);
  if (!mapped) return canonical;
  const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join(".");
}

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
