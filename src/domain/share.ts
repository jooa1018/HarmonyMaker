import type { ArrangementPresetId } from "./config";
import { canonicalJson, type SemanticDigest } from "./digest/canonical";
import type { Alter, KeySignature, Step } from "./pitch";
import type { RightsBasis, TempoSpec } from "./source/model";

export type CompactFraction = readonly [n: number, d: number];
export type CompactPitch = readonly [step: Step, alter: Alter, octave: number];
export interface CompactMeasureOccurrence { readonly index: number; readonly sourceMeasureNumber?: number; readonly lyricVerseIndex: number; readonly timeSignature: readonly [numerator: number, denominator: 4 | 8]; readonly duration: CompactFraction }
export interface CompactNoteEvent { readonly kind: "note"; readonly occurrenceIndex: number; readonly offset: CompactFraction; readonly duration: CompactFraction; readonly pitch: CompactPitch; readonly tieStart?: true; readonly tieStop?: true; readonly lyricTokenIds?: readonly string[] }
export interface CompactRestEvent { readonly kind: "rest"; readonly occurrenceIndex: number; readonly offset: CompactFraction; readonly duration: CompactFraction }
export type CompactVocalEvent = CompactNoteEvent | CompactRestEvent;
export interface CompactTrack { readonly kind: "source-lead" | "generated-harmony"; readonly label: string; readonly events: readonly CompactVocalEvent[] }
export type CompactChord =
  | { readonly kind: "chord"; readonly startOccurrenceIndex: number; readonly startOffset: CompactFraction; readonly endOccurrenceIndex: number; readonly endOffset: CompactFraction; readonly symbol: string }
  | { readonly kind: "no-chord"; readonly startOccurrenceIndex: number; readonly startOffset: CompactFraction; readonly endOccurrenceIndex: number; readonly endOffset: CompactFraction };
export interface CompactLyricToken { readonly id: string; readonly text: string; readonly verse: number; readonly syllabic: "single" | "begin" | "middle" | "end"; readonly extend: boolean }
export interface CompactArrangement { readonly measures: readonly CompactMeasureOccurrence[]; readonly tracks: readonly CompactTrack[] }
export interface PracticeSettings { readonly selectedTrackIndex?: number; readonly speedPercent?: 50 | 75 | 100 | 125 | 150; readonly accompanimentEnabled?: boolean }
export interface PracticeSharePayload { readonly schemaVersion: 3; readonly title: string; readonly tempo: TempoSpec; readonly key: KeySignature; readonly presetId: ArrangementPresetId; readonly arrangementArtifactDigest: SemanticDigest; readonly effectiveChordTimelineDigest: SemanticDigest; readonly arrangement: CompactArrangement; readonly lyrics: readonly CompactLyricToken[]; readonly chords?: readonly CompactChord[]; readonly playbackDefaults?: PracticeSettings; readonly rightsShareConfirmed: true }
export interface ShareStoreRecord { readonly opaqueTokenHash: string; readonly payloadDigest: SemanticDigest; readonly encryptedPayload: Uint8Array; readonly createdAt: string; readonly expiresAt: string; readonly rightsBasis: RightsBasis }

function isCompactFraction(value: unknown): value is CompactFraction {
  return Array.isArray(value) && value.length === 2 && Number.isSafeInteger(value[0]) && Number.isSafeInteger(value[1]) && value[1] > 0;
}
export function isPracticeSharePayload(value: unknown): value is PracticeSharePayload {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Readonly<Record<string, unknown>>;
  if (payload.schemaVersion !== 3 || payload.rightsShareConfirmed !== true || typeof payload.title !== "string" || typeof payload.arrangement !== "object" || payload.arrangement === null) return false;
  const arrangement = payload.arrangement as Readonly<Record<string, unknown>>;
  if (!Array.isArray(arrangement.measures) || !Array.isArray(arrangement.tracks) || arrangement.tracks.filter((track) => typeof track === "object" && track !== null && (track as Readonly<Record<string, unknown>>).kind === "source-lead").length !== 1) return false;
  return arrangement.measures.every((measure, index) => {
    if (typeof measure !== "object" || measure === null) return false;
    const item = measure as Readonly<Record<string, unknown>>;
    return item.index === index && Number.isSafeInteger(item.lyricVerseIndex) && (item.lyricVerseIndex as number) > 0 && isCompactFraction(item.duration);
  });
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

