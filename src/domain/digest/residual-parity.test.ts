import { describe, expect, it } from "vitest";
import { parseChord } from "../chord/parser";
import type { SemanticDigest } from "./canonical";
import { digestMusicalSource } from "./source";
import {
  digestActivityInput, digestAnchorInput, digestGenerationInput, digestIntentInput,
} from "./stages";
import { fraction } from "../fraction";
import {
  digestEffectiveChordTimeline, digestPerformanceSequence,
  digestSourceChordProjection, resolveEffectiveChordTimeline,
  type EffectiveChordTimeline,
} from "../harmony/chord-timeline";
import { COMMON_TIME } from "../meter";
import { atomizeSourceLead } from "../source/atomization";
import type { SongSourceDocument } from "../source/model";
import { musicalRange } from "../time";
import type { PlanOrdinalRegistry } from "./plans";

const d = (digit: string): SemanticDigest => digit.repeat(64) as SemanticDigest;

interface FixtureIds {
  readonly document: string;
  readonly measure: string;
  readonly lead: string;
  readonly lyric: string;
  readonly chord: string;
  readonly carry: string;
  readonly text: string;
  readonly performance: string;
  readonly definition: string;
  readonly section: string;
  readonly phrases: readonly [string, string];
  readonly tracks: readonly [string, string, string];
  readonly atoms: readonly string[];
  readonly spans: readonly [string, string];
  readonly locks: readonly [string, string, string, string, string];
}

const leftIds: FixtureIds = {
  document: "left:document",
  measure: "left:measure",
  lead: "left:lead",
  lyric: "left:lyric",
  chord: "left:z-chord",
  carry: "left:a-carry",
  text: "left:text",
  performance: "left:performance",
  definition: "left:definition",
  section: "left:section",
  phrases: ["left:z-phrase", "left:a-phrase"],
  tracks: ["left:z-lead-track", "left:z-harmony-track", "left:a-harmony-track"],
  atoms: ["left:z-atom", "left:a-atom"],
  spans: ["left:z-span", "left:a-span"],
  locks: ["left:z-lock", "left:y-lock", "left:x-lock", "left:w-lock", "left:v-lock"],
};

const rightIds: FixtureIds = {
  document: "right:document",
  measure: "right:measure",
  lead: "right:lead",
  lyric: "right:lyric",
  chord: "right:a-chord",
  carry: "right:z-carry",
  text: "right:text",
  performance: "right:performance",
  definition: "right:definition",
  section: "right:section",
  phrases: ["right:a-phrase", "right:z-phrase"],
  tracks: ["right:a-lead-track", "right:a-harmony-track", "right:z-harmony-track"],
  atoms: ["right:a-atom", "right:z-atom"],
  spans: ["right:a-span", "right:z-span"],
  locks: ["right:a-lock", "right:b-lock", "right:c-lock", "right:d-lock", "right:e-lock"],
};

function sourceFixture(ids: FixtureIds): SongSourceDocument {
  const phraseRanges = [
    musicalRange(
      { performanceMeasureIndex: 0, offset: fraction(0) },
      { performanceMeasureIndex: 0, offset: fraction(2) },
      [fraction(4)],
    ),
    musicalRange(
      { performanceMeasureIndex: 0, offset: fraction(2) },
      { performanceMeasureIndex: 0, offset: fraction(4) },
      [fraction(4)],
    ),
  ] as const;
  return {
    schemaVersion: 9,
    documentId: ids.document,
    revisionOrdinal: 17,
    revisionDigest: d("0"),
    revisionHistory: [],
    revisionHistoryDigest: d("1"),
    sourceProvenanceDigest: d("2"),
    title: "display-only",
    defaultKey: { tonic: { step: "C", alter: 0 }, mode: "major" },
    defaultTempo: { beatUnit: 4, dotted: false, bpm: 80 },
    sourceMeasures: [{
      id: ids.measure,
      number: 1,
      implicit: false,
      time: COMMON_TIME,
      duration: fraction(4),
      leadEvents: [{
        kind: "note",
        id: ids.lead,
        sourceMeasureId: ids.measure,
        onset: fraction(0),
        duration: fraction(4),
        pitch: { step: "C", alter: 0, octave: 4 },
        tieStart: false,
        tieStop: false,
        lyricTokenIds: [ids.lyric],
      }],
      chordEvents: [{
        id: ids.chord,
        sourceMeasureId: ids.measure,
        onset: fraction(0),
        sourceText: "CM7",
        parseResult: parseChord("CM7"),
        source: "manual",
        confirmation: "confirmed",
      }, {
        id: ids.carry,
        sourceMeasureId: ids.measure,
        onset: fraction(2),
        sourceText: "%",
        parseResult: parseChord("%"),
        source: "manual",
        confirmation: "confirmed",
      }],
      lyricTokens: [{
        id: ids.lyric,
        text: "different display text",
        syllabic: "single",
        leadEventId: ids.lead,
        verse: 1,
        extend: false,
        emphasis: "confirmed",
        emphasisSource: "manual",
      }],
      textEvents: [{
        id: ids.text,
        sourceMeasureId: ids.measure,
        onset: fraction(0),
        kind: "section-label",
        text: "Verse",
      }],
      repeat: { startRepeat: false },
    }],
    performanceSequence: {
      expanderVersion: "repeat-v1",
      occurrences: [{
        occurrenceId: ids.performance,
        sourceMeasureId: ids.measure,
        sourceMeasureNumber: 1,
        occurrenceIndexForSource: 0,
        performanceIndex: 0,
        time: COMMON_TIME,
        duration: fraction(4),
      }],
    },
    sectionDefinitions: [{
      id: ids.definition,
      type: "verse",
      label: "display-only",
      sourceMeasureIds: [ids.measure],
      confirmation: "confirmed",
    }],
    sectionOccurrences: [{
      id: ids.section,
      sectionDefinitionId: ids.definition,
      occurrenceIndex: 0,
      variant: "base",
      lyricVerseIndex: 1,
      startPerformanceMeasureIndex: 0,
      endPerformanceMeasureIndexExclusive: 1,
    }],
    phraseRegions: phraseRanges.map((range, index) => ({
      id: ids.phrases[index] as string,
      sectionOccurrenceId: ids.section,
      range,
      boundarySource: "manual" as const,
    })),
    rights: { basis: "self-authored", allowedUses: ["generation"] },
  };
}

async function renamedTimeline(
  source: SongSourceDocument,
  ids: FixtureIds,
): Promise<EffectiveChordTimeline> {
  const sourceChordProjectionDigest = await digestSourceChordProjection(source.sourceMeasures);
  const performanceSequenceDigest = await digestPerformanceSequence(
    source.performanceSequence,
    source.sourceMeasures,
  );
  const result = await resolveEffectiveChordTimeline({
    sourceMeasures: source.sourceMeasures,
    performanceSequence: source.performanceSequence,
    sourceChordProjectionDigest,
    performanceSequenceDigest,
    policy: { gapPolicy: "carry-until-next" },
    resolverVersion: "resolver-v1",
    expectedResolverVersion: "resolver-v1",
  });
  if (result.status !== "resolved") throw new Error("fixture timeline failed");
  const spans = result.timeline.spans.map((span, index) => ({
    ...span,
    id: ids.spans[index] as string,
    origin: span.origin.kind === "carried"
      ? { ...span.origin, previousSpanId: ids.spans[0] }
      : span.origin,
  }));
  const withoutDigest = { ...result.timeline, spans };
  return {
    ...withoutDigest,
    digest: await digestEffectiveChordTimeline(withoutDigest, source.sourceMeasures),
  };
}

function ordinals(ids: FixtureIds): PlanOrdinalRegistry {
  return {
    sectionOccurrenceOrdinalById: { [ids.section]: 0 },
    phraseOrdinalById: { [ids.phrases[0]]: 0, [ids.phrases[1]]: 1 },
    trackOrdinalById: { [ids.tracks[0]]: 0, [ids.tracks[1]]: 1, [ids.tracks[2]]: 2 },
    leadAtomOrdinalById: { [ids.atoms[0]]: 0, [ids.atoms[1]]: 1 },
    chordSpanOrdinalById: { [ids.spans[0]]: 0, [ids.spans[1]]: 1 },
  };
}

function stageLocks(ids: FixtureIds, atomizationDigest: SemanticDigest) {
  const position = { performanceMeasureIndex: 0, offset: fraction(1) };
  const tone = { degree: 3, alteration: 0, role: "third", origin: "quality" } as const;
  return {
    intent: [{
      id: ids.locks[0], presetId: "simple", kind: "texture",
      phraseId: ids.phrases[1], textureId: "UNISON",
    }, {
      id: ids.locks[1], presetId: "simple", kind: "placement-role",
      phraseId: ids.phrases[0], trackPlanId: ids.tracks[2], placementRole: "lower",
    }] as const,
    activity: [{
      id: ids.locks[2], presetId: "simple", kind: "activity",
      phraseId: ids.phrases[0], trackPlanId: ids.tracks[1],
      range: musicalRange(position, { performanceMeasureIndex: 0, offset: fraction(2) }),
      activity: { state: "rest" },
    }] as const,
    anchor: [{
      id: ids.locks[3], presetId: "simple", kind: "anchor-planned-nct",
      phraseId: ids.phrases[0], trackPlanId: ids.tracks[1], position,
      nctSpec: {
        kind: "passing",
        contextChordSpanId: ids.spans[0],
        targetChordSpanId: ids.spans[1],
        preparation: {
          kind: "lead-derived",
          position: { performanceMeasureIndex: 0, offset: fraction(0) },
          leadAtom: { sourceLeadAtomizationDigest: atomizationDigest, leadAtomId: ids.atoms[0] },
          relation: "unison",
        },
        resolution: {
          kind: "chord-tone",
          position: { performanceMeasureIndex: 0, offset: fraction(2) },
          chordSpanId: ids.spans[1],
          selectedTone: tone,
        },
        resolutionDeadline: { performanceMeasureIndex: 0, offset: fraction(3) },
        direction: "up",
      },
    }] as const,
    solver: [{
      id: ids.locks[4], presetId: "simple", kind: "pitch",
      phraseId: ids.phrases[1], trackPlanId: ids.tracks[2], position,
      pitch: { step: "E", alter: 0, octave: 4 },
    }] as const,
  };
}

describe("full raw-ID renaming semantic parity", () => {
  it("keeps source, EffectiveChordTimeline, and all four stage input digests equal", async () => {
    const leftSource = sourceFixture(leftIds);
    const rightSource = sourceFixture(rightIds);
    const leftSourceDigest = await digestMusicalSource(leftSource);
    const rightSourceDigest = await digestMusicalSource(rightSource);
    expect(rightSourceDigest).toBe(leftSourceDigest);
    expect(await digestSourceChordProjection(rightSource.sourceMeasures)).toBe(await digestSourceChordProjection(leftSource.sourceMeasures));
    expect(await digestPerformanceSequence(rightSource.performanceSequence, rightSource.sourceMeasures)).toBe(await digestPerformanceSequence(leftSource.performanceSequence, leftSource.sourceMeasures));

    const leftTimeline = await renamedTimeline(leftSource, leftIds);
    const rightTimeline = await renamedTimeline(rightSource, rightIds);
    expect(rightTimeline.digest).toBe(leftTimeline.digest);
    const leftAtomization = await atomizeSourceLead({
      sourceMeasures: leftSource.sourceMeasures,
      performanceSequence: leftSource.performanceSequence,
      sectionOccurrences: leftSource.sectionOccurrences,
      phraseRegions: leftSource.phraseRegions,
      chordTimeline: leftTimeline,
      musicalSourceDigest: leftSourceDigest,
      atomizerVersion: "atomizer-v1",
    });
    const rightAtomization = await atomizeSourceLead({
      sourceMeasures: rightSource.sourceMeasures,
      performanceSequence: rightSource.performanceSequence,
      sectionOccurrences: rightSource.sectionOccurrences,
      phraseRegions: rightSource.phraseRegions,
      chordTimeline: rightTimeline,
      musicalSourceDigest: rightSourceDigest,
      atomizerVersion: "atomizer-v1",
    });
    expect(rightAtomization.digest).toBe(leftAtomization.digest);

    const leftOrdinals = ordinals(leftIds);
    const rightOrdinals = ordinals(rightIds);
    const leftLocks = stageLocks(leftIds, leftAtomization.digest);
    const rightLocks = stageLocks(rightIds, rightAtomization.digest);
    const intentCommon = {
      musicalSourceDigest: leftSourceDigest,
      effectiveChordTimelineDigest: leftTimeline.digest,
      sourceLeadAtomizationDigest: leftAtomization.digest,
      atomizerVersion: "atomizer-v1",
      performers: [],
      tracks: [
        { trackOrdinal: 0, kind: "source-lead", enabled: true },
        { trackOrdinal: 1, kind: "generated-harmony", enabled: true },
        { trackOrdinal: 2, kind: "generated-harmony", enabled: true },
      ],
      assignments: [],
      mode: { profileId: "worship-band-v1", harmonicContext: "band-supported" },
      userCaps: { maxHarmonyTracks: 2, allowOctaveDouble: false },
      presetId: "simple",
      effectiveConfigDigest: d("2"),
      presetProfileVersion: "preset-v1",
      presetProfileDigest: d("3"),
      plannerVersion: "planner-v1",
      grammarVersion: "grammar-v1",
      plannerConfigDigest: d("4"),
      grammarConfigDigest: d("5"),
      diagnosticRegistryVersion: "diagnostic-v1",
      diagnosticRegistryDigest: d("6"),
    } as const;
    expect(await digestIntentInput({ ...intentCommon, locks: rightLocks.intent }, rightOrdinals)).toBe(await digestIntentInput({ ...intentCommon, locks: leftLocks.intent }, leftOrdinals));
    const downstreamCommon = {
      sourceLeadAtomizationDigest: leftAtomization.digest,
      atomizerVersion: "atomizer-v1",
      effectiveConfigDigest: d("2"),
      presetProfileVersion: "preset-v1",
      presetProfileDigest: d("3"),
      diagnosticRegistryVersion: "diagnostic-v1",
      diagnosticRegistryDigest: d("6"),
    } as const;
    expect(await digestActivityInput({ ...downstreamCommon, intentPlanDigest: d("7"), locks: rightLocks.activity, activityPlannerVersion: "activity-v1", activityPlannerConfigDigest: d("8") }, rightOrdinals)).toBe(await digestActivityInput({ ...downstreamCommon, intentPlanDigest: d("7"), locks: leftLocks.activity, activityPlannerVersion: "activity-v1", activityPlannerConfigDigest: d("8") }, leftOrdinals));
    expect(await digestAnchorInput({ ...downstreamCommon, activityPlanDigest: d("9"), locks: rightLocks.anchor, anchorPlannerVersion: "anchor-v1", anchorPlannerConfigDigest: d("a") }, rightOrdinals)).toBe(await digestAnchorInput({ ...downstreamCommon, activityPlanDigest: d("9"), locks: leftLocks.anchor, anchorPlannerVersion: "anchor-v1", anchorPlannerConfigDigest: d("a") }, leftOrdinals));
    const generationCommon = {
      anchorPlanDigest: d("b"),
      effectiveConfigDigest: d("2"),
      presetProfileVersion: "preset-v1",
      presetProfileDigest: d("3"),
      solverVersion: "solver-v1",
      assemblerVersion: "assembler-v1",
      validatorVersion: "validator-v1",
      metricsVersion: "metrics-v1",
      candidateProjectionVersion: "candidate-v1",
      solverConfigDigest: d("c"),
      assemblerConfigDigest: d("d"),
      validatorConfigDigest: d("e"),
      metricConfigDigest: d("f"),
      diagnosticRegistryVersion: "diagnostic-v1",
      diagnosticRegistryDigest: d("6"),
    } as const;
    expect(await digestGenerationInput({ ...generationCommon, locks: rightLocks.solver }, rightOrdinals)).toBe(await digestGenerationInput({ ...generationCommon, locks: leftLocks.solver }, leftOrdinals));
  });
});
