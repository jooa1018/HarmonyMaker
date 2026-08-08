import type { LyricToken, ProductionLyricEmphasis } from "./model";

export function isLyricToken(value: unknown): value is LyricToken {
  if (typeof value !== "object" || value === null) return false;
  const token = value as Readonly<Record<string, unknown>>;
  if (typeof token.id !== "string" || typeof token.text !== "string" || typeof token.leadEventId !== "string") return false;
  if (!Number.isSafeInteger(token.verse) || (token.verse as number) < 1 || typeof token.extend !== "boolean") return false;
  if (!["single", "begin", "middle", "end"].includes(String(token.syllabic))) return false;
  if (token.emphasis === "none") return token.emphasisSource === undefined;
  if (token.emphasis === "suggested") return token.emphasisSource === "musicxml-accent" || token.emphasisSource === "metric-heuristic";
  if (token.emphasis === "confirmed") return token.emphasisSource === "manual" || token.emphasisSource === "musicxml-accent" || token.emphasisSource === "metric-heuristic";
  return false;
}

export function resolveProductionLyricEmphasis(token: LyricToken): ProductionLyricEmphasis {
  if (token.emphasis === "confirmed") return "confirmed";
  if (token.emphasis === "suggested" && token.emphasisSource === "musicxml-accent") return "musicxml-accent-suggested";
  return "none";
}
