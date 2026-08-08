import type { ChordToneSpec } from "./chord/model";
import type { ArrangementPresetId, CoreArrangementMode, EffectiveArrangementConfig } from "./config";
import type { SemanticDigest } from "./digest/canonical";
import type { Diagnostic } from "./diagnostics";
import type { EffectiveChordTimeline } from "./harmony/chord-timeline";
import type { GeneratedTrackOrdinal, TrackRoleSegment, VocalPlacementRole } from "./performer";
import type { PitchRange } from "./pitch";
import type { BasisPoints, CostUnit, DurationRateMetric, ExtendedBasisPoints, ExtendedCountRateMetric } from "./rates";
import type { SourceLeadAtomization, LeadAtomReference } from "./source/atomization";
import type { PhraseRegion, SectionOccurrence, SectionType, SectionVariant } from "./source/model";
import type { MusicalPosition, MusicalRange } from "./time";

export type TexturePatternId = "UNISON" | "UNISON_TO_SPLIT" | "TWO_PART_PARALLEL" | "ACCENT_BLOCK" | "SUSTAINED_PAD" | "SUSPENSION_RELEASE";
export type LyricPolicy = "same-lyrics" | "hold-current-vowel" | "no-new-lyric";
export type CadencePolicy = "open" | "closed" | "looping";
export interface SectionIntensityTarget { readonly participationCoverageBp: BasisPoints; readonly harmonicDivergenceCoverageBp: BasisPoints; readonly exactlyTwoPitchCoverageBp: BasisPoints; readonly exactlyThreePitchCoverageBp: BasisPoints; readonly maxHarmonyAttackRatioBp: ExtendedBasisPoints; readonly registerSpreadRange: readonly [min: number, max: number]; readonly maxActiveVoiceCount: 1 | 2 | 3 }
export interface GrammarCandidateTrace { readonly id: string; readonly phraseId: string; readonly presetId: ArrangementPresetId; readonly textureId: TexturePatternId; readonly eligible: boolean; readonly score: CostUnit; readonly reasonCodes: readonly string[] }
export interface GrammarPlanningTraceRepository { readonly grammarVersion: string; readonly candidatesByPhraseId: Readonly<Record<string, readonly GrammarCandidateTrace[]>> }
export interface SectionArrangementIntent { readonly id: string; readonly sectionOccurrenceId: string; readonly presetId: ArrangementPresetId; readonly intensityTarget: SectionIntensityTarget; readonly grammarRuleIds: readonly string[] }
export interface TextureSplitDirective { readonly position: MusicalPosition; readonly reasonCode: "LATE_LONG_NOTE" | "LATE_CHORD_CHANGE" | "CONFIRMED_LYRIC_EMPHASIS" | "PHRASE_MIDPOINT" }
export interface PhraseArrangementIntent { readonly id: string; readonly phraseId: string; readonly presetId: ArrangementPresetId; readonly sectionIntentId: string; readonly textureId: TexturePatternId; readonly trackRoles: readonly TrackRoleSegment[]; readonly lyricPolicy: LyricPolicy; readonly cadencePolicy: CadencePolicy; readonly splitDirective?: TextureSplitDirective; readonly grammarRuleIds: readonly string[] }
export interface ArrangementIntentPlan {
  readonly stage: "intent"; readonly presetId: ArrangementPresetId; readonly intentInputDigest: SemanticDigest; readonly effectiveChordTimelineDigest: SemanticDigest; readonly sourceLeadAtomizationDigest: SemanticDigest; readonly effectiveConfigDigest: SemanticDigest; readonly presetProfileVersion: string; readonly presetProfileDigest: SemanticDigest; readonly grammarId: "worship-arrangement-grammar-v1"; readonly grammarVersion: string; readonly plannerVersion: string; readonly grammarConfigDigest: SemanticDigest; readonly plannerConfigDigest: SemanticDigest; readonly diagnosticRegistryVersion: string; readonly diagnosticRegistryDigest: SemanticDigest; readonly sectionIntents: readonly SectionArrangementIntent[]; readonly phraseIntents: readonly PhraseArrangementIntent[]; readonly grammarTrace?: GrammarPlanningTraceRepository; readonly intentPlanDigest: SemanticDigest;
}
export type VoiceActivityDirective =
  | { readonly state: "rest" }
  | { readonly state: "lead-derived"; readonly behavior: "unison-double" | "octave-double" }
  | { readonly state: "independent-note"; readonly behavior: "independent-harmony" }
  | { readonly state: "sustain"; readonly behavior: "sustained-pad" | "independent-harmony" };
export interface VoiceActivitySpan { readonly id: string; readonly trackPlanId: string; readonly range: MusicalRange; readonly activity: VoiceActivityDirective }
export interface VoiceAttackEvent { readonly id: string; readonly trackPlanId: string; readonly position: MusicalPosition; readonly kind: "attack" | "release" | "reentry" }
export interface ActivityDensityMetrics { readonly participationCoverage: DurationRateMetric; readonly harmonyAttackRatio: ExtendedCountRateMetric; readonly harmonyOverLeadRestCoverage: DurationRateMetric; readonly maxSimultaneousHarmonyTracks: 0 | 1 | 2 }
export interface PhraseActivityPlan { readonly id: string; readonly phraseId: string; readonly intentId: string; readonly activitySpans: readonly VoiceActivitySpan[]; readonly attackEvents: readonly VoiceAttackEvent[]; readonly realizedMetrics: ActivityDensityMetrics }
export interface ArrangementActivityPlan { readonly stage: "activity-realized"; readonly presetId: ArrangementPresetId; readonly intentPlanDigest: SemanticDigest; readonly activityInputDigest: SemanticDigest; readonly activityPlannerVersion: string; readonly activityPlannerConfigDigest: SemanticDigest; readonly diagnosticRegistryVersion: string; readonly diagnosticRegistryDigest: SemanticDigest; readonly sourceLeadAtomizationDigest: SemanticDigest; readonly effectiveConfigDigest: SemanticDigest; readonly presetProfileDigest: SemanticDigest; readonly phraseActivityPlans: readonly PhraseActivityPlan[]; readonly activityPlanDigest: SemanticDigest }
export type NonChordToneKind = "passing" | "neighbor" | "anticipation" | "suspension";
interface NonChordTonePlanBase { readonly id: string; readonly trackPlanId: string; readonly position: MusicalPosition; readonly contextChordSpanId: string; readonly targetChordSpanId: string; readonly resolutionDirectiveId: string; readonly resolutionDeadline: MusicalPosition }
export type NonChordTonePlan =
  | (NonChordTonePlanBase & { readonly kind: "passing" | "neighbor"; readonly preparationDirectiveId: string; readonly direction: "up" | "down" })
  | (NonChordTonePlanBase & { readonly kind: "anticipation"; readonly preparationDirectiveId: string })
  | (NonChordTonePlanBase & { readonly kind: "suspension"; readonly preparationDirectiveId: string; readonly resolutionDirection: "down" | "up" });
export type HarmonyAnchorDirective =
  | { readonly kind: "chord-tone"; readonly id: string; readonly trackPlanId: string; readonly position: MusicalPosition; readonly chordSpanId: string; readonly selectedTone: ChordToneSpec }
  | { readonly kind: "planned-nct"; readonly id: string; readonly trackPlanId: string; readonly position: MusicalPosition; readonly contextChordSpanId: string; readonly nctPlanId: string }
  | { readonly kind: "lead-derived"; readonly id: string; readonly trackPlanId: string; readonly position: MusicalPosition; readonly leadAtom: LeadAtomReference; readonly relation: "unison" | "octave" };
export interface PhraseAnchorPlan { readonly id: string; readonly phraseId: string; readonly activityPlanId: string; readonly anchorDirectives: readonly HarmonyAnchorDirective[]; readonly nctPlans: readonly NonChordTonePlan[] }
export interface ArrangementAnchorPlan { readonly stage: "anchor-realized"; readonly presetId: ArrangementPresetId; readonly activityPlanDigest: SemanticDigest; readonly anchorInputDigest: SemanticDigest; readonly anchorPlannerVersion: string; readonly anchorPlannerConfigDigest: SemanticDigest; readonly diagnosticRegistryVersion: string; readonly diagnosticRegistryDigest: SemanticDigest; readonly sourceLeadAtomizationDigest: SemanticDigest; readonly effectiveConfigDigest: SemanticDigest; readonly presetProfileDigest: SemanticDigest; readonly phraseAnchorPlans: readonly PhraseAnchorPlan[]; readonly anchorPlanDigest: SemanticDigest }
export type StageExecutionResult<T> = { readonly status: "complete"; readonly value: T; readonly diagnostics: readonly Diagnostic[] } | { readonly status: "blocked"; readonly diagnostics: readonly Diagnostic[] };

export interface PhraseFeatures { readonly phraseId: string; readonly sectionType: SectionType; readonly sectionVariant: SectionVariant; readonly meterFamily: "simple-quadruple" | "compound-duple"; readonly primaryPulseCount: number; readonly leadAttackCount: number; readonly leadRangeSemitones: number; readonly productionLyricEmphasisCount: number; readonly lateLongNote: boolean; readonly lateChordChange: boolean; readonly commonToneSpanPrimaryPulses: number; readonly suspensionOpportunityCount: number; readonly noChordCoverageBp: BasisPoints; readonly repeatedSourcePhrase: boolean; readonly previousTextureIds: readonly TexturePatternId[] }
export interface AssignedHarmonyTrackContext { readonly trackPlanId: string; readonly trackOrdinal: GeneratedTrackOrdinal; readonly performerOrdinal: number; readonly hardRange: PitchRange; readonly comfortableRange: PitchRange; readonly preferredTessitura?: PitchRange; readonly previousPlacementRole?: VocalPlacementRole }
export interface WorshipSectionGrammarInput { readonly mode: CoreArrangementMode; readonly presetId: ArrangementPresetId; readonly effectiveConfig: EffectiveArrangementConfig; readonly effectiveChordTimeline: EffectiveChordTimeline; readonly sectionOccurrence: SectionOccurrence; readonly phrases: readonly PhraseRegion[]; readonly phraseFeatures: readonly PhraseFeatures[]; readonly assignedTracks: readonly AssignedHarmonyTrackContext[] }
export type WorshipSectionGrammarResult = { readonly status: "complete"; readonly sectionIntent: SectionArrangementIntent; readonly diagnostics: readonly Diagnostic[] } | { readonly status: "blocked"; readonly diagnostics: readonly Diagnostic[] };
export interface WorshipPhraseGrammarInput { readonly mode: CoreArrangementMode; readonly presetId: ArrangementPresetId; readonly effectiveConfig: EffectiveArrangementConfig; readonly effectiveChordTimeline: EffectiveChordTimeline; readonly sourceLeadAtomization: SourceLeadAtomization; readonly sectionOccurrence: SectionOccurrence; readonly sectionIntent: SectionArrangementIntent; readonly phrase: PhraseRegion; readonly features: PhraseFeatures; readonly assignedTracks: readonly AssignedHarmonyTrackContext[]; readonly intentLocks: readonly import("./locks").IntentLock[] }
export type WorshipPhraseGrammarResult = { readonly status: "complete"; readonly phraseIntent: PhraseArrangementIntent; readonly candidateTrace: readonly GrammarCandidateTrace[]; readonly diagnostics: readonly Diagnostic[] } | { readonly status: "blocked"; readonly candidateTrace: readonly GrammarCandidateTrace[]; readonly diagnostics: readonly Diagnostic[] };
export interface WorshipArrangementGrammar { readonly grammarId: "worship-arrangement-grammar-v1"; readonly grammarVersion: string; readonly grammarConfigDigest: SemanticDigest; planSection(input: WorshipSectionGrammarInput): WorshipSectionGrammarResult; planPhrase(input: WorshipPhraseGrammarInput): WorshipPhraseGrammarResult }

export function validateIntentAuthority(plan: ArrangementIntentPlan): boolean {
  const sectionIds = new Set(plan.sectionIntents.map((intent) => intent.id));
  return plan.phraseIntents.every((intent) => sectionIds.has(intent.sectionIntentId) && !("intensityTarget" in intent) && !("candidateTraceId" in intent));
}
