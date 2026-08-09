import { describe, expect, it } from "vitest";
import {
  createPresetProfileRegistry, resolveEffectiveArrangementConfig,
} from "./config";
import type { SemanticDigest } from "./digest/canonical";
import {
  digestActivityPlan, digestAnchorPlan, digestIntentPlan,
  type PlanOrdinalRegistry,
} from "./digest/plans";
import {
  digestActivityInput, digestAnchorInput, digestGenerationInput, digestIntentInput,
} from "./digest/stages";
import { digestMusicalSource } from "./digest/source";
import { buildArrangementCandidate } from "./generation/candidate";
import type { FullSongMetrics } from "./generation/model";
import {
  digestPerformanceSequence, digestSourceChordProjection,
  resolveEffectiveChordTimeline,
} from "./harmony/chord-timeline";
import { fraction } from "./fraction";
import { COMMON_TIME } from "./meter";
import { SOURCE_LEAD_TRACK } from "./performer";
import { pitchRange } from "./pitch";
import {
  isHarmonyProjectShape, validateHarmonyProject, type HarmonyProject,
} from "./project";
import { countRate } from "./rates";
import type { AlgorithmExecutionRegistry } from "./registries";
import { atomizeSourceLead } from "./source/atomization";
import type { SongSourceDocument } from "./source/model";
import {
  computeRevisionHistoryDigest, createSourceIdRemap,
  createSourceRevisionProjection, type SourceRevisionRecord,
} from "./source/revision";
import { musicalRange } from "./time";

const d = (digit: string): SemanticDigest => digit.repeat(64) as SemanticDigest;

const executionRegistry: AlgorithmExecutionRegistry = {
  versions: {
    domainSchemaVersion: "domain-v9",
    digestCodecVersion: "digest-v1",
    chordParserVersion: "chord-parser-v1",
    chordTimelineResolverVersion: "chord-resolver-v1",
    performanceExpanderVersion: "repeat-v1",
    sourceLeadAtomizerVersion: "atomizer-v1",
    presetProfileVersion: "preset-v1",
    candidateProjectionVersion: "candidate-v1",
    plannerVersion: "planner-v1",
    grammarVersion: "grammar-v1",
    activityPlannerVersion: "activity-v1",
    anchorPlannerVersion: "anchor-v1",
    solverVersion: "solver-v1",
    assemblerVersion: "assembler-v1",
    validatorVersion: "validator-v1",
    metricsVersion: "metrics-v1",
    diagnosticRegistryVersion: "diagnostic-v1",
    accompanimentVersion: "accompaniment-v1",
    editMaterializerVersion: "materializer-v1",
    practiceShareCodecVersion: "share-v1",
    omrNormalizerVersion: "omr-v1",
    evidenceMappingVersion: "evidence-v1",
  },
  configDigests: {
    plannerConfigDigest: d("1"),
    grammarConfigDigest: d("2"),
    activityPlannerConfigDigest: d("3"),
    anchorPlannerConfigDigest: d("4"),
    solverConfigDigest: d("5"),
    assemblerConfigDigest: d("6"),
    validatorConfigDigest: d("7"),
    metricConfigDigest: d("8"),
    accompanimentConfigDigest: d("9"),
    diagnosticRegistryDigest: d("a"),
  },
};

async function canonicalSource(): Promise<SongSourceDocument> {
  const measure = {
    id: "sm:0",
    number: 1,
    implicit: false,
    time: COMMON_TIME,
    duration: fraction(4),
    leadEvents: [],
    chordEvents: [],
    lyricTokens: [],
    textEvents: [],
    repeat: { startRepeat: false },
  } as const;
  const sourceWithoutDigest: SongSourceDocument = {
    schemaVersion: 9,
    documentId: "document:fixture",
    revisionOrdinal: 0,
    revisionDigest: d("0"),
    revisionHistory: [],
    revisionHistoryDigest: await computeRevisionHistoryDigest([]),
    title: "Fixture",
    defaultKey: { tonic: { step: "C", alter: 0 }, mode: "major" },
    defaultTempo: { beatUnit: 4, dotted: false, bpm: 80 },
    sourceMeasures: [measure],
    performanceSequence: {
      expanderVersion: executionRegistry.versions.performanceExpanderVersion,
      occurrences: [{
        occurrenceId: "pm:0:0:0",
        sourceMeasureId: measure.id,
        sourceMeasureNumber: 1,
        occurrenceIndexForSource: 0,
        performanceIndex: 0,
        time: COMMON_TIME,
        duration: fraction(4),
      }],
    },
    sectionDefinitions: [{
      id: "sd:0:1:verse:0",
      type: "verse",
      label: "Verse",
      sourceMeasureIds: [measure.id],
      confirmation: "confirmed",
    }],
    sectionOccurrences: [{
      id: "so:0:1:0",
      sectionDefinitionId: "sd:0:1:verse:0",
      occurrenceIndex: 0,
      variant: "base",
      lyricVerseIndex: 1,
      startPerformanceMeasureIndex: 0,
      endPerformanceMeasureIndexExclusive: 1,
    }],
    phraseRegions: [{
      id: "ph:0:0:0/1:1:0/1",
      sectionOccurrenceId: "so:0:1:0",
      range: musicalRange(
        { performanceMeasureIndex: 0, offset: fraction(0) },
        { performanceMeasureIndex: 1, offset: fraction(0) },
      ),
      boundarySource: "section-boundary",
    }],
    rights: { basis: "self-authored", allowedUses: ["generation"] },
  };
  return { ...sourceWithoutDigest, revisionDigest: await digestMusicalSource(sourceWithoutDigest) };
}

async function emptyProject(): Promise<HarmonyProject> {
  const source = await canonicalSource();
  const presetProfiles = await createPresetProfileRegistry(
    executionRegistry.versions.presetProfileVersion,
  );
  const performer = {
    id: "pf:0",
    displayName: "Lead",
    hardRange: pitchRange(
      { step: "C", alter: 0, octave: 3 },
      { step: "C", alter: 0, octave: 5 },
    ),
    comfortableRange: pitchRange(
      { step: "D", alter: 0, octave: 3 },
      { step: "B", alter: 0, octave: 4 },
    ),
  };
  return {
    schemaVersion: 9,
    source,
    chordTimelineState: {
      status: "unresolved",
      resolutionPolicy: { gapPolicy: "block-gap" },
      diagnostics: [],
    },
    sourceLeadAtomizationState: { status: "unresolved" },
    presetProfiles,
    performers: [performer],
    trackPlans: [SOURCE_LEAD_TRACK],
    assignments: [{ trackPlanId: SOURCE_LEAD_TRACK.id, performerId: performer.id }],
    settings: {
      mode: { profileId: "worship-band-v1", harmonicContext: "band-supported" },
      requestedPresetIds: ["simple"],
      userCaps: { maxHarmonyTracks: 0, allowOctaveDouble: false },
    },
    locksByPreset: { simple: { intent: [], activity: [], anchor: [], solver: [] } },
    variants: { simple: { lifecycle: "empty", presetId: "simple", diagnostics: [] } },
    selectedPresetId: "simple",
  };
}

async function generationProject(): Promise<HarmonyProject> {
  const source = await canonicalSource();
  const presetProfiles = await createPresetProfileRegistry(
    executionRegistry.versions.presetProfileVersion,
  );
  const sourceChordProjectionDigest = await digestSourceChordProjection(source.sourceMeasures);
  const performanceSequenceDigest = await digestPerformanceSequence(
    source.performanceSequence,
    source.sourceMeasures,
  );
  const timelineState = await resolveEffectiveChordTimeline({
    sourceMeasures: source.sourceMeasures,
    performanceSequence: source.performanceSequence,
    sourceChordProjectionDigest,
    performanceSequenceDigest,
    policy: { gapPolicy: "block-gap" },
    resolverVersion: executionRegistry.versions.chordTimelineResolverVersion,
    expectedResolverVersion: executionRegistry.versions.chordTimelineResolverVersion,
  });
  if (timelineState.status !== "resolved") throw new Error("fixture timeline failed");
  const atomization = await atomizeSourceLead({
    sourceMeasures: source.sourceMeasures,
    performanceSequence: source.performanceSequence,
    sectionOccurrences: source.sectionOccurrences,
    phraseRegions: source.phraseRegions,
    chordTimeline: timelineState.timeline,
    musicalSourceDigest: source.revisionDigest,
    atomizerVersion: executionRegistry.versions.sourceLeadAtomizerVersion,
  });
  const leadRange = pitchRange(
    { step: "C", alter: 0, octave: 3 },
    { step: "C", alter: 0, octave: 5 },
  );
  const harmonyRange = pitchRange(
    { step: "A", alter: 0, octave: 2 },
    { step: "A", alter: 0, octave: 4 },
  );
  const performers = [
    { id: "pf:0", displayName: "Lead", hardRange: leadRange, comfortableRange: leadRange },
    { id: "pf:1", displayName: "Harmony", hardRange: harmonyRange, comfortableRange: harmonyRange },
  ];
  const trackPlans = [
    SOURCE_LEAD_TRACK,
    { kind: "generated-harmony", id: "track:h1", displayLabel: "Harmony", canonicalOrdinal: 1, enabled: true },
  ] as const;
  const assignments = [
    { trackPlanId: "track:source-lead", performerId: "pf:0" },
    { trackPlanId: "track:h1", performerId: "pf:1" },
  ];
  const settings = {
    mode: { profileId: "worship-band-v1", harmonicContext: "band-supported" },
    requestedPresetIds: ["simple"],
    userCaps: { maxHarmonyTracks: 1, allowOctaveDouble: false },
  } as const;
  const effectiveConfig = await resolveEffectiveArrangementConfig({
    registry: presetProfiles,
    expectedPresetProfileVersion: executionRegistry.versions.presetProfileVersion,
    mode: settings.mode,
    presetId: "simple",
    userCaps: settings.userCaps,
    assignedEnabledHarmonyTrackCount: 1,
  });
  const ordinals: PlanOrdinalRegistry = {
    sectionOccurrenceOrdinalById: { "so:0:1:0": 0 },
    phraseOrdinalById: { "ph:0:0:0/1:1:0/1": 0 },
    trackOrdinalById: { "track:source-lead": 0, "track:h1": 1 },
    leadAtomOrdinalById: {},
    chordSpanOrdinalById: {},
  };
  const intentInputDigest = await digestIntentInput({
    musicalSourceDigest: source.revisionDigest,
    effectiveChordTimelineDigest: timelineState.timeline.digest,
    sourceLeadAtomizationDigest: atomization.digest,
    atomizerVersion: atomization.atomizerVersion,
    performers: performers.map((performer, performerOrdinal) => ({
      performerOrdinal,
      hardRange: performer.hardRange,
      comfortableRange: performer.comfortableRange,
      preferredTessitura: null,
    })),
    tracks: trackPlans.map((track) => ({ trackOrdinal: track.canonicalOrdinal, kind: track.kind, enabled: track.enabled })),
    assignments: [{ trackOrdinal: 0, performerOrdinal: 0 }, { trackOrdinal: 1, performerOrdinal: 1 }],
    mode: settings.mode,
    userCaps: settings.userCaps,
    presetId: "simple",
    effectiveConfigDigest: effectiveConfig.digest,
    presetProfileVersion: presetProfiles.presetProfileVersion,
    presetProfileDigest: presetProfiles.presetProfileDigest,
    locks: [],
    plannerVersion: executionRegistry.versions.plannerVersion,
    grammarVersion: executionRegistry.versions.grammarVersion,
    plannerConfigDigest: executionRegistry.configDigests.plannerConfigDigest,
    grammarConfigDigest: executionRegistry.configDigests.grammarConfigDigest,
    diagnosticRegistryVersion: executionRegistry.versions.diagnosticRegistryVersion,
    diagnosticRegistryDigest: executionRegistry.configDigests.diagnosticRegistryDigest,
  }, ordinals);
  const intentBase = {
    stage: "intent",
    presetId: "simple",
    intentInputDigest,
    effectiveChordTimelineDigest: timelineState.timeline.digest,
    sourceLeadAtomizationDigest: atomization.digest,
    effectiveConfigDigest: effectiveConfig.digest,
    presetProfileVersion: presetProfiles.presetProfileVersion,
    presetProfileDigest: presetProfiles.presetProfileDigest,
    grammarId: "worship-arrangement-grammar-v1",
    grammarVersion: executionRegistry.versions.grammarVersion,
    plannerVersion: executionRegistry.versions.plannerVersion,
    grammarConfigDigest: executionRegistry.configDigests.grammarConfigDigest,
    plannerConfigDigest: executionRegistry.configDigests.plannerConfigDigest,
    diagnosticRegistryVersion: executionRegistry.versions.diagnosticRegistryVersion,
    diagnosticRegistryDigest: executionRegistry.configDigests.diagnosticRegistryDigest,
    sectionIntents: [],
    phraseIntents: [],
    intentPlanDigest: d("0"),
  } as const;
  const intentPlan = { ...intentBase, intentPlanDigest: await digestIntentPlan(intentBase, ordinals) };
  const activityInputDigest = await digestActivityInput({
    intentPlanDigest: intentPlan.intentPlanDigest,
    sourceLeadAtomizationDigest: atomization.digest,
    atomizerVersion: atomization.atomizerVersion,
    effectiveConfigDigest: effectiveConfig.digest,
    presetProfileVersion: presetProfiles.presetProfileVersion,
    presetProfileDigest: presetProfiles.presetProfileDigest,
    locks: [],
    activityPlannerVersion: executionRegistry.versions.activityPlannerVersion,
    activityPlannerConfigDigest: executionRegistry.configDigests.activityPlannerConfigDigest,
    diagnosticRegistryVersion: executionRegistry.versions.diagnosticRegistryVersion,
    diagnosticRegistryDigest: executionRegistry.configDigests.diagnosticRegistryDigest,
  }, ordinals);
  const activityBase = {
    stage: "activity-realized",
    presetId: "simple",
    intentPlanDigest: intentPlan.intentPlanDigest,
    activityInputDigest,
    activityPlannerVersion: executionRegistry.versions.activityPlannerVersion,
    activityPlannerConfigDigest: executionRegistry.configDigests.activityPlannerConfigDigest,
    diagnosticRegistryVersion: executionRegistry.versions.diagnosticRegistryVersion,
    diagnosticRegistryDigest: executionRegistry.configDigests.diagnosticRegistryDigest,
    sourceLeadAtomizationDigest: atomization.digest,
    effectiveConfigDigest: effectiveConfig.digest,
    presetProfileDigest: presetProfiles.presetProfileDigest,
    phraseActivityPlans: [],
    activityPlanDigest: d("0"),
  } as const;
  const activityPlan = { ...activityBase, activityPlanDigest: await digestActivityPlan(activityBase, ordinals) };
  const anchorInputDigest = await digestAnchorInput({
    activityPlanDigest: activityPlan.activityPlanDigest,
    sourceLeadAtomizationDigest: atomization.digest,
    atomizerVersion: atomization.atomizerVersion,
    effectiveConfigDigest: effectiveConfig.digest,
    presetProfileVersion: presetProfiles.presetProfileVersion,
    presetProfileDigest: presetProfiles.presetProfileDigest,
    locks: [],
    anchorPlannerVersion: executionRegistry.versions.anchorPlannerVersion,
    anchorPlannerConfigDigest: executionRegistry.configDigests.anchorPlannerConfigDigest,
    diagnosticRegistryVersion: executionRegistry.versions.diagnosticRegistryVersion,
    diagnosticRegistryDigest: executionRegistry.configDigests.diagnosticRegistryDigest,
  }, ordinals);
  const anchorBase = {
    stage: "anchor-realized",
    presetId: "simple",
    activityPlanDigest: activityPlan.activityPlanDigest,
    anchorInputDigest,
    anchorPlannerVersion: executionRegistry.versions.anchorPlannerVersion,
    anchorPlannerConfigDigest: executionRegistry.configDigests.anchorPlannerConfigDigest,
    diagnosticRegistryVersion: executionRegistry.versions.diagnosticRegistryVersion,
    diagnosticRegistryDigest: executionRegistry.configDigests.diagnosticRegistryDigest,
    sourceLeadAtomizationDigest: atomization.digest,
    effectiveConfigDigest: effectiveConfig.digest,
    presetProfileDigest: presetProfiles.presetProfileDigest,
    phraseAnchorPlans: [],
    anchorPlanDigest: d("0"),
  } as const;
  const anchorPlan = { ...anchorBase, anchorPlanDigest: await digestAnchorPlan(anchorBase, ordinals) };
  const generationInputDigest = await digestGenerationInput({
    anchorPlanDigest: anchorPlan.anchorPlanDigest,
    effectiveConfigDigest: effectiveConfig.digest,
    presetProfileVersion: presetProfiles.presetProfileVersion,
    presetProfileDigest: presetProfiles.presetProfileDigest,
    locks: [],
    solverVersion: executionRegistry.versions.solverVersion,
    assemblerVersion: executionRegistry.versions.assemblerVersion,
    validatorVersion: executionRegistry.versions.validatorVersion,
    metricsVersion: executionRegistry.versions.metricsVersion,
    candidateProjectionVersion: executionRegistry.versions.candidateProjectionVersion,
    solverConfigDigest: executionRegistry.configDigests.solverConfigDigest,
    assemblerConfigDigest: executionRegistry.configDigests.assemblerConfigDigest,
    validatorConfigDigest: executionRegistry.configDigests.validatorConfigDigest,
    metricConfigDigest: executionRegistry.configDigests.metricConfigDigest,
    diagnosticRegistryVersion: executionRegistry.versions.diagnosticRegistryVersion,
    diagnosticRegistryDigest: executionRegistry.configDigests.diagnosticRegistryDigest,
  }, ordinals);
  const metrics: FullSongMetrics = {
    densityBySectionOccurrence: {},
    maxLeapSemitonesByTrack: { "track:h1": 0 },
    hardDiagnosticCount: 0,
    plannedNctResolution: countRate(0, 0),
    sourceChordRespect: countRate(0, 0),
  };
  const candidate = await buildArrangementCandidate({
    presetId: "simple",
    candidateStatus: "complete",
    anchorPlanDigest: anchorPlan.anchorPlanDigest,
    effectiveConfigDigest: effectiveConfig.digest,
    presetProfileDigest: presetProfiles.presetProfileDigest,
    effectiveChordTimelineDigest: timelineState.timeline.digest,
    sourceLeadAtomizationDigest: atomization.digest,
    tracks: [{ trackPlanId: "track:h1", events: [{
      kind: "rest",
      range: source.phraseRegions[0].range,
    }] }],
    realizedAnchors: [],
    ordinals: {
      trackOrdinalById: ordinals.trackOrdinalById,
      lyricOrdinalById: {},
      anchorDirectiveOrdinalById: {},
    },
    metrics,
    diagnostics: [],
    canonicalPathKey: "fixture-path",
  });
  const generationResult = {
    presetId: "simple",
    status: "complete",
    candidates: [candidate],
    diagnostics: [],
    digests: {
      musicalSourceDigest: source.revisionDigest,
      effectiveChordTimelineDigest: timelineState.timeline.digest,
      sourceLeadAtomizationDigest: atomization.digest,
      presetProfileDigest: presetProfiles.presetProfileDigest,
      effectiveConfigDigest: effectiveConfig.digest,
      intentInputDigest,
      activityInputDigest,
      anchorInputDigest,
      generationInputDigest,
      intentPlanDigest: intentPlan.intentPlanDigest,
      activityPlanDigest: activityPlan.activityPlanDigest,
      anchorPlanDigest: anchorPlan.anchorPlanDigest,
    },
    configDigests: {
      solverConfigDigest: executionRegistry.configDigests.solverConfigDigest,
      assemblerConfigDigest: executionRegistry.configDigests.assemblerConfigDigest,
      validatorConfigDigest: executionRegistry.configDigests.validatorConfigDigest,
      metricConfigDigest: executionRegistry.configDigests.metricConfigDigest,
      diagnosticRegistryDigest: executionRegistry.configDigests.diagnosticRegistryDigest,
    },
    versions: {
      domainSchemaVersion: executionRegistry.versions.domainSchemaVersion,
      digestCodecVersion: executionRegistry.versions.digestCodecVersion,
      chordParserVersion: executionRegistry.versions.chordParserVersion,
      chordTimelineResolverVersion: executionRegistry.versions.chordTimelineResolverVersion,
      performanceExpanderVersion: executionRegistry.versions.performanceExpanderVersion,
      sourceLeadAtomizerVersion: executionRegistry.versions.sourceLeadAtomizerVersion,
      presetProfileVersion: executionRegistry.versions.presetProfileVersion,
      candidateProjectionVersion: executionRegistry.versions.candidateProjectionVersion,
      plannerVersion: executionRegistry.versions.plannerVersion,
      grammarVersion: executionRegistry.versions.grammarVersion,
      activityPlannerVersion: executionRegistry.versions.activityPlannerVersion,
      anchorPlannerVersion: executionRegistry.versions.anchorPlannerVersion,
      solverVersion: executionRegistry.versions.solverVersion,
      assemblerVersion: executionRegistry.versions.assemblerVersion,
      validatorVersion: executionRegistry.versions.validatorVersion,
      metricsVersion: executionRegistry.versions.metricsVersion,
      diagnosticRegistryVersion: executionRegistry.versions.diagnosticRegistryVersion,
    },
  } as const;
  return {
    schemaVersion: 9,
    source,
    chordTimelineState: timelineState,
    sourceLeadAtomizationState: { status: "resolved", atomization, diagnostics: [] },
    presetProfiles,
    performers,
    trackPlans,
    assignments,
    settings,
    locksByPreset: { simple: { intent: [], activity: [], anchor: [], solver: [] } },
    variants: { simple: {
      lifecycle: "generation-attempted",
      presetId: "simple",
      diagnostics: [],
      intentPlan,
      activityPlan,
      anchorPlan,
      generationResult,
      outputEdits: [],
      editedSnapshots: [],
    } },
    selectedPresetId: "simple",
  };
}

describe("persisted HarmonyProject integrity gate", () => {
  it("accepts a canonical empty project and rejects a well-shaped forged source digest", async () => {
    const project = await emptyProject();
    expect(isHarmonyProjectShape(project)).toBe(true);
    expect((await validateHarmonyProject(project, executionRegistry)).status).toBe("complete");
    const forged = { ...project, source: { ...project.source, revisionDigest: d("f") } };
    expect(isHarmonyProjectShape(forged)).toBe(true);
    expect((await validateHarmonyProject(forged, executionRegistry)).status).toBe("blocked");
  });

  it("recomputes Candidate content/ID and Generated Event IDs", async () => {
    const project = await generationProject();
    expect(isHarmonyProjectShape(project)).toBe(true);
    expect((await validateHarmonyProject(project, executionRegistry)).status).toBe("complete");
    const variant = project.variants.simple;
    if (!variant || variant.lifecycle !== "generation-attempted") throw new Error("missing fixture variant");
    const candidate = variant.generationResult.candidates[0];
    const forgedCandidateProject = {
      ...project,
      variants: { simple: {
        ...variant,
        generationResult: { ...variant.generationResult, candidates: [{ ...candidate, id: "cand:forged" }] },
      } },
    };
    expect(isHarmonyProjectShape(forgedCandidateProject)).toBe(true);
    expect((await validateHarmonyProject(forgedCandidateProject, executionRegistry)).status).toBe("blocked");
    const events = candidate.generatedEventsByTrack["track:h1"];
    const forgedEventProject = {
      ...project,
      variants: { simple: {
        ...variant,
        generationResult: {
          ...variant.generationResult,
          candidates: [{
            ...candidate,
            generatedEventsByTrack: { "track:h1": [{ ...events[0], id: "gen:forged" }] },
          }],
        },
      } },
    };
    expect(isHarmonyProjectShape(forgedEventProject)).toBe(true);
    expect((await validateHarmonyProject(forgedEventProject, executionRegistry)).status).toBe("blocked");
  });

  it("requires previousRevision to exactly equal the final transition fromRevision", async () => {
    const project = await emptyProject();
    const currentDigest = project.source.revisionDigest;
    const fromRevision = { documentId: project.source.documentId, revisionOrdinal: 0, revisionDigest: d("b") };
    const toRevision = { documentId: project.source.documentId, revisionOrdinal: 1, revisionDigest: currentDigest };
    const idRemap = await createSourceIdRemap(fromRevision, toRevision, []);
    const record: SourceRevisionRecord = {
      id: "ser:0:1:0",
      editOrdinal: 0,
      fromRevision,
      toRevision,
      commandKind: "manual-source-edit",
      beforeProjection: createSourceRevisionProjection("manual-source-edit", { revisionOrdinal: 0 }),
      afterProjection: createSourceRevisionProjection("manual-source-edit", { revisionOrdinal: 1 }),
      idRemap,
    };
    const source = {
      ...project.source,
      revisionOrdinal: 1,
      previousRevision: fromRevision,
      revisionHistory: [record],
      revisionHistoryDigest: await computeRevisionHistoryDigest([record]),
    };
    const valid = { ...project, source };
    expect((await validateHarmonyProject(valid, executionRegistry)).status).toBe("complete");
    const forged = {
      ...valid,
      source: { ...source, previousRevision: { ...fromRevision, revisionDigest: d("c") } },
    };
    expect(isHarmonyProjectShape(forged)).toBe(true);
    expect((await validateHarmonyProject(forged, executionRegistry)).status).toBe("blocked");
  });
});
