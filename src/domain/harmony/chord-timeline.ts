import type { ResolvedChordParseResult } from "../chord/model";
import { chordSemanticProjection } from "../chord/parser";
import { compareCanonicalValues, semanticDigest, type SemanticDigest } from "../digest/canonical";
import type { Diagnostic } from "../diagnostics";
import { addFractions, compareFractions, fraction, type Fraction } from "../fraction";
import type { PerformanceSequence } from "../performance/repeat";
import type { SourceChordEvent, SourceMeasure } from "../source/model";
import { musicalRange, type MusicalPosition, type MusicalRange } from "../time";
import { performanceChordSpanId } from "../ids";

export type ChordGapPolicy = "carry-until-next" | "block-gap";
export interface ChordResolutionPolicy { readonly gapPolicy: ChordGapPolicy }
export type PerformanceChordSpanOrigin =
  | { readonly kind: "source-event"; readonly sourceChordEventId: string }
  | { readonly kind: "carried"; readonly carrySource: "explicit-carry-token" | "gap-policy"; readonly originatingSourceChordEventId: string; readonly previousSpanId: string; readonly carryTokenSourceChordEventId?: string };
export interface PerformanceChordSpan { readonly id: string; readonly range: MusicalRange; readonly parseResult: ResolvedChordParseResult; readonly origin: PerformanceChordSpanOrigin }
export interface EffectiveChordTimeline {
  readonly sourceChordProjectionDigest: SemanticDigest;
  readonly performanceSequenceDigest: SemanticDigest;
  readonly resolutionPolicy: ChordResolutionPolicy;
  readonly chordTimelineResolverVersion: string;
  readonly spans: readonly PerformanceChordSpan[];
  readonly digest: SemanticDigest;
}
export type EffectiveChordTimelineState =
  | { readonly status: "unresolved"; readonly resolutionPolicy: ChordResolutionPolicy; readonly diagnostics: readonly Diagnostic[] }
  | { readonly status: "resolved"; readonly timeline: EffectiveChordTimeline; readonly diagnostics: readonly Diagnostic[] }
  | { readonly status: "stale"; readonly previousTimeline: EffectiveChordTimeline; readonly resolutionPolicy: ChordResolutionPolicy; readonly diagnostics: readonly Diagnostic[] }
  | { readonly status: "blocked"; readonly previousTimeline?: EffectiveChordTimeline; readonly resolutionPolicy: ChordResolutionPolicy; readonly diagnostics: readonly Diagnostic[] };

export interface CanonicalSourceChordOrdinal {
  readonly sourceMeasureOrdinal: number;
  readonly chordOrdinalWithinMeasure: number;
}

function sourceChordSemanticProjection(event: SourceChordEvent): object {
  const parseResult = event.parseResult.status === "ok"
    ? { status: "ok", chord: chordSemanticProjection(event.parseResult.chord) }
    : event.parseResult.status === "failed"
      ? { status: "failed", errorCode: event.parseResult.errorCode, token: event.parseResult.token ?? null }
      : { status: event.parseResult.status };
  return {
    onset: event.onset,
    parseResult,
    confirmation: event.confirmation,
  };
}

function orderedChordEvents(measure: SourceMeasure): readonly SourceChordEvent[] {
  return measure.chordEvents
    .map((event, originalOrdinal) => ({ event, originalOrdinal }))
    .sort((left, right) => compareCanonicalValues(
      sourceChordSemanticProjection(left.event),
      sourceChordSemanticProjection(right.event),
    ) || left.originalOrdinal - right.originalOrdinal)
    .map((entry) => entry.event);
}

export function buildSourceChordOrdinalRegistry(
  sourceMeasures: readonly SourceMeasure[],
): Readonly<Record<string, CanonicalSourceChordOrdinal>> {
  const entries: Array<readonly [string, CanonicalSourceChordOrdinal]> = [];
  sourceMeasures.forEach((measure, sourceMeasureOrdinal) => {
    orderedChordEvents(measure).forEach((event, chordOrdinalWithinMeasure) => {
      entries.push([event.id, { sourceMeasureOrdinal, chordOrdinalWithinMeasure }]);
    });
  });
  if (new Set(entries.map(([id]) => id)).size !== entries.length) {
    throw new RangeError("duplicate SourceChordEvent ID");
  }
  return Object.fromEntries(entries);
}

function requiredSourceChordOrdinal(
  registry: Readonly<Record<string, CanonicalSourceChordOrdinal>>,
  id: string,
): CanonicalSourceChordOrdinal {
  const ordinal = registry[id];
  if (!ordinal) throw new RangeError(`missing canonical source chord ordinal: ${id}`);
  return ordinal;
}

export async function digestSourceChordProjection(
  sourceMeasures: readonly SourceMeasure[],
): Promise<SemanticDigest> {
  return semanticDigest({
    projectionSchema: "hm-source-chord-projection-v1",
    measures: sourceMeasures.map((measure, sourceMeasureOrdinal) => ({
      sourceMeasureOrdinal,
      chordEvents: orderedChordEvents(measure).map(sourceChordSemanticProjection),
    })),
  });
}

export async function digestPerformanceSequence(
  performanceSequence: PerformanceSequence,
  sourceMeasures: readonly SourceMeasure[],
): Promise<SemanticDigest> {
  const measureOrdinalById = Object.fromEntries(
    sourceMeasures.map((measure, ordinal) => [measure.id, ordinal]),
  );
  if (Object.keys(measureOrdinalById).length !== sourceMeasures.length) {
    throw new RangeError("duplicate SourceMeasure ID");
  }
  return semanticDigest({
    projectionSchema: "hm-performance-sequence-v1",
    expanderVersion: performanceSequence.expanderVersion,
    occurrences: performanceSequence.occurrences.map((occurrence) => {
      const sourceMeasureOrdinal = measureOrdinalById[occurrence.sourceMeasureId];
      if (!Number.isSafeInteger(sourceMeasureOrdinal) || sourceMeasureOrdinal < 0) {
        throw new RangeError(`missing canonical source measure ordinal: ${occurrence.sourceMeasureId}`);
      }
      return {
        sourceMeasureOrdinal,
        sourceMeasureNumber: occurrence.sourceMeasureNumber,
        occurrenceIndexForSource: occurrence.occurrenceIndexForSource,
        performanceIndex: occurrence.performanceIndex,
        time: occurrence.time,
        duration: occurrence.duration,
      };
    }),
  });
}

function timelineProjection(
  timeline: Omit<EffectiveChordTimeline, "digest">,
  sourceMeasures: readonly SourceMeasure[],
): object {
  const sourceChordOrdinalById = buildSourceChordOrdinalRegistry(sourceMeasures);
  const spanOrdinalById = Object.fromEntries(
    timeline.spans.map((span, ordinal) => [span.id, ordinal]),
  );
  if (Object.keys(spanOrdinalById).length !== timeline.spans.length) {
    throw new RangeError("duplicate PerformanceChordSpan ID");
  }
  const spans = timeline.spans.map((span) => {
    const origin = span.origin.kind === "source-event"
      ? {
          kind: span.origin.kind,
          sourceChordOrdinal: requiredSourceChordOrdinal(
            sourceChordOrdinalById,
            span.origin.sourceChordEventId,
          ),
        }
      : {
          kind: span.origin.kind,
          carrySource: span.origin.carrySource,
          originatingSourceChordOrdinal: requiredSourceChordOrdinal(
            sourceChordOrdinalById,
            span.origin.originatingSourceChordEventId,
          ),
          previousSpanOrdinal: (() => {
            const ordinal = spanOrdinalById[span.origin.previousSpanId];
            if (!Number.isSafeInteger(ordinal) || ordinal < 0) {
              throw new RangeError(`missing canonical chord span ordinal: ${span.origin.previousSpanId}`);
            }
            return ordinal;
          })(),
          carryTokenSourceChordOrdinal: span.origin.carryTokenSourceChordEventId === undefined
            ? null
            : requiredSourceChordOrdinal(
                sourceChordOrdinalById,
                span.origin.carryTokenSourceChordEventId,
              ),
        };
    return { range: span.range, parseResult: span.parseResult, origin };
  });
  return {
    projectionSchema: "hm-effective-chord-timeline-v1",
    sourceChordProjectionDigest: timeline.sourceChordProjectionDigest,
    performanceSequenceDigest: timeline.performanceSequenceDigest,
    policy: timeline.resolutionPolicy,
    resolverVersion: timeline.chordTimelineResolverVersion,
    spans,
  };
}

export async function digestEffectiveChordTimeline(
  timeline: Omit<EffectiveChordTimeline, "digest">,
  sourceMeasures: readonly SourceMeasure[],
): Promise<SemanticDigest> {
  return semanticDigest(timelineProjection(timeline, sourceMeasures));
}

function diagnostic(code: Diagnostic["code"], suffix: string): Diagnostic {
  return { id: `dg:${code}:${suffix}:0`, code, severity: "blocking", messageKo: code };
}
function resolved(event: SourceChordEvent): ResolvedChordParseResult | undefined {
  if (event.parseResult.status === "ok") return { status: "ok", chord: event.parseResult.chord };
  if (event.parseResult.status === "no-chord") return { status: "no-chord", sourceText: event.parseResult.sourceText };
  return undefined;
}

function soundingLeadSegments(
  measure: SourceMeasure,
  performanceMeasureIndex: number,
  start: Fraction,
  end: Fraction,
  durations: readonly Fraction[],
): readonly MusicalRange[] {
  const overlaps = measure.leadEvents
    .filter((event) => event.kind === "note")
    .map((event) => {
      const eventEnd = addFractions(event.onset, event.duration);
      const overlapStart = compareFractions(event.onset, start) < 0 ? start : event.onset;
      const overlapEnd = compareFractions(eventEnd, end) > 0 ? end : eventEnd;
      return { start: overlapStart, end: overlapEnd };
    })
    .filter((range) => compareFractions(range.start, range.end) < 0)
    .sort((left, right) => compareFractions(left.start, right.start) || compareFractions(left.end, right.end));
  const merged: Array<{ start: Fraction; end: Fraction }> = [];
  for (const overlap of overlaps) {
    const previous = merged.at(-1);
    if (previous && compareFractions(overlap.start, previous.end) <= 0) {
      if (compareFractions(overlap.end, previous.end) > 0) previous.end = overlap.end;
    } else merged.push({ ...overlap });
  }
  return merged.map((range) => musicalRange(
    { performanceMeasureIndex, offset: range.start },
    { performanceMeasureIndex, offset: range.end },
    durations,
  ));
}

export async function resolveEffectiveChordTimeline(input: {
  readonly sourceMeasures: readonly SourceMeasure[];
  readonly performanceSequence: PerformanceSequence;
  readonly sourceChordProjectionDigest: SemanticDigest;
  readonly performanceSequenceDigest: SemanticDigest;
  readonly policy: ChordResolutionPolicy;
  readonly resolverVersion: string;
  readonly expectedResolverVersion: string;
}): Promise<EffectiveChordTimelineState> {
  if (input.policy.gapPolicy !== "carry-until-next" && input.policy.gapPolicy !== "block-gap") throw new RangeError("allow-no-chord is not a Core gap policy");
  if (input.resolverVersion !== input.expectedResolverVersion) return { status: "blocked", resolutionPolicy: input.policy, diagnostics: [diagnostic("CHORD_RESOLVER_VERSION_MISMATCH", "version")] };
  const byId = new Map(input.sourceMeasures.map((measure) => [measure.id, measure]));
  const spans: PerformanceChordSpan[] = [];
  const diagnostics: Diagnostic[] = [];
  const durations = input.performanceSequence.occurrences.map((item) => item.duration);
  let previousState: { readonly parseResult: ResolvedChordParseResult; readonly originatingSourceChordEventId: string; readonly spanId: string } | undefined;
  for (const occurrence of input.performanceSequence.occurrences) {
    const measure = byId.get(occurrence.sourceMeasureId);
    if (!measure) { diagnostics.push(diagnostic("PERFORMANCE_EXPANSION_FAILED", occurrence.occurrenceId)); continue; }
    const events = orderedChordEvents(measure);
    let cursor = fraction(0);
    const resolveUncovered = (startOffset: Fraction, endOffset: Fraction): void => {
      for (const gapRange of soundingLeadSegments(
        measure,
        occurrence.performanceIndex,
        startOffset,
        endOffset,
        durations,
      )) {
        if (input.policy.gapPolicy === "carry-until-next" && previousState) {
          const id = performanceChordSpanId(gapRange.start, gapRange.end);
          spans.push({ id, range: gapRange, parseResult: previousState.parseResult, origin: { kind: "carried", carrySource: "gap-policy", originatingSourceChordEventId: previousState.originatingSourceChordEventId, previousSpanId: previousState.spanId } });
          previousState = { ...previousState, spanId: id };
        } else diagnostics.push(diagnostic("SOURCE_CHORD_GAP", `${occurrence.performanceIndex}:${gapRange.start.offset.n}/${gapRange.start.offset.d}`));
      }
    };
    for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
      const event = events[eventIndex];
      const start: MusicalPosition = { performanceMeasureIndex: occurrence.performanceIndex, offset: event.onset };
      if (compareFractions(cursor, event.onset) < 0) {
        resolveUncovered(cursor, event.onset);
      }
      const nextOnset = events[eventIndex + 1]?.onset ?? occurrence.duration;
      if (compareFractions(nextOnset, event.onset) <= 0) { diagnostics.push(diagnostic("INPUT_EVENT_OVERLAP", event.id)); continue; }
      const range = musicalRange(start, { performanceMeasureIndex: occurrence.performanceIndex, offset: nextOnset }, durations);
      if (event.confirmation !== "confirmed") { diagnostics.push(diagnostic("SOURCE_CHORD_UNCONFIRMED", event.id)); cursor = nextOnset; continue; }
      if (event.parseResult.status === "carry") {
        if (!previousState) diagnostics.push(diagnostic("SOURCE_CHORD_CARRY_WITHOUT_PREVIOUS", event.id));
        else {
          const id = performanceChordSpanId(range.start, range.end);
          spans.push({ id, range, parseResult: previousState.parseResult, origin: { kind: "carried", carrySource: "explicit-carry-token", originatingSourceChordEventId: previousState.originatingSourceChordEventId, previousSpanId: previousState.spanId, carryTokenSourceChordEventId: event.id } });
          previousState = { ...previousState, spanId: id };
        }
      } else {
        const parseResult = resolved(event);
        if (!parseResult) diagnostics.push(diagnostic("SOURCE_CHORD_PARSE_FAILED", event.id));
        else {
          const id = performanceChordSpanId(range.start, range.end);
          spans.push({ id, range, parseResult, origin: { kind: "source-event", sourceChordEventId: event.id } });
          previousState = { parseResult, originatingSourceChordEventId: event.id, spanId: id };
        }
      }
      cursor = nextOnset;
    }
    if (compareFractions(cursor, occurrence.duration) < 0) {
      resolveUncovered(cursor, occurrence.duration);
    }
  }
  if (diagnostics.length > 0) return { status: "blocked", resolutionPolicy: input.policy, diagnostics };
  const timeline = {
    sourceChordProjectionDigest: input.sourceChordProjectionDigest,
    performanceSequenceDigest: input.performanceSequenceDigest,
    resolutionPolicy: input.policy,
    chordTimelineResolverVersion: input.resolverVersion,
    spans,
  };
  const digest = await digestEffectiveChordTimeline(timeline, input.sourceMeasures);
  return { status: "resolved", timeline: { sourceChordProjectionDigest: input.sourceChordProjectionDigest, performanceSequenceDigest: input.performanceSequenceDigest, resolutionPolicy: input.policy, chordTimelineResolverVersion: input.resolverVersion, spans, digest }, diagnostics: [] };
}
