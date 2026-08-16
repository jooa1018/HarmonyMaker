import { resolveEffectiveArrangementConfig, type ArrangementPresetId } from "../domain/config";
import { APPLICATION_ALGORITHM_VERSION_REGISTRY } from "../app/algorithm-version-registry";
import type { Diagnostic } from "../domain/diagnostics";
import { SOURCE_LEAD_TRACK, type GeneratedHarmonyTrackPlan } from "../domain/performer";
import type { ArrangementVariant, HarmonyProject } from "../domain/project";
import type { MusicXmlImportDraft } from "../import/musicxml/types";
import type { QuickReviewAnalysis } from "../import/review/quick-review";
import { loadFrozenWagAuthority } from "../grammar/authority";
import { planWagActivity, planWagAnchor, planWagIntent, type WagLifecycleInput } from "../grammar/lifecycle";
import { executeWagSegmentB, type WagSegmentBExecution } from "../grammar/segment-b";

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
  const input = await wagInputFromProject(project, presetId);
  const execution = await executeWagSegmentB(input);
  if (execution.status === "blocked") return { status: "blocked", project, stage: execution.stage, diagnostics: execution.diagnostics };
  const intent = await planWagIntent(input);
  if (intent.status === "blocked") throw new RangeError("GENERATION_REPLAY_MISMATCH");
  const activity = await planWagActivity(input, intent.value);
  if (activity.status === "blocked") throw new RangeError("GENERATION_REPLAY_MISMATCH");
  const anchor = await planWagAnchor(input, intent.value, activity.value);
  if (anchor.status === "blocked") throw new RangeError("GENERATION_REPLAY_MISMATCH");
  if (intent.value.intentPlanDigest !== execution.generation.result.digests.intentPlanDigest
    || activity.value.activityPlanDigest !== execution.generation.result.digests.activityPlanDigest
    || anchor.value.anchorPlanDigest !== execution.generation.result.digests.anchorPlanDigest) throw new RangeError("GENERATION_REPLAY_MISMATCH");
  const persistedVersionKeys = ["domainSchemaVersion", "digestCodecVersion", "chordParserVersion", "chordTimelineResolverVersion", "performanceExpanderVersion", "sourceLeadAtomizerVersion", "presetProfileVersion", "candidateProjectionVersion", "plannerVersion", "grammarVersion", "activityPlannerVersion", "anchorPlannerVersion", "solverVersion", "assemblerVersion", "validatorVersion", "metricsVersion", "diagnosticRegistryVersion"] as const;
  const persistedConfigKeys = ["solverConfigDigest", "assemblerConfigDigest", "validatorConfigDigest", "metricConfigDigest", "diagnosticRegistryDigest"] as const;
  const persistedGenerationResult = {
    ...execution.generation.result,
    versions: Object.fromEntries(persistedVersionKeys.map((key) => [key, execution.generation.result.versions[key]])),
    configDigests: Object.fromEntries(persistedConfigKeys.map((key) => [key, execution.generation.result.configDigests[key]])),
  };
  const variant: ArrangementVariant = {
    lifecycle: "generation-attempted", presetId,
    intentPlan: intent.value, activityPlan: activity.value, anchorPlan: anchor.value,
    generationResult: persistedGenerationResult, outputEdits: [], editedSnapshots: [],
    ...(execution.generation.defaultCandidateId ? { activeArrangement: { kind: "candidate", candidateId: execution.generation.defaultCandidateId } as const } : {}),
    diagnostics: execution.generation.result.diagnostics,
  };
  const next = { ...project, selectedPresetId: presetId, variants: { ...project.variants, [presetId]: variant } };
  return { status: execution.status, project: next, execution };
}

export function regenerationBoundary(variant: ArrangementVariant): "intent" | "activity" | "anchor" | "generation" | "none" {
  return variant.staleness?.staleFrom ?? "none";
}
