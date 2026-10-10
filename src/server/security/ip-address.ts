import { isIP } from "node:net";

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

