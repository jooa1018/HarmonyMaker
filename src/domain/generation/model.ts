import type { ArrangementPresetId } from "../config";
import type { SemanticDigest } from "../digest/canonical";
import type { Diagnostic } from "../diagnostics";
import type { CountRateMetric, DurationRateMetric } from "../rates";
import type { TexturePatternId, ActivityDensityMetrics, VoiceActivityDirective } from "../plans";
import type { SpelledPitch } from "../pitch";
import type { MusicalRange, MusicalPosition } from "../time";
import type { VocalPlacementRole } from "../performer";
import type { PerformanceMeasureOccurrence } from "../performance/repeat";
import type { TimelineAtom } from "../source/atomization";
import type { EffectiveChordTimeline } from "../harmony/chord-timeline";
import type { LyricToken } from "../source/model";

export interface GeneratedNoteEventPayload { readonly kind: "note"; readonly range: MusicalRange; readonly pitch: SpelledPitch; readonly tieStart: boolean; readonly tieStop: boolean; readonly lyricTokenIds: readonly string[]; readonly source: "unison" | "octave-double" | "anchor" | "connection" | "planned-nct" | "user-edit"; readonly originDirectiveId?: string }
export interface GeneratedRestEventPayload { readonly kind: "rest"; readonly range: MusicalRange }
export type GeneratedVoiceEventPayload = GeneratedNoteEventPayload | GeneratedRestEventPayload;
export type GeneratedVoiceEvent = GeneratedVoiceEventPayload & { readonly id: string };
export interface GeneratedHarmonyTrack { readonly trackPlanId: string; readonly events: readonly GeneratedVoiceEvent[] }
export interface RealizedHarmonyAnchor { readonly directiveId: string; readonly trackPlanId: string; readonly position: MusicalPosition; readonly pitch: SpelledPitch }
export interface TextureDensityMetrics extends ActivityDensityMetrics { readonly harmonicDivergenceCoverage: DurationRateMetric; readonly exactlyTwoPitchCoverage: DurationRateMetric; readonly exactlyThreePitchCoverage: DurationRateMetric; readonly medianRegisterSpreadSemitones: number }
export interface PhraseBoundaryState { readonly firstPitchByTrack: Readonly<Record<string, SpelledPitch | null>>; readonly lastPitchByTrack: Readonly<Record<string, SpelledPitch | null>>; readonly endingActivityByTrack: Readonly<Record<string, VoiceActivityDirective>>; readonly placementRoleByTrack: Readonly<Record<string, VocalPlacementRole>>; readonly unresolvedNctPlanIds: readonly string[]; readonly recentTextureIds: readonly TexturePatternId[] }
export interface FullSongMetrics { readonly densityBySectionOccurrence: Readonly<Record<string, TextureDensityMetrics>>; readonly maxLeapSemitonesByTrack: Readonly<Record<string, number>>; readonly hardDiagnosticCount: number; readonly plannedNctResolution: CountRateMetric; readonly sourceChordRespect: CountRateMetric }
export interface ArrangementCandidate { readonly id: string; readonly presetId: ArrangementPresetId; readonly candidateStatus: "complete" | "partial"; readonly anchorPlanDigest: SemanticDigest; readonly effectiveConfigDigest: SemanticDigest; readonly presetProfileDigest: SemanticDigest; readonly effectiveChordTimelineDigest: SemanticDigest; readonly sourceLeadAtomizationDigest: SemanticDigest; readonly generatedEventsByTrack: Readonly<Record<string, readonly GeneratedVoiceEvent[]>>; readonly realizedAnchors: readonly RealizedHarmonyAnchor[]; readonly metrics: FullSongMetrics; readonly diagnostics: readonly Diagnostic[]; readonly canonicalPathKey: string; readonly contentDigest: SemanticDigest }
export type GenerationStatus = "blocked" | "complete" | "partial";
export interface GenerationDigests { readonly musicalSourceDigest: SemanticDigest; readonly effectiveChordTimelineDigest: SemanticDigest; readonly sourceLeadAtomizationDigest: SemanticDigest; readonly presetProfileDigest: SemanticDigest; readonly effectiveConfigDigest: SemanticDigest; readonly intentInputDigest: SemanticDigest; readonly activityInputDigest: SemanticDigest; readonly anchorInputDigest: SemanticDigest; readonly generationInputDigest: SemanticDigest; readonly intentPlanDigest: SemanticDigest; readonly activityPlanDigest: SemanticDigest; readonly anchorPlanDigest: SemanticDigest }
export interface ArrangementGenerationResult { readonly presetId: ArrangementPresetId; readonly status: GenerationStatus; readonly candidates: readonly ArrangementCandidate[]; readonly diagnostics: readonly Diagnostic[]; readonly digests: GenerationDigests; readonly configDigests: Readonly<Record<string, SemanticDigest>>; readonly versions: Readonly<Record<string, string>> }
export interface ArrangementRenderDocument { readonly measures: readonly PerformanceMeasureOccurrence[]; readonly sourceLeadTrack: { readonly trackPlanId: "track:source-lead"; readonly atomizationDigest: SemanticDigest; readonly atoms: readonly TimelineAtom[] }; readonly generatedHarmonyTracks: readonly GeneratedHarmonyTrack[]; readonly effectiveChordTimeline: EffectiveChordTimeline; readonly lyricTokens: readonly LyricToken[] }
