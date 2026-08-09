import type { Fraction } from "../fraction";
import type { TimeSignature } from "../meter";
import type { SourceMeasure } from "../source/model";
import { performanceOccurrenceId } from "../ids";
import { canonicalJson } from "../digest/canonical";
import { CORE_INPUT_LIMITS } from "../limits";

export interface PerformanceMeasureOccurrence {
  readonly occurrenceId: string;
  readonly sourceMeasureId: string;
  readonly sourceMeasureNumber: number;
  readonly occurrenceIndexForSource: number;
  readonly performanceIndex: number;
  readonly time: TimeSignature;
  readonly duration: Fraction;
}
export interface PerformanceSequence {
  readonly occurrences: readonly PerformanceMeasureOccurrence[];
  readonly expanderVersion: string;
}
export type RepeatExpansionResult =
  | { readonly status: "complete"; readonly sequence: PerformanceSequence }
  | { readonly status: "blocked"; readonly code: "PERFORMANCE_REPEAT_UNMATCHED" | "PERFORMANCE_REPEAT_NESTED" | "PERFORMANCE_EXPANSION_FAILED" | "INPUT_LIMIT_EXCEEDED" };

interface RepeatRegion { readonly start: number; readonly end: number; readonly totalPasses: 2 | 3 | 4 }

function findRepeatRegions(measures: readonly SourceMeasure[]): readonly RepeatRegion[] | RepeatExpansionResult {
  const regions: RepeatRegion[] = [];
  let openStart: number | undefined;
  for (let index = 0; index < measures.length; index += 1) {
    const measure = measures[index];
    if (measure.repeat.startRepeat) {
      if (openStart !== undefined) return { status: "blocked", code: "PERFORMANCE_REPEAT_NESTED" };
      openStart = index;
    }
    if (measure.repeat.endRepeat) {
      const start = openStart ?? 0;
      if (regions.some((region) => start <= region.end)) return { status: "blocked", code: "PERFORMANCE_REPEAT_NESTED" };
      regions.push({ start, end: index, totalPasses: measure.repeat.endRepeat.totalPasses });
      openStart = undefined;
    }
  }
  if (openStart !== undefined) return { status: "blocked", code: "PERFORMANCE_REPEAT_UNMATCHED" };
  return regions;
}

function includeOnPass(measure: SourceMeasure, pass: number, totalPasses: number): boolean {
  const endings = measure.repeat.endingNumbers;
  if (!endings || endings.length === 0) return true;
  const ending = pass === 1 ? 1 : 2;
  if (totalPasses > 2 && pass > 1 && !endings.includes(2)) return false;
  return endings.includes(ending);
}

export function expandRepeats(measures: readonly SourceMeasure[], expanderVersion: string): RepeatExpansionResult {
  if (measures.length > CORE_INPUT_LIMITS.maxSourceMeasures) {
    return { status: "blocked", code: "INPUT_LIMIT_EXCEEDED" };
  }
  const found = findRepeatRegions(measures);
  if ("status" in found) return found;
  const order: number[] = [];
  let cursor = 0;
  for (const region of found) {
    while (cursor < region.start) order.push(cursor++);
    for (let pass = 1; pass <= region.totalPasses; pass += 1) {
      for (let index = region.start; index <= region.end; index += 1) {
        if (includeOnPass(measures[index], pass, region.totalPasses)) order.push(index);
      }
    }
    cursor = region.end + 1;
  }
  while (cursor < measures.length) order.push(cursor++);
  if (order.length > CORE_INPUT_LIMITS.maxPerformanceMeasures) {
    return { status: "blocked", code: "INPUT_LIMIT_EXCEEDED" };
  }
  const occurrenceCounts = new Map<string, number>();
  const occurrences = order.map((sourceIndex, performanceIndex): PerformanceMeasureOccurrence => {
    const measure = measures[sourceIndex];
    const occurrenceIndexForSource = occurrenceCounts.get(measure.id) ?? 0;
    occurrenceCounts.set(measure.id, occurrenceIndexForSource + 1);
    return {
      occurrenceId: performanceOccurrenceId(performanceIndex, sourceIndex, occurrenceIndexForSource),
      sourceMeasureId: measure.id,
      sourceMeasureNumber: measure.number,
      occurrenceIndexForSource,
      performanceIndex,
      time: measure.time,
      duration: measure.duration,
    };
  });
  return { status: "complete", sequence: { occurrences, expanderVersion } };
}

export function validatePerformanceSequence(
  sequence: PerformanceSequence,
  measures: readonly SourceMeasure[],
  expectedExpanderVersion: string = sequence.expanderVersion,
): boolean {
  if (sequence.expanderVersion !== expectedExpanderVersion) return false;
  const expanded = expandRepeats(measures, expectedExpanderVersion);
  return expanded.status === "complete"
    && canonicalJson(expanded.sequence) === canonicalJson(sequence);
}
