import { binaryDigest, canonicalJson } from "../../domain/digest/canonical";
import { clean } from "./edit";
import { SCORE_WORKSPACE_VERSION, type WorkspaceState } from "./model";

/** Only for privately owned, immutable reducer states in one full replay.
 * Keeps the exact v1 canonical bytes; no snapshot or external cached digest is
 * trusted. Weak keys release replaced states and the whole encoder dies after
 * replay. It must never be used with a caller-owned mutable state. */
export function createReplayStateDigester() {
  const encoded = new WeakMap<object, string>();
  const field = (value: unknown): string => {
    if (value === null || typeof value !== "object") return canonicalJson(value);
    const hit = encoded.get(value);
    if (hit !== undefined) return hit;
    const result = canonicalJson(clean(value));
    encoded.set(value, result);
    return result;
  };
  return (state: WorkspaceState): Promise<string> => {
    const fields = Object.entries(state).filter(([, value]) => value !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    const body = fields.map(([key, value]) => `${canonicalJson(key)}:${key === "attestations"
      ? `[${state.attestations.map(field).join(",")}]` : field(value)}`).join(",");
    return binaryDigest(new TextEncoder().encode(`{"schema":${canonicalJson(SCORE_WORKSPACE_VERSION)},"state":{${body}}}`));
  };
}
