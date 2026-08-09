import { describe, expect, it } from "vitest";
import type { SemanticDigest } from "./digest/canonical";
import { createPresetProfileRegistry } from "./config";
import { fraction } from "./fraction";
import { COMMON_TIME } from "./meter";
import { SOURCE_LEAD_TRACK } from "./performer";
import { pitchRange } from "./pitch";
import {
  isHarmonyProjectShape, markVariantStale, preserveBlockedAttempt,
  validateArrangementVariant, validateHarmonyProject, type ArrangementVariant,
} from "./project";
import type { AlgorithmExecutionRegistry } from "./registries";
import { countRate, durationRate, extendedCountRate } from "./rates";
import type { ArrangementIntentPlan } from "./plans";
import { musicalRange } from "./time";

const digest = "0".repeat(64) as SemanticDigest;
const executionRegistry: AlgorithmExecutionRegistry = {
  versions: {
    domainSchemaVersion: "v", digestCodecVersion: "v", chordParserVersion: "v",
    chordTimelineResolverVersion: "v", performanceExpanderVersion: "repeat-v1",
    sourceLeadAtomizerVersion: "v", presetProfileVersion: "preset-v1",
    candidateProjectionVersion: "v", plannerVersion: "v", grammarVersion: "v",
    activityPlannerVersion: "v", anchorPlannerVersion: "v", solverVersion: "v",
    assemblerVersion: "v", validatorVersion: "v", metricsVersion: "v",
    diagnosticRegistryVersion: "v", accompanimentVersion: "v",
    editMaterializerVersion: "v", practiceShareCodecVersion: "v",
    omrNormalizerVersion: "v", evidenceMappingVersion: "v",
  },
  configDigests: {
    plannerConfigDigest: digest, grammarConfigDigest: digest,
    activityPlannerConfigDigest: digest, anchorPlannerConfigDigest: digest,
    solverConfigDigest: digest, assemblerConfigDigest: digest,
    validatorConfigDigest: digest, metricConfigDigest: digest,
    accompanimentConfigDigest: digest, diagnosticRegistryDigest: digest,
  },
};
const intentPlan: ArrangementIntentPlan = { stage: "intent", presetId: "simple", intentInputDigest: digest, effectiveChordTimelineDigest: digest, sourceLeadAtomizationDigest: digest, effectiveConfigDigest: digest, presetProfileVersion: "v", presetProfileDigest: digest, grammarId: "worship-arrangement-grammar-v1", grammarVersion: "v", plannerVersion: "v", grammarConfigDigest: digest, plannerConfigDigest: digest, diagnosticRegistryVersion: "v", diagnosticRegistryDigest: digest, sectionIntents: [], phraseIntents: [], intentPlanDigest: digest };

describe("variant lifecycle and rate contracts", () => {
  it("distinguishes absent stage objects from present empty arrays", () => {
    const empty: ArrangementVariant = { lifecycle: "empty", presetId: "simple", diagnostics: [] };
    expect(validateArrangementVariant(empty)).toBe(true);
    expect(validateArrangementVariant({ ...empty, intentPlan: { sectionIntents: [], phraseIntents: [] } })).toBe(false);
    expect(validateArrangementVariant({ ...empty, staleness: { staleFrom: "intent", staleDiagnosticIds: [], previousArtifactDigests: [] } })).toBe(false);
    expect(validateArrangementVariant({ lifecycle: "intent-ready", presetId: "simple", diagnostics: [], intentPlan: null })).toBe(false);
  });

  it("preserves realized artifacts when marking a variant stale", () => {
    const variant: ArrangementVariant = { lifecycle: "intent-ready", presetId: "simple", diagnostics: [], intentPlan };
    const stale = markVariantStale(variant, { staleFrom: "intent", staleDiagnosticIds: [], previousArtifactDigests: [digest] });
    expect(stale.lifecycle).toBe("intent-ready");
    expect("intentPlan" in stale && stale.intentPlan).toBe(intentPlan);
  });

  it("preserves the previous variant on a blocked retry", () => {
    const standardPlan: ArrangementIntentPlan = { ...intentPlan, presetId: "standard" };
    const variant: ArrangementVariant = { lifecycle: "intent-ready", presetId: "standard", diagnostics: [], intentPlan: standardPlan };
    const updated = preserveBlockedAttempt(variant, "activity", digest, { status: "blocked", diagnostics: [{ id: "dg:block", code: "GRAMMAR_BLOCKED", severity: "blocking", messageKo: "blocked" }] });
    expect(updated.lifecycle).toBe("intent-ready");
    expect("intentPlan" in updated && updated.intentPlan).toBe(standardPlan);
    expect(updated.lastBlockedAttempt?.stage).toBe("activity");
  });

  it("represents denominator zero honestly", () => {
    expect(countRate(0, 0)).toEqual({ numerator: 0, denominator: 0, valueBp: null, unavailableReason: "NO_EVALUABLE_ITEMS" });
    expect(extendedCountRate(0, 0).valueBp).toBeNull();
    expect(durationRate(fraction(0), fraction(0)).valueBp).toBeNull();
  });

  it("allows attack ratios over 100 percent only in ExtendedBasisPoints", () => {
    expect(extendedCountRate(3, 2).valueBp).toBe(15000);
    expect(() => countRate(3, 2)).toThrow();
  });

  it("strictly validates the persisted HarmonyProject graph and union states", async () => {
    const measure = {
      id: "measure:0", number: 1, implicit: false, time: COMMON_TIME, duration: fraction(4),
      leadEvents: [], chordEvents: [], lyricTokens: [], textEvents: [], repeat: { startRepeat: false },
    } as const;
    const source = {
      schemaVersion: 9, documentId: "document:0", revisionOrdinal: 0, revisionDigest: digest,
      revisionHistory: [], revisionHistoryDigest: digest, title: "Fixture",
      defaultKey: { tonic: { step: "C", alter: 0 }, mode: "major" },
      defaultTempo: { beatUnit: 4, dotted: false, bpm: 80 }, sourceMeasures: [measure],
      performanceSequence: { expanderVersion: "repeat-v1", occurrences: [{ occurrenceId: "occurrence:0", sourceMeasureId: measure.id, sourceMeasureNumber: 1, occurrenceIndexForSource: 0, performanceIndex: 0, time: COMMON_TIME, duration: fraction(4) }] },
      sectionDefinitions: [{ id: "section-definition:0", type: "verse", label: "Verse", sourceMeasureIds: [measure.id], confirmation: "confirmed" }],
      sectionOccurrences: [{ id: "section-occurrence:0", sectionDefinitionId: "section-definition:0", occurrenceIndex: 0, variant: "base", lyricVerseIndex: 1, startPerformanceMeasureIndex: 0, endPerformanceMeasureIndexExclusive: 1 }],
      phraseRegions: [{ id: "phrase:0", sectionOccurrenceId: "section-occurrence:0", range: musicalRange({ performanceMeasureIndex: 0, offset: fraction(0) }, { performanceMeasureIndex: 1, offset: fraction(0) }), boundarySource: "section-boundary" }],
      rights: { basis: "self-authored", allowedUses: ["generation"] },
    } as const;
    const performer = {
      id: "performer:0", displayName: "Singer",
      hardRange: pitchRange({ step: "C", alter: 0, octave: 3 }, { step: "C", alter: 0, octave: 5 }),
      comfortableRange: pitchRange({ step: "D", alter: 0, octave: 3 }, { step: "B", alter: 0, octave: 4 }),
    };
    const project = {
      schemaVersion: 9, source,
      chordTimelineState: { status: "unresolved", resolutionPolicy: { gapPolicy: "block-gap" }, diagnostics: [] },
      sourceLeadAtomizationState: { status: "unresolved" },
      presetProfiles: await createPresetProfileRegistry("preset-v1"), performers: [performer],
      trackPlans: [SOURCE_LEAD_TRACK], assignments: [{ trackPlanId: SOURCE_LEAD_TRACK.id, performerId: performer.id }],
      settings: { mode: { profileId: "worship-band-v1", harmonicContext: "band-supported" }, requestedPresetIds: ["simple"], userCaps: { maxHarmonyTracks: 0, allowOctaveDouble: false } },
      locksByPreset: { simple: { intent: [], activity: [], anchor: [], solver: [] } },
      variants: { simple: { lifecycle: "empty", presetId: "simple", diagnostics: [] } }, selectedPresetId: "simple",
    } as const;
    expect(isHarmonyProjectShape(project)).toBe(true);
    expect(isHarmonyProjectShape({ ...project, chordTimelineState: { ...project.chordTimelineState, injectedAuthority: true } })).toBe(false);
    expect(isHarmonyProjectShape({ ...project, performers: [{ ...performer, hardRange: { low: {}, high: {} } }] })).toBe(false);
    expect(isHarmonyProjectShape({ ...project, variants: { simple: { ...project.variants.simple, diagnostics: [{}] } } })).toBe(false);
    expect((await validateHarmonyProject(project, executionRegistry)).status).toBe("blocked");
  });
});
