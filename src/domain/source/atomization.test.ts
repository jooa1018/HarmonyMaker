import { describe, expect, it } from "vitest";
import type { SemanticDigest } from "../digest/canonical";
import { fraction } from "../fraction";
import type { EffectiveChordTimeline } from "../harmony/chord-timeline";
import { COMMON_TIME } from "../meter";
import type { PerformanceSequence } from "../performance/repeat";
import { musicalRange } from "../time";
import { atomizeSourceLead, createAtomizationLookup, createStageLocalSubAtom, resolveLeadAtomReference } from "./atomization";
import type { SectionOccurrence, SourceMeasure } from "./model";

const d0 = "0".repeat(64) as SemanticDigest;
const d1 = "1".repeat(64) as SemanticDigest;
const performance: PerformanceSequence = { expanderVersion: "v", occurrences: [{ occurrenceId: "pm:0:0", sourceMeasureId: "m1", sourceMeasureNumber: 1, occurrenceIndexForSource: 0, performanceIndex: 0, time: COMMON_TIME, duration: fraction(4) }] };
const section: SectionOccurrence = { id: "so:0", sectionDefinitionId: "sd:0", occurrenceIndex: 0, variant: "base", lyricVerseIndex: 2, startPerformanceMeasureIndex: 0, endPerformanceMeasureIndexExclusive: 1 };
const source: SourceMeasure = {
  id: "m1", number: 1, implicit: false, time: COMMON_TIME, duration: fraction(4), repeat: { startRepeat: false }, chordEvents: [], textEvents: [],
  leadEvents: [{ kind: "note", id: "le:0", sourceMeasureId: "m1", onset: fraction(0), duration: fraction(4), pitch: { step: "C", alter: 0, octave: 4 }, tieStart: false, tieStop: false, lyricTokenIds: ["ly:v1", "ly:v2"] }],
  lyricTokens: [
    { id: "ly:v1", text: "one", syllabic: "single", leadEventId: "le:0", verse: 1, extend: false, emphasis: "none" },
    { id: "ly:v2", text: "two", syllabic: "single", leadEventId: "le:0", verse: 2, extend: false, emphasis: "confirmed", emphasisSource: "manual" },
  ],
};
const chordTimeline: EffectiveChordTimeline = {
  sourceChordProjectionDigest: d0, performanceSequenceDigest: d0, resolutionPolicy: { gapPolicy: "carry-until-next" }, chordTimelineResolverVersion: "v",
  spans: [
    { id: "pcs:0", range: musicalRange({ performanceMeasureIndex: 0, offset: fraction(0) }, { performanceMeasureIndex: 0, offset: fraction(2) }), parseResult: { status: "no-chord", sourceText: "N.C." }, origin: { kind: "source-event", sourceChordEventId: "ch:0" } },
    { id: "pcs:1", range: musicalRange({ performanceMeasureIndex: 0, offset: fraction(2) }, { performanceMeasureIndex: 1, offset: fraction(0) }), parseResult: { status: "no-chord", sourceText: "N.C." }, origin: { kind: "carried", carrySource: "gap-policy", originatingSourceChordEventId: "ch:0", previousSpanId: "pcs:0" } },
  ], digest: d1,
};

describe("canonical SourceLeadAtomization", () => {
  it("splits only at canonical boundaries and selects the SectionOccurrence verse", async () => {
    const result = await atomizeSourceLead({ sourceMeasures: [source], performanceSequence: performance, sectionOccurrences: [section], phraseRegions: [], chordTimeline, musicalSourceDigest: d0, atomizerVersion: "atom-v1" });
    expect(result.atoms).toHaveLength(2);
    expect(result.atoms[0].lyricTokenIds).toEqual(["ly:v2"]);
    expect(result.atoms[1].lyricTokenIds).toEqual([]);
    expect(result.atoms[0].tiedToNext).toBe(true);
    expect(result.atoms[1].tiedFromPrevious).toBe(true);
  });

  it("keeps canonical digest stable when a stage-local split is created", async () => {
    const result = await atomizeSourceLead({ sourceMeasures: [source], performanceSequence: performance, sectionOccurrences: [section], phraseRegions: [], chordTimeline, musicalSourceDigest: d0, atomizerVersion: "atom-v1" });
    const before = result.digest;
    const local = createStageLocalSubAtom(result.atoms[0], musicalRange(result.atoms[0].range.start, { performanceMeasureIndex: 0, offset: fraction(1) }));
    expect(local.sourceAtomId).toBe(result.atoms[0].id);
    expect(result.digest).toBe(before);
  });

  it("binds LeadAtomReference to both digest and atom ID", async () => {
    const result = await atomizeSourceLead({ sourceMeasures: [source], performanceSequence: performance, sectionOccurrences: [section], phraseRegions: [], chordTimeline, musicalSourceDigest: d0, atomizerVersion: "atom-v1" });
    const lookup = createAtomizationLookup(result);
    expect(resolveLeadAtomReference({ sourceLeadAtomizationDigest: result.digest, leadAtomId: result.atoms[0].id }, lookup)).toBe(result.atoms[0]);
    expect(resolveLeadAtomReference({ sourceLeadAtomizationDigest: d0, leadAtomId: result.atoms[0].id }, lookup)).toBeUndefined();
  });
});

