import type { ArrangementPresetId } from "../config";
import { compareCanonicalValues, semanticDigest, type SemanticDigest } from "../digest/canonical";
import type { Diagnostic } from "../diagnostics";
import { comparePositions, compareRanges } from "../time";
import type {
  ArrangementCandidate, FullSongMetrics, GeneratedVoiceEvent,
  GeneratedVoiceEventPayload, RealizedHarmonyAnchor,
} from "./model";

export interface CandidateTrackPayload { readonly trackPlanId: string; readonly events: readonly GeneratedVoiceEventPayload[] }
export interface CandidateOrdinalRegistry { readonly trackOrdinalById: Readonly<Record<string, number>>; readonly lyricOrdinalById: Readonly<Record<string, number>>; readonly anchorDirectiveOrdinalById: Readonly<Record<string, number>> }
export interface CandidateBuildInput {
  readonly presetId: ArrangementPresetId;
  readonly candidateStatus: "complete" | "partial";
  readonly anchorPlanDigest: SemanticDigest;
  readonly effectiveConfigDigest: SemanticDigest;
  readonly presetProfileDigest: SemanticDigest;
  readonly effectiveChordTimelineDigest: SemanticDigest;
  readonly sourceLeadAtomizationDigest: SemanticDigest;
  readonly tracks: readonly CandidateTrackPayload[];
  readonly realizedAnchors: readonly RealizedHarmonyAnchor[];
  readonly ordinals: CandidateOrdinalRegistry;
  readonly metrics: FullSongMetrics;
  readonly diagnostics: readonly Diagnostic[];
  readonly canonicalPathKey: string;
}

function requiredOrdinal(registry: Readonly<Record<string, number>>, id: string, kind: string): number {
  const ordinal = registry[id];
  if (!Number.isSafeInteger(ordinal) || ordinal < 0) throw new RangeError(`missing canonical ${kind} ordinal: ${id}`);
  return ordinal;
}
function positionKey(event: GeneratedVoiceEventPayload): string {
  const position = event.range.start;
  return `${position.performanceMeasureIndex}:${position.offset.n}/${position.offset.d}`;
}
function eventProjection(event: GeneratedVoiceEventPayload, ordinals: CandidateOrdinalRegistry): object {
  if (event.kind === "rest") return { kind: "rest", range: event.range };
  return {
    kind: "note", range: event.range, pitch: event.pitch, tieStart: event.tieStart, tieStop: event.tieStop,
    lyricTokenOrdinals: event.lyricTokenIds.map((id) => requiredOrdinal(ordinals.lyricOrdinalById, id, "lyric")).sort((a, b) => a - b),
    source: event.source,
    originAnchorDirectiveOrdinal: event.originDirectiveId === undefined ? null : requiredOrdinal(ordinals.anchorDirectiveOrdinalById, event.originDirectiveId, "anchor directive"),
  };
}

function orderedEvents(
  events: readonly GeneratedVoiceEventPayload[],
  ordinals: CandidateOrdinalRegistry,
): readonly GeneratedVoiceEventPayload[] {
  const normalized = events.map((event): GeneratedVoiceEventPayload => event.kind === "rest"
    ? event
    : {
        ...event,
        lyricTokenIds: [...event.lyricTokenIds].sort(
          (left, right) => requiredOrdinal(ordinals.lyricOrdinalById, left, "lyric")
            - requiredOrdinal(ordinals.lyricOrdinalById, right, "lyric"),
        ),
      });
  normalized.sort((left, right) => compareRanges(left.range, right.range)
    || compareCanonicalValues(eventProjection(left, ordinals), eventProjection(right, ordinals)));
  for (let index = 0; index < normalized.length; index += 1) {
    if (index > 0) {
      const previous = normalized[index - 1];
      if (compareCanonicalValues(eventProjection(previous, ordinals), eventProjection(normalized[index], ordinals)) === 0) {
        throw new RangeError("CANDIDATE_PROJECTION_INVALID:duplicate event");
      }
      if (comparePositions(normalized[index].range.start, previous.range.end) < 0) {
        throw new RangeError("CANDIDATE_PROJECTION_INVALID:event overlap");
      }
    }
  }
  return normalized;
}

export async function buildArrangementCandidate(input: CandidateBuildInput): Promise<ArrangementCandidate> {
  if (new Set(input.tracks.map((track) => track.trackPlanId)).size !== input.tracks.length) {
    throw new RangeError("CANDIDATE_PROJECTION_INVALID:duplicate track");
  }
  const orderedTracks = [...input.tracks].sort((a, b) => requiredOrdinal(input.ordinals.trackOrdinalById, a.trackPlanId, "track") - requiredOrdinal(input.ordinals.trackOrdinalById, b.trackPlanId, "track"));
  const projectedTracks = orderedTracks.map((track) => ({
    trackOrdinal: requiredOrdinal(input.ordinals.trackOrdinalById, track.trackPlanId, "track"),
    events: orderedEvents(track.events, input.ordinals).map((event) => eventProjection(event, input.ordinals)),
  }));
  if (new Set(input.realizedAnchors.map((anchor) => anchor.directiveId)).size !== input.realizedAnchors.length) {
    throw new RangeError("CANDIDATE_PROJECTION_INVALID:duplicate realized anchor");
  }
  const realizedAnchorEntries = [...input.realizedAnchors].map((anchor) => ({ anchor, projection: {
      anchorDirectiveOrdinal: requiredOrdinal(input.ordinals.anchorDirectiveOrdinalById, anchor.directiveId, "anchor directive"),
      trackOrdinal: requiredOrdinal(input.ordinals.trackOrdinalById, anchor.trackPlanId, "track"),
      position: anchor.position,
      pitch: anchor.pitch,
    } })).sort((left, right) => compareCanonicalValues(left.projection, right.projection));
  const realizedAnchorProjection = realizedAnchorEntries.map((entry) => entry.projection);
  const contentDigest = await semanticDigest({ projectionSchema: "hm-arrangement-candidate-content-v1", presetId: input.presetId, candidateStatus: input.candidateStatus, anchorPlanDigest: input.anchorPlanDigest, effectiveConfigDigest: input.effectiveConfigDigest, presetProfileDigest: input.presetProfileDigest, effectiveChordTimelineDigest: input.effectiveChordTimelineDigest, sourceLeadAtomizationDigest: input.sourceLeadAtomizationDigest, generatedTracks: projectedTracks, realizedAnchors: realizedAnchorProjection });
  const id = `cand:${input.presetId}:${contentDigest}`;
  const generatedEventsByTrack: Record<string, readonly GeneratedVoiceEvent[]> = {};
  for (const track of orderedTracks) {
    const trackOrdinal = requiredOrdinal(input.ordinals.trackOrdinalById, track.trackPlanId, "track");
    const canonicalEvents = orderedEvents(track.events, input.ordinals);
    const groupCounts = new Map<string, number>();
    generatedEventsByTrack[track.trackPlanId] = canonicalEvents.map((event): GeneratedVoiceEvent => {
      const groupKey = `${positionKey(event)}:${event.kind}`;
      const eventOrdinal = groupCounts.get(groupKey) ?? 0;
      groupCounts.set(groupKey, eventOrdinal + 1);
      return { ...event, id: `gen:${contentDigest}:${trackOrdinal}:${positionKey(event)}:${eventOrdinal}` };
    });
  }
  return { id, presetId: input.presetId, candidateStatus: input.candidateStatus, anchorPlanDigest: input.anchorPlanDigest, effectiveConfigDigest: input.effectiveConfigDigest, presetProfileDigest: input.presetProfileDigest, effectiveChordTimelineDigest: input.effectiveChordTimelineDigest, sourceLeadAtomizationDigest: input.sourceLeadAtomizationDigest, generatedEventsByTrack, realizedAnchors: realizedAnchorEntries.map((entry) => entry.anchor), metrics: input.metrics, diagnostics: input.diagnostics, canonicalPathKey: input.canonicalPathKey, contentDigest };
}

export function validateGenerationResultState(status: "blocked" | "complete" | "partial", candidates: readonly ArrangementCandidate[], hasBlockingDiagnostic: boolean): boolean {
  if (status === "blocked") return candidates.length === 0 && hasBlockingDiagnostic;
  if (candidates.length === 0 || hasBlockingDiagnostic) return false;
  return status === "complete"
    ? candidates.some((candidate) => candidate.candidateStatus === "complete")
    : candidates.every((candidate) => candidate.candidateStatus === "partial");
}
