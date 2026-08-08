import { addFractions, compareFractions, fraction, subtractFractions, type Fraction } from "./fraction";
import { pitchMidiNumber, type SpelledPitch } from "./pitch";
import { durationRate, extendedCountRate } from "./rates";
import type { ActivityDensityMetrics } from "./plans";
import type { TextureDensityMetrics } from "./generation/model";
import { comparePositions, positionWithinRange, type MusicalPosition, type MusicalRange } from "./time";

export interface DensityEvent {
  readonly trackPlanId: string;
  readonly isLead: boolean;
  readonly range: MusicalRange;
  readonly pitch: SpelledPitch | null;
  readonly attack: boolean;
}

function durationBetween(start: MusicalPosition, end: MusicalPosition, measureDurations: readonly Fraction[]): Fraction {
  if (comparePositions(start, end) >= 0) throw new RangeError("interval must be positive");
  if (start.performanceMeasureIndex === end.performanceMeasureIndex) return subtractFractions(end.offset, start.offset);
  let total = subtractFractions(measureDurations[start.performanceMeasureIndex], start.offset);
  for (let index = start.performanceMeasureIndex + 1; index < end.performanceMeasureIndex; index += 1) total = addFractions(total, measureDurations[index]);
  return addFractions(total, end.offset);
}

export function integrateTextureDensity(
  phraseRange: MusicalRange,
  events: readonly DensityEvent[],
  measureDurations: readonly Fraction[],
): TextureDensityMetrics {
  const boundaries = [phraseRange.start, phraseRange.end, ...events.flatMap((event) => [event.range.start, event.range.end])]
    .filter((position) => comparePositions(position, phraseRange.start) >= 0 && comparePositions(position, phraseRange.end) <= 0)
    .sort(comparePositions)
    .filter((position, index, all) => index === 0 || comparePositions(position, all[index - 1]) !== 0);
  let leadNoteDuration = fraction(0);
  let leadRestDuration = fraction(0);
  let participation = fraction(0);
  let harmonyOverRest = fraction(0);
  let divergence = fraction(0);
  let exactlyTwo = fraction(0);
  let exactlyThree = fraction(0);
  let maxHarmony = 0;
  const weightedSpreads: { readonly spread: number; readonly duration: Fraction }[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    const duration = durationBetween(start, end, measureDurations);
    const sounding = events.filter((event) => positionWithinRange(start, event.range));
    const leadPitches = sounding.filter((event) => event.isLead && event.pitch).map((event) => pitchMidiNumber(event.pitch as SpelledPitch));
    const harmonyPitches = sounding.filter((event) => !event.isLead && event.pitch).map((event) => pitchMidiNumber(event.pitch as SpelledPitch));
    const leadSounding = leadPitches.length > 0;
    if (leadSounding) leadNoteDuration = addFractions(leadNoteDuration, duration);
    else leadRestDuration = addFractions(leadRestDuration, duration);
    if (harmonyPitches.length > 0) {
      participation = leadSounding ? addFractions(participation, duration) : participation;
      harmonyOverRest = leadSounding ? harmonyOverRest : addFractions(harmonyOverRest, duration);
    }
    maxHarmony = Math.max(maxHarmony, new Set(sounding.filter((event) => !event.isLead && event.pitch).map((event) => event.trackPlanId)).size);
    if (leadSounding) {
      const lead = leadPitches[0];
      if (harmonyPitches.some((pitch) => pitch !== lead)) divergence = addFractions(divergence, duration);
      const distinct = [...new Set([...leadPitches, ...harmonyPitches])].sort((a, b) => a - b);
      if (distinct.length === 2) exactlyTwo = addFractions(exactlyTwo, duration);
      if (distinct.length === 3) exactlyThree = addFractions(exactlyThree, duration);
      if (distinct.length >= 2) weightedSpreads.push({ spread: distinct.at(-1)! - distinct[0], duration });
    }
  }
  const leadAttacks = events.filter((event) => event.isLead && event.pitch && event.attack).length;
  const harmonyAttacks = events.filter((event) => !event.isLead && event.pitch && event.attack).length;
  const totalSpreadDuration = weightedSpreads.reduce((sum, entry) => addFractions(sum, entry.duration), fraction(0));
  let accumulated = fraction(0);
  let median = 0;
  for (const entry of [...weightedSpreads].sort((a, b) => a.spread - b.spread)) {
    accumulated = addFractions(accumulated, entry.duration);
    if (compareFractions({ n: accumulated.n * 2, d: accumulated.d }, totalSpreadDuration) >= 0) { median = entry.spread; break; }
  }
  return {
    participationCoverage: durationRate(participation, leadNoteDuration),
    harmonyAttackRatio: extendedCountRate(harmonyAttacks, leadAttacks),
    harmonyOverLeadRestCoverage: durationRate(harmonyOverRest, leadRestDuration),
    maxSimultaneousHarmonyTracks: Math.min(2, maxHarmony) as 0 | 1 | 2,
    harmonicDivergenceCoverage: durationRate(divergence, leadNoteDuration),
    exactlyTwoPitchCoverage: durationRate(exactlyTwo, leadNoteDuration),
    exactlyThreePitchCoverage: durationRate(exactlyThree, leadNoteDuration),
    medianRegisterSpreadSemitones: median,
  };
}

export function activityDensity(metrics: TextureDensityMetrics): ActivityDensityMetrics {
  return { participationCoverage: metrics.participationCoverage, harmonyAttackRatio: metrics.harmonyAttackRatio, harmonyOverLeadRestCoverage: metrics.harmonyOverLeadRestCoverage, maxSimultaneousHarmonyTracks: metrics.maxSimultaneousHarmonyTracks };
}

