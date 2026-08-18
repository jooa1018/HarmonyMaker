import { resolveEffectiveArrangementConfig, type ArrangementPresetId } from "../domain/config";
import { generateDeterministicAccompaniment } from "../accompaniment/deterministic";
import { APPLICATION_ALGORITHM_VERSION_REGISTRY } from "../app/algorithm-version-registry";
import { semanticDigest, type SemanticDigest } from "../domain/digest/canonical";
import type { Diagnostic } from "../domain/diagnostics";
import { SOURCE_LEAD_TRACK, type GeneratedHarmonyTrackPlan } from "../domain/performer";
import { validateHarmonyProject, type ArrangementVariant, type HarmonyProject } from "../domain/project";
import type { MusicXmlImportDraft } from "../import/musicxml/types";
import type { QuickReviewAnalysis } from "../import/review/quick-review";
import { loadFrozenWagAuthority } from "../grammar/authority";
import { planWagActivity, planWagAnchor, planWagIntent, type WagLifecycleInput } from "../grammar/lifecycle";
import { assembleWagGeneration } from "../grammar/pipeline";
import { buildWagRenderDocument, type WagSegmentBExecution, type WagSegmentBStage } from "../grammar/segment-b";
import { solveWagLocally } from "../grammar/solver";
import { validateWagAssembly } from "../grammar/validator";
import { loadProductExecutionRegistry } from "./registry";

const PRESETS: readonly ArrangementPresetId[] = ["simple", "standard", "full"];
const noLocks = () => ({ intent: [], activity: [], anchor: [], solver: [] } as const);

export type ProductGenerationOutcome =
  | { readonly status: "complete" | "partial"; readonly project: HarmonyProject; readonly execution: Exclude<WagSegmentBExecution, { readonly status: "blocked" }> }
  | { readonly status: "blocked"; readonly project: HarmonyProject; readonly stage: string; readonly diagnostics: readonly Diagnostic[] };

export async function createProjectFromQuickReview(
  draft: MusicXmlImportDraft,
  analysis: QuickReviewAnalysis,
  selectedPresetId: ArrangementPresetId = "standard",
): Promise<HarmonyProject> {
  if (!analysis.state.readyForPlanning || !analysis.source || analysis.chordTimelineState.status !== "resolved" || !analysis.atomization) throw new RangeError("IMPORT_HANDOFF_NOT_READY");
  const authority = await loadFrozenWagAuthority();
  const performers = draft.performerSlots.slice(0, draft.singerCount).map((slot) => slot.profile).filter((profile): profile is NonNullable<typeof profile> => profile !== undefined);
  if (performers.length !== draft.singerCount) throw new RangeError("IMPORT_HANDOFF_NOT_READY");
  const generatedTracks = Array.from({ length: draft.singerCount - 1 }, (_, index): GeneratedHarmonyTrackPlan => ({
    kind: "generated-harmony", id: `track:h${index + 1}`, displayLabel: index === 0 ? "Harmony 1" : "Harmony 2", canonicalOrdinal: (index + 1) as 1 | 2, enabled: true,
  }));
  const trackPlans = [SOURCE_LEAD_TRACK, ...generatedTracks];
  const assignments = trackPlans.map((track, index) => ({ trackPlanId: track.id, performerId: performers[index].id }));
  const variants = Object.fromEntries(PRESETS.map((presetId) => [presetId, { lifecycle: "empty", presetId, diagnostics: [] }])) as HarmonyProject["variants"];
  const locksByPreset = Object.fromEntries(PRESETS.map((presetId) => [presetId, noLocks()])) as HarmonyProject["locksByPreset"];
  return {
    schemaVersion: 9,
    source: analysis.source,
    chordTimelineState: analysis.chordTimelineState,
    sourceLeadAtomizationState: { status: "resolved", atomization: analysis.atomization, diagnostics: [] },
    presetProfiles: authority.presetProfiles,
    performers, trackPlans, assignments,
    settings: {
      mode: { profileId: "worship-band-v1", harmonicContext: "band-supported" },
      requestedPresetIds: PRESETS,
      userCaps: { maxHarmonyTracks: generatedTracks.length as 0 | 1 | 2, allowOctaveDouble: true },
    },
    locksByPreset, variants, selectedPresetId,
  };
}

export async function wagInputFromProject(project: HarmonyProject, presetId: ArrangementPresetId): Promise<WagLifecycleInput> {
  if (project.chordTimelineState.status !== "resolved" || project.sourceLeadAtomizationState.status !== "resolved") throw new RangeError("PROJECT_AUTHORITY_STALE");
  const enabledAssignedHarmonyTrackCount = project.trackPlans.filter((track) => track.kind === "generated-harmony" && track.enabled && project.assignments.some((assignment) => assignment.trackPlanId === track.id)).length;
  const effectiveConfig = await resolveEffectiveArrangementConfig({
    registry: project.presetProfiles,
    expectedPresetProfileVersion: APPLICATION_ALGORITHM_VERSION_REGISTRY.presetProfileVersion,
    mode: project.settings.mode, presetId, userCaps: project.settings.userCaps,
    assignedEnabledHarmonyTrackCount: enabledAssignedHarmonyTrackCount,
  });
  return {
    source: project.source,
    effectiveChordTimeline: project.chordTimelineState.timeline,
    sourceLeadAtomization: project.sourceLeadAtomizationState.atomization,
    effectiveConfig, userCaps: project.settings.userCaps,
    performers: project.performers, trackPlans: project.trackPlans, assignments: project.assignments,
    locks: project.locksByPreset[presetId] ?? noLocks(),
  };
}

export async function generateProjectVariant(project: HarmonyProject, presetId: ArrangementPresetId): Promise<ProductGenerationOutcome> {
  const integrity = await validateHarmonyProject(project, await loadProductExecutionRegistry());
  if (integrity.status !== "complete") throw new RangeError("PROJECT_INTEGRITY_INVALID");
  const input = await wagInputFromProject(project, presetId);
  const previous = project.variants[presetId] ?? { lifecycle: "empty" as const, presetId, diagnostics: [] };
  const boundary = previous.staleness?.staleFrom ?? "intent";
  const fallbackDigest = async (stage: "intent" | "activity" | "anchor" | "generation"): Promise<SemanticDigest> => semanticDigest({
    projectionSchema: "hm-blocked-product-attempt-input-v1", stage,
    musicalSourceDigest: input.source.revisionDigest,
    effectiveChordTimelineDigest: input.effectiveChordTimeline.digest,
    sourceLeadAtomizationDigest: input.sourceLeadAtomization.digest,
    effectiveConfigDigest: input.effectiveConfig.digest,
  });
  const blockedProject = async (stage: WagSegmentBStage, diagnostics: readonly Diagnostic[], knownDigest?: SemanticDigest): Promise<ProductGenerationOutcome> => {
    const projectStage = stage === "intent" || stage === "activity" || stage === "anchor" ? stage : "generation";
    const inputDigest = knownDigest ?? await fallbackDigest(projectStage);
    const nextVariant = { ...previous, lastBlockedAttempt: { stage: projectStage, inputDigest, diagnostics }, diagnostics: [...previous.diagnostics, ...diagnostics] } as ArrangementVariant;
    const next = { ...project, variants: { ...project.variants, [presetId]: nextVariant } };
    return { status: "blocked", project: next, stage, diagnostics };
  };

  let intentPlan = previous.lifecycle !== "empty" && boundary !== "intent" ? previous.intentPlan : undefined;
  if (!intentPlan) {
    const result = await planWagIntent(input);
    if (result.status === "blocked") return blockedProject("intent", result.diagnostics, previous.lifecycle !== "empty" ? previous.intentPlan.intentInputDigest : undefined);
    intentPlan = result.value;
  }
  let activityPlan = previous.lifecycle !== "empty" && previous.lifecycle !== "intent-ready" && boundary !== "intent" && boundary !== "activity" ? previous.activityPlan : undefined;
  if (!activityPlan) {
    const result = await planWagActivity(input, intentPlan);
    if (result.status === "blocked") return blockedProject("activity", result.diagnostics, previous.lifecycle !== "empty" && previous.lifecycle !== "intent-ready" ? previous.activityPlan.activityInputDigest : undefined);
    activityPlan = result.value;
  }
  let anchorPlan = previous.lifecycle === "anchor-ready" || previous.lifecycle === "generation-attempted"
    ? boundary === "anchor" || boundary === "activity" || boundary === "intent" ? undefined : previous.anchorPlan
    : undefined;
  if (!anchorPlan) {
    const result = await planWagAnchor(input, intentPlan, activityPlan);
    if (result.status === "blocked") return blockedProject("anchor", result.diagnostics, previous.lifecycle === "anchor-ready" || previous.lifecycle === "generation-attempted" ? previous.anchorPlan.anchorInputDigest : undefined);
    anchorPlan = result.value;
  }
  const solver = await solveWagLocally(input, intentPlan, activityPlan, anchorPlan);
  if (solver.status === "blocked") return blockedProject("solver", solver.diagnostics, previous.lifecycle === "generation-attempted" ? previous.generationResult.digests.generationInputDigest : undefined);
  const generation = await assembleWagGeneration(input, intentPlan, activityPlan, anchorPlan, solver.value);
  if (generation.result.status === "blocked") return blockedProject("assembly", generation.result.diagnostics, generation.result.digests.generationInputDigest);
  const validation = await validateWagAssembly(input, intentPlan, activityPlan, anchorPlan, generation.result);
  if (!validation.valid) return blockedProject("validation", validation.diagnostics, generation.result.digests.generationInputDigest);
  const accompaniment = await generateDeterministicAccompaniment(input.effectiveChordTimeline);
  const selected = generation.result.candidates.find((candidate) => candidate.id === generation.defaultCandidateId);
  if (!selected) throw new RangeError("GENERATION_RESULT_STATE_INVALID");
  const execution: Exclude<WagSegmentBExecution, { readonly status: "blocked" }> = {
    status: generation.result.status, generation, validation, accompaniment,
    renderDocument: buildWagRenderDocument(input, selected),
  };
  const persistedVersionKeys = ["domainSchemaVersion", "digestCodecVersion", "chordParserVersion", "chordTimelineResolverVersion", "performanceExpanderVersion", "sourceLeadAtomizerVersion", "presetProfileVersion", "candidateProjectionVersion", "plannerVersion", "grammarVersion", "activityPlannerVersion", "anchorPlannerVersion", "solverVersion", "assemblerVersion", "validatorVersion", "metricsVersion", "diagnosticRegistryVersion"] as const;
  const persistedConfigKeys = ["solverConfigDigest", "assemblerConfigDigest", "validatorConfigDigest", "metricConfigDigest", "diagnosticRegistryDigest"] as const;
  const persistedGenerationResult = {
    ...execution.generation.result,
    versions: Object.fromEntries(persistedVersionKeys.map((key) => [key, execution.generation.result.versions[key]])),
    configDigests: Object.fromEntries(persistedConfigKeys.map((key) => [key, execution.generation.result.configDigests[key]])),
  };
  const retainedEdits = previous.lifecycle === "generation-attempted" ? previous.outputEdits.filter((edit) => generation.result.candidates.some((candidate) => candidate.id === edit.baseCandidateId && candidate.contentDigest === edit.baseCandidateDigest)) : [];
  const retainedSnapshots = previous.lifecycle === "generation-attempted" ? previous.editedSnapshots.filter((snapshot) => generation.result.candidates.some((candidate) => candidate.id === snapshot.baseCandidateId && candidate.contentDigest === snapshot.baseCandidateDigest)) : [];
  const previousActive = previous.lifecycle === "generation-attempted" ? previous.activeArrangement : undefined;
  const activeArrangement = previousActive?.kind === "candidate" && generation.result.candidates.some((candidate) => candidate.id === previousActive.candidateId)
    ? previousActive
    : previousActive?.kind === "edited-snapshot" && retainedSnapshots.some((snapshot) => snapshot.id === previousActive.snapshotId)
      ? previousActive
      : { kind: "candidate" as const, candidateId: selected.id };
  const candidateHarmonyRoles = generation.marginals.flatMap((marginal, index) => marginal.candidate ? [{
    marginalCandidateId: marginal.candidate.id,
    trackPlanId: marginal.track.trackPlanId,
    harmonyRole: index === 0 ? "H1" as const : "H2" as const,
  }] : []);
  const variant: ArrangementVariant = {
    lifecycle: "generation-attempted", presetId,
    intentPlan, activityPlan, anchorPlan,
    generationResult: persistedGenerationResult,
    candidateHarmonyRoles,
    outputEdits: retainedEdits,
    editedSnapshots: retainedSnapshots,
    activeArrangement,
    diagnostics: execution.generation.result.diagnostics,
  };
  const next = { ...project, selectedPresetId: presetId, variants: { ...project.variants, [presetId]: variant } };
  return { status: execution.status, project: next, execution };
}

export function regenerationBoundary(variant: ArrangementVariant): "intent" | "activity" | "anchor" | "generation" | "none" {
  return variant.staleness?.staleFrom ?? "none";
}
