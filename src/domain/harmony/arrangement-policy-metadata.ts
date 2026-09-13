import { hasExactKeys, isCanonicalId, isMusicalRange, isPlainRecord } from "../validation";
import type { MusicalRange } from "../time";

/** Portable export evidence. These references belong to the exported document,
 * not to a newly imported Source; reading this never grants policy approval. */
export interface ArrangementChordPolicyMetadata {
  readonly version: "hm-arrangement-chord-policy-v1";
  readonly resolutionPolicy: { readonly gapPolicy: "carry-until-next" | "block-gap"; readonly initialPickup: "anticipate-first-chord" };
  readonly spans: readonly {
    readonly id: string; readonly range: MusicalRange; readonly symbol: string;
    readonly origin: { readonly kind: "arrangement-policy"; readonly policy: "anticipate-first-chord"; readonly followingSourceChordEventId: string };
  }[];
}

export function parseArrangementChordPolicyMetadata(encoded: string): ArrangementChordPolicyMetadata {
  const invalid = (): never => { throw new RangeError("MUSICXML_ARRANGEMENT_POLICY_METADATA_INVALID"); };
  if (encoded.length > 64_000) return invalid();
  let value: unknown;
  try { value = JSON.parse(encoded); } catch { return invalid(); }
  if (!isPlainRecord(value) || !hasExactKeys(value, ["version", "resolutionPolicy", "spans"])
    || value.version !== "hm-arrangement-chord-policy-v1" || !isPlainRecord(value.resolutionPolicy)
    || !hasExactKeys(value.resolutionPolicy, ["gapPolicy", "initialPickup"])
    || (value.resolutionPolicy.gapPolicy !== "carry-until-next" && value.resolutionPolicy.gapPolicy !== "block-gap")
    || value.resolutionPolicy.initialPickup !== "anticipate-first-chord"
    || !Array.isArray(value.spans) || value.spans.length < 1 || value.spans.length > 256) return invalid();
  for (const span of value.spans) {
    if (!isPlainRecord(span) || !hasExactKeys(span, ["id", "range", "symbol", "origin"])
      || !isCanonicalId(span.id) || !isMusicalRange(span.range)
      || typeof span.symbol !== "string" || !span.symbol.trim() || span.symbol.length > 128
      || !isPlainRecord(span.origin) || !hasExactKeys(span.origin, ["kind", "policy", "followingSourceChordEventId"])
      || span.origin.kind !== "arrangement-policy" || span.origin.policy !== "anticipate-first-chord"
      || !isCanonicalId(span.origin.followingSourceChordEventId)) return invalid();
  }
  if (new Set(value.spans.map(span => span.id)).size !== value.spans.length) return invalid();
  return value as unknown as ArrangementChordPolicyMetadata;
}
