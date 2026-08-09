import { validateArrangementSettings, type ArrangementPresetId, type ArrangementSettings, type PresetProfileRegistry } from "./config";
import { isChordParseResult } from "./chord/parser";
import type { SemanticDigest } from "./digest/canonical";
import { DIAGNOSTIC_CODES, type Diagnostic } from "./diagnostics";
import {
  isArrangementOutputEdit, validateOutputEdits,
  type ArrangementOutputEdit, type EditedArrangementSnapshot,
} from "./edit/model";
import type { ArrangementGenerationResult } from "./generation/model";
import type { EffectiveChordTimelineState } from "./harmony/chord-timeline";
import type { VariantStageLocks } from "./locks";
import { validateAssignments, validatePerformer, validateTrackPlans, type PerformerProfile, type PerformerTrackAssignment, type VocalTrackPlan } from "./performer";
import type { ArrangementActivityPlan, ArrangementAnchorPlan, ArrangementIntentPlan, StageExecutionResult } from "./plans";
import type { SourceLeadAtomizationState } from "./source/atomization";
import type { SongSourceDocument } from "./source/model";
import { isSongSourceDocument } from "./source/validation";
import type { AlgorithmExecutionRegistry } from "./registries";
import {
  blockedHarmonyProjectIntegrity,
  validateHarmonyProjectIntegrity as validateProjectIntegrity,
  type HarmonyProjectIntegrityResult,
} from "./project-integrity";
import {
  comparePositions, compareRanges, type MusicalPosition, type MusicalRange,
} from "./time";
import {
  hasExactKeys, hasUniqueStrings, isCanonicalFraction, isCanonicalId,
  isCanonicalPitchRange, isCanonicalSpelledPitch, isMusicalPosition,
  isMusicalRange, isPlainRecord, isSemanticDigest,
} from "./validation";

export type ActiveArrangementRef = { readonly kind: "candidate"; readonly candidateId: string } | { readonly kind: "edited-snapshot"; readonly snapshotId: string };
export interface VariantStaleness { readonly staleFrom: "intent" | "activity" | "anchor" | "generation"; readonly staleDiagnosticIds: readonly string[]; readonly previousArtifactDigests: readonly SemanticDigest[] }
export interface VariantBlockedAttempt { readonly stage: VariantStaleness["staleFrom"]; readonly inputDigest: SemanticDigest; readonly diagnostics: readonly Diagnostic[] }
interface ArrangementVariantBase { readonly presetId: ArrangementPresetId; readonly diagnostics: readonly Diagnostic[]; readonly lastBlockedAttempt?: VariantBlockedAttempt }
type VariantStalenessAt<T extends VariantStaleness["staleFrom"]> = Omit<VariantStaleness, "staleFrom"> & { readonly staleFrom: T };
export type ArrangementVariant =
  | (ArrangementVariantBase & { readonly lifecycle: "empty"; readonly staleness?: never })
  | (ArrangementVariantBase & { readonly lifecycle: "intent-ready"; readonly intentPlan: ArrangementIntentPlan; readonly staleness?: VariantStalenessAt<"intent"> })
  | (ArrangementVariantBase & { readonly lifecycle: "activity-ready"; readonly intentPlan: ArrangementIntentPlan; readonly activityPlan: ArrangementActivityPlan; readonly staleness?: VariantStalenessAt<"intent" | "activity"> })
  | (ArrangementVariantBase & { readonly lifecycle: "anchor-ready"; readonly intentPlan: ArrangementIntentPlan; readonly activityPlan: ArrangementActivityPlan; readonly anchorPlan: ArrangementAnchorPlan; readonly staleness?: VariantStalenessAt<"intent" | "activity" | "anchor"> })
  | (ArrangementVariantBase & { readonly lifecycle: "generation-attempted"; readonly intentPlan: ArrangementIntentPlan; readonly activityPlan: ArrangementActivityPlan; readonly anchorPlan: ArrangementAnchorPlan; readonly generationResult: ArrangementGenerationResult; readonly outputEdits: readonly ArrangementOutputEdit[]; readonly editedSnapshots: readonly EditedArrangementSnapshot[]; readonly activeArrangement?: ActiveArrangementRef; readonly staleness?: VariantStaleness });
export interface HarmonyProject { readonly schemaVersion: 9; readonly source: SongSourceDocument; readonly chordTimelineState: EffectiveChordTimelineState; readonly sourceLeadAtomizationState: SourceLeadAtomizationState; readonly presetProfiles: PresetProfileRegistry; readonly performers: readonly PerformerProfile[]; readonly trackPlans: readonly VocalTrackPlan[]; readonly assignments: readonly PerformerTrackAssignment[]; readonly settings: ArrangementSettings; readonly locksByPreset: Readonly<Partial<Record<ArrangementPresetId, VariantStageLocks>>>; readonly variants: Readonly<Partial<Record<ArrangementPresetId, ArrangementVariant>>>; readonly selectedPresetId?: ArrangementPresetId }

const stages = ["intent", "activity", "anchor", "generation"] as const;
const lifecycleMax: Readonly<Record<ArrangementVariant["lifecycle"], number>> = { empty: -1, "intent-ready": 0, "activity-ready": 1, "anchor-ready": 2, "generation-attempted": 3 };

function hasDigestFields(value: Readonly<Record<string, unknown>>, fields: readonly string[]): boolean {
  return fields.every((field) => isSemanticDigest(value[field]));
}

const presetIds = ["simple", "standard", "full"] as const;
const textureIds = ["UNISON", "UNISON_TO_SPLIT", "TWO_PART_PARALLEL", "ACCENT_BLOCK", "SUSTAINED_PAD", "SUSPENSION_RELEASE"] as const;

function isPresetId(value: unknown): value is ArrangementPresetId {
  return presetIds.includes(value as ArrangementPresetId);
}

function isCanonicalIdArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(isCanonicalId) && hasUniqueStrings(value);
}

function isDiagnostic(value: unknown): value is Diagnostic {
  if (!isPlainRecord(value)
    || !hasExactKeys(value, ["id", "code", "severity", "messageKo"], ["location", "details"])
    || !isCanonicalId(value.id)
    || !DIAGNOSTIC_CODES.includes(value.code as typeof DIAGNOSTIC_CODES[number])
    || !["info", "warning", "error", "blocking"].includes(String(value.severity))
    || typeof value.messageKo !== "string") return false;
  if (value.location !== undefined) {
    if (!isPlainRecord(value.location)
      || !hasExactKeys(value.location, [], ["range", "phraseId", "sectionOccurrenceId", "sourceEventIds", "trackPlanIds"])
      || (value.location.range !== undefined && !isMusicalRange(value.location.range))
      || (value.location.phraseId !== undefined && !isCanonicalId(value.location.phraseId))
      || (value.location.sectionOccurrenceId !== undefined && !isCanonicalId(value.location.sectionOccurrenceId))
      || (value.location.sourceEventIds !== undefined && !isCanonicalIdArray(value.location.sourceEventIds))
      || (value.location.trackPlanIds !== undefined && !isCanonicalIdArray(value.location.trackPlanIds))) return false;
  }
  return value.details === undefined || (isPlainRecord(value.details)
    && Object.values(value.details).every((item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean"));
}

function isDiagnosticArray(value: unknown): value is readonly Diagnostic[] {
  return Array.isArray(value) && value.every(isDiagnostic);
}

function isChordToneSpec(value: unknown): boolean {
  return isPlainRecord(value)
    && hasExactKeys(value, ["degree", "alteration", "role", "origin"])
    && [1, 2, 3, 4, 5, 6, 7, 9, 11, 13].includes(value.degree as number)
    && [-2, -1, 0, 1, 2].includes(value.alteration as number)
    && ["root", "third", "fifth", "seventh", "color", "suspension"].includes(String(value.role))
    && ["root", "quality", "extension", "addition", "alteration", "suspension"].includes(String(value.origin));
}

function isRateMetric(value: unknown, duration: boolean, extended: boolean): boolean {
  if (!isPlainRecord(value)
    || !hasExactKeys(value, ["numerator", "denominator", "valueBp"], ["unavailableReason"])) return false;
  let denominatorIsZero: boolean;
  if (duration) {
    if (!isCanonicalFraction(value.numerator) || value.numerator.n < 0
      || !isCanonicalFraction(value.denominator) || value.denominator.n < 0) return false;
    denominatorIsZero = value.denominator.n === 0;
  } else {
    if (!Number.isSafeInteger(value.numerator) || (value.numerator as number) < 0
      || !Number.isSafeInteger(value.denominator) || (value.denominator as number) < 0) return false;
    denominatorIsZero = value.denominator === 0;
  }
  if (value.valueBp === null) return value.unavailableReason === "NO_EVALUABLE_ITEMS" && denominatorIsZero;
  return value.unavailableReason === undefined
    && Number.isSafeInteger(value.valueBp)
    && (value.valueBp as number) >= 0
    && (extended || (value.valueBp as number) <= 10_000);
}

function isActivityDirective(value: unknown): boolean {
  if (!isPlainRecord(value) || typeof value.state !== "string") return false;
  if (value.state === "rest") return hasExactKeys(value, ["state"]);
  if (value.state === "lead-derived") return hasExactKeys(value, ["state", "behavior"])
    && ["unison-double", "octave-double"].includes(String(value.behavior));
  if (value.state === "independent-note") return hasExactKeys(value, ["state", "behavior"])
    && value.behavior === "independent-harmony";
  return value.state === "sustain"
    && hasExactKeys(value, ["state", "behavior"])
    && ["sustained-pad", "independent-harmony"].includes(String(value.behavior));
}

function isSectionIntent(value: unknown): boolean {
  if (!isPlainRecord(value)
    || !hasExactKeys(value, ["id", "sectionOccurrenceId", "presetId", "intensityTarget", "grammarRuleIds"])
    || !isCanonicalId(value.id)
    || !isCanonicalId(value.sectionOccurrenceId)
    || !isPresetId(value.presetId)
    || !isCanonicalIdArray(value.grammarRuleIds)
    || !isPlainRecord(value.intensityTarget)
    || !hasExactKeys(value.intensityTarget, ["participationCoverageBp", "harmonicDivergenceCoverageBp", "exactlyTwoPitchCoverageBp", "exactlyThreePitchCoverageBp", "maxHarmonyAttackRatioBp", "registerSpreadRange", "maxActiveVoiceCount"])) return false;
  const bounded = [value.intensityTarget.participationCoverageBp, value.intensityTarget.harmonicDivergenceCoverageBp, value.intensityTarget.exactlyTwoPitchCoverageBp, value.intensityTarget.exactlyThreePitchCoverageBp];
  const spread = value.intensityTarget.registerSpreadRange;
  return bounded.every((item) => Number.isSafeInteger(item) && (item as number) >= 0 && (item as number) <= 10_000)
    && Number.isSafeInteger(value.intensityTarget.maxHarmonyAttackRatioBp)
    && (value.intensityTarget.maxHarmonyAttackRatioBp as number) >= 0
    && Array.isArray(spread) && spread.length === 2 && spread.every(Number.isSafeInteger) && spread[0] <= spread[1]
    && [1, 2, 3].includes(value.intensityTarget.maxActiveVoiceCount as number);
}

function isPhraseIntent(value: unknown): boolean {
  if (!isPlainRecord(value)
    || !hasExactKeys(value, ["id", "phraseId", "presetId", "sectionIntentId", "textureId", "trackRoles", "lyricPolicy", "cadencePolicy", "grammarRuleIds"], ["splitDirective"])
    || ![value.id, value.phraseId, value.sectionIntentId].every(isCanonicalId)
    || !isPresetId(value.presetId)
    || !textureIds.includes(value.textureId as typeof textureIds[number])
    || !["same-lyrics", "hold-current-vowel", "no-new-lyric"].includes(String(value.lyricPolicy))
    || !["open", "closed", "looping"].includes(String(value.cadencePolicy))
    || !isCanonicalIdArray(value.grammarRuleIds)
    || !Array.isArray(value.trackRoles)
    || !value.trackRoles.every((role) => isPlainRecord(role)
      && hasExactKeys(role, ["id", "phraseId", "trackPlanId", "placementRole"])
      && [role.id, role.phraseId, role.trackPlanId].every(isCanonicalId)
      && ["upper", "lower"].includes(String(role.placementRole)))) return false;
  return value.splitDirective === undefined || (isPlainRecord(value.splitDirective)
    && hasExactKeys(value.splitDirective, ["position", "reasonCode"])
    && isMusicalPosition(value.splitDirective.position)
    && ["LATE_LONG_NOTE", "LATE_CHORD_CHANGE", "CONFIRMED_LYRIC_EMPHASIS", "PHRASE_MIDPOINT"].includes(String(value.splitDirective.reasonCode)));
}

function isPhraseActivityPlan(value: unknown): boolean {
  if (!isPlainRecord(value)
    || !hasExactKeys(value, ["id", "phraseId", "intentId", "activitySpans", "attackEvents", "realizedMetrics"])
    || ![value.id, value.phraseId, value.intentId].every(isCanonicalId)
    || !Array.isArray(value.activitySpans)
    || !value.activitySpans.every((span) => isPlainRecord(span)
      && hasExactKeys(span, ["id", "trackPlanId", "range", "activity"])
      && isCanonicalId(span.id) && isCanonicalId(span.trackPlanId)
      && isMusicalRange(span.range) && isActivityDirective(span.activity))
    || !Array.isArray(value.attackEvents)
    || !value.attackEvents.every((event) => isPlainRecord(event)
      && hasExactKeys(event, ["id", "trackPlanId", "position", "kind"])
      && isCanonicalId(event.id) && isCanonicalId(event.trackPlanId)
      && isMusicalPosition(event.position)
      && ["attack", "release", "reentry"].includes(String(event.kind)))
    || !isPlainRecord(value.realizedMetrics)
    || !hasExactKeys(value.realizedMetrics, ["participationCoverage", "harmonyAttackRatio", "harmonyOverLeadRestCoverage", "maxSimultaneousHarmonyTracks"])) return false;
  return isRateMetric(value.realizedMetrics.participationCoverage, true, false)
    && isRateMetric(value.realizedMetrics.harmonyAttackRatio, false, true)
    && isRateMetric(value.realizedMetrics.harmonyOverLeadRestCoverage, true, false)
    && [0, 1, 2].includes(value.realizedMetrics.maxSimultaneousHarmonyTracks as number);
}

function isAnchorDirective(value: unknown): boolean {
  if (!isPlainRecord(value)
    || ![value.id, value.trackPlanId].every(isCanonicalId)
    || !isMusicalPosition(value.position)) return false;
  if (value.kind === "chord-tone") return hasExactKeys(value, ["kind", "id", "trackPlanId", "position", "chordSpanId", "selectedTone"])
    && isCanonicalId(value.chordSpanId) && isChordToneSpec(value.selectedTone);
  if (value.kind === "planned-nct") return hasExactKeys(value, ["kind", "id", "trackPlanId", "position", "contextChordSpanId", "nctPlanId"])
    && isCanonicalId(value.contextChordSpanId) && isCanonicalId(value.nctPlanId);
  return value.kind === "lead-derived"
    && hasExactKeys(value, ["kind", "id", "trackPlanId", "position", "leadAtom", "relation"])
    && isPlainRecord(value.leadAtom)
    && hasExactKeys(value.leadAtom, ["sourceLeadAtomizationDigest", "leadAtomId"])
    && isSemanticDigest(value.leadAtom.sourceLeadAtomizationDigest)
    && isCanonicalId(value.leadAtom.leadAtomId)
    && ["unison", "octave"].includes(String(value.relation));
}

function isNctPlan(value: unknown): boolean {
  if (!isPlainRecord(value)
    || ![value.id, value.trackPlanId, value.contextChordSpanId, value.targetChordSpanId, value.resolutionDirectiveId].every(isCanonicalId)
    || !isCanonicalId(value.preparationDirectiveId)
    || !isMusicalPosition(value.position)
    || !isMusicalPosition(value.resolutionDeadline)) return false;
  const base = ["id", "trackPlanId", "position", "contextChordSpanId", "targetChordSpanId", "resolutionDirectiveId", "resolutionDeadline", "preparationDirectiveId", "kind"];
  if (value.kind === "passing" || value.kind === "neighbor") return hasExactKeys(value, [...base, "direction"])
    && ["up", "down"].includes(String(value.direction));
  if (value.kind === "suspension") return hasExactKeys(value, [...base, "resolutionDirection"])
    && ["up", "down"].includes(String(value.resolutionDirection));
  return value.kind === "anticipation" && hasExactKeys(value, base);
}

function isPhraseAnchorPlan(value: unknown): boolean {
  if (!isPlainRecord(value)
    || !hasExactKeys(value, ["id", "phraseId", "activityPlanId", "anchorDirectives", "nctPlans"])
    || ![value.id, value.phraseId, value.activityPlanId].every(isCanonicalId)
    || !Array.isArray(value.anchorDirectives)
    || !value.anchorDirectives.every(isAnchorDirective)
    || !Array.isArray(value.nctPlans)
    || !value.nctPlans.every(isNctPlan)
    || !hasUniqueStrings(value.anchorDirectives.map((item) => (item as Readonly<Record<string, unknown>>).id as string))
    || !hasUniqueStrings(value.nctPlans.map((item) => (item as Readonly<Record<string, unknown>>).id as string))) return false;
  const directives = value.anchorDirectives as readonly Readonly<Record<string, unknown>>[];
  const ncts = value.nctPlans as readonly Readonly<Record<string, unknown>>[];
  const directiveById = new Map(directives.map((item) => [item.id as string, item]));
  const nctById = new Map(ncts.map((item) => [item.id as string, item]));
  const planned = directives.filter((item) => item.kind === "planned-nct");
  if (planned.length !== ncts.length
    || !hasUniqueStrings(planned.map((item) => item.nctPlanId as string))
    || planned.some((item) => !nctById.has(item.nctPlanId as string))) return false;
  for (const directive of planned) {
    const nct = nctById.get(directive.nctPlanId as string);
    if (!nct
      || nct.trackPlanId !== directive.trackPlanId
      || nct.contextChordSpanId !== directive.contextChordSpanId
      || comparePositions(nct.position as MusicalPosition, directive.position as MusicalPosition) !== 0) return false;
  }
  return ncts.every((nct) => {
    const preparation = directiveById.get(nct.preparationDirectiveId as string);
    const resolution = directiveById.get(nct.resolutionDirectiveId as string);
    return preparation !== undefined && resolution !== undefined
      && preparation.kind !== "planned-nct" && resolution.kind !== "planned-nct"
      && preparation.trackPlanId === nct.trackPlanId && resolution.trackPlanId === nct.trackPlanId
      && comparePositions(preparation.position as MusicalPosition, nct.position as MusicalPosition) < 0
      && comparePositions(nct.position as MusicalPosition, resolution.position as MusicalPosition) < 0
      && comparePositions(resolution.position as MusicalPosition, nct.resolutionDeadline as MusicalPosition) <= 0;
  });
}

function isIntentPlan(value: unknown): value is ArrangementIntentPlan {
  if (!(isPlainRecord(value)
    && hasExactKeys(value, ["stage", "presetId", "intentInputDigest", "effectiveChordTimelineDigest", "sourceLeadAtomizationDigest", "effectiveConfigDigest", "presetProfileVersion", "presetProfileDigest", "grammarId", "grammarVersion", "plannerVersion", "grammarConfigDigest", "plannerConfigDigest", "diagnosticRegistryVersion", "diagnosticRegistryDigest", "sectionIntents", "phraseIntents", "intentPlanDigest"], ["grammarTrace"])
    && value.stage === "intent"
    && isPresetId(value.presetId)
    && value.grammarId === "worship-arrangement-grammar-v1"
    && hasDigestFields(value, ["intentInputDigest", "effectiveChordTimelineDigest", "sourceLeadAtomizationDigest", "effectiveConfigDigest", "presetProfileDigest", "grammarConfigDigest", "plannerConfigDigest", "diagnosticRegistryDigest", "intentPlanDigest"])
    && [value.presetProfileVersion, value.grammarVersion, value.plannerVersion, value.diagnosticRegistryVersion].every((item) => typeof item === "string" && item.length > 0)
    && Array.isArray(value.sectionIntents)
    && value.sectionIntents.every(isSectionIntent)
    && Array.isArray(value.phraseIntents)
    && value.phraseIntents.every(isPhraseIntent))) return false;
  if (!hasUniqueStrings(value.sectionIntents.map((item) => (item as Readonly<Record<string, unknown>>).id as string))
    || !hasUniqueStrings(value.phraseIntents.map((item) => (item as Readonly<Record<string, unknown>>).id as string))
    || value.sectionIntents.some((item) => (item as Readonly<Record<string, unknown>>).presetId !== value.presetId)
    || value.phraseIntents.some((item) => (item as Readonly<Record<string, unknown>>).presetId !== value.presetId)) return false;
  const sectionIntentIds = new Set(value.sectionIntents.map((item) => (item as Readonly<Record<string, unknown>>).id));
  if (value.phraseIntents.some((item) => {
    const phrase = item as Readonly<Record<string, unknown>>;
    return !sectionIntentIds.has(phrase.sectionIntentId)
      || (phrase.trackRoles as readonly Readonly<Record<string, unknown>>[]).some((role) => role.phraseId !== phrase.phraseId);
  })) return false;
  if (value.grammarTrace === undefined) return true;
  return isPlainRecord(value.grammarTrace)
    && hasExactKeys(value.grammarTrace, ["grammarVersion", "candidatesByPhraseId"])
    && typeof value.grammarTrace.grammarVersion === "string"
    && isPlainRecord(value.grammarTrace.candidatesByPhraseId)
    && Object.values(value.grammarTrace.candidatesByPhraseId).every((candidates) => Array.isArray(candidates)
      && candidates.every((candidate) => isPlainRecord(candidate)
        && hasExactKeys(candidate, ["id", "phraseId", "presetId", "textureId", "eligible", "score", "reasonCodes"])
        && isCanonicalId(candidate.id) && isCanonicalId(candidate.phraseId)
        && isPresetId(candidate.presetId)
        && textureIds.includes(candidate.textureId as typeof textureIds[number])
        && typeof candidate.eligible === "boolean"
        && Number.isSafeInteger(candidate.score) && (candidate.score as number) >= 0
        && isCanonicalIdArray(candidate.reasonCodes)));
}

function isActivityPlan(value: unknown): value is ArrangementActivityPlan {
  return isPlainRecord(value)
    && hasExactKeys(value, ["stage", "presetId", "intentPlanDigest", "activityInputDigest", "activityPlannerVersion", "activityPlannerConfigDigest", "diagnosticRegistryVersion", "diagnosticRegistryDigest", "sourceLeadAtomizationDigest", "effectiveConfigDigest", "presetProfileDigest", "phraseActivityPlans", "activityPlanDigest"])
    && value.stage === "activity-realized"
    && isPresetId(value.presetId)
    && hasDigestFields(value, ["intentPlanDigest", "activityInputDigest", "activityPlannerConfigDigest", "diagnosticRegistryDigest", "sourceLeadAtomizationDigest", "effectiveConfigDigest", "presetProfileDigest", "activityPlanDigest"])
    && typeof value.activityPlannerVersion === "string"
    && typeof value.diagnosticRegistryVersion === "string"
    && Array.isArray(value.phraseActivityPlans)
    && value.phraseActivityPlans.every(isPhraseActivityPlan)
    && hasUniqueStrings(value.phraseActivityPlans.map((item) => (item as Readonly<Record<string, unknown>>).id as string));
}

function isAnchorPlan(value: unknown): value is ArrangementAnchorPlan {
  return isPlainRecord(value)
    && hasExactKeys(value, ["stage", "presetId", "activityPlanDigest", "anchorInputDigest", "anchorPlannerVersion", "anchorPlannerConfigDigest", "diagnosticRegistryVersion", "diagnosticRegistryDigest", "sourceLeadAtomizationDigest", "effectiveConfigDigest", "presetProfileDigest", "phraseAnchorPlans", "anchorPlanDigest"])
    && value.stage === "anchor-realized"
    && isPresetId(value.presetId)
    && hasDigestFields(value, ["activityPlanDigest", "anchorInputDigest", "anchorPlannerConfigDigest", "diagnosticRegistryDigest", "sourceLeadAtomizationDigest", "effectiveConfigDigest", "presetProfileDigest", "anchorPlanDigest"])
    && typeof value.anchorPlannerVersion === "string"
    && typeof value.diagnosticRegistryVersion === "string"
    && Array.isArray(value.phraseAnchorPlans)
    && value.phraseAnchorPlans.every(isPhraseAnchorPlan)
    && hasUniqueStrings(value.phraseAnchorPlans.map((item) => (item as Readonly<Record<string, unknown>>).id as string))
    && value.phraseAnchorPlans.every((phrase) => (phrase as Readonly<Record<string, unknown>>).anchorDirectives !== undefined
      && ((phrase as Readonly<Record<string, unknown>>).anchorDirectives as readonly Readonly<Record<string, unknown>>[]).every((directive) => directive.kind !== "lead-derived"
        || (isPlainRecord(directive.leadAtom) && directive.leadAtom.sourceLeadAtomizationDigest === value.sourceLeadAtomizationDigest)));
}

function isGeneratedEvent(value: unknown): boolean {
  if (!isPlainRecord(value) || !isCanonicalId(value.id) || !isMusicalRange(value.range)) return false;
  if (value.kind === "rest") return hasExactKeys(value, ["kind", "id", "range"]);
  return value.kind === "note"
    && hasExactKeys(value, ["kind", "id", "range", "pitch", "tieStart", "tieStop", "lyricTokenIds", "source"], ["originDirectiveId"])
    && isCanonicalSpelledPitch(value.pitch)
    && typeof value.tieStart === "boolean"
    && typeof value.tieStop === "boolean"
    && isCanonicalIdArray(value.lyricTokenIds)
    && ["unison", "octave-double", "anchor", "connection", "planned-nct", "user-edit"].includes(String(value.source))
    && (value.originDirectiveId === undefined || isCanonicalId(value.originDirectiveId));
}

function isRealizedAnchor(value: unknown): boolean {
  return isPlainRecord(value)
    && hasExactKeys(value, ["directiveId", "trackPlanId", "position", "pitch"])
    && isCanonicalId(value.directiveId)
    && isCanonicalId(value.trackPlanId)
    && isMusicalPosition(value.position)
    && isCanonicalSpelledPitch(value.pitch);
}

function isTextureDensityMetrics(value: unknown): boolean {
  return isPlainRecord(value)
    && hasExactKeys(value, ["participationCoverage", "harmonyAttackRatio", "harmonyOverLeadRestCoverage", "maxSimultaneousHarmonyTracks", "harmonicDivergenceCoverage", "exactlyTwoPitchCoverage", "exactlyThreePitchCoverage", "medianRegisterSpreadSemitones"])
    && isRateMetric(value.participationCoverage, true, false)
    && isRateMetric(value.harmonyAttackRatio, false, true)
    && isRateMetric(value.harmonyOverLeadRestCoverage, true, false)
    && [0, 1, 2].includes(value.maxSimultaneousHarmonyTracks as number)
    && isRateMetric(value.harmonicDivergenceCoverage, true, false)
    && isRateMetric(value.exactlyTwoPitchCoverage, true, false)
    && isRateMetric(value.exactlyThreePitchCoverage, true, false)
    && Number.isSafeInteger(value.medianRegisterSpreadSemitones)
    && (value.medianRegisterSpreadSemitones as number) >= 0;
}

function isFullSongMetrics(value: unknown): boolean {
  return isPlainRecord(value)
    && hasExactKeys(value, ["densityBySectionOccurrence", "maxLeapSemitonesByTrack", "hardDiagnosticCount", "plannedNctResolution", "sourceChordRespect"])
    && isPlainRecord(value.densityBySectionOccurrence)
    && Object.entries(value.densityBySectionOccurrence).every(([id, metric]) => isCanonicalId(id) && isTextureDensityMetrics(metric))
    && isPlainRecord(value.maxLeapSemitonesByTrack)
    && Object.entries(value.maxLeapSemitonesByTrack).every(([id, amount]) => isCanonicalId(id) && Number.isSafeInteger(amount) && (amount as number) >= 0)
    && Number.isSafeInteger(value.hardDiagnosticCount)
    && (value.hardDiagnosticCount as number) >= 0
    && isRateMetric(value.plannedNctResolution, false, false)
    && isRateMetric(value.sourceChordRespect, false, false);
}

function isArrangementCandidate(value: unknown): boolean {
  if (!isPlainRecord(value)
    || !hasExactKeys(value, ["id", "presetId", "candidateStatus", "anchorPlanDigest", "effectiveConfigDigest", "presetProfileDigest", "effectiveChordTimelineDigest", "sourceLeadAtomizationDigest", "generatedEventsByTrack", "realizedAnchors", "metrics", "diagnostics", "canonicalPathKey", "contentDigest"])
    || !isCanonicalId(value.id)
    || !isPresetId(value.presetId)
    || !["complete", "partial"].includes(String(value.candidateStatus))
    || !hasDigestFields(value, ["anchorPlanDigest", "effectiveConfigDigest", "presetProfileDigest", "effectiveChordTimelineDigest", "sourceLeadAtomizationDigest", "contentDigest"])
    || !isPlainRecord(value.generatedEventsByTrack)
    || !Object.entries(value.generatedEventsByTrack).every(([trackId, events]) => isCanonicalId(trackId)
      && Array.isArray(events) && events.every(isGeneratedEvent)
      && hasUniqueStrings(events.map((event) => (event as Readonly<Record<string, unknown>>).id as string)))
    || !Array.isArray(value.realizedAnchors)
    || !value.realizedAnchors.every(isRealizedAnchor)
    || !isFullSongMetrics(value.metrics)
    || !isDiagnosticArray(value.diagnostics)
    || typeof value.canonicalPathKey !== "string" || value.canonicalPathKey.length === 0) return false;
  return hasUniqueStrings(value.realizedAnchors.map((anchor) => (anchor as Readonly<Record<string, unknown>>).directiveId as string));
}

function isEditedSnapshot(value: unknown): value is EditedArrangementSnapshot {
  if (!isPlainRecord(value)
    || !hasExactKeys(value, ["id", "materializerVersion", "validatorVersion", "validatorConfigDigest", "metricsVersion", "metricConfigDigest", "diagnosticRegistryVersion", "diagnosticRegistryDigest", "effectiveChordTimelineDigest", "sourceLeadAtomizationDigest", "presetId", "baseCandidateId", "baseCandidateDigest", "appliedEditIds", "appliedEditSetDigest", "generatedHarmonyTracks", "realizedAnchors", "metrics", "validationDiagnostics", "status", "contentDigest"])
    || !isCanonicalId(value.id) || !isCanonicalId(value.baseCandidateId) || !isPresetId(value.presetId)
    || ![value.materializerVersion, value.validatorVersion, value.metricsVersion, value.diagnosticRegistryVersion].every((item) => typeof item === "string" && item.length > 0)
    || !hasDigestFields(value, ["validatorConfigDigest", "metricConfigDigest", "diagnosticRegistryDigest", "effectiveChordTimelineDigest", "sourceLeadAtomizationDigest", "baseCandidateDigest", "appliedEditSetDigest", "contentDigest"])
    || !isCanonicalIdArray(value.appliedEditIds)
    || !Array.isArray(value.generatedHarmonyTracks)
    || !value.generatedHarmonyTracks.every((track) => isPlainRecord(track)
      && hasExactKeys(track, ["trackPlanId", "events"])
      && isCanonicalId(track.trackPlanId)
      && Array.isArray(track.events) && track.events.every(isGeneratedEvent))
    || !Array.isArray(value.realizedAnchors) || !value.realizedAnchors.every(isRealizedAnchor)
    || !isFullSongMetrics(value.metrics)
    || !isDiagnosticArray(value.validationDiagnostics)
    || !["valid", "invalid"].includes(String(value.status))) return false;
  return value.status !== "valid" || !value.validationDiagnostics.some((item) => item.severity === "blocking");
}

function isGenerationResult(value: unknown): value is ArrangementGenerationResult {
  if (!isPlainRecord(value)
    || !hasExactKeys(value, ["presetId", "status", "candidates", "diagnostics", "digests", "configDigests", "versions"])
    || !isPresetId(value.presetId)
    || !["blocked", "complete", "partial"].includes(String(value.status))
    || !Array.isArray(value.candidates)
    || !isDiagnosticArray(value.diagnostics)
    || !isPlainRecord(value.digests)
    || !isPlainRecord(value.configDigests)
    || !isPlainRecord(value.versions)) return false;
  return hasExactKeys(value.digests, ["musicalSourceDigest", "effectiveChordTimelineDigest", "sourceLeadAtomizationDigest", "presetProfileDigest", "effectiveConfigDigest", "intentInputDigest", "activityInputDigest", "anchorInputDigest", "generationInputDigest", "intentPlanDigest", "activityPlanDigest", "anchorPlanDigest"])
    && Object.values(value.digests).every(isSemanticDigest)
    && Object.values(value.configDigests).every(isSemanticDigest)
    && Object.values(value.versions).every((item) => typeof item === "string" && item.length > 0)
    && value.candidates.every(isArrangementCandidate)
    && hasUniqueStrings(value.candidates.map((candidate) => (candidate as Readonly<Record<string, unknown>>).id as string))
    && (value.status === "blocked"
      ? value.candidates.length === 0 && value.diagnostics.some((item) => item.severity === "blocking")
      : value.candidates.length > 0
        && !value.diagnostics.some((item) => item.severity === "blocking")
        && (value.status === "complete"
          ? value.candidates.some((candidate) => (candidate as Readonly<Record<string, unknown>>).candidateStatus === "complete")
          : value.candidates.every((candidate) => (candidate as Readonly<Record<string, unknown>>).candidateStatus === "partial")));
}

export function validateArrangementVariant(value: unknown): value is ArrangementVariant {
  if (!isPlainRecord(value)) return false;
  const variant = value;
  if (!["empty", "intent-ready", "activity-ready", "anchor-ready", "generation-attempted"].includes(String(variant.lifecycle))) return false;
  const max = lifecycleMax[variant.lifecycle as ArrangementVariant["lifecycle"]];
  const requiredKeys = ["lifecycle", "presetId", "diagnostics", ...["intentPlan", "activityPlan", "anchorPlan", "generationResult"].slice(0, max + 1)];
  if (variant.lifecycle === "generation-attempted") requiredKeys.push("outputEdits", "editedSnapshots");
  if (!hasExactKeys(variant, requiredKeys, ["staleness", "lastBlockedAttempt", "activeArrangement"])) return false;
  if (!isPresetId(variant.presetId) || !isDiagnosticArray(variant.diagnostics)) return false;
  const required = ["intentPlan", "activityPlan", "anchorPlan", "generationResult"].slice(0, max + 1);
  if (required.some((field) => !(field in variant))) return false;
  const forbidden = ["intentPlan", "activityPlan", "anchorPlan", "generationResult"].slice(max + 1);
  if (forbidden.some((field) => field in variant)) return false;
  if (variant.lifecycle === "generation-attempted" && (!Array.isArray(variant.outputEdits) || !Array.isArray(variant.editedSnapshots))) return false;
  if (max >= 0 && !isIntentPlan(variant.intentPlan)) return false;
  if (max >= 1 && !isActivityPlan(variant.activityPlan)) return false;
  if (max >= 2 && !isAnchorPlan(variant.anchorPlan)) return false;
  if (max >= 3 && (!isGenerationResult(variant.generationResult)
    || !(variant.outputEdits as readonly unknown[]).every(isArrangementOutputEdit)
    || !(variant.editedSnapshots as readonly unknown[]).every(isEditedSnapshot))) return false;
  if (max >= 0 && (variant.intentPlan as ArrangementIntentPlan).presetId !== variant.presetId) return false;
  if (max >= 1 && (variant.activityPlan as ArrangementActivityPlan).presetId !== variant.presetId) return false;
  if (max >= 2 && (variant.anchorPlan as ArrangementAnchorPlan).presetId !== variant.presetId) return false;
  if (max >= 3 && ((variant.generationResult as ArrangementGenerationResult).presetId !== variant.presetId
    || (variant.outputEdits as readonly ArrangementOutputEdit[]).some((edit) => edit.presetId !== variant.presetId)
    || (variant.editedSnapshots as readonly EditedArrangementSnapshot[]).some((snapshot) => snapshot.presetId !== variant.presetId))) return false;
  if (variant.lifecycle === "empty" && variant.staleness !== undefined) return false;
  if (variant.staleness !== undefined) {
    if (!isPlainRecord(variant.staleness)
      || !hasExactKeys(variant.staleness, ["staleFrom", "staleDiagnosticIds", "previousArtifactDigests"])
      || !Array.isArray(variant.staleness.staleDiagnosticIds)
      || !variant.staleness.staleDiagnosticIds.every(isCanonicalId)
      || !hasUniqueStrings(variant.staleness.staleDiagnosticIds)
      || !Array.isArray(variant.staleness.previousArtifactDigests)
      || !variant.staleness.previousArtifactDigests.every(isSemanticDigest)) return false;
    const staleFrom = variant.staleness.staleFrom;
    if (!stages.includes(staleFrom as typeof stages[number]) || stages.indexOf(staleFrom as typeof stages[number]) > max) return false;
  }
  const validatedStaleness = variant.staleness as VariantStaleness | undefined;
  const stageIsFresh = (stage: typeof stages[number]): boolean => validatedStaleness === undefined
    || stages.indexOf(stage) < stages.indexOf(
      validatedStaleness.staleFrom,
    );
  if (max >= 1 && stageIsFresh("activity")) {
    const intent = variant.intentPlan as ArrangementIntentPlan;
    const activity = variant.activityPlan as ArrangementActivityPlan;
    const intentById = new Map(intent.phraseIntents.map((item) => [item.id, item]));
    if (activity.intentPlanDigest !== intent.intentPlanDigest
      || activity.sourceLeadAtomizationDigest !== intent.sourceLeadAtomizationDigest
      || activity.effectiveConfigDigest !== intent.effectiveConfigDigest
      || activity.presetProfileDigest !== intent.presetProfileDigest
      || activity.phraseActivityPlans.some((item) => intentById.get(item.intentId)?.phraseId !== item.phraseId)) return false;
  }
  if (max >= 2 && stageIsFresh("anchor")) {
    const activity = variant.activityPlan as ArrangementActivityPlan;
    const anchor = variant.anchorPlan as ArrangementAnchorPlan;
    const activityById = new Map(activity.phraseActivityPlans.map((item) => [item.id, item]));
    if (anchor.activityPlanDigest !== activity.activityPlanDigest
      || anchor.sourceLeadAtomizationDigest !== activity.sourceLeadAtomizationDigest
      || anchor.effectiveConfigDigest !== activity.effectiveConfigDigest
      || anchor.presetProfileDigest !== activity.presetProfileDigest
      || anchor.phraseAnchorPlans.some((item) => activityById.get(item.activityPlanId)?.phraseId !== item.phraseId)) return false;
  }
  if (max >= 3) {
    const intent = variant.intentPlan as ArrangementIntentPlan;
    const activity = variant.activityPlan as ArrangementActivityPlan;
    const anchor = variant.anchorPlan as ArrangementAnchorPlan;
    const generation = variant.generationResult as ArrangementGenerationResult;
    if (stageIsFresh("generation")
      && (generation.digests.intentPlanDigest !== intent.intentPlanDigest
      || generation.digests.activityPlanDigest !== activity.activityPlanDigest
      || generation.digests.anchorPlanDigest !== anchor.anchorPlanDigest)) return false;
    const edits = variant.outputEdits as readonly ArrangementOutputEdit[];
    const snapshots = variant.editedSnapshots as readonly EditedArrangementSnapshot[];
    if (!hasUniqueStrings(edits.map((edit) => edit.id))
      || !hasUniqueStrings(snapshots.map((snapshot) => snapshot.id))) return false;
    for (const candidate of generation.candidates) {
      const candidateEdits = edits.filter((edit) => edit.baseCandidateId === candidate.id);
      const eventIds = new Set(Object.values(candidate.generatedEventsByTrack).flat().map((event) => event.id));
      if (validateOutputEdits(candidate.id, candidate.contentDigest, eventIds, candidateEdits).length > 0) return false;
    }
    if (edits.some((edit) => !generation.candidates.some((candidate) => candidate.id === edit.baseCandidateId))) return false;
    if (snapshots.some((snapshot) => {
      const candidate = generation.candidates.find((item) => item.id === snapshot.baseCandidateId);
      return !candidate || candidate.contentDigest !== snapshot.baseCandidateDigest
        || snapshot.appliedEditIds.some((editId) => !edits.some((edit) => edit.id === editId && edit.baseCandidateId === candidate.id));
    })) return false;
  }
  if (variant.lastBlockedAttempt !== undefined && (!isPlainRecord(variant.lastBlockedAttempt)
    || !hasExactKeys(variant.lastBlockedAttempt, ["stage", "inputDigest", "diagnostics"])
    || !stages.includes(variant.lastBlockedAttempt.stage as typeof stages[number])
    || !isSemanticDigest(variant.lastBlockedAttempt.inputDigest)
    || !isDiagnosticArray(variant.lastBlockedAttempt.diagnostics)
    || !variant.lastBlockedAttempt.diagnostics.some((item) => item.severity === "blocking"))) return false;
  if (variant.activeArrangement !== undefined) {
    const active = variant.activeArrangement;
    if (variant.lifecycle !== "generation-attempted" || !isPlainRecord(active)) return false;
    if (active.kind === "candidate") {
      if (!hasExactKeys(active, ["kind", "candidateId"]) || !isCanonicalId(active.candidateId)) return false;
      const candidateId = active.candidateId;
      if (!(variant.generationResult as ArrangementGenerationResult).candidates.some((candidate) => candidate.id === candidateId)) return false;
    } else if (active.kind === "edited-snapshot") {
      if (!hasExactKeys(active, ["kind", "snapshotId"]) || !isCanonicalId(active.snapshotId)) return false;
      const snapshotId = active.snapshotId;
      if (!(variant.editedSnapshots as readonly EditedArrangementSnapshot[]).some((snapshot) => snapshot.id === snapshotId)) return false;
    } else return false;
  }
  return true;
}

function isPresetProfile(value: unknown, presetId: ArrangementPresetId): boolean {
  return isPlainRecord(value)
    && hasExactKeys(value, ["presetId", "maxActiveVoiceCount", "maxHarmonyAttackRatioBp", "preferredMaxLeapSemitones", "hardMaxLeapSemitones", "allowSuspension", "allowColorTones", "allowOctaveDouble", "rhythmicComplexity", "maxRoleChangesPerSection", "maxSustainPrimaryPulses"])
    && value.presetId === presetId
    && [1, 2, 3].includes(value.maxActiveVoiceCount as number)
    && Number.isSafeInteger(value.maxHarmonyAttackRatioBp) && (value.maxHarmonyAttackRatioBp as number) >= 0
    && Number.isSafeInteger(value.preferredMaxLeapSemitones) && (value.preferredMaxLeapSemitones as number) >= 0
    && Number.isSafeInteger(value.hardMaxLeapSemitones) && (value.hardMaxLeapSemitones as number) >= (value.preferredMaxLeapSemitones as number)
    && [value.allowSuspension, value.allowColorTones, value.allowOctaveDouble].every((item) => typeof item === "boolean")
    && [0, 1, 2].includes(value.rhythmicComplexity as number)
    && [0, 1, 2].includes(value.maxRoleChangesPerSection as number)
    && Number.isSafeInteger(value.maxSustainPrimaryPulses) && (value.maxSustainPrimaryPulses as number) > 0;
}

function isPresetProfileRegistry(value: unknown): value is PresetProfileRegistry {
  if (!isPlainRecord(value)
    || !hasExactKeys(value, ["presetProfileVersion", "profiles", "presetProfileDigest"])
    || typeof value.presetProfileVersion !== "string" || value.presetProfileVersion.length === 0
    || !isPlainRecord(value.profiles)
    || !hasExactKeys(value.profiles, [...presetIds])
    || !isSemanticDigest(value.presetProfileDigest)) return false;
  const profiles = value.profiles;
  return presetIds.every((presetId) => isPresetProfile(profiles[presetId], presetId));
}

function isPerformerProfile(value: unknown): value is PerformerProfile {
  return isPlainRecord(value)
    && hasExactKeys(value, ["id", "displayName", "hardRange", "comfortableRange"], ["preferredTessitura"])
    && isCanonicalId(value.id)
    && typeof value.displayName === "string" && value.displayName.length > 0
    && isCanonicalPitchRange(value.hardRange)
    && isCanonicalPitchRange(value.comfortableRange)
    && (value.preferredTessitura === undefined || isCanonicalPitchRange(value.preferredTessitura))
    && validatePerformer(value as unknown as PerformerProfile);
}

function isTrackPlan(value: unknown): value is VocalTrackPlan {
  if (!isPlainRecord(value)
    || !hasExactKeys(value, ["kind", "id", "displayLabel", "canonicalOrdinal", "enabled"])
    || !isCanonicalId(value.id)
    || typeof value.displayLabel !== "string" || value.displayLabel.length === 0) return false;
  return value.kind === "source-lead"
    ? value.id === "track:source-lead" && value.canonicalOrdinal === 0 && value.enabled === true
    : value.kind === "generated-harmony"
      && (value.canonicalOrdinal === 1 || value.canonicalOrdinal === 2)
      && typeof value.enabled === "boolean";
}

function isAssignment(value: unknown): value is PerformerTrackAssignment {
  return isPlainRecord(value)
    && hasExactKeys(value, ["trackPlanId", "performerId"])
    && isCanonicalId(value.trackPlanId)
    && isCanonicalId(value.performerId);
}

function isChordResolutionPolicy(value: unknown): boolean {
  return isPlainRecord(value)
    && hasExactKeys(value, ["gapPolicy"])
    && ["carry-until-next", "block-gap"].includes(String(value.gapPolicy));
}

function isChordTimeline(value: unknown): boolean {
  if (!isPlainRecord(value)
    || !hasExactKeys(value, ["sourceChordProjectionDigest", "performanceSequenceDigest", "resolutionPolicy", "chordTimelineResolverVersion", "spans", "digest"])
    || !hasDigestFields(value, ["sourceChordProjectionDigest", "performanceSequenceDigest", "digest"])
    || !isChordResolutionPolicy(value.resolutionPolicy)
    || typeof value.chordTimelineResolverVersion !== "string" || value.chordTimelineResolverVersion.length === 0
    || !Array.isArray(value.spans)) return false;
  return value.spans.every((span) => {
    if (!isPlainRecord(span)
      || !hasExactKeys(span, ["id", "range", "parseResult", "origin"])
      || !isCanonicalId(span.id)
      || !isMusicalRange(span.range)
      || !isChordParseResult(span.parseResult)
      || (span.parseResult.status !== "ok" && span.parseResult.status !== "no-chord")
      || !isPlainRecord(span.origin)) return false;
    if (span.origin.kind === "source-event") return hasExactKeys(span.origin, ["kind", "sourceChordEventId"])
      && isCanonicalId(span.origin.sourceChordEventId);
    return span.origin.kind === "carried"
      && hasExactKeys(span.origin, ["kind", "carrySource", "originatingSourceChordEventId", "previousSpanId"], ["carryTokenSourceChordEventId"])
      && ["explicit-carry-token", "gap-policy"].includes(String(span.origin.carrySource))
      && isCanonicalId(span.origin.originatingSourceChordEventId)
      && isCanonicalId(span.origin.previousSpanId)
      && (span.origin.carryTokenSourceChordEventId === undefined || isCanonicalId(span.origin.carryTokenSourceChordEventId));
  }) && hasUniqueStrings(value.spans.map((span) => (span as Readonly<Record<string, unknown>>).id as string));
}

function isChordTimelineState(value: unknown): value is EffectiveChordTimelineState {
  if (!isPlainRecord(value) || typeof value.status !== "string") return false;
  if (value.status === "unresolved") return hasExactKeys(value, ["status", "resolutionPolicy", "diagnostics"])
    && isChordResolutionPolicy(value.resolutionPolicy) && isDiagnosticArray(value.diagnostics);
  if (value.status === "resolved") return hasExactKeys(value, ["status", "timeline", "diagnostics"])
    && isChordTimeline(value.timeline) && isDiagnosticArray(value.diagnostics);
  if (value.status === "stale") return hasExactKeys(value, ["status", "previousTimeline", "resolutionPolicy", "diagnostics"])
    && isChordTimeline(value.previousTimeline) && isChordResolutionPolicy(value.resolutionPolicy) && isDiagnosticArray(value.diagnostics);
  return value.status === "blocked"
    && hasExactKeys(value, ["status", "resolutionPolicy", "diagnostics"], ["previousTimeline"])
    && isChordResolutionPolicy(value.resolutionPolicy)
    && isDiagnosticArray(value.diagnostics)
    && value.diagnostics.some((item) => item.severity === "blocking")
    && (value.previousTimeline === undefined || isChordTimeline(value.previousTimeline));
}

function isAtomization(value: unknown): boolean {
  if (!isPlainRecord(value)
    || !hasExactKeys(value, ["atomizerVersion", "musicalSourceDigest", "effectiveChordTimelineDigest", "atoms", "digest"])
    || typeof value.atomizerVersion !== "string" || value.atomizerVersion.length === 0
    || !hasDigestFields(value, ["musicalSourceDigest", "effectiveChordTimelineDigest", "digest"])
    || !Array.isArray(value.atoms)
    || !value.atoms.every((atom) => isPlainRecord(atom)
      && hasExactKeys(atom, ["id", "sourceEventId", "range", "pitch", "tiedFromPrevious", "tiedToNext", "lyricTokenIds"])
      && isCanonicalId(atom.id) && isCanonicalId(atom.sourceEventId)
      && isMusicalRange(atom.range)
      && (atom.pitch === null || isCanonicalSpelledPitch(atom.pitch))
      && typeof atom.tiedFromPrevious === "boolean"
      && typeof atom.tiedToNext === "boolean"
      && isCanonicalIdArray(atom.lyricTokenIds))) return false;
  const atoms = value.atoms as readonly unknown[];
  return hasUniqueStrings(atoms.map((atom) => (atom as Readonly<Record<string, unknown>>).id as string))
    && atoms.every((atom, index) => index === 0
      || compareRanges(
        (atoms[index - 1] as Readonly<Record<string, unknown>>).range as MusicalRange,
        (atom as Readonly<Record<string, unknown>>).range as MusicalRange,
      ) <= 0);
}

function isAtomizationState(value: unknown): value is SourceLeadAtomizationState {
  if (!isPlainRecord(value) || typeof value.status !== "string") return false;
  if (value.status === "unresolved") return hasExactKeys(value, ["status"]);
  if (value.status === "resolved") return hasExactKeys(value, ["status", "atomization", "diagnostics"])
    && isAtomization(value.atomization) && isDiagnosticArray(value.diagnostics);
  if (value.status === "stale") return hasExactKeys(value, ["status", "previousAtomization", "diagnostics"])
    && isAtomization(value.previousAtomization) && isDiagnosticArray(value.diagnostics);
  return value.status === "blocked"
    && hasExactKeys(value, ["status", "diagnostics"], ["previousAtomization"])
    && isDiagnosticArray(value.diagnostics)
    && value.diagnostics.some((item) => item.severity === "blocking")
    && (value.previousAtomization === undefined || isAtomization(value.previousAtomization));
}

function isLockedEndpoint(value: unknown): boolean {
  if (!isPlainRecord(value) || !isMusicalPosition(value.position)) return false;
  if (value.kind === "chord-tone") return hasExactKeys(value, ["kind", "position", "chordSpanId", "selectedTone"])
    && isCanonicalId(value.chordSpanId) && isChordToneSpec(value.selectedTone);
  return value.kind === "lead-derived"
    && hasExactKeys(value, ["kind", "position", "leadAtom", "relation"])
    && isPlainRecord(value.leadAtom)
    && hasExactKeys(value.leadAtom, ["sourceLeadAtomizationDigest", "leadAtomId"])
    && isSemanticDigest(value.leadAtom.sourceLeadAtomizationDigest)
    && isCanonicalId(value.leadAtom.leadAtomId)
    && ["unison", "octave"].includes(String(value.relation));
}

function isStageLock(value: unknown, presetId: ArrangementPresetId, stage: keyof VariantStageLocks): boolean {
  if (!isPlainRecord(value) || !isCanonicalId(value.id) || value.presetId !== presetId || !isCanonicalId(value.phraseId)) return false;
  const base = ["id", "presetId", "kind", "phraseId"];
  if (stage === "intent") {
    if (value.kind === "texture") return hasExactKeys(value, [...base, "textureId"])
      && textureIds.includes(value.textureId as typeof textureIds[number]);
    return value.kind === "placement-role"
      && hasExactKeys(value, [...base, "trackPlanId", "placementRole"])
      && isCanonicalId(value.trackPlanId) && ["upper", "lower"].includes(String(value.placementRole));
  }
  if (stage === "activity") return value.kind === "activity"
    && hasExactKeys(value, [...base, "trackPlanId", "range", "activity"])
    && isCanonicalId(value.trackPlanId) && isMusicalRange(value.range) && isActivityDirective(value.activity);
  if (stage === "solver") return value.kind === "pitch"
    && hasExactKeys(value, [...base, "trackPlanId", "position", "pitch"])
    && isCanonicalId(value.trackPlanId) && isMusicalPosition(value.position) && isCanonicalSpelledPitch(value.pitch);
  if (!isCanonicalId(value.trackPlanId) || !isMusicalPosition(value.position)) return false;
  if (value.kind === "anchor-chord-tone") return hasExactKeys(value, [...base, "trackPlanId", "position", "chordSpanId", "selectedTone"])
    && isCanonicalId(value.chordSpanId) && isChordToneSpec(value.selectedTone);
  if (value.kind === "anchor-lead-derived") return hasExactKeys(value, [...base, "trackPlanId", "position", "leadAtom", "relation"])
    && isLockedEndpoint({ kind: "lead-derived", position: value.position, leadAtom: value.leadAtom, relation: value.relation });
  if (value.kind !== "anchor-planned-nct"
    || !hasExactKeys(value, [...base, "trackPlanId", "position", "nctSpec"])
    || !isPlainRecord(value.nctSpec)) return false;
  const nctBase = ["kind", "contextChordSpanId", "targetChordSpanId", "resolution", "resolutionDeadline", "preparation"];
  if (!isCanonicalId(value.nctSpec.contextChordSpanId) || !isCanonicalId(value.nctSpec.targetChordSpanId)
    || !isLockedEndpoint(value.nctSpec.preparation) || !isLockedEndpoint(value.nctSpec.resolution)
    || !isMusicalPosition(value.nctSpec.resolutionDeadline)) return false;
  if (value.nctSpec.kind === "passing" || value.nctSpec.kind === "neighbor") return hasExactKeys(value.nctSpec, [...nctBase, "direction"])
    && ["up", "down"].includes(String(value.nctSpec.direction));
  if (value.nctSpec.kind === "suspension") return hasExactKeys(value.nctSpec, [...nctBase, "resolutionDirection"])
    && ["up", "down"].includes(String(value.nctSpec.resolutionDirection));
  return value.nctSpec.kind === "anticipation" && hasExactKeys(value.nctSpec, nctBase);
}

function isVariantStageLocks(value: unknown, presetId: ArrangementPresetId): value is VariantStageLocks {
  return isPlainRecord(value)
    && hasExactKeys(value, ["intent", "activity", "anchor", "solver"])
    && (["intent", "activity", "anchor", "solver"] as const).every((stage) => Array.isArray(value[stage])
      && value[stage].every((lock) => isStageLock(lock, presetId, stage))
      && hasUniqueStrings(value[stage].map((lock) => (lock as Readonly<Record<string, unknown>>).id as string)));
}

export function isHarmonyProjectShape(value: unknown): value is HarmonyProject {
  if (!isPlainRecord(value)
    || !hasExactKeys(value, ["schemaVersion", "source", "chordTimelineState", "sourceLeadAtomizationState", "presetProfiles", "performers", "trackPlans", "assignments", "settings", "locksByPreset", "variants"], ["selectedPresetId"])
    || value.schemaVersion !== 9
    || !isSongSourceDocument(value.source)
    || !validateArrangementSettings(value.settings)
    || !Array.isArray(value.performers)
    || !Array.isArray(value.trackPlans)
    || !Array.isArray(value.assignments)
    || !value.performers.every(isPerformerProfile)
    || !hasUniqueStrings(value.performers.map((item) => item.id))
    || !value.trackPlans.every(isTrackPlan)
    || !value.assignments.every(isAssignment)
    || !hasUniqueStrings(value.assignments.map((item) => item.trackPlanId))
    || !validateTrackPlans(value.trackPlans as unknown as readonly VocalTrackPlan[])
    || validateAssignments(value.trackPlans as unknown as readonly VocalTrackPlan[], value.performers as unknown as readonly PerformerProfile[], value.assignments as unknown as readonly PerformerTrackAssignment[]).length > 0
    || !isPresetProfileRegistry(value.presetProfiles)
    || !isPlainRecord(value.locksByPreset)
    || !isPlainRecord(value.variants)
    || Object.keys(value.locksByPreset).some((key) => !isPresetId(key))
    || Object.entries(value.locksByPreset).some(([presetId, locks]) => !isVariantStageLocks(locks, presetId as ArrangementPresetId))
    || Object.keys(value.variants).some((key) => !isPresetId(key))
    || (value.selectedPresetId !== undefined && (!isPresetId(value.selectedPresetId)
      || !(value.settings as ArrangementSettings).requestedPresetIds.includes(value.selectedPresetId)))) return false;
  for (const [presetId, variant] of Object.entries(value.variants)) {
    if (!validateArrangementVariant(variant) || variant.presetId !== presetId) return false;
  }
  return isChordTimelineState(value.chordTimelineState)
    && isAtomizationState(value.sourceLeadAtomizationState);
}
export async function validateHarmonyProjectIntegrity(
  project: HarmonyProject,
  expectedExecutionRegistry: AlgorithmExecutionRegistry,
): Promise<HarmonyProjectIntegrityResult> {
  return validateProjectIntegrity(project, expectedExecutionRegistry);
}
export async function validateHarmonyProject(
  value: unknown,
  expectedExecutionRegistry: AlgorithmExecutionRegistry,
): Promise<HarmonyProjectIntegrityResult> {
  if (!isHarmonyProjectShape(value)) {
    return blockedHarmonyProjectIntegrity("HarmonyProject shape validation failed");
  }
  return validateProjectIntegrity(value, expectedExecutionRegistry);
}
export function markVariantStale(variant: ArrangementVariant, staleness: VariantStaleness): ArrangementVariant {
  if (variant.lifecycle === "empty" || stages.indexOf(staleness.staleFrom) > lifecycleMax[variant.lifecycle]) throw new RangeError("GENERATION_RESULT_STATE_INVALID");
  if (variant.lifecycle === "intent-ready") return { ...variant, staleness: { ...staleness, staleFrom: "intent" } };
  if (variant.lifecycle === "activity-ready") return { ...variant, staleness: { ...staleness, staleFrom: staleness.staleFrom as "intent" | "activity" } };
  if (variant.lifecycle === "anchor-ready") return { ...variant, staleness: { ...staleness, staleFrom: staleness.staleFrom as "intent" | "activity" | "anchor" } };
  return { ...variant, staleness };
}
export function preserveBlockedAttempt<T>(variant: ArrangementVariant, stage: VariantBlockedAttempt["stage"], inputDigest: SemanticDigest, result: StageExecutionResult<T>): ArrangementVariant {
  return result.status === "blocked" ? { ...variant, lastBlockedAttempt: { stage, inputDigest, diagnostics: result.diagnostics }, diagnostics: [...variant.diagnostics, ...result.diagnostics] } : variant;
}
