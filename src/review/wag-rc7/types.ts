import type { ChordToneSpec } from "../../domain/chord/model";
import type {
  ArrangementPresetId,
  CoreArrangementMode,
  EffectiveArrangementConfig,
  UserArrangementCaps,
} from "../../domain/config";
import type { SemanticDigest } from "../../domain/digest/canonical";
import type { PlanOrdinalRegistry } from "../../domain/digest/plans";
import type { Fraction } from "../../domain/fraction";
import type { ArrangementCandidate, GeneratedVoiceEventPayload } from "../../domain/generation/model";
import type { RealizedHarmonyAnchor } from "../../domain/generation/model";
import type { EffectiveChordTimeline } from "../../domain/harmony/chord-timeline";
import type { VariantStageLocks } from "../../domain/locks";
import type {
  ArrangementActivityPlan,
  ArrangementAnchorPlan,
  ArrangementIntentPlan,
  CadencePolicy,
  GrammarCandidateTrace,
  LyricPolicy,
  PhraseArrangementIntent,
  PhraseFeatures,
  SectionIntensityTarget,
  TexturePatternId,
} from "../../domain/plans";
import type {
  PerformerProfile,
  PerformerTrackAssignment,
  VocalPlacementRole,
  VocalTrackPlan,
} from "../../domain/performer";
import type { KeySignature, PitchRange, SpelledPitch } from "../../domain/pitch";
import type { PerformanceSequence } from "../../domain/performance/repeat";
import type { SourceLeadAtomization, TimelineAtom } from "../../domain/source/atomization";
import type {
  LyricToken,
  PhraseRegion,
  SectionDefinition,
  SectionOccurrence,
  SectionType,
  SectionVariant,
  SourceMeasure,
  TempoSpec,
} from "../../domain/source/model";
import type { MusicalPosition, MusicalRange } from "../../domain/time";

export type Rc7MeterFamily = "simple-quadruple" | "compound-duple";

export type Rc7NormalizedCueSemantic =
  | "section-start"
  | "qualified-phrase-start"
  | "lyric-emphasis-confirmed"
  | "lyric-emphasis-musicxml-accent-suggested"
  | "late-long-note"
  | "compound-late-chord-change"
  | "lead-rest-reentry"
  | "texture-split-position"
  | "active-continuation";

export interface Rc7PerformerEntry {
  readonly performerOrdinal: number;
  readonly profile: PerformerProfile;
}

export interface Rc7PreparedCase {
  readonly caseId: string;
  readonly title: string;
  readonly description: string;
  readonly sourceKind: "synthetic-original" | "quick-review-import";
  readonly sourceIdentity: string;
  readonly meterFamily: Rc7MeterFamily;
  readonly defaultKey: KeySignature;
  readonly defaultTempo: TempoSpec;
  readonly sourceMeasures: readonly SourceMeasure[];
  readonly performanceSequence: PerformanceSequence;
  readonly sectionDefinition: SectionDefinition;
  readonly sectionOccurrence: SectionOccurrence;
  readonly phrase: PhraseRegion;
  readonly lyricTokens: readonly LyricToken[];
  readonly musicalSourceDigest: SemanticDigest;
  readonly effectiveChordTimeline: EffectiveChordTimeline;
  readonly sourceLeadAtomization: SourceLeadAtomization;
  readonly presetId: ArrangementPresetId;
  readonly mode: CoreArrangementMode;
  readonly userCaps: UserArrangementCaps;
  readonly performers: readonly Rc7PerformerEntry[];
  readonly tracks: readonly VocalTrackPlan[];
  readonly assignments: readonly PerformerTrackAssignment[];
  readonly locks: VariantStageLocks;
  readonly priorPersistedPhraseIntent: PhraseArrangementIntent | null;
  readonly expectedTexture?: TexturePatternId;
  readonly fixtureTags: readonly string[];
}

export interface Rc7DerivedCue {
  readonly semantic: Rc7NormalizedCueSemantic;
  readonly position: MusicalPosition;
  readonly sourceAtomOrdinal: number;
  readonly cueCost: number;
  readonly reasonOrdinal: number;
  readonly productionSource: "derived" | "confirmed" | "musicxml-accent-suggested";
}

export interface Rc7SymbolicHarmonyRoleObligation {
  readonly anchorPosition: MusicalPosition;
  readonly chordSpanCanonicalOrdinal: number;
  readonly degree: number;
  readonly alteration: number;
  readonly role: "root" | "third" | "fifth" | "seventh" | "color" | "suspension";
  readonly origin: "root" | "quality" | "extension" | "addition" | "alteration" | "suspension";
}

export interface Rc7ResponseSpan {
  readonly range: MusicalRange;
  readonly sourceAtomOrdinals: readonly number[];
  readonly attackOrdinals: readonly number[];
  readonly behavior: "rest" | "unison-double" | "octave-double" | "independent-harmony" | "sustained-pad";
}

export interface Rc7SuspensionChain {
  readonly preparationPosition: MusicalPosition;
  readonly suspensionPosition: MusicalPosition;
  readonly resolutionPosition: MusicalPosition;
  readonly contextChordSpanOrdinal: number;
  readonly targetChordSpanOrdinal: number;
  readonly heldTone: ChordToneSpec;
  readonly resolutionTone: ChordToneSpec;
  readonly resolutionDirection: "down" | "up";
}

export interface Rc7OpportunitySemanticPayload {
  readonly textureOrdinal: number;
  readonly activeTrackOrdinals: readonly number[];
  readonly roleTuple: readonly VocalPlacementRole[];
  readonly normalizedCueSemantic: Rc7NormalizedCueSemantic | null;
  readonly splitPositionOrNull: MusicalPosition | null;
  readonly sourceAtomCanonicalOrdinals: readonly number[];
  readonly exactRanges: readonly MusicalRange[];
  readonly attackOrdinals: readonly number[];
  readonly lyricPolicy: LyricPolicy;
  readonly mandatoryAnchorPositions: readonly MusicalPosition[];
  readonly primaryHarmonyRoleObligationVector: readonly Rc7SymbolicHarmonyRoleObligation[];
  readonly secondTrackRoleContributionVector: readonly Rc7SymbolicHarmonyRoleObligation[];
  readonly responseConstructorId: string;
}

export interface Rc7ScorePart {
  readonly code:
    | "sectionTexturePrior"
    | "cueCost"
    | "cueTextureFitCost"
    | "leadActivityCost"
    | "leadRangeCost"
    | "noChordFragmentationCost"
    | "dropVariantCost"
    | "unisonRealizationCost"
    | "secondTrackForgoneCost"
    | "roleAssignmentCost"
    | "opportunityOverDensityCost";
  readonly cost: number;
}

export interface Rc7ScoredOpportunity {
  readonly key: string;
  readonly textureId: TexturePatternId;
  readonly cadencePolicy: CadencePolicy;
  readonly splitReason: "LATE_LONG_NOTE" | "LATE_CHORD_CHANGE" | "CONFIRMED_LYRIC_EMPHASIS" | "PHRASE_MIDPOINT" | null;
  readonly activeTrackPlanIds: readonly string[];
  readonly activeTrackOrdinals: readonly number[];
  readonly roleByTrackPlanId: Readonly<Record<string, VocalPlacementRole>>;
  readonly responseByTrackPlanId: Readonly<Record<string, readonly Rc7ResponseSpan[]>>;
  readonly semanticPayload: Rc7OpportunitySemanticPayload;
  readonly scoreParts: readonly Rc7ScorePart[];
  readonly totalScore: number;
  readonly reasonOrdinal: number;
  readonly canonicalSubcandidateKey: string;
  readonly rangeStressCostByTrackOrdinal: Readonly<Record<number, number>>;
  readonly suspensionChain: Rc7SuspensionChain | null;
}

export interface Rc7GrammarSelection {
  readonly features: PhraseFeatures;
  readonly intensityTarget: SectionIntensityTarget;
  readonly cues: readonly Rc7DerivedCue[];
  readonly opportunities: readonly Rc7ScoredOpportunity[];
  readonly trace: readonly GrammarCandidateTrace[];
  readonly winner: Rc7ScoredOpportunity;
}

export interface Rc7AuthoritativeIntentProjection {
  readonly projectionSchema: "hm-intent-input-v1";
  readonly musicalSourceDigest: SemanticDigest;
  readonly effectiveChordTimelineDigest: SemanticDigest;
  readonly sourceLeadAtomizationDigest: SemanticDigest;
  readonly atomizerVersion: string;
  readonly performers: readonly {
    readonly performerOrdinal: number;
    readonly hardRange: PitchRange;
    readonly comfortableRange: PitchRange;
    readonly preferredTessitura: PitchRange | null;
  }[];
  readonly tracks: readonly {
    readonly trackOrdinal: number;
    readonly kind: "source-lead" | "generated-harmony";
    readonly enabled: boolean;
  }[];
  readonly assignments: readonly {
    readonly trackOrdinal: number;
    readonly performerOrdinal: number;
  }[];
  readonly mode: CoreArrangementMode;
  readonly userCaps: UserArrangementCaps;
  readonly presetId: ArrangementPresetId;
  readonly effectiveConfigDigest: SemanticDigest;
  readonly presetProfileVersion: string;
  readonly presetProfileDigest: SemanticDigest;
  readonly locks: readonly object[];
  readonly plannerVersion: string;
  readonly grammarVersion: string;
  readonly plannerConfigDigest: SemanticDigest;
  readonly grammarConfigDigest: SemanticDigest;
  readonly diagnosticRegistryVersion: string;
  readonly diagnosticRegistryDigest: SemanticDigest;
}

export interface Rc7IntentInputReconstructionWitness {
  readonly projectionSchema: "hm-intent-input-reconstruction-witness-v2";
  readonly authoritativeIntentInputProjection: Rc7AuthoritativeIntentProjection;
}

export interface Rc7VerifiedAssignedTrack {
  readonly trackPlanId: string;
  readonly trackOrdinal: 1 | 2;
  readonly performerOrdinal: number;
  readonly hardRange: PitchRange;
  readonly comfortableRange: PitchRange;
  readonly preferredTessitura: PitchRange | null;
  readonly previousPlacementRole: VocalPlacementRole | null;
}

export interface Rc7PipelineContext {
  readonly prepared: Rc7PreparedCase;
  readonly effectiveConfig: EffectiveArrangementConfig;
  readonly ordinals: PlanOrdinalRegistry;
  readonly plannerConfigDigest: SemanticDigest;
  readonly activityPlannerConfigDigest: SemanticDigest;
  readonly anchorPlannerConfigDigest: SemanticDigest;
  readonly solverConfigDigest: SemanticDigest;
  readonly assemblerConfigDigest: SemanticDigest;
  readonly validatorConfigDigest: SemanticDigest;
  readonly metricConfigDigest: SemanticDigest;
  readonly diagnosticRegistryDigest: SemanticDigest;
}

export interface Rc7RangeCheck {
  readonly eventId: string;
  readonly trackPlanId: string;
  readonly pitch: SpelledPitch;
  readonly insideHardRange: boolean;
}

export interface Rc7VerticalCheck {
  readonly eventId: string;
  readonly position: MusicalPosition;
  readonly intervalToLead: number | null;
  readonly legal: boolean;
  readonly reason: string;
}

export interface Rc7NctClassification {
  readonly eventId: string;
  readonly classification: "chord-tone" | "lead-derived" | "passing" | "neighbor" | "anticipation" | "suspension";
  readonly legal: boolean;
}

export interface Rc7PitchScoreSubtotals {
  readonly registerAndSustainStress: number;
  readonly melodicMotion: number;
  readonly roleContinuityCrossingLeadSeparation: number;
  readonly identityContext: number;
  readonly identityPriority: number;
  readonly localToneRole: number;
  readonly leadDuplication: number;
  readonly verticalInterval: number;
  readonly jointVoicing: number;
}

export interface Rc7PitchCandidateTrace {
  readonly directiveId: string;
  readonly trackOrdinal: number;
  readonly position: MusicalPosition;
  readonly pitch: SpelledPitch;
  readonly eligible: boolean;
  readonly rejectionReasons: readonly string[];
  readonly subtotals: Rc7PitchScoreSubtotals;
  readonly totalCost: number;
  readonly selected: boolean;
  readonly canonicalPitchKey: string;
}

export interface Rc7GenerationStageResult {
  readonly generationInputDigest: SemanticDigest;
  readonly candidate: ArrangementCandidate;
  readonly payloadsByTrack: Readonly<Record<string, readonly GeneratedVoiceEventPayload[]>>;
  readonly realizedAnchors: readonly RealizedHarmonyAnchor[];
  readonly rangeChecks: readonly Rc7RangeCheck[];
  readonly verticalLegalityChecks: readonly Rc7VerticalCheck[];
  readonly nctClassification: readonly Rc7NctClassification[];
  readonly pitchTrace: readonly Rc7PitchCandidateTrace[];
}

export interface Rc7PlaybackArtifact {
  readonly renderer: "abcjs-6.7.0";
  readonly soundSource: "browser-synth-no-voicebank";
  readonly licenseProvenance: "synthetic-original-fixtures";
  readonly fullArrangementAbc: string;
  readonly leadOnlyAbc: string;
  readonly voiceLabels: readonly ["Lead", "Harmony 1", "Harmony 2"];
}

export interface Rc7ReviewOutput {
  readonly schema: "hm-wag-rc7-review-output-v1";
  readonly authorityBoundary: {
    readonly production: false;
    readonly isolated: true;
    readonly persistsHarmonyProject: false;
    readonly mutatesHarmonyProject: false;
    readonly reviewOnly: true;
  };
  readonly caseId: string;
  readonly title: string;
  readonly sourceIdentity: string;
  readonly meter: Rc7MeterFamily;
  readonly key: KeySignature;
  readonly section: SectionType;
  readonly sectionVariant: SectionVariant;
  readonly preset: ArrangementPresetId;
  readonly performerRanges: readonly Rc7PerformerEntry[];
  readonly phraseBounds: MusicalRange;
  readonly leadAtomsSummary: readonly TimelineAtom[];
  readonly effectiveChordSpans: EffectiveChordTimeline["spans"];
  readonly phraseFeatures: PhraseFeatures;
  readonly activationCues: readonly Rc7DerivedCue[];
  readonly eligibleTextures: readonly TexturePatternId[];
  readonly ineligibleTextures: readonly { readonly textureId: TexturePatternId; readonly reasons: readonly string[] }[];
  readonly candidateIds: readonly string[];
  readonly candidateScoreBreakdown: readonly {
    readonly candidateId: string;
    readonly textureId: TexturePatternId;
    readonly totalScore: number;
    readonly parts: readonly Rc7ScorePart[];
  }[];
  readonly winner: Rc7ScoredOpportunity;
  readonly intent: {
    readonly plan: ArrangementIntentPlan;
    readonly serializedAuthoritativePlan: string;
    readonly witness: Rc7IntentInputReconstructionWitness;
    readonly verifiedAssignedTracks: readonly Rc7VerifiedAssignedTrack[];
  };
  readonly activity: {
    readonly plan: ArrangementActivityPlan;
    readonly rehydratedOpportunityKey: string;
    readonly cacheRequired: false;
    readonly traceRequired: false;
  };
  readonly anchor: {
    readonly plan: ArrangementAnchorPlan;
    readonly primaryRoleVector: readonly Rc7SymbolicHarmonyRoleObligation[];
    readonly secondTrackRoleVector: readonly Rc7SymbolicHarmonyRoleObligation[];
  };
  readonly generated: {
    readonly candidate: ArrangementCandidate;
    readonly payloadsByTrack: Readonly<Record<string, readonly GeneratedVoiceEventPayload[]>>;
    readonly generationInputDigest: SemanticDigest;
    readonly pitchTrace: readonly Rc7PitchCandidateTrace[];
  };
  readonly rangeChecks: readonly Rc7RangeCheck[];
  readonly verticalLegalityChecks: readonly Rc7VerticalCheck[];
  readonly nctClassification: readonly Rc7NctClassification[];
  readonly opportunityKey: string;
  readonly intentInputDigest: SemanticDigest;
  readonly grammarConfigDigest: SemanticDigest;
  readonly digests: Readonly<Record<string, SemanticDigest>>;
  readonly versions: Readonly<Record<string, string>>;
  readonly trace: readonly GrammarCandidateTrace[];
  readonly playback: Rc7PlaybackArtifact;
}

export interface Rc7FixtureNoteSpec {
  readonly startQ: Fraction;
  readonly durationQ: Fraction;
  readonly pitch: SpelledPitch | null;
  readonly lyric?: string;
  readonly emphasis?: "none" | "confirmed" | "musicxml-accent-suggested" | "metric-suggested";
}

export interface Rc7FixtureChordSpec {
  readonly startQ: Fraction;
  readonly symbol: string;
}

export interface Rc7ReferenceCaseDefinition {
  readonly caseId: string;
  readonly title: string;
  readonly description: string;
  readonly meterFamily: Rc7MeterFamily;
  readonly phraseStartQ?: Fraction;
  readonly phraseDurationQ: Fraction;
  readonly sectionType: SectionType;
  readonly sectionVariant: SectionVariant;
  readonly presetId: ArrangementPresetId;
  readonly key: KeySignature;
  readonly tempo: TempoSpec;
  readonly notes: readonly Rc7FixtureNoteSpec[];
  readonly chords: readonly Rc7FixtureChordSpec[];
  readonly maxHarmonyTracks: 0 | 1 | 2;
  readonly performerEntries?: readonly Rc7PerformerEntry[];
  readonly expectedTexture?: TexturePatternId;
  readonly fixtureTags: readonly string[];
}
