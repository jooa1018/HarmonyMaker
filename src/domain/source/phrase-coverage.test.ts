import { describe, expect, it } from "vitest";
import { fraction } from "../fraction";
import { COMMON_TIME } from "../meter";
import { musicalRange } from "../time";
import type { LeadEvent, SourceMeasure } from "./model";
import { phrasesCoverMelodyBearingIntervals } from "./validation";

const note = (id: string, onset: number, duration: number, measureId = "sm:0"): LeadEvent => ({
  kind: "note",
  id,
  sourceMeasureId: measureId,
  onset: fraction(onset),
  duration: fraction(duration),
  pitch: { step: "C", alter: 0, octave: 4 },
  tieStart: false,
  tieStop: false,
  lyricTokenIds: [],
});

const rest = (id: string, measureId = "sm:0"): LeadEvent => ({
  kind: "rest",
  id,
  sourceMeasureId: measureId,
  onset: fraction(0),
  duration: fraction(4),
});

function measure(id: string, number: number, leadEvents: readonly LeadEvent[]): SourceMeasure {
  return {
    id,
    number,
    implicit: false,
    time: COMMON_TIME,
    duration: fraction(4),
    leadEvents,
    chordEvents: [],
    lyricTokens: [],
    textEvents: [],
    repeat: { startRepeat: false },
  };
}

function oneMeasureSource(phraseRanges: readonly ReturnType<typeof musicalRange>[], leadEvents: readonly LeadEvent[] = [
  note("le:head", 0, 1),
  note("le:middle", 1, 2),
  note("le:tail", 3, 1),
]) {
  return {
    sourceMeasures: [measure("sm:0", 1, leadEvents)],
    performanceSequence: {
      expanderVersion: "repeat-v1",
      occurrences: [{
        occurrenceId: "pm:0:0:0",
        sourceMeasureId: "sm:0",
        sourceMeasureNumber: 1,
        occurrenceIndexForSource: 0,
        performanceIndex: 0,
        time: COMMON_TIME,
        duration: fraction(4),
      }],
    },
    sectionOccurrences: [{
      id: "so:0",
      sectionDefinitionId: "sd:0",
      occurrenceIndex: 0,
      variant: "base" as const,
      lyricVerseIndex: 1,
      startPerformanceMeasureIndex: 0,
      endPerformanceMeasureIndexExclusive: 1,
    }],
    phraseRegions: phraseRanges.map((range, index) => ({
      id: `ph:${index}`,
      sectionOccurrenceId: "so:0",
      range,
      boundarySource: "manual" as const,
    })),
  };
}

function twoMeasureRestSource(range: ReturnType<typeof musicalRange>) {
  const first = measure("sm:0", 1, [rest("le:0", "sm:0")]);
  const second = measure("sm:1", 2, [rest("le:1", "sm:1")]);
  return {
    sourceMeasures: [first, second],
    performanceSequence: {
      expanderVersion: "repeat-v1",
      occurrences: [first, second].map((item, index) => ({
        occurrenceId: `pm:${index}:${index}:0`,
        sourceMeasureId: item.id,
        sourceMeasureNumber: item.number,
        occurrenceIndexForSource: 0,
        performanceIndex: index,
        time: item.time,
        duration: item.duration,
      })),
    },
    sectionOccurrences: [{
      id: "so:0",
      sectionDefinitionId: "sd:0",
      occurrenceIndex: 0,
      variant: "base" as const,
      lyricVerseIndex: 1,
      startPerformanceMeasureIndex: 0,
      endPerformanceMeasureIndexExclusive: 1,
    }],
    phraseRegions: [{
      id: "ph:0",
      sectionOccurrenceId: "so:0",
      range,
      boundarySource: "manual" as const,
    }],
  };
}

describe("authoritative melody-bearing phrase coverage", () => {
  it("accepts exact full coverage", () => {
    expect(phrasesCoverMelodyBearingIntervals(oneMeasureSource([
      musicalRange({ performanceMeasureIndex: 0, offset: fraction(0) }, { performanceMeasureIndex: 1, offset: fraction(0) }),
    ]))).toBe(true);
  });

  it("accepts contiguous phrase ranges whose union covers one sounding interval", () => {
    expect(phrasesCoverMelodyBearingIntervals(oneMeasureSource([
      musicalRange({ performanceMeasureIndex: 0, offset: fraction(0) }, { performanceMeasureIndex: 0, offset: fraction(2) }),
      musicalRange({ performanceMeasureIndex: 0, offset: fraction(2) }, { performanceMeasureIndex: 1, offset: fraction(0) }),
    ], [note("le:long", 0, 4)]))).toBe(true);
  });

  it.each([
    ["head", [musicalRange({ performanceMeasureIndex: 0, offset: fraction(1) }, { performanceMeasureIndex: 1, offset: fraction(0) })]],
    ["middle", [
      musicalRange({ performanceMeasureIndex: 0, offset: fraction(0) }, { performanceMeasureIndex: 0, offset: fraction(1) }),
      musicalRange({ performanceMeasureIndex: 0, offset: fraction(3) }, { performanceMeasureIndex: 1, offset: fraction(0) }),
    ]],
    ["tail", [musicalRange({ performanceMeasureIndex: 0, offset: fraction(0) }, { performanceMeasureIndex: 0, offset: fraction(3) })]],
  ])("rejects a missing %s melody interval", (_caseName, ranges) => {
    expect(phrasesCoverMelodyBearingIntervals(oneMeasureSource(ranges))).toBe(false);
  });

  it("treats a zero-melody section as vacuously covered", () => {
    expect(phrasesCoverMelodyBearingIntervals(oneMeasureSource([], [rest("le:rest")]))).toBe(true);
  });

  it("does not let a phrase from one section cover melody in another section", () => {
    const first = measure("sm:0", 1, [note("le:0", 0, 4, "sm:0")]);
    const second = measure("sm:1", 2, [note("le:1", 0, 4, "sm:1")]);
    const source = {
      sourceMeasures: [first, second],
      performanceSequence: {
        expanderVersion: "repeat-v1",
        occurrences: [first, second].map((item, index) => ({
          occurrenceId: `pm:${index}:${index}:0`,
          sourceMeasureId: item.id,
          sourceMeasureNumber: item.number,
          occurrenceIndexForSource: 0,
          performanceIndex: index,
          time: item.time,
          duration: item.duration,
        })),
      },
      sectionOccurrences: [0, 1].map((index) => ({
        id: `so:${index}`,
        sectionDefinitionId: `sd:${index}`,
        occurrenceIndex: 0,
        variant: "base" as const,
        lyricVerseIndex: 1,
        startPerformanceMeasureIndex: index,
        endPerformanceMeasureIndexExclusive: index + 1,
      })),
      phraseRegions: [{
        id: "ph:cross",
        sectionOccurrenceId: "so:0",
        range: musicalRange({ performanceMeasureIndex: 0, offset: fraction(0) }, { performanceMeasureIndex: 2, offset: fraction(0) }),
        boundarySource: "manual" as const,
      }],
    };
    expect(phrasesCoverMelodyBearingIntervals(source)).toBe(false);
  });

  it("rejects a phrase end at the section-exclusive measure with a nonzero offset", () => {
    expect(phrasesCoverMelodyBearingIntervals(twoMeasureRestSource(musicalRange(
      { performanceMeasureIndex: 0, offset: fraction(0) },
      { performanceMeasureIndex: 1, offset: fraction(1) },
    )))).toBe(false);
  });

  it("rejects a phrase start exactly at its section-exclusive boundary", () => {
    expect(phrasesCoverMelodyBearingIntervals(twoMeasureRestSource(musicalRange(
      { performanceMeasureIndex: 1, offset: fraction(0) },
      { performanceMeasureIndex: 1, offset: fraction(1) },
    )))).toBe(false);
  });

  it("rejects a phrase offset beyond the actual performance-measure duration", () => {
    expect(phrasesCoverMelodyBearingIntervals(oneMeasureSource([
      musicalRange(
        { performanceMeasureIndex: 0, offset: fraction(0) },
        { performanceMeasureIndex: 0, offset: fraction(5) },
      ),
    ], [rest("le:rest")]))).toBe(false);
  });
});
