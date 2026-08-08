import type { ResolvedChordParseResult } from "../chord/model";
import { semanticDigest, type SemanticDigest } from "../digest/canonical";
import type { Diagnostic } from "../diagnostics";
import { compareFractions, fraction } from "../fraction";
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
  let previousState: { readonly parseResult: ResolvedChordParseResult; readonly originatingSourceChordEventId: string; readonly spanId: string } | undefined;
  for (const occurrence of input.performanceSequence.occurrences) {
    const measure = byId.get(occurrence.sourceMeasureId);
    if (!measure) { diagnostics.push(diagnostic("PERFORMANCE_EXPANSION_FAILED", occurrence.occurrenceId)); continue; }
    const events = [...measure.chordEvents].sort((a, b) => compareFractions(a.onset, b.onset) || a.id.localeCompare(b.id));
    let cursor = fraction(0);
    for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
      const event = events[eventIndex];
      const start: MusicalPosition = { performanceMeasureIndex: occurrence.performanceIndex, offset: event.onset };
      if (compareFractions(cursor, event.onset) < 0) {
        if (input.policy.gapPolicy === "carry-until-next" && previousState) {
          const gapRange = musicalRange({ performanceMeasureIndex: occurrence.performanceIndex, offset: cursor }, start);
          const id = performanceChordSpanId(gapRange.start, gapRange.end);
          spans.push({ id, range: gapRange, parseResult: previousState.parseResult, origin: { kind: "carried", carrySource: "gap-policy", originatingSourceChordEventId: previousState.originatingSourceChordEventId, previousSpanId: previousState.spanId } });
          previousState = { ...previousState, spanId: id };
        } else diagnostics.push(diagnostic("SOURCE_CHORD_GAP", `${occurrence.performanceIndex}:${cursor.n}`));
      }
      const nextOnset = events[eventIndex + 1]?.onset ?? occurrence.duration;
      if (compareFractions(nextOnset, event.onset) <= 0) { diagnostics.push(diagnostic("INPUT_EVENT_OVERLAP", event.id)); continue; }
      const range = musicalRange(start, { performanceMeasureIndex: occurrence.performanceIndex, offset: nextOnset }, input.performanceSequence.occurrences.map((item) => item.duration));
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
      const end: MusicalPosition = { performanceMeasureIndex: occurrence.performanceIndex, offset: occurrence.duration };
      if (input.policy.gapPolicy === "carry-until-next" && previousState) {
        const range = musicalRange({ performanceMeasureIndex: occurrence.performanceIndex, offset: cursor }, end, input.performanceSequence.occurrences.map((item) => item.duration));
        const id = performanceChordSpanId(range.start, range.end);
        spans.push({ id, range, parseResult: previousState.parseResult, origin: { kind: "carried", carrySource: "gap-policy", originatingSourceChordEventId: previousState.originatingSourceChordEventId, previousSpanId: previousState.spanId } });
        previousState = { ...previousState, spanId: id };
      } else diagnostics.push(diagnostic("SOURCE_CHORD_GAP", `${occurrence.performanceIndex}:tail`));
    }
  }
  if (diagnostics.length > 0) return { status: "blocked", resolutionPolicy: input.policy, diagnostics };
  const projection = { projectionSchema: "hm-effective-chord-timeline-v1", sourceChordProjectionDigest: input.sourceChordProjectionDigest, performanceSequenceDigest: input.performanceSequenceDigest, policy: input.policy, resolverVersion: input.resolverVersion, spans: spans.map((span) => ({ range: span.range, parseResult: span.parseResult, origin: span.origin })) };
  const digest = await semanticDigest(projection);
  return { status: "resolved", timeline: { sourceChordProjectionDigest: input.sourceChordProjectionDigest, performanceSequenceDigest: input.performanceSequenceDigest, resolutionPolicy: input.policy, chordTimelineResolverVersion: input.resolverVersion, spans, digest }, diagnostics: [] };
}
