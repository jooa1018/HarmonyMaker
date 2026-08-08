import type { ResolvedChordParseResult } from "../chord/model";
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
    const events = [...measure.chordEvents].sort((left, right) =>
      compareFractions(left.onset, right.onset)
      || compareCanonicalValues(
        { sourceText: left.sourceText, parseResult: left.parseResult, source: left.source, confirmation: left.confirmation },
        { sourceText: right.sourceText, parseResult: right.parseResult, source: right.source, confirmation: right.confirmation },
      ));
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
  const projection = { projectionSchema: "hm-effective-chord-timeline-v1", sourceChordProjectionDigest: input.sourceChordProjectionDigest, performanceSequenceDigest: input.performanceSequenceDigest, policy: input.policy, resolverVersion: input.resolverVersion, spans: spans.map((span) => ({ range: span.range, parseResult: span.parseResult, origin: span.origin })) };
  const digest = await semanticDigest(projection);
  return { status: "resolved", timeline: { sourceChordProjectionDigest: input.sourceChordProjectionDigest, performanceSequenceDigest: input.performanceSequenceDigest, resolutionPolicy: input.policy, chordTimelineResolverVersion: input.resolverVersion, spans, digest }, diagnostics: [] };
}
