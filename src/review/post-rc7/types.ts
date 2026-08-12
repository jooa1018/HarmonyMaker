import type { ParsedChord } from "../../domain/chord/model";
import type { Fraction } from "../../domain/fraction";
import type { PerformerProfile, VocalPlacementRole } from "../../domain/performer";
import type { KeySignature, SpelledPitch } from "../../domain/pitch";

export type ResearchBaselineId = "B0" | "B1" | "B1.5-MATCHED" | "B1.5-E2E";
export type PlaybackMix =
  | "LEAD_ONLY"
  | "HARMONY_ONLY"
  | "LEAD_AND_HARMONY"
  | "BAND_ONLY"
  | "BAND_LEAD_AND_HARMONY";
export type RendererTier = "POOR" | "COMPETENT_PLAIN" | "HIGH";

export interface ResearchNoteEvent {
  readonly id: string;
  readonly onsetQ: Fraction;
  readonly durationQ: Fraction;
  readonly pitch: SpelledPitch;
  readonly syllableId: string;
  readonly lyric: string;
  readonly lyricOnset: boolean;
  readonly attack: boolean;
  readonly provenance: "SOURCE_LEAD" | "LEAD_COUPLED" | "CANONICAL_CHORD_BOUNDARY";
}

export interface ResearchChordSpan {
  readonly id: string;
  readonly onsetQ: Fraction;
  readonly durationQ: Fraction;
  readonly sourceText: string;
  readonly chord: ParsedChord;
}

export interface ResearchActivitySlot {
  readonly id: string;
  readonly onsetQ: Fraction;
  readonly durationQ: Fraction;
  readonly allowHarmony: boolean;
  readonly allowRest: boolean;
  readonly source: "EXPLICIT_MATCHED" | "FULL_PHRASE_LEAD_COUPLED_V0";
}

export interface ResearchActivitySchedule {
  readonly id: string;
  readonly policy: "EXPLICIT_MATCHED_V0" | "FULL_PHRASE_LEAD_COUPLED_V0";
  readonly slots: readonly ResearchActivitySlot[];
}

export interface ResearchFixture {
  readonly id: string;
  readonly title: string;
  readonly authorshipKind: "PROJECT_ORIGINAL" | "PUBLIC_DOMAIN" | "LICENSED";
  readonly rightsNote: string;
  readonly acceptanceEligibility: "ENGINEERING_ONLY" | "DEVELOPMENT_LISTENING";
  readonly placement: VocalPlacementRole;
  readonly performer: PerformerProfile;
  readonly preferredLeapSemitones: number;
  readonly hardLeapSemitones: number;
  readonly seedHarmonyPitch?: SpelledPitch;
  /** Review-fixture-only tonal declaration for the intentionally naive B1 control. */
  readonly tonalContext: KeySignature;
  readonly matchedActivitySchedule: ResearchActivitySchedule;
  readonly lead: readonly ResearchNoteEvent[];
  readonly chords: readonly ResearchChordSpan[];
  readonly tags: readonly string[];
}

export interface ResearchArrangement {
  readonly fixtureId: string;
  readonly baselineId: ResearchBaselineId;
  readonly lead: readonly ResearchNoteEvent[];
  readonly harmony: readonly ResearchNoteEvent[];
}

export interface IndependentHarmonyRun {
  readonly onsetQ: Fraction;
  readonly durationQ: Fraction;
}

export interface RelationBucket {
  readonly relation: string;
  readonly durationQ: Fraction;
}

export interface ResearchDiagnostics {
  readonly hardRangeFailures: number;
  readonly comfortableRangeMisses: number;
  readonly preferredTessituraMisses: number;
  readonly preferredLeapFailures: number;
  readonly hardLeapFailures: number;
  readonly maxLeapSemitones: number | null;
}
