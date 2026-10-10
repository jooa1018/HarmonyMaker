export interface HostTrustEnvironment {
  readonly [key: string]: string | undefined;
  readonly TRUST_FORWARDED_HOST?: string;
  readonly VERCEL?: string;
}

/** Trust forwarded authority only when the deployment overwrites it. */
export function requestHost(request: Request, environment: HostTrustEnvironment = process.env): string | undefined {
  const trustForwarded = environment.TRUST_FORWARDED_HOST === "1"
    || (environment.TRUST_FORWARDED_HOST === undefined && environment.VERCEL === "1");
  const raw = (trustForwarded ? request.headers.get("x-forwarded-host") : null)
    ?? request.headers.get("host");
  if (!raw || /[\s,/@?#\\]/u.test(raw)) return undefined;
  try {
    const parsed = new URL(`https://${raw}`);
    // Preserve explicit ports for comparison with the supplied Origin.
    if (!parsed.hostname || parsed.pathname !== "/") return undefined;
    return raw.toLowerCase();
  } catch { return undefined; }
}
