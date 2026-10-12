import { compareFractions, fraction } from "./fraction";
import type { ChordResolutionPolicy } from "./harmony/chord-timeline";
import type { CompactChord, CompactMeasureOccurrence } from "./share";
import { hasExactKeys, isPlainRecord } from "./validation";

/** Payload-local ordinals. No Source/workspace identifiers are published. */
export type CompactChordOrigin =
  | { readonly kind: "source-event"; readonly source: number }
  | { readonly kind: "arrangement-policy"; readonly policy: "anticipate-first-chord"; readonly followingSource: number }
  | { readonly kind: "carried"; readonly carrySource: "explicit-carry-token" | "gap-policy"; readonly source: number; readonly previous: number; readonly tokenSource?: number };

function ordinal(value: unknown, count: number): value is number { return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) < count; }
export function isCompactChordOrigin(value: unknown, count: number): value is CompactChordOrigin {
  if (!isPlainRecord(value)) return false;
  if (value.kind === "source-event") return hasExactKeys(value, ["kind","source"]) && ordinal(value.source, count);
  if (value.kind === "arrangement-policy") return hasExactKeys(value, ["kind","policy","followingSource"])
    && value.policy === "anticipate-first-chord" && ordinal(value.followingSource, count);
  return value.kind === "carried" && hasExactKeys(value, ["kind","carrySource","source","previous"], ["tokenSource"])
    && ["explicit-carry-token","gap-policy"].includes(String(value.carrySource))
    && ordinal(value.source, count) && ordinal(value.previous, count)
    && (value.carrySource === "explicit-carry-token" ? ordinal(value.tokenSource, count) : value.tokenSource === undefined);
}
function sameChord(a: CompactChord, b: CompactChord): boolean { return a.kind === b.kind && (a.kind !== "chord" || b.kind === "chord" && a.symbol === b.symbol); }
function startBeforeEnd(a: CompactChord, b: CompactChord): boolean {
  return a.endOccurrenceIndex < b.startOccurrenceIndex || a.endOccurrenceIndex === b.startOccurrenceIndex
    && compareFractions(fraction(...a.endOffset), fraction(...b.startOffset)) <= 0;
}

/** Validates explicit compact links; it never infers or applies a new policy. */
export function validCompactChordPolicy(
  policy: unknown, chords: readonly CompactChord[], measures: readonly CompactMeasureOccurrence[],
): policy is ChordResolutionPolicy {
  if (!isPlainRecord(policy) || !hasExactKeys(policy, ["gapPolicy","initialPickup"])
    || !["carry-until-next","block-gap"].includes(String(policy.gapPolicy))
    || policy.initialPickup !== "anticipate-first-chord" || !chords.length || measures.length < 2
    || !chords.every(c => isCompactChordOrigin(c.origin, chords.length))) return false;
  const first = measures[0];
  if (compareFractions(fraction(...first.duration), fraction(first.timeSignature[0]*4, first.timeSignature[1])) >= 0) return false;
  const sources = new Map<number, { first: CompactChord; count: number }>(), tokens = new Set<number>(), used = new Set<number>();
  for (const c of chords) {
    const o = c.origin!;
    if (o.kind === "source-event") {
      const previous = sources.get(o.source);
      if (previous && !sameChord(previous.first,c)) return false;
      sources.set(o.source, {first:previous?.first ?? c,count:(previous?.count ?? 0)+1}); used.add(o.source);
    } else if (o.kind === "carried" && o.tokenSource !== undefined) { tokens.add(o.tokenSource); used.add(o.tokenSource); }
  }
  if ([...tokens].some(source => sources.has(source)) || [...used].some(source => source >= used.size)) return false;
  let policies = 0;
  for (const [index,c] of chords.entries()) {
    const o = c.origin!;
    if (index && !startBeforeEnd(chords[index-1],c)) return false;
    if (o.kind === "arrangement-policy") {
      policies++;
      const anchors = sources.get(o.followingSource);
      if (c.kind !== "chord" || c.startOccurrenceIndex !== 0
        || (c.endOccurrenceIndex !== 0 && !(c.endOccurrenceIndex === 1 && c.endOffset[0] === 0))
        || !anchors || anchors.count !== 1 || anchors.first.startOccurrenceIndex !== 1
        || anchors.first.startOffset[0] !== 0 || !sameChord(c,anchors.first) || !startBeforeEnd(c,anchors.first)) return false;
    } else if (o.kind === "carried") {
      const previous = chords[o.previous], po = previous?.origin;
      if (o.previous >= index || !po || po.kind === "arrangement-policy" || po.source !== o.source
        || !sources.has(o.source) || !sameChord(c,previous) || !startBeforeEnd(previous,c)
        || o.carrySource === "gap-policy" && policy.gapPolicy !== "carry-until-next") return false;
    } else if (c.startOccurrenceIndex === 0) return false; // A printed pickup chord cannot also be an anticipated one.
  }
  return policies > 0;
}
