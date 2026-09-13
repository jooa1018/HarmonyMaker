import { describe, expect, it } from "vitest";
import { APPLICATION_ALGORITHM_VERSION_REGISTRY as V } from "../app/algorithm-version-registry";
import { exportHarmonyProject, importHarmonyProject } from "../product/project-transfer";
import { loadProductExecutionRegistry } from "../product/registry";
import { parseChord } from "./chord/parser";
import { createPresetProfileRegistry } from "./config";
import { canonicalJson, type SemanticDigest } from "./digest/canonical";
import { digestMusicalSource } from "./digest/source";
import { fraction } from "./fraction";
import { digestEffectiveChordTimeline, digestPerformanceSequence, digestSourceChordProjection, resolveEffectiveChordTimeline, type EffectiveChordTimeline } from "./harmony/chord-timeline";
import { leadEventId, performanceChordSpanId, phraseRegionId, sectionDefinitionId, sectionOccurrenceId, sourceChordEventId, sourceMeasureId } from "./ids";
import { COMMON_TIME } from "./meter";
import { expandRepeats } from "./performance/repeat";
import { SOURCE_LEAD_TRACK } from "./performer";
import { isHarmonyProjectShape, validateHarmonyProject, type HarmonyProject } from "./project";
import { atomizeSourceLead } from "./source/atomization";
import type { SongSourceDocument, SourceChordEvent, SourceMeasure } from "./source/model";
import { normalizeSongSourceDocument } from "./source/normalize";
import { computeSourceProvenanceDigest } from "./source/provenance";
import { computeRevisionHistoryDigest } from "./source/revision";
import { musicalRange } from "./time";

// Public, newly authored two-measure fixture. No scan, private proof or answer score.
async function projectFixture(pickupPolicy = true): Promise<HarmonyProject> {
  const zero = "0".repeat(64) as SemanticDigest;
  const chord = (measure: number, ordinal: number, onset: number): SourceChordEvent => ({
    id: sourceChordEventId(measure, ordinal), sourceMeasureId: sourceMeasureId(measure), onset: fraction(onset),
    sourceText: "Bb", parseResult: parseChord("Bb"), source: "manual", confirmation: "confirmed",
  });
  const measures: SourceMeasure[] = [
    { id: sourceMeasureId(0), number: 1, implicit: true, time: COMMON_TIME, duration: fraction(1, 2),
      leadEvents: (["F", "G"] as const).map((step, ordinal) => ({ kind: "note", id: leadEventId(0, ordinal), sourceMeasureId: sourceMeasureId(0),
        onset: fraction(ordinal, 4), duration: fraction(1, 4), pitch: { step, alter: 0, octave: 3 }, tieStart: false, tieStop: false, lyricTokenIds: [] })),
      chordEvents: pickupPolicy ? [] : [chord(0, 0, 0)], lyricTokens: [], textEvents: [], repeat: { startRepeat: false } },
    { id: sourceMeasureId(1), number: 2, implicit: false, time: COMMON_TIME, duration: fraction(4),
      leadEvents: [{ kind: "note", id: leadEventId(1, 0), sourceMeasureId: sourceMeasureId(1), onset: fraction(0), duration: fraction(4),
        pitch: { step: "B", alter: -1, octave: 3 }, tieStart: false, tieStop: false, lyricTokenIds: [] }],
      chordEvents: [chord(1, 0, 0), chord(1, 1, 2)], lyricTokens: [], textEvents: [], repeat: { startRepeat: false } },
  ];
  const expanded = expandRepeats(measures, V.performanceExpanderVersion);
  if (expanded.status !== "complete") throw new Error(expanded.code);
  const sd = sectionDefinitionId(0, 2, "verse", 0), so = sectionOccurrenceId(0, 2, 0);
  const range = musicalRange({ performanceMeasureIndex: 0, offset: fraction(0) }, { performanceMeasureIndex: 2, offset: fraction(0) });
  let source: SongSourceDocument = normalizeSongSourceDocument({
    schemaVersion: 9, documentId: "document:pickup-public-project", revisionOrdinal: 0, revisionDigest: zero,
    revisionHistory: [], revisionHistoryDigest: await computeRevisionHistoryDigest([]), sourceProvenanceDigest: zero,
    title: "Public pickup policy fixture", defaultKey: { tonic: { step: "B", alter: -1 }, mode: "major" }, defaultTempo: { beatUnit: 4, dotted: false, bpm: 62 },
    sourceMeasures: measures, performanceSequence: expanded.sequence,
    sectionDefinitions: [{ id: sd, type: "verse", label: "Fixture", sourceMeasureIds: measures.map(m => m.id), confirmation: "confirmed" }],
    sectionOccurrences: [{ id: so, sectionDefinitionId: sd, occurrenceIndex: 0, variant: "base", lyricVerseIndex: 1, startPerformanceMeasureIndex: 0, endPerformanceMeasureIndexExclusive: 2 }],
    phraseRegions: [{ id: phraseRegionId(0, range.start, range.end), sectionOccurrenceId: so, range, boundarySource: "section-boundary" }],
    rights: { basis: "self-authored", allowedUses: ["generation"] },
  });
  source = { ...source, revisionDigest: await digestMusicalSource(source), sourceProvenanceDigest: await computeSourceProvenanceDigest(source) };
  const chordTimelineState = await resolveEffectiveChordTimeline({ sourceMeasures: source.sourceMeasures, performanceSequence: source.performanceSequence,
    sourceChordProjectionDigest: await digestSourceChordProjection(source.sourceMeasures),
    performanceSequenceDigest: await digestPerformanceSequence(source.performanceSequence, source.sourceMeasures),
    policy: { gapPolicy: "carry-until-next", ...(pickupPolicy ? { initialPickup: "anticipate-first-chord" as const } : {}) },
    resolverVersion: V.chordTimelineResolverVersion, expectedResolverVersion: V.chordTimelineResolverVersion });
  if (chordTimelineState.status !== "resolved") throw new Error(JSON.stringify(chordTimelineState.diagnostics));
  const atomization = await atomizeSourceLead({ sourceMeasures: source.sourceMeasures, performanceSequence: source.performanceSequence,
    sectionOccurrences: source.sectionOccurrences, phraseRegions: source.phraseRegions, musicalSourceDigest: source.revisionDigest,
    chordTimeline: chordTimelineState.timeline, atomizerVersion: V.sourceLeadAtomizerVersion });
  const hardRange = { low: { step: "C" as const, alter: 0 as const, octave: 3 }, high: { step: "C" as const, alter: 0 as const, octave: 6 } };
  return { schemaVersion: 9, source, chordTimelineState, sourceLeadAtomizationState: { status: "resolved", atomization, diagnostics: [] },
    presetProfiles: await createPresetProfileRegistry(V.presetProfileVersion),
    performers: [0, 1].map(i => ({ id: `pf:${i}`, displayName: `Fixture singer ${i}`, hardRange, comfortableRange: hardRange })),
    trackPlans: [SOURCE_LEAD_TRACK, { kind: "generated-harmony", id: "track:h1", displayLabel: "Harmony 1", canonicalOrdinal: 1, enabled: true }],
    assignments: [{ trackPlanId: "track:source-lead", performerId: "pf:0" }, { trackPlanId: "track:h1", performerId: "pf:1" }],
    settings: { mode: { profileId: "worship-band-v1", harmonicContext: "band-supported" }, requestedPresetIds: ["standard"], userCaps: { maxHarmonyTracks: 1, allowOctaveDouble: true } },
    locksByPreset: { standard: { intent: [], activity: [], anchor: [], solver: [] } },
    variants: { standard: { lifecycle: "empty", presetId: "standard", diagnostics: [] } }, selectedPresetId: "standard" };
}
function timeline(project: HarmonyProject): EffectiveChordTimeline {
  if (project.chordTimelineState.status !== "resolved") throw new Error("fixture timeline must be resolved");
  return project.chordTimelineState.timeline;
}
async function resealed(project: HarmonyProject, changed: EffectiveChordTimeline): Promise<HarmonyProject> {
  return { ...project, chordTimelineState: { status: "resolved", timeline: { ...changed, digest: await digestEffectiveChordTimeline(changed, project.source.sourceMeasures) }, diagnostics: [] },
    // Keep negative cases independent of an incidental stale atomization digest.
    sourceLeadAtomizationState: { status: "unresolved" } };
}
async function expectRejected(project: HarmonyProject) {
  expect(isHarmonyProjectShape(project)).toBe(true);
  expect((await validateHarmonyProject(project, await loadProductExecutionRegistry())).status).toBe("blocked");
  await expect(importHarmonyProject(canonicalJson(project))).rejects.toThrow("PROJECT_INTEGRITY_INVALID");
}

describe("pickup policy project authority", () => {
  it("round-trips the exact Source gap and separate arrangement origin", async () => {
    const project = await projectFixture(), sourceBefore = canonicalJson(project.source);
    const encoded = await exportHarmonyProject(project), restored = await importHarmonyProject(encoded);
    expect(canonicalJson(restored.source)).toBe(sourceBefore);
    expect(restored.source.sourceMeasures[0].chordEvents).toEqual([]);
    expect(timeline(restored).spans[0].origin).toEqual({ kind: "arrangement-policy", policy: "anticipate-first-chord", followingSourceChordEventId: "ch:1:0" });
    expect(await exportHarmonyProject(restored)).toBe(encoded);
  });

  it("keeps a legacy project without the optional field exact across transfer", async () => {
    const project = await projectFixture(false), encoded = await exportHarmonyProject(project);
    const restored = await importHarmonyProject(encoded);
    expect(timeline(restored).resolutionPolicy).toEqual({ gapPolicy: "carry-until-next" });
    expect(timeline(restored).spans.every(span => span.origin.kind === "source-event")).toBe(true);
    expect(await exportHarmonyProject(restored)).toBe(encoded);
  });

  it("rejects policy removal even after recomputing the timeline digest", async () => {
    const project = await projectFixture(), original = timeline(project);
    await expectRejected(await resealed(project, { ...original, resolutionPolicy: { gapPolicy: "carry-until-next" } }));
  });

  it("rejects a same-payload following chord substitution after resealing", async () => {
    const project = await projectFixture(), original = timeline(project), first = original.spans[0];
    await expectRejected(await resealed(project, { ...original, spans: [{ ...first,
      origin: { kind: "arrangement-policy", policy: "anticipate-first-chord", followingSourceChordEventId: "ch:1:1" } }, ...original.spans.slice(1)] }));
  });

  it("rejects calling an anticipatory span an original source event after resealing", async () => {
    const project = await projectFixture(), original = timeline(project), first = original.spans[0];
    await expectRejected(await resealed(project, { ...original, spans: [{ ...first,
      origin: { kind: "source-event", sourceChordEventId: "ch:1:0" } }, ...original.spans.slice(1)] }));
  });

  it("rejects a changed pickup range even with a canonical span ID and fresh digest", async () => {
    const project = await projectFixture(), original = timeline(project), first = original.spans[0];
    const range = musicalRange(first.range.start, { performanceMeasureIndex: 0, offset: fraction(1, 4) });
    await expectRejected(await resealed(project, { ...original, spans: [{ ...first, range, id: performanceChordSpanId(range.start, range.end) }, ...original.spans.slice(1)] }));
  });

  it("rejects an unknown policy and fields from another provenance kind at shape validation", async () => {
    const project = await projectFixture(), original = timeline(project), first = original.spans[0];
    const badPolicy = { ...project, chordTimelineState: { status: "resolved", diagnostics: [], timeline: { ...original, resolutionPolicy: { gapPolicy: "carry-until-next", initialPickup: "automatic" } } } };
    expect(isHarmonyProjectShape(badPolicy)).toBe(false);
    const mixedOrigin = { ...project, chordTimelineState: { status: "resolved", diagnostics: [], timeline: { ...original, spans: [{ ...first, origin: { ...first.origin, previousSpanId: "pcs:0:0/1:1:0/1" } }, ...original.spans.slice(1)] } } };
    expect(isHarmonyProjectShape(mixedOrigin)).toBe(false);
  });

  it.each(["resolved", "unresolved", "stale", "blocked"] as const)("rejects an array gapPolicy in a %s project at transfer and shape boundaries", async (status) => {
    const project = await projectFixture(), original = timeline(project);
    const resolutionPolicy = { ...original.resolutionPolicy, gapPolicy: ["carry-until-next"] };
    const states = {
      resolved: { status: "resolved", timeline: { ...original, resolutionPolicy }, diagnostics: [] },
      unresolved: { status: "unresolved", resolutionPolicy, diagnostics: [] },
      stale: { status: "stale", resolutionPolicy, previousTimeline: original, diagnostics: [] },
      blocked: { status: "blocked", resolutionPolicy, diagnostics: [{
        id: "dg:SOURCE_CHORD_GAP:public:0", code: "SOURCE_CHORD_GAP", severity: "blocking", messageKo: "Public blocked fixture",
      }] },
    };
    const malformed = { ...project, chordTimelineState: states[status], sourceLeadAtomizationState: { status: "unresolved" } };
    await expect(importHarmonyProject(JSON.stringify(malformed))).rejects.toThrow("PROJECT_INTEGRITY_INVALID");
    expect(isHarmonyProjectShape(malformed)).toBe(false);
  });

  it.each([
    { label: "block-gap array", gapPolicy: ["block-gap"] },
    { label: "object", gapPolicy: { value: "carry-until-next" } },
  ])("rejects a $label gapPolicy in an unresolved project", async ({ gapPolicy }) => {
    const project = await projectFixture();
    const malformed = { ...project,
      chordTimelineState: { status: "unresolved", resolutionPolicy: { gapPolicy, initialPickup: "anticipate-first-chord" }, diagnostics: [] },
      sourceLeadAtomizationState: { status: "unresolved" },
    };
    await expect(importHarmonyProject(JSON.stringify(malformed))).rejects.toThrow("PROJECT_INTEGRITY_INVALID");
    expect(isHarmonyProjectShape(malformed)).toBe(false);
  });
});
