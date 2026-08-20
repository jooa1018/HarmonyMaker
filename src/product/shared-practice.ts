import { parseChord } from "../domain/chord/parser";
import { addFractions, fraction } from "../domain/fraction";
import type { ArrangementRenderDocument, GeneratedVoiceEvent } from "../domain/generation/model";
import type { PerformanceChordSpan } from "../domain/harmony/chord-timeline";
import { compactTrackStableId, type PracticeSettings, type PracticeSharePayload } from "../domain/share";
import type { TimelineAtom } from "../domain/source/atomization";
import { musicalRange } from "../domain/time";
import { practiceShareTrackRoles, type ProductTrackRoleRegistry } from "./track-roles";

function compactFraction(value: readonly [number, number]) { return fraction(value[0], value[1]); }

export interface SharedPracticeMaterialization { readonly document: ArrangementRenderDocument; readonly trackRoles: ProductTrackRoleRegistry; readonly playbackDefaults?: PracticeSettings }
export type SharedPracticeMaterializationOutcome =
  | { readonly status: "available"; readonly value: SharedPracticeMaterialization }
  | { readonly status: "unavailable"; readonly code: "SHARE_PAYLOAD_UNAVAILABLE" };

function normalizedPlaybackDefaults(payload: PracticeSharePayload): PracticeSettings | undefined {
  const settings = payload.playbackDefaults;
  if (!settings) return undefined;
  const originalTrackIds = payload.arrangement.tracks.map((track) => compactTrackStableId(track, payload.schemaVersion));
  if (originalTrackIds.some((trackId) => trackId === undefined)) throw new RangeError("SHARE_TRACK_ROLE_INVALID");
  const selectedTrackId = settings.selectedTrackId
    ?? (settings.selectedTrackIndex === undefined ? undefined : originalTrackIds[settings.selectedTrackIndex]);
  const { selectedTrackIndex: _legacyIndex, ...rest } = settings;
  void _legacyIndex;
  return { ...rest, ...(selectedTrackId ? { selectedTrackId } : {}) };
}

export function materializeSharedPractice(payload: PracticeSharePayload): SharedPracticeMaterialization {
  const durations = payload.arrangement.measures.map((measure) => compactFraction(measure.duration));
  const measures = payload.arrangement.measures.map((measure, index) => ({
    occurrenceId: `share:occ:${index}`,
    sourceMeasureId: `share:measure:${index}`,
    sourceMeasureNumber: measure.sourceMeasureNumber ?? index + 1,
    occurrenceIndexForSource: 0,
    performanceIndex: index,
    time: { numerator: measure.timeSignature[0], denominator: measure.timeSignature[1], beatGroups: measure.timeSignature[1] === 8 && measure.timeSignature[0] % 3 === 0 ? Array.from({ length: measure.timeSignature[0] / 3 }, () => 3) : Array.from({ length: measure.timeSignature[0] }, () => 1) },
    duration: durations[index],
  }));
  const rangeFor = (occurrenceIndex: number, offsetValue: readonly [number, number], durationValue: readonly [number, number]) => {
    const offset = compactFraction(offsetValue);
    return musicalRange(
      { performanceMeasureIndex: occurrenceIndex, offset },
      { performanceMeasureIndex: occurrenceIndex, offset: addFractions(offset, compactFraction(durationValue)) },
      durations,
    );
  };
  const sourceTrack = payload.arrangement.tracks.find((track) => track.kind === "source-lead");
  if (!sourceTrack) throw new RangeError("SHARE_PAYLOAD_INVALID");
  const atoms: TimelineAtom[] = sourceTrack.events.map((event, index) => ({
    id: `share:lead:${index}`,
    sourceEventId: `share:source-event:${index}`,
    range: rangeFor(event.occurrenceIndex, event.offset, event.duration),
    pitch: event.kind === "note" ? { step: event.pitch[0], alter: event.pitch[1], octave: event.pitch[2] } : null,
    tiedFromPrevious: event.kind === "note" && event.tieStop === true,
    tiedToNext: event.kind === "note" && event.tieStart === true,
    lyricTokenIds: event.kind === "note" ? event.lyricTokenIds ?? [] : [],
  }));
  const trackRoles = practiceShareTrackRoles(payload.arrangement.tracks);
  const generatedHarmonyTracks = payload.arrangement.tracks.filter((track) => track.kind === "generated-harmony").map((track) => {
    const metadata = payload.schemaVersion === 4 && "harmonyRole" in track
      ? trackRoles.generatedTracks.find((candidate) => candidate.harmonyRole === track.harmonyRole)
      : trackRoles.generatedTracks.find((candidate) => candidate.label === track.label);
    if (!metadata) throw new RangeError("SHARE_TRACK_ROLE_INVALID");
    return {
    trackPlanId: metadata.trackPlanId,
    events: track.events.map((event, eventIndex): GeneratedVoiceEvent => event.kind === "rest" ? {
      kind: "rest", id: `share:${metadata.harmonyRole.toLowerCase()}:event:${eventIndex}`, range: rangeFor(event.occurrenceIndex, event.offset, event.duration),
    } : {
      kind: "note", id: `share:${metadata.harmonyRole.toLowerCase()}:event:${eventIndex}`, range: rangeFor(event.occurrenceIndex, event.offset, event.duration),
      pitch: { step: event.pitch[0], alter: event.pitch[1], octave: event.pitch[2] },
      tieStart: event.tieStart === true, tieStop: event.tieStop === true, lyricTokenIds: event.lyricTokenIds ?? [], source: "connection",
    }),
  }});
  const spans: PerformanceChordSpan[] = (payload.chords ?? []).map((chord, index) => {
    const range = musicalRange(
      { performanceMeasureIndex: chord.startOccurrenceIndex, offset: compactFraction(chord.startOffset) },
      { performanceMeasureIndex: chord.endOccurrenceIndex, offset: compactFraction(chord.endOffset) },
      durations,
    );
    const parseResult = chord.kind === "no-chord" ? { status: "no-chord" as const, sourceText: "N.C." } : parseChord(chord.symbol);
    if (parseResult.status !== "ok" && parseResult.status !== "no-chord") throw new RangeError("SHARE_PAYLOAD_INVALID");
    return { id: `share:chord:${index}`, range, parseResult, origin: { kind: "source-event" as const, sourceChordEventId: `share:chord-source:${index}` } };
  });
  const firstLeadId = atoms[0]?.sourceEventId ?? "share:source-event:0";
  const document: ArrangementRenderDocument = {
    measures,
    sourceLeadTrack: { trackPlanId: "track:source-lead", atomizationDigest: payload.arrangementArtifactDigest, atoms },
    generatedHarmonyTracks,
    effectiveChordTimeline: {
      sourceChordProjectionDigest: payload.effectiveChordTimelineDigest,
      performanceSequenceDigest: payload.effectiveChordTimelineDigest,
      resolutionPolicy: { gapPolicy: "block-gap" },
      chordTimelineResolverVersion: "share-read-v3",
      spans,
      digest: payload.effectiveChordTimelineDigest,
    },
    lyricTokens: payload.lyrics.map((token) => ({ ...token, leadEventId: firstLeadId, emphasis: "none" as const })),
  };
  return { document, trackRoles, ...(payload.playbackDefaults ? { playbackDefaults: normalizedPlaybackDefaults(payload) } : {}) };
}

export function practiceShareToRenderDocument(payload: PracticeSharePayload): ArrangementRenderDocument {
  return materializeSharedPractice(payload).document;
}

export function materializeSharedPracticeSafely(payload: PracticeSharePayload): SharedPracticeMaterializationOutcome {
  try { return { status: "available", value: materializeSharedPractice(payload) }; }
  catch { return { status: "unavailable", code: "SHARE_PAYLOAD_UNAVAILABLE" }; }
}
