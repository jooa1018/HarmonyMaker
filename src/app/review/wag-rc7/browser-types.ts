import type { ArrangementPresetId } from "../../../domain/config";
import type { Rc7PlaybackArtifact, Rc7ScorePart } from "../../../review/wag-rc7/types";

export interface Rc7BrowserEvent {
  readonly voice: "Harmony 1" | "Harmony 2";
  readonly range: string;
  readonly pitch: string;
  readonly source: string;
}

export interface Rc7BrowserCase {
  readonly caseId: string;
  readonly title: string;
  readonly description: string;
  readonly defaultPreset: ArrangementPresetId;
  readonly preset: ArrangementPresetId;
  readonly texture: string;
  readonly section: string;
  readonly sectionVariant: string;
  readonly meter: string;
  readonly candidateId: string;
  readonly candidateContentDigest: string;
  readonly opportunityKey: string;
  readonly intentInputDigest: string;
  readonly grammarConfigDigest: string;
  readonly activeTrackOrdinals: readonly number[];
  readonly roleTuple: readonly string[];
  readonly leadAttackCount: number;
  readonly harmonyAttackCount: number;
  readonly anchorCount: number;
  readonly rangeCheckCount: number;
  readonly verticalCheckCount: number;
  readonly nctKinds: readonly string[];
  readonly generatedEvents: readonly Rc7BrowserEvent[];
  readonly winnerScore: number;
  readonly winnerScoreParts: readonly Rc7ScorePart[];
  readonly playback: Rc7PlaybackArtifact;
}
