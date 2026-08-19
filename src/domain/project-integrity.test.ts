import { describe, expect, it } from "vitest";
import { parseChord } from "./chord/parser";
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
import { computeSourceProvenanceDigest } from "./source/provenance";
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
  isHarmonyProjectShape, validateHarmonyProject, type ArrangementVariant,
  type HarmonyProject,
} from "./project";
import { basisPoints, countRate, extendedBasisPoints } from "./rates";
import type { AlgorithmExecutionRegistry } from "./registries";
import { atomizeSourceLead } from "./source/atomization";
import type { SongSourceDocument } from "./source/model";
import {
  computeRevisionHistoryDigest, createSourceIdRemap,
  createSourceRevisionProjection, type SourceIdRemapEntry,
  type SourceRevisionRecord,
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

function registryWith(overrides: {
  readonly versions?: Partial<AlgorithmExecutionRegistry["versions"]>;
  readonly configDigests?: Partial<AlgorithmExecutionRegistry["configDigests"]>;
}): AlgorithmExecutionRegistry {
  return {
    versions: { ...executionRegistry.versions, ...overrides.versions },
    configDigests: { ...executionRegistry.configDigests, ...overrides.configDigests },
  };
}

async function canonicalSource(): Promise<SongSourceDocument> {
  const measure = {
    id: "sm:0",
    number: 1,
    implicit: false,
    time: COMMON_TIME,
    duration: fraction(4),
    leadEvents: [{
      kind: "note",
      id: "le:0:0",
      sourceMeasureId: "sm:0",
      onset: fraction(0),
      duration: fraction(4),
      pitch: { step: "C", alter: 0, octave: 4 },
      tieStart: false,
      tieStop: false,
      lyricTokenIds: [],
    }],
    chordEvents: [{
      id: "ch:0:0",
      sourceMeasureId: "sm:0",
      onset: fraction(0),
      sourceText: "C",
      parseResult: parseChord("C"),
      source: "manual",
      confirmation: "confirmed",
    }],
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
    sourceProvenanceDigest: d("0"),
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
  return { ...sourceWithoutDigest, revisionDigest: await digestMusicalSource(sourceWithoutDigest), sourceProvenanceDigest: await computeSourceProvenanceDigest(sourceWithoutDigest) };
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

async function generationProject(
  registry: AlgorithmExecutionRegistry = executionRegistry,
): Promise<HarmonyProject> {
  const source = await canonicalSource();
  const presetProfiles = await createPresetProfileRegistry(
    registry.versions.presetProfileVersion,
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
    resolverVersion: registry.versions.chordTimelineResolverVersion,
    expectedResolverVersion: registry.versions.chordTimelineResolverVersion,
  });
  if (timelineState.status !== "resolved") throw new Error("fixture timeline failed");
  const atomization = await atomizeSourceLead({
    sourceMeasures: source.sourceMeasures,
    performanceSequence: source.performanceSequence,
    sectionOccurrences: source.sectionOccurrences,
    phraseRegions: source.phraseRegions,
    chordTimeline: timelineState.timeline,
    musicalSourceDigest: source.revisionDigest,
    atomizerVersion: registry.versions.sourceLeadAtomizerVersion,
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
    expectedPresetProfileVersion: registry.versions.presetProfileVersion,
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
    plannerVersion: registry.versions.plannerVersion,
    grammarVersion: registry.versions.grammarVersion,
    plannerConfigDigest: registry.configDigests.plannerConfigDigest,
    grammarConfigDigest: registry.configDigests.grammarConfigDigest,
    diagnosticRegistryVersion: registry.versions.diagnosticRegistryVersion,
    diagnosticRegistryDigest: registry.configDigests.diagnosticRegistryDigest,
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
    grammarVersion: registry.versions.grammarVersion,
    plannerVersion: registry.versions.plannerVersion,
    grammarConfigDigest: registry.configDigests.grammarConfigDigest,
    plannerConfigDigest: registry.configDigests.plannerConfigDigest,
    diagnosticRegistryVersion: registry.versions.diagnosticRegistryVersion,
    diagnosticRegistryDigest: registry.configDigests.diagnosticRegistryDigest,
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
    activityPlannerVersion: registry.versions.activityPlannerVersion,
    activityPlannerConfigDigest: registry.configDigests.activityPlannerConfigDigest,
    diagnosticRegistryVersion: registry.versions.diagnosticRegistryVersion,
    diagnosticRegistryDigest: registry.configDigests.diagnosticRegistryDigest,
  }, ordinals);
  const activityBase = {
    stage: "activity-realized",
    presetId: "simple",
    intentPlanDigest: intentPlan.intentPlanDigest,
    activityInputDigest,
    activityPlannerVersion: registry.versions.activityPlannerVersion,
    activityPlannerConfigDigest: registry.configDigests.activityPlannerConfigDigest,
    diagnosticRegistryVersion: registry.versions.diagnosticRegistryVersion,
    diagnosticRegistryDigest: registry.configDigests.diagnosticRegistryDigest,
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
    anchorPlannerVersion: registry.versions.anchorPlannerVersion,
    anchorPlannerConfigDigest: registry.configDigests.anchorPlannerConfigDigest,
    diagnosticRegistryVersion: registry.versions.diagnosticRegistryVersion,
    diagnosticRegistryDigest: registry.configDigests.diagnosticRegistryDigest,
  }, ordinals);
  const anchorBase = {
    stage: "anchor-realized",
    presetId: "simple",
    activityPlanDigest: activityPlan.activityPlanDigest,
    anchorInputDigest,
    anchorPlannerVersion: registry.versions.anchorPlannerVersion,
    anchorPlannerConfigDigest: registry.configDigests.anchorPlannerConfigDigest,
    diagnosticRegistryVersion: registry.versions.diagnosticRegistryVersion,
    diagnosticRegistryDigest: registry.configDigests.diagnosticRegistryDigest,
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
    solverVersion: registry.versions.solverVersion,
    assemblerVersion: registry.versions.assemblerVersion,
    validatorVersion: registry.versions.validatorVersion,
    metricsVersion: registry.versions.metricsVersion,
    candidateProjectionVersion: registry.versions.candidateProjectionVersion,
    solverConfigDigest: registry.configDigests.solverConfigDigest,
    assemblerConfigDigest: registry.configDigests.assemblerConfigDigest,
    validatorConfigDigest: registry.configDigests.validatorConfigDigest,
    metricConfigDigest: registry.configDigests.metricConfigDigest,
    diagnosticRegistryVersion: registry.versions.diagnosticRegistryVersion,
    diagnosticRegistryDigest: registry.configDigests.diagnosticRegistryDigest,
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
      solverConfigDigest: registry.configDigests.solverConfigDigest,
      assemblerConfigDigest: registry.configDigests.assemblerConfigDigest,
      validatorConfigDigest: registry.configDigests.validatorConfigDigest,
      metricConfigDigest: registry.configDigests.metricConfigDigest,
      diagnosticRegistryDigest: registry.configDigests.diagnosticRegistryDigest,
    },
    versions: {
      domainSchemaVersion: registry.versions.domainSchemaVersion,
      digestCodecVersion: registry.versions.digestCodecVersion,
      chordParserVersion: registry.versions.chordParserVersion,
      chordTimelineResolverVersion: registry.versions.chordTimelineResolverVersion,
      performanceExpanderVersion: registry.versions.performanceExpanderVersion,
      sourceLeadAtomizerVersion: registry.versions.sourceLeadAtomizerVersion,
      presetProfileVersion: registry.versions.presetProfileVersion,
      candidateProjectionVersion: registry.versions.candidateProjectionVersion,
      plannerVersion: registry.versions.plannerVersion,
      grammarVersion: registry.versions.grammarVersion,
      activityPlannerVersion: registry.versions.activityPlannerVersion,
      anchorPlannerVersion: registry.versions.anchorPlannerVersion,
      solverVersion: registry.versions.solverVersion,
      assemblerVersion: registry.versions.assemblerVersion,
      validatorVersion: registry.versions.validatorVersion,
      metricsVersion: registry.versions.metricsVersion,
      diagnosticRegistryVersion: registry.versions.diagnosticRegistryVersion,
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
      candidateHarmonyRoles: [{ marginalCandidateId: candidate.id, trackPlanId: "track:h1", harmonyRole: "H1" }],
      outputEdits: [],
      editedSnapshots: [],
    } },
    selectedPresetId: "simple",
  };
}

type StaleStage = "intent" | "activity" | "anchor" | "generation";

function generatedVariant(
  project: HarmonyProject,
): Extract<ArrangementVariant, { readonly lifecycle: "generation-attempted" }> {
  const variant = project.variants.simple;
  if (!variant || variant.lifecycle !== "generation-attempted") {
    throw new Error("missing generation fixture variant");
  }
  return variant;
}

function withVariantStaleness(
  project: HarmonyProject,
  staleFrom: StaleStage,
): HarmonyProject {
  const variant = generatedVariant(project);
  return {
    ...project,
    variants: { ...project.variants, simple: {
      ...variant,
      staleness: { staleFrom, staleDiagnosticIds: [], previousArtifactDigests: [] },
    } },
  };
}

function withHistoricalAuthorities(project: HarmonyProject): HarmonyProject {
  if (project.chordTimelineState.status !== "resolved"
    || project.sourceLeadAtomizationState.status !== "resolved") {
    throw new Error("fixture lacks resolved authorities");
  }
  return {
    ...project,
    chordTimelineState: {
      status: "stale",
      previousTimeline: project.chordTimelineState.timeline,
      resolutionPolicy: project.chordTimelineState.timeline.resolutionPolicy,
      diagnostics: [],
    },
    sourceLeadAtomizationState: {
      status: "stale",
      previousAtomization: project.sourceLeadAtomizationState.atomization,
      diagnostics: [],
    },
  };
}

async function revisedSource(
  source: SongSourceDocument,
  sourceMeasures: SongSourceDocument["sourceMeasures"],
  remapEntries: readonly SourceIdRemapEntry[],
): Promise<SongSourceDocument> {
  const fromRevision = {
    documentId: source.documentId,
    revisionOrdinal: source.revisionOrdinal,
    revisionDigest: source.revisionDigest,
  };
  const provisional = {
    ...source,
    revisionOrdinal: source.revisionOrdinal + 1,
    revisionDigest: d("0"),
    sourceMeasures,
    revisionHistory: [],
    revisionHistoryDigest: await computeRevisionHistoryDigest([]),
  } as SongSourceDocument;
  const revisionDigest = await digestMusicalSource(provisional);
  const toRevision = {
    documentId: source.documentId,
    revisionOrdinal: provisional.revisionOrdinal,
    revisionDigest,
  };
  const idRemap = await createSourceIdRemap(fromRevision, toRevision, remapEntries);
  const record: SourceRevisionRecord = {
    id: `ser:${fromRevision.revisionOrdinal}:${toRevision.revisionOrdinal}:0`,
    editOrdinal: 0,
    fromRevision,
    toRevision,
    commandKind: "manual-source-edit",
    beforeProjection: createSourceRevisionProjection("manual-source-edit", {
      revisionOrdinal: fromRevision.revisionOrdinal,
    }),
    afterProjection: createSourceRevisionProjection("manual-source-edit", {
      revisionOrdinal: toRevision.revisionOrdinal,
    }),
    idRemap,
  };
  return {
    ...provisional,
    revisionDigest,
    previousRevision: fromRevision,
    revisionHistory: [record],
    revisionHistoryDigest: await computeRevisionHistoryDigest([record]),
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

  it("preserves a C timeline after a current-source edit to G without making it executable", async () => {
    const r0 = await generationProject();
    if (r0.chordTimelineState.status !== "resolved"
      || r0.sourceLeadAtomizationState.status !== "resolved") {
      throw new Error("missing R0 authority");
    }
    const t0 = r0.chordTimelineState.timeline;
    const a0 = r0.sourceLeadAtomizationState.atomization;
    const sourceMeasures = r0.source.sourceMeasures.map((measure, index) => index === 0
      ? {
          ...measure,
          chordEvents: measure.chordEvents.map((event) => ({
            ...event,
            sourceText: "G",
            parseResult: parseChord("G"),
          })),
        }
      : measure);
    const r1Source = await revisedSource(r0.source, sourceMeasures, [{
      entityKind: "chord-event",
      fromId: "ch:0:0",
      toIds: ["ch:0:0"],
      status: "mapped-one",
    }]);
    const preserved = withVariantStaleness(withHistoricalAuthorities({
      ...r0,
      source: r1Source,
    }), "intent");

    expect(isHarmonyProjectShape(preserved)).toBe(true);
    expect((await validateHarmonyProject(preserved, executionRegistry)).status).toBe("complete");
    expect(preserved.chordTimelineState.status).toBe("stale");
    if (preserved.chordTimelineState.status !== "stale") throw new Error("missing stale timeline");
    expect(preserved.chordTimelineState.previousTimeline).toBe(t0);

    const disguisedAsCurrent: HarmonyProject = {
      ...preserved,
      chordTimelineState: { status: "resolved", timeline: t0, diagnostics: [] },
    };
    expect((await validateHarmonyProject(disguisedAsCurrent, executionRegistry)).status).toBe("blocked");

    const historicalBlockingDiagnostic = {
      id: "dg:STALE_REFERENCE:historical-authority:0",
      code: "STALE_REFERENCE",
      severity: "blocking",
      messageKo: "historical authority is not executable",
    } as const;
    const blockedPreservation: HarmonyProject = {
      ...preserved,
      chordTimelineState: {
        status: "blocked",
        previousTimeline: t0,
        resolutionPolicy: t0.resolutionPolicy,
        diagnostics: [historicalBlockingDiagnostic],
      },
      sourceLeadAtomizationState: {
        status: "blocked",
        previousAtomization: a0,
        diagnostics: [historicalBlockingDiagnostic],
      },
    };
    expect(isHarmonyProjectShape(blockedPreservation)).toBe(true);
    expect((await validateHarmonyProject(blockedPreservation, executionRegistry)).status).toBe("complete");
  });

  it("preserves structurally deleted source targets and stale locks but blocks them when fresh", async () => {
    const r0 = await generationProject();
    if (r0.chordTimelineState.status !== "resolved"
      || r0.sourceLeadAtomizationState.status !== "resolved") {
      throw new Error("missing R0 authority");
    }
    const t0 = r0.chordTimelineState.timeline;
    const a0 = r0.sourceLeadAtomizationState.atomization;
    const oldSpan = t0.spans[0];
    const oldAtom = a0.atoms[0];
    const parsedC = parseChord("C");
    if (!oldSpan || !oldAtom || parsedC.status !== "ok") throw new Error("missing historical targets");
    const sourceMeasures = r0.source.sourceMeasures.map((measure, index) => index === 0
      ? { ...measure, leadEvents: [], chordEvents: [], lyricTokens: [] }
      : measure);
    const r1Source = await revisedSource(r0.source, sourceMeasures, [{
      entityKind: "lead-event",
      fromId: "le:0:0",
      toIds: [],
      status: "deleted",
    }, {
      entityKind: "chord-event",
      fromId: "ch:0:0",
      toIds: [],
      status: "deleted",
    }]);
    const basePreserved = withVariantStaleness(withHistoricalAuthorities({
      ...r0,
      source: r1Source,
    }), "intent");
    const historicalDiagnostic = {
      id: "dg:STALE_REFERENCE:removed-source:0",
      code: "STALE_REFERENCE",
      severity: "warning",
      messageKo: "historical target was removed",
      location: {
        phraseId: "ph:removed",
        sourceEventIds: ["le:0:0", "ch:0:0"],
        trackPlanIds: ["track:removed"],
      },
    } as const;
    const variant = generatedVariant(basePreserved);
    const preservedWithOldReferences: HarmonyProject = {
      ...basePreserved,
      locksByPreset: { simple: {
        intent: [],
        activity: [],
        anchor: [{
          id: "lk:simple:anchor:historical-chord:0",
          presetId: "simple",
          kind: "anchor-chord-tone",
          phraseId: "ph:removed",
          trackPlanId: "track:removed",
          position: oldSpan.range.start,
          chordSpanId: oldSpan.id,
          selectedTone: parsedC.chord.tones[0],
        }, {
          id: "lk:simple:anchor:historical-atom:0",
          presetId: "simple",
          kind: "anchor-lead-derived",
          phraseId: "ph:removed",
          trackPlanId: "track:removed",
          position: oldAtom.range.start,
          leadAtom: {
            sourceLeadAtomizationDigest: a0.digest,
            leadAtomId: oldAtom.id,
          },
          relation: "unison",
        }],
        solver: [],
      } },
      variants: { simple: {
        ...variant,
        diagnostics: [historicalDiagnostic],
        staleness: {
          staleFrom: "intent",
          staleDiagnosticIds: [historicalDiagnostic.id],
          previousArtifactDigests: [],
        },
      } },
    };

    expect(isHarmonyProjectShape(preservedWithOldReferences)).toBe(true);
    expect((await validateHarmonyProject(
      preservedWithOldReferences,
      executionRegistry,
    )).status).toBe("complete");

    const freshAnchorLocks = withVariantStaleness(
      preservedWithOldReferences,
      "generation",
    );
    expect((await validateHarmonyProject(freshAnchorLocks, executionRegistry)).status).toBe("blocked");
  });

  it("allows an old resolver only as previousTimeline", async () => {
    const oldRegistry = registryWith({
      versions: { chordTimelineResolverVersion: "chord-resolver-v0" },
    });
    const oldProject = await generationProject(oldRegistry);
    const preserved = withVariantStaleness(
      withHistoricalAuthorities(oldProject),
      "intent",
    );
    expect((await validateHarmonyProject(preserved, executionRegistry)).status).toBe("complete");
    if (preserved.chordTimelineState.status !== "stale") throw new Error("missing previous timeline");
    const disguisedAsResolved: HarmonyProject = {
      ...preserved,
      chordTimelineState: {
        status: "resolved",
        timeline: preserved.chordTimelineState.previousTimeline,
        diagnostics: [],
      },
    };
    expect((await validateHarmonyProject(disguisedAsResolved, executionRegistry)).status).toBe("blocked");
  });

  it("allows an old atomizer only as previousAtomization", async () => {
    const oldRegistry = registryWith({
      versions: { sourceLeadAtomizerVersion: "atomizer-v0" },
    });
    const oldProject = await generationProject(oldRegistry);
    if (oldProject.sourceLeadAtomizationState.status !== "resolved") {
      throw new Error("missing old atomization");
    }
    const preserved = withVariantStaleness({
      ...oldProject,
      sourceLeadAtomizationState: {
        status: "stale",
        previousAtomization: oldProject.sourceLeadAtomizationState.atomization,
        diagnostics: [],
      },
    }, "intent");
    expect((await validateHarmonyProject(preserved, executionRegistry)).status).toBe("complete");
    const disguisedAsResolved = withVariantStaleness(oldProject, "intent");
    expect((await validateHarmonyProject(disguisedAsResolved, executionRegistry)).status).toBe("blocked");
  });

  it("allows historical downstream provenance to differ from a replaced fresh upstream plan", async () => {
    const project = await generationProject();
    const variant = generatedVariant(project);
    const ordinals: PlanOrdinalRegistry = {
      sectionOccurrenceOrdinalById: { "so:0:1:0": 0 },
      phraseOrdinalById: { "ph:0:0:0/1:1:0/1": 0 },
      trackOrdinalById: { "track:source-lead": 0, "track:h1": 1 },
      leadAtomOrdinalById: {},
      chordSpanOrdinalById: {},
    };
    const replacementBase = {
      ...variant.intentPlan,
      sectionIntents: [{
        id: "si:simple:0",
        sectionOccurrenceId: "so:0:1:0",
        presetId: "simple",
        intensityTarget: {
          participationCoverageBp: basisPoints(0),
          harmonicDivergenceCoverageBp: basisPoints(0),
          exactlyTwoPitchCoverageBp: basisPoints(0),
          exactlyThreePitchCoverageBp: basisPoints(0),
          maxHarmonyAttackRatioBp: extendedBasisPoints(0),
          registerSpreadRange: [0, 0] as const,
          maxActiveVoiceCount: 1 as const,
        },
        grammarRuleIds: [],
      }],
      phraseIntents: [{
        id: "pi:simple:0",
        phraseId: "ph:0:0:0/1:1:0/1",
        presetId: "simple",
        sectionIntentId: "si:simple:0",
        textureId: "UNISON",
        harmonyExpectation: "none",
        trackRoles: [],
        lyricPolicy: "same-lyrics",
        cadencePolicy: "closed",
        grammarRuleIds: [],
      }],
      intentPlanDigest: d("0"),
    } as const;
    const replacementIntent = {
      ...replacementBase,
      intentPlanDigest: await digestIntentPlan(replacementBase, ordinals),
    };
    expect(replacementIntent.intentPlanDigest).not.toBe(variant.activityPlan.intentPlanDigest);
    const preserved: HarmonyProject = {
      ...project,
      variants: { simple: {
        ...variant,
        intentPlan: replacementIntent,
        staleness: {
          staleFrom: "activity",
          staleDiagnosticIds: [],
          previousArtifactDigests: [],
        },
      } },
    };

    expect(isHarmonyProjectShape(preserved)).toBe(true);
    expect((await validateHarmonyProject(preserved, executionRegistry)).status).toBe("complete");
  });

  const staleStageCases = [{
    label: "intent planner",
    staleFrom: "intent",
    registry: registryWith({ versions: { plannerVersion: "planner-v0" } }),
  }, {
    label: "activity planner",
    staleFrom: "activity",
    registry: registryWith({ versions: { activityPlannerVersion: "activity-v0" } }),
  }, {
    label: "anchor planner",
    staleFrom: "anchor",
    registry: registryWith({ versions: { anchorPlannerVersion: "anchor-v0" } }),
  }, {
    label: "generation solver and config",
    staleFrom: "generation",
    registry: registryWith({
      versions: { solverVersion: "solver-v0" },
      configDigests: { solverConfigDigest: d("b") },
    }),
  }] as const;

  it.each(staleStageCases)(
    "applies the $staleFrom freshness boundary for $label artifacts",
    async ({ staleFrom, registry }) => {
      const historicalProject = await generationProject(registry);
      const preserved = withVariantStaleness(historicalProject, staleFrom);
      expect(isHarmonyProjectShape(preserved)).toBe(true);
      expect((await validateHarmonyProject(preserved, executionRegistry)).status).toBe("complete");
      expect((await validateHarmonyProject(
        historicalProject,
        executionRegistry,
      )).status).toBe("blocked");
    },
  );

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
