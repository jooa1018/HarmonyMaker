import type { Fraction } from "../../domain/fraction";
import type { KeySignature, SpelledPitch } from "../../domain/pitch";
import type { TimeSignature } from "../../domain/meter";
import type { RightsMetadata, TempoSpec } from "../../domain/source/model";
import type { SourceSlurMark } from "../../domain/source/notation";
import type { LocalCandidateBundle } from "../../domain/omr/local-candidate";
import type { MusicXmlImportDraft, PerformerReviewSlot, ImportedSectionDraft, ImportedLyricDraft, Step3ImportVersions } from "../musicxml/types";

export const SCORE_WORKSPACE_VERSION = "hm-score-workspace-v1" as const;
export interface WorkspaceOrigin {
  readonly kind: "musicxml" | "local-omr" | "legacy-recovery";
  readonly fileName: string;
  readonly xml: string;
  readonly xmlDigest: string;
  readonly originalFile?: { readonly base64: string; readonly sha256: string };
  readonly localCandidate?: LocalCandidateBundle;
  /** Exact old bundle. It is replayed before conversion and never rewritten. */
  readonly legacyBundle?: string;
}
export type WorkspaceScope =
  | { readonly kind: "document" }
  | { readonly kind: "metadata" }
  | { readonly kind: "measure"; readonly measureId: string; readonly voiceKey?: string };
export interface WorkspaceIssue {
  readonly id: string;
  readonly kind: "correspondence" | "notation" | "pitch" | "time" | "lyrics" | "unsupported" | "metadata" | "unknown";
  readonly scope: WorkspaceScope;
  readonly targetIds: readonly string[];
  readonly messageKo: string;
  readonly requiredAction: "compare" | "correct" | "unsupported";
  readonly evidenceRef: string;
  /** This is computed by the app, never copied from bundle severity/eligibility. */
  readonly impacts: readonly ("arrange" | "play-source" | "export-source")[];
}
export interface ArrangementRequest {
  readonly range: "whole-score";
  readonly lead?: string;
  readonly rhythmVoices: readonly string[];
  readonly keys: Readonly<Record<string, KeySignature>>;
  readonly tempo?: TempoSpec;
  readonly singerCount: 1 | 2 | 3;
  readonly performers: readonly PerformerReviewSlot[];
  readonly rights?: RightsMetadata;
  readonly sections: readonly ImportedSectionDraft[];
  readonly lyricVerses: Readonly<Record<string, number>>;
  readonly policy: "existing-wag-v1";
  /** Explicit arrangement choice; never an observed/printed source chord. */
  readonly initialPickup?: "anticipate-first-chord";
  readonly preset: "simple" | "standard" | "full";
}
export interface WorkspaceAttestation {
  readonly id: string;
  readonly scope: WorkspaceScope;
  readonly purpose: "music" | "issue";
  readonly issueId?: string;
  readonly dependencyFingerprint: string;
  readonly dependencyVersion?: 2;
  readonly targetIds: readonly string[];
  readonly evidenceDigest: string;
  readonly note: string;
  readonly actor: "user" | "ui-test";
  readonly at: string;
}
export interface WorkspaceState {
  /** The reused import model is the sole editable music state, not XML text. */
  readonly music?: MusicXmlImportDraft;
  readonly issues: readonly WorkspaceIssue[];
  readonly request: ArrangementRequest;
  readonly attestations: readonly WorkspaceAttestation[];
  /** Added only by explicit notation edits; the immutable XML remains intact. */
  readonly notationRemovals?: readonly { readonly eventId: string; readonly feature: string }[];
  /** New editor histories track immutable unsupported symbols through moves. */
  readonly notationTracking?: true;
  readonly removedEventIds?: readonly string[];
  /** Opt-in preserves the dependency fingerprints of pre-editor histories. */
  readonly slurReviewTracking?: true;
  /** Explicit migration invalidations, never replacement user approvals. */
  readonly invalidatedLegacyReviewIds?: readonly string[];
}
export type WorkspaceEdit =
  | { readonly kind: "pickup-policy"; readonly value: "none" | "anticipate-first-chord" }
  | { readonly kind: "title"; readonly title: string }
  | { readonly kind: "lead"; readonly lead: string; readonly rhythmVoices: readonly string[] }
  | { readonly kind: "key"; readonly contextId: string; readonly key: KeySignature }
  | { readonly kind: "tempo"; readonly tempo: TempoSpec }
  | { readonly kind: "chord"; readonly measureId: string; readonly chordId?: string; readonly text: string; readonly onset: Fraction }
  | { readonly kind: "fermata"; readonly eventId: string; readonly value: boolean }
  | { readonly kind: "note"; readonly eventId: string; readonly value: { readonly kind: "note" | "rest" | "rhythm"; readonly pitch?: SpelledPitch; readonly onset: Fraction; readonly duration: Fraction; readonly tieStart: boolean; readonly tieStop: boolean } }
  | { readonly kind: "remove-notation"; readonly eventId: string; readonly feature: string }
  | { readonly kind: "event-voice"; readonly eventId: string; readonly staffNumber: number; readonly voice: string }
  | { readonly kind: "insert-event"; readonly measureId: string; readonly staffNumber: number; readonly voice: string; readonly eventKind: "note" | "rest" | "rhythm"; readonly pitch?: SpelledPitch; readonly onset: Fraction; readonly duration: Fraction; readonly tieStart?: boolean; readonly tieStop?: boolean }
  | { readonly kind: "remove-event"; readonly eventId: string }
  | { readonly kind: "move-event"; readonly eventId: string; readonly measureId: string; readonly onset: Fraction }
  | { readonly kind: "measure-extent"; readonly measureId: string; readonly duration: Fraction; readonly implicit: boolean }
  | { readonly kind: "event-lyrics"; readonly eventId: string; readonly lyrics: readonly ImportedLyricDraft[] }
  | { readonly kind: "event-slurs"; readonly eventId: string; readonly slurs: readonly SourceSlurMark[] }
  | { readonly kind: "remove-chord"; readonly chordId: string }
  | { readonly kind: "move-chord"; readonly chordId: string; readonly measureId: string; readonly onset: Fraction }
  | { readonly kind: "meter"; readonly startMeasureId: string; readonly endMeasureIdExclusive?: string; readonly time: TimeSignature }
  | { readonly kind: "split"; readonly measureId: string; readonly at: Fraction }
  | { readonly kind: "performers"; readonly count: 1 | 2 | 3; readonly slots: readonly PerformerReviewSlot[] }
  | { readonly kind: "rights"; readonly rights: RightsMetadata }
  | { readonly kind: "sections"; readonly sections: readonly ImportedSectionDraft[]; readonly lyricVerses: Readonly<Record<string, number>> }
  | { readonly kind: "issue"; readonly scope: WorkspaceScope; readonly detail: string };
export type WorkspaceCommand = WorkspaceEdit
  | { readonly kind: "attest"; readonly scope: WorkspaceScope; readonly purpose: "music" | "issue"; readonly issueId?: string }
  | { readonly kind: "undo" }
  | { readonly kind: "redo" };
export interface WorkspaceOperation {
  readonly id: string; readonly command: WorkspaceCommand;
  readonly beforeDigest: string; readonly afterDigest: string;
  readonly affectedIds: readonly string[];
  readonly note: string; readonly actor: "user" | "ui-test"; readonly at: string;
  /** Absence replays the original dependency contract byte-for-byte. */
  readonly reviewDependencyVersion?: 2;
  /** Verified against chronological before/after v2 dependencies on replay. */
  readonly invalidatedLegacyReviewIds?: readonly string[];
}
export interface ScoreWorkspace {
  readonly version: typeof SCORE_WORKSPACE_VERSION;
  readonly id: string;
  readonly origin: WorkspaceOrigin;
  readonly algorithmVersions: Step3ImportVersions;
  readonly operations: readonly WorkspaceOperation[];
  readonly revision: number;
  readonly digest: string;
  /** Binds command metadata and immutable evidence, separately from music state. */
  readonly historyDigest: string;
}
export interface WorkspaceCapabilities {
  readonly view: true; readonly edit: boolean; readonly saveDraft: true; readonly exportWorkspace: true;
  readonly arrange: boolean; readonly playSource: boolean; readonly exportSource: boolean;
  readonly blockers: readonly { readonly id: string; readonly messageKo: string; readonly scope: WorkspaceScope }[];
  readonly pendingIssues: readonly WorkspaceIssue[];
  readonly musicReviews: readonly { readonly measureId: string; readonly current: boolean }[];
}
