import type { ArrangementPresetId } from "./config";
import { parseChord } from "./chord/parser";
import { canonicalJson, type SemanticDigest } from "./digest/canonical";
import type { Alter, KeySignature, Step } from "./pitch";
import type { RightsBasis, TempoSpec } from "./source/model";
import { addFractions, compareFractions, fraction } from "./fraction";
import {
  hasExactKeys, hasUniqueStrings, isCanonicalId, isCanonicalKeySignature,
  isPlainRecord, isSemanticDigest,
} from "./validation";

export type CompactFraction = readonly [n: number, d: number];
export type CompactPitch = readonly [step: Step, alter: Alter, octave: number];
export interface CompactMeasureOccurrence { readonly index: number; readonly sourceMeasureNumber?: number; readonly lyricVerseIndex: number; readonly timeSignature: readonly [numerator: number, denominator: 4 | 8]; readonly duration: CompactFraction }
export interface CompactNoteEvent { readonly kind: "note"; readonly occurrenceIndex: number; readonly offset: CompactFraction; readonly duration: CompactFraction; readonly pitch: CompactPitch; readonly tieStart?: true; readonly tieStop?: true; readonly lyricTokenIds?: readonly string[] }
export interface CompactRestEvent { readonly kind: "rest"; readonly occurrenceIndex: number; readonly offset: CompactFraction; readonly duration: CompactFraction }
export type CompactVocalEvent = CompactNoteEvent | CompactRestEvent;
export type CompactHarmonyRole = "H1" | "H2";
export type CompactPlacementRole = "upper" | "lower";
export type LegacyCompactTrack = { readonly kind: "source-lead" | "generated-harmony"; readonly label: string; readonly events: readonly CompactVocalEvent[] };
export type CompactTrack =
  | { readonly kind: "source-lead"; readonly label: string; readonly events: readonly CompactVocalEvent[] }
  | { readonly kind: "generated-harmony"; readonly label: string; readonly harmonyRole: CompactHarmonyRole; readonly placementRoles: readonly CompactPlacementRole[]; readonly events: readonly CompactVocalEvent[] };
export type CompactChord =
  | { readonly kind: "chord"; readonly startOccurrenceIndex: number; readonly startOffset: CompactFraction; readonly endOccurrenceIndex: number; readonly endOffset: CompactFraction; readonly symbol: string }
  | { readonly kind: "no-chord"; readonly startOccurrenceIndex: number; readonly startOffset: CompactFraction; readonly endOccurrenceIndex: number; readonly endOffset: CompactFraction };
export interface CompactLyricToken { readonly id: string; readonly text: string; readonly verse: number; readonly syllabic: "single" | "begin" | "middle" | "end"; readonly extend: boolean }
export interface CompactArrangement<TTrack extends LegacyCompactTrack | CompactTrack = CompactTrack> { readonly measures: readonly CompactMeasureOccurrence[]; readonly tracks: readonly TTrack[] }
export interface PracticeSettings { readonly selectedTrackIndex?: number; readonly speedPercent?: 50 | 75 | 100 | 125 | 150; readonly accompanimentEnabled?: boolean }
interface PracticeSharePayloadBase { readonly title: string; readonly tempo: TempoSpec; readonly key: KeySignature; readonly presetId: ArrangementPresetId; readonly arrangementArtifactDigest: SemanticDigest; readonly effectiveChordTimelineDigest: SemanticDigest; readonly lyrics: readonly CompactLyricToken[]; readonly chords?: readonly CompactChord[]; readonly playbackDefaults?: PracticeSettings; readonly rightsShareConfirmed: true }
export interface PracticeSharePayloadV3 extends PracticeSharePayloadBase { readonly schemaVersion: 3; readonly arrangement: CompactArrangement<LegacyCompactTrack> }
export interface PracticeSharePayloadV4 extends PracticeSharePayloadBase { readonly schemaVersion: 4; readonly arrangement: CompactArrangement<CompactTrack> }
export type PracticeSharePayload = PracticeSharePayloadV3 | PracticeSharePayloadV4;
export interface ShareStoreRecord { readonly opaqueTokenHash: string; readonly payloadDigest: SemanticDigest; readonly encryptedPayload: Uint8Array; readonly createdAt: string; readonly expiresAt: string; readonly rightsBasis: RightsBasis }

export const PRACTICE_SHARE_LIMITS = Object.freeze({
  maxPlaintextBytes: 256 * 1024,
  maxTitleLength: 512,
  maxMeasures: 512,
  maxTracks: 4,
  maxEventsPerTrack: 16_384,
  maxLyrics: 16_384,
  maxLyricTextLength: 2_048,
  maxChords: 8_192,
  maxTrackLabelLength: 128,
  maxChordSymbolLength: 128,
} as const);

function isCompactFraction(value: unknown): value is CompactFraction {
  if (!Array.isArray(value) || value.length !== 2 || !Number.isSafeInteger(value[0]) || !Number.isSafeInteger(value[1]) || value[1] <= 0) return false;
  try {
    const normalized = fraction(value[0], value[1]);
    return normalized.n === value[0] && normalized.d === value[1];
  } catch {
    return false;
  }
}

function isPositiveCompactFraction(value: unknown): value is CompactFraction {
  return isCompactFraction(value) && value[0] > 0;
}

function isSupportedMeasureDuration(timeSignature: unknown, duration: unknown): duration is CompactFraction {
  if (!Array.isArray(timeSignature) || timeSignature.length !== 2 || !isPositiveCompactFraction(duration)) return false;
  const nominalQuarterUnits = timeSignature[0] === 4 && timeSignature[1] === 4
    ? BigInt(4)
    : timeSignature[0] === 6 && timeSignature[1] === 8
      ? BigInt(3)
      : undefined;
  if (nominalQuarterUnits === undefined) return false;
  return BigInt(duration[0]) <= nominalQuarterUnits * BigInt(duration[1]);
}

function compactFraction(value: CompactFraction) {
  return fraction(value[0], value[1]);
}

function isCompactPosition(
  occurrenceIndex: unknown,
  offset: unknown,
  measures: readonly unknown[],
  allowDocumentEnd: boolean,
): offset is CompactFraction {
  if (!Number.isSafeInteger(occurrenceIndex) || (occurrenceIndex as number) < 0 || !isCompactFraction(offset)) return false;
  if (occurrenceIndex === measures.length) return allowDocumentEnd && offset[0] === 0 && offset[1] === 1;
  if ((occurrenceIndex as number) >= measures.length || offset[0] < 0) return false;
  const measure = measures[occurrenceIndex as number];
  return isPlainRecord(measure)
    && isPositiveCompactFraction(measure.duration)
    && compareFractions(compactFraction(offset), compactFraction(measure.duration)) < 0;
}

function compactPositionBefore(
  startIndex: number,
  startOffset: CompactFraction,
  endIndex: number,
  endOffset: CompactFraction,
): boolean {
  return startIndex < endIndex
    || (startIndex === endIndex
      && compareFractions(compactFraction(startOffset), compactFraction(endOffset)) < 0);
}

function isConsumableChordSymbol(value: unknown, requireCanonical: boolean): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > PRACTICE_SHARE_LIMITS.maxChordSymbolLength) return false;
  if (!requireCanonical) return true;
  const parsed = parseChord(value);
  return parsed.status === "ok" && parsed.chord.canonicalSymbol === value;
}

function isCompactPitch(value: unknown): value is CompactPitch {
  if (!Array.isArray(value)
    || value.length !== 3
    || !["C", "D", "E", "F", "G", "A", "B"].includes(String(value[0]))
    || ![-2, -1, 0, 1, 2].includes(value[1] as number)
    || !Number.isSafeInteger(value[2])) return false;
  const octave = value[2] as number;
  if (octave < -1 || octave > 9) return false;
  const natural = ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 } as const)[value[0] as Step];
  const midi = (octave + 1) * 12 + natural + (value[1] as number);
  return midi >= 0 && midi <= 127;
}

function isCompactEvent(value: unknown, measureCount: number): value is CompactVocalEvent {
  if (!isPlainRecord(value)
    || !Number.isSafeInteger(value.occurrenceIndex)
    || (value.occurrenceIndex as number) < 0
    || (value.occurrenceIndex as number) >= measureCount
    || !isCompactFraction(value.offset)
    || value.offset[0] < 0
    || !isPositiveCompactFraction(value.duration)) return false;
  if (value.kind === "rest") {
    return hasExactKeys(value, ["kind", "occurrenceIndex", "offset", "duration"]);
  }
  return value.kind === "note"
    && hasExactKeys(value, ["kind", "occurrenceIndex", "offset", "duration", "pitch"], ["tieStart", "tieStop", "lyricTokenIds"])
    && isCompactPitch(value.pitch)
    && (value.tieStart === undefined || value.tieStart === true)
    && (value.tieStop === undefined || value.tieStop === true)
    && (value.lyricTokenIds === undefined || (Array.isArray(value.lyricTokenIds)
      && value.lyricTokenIds.every(isCanonicalId)
      && hasUniqueStrings(value.lyricTokenIds)));
}
export function isPracticeSharePayload(value: unknown): value is PracticeSharePayload {
  if (!isPlainRecord(value)
    || !hasExactKeys(value, ["schemaVersion", "title", "tempo", "key", "presetId", "arrangementArtifactDigest", "effectiveChordTimelineDigest", "arrangement", "lyrics", "rightsShareConfirmed"], ["chords", "playbackDefaults"])
    || (value.schemaVersion !== 3 && value.schemaVersion !== 4)
    || value.rightsShareConfirmed !== true
    || typeof value.title !== "string"
    || value.title.length > PRACTICE_SHARE_LIMITS.maxTitleLength
    || !isPlainRecord(value.tempo)
    || !hasExactKeys(value.tempo, ["beatUnit", "dotted", "bpm"])
    || (value.tempo.beatUnit !== 4 && value.tempo.beatUnit !== 8)
    || typeof value.tempo.dotted !== "boolean"
    || !Number.isSafeInteger(value.tempo.bpm)
    || (value.tempo.bpm as number) < 20
    || (value.tempo.bpm as number) > 300
    || !isCanonicalKeySignature(value.key)
    || !["simple", "standard", "full"].includes(String(value.presetId))
    || !isSemanticDigest(value.arrangementArtifactDigest)
    || !isSemanticDigest(value.effectiveChordTimelineDigest)
    || !isPlainRecord(value.arrangement)
    || !hasExactKeys(value.arrangement, ["measures", "tracks"])
    || !Array.isArray(value.arrangement.measures)
    || !Array.isArray(value.arrangement.tracks)
    || !Array.isArray(value.lyrics)) return false;
  const measures = value.arrangement.measures;
  if (measures.length === 0 || measures.length > PRACTICE_SHARE_LIMITS.maxMeasures || !measures.every((measure, index) => isPlainRecord(measure)
    && hasExactKeys(measure, ["index", "lyricVerseIndex", "timeSignature", "duration"], ["sourceMeasureNumber"])
    && measure.index === index
    && (measure.sourceMeasureNumber === undefined || Number.isSafeInteger(measure.sourceMeasureNumber))
    && Number.isSafeInteger(measure.lyricVerseIndex)
    && (measure.lyricVerseIndex as number) > 0
    && isSupportedMeasureDuration(measure.timeSignature, measure.duration))) return false;
  const lyrics = value.lyrics;
  if (lyrics.length > PRACTICE_SHARE_LIMITS.maxLyrics || !lyrics.every((token) => isPlainRecord(token)
    && hasExactKeys(token, ["id", "text", "verse", "syllabic", "extend"])
    && isCanonicalId(token.id)
    && typeof token.text === "string"
    && token.text.length <= PRACTICE_SHARE_LIMITS.maxLyricTextLength
    && Number.isSafeInteger(token.verse)
    && (token.verse as number) > 0
    && ["single", "begin", "middle", "end"].includes(String(token.syllabic))
    && typeof token.extend === "boolean")) return false;
  const lyricIds = lyrics.map((token) => (token as Readonly<Record<string, unknown>>).id as string);
  if (!hasUniqueStrings(lyricIds)) return false;
  const tracks = value.arrangement.tracks;
  const schemaVersion = value.schemaVersion;
  if (tracks.length === 0 || tracks.length > PRACTICE_SHARE_LIMITS.maxTracks
    || tracks.filter((track) => isPlainRecord(track) && track.kind === "source-lead").length !== 1
    || !tracks.every((track) => isPlainRecord(track)
      && hasExactKeys(track, schemaVersion === 4 && track.kind === "generated-harmony"
        ? ["kind", "label", "harmonyRole", "placementRoles", "events"]
        : ["kind", "label", "events"])
      && (track.kind === "source-lead" || track.kind === "generated-harmony")
      && typeof track.label === "string"
      && track.label.length > 0
      && track.label.length <= PRACTICE_SHARE_LIMITS.maxTrackLabelLength
      && (schemaVersion !== 4 || track.kind !== "generated-harmony" || (
        (track.harmonyRole === "H1" || track.harmonyRole === "H2")
        && Array.isArray(track.placementRoles)
        && track.placementRoles.length > 0
        && track.placementRoles.length <= 2
        && track.placementRoles.every((role) => role === "upper" || role === "lower")
        && new Set(track.placementRoles).size === track.placementRoles.length
      ))
      && Array.isArray(track.events)
      && track.events.length <= PRACTICE_SHARE_LIMITS.maxEventsPerTrack
      && track.events.every((event) => isCompactEvent(event, measures.length)))) return false;
  const generatedRoles = tracks.flatMap((track) => schemaVersion === 4 && isPlainRecord(track) && track.kind === "generated-harmony"
    ? [track.harmonyRole as string]
    : []);
  if (!hasUniqueStrings(generatedRoles)) return false;
  for (const track of tracks) {
    const events = (track as { readonly events: readonly CompactVocalEvent[] }).events;
    for (const event of events) {
      const measure = measures[event.occurrenceIndex] as Readonly<Record<string, unknown>>;
      const measureDuration = measure.duration as CompactFraction;
      try {
        if (compareFractions(addFractions(compactFraction(event.offset), compactFraction(event.duration)), compactFraction(measureDuration)) > 0) return false;
      } catch { return false; }
      if (event.kind === "note" && event.lyricTokenIds?.some((id) => !lyricIds.includes(id))) return false;
    }
  }
  if (value.chords !== undefined && (!Array.isArray(value.chords)
    || value.chords.length > PRACTICE_SHARE_LIMITS.maxChords
    || !value.chords.every((chord) => isPlainRecord(chord)
    && (chord.kind === "chord" || chord.kind === "no-chord")
    && hasExactKeys(chord, chord.kind === "chord" ? ["kind", "startOccurrenceIndex", "startOffset", "endOccurrenceIndex", "endOffset", "symbol"] : ["kind", "startOccurrenceIndex", "startOffset", "endOccurrenceIndex", "endOffset"])
    && isCompactPosition(chord.startOccurrenceIndex, chord.startOffset, measures, false)
    && isCompactPosition(chord.endOccurrenceIndex, chord.endOffset, measures, true)
    && compactPositionBefore(
      chord.startOccurrenceIndex as number,
      chord.startOffset,
      chord.endOccurrenceIndex as number,
      chord.endOffset,
    )
    && (chord.kind !== "chord" || isConsumableChordSymbol(chord.symbol, schemaVersion === 4))))) return false;
  if (value.playbackDefaults !== undefined && (!isPlainRecord(value.playbackDefaults)
    || !hasExactKeys(value.playbackDefaults, [], ["selectedTrackIndex", "speedPercent", "accompanimentEnabled"])
    || (value.playbackDefaults.selectedTrackIndex !== undefined && (!Number.isSafeInteger(value.playbackDefaults.selectedTrackIndex) || (value.playbackDefaults.selectedTrackIndex as number) < 0 || (value.playbackDefaults.selectedTrackIndex as number) >= tracks.length))
    || (value.playbackDefaults.speedPercent !== undefined && ![50, 75, 100, 125, 150].includes(value.playbackDefaults.speedPercent as number))
    || (value.playbackDefaults.accompanimentEnabled !== undefined && typeof value.playbackDefaults.accompanimentEnabled !== "boolean"))) return false;
  return true;
}
export function encodePracticeShare(payload: PracticeSharePayload): string {
  if (!isPracticeSharePayload(payload)) throw new RangeError("SHARE_PAYLOAD_INVALID");
  return canonicalJson(payload);
}
export function decodePracticeShare(encoded: string): PracticeSharePayload {
  const parsed: unknown = JSON.parse(encoded);
  if (!isPracticeSharePayload(parsed)) throw new RangeError("SHARE_PAYLOAD_INVALID");
  return parsed;
}
