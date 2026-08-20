import type { DeterministicAccompaniment } from "../accompaniment/deterministic";
import { addFractions, fraction, type Fraction } from "../domain/fraction";
import type { ArrangementRenderDocument, GeneratedVoiceEvent } from "../domain/generation/model";
import { pitchMidiNumber } from "../domain/pitch";
import type { TimelineAtom } from "../domain/source/atomization";
import type { TempoSpec } from "../domain/source/model";
import { canonicalRangeDuration } from "./timing";
import type { ProductTrackRoleRegistry } from "./track-roles";

export const PRACTICE_SPEEDS = [50, 75, 100, 125, 150] as const;
export type PracticeSpeed = typeof PRACTICE_SPEEDS[number];
export interface PlaybackEvent {
  readonly eventId: string;
  readonly trackId: string;
  readonly kind: "voice" | "band";
  readonly startQuarter: number;
  readonly durationQuarter: number;
  readonly midi: number;
  readonly lyricOnset: boolean;
}
export interface PlaybackPlan {
  readonly events: readonly PlaybackEvent[];
  readonly trackIds: readonly string[];
  readonly totalQuarter: number;
  readonly effectiveChordTimelineDigest: string;
  readonly trackLabels: Readonly<Record<string, string>>;
}

export type PlaybackPlanConstructionOutcome =
  | { readonly status: "available"; readonly value: PlaybackPlan }
  | { readonly status: "unavailable"; readonly code: "PLAYBACK_PLAN_UNAVAILABLE" };

function value(value: Fraction): number { return value.n / value.d; }
function measureStarts(document: ArrangementRenderDocument): readonly Fraction[] {
  const starts: Fraction[] = [];
  let cursor = fraction(0);
  for (const measure of document.measures) { starts.push(cursor); cursor = addFractions(cursor, measure.duration); }
  return starts;
}
function absolute(start: readonly Fraction[], measureIndex: number, offset: Fraction): number { return value(addFractions(start[measureIndex], offset)); }
function leadEvent(atom: TimelineAtom, starts: readonly Fraction[], document: ArrangementRenderDocument): PlaybackEvent | undefined {
  if (!atom.pitch) return undefined;
  return { eventId: atom.id, trackId: "track:source-lead", kind: "voice", startQuarter: absolute(starts, atom.range.start.performanceMeasureIndex, atom.range.start.offset), durationQuarter: value(canonicalRangeDuration(document.measures, atom.range)), midi: pitchMidiNumber(atom.pitch), lyricOnset: atom.lyricTokenIds.length > 0 && !atom.tiedFromPrevious };
}
function harmonyEvent(event: GeneratedVoiceEvent, trackId: string, starts: readonly Fraction[], document: ArrangementRenderDocument): PlaybackEvent | undefined {
  if (event.kind !== "note") return undefined;
  return { eventId: event.id, trackId, kind: "voice", startQuarter: absolute(starts, event.range.start.performanceMeasureIndex, event.range.start.offset), durationQuarter: value(canonicalRangeDuration(document.measures, event.range)), midi: pitchMidiNumber(event.pitch), lyricOnset: event.lyricTokenIds.length > 0 && !event.tieStop };
}

export function buildPlaybackPlan(document: ArrangementRenderDocument, trackRoles: ProductTrackRoleRegistry, accompaniment?: DeterministicAccompaniment): PlaybackPlan {
  if (accompaniment && accompaniment.effectiveChordTimelineDigest !== document.effectiveChordTimeline.digest) throw new RangeError("ACCOMPANIMENT_AUTHORITY_MISMATCH");
  const starts = measureStarts(document);
  const voices = [
    ...document.sourceLeadTrack.atoms.flatMap((atom) => leadEvent(atom, starts, document) ?? []),
    ...document.generatedHarmonyTracks.flatMap((track) => track.events.flatMap((event) => harmonyEvent(event, track.trackPlanId, starts, document) ?? [])),
  ];
  const band = accompaniment?.spans.flatMap((span) => [span.bassPitch, ...span.padPitches].map((pitch, index): PlaybackEvent => ({
    eventId: `${span.id}:${index}`, trackId: "track:band", kind: "band",
    startQuarter: absolute(starts, span.range.start.performanceMeasureIndex, span.range.start.offset),
    durationQuarter: value(canonicalRangeDuration(document.measures, span.range)),
    midi: pitchMidiNumber(pitch), lyricOnset: false,
  }))) ?? [];
  const events = [...voices, ...band].sort((left, right) => left.startQuarter - right.startQuarter || left.trackId.localeCompare(right.trackId) || left.eventId.localeCompare(right.eventId));
  const trackLabels = {
    "track:source-lead": "Lead",
    ...Object.fromEntries(document.generatedHarmonyTracks.map((track) => {
      const metadata = trackRoles.byTrackPlanId[track.trackPlanId];
      if (!metadata) throw new RangeError(`TRACK_ROLE_METADATA_UNAVAILABLE:${track.trackPlanId}`);
      return [track.trackPlanId, metadata.label];
    })),
    ...(band.length > 0 ? { "track:band": "Band" } : {}),
  };
  return {
    events,
    trackIds: ["track:source-lead", ...document.generatedHarmonyTracks.map((track) => track.trackPlanId), ...(band.length > 0 ? ["track:band"] : [])],
    totalQuarter: document.measures.reduce((sum, measure) => sum + value(measure.duration), 0),
    effectiveChordTimelineDigest: document.effectiveChordTimeline.digest,
    trackLabels,
  };
}

export function buildPlaybackPlanSafely(
  document: ArrangementRenderDocument,
  trackRoles: ProductTrackRoleRegistry,
  accompaniment?: DeterministicAccompaniment,
): PlaybackPlanConstructionOutcome {
  try {
    return { status: "available", value: buildPlaybackPlan(document, trackRoles, accompaniment) };
  } catch {
    return { status: "unavailable", code: "PLAYBACK_PLAN_UNAVAILABLE" };
  }
}

export function quarterSeconds(tempo: TempoSpec, speed: PracticeSpeed): number {
  const quarterUnitsPerBeat = (4 / tempo.beatUnit) * (tempo.dotted ? 1.5 : 1);
  return (60 / tempo.bpm) / quarterUnitsPerBeat * (100 / speed);
}

export interface TransportState { readonly phase: "ready" | "playing" | "paused" | "finished"; readonly positionQuarter: number; readonly cursorEventId?: string }
export type TransportAction =
  | { readonly type: "play" }
  | { readonly type: "pause"; readonly positionQuarter: number }
  | { readonly type: "resume" }
  | { readonly type: "cursor"; readonly eventId: string; readonly positionQuarter: number }
  | { readonly type: "finish" }
  | { readonly type: "reset" };
export const INITIAL_TRANSPORT: TransportState = { phase: "ready", positionQuarter: 0 };
export function reduceTransport(state: TransportState, action: TransportAction): TransportState {
  if (action.type === "reset") return INITIAL_TRANSPORT;
  if (action.type === "play") return { phase: "playing", positionQuarter: 0 };
  if (action.type === "pause") return { ...state, phase: "paused", positionQuarter: action.positionQuarter };
  if (action.type === "resume") return { ...state, phase: "playing" };
  if (action.type === "cursor") return { phase: "playing", positionQuarter: action.positionQuarter, cursorEventId: action.eventId };
  return { phase: "finished", positionQuarter: 0 };
}

export interface PracticeMixer { readonly muted: ReadonlySet<string>; readonly solo?: string; readonly bandEnabled: boolean }
export function audibleTrackIds(plan: PlaybackPlan, mixer: PracticeMixer): readonly string[] {
  if (mixer.solo) return plan.trackIds.includes(mixer.solo) ? [mixer.solo] : [];
  return plan.trackIds.filter((track) => !mixer.muted.has(track) && (track !== "track:band" || mixer.bandEnabled));
}
