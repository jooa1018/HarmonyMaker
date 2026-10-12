import type { PhraseRegion } from "../domain/source/model";
import { comparePositions, type MusicalRange } from "../domain/time";

/** Structural partition only; callers independently generate or verify ties.
 * Preserves the supplied canonical phrase/event order and exact ranges.
 * Events crossing/outside a phrase remain subject to the validator's coverage checks.
 */
export function partitionEventsByPhrase<T extends { readonly range: MusicalRange }>(
  phrases: readonly PhraseRegion[], events: readonly T[],
): readonly { readonly phrase: PhraseRegion; readonly events: readonly T[] }[] {
  return phrases.map(phrase => ({ phrase, events: events.filter(event =>
    comparePositions(phrase.range.start, event.range.start) <= 0
    && comparePositions(event.range.end, phrase.range.end) <= 0) }));
}
