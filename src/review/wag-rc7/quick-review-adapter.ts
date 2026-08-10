import type { ArrangementPresetId, UserArrangementCaps } from "../../domain/config";
import type { VariantStageLocks } from "../../domain/locks";
import {
  SOURCE_LEAD_TRACK,
  type GeneratedHarmonyTrackPlan,
  type PerformerTrackAssignment,
  type VocalTrackPlan,
} from "../../domain/performer";
import { compareRanges } from "../../domain/time";
import type { QuickReviewAnalysis } from "../../import/review/quick-review";
import type {
  PhraseArrangementIntent,
} from "../../domain/plans";
import type { Rc7PerformerEntry, Rc7PreparedCase } from "./types";

const EMPTY_LOCKS: VariantStageLocks = Object.freeze({
  intent: [],
  activity: [],
  anchor: [],
  solver: [],
});

export interface Rc7QuickReviewAdapterInput {
  readonly analysis: QuickReviewAnalysis;
  readonly caseId: string;
  readonly presetId: ArrangementPresetId;
  readonly performers: readonly Rc7PerformerEntry[];
  readonly phraseId?: string;
  readonly userCaps?: UserArrangementCaps;
  readonly locks?: VariantStageLocks;
  readonly priorPersistedPhraseIntent?: PhraseArrangementIntent | null;
}

function meterFamily(
  source: NonNullable<QuickReviewAnalysis["source"]>,
): Rc7PreparedCase["meterFamily"] {
  const meters = new Set(source.sourceMeasures.map((measure) => (
    measure.time.numerator === 4 && measure.time.denominator === 4
      ? "simple-quadruple"
      : measure.time.numerator === 6 && measure.time.denominator === 8
        ? "compound-duple"
        : "unsupported"
  )));
  if (meters.size !== 1 || meters.has("unsupported")) throw new RangeError("UNSUPPORTED_METER");
  return [...meters][0] as Rc7PreparedCase["meterFamily"];
}

export function prepareRc7QuickReviewInput(
  input: Rc7QuickReviewAdapterInput,
): Rc7PreparedCase {
  const { analysis } = input;
  if (!analysis.state.readyForPlanning) throw new RangeError("QUICK_REVIEW_NOT_READY_FOR_PLANNING");
  if (!analysis.source || !analysis.atomization || analysis.chordTimelineState.status !== "resolved") {
    throw new RangeError("QUICK_REVIEW_AUTHORITY_INCOMPLETE");
  }
  const source = analysis.source;
  const phrases = [...source.phraseRegions].sort((left, right) => compareRanges(left.range, right.range));
  const phrase = input.phraseId
    ? phrases.find((candidate) => candidate.id === input.phraseId)
    : phrases[0];
  if (!phrase) throw new RangeError("QUICK_REVIEW_PHRASE_NOT_FOUND");
  const sectionOccurrence = source.sectionOccurrences.find((candidate) => candidate.id === phrase.sectionOccurrenceId);
  const sectionDefinition = sectionOccurrence
    ? source.sectionDefinitions.find((candidate) => candidate.id === sectionOccurrence.sectionDefinitionId)
    : undefined;
  if (!sectionOccurrence || !sectionDefinition) throw new RangeError("QUICK_REVIEW_SECTION_REFERENCE_INVALID");
  const performers = [...input.performers].sort((left, right) => left.performerOrdinal - right.performerOrdinal);
  if (performers.length < 1 || performers.length > 3
    || performers.some((entry, ordinal) => entry.performerOrdinal !== ordinal)) {
    throw new RangeError("QUICK_REVIEW_PERFORMER_ORDINAL_GRAPH_INVALID");
  }
  const userCaps = input.userCaps ?? {
    maxHarmonyTracks: Math.min(2, performers.length - 1) as 0 | 1 | 2,
    allowOctaveDouble: true,
  };
  const generatedTracks: readonly GeneratedHarmonyTrackPlan[] = [1, 2].map((ordinal) => ({
    kind: "generated-harmony",
    id: `review-import:track:h${ordinal}`,
    displayLabel: `Harmony ${ordinal}`,
    canonicalOrdinal: ordinal as 1 | 2,
    enabled: ordinal <= userCaps.maxHarmonyTracks && ordinal < performers.length,
  }));
  const tracks: readonly VocalTrackPlan[] = [SOURCE_LEAD_TRACK, ...generatedTracks];
  const assignments: readonly PerformerTrackAssignment[] = tracks
    .filter((track) => track.kind === "source-lead" || track.enabled)
    .map((track) => {
      const performer = performers[track.canonicalOrdinal];
      if (!performer) throw new RangeError("QUICK_REVIEW_TRACK_ASSIGNMENT_INVALID");
      return { trackPlanId: track.id, performerId: performer.profile.id };
    });
  return {
    caseId: input.caseId,
    title: source.title,
    description: "Rights-confirmed Quick Review source routed into the isolated rc.7 review adapter.",
    sourceKind: "quick-review-import",
    sourceIdentity: `quick-review:${source.documentId}:${source.revisionOrdinal}:${source.revisionDigest}`,
    meterFamily: meterFamily(source),
    defaultKey: source.defaultKey,
    defaultTempo: source.defaultTempo,
    sourceMeasures: source.sourceMeasures,
    performanceSequence: source.performanceSequence,
    sectionDefinition,
    sectionOccurrence,
    phrase,
    lyricTokens: source.sourceMeasures.flatMap((measure) => measure.lyricTokens),
    musicalSourceDigest: source.revisionDigest,
    effectiveChordTimeline: analysis.chordTimelineState.timeline,
    sourceLeadAtomization: analysis.atomization,
    presetId: input.presetId,
    mode: { profileId: "worship-band-v1", harmonicContext: "band-supported" },
    userCaps,
    performers,
    tracks,
    assignments,
    locks: input.locks ?? EMPTY_LOCKS,
    priorPersistedPhraseIntent: input.priorPersistedPhraseIntent ?? null,
    fixtureTags: ["quick-review-import", "rights-confirmed", "non-persisting"],
  };
}
