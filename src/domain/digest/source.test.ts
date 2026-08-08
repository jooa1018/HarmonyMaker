import { describe, expect, it } from "vitest";
import { parseChord } from "../chord/parser";
import { fraction } from "../fraction";
import { COMMON_TIME } from "../meter";
import type { SemanticDigest } from "./canonical";
import type { SongSourceDocument } from "../source/model";
import { musicalRange } from "../time";
import { digestMusicalSource } from "./source";

const d = "0".repeat(64) as SemanticDigest;
function sourceFixture(input: { readonly prefix: string; readonly title: string; readonly chord: string; readonly emphasis: "musicxml" | "metric" | "confirmed-manual" | "confirmed-imported" }): SongSourceDocument {
  const id = (kind: string) => `${input.prefix}:${kind}`;
  const emphasis = input.emphasis === "musicxml" ? { emphasis: "suggested", emphasisSource: "musicxml-accent" } as const : input.emphasis === "metric" ? { emphasis: "suggested", emphasisSource: "metric-heuristic" } as const : input.emphasis === "confirmed-manual" ? { emphasis: "confirmed", emphasisSource: "manual" } as const : { emphasis: "confirmed", emphasisSource: "musicxml-accent" } as const;
  const measure = {
    id: id("measure"), number: 1, implicit: false, time: COMMON_TIME, duration: fraction(4), key: undefined,
    leadEvents: [{ kind: "note", id: id("lead"), sourceMeasureId: id("measure"), onset: fraction(0), duration: fraction(4), pitch: { step: "C", alter: 0, octave: 4 }, tieStart: false, tieStop: false, lyricTokenIds: [id("lyric")] }] as const,
    chordEvents: [{ id: id("chord"), sourceMeasureId: id("measure"), onset: fraction(0), sourceText: input.chord, parseResult: parseChord(input.chord), source: "manual", confirmation: "confirmed" }] as const,
    lyricTokens: [{ id: id("lyric"), text: input.title, syllabic: "single", leadEventId: id("lead"), verse: 1, extend: false, ...emphasis }] as const,
    textEvents: [], repeat: { startRepeat: false },
  };
  return {
    schemaVersion: 9, documentId: id("doc"), revisionOrdinal: 9, revisionDigest: d, revisionHistory: [], revisionHistoryDigest: d,
    title: input.title, defaultKey: { tonic: { step: "C", alter: 0 }, mode: "major" }, defaultTempo: { beatUnit: 4, dotted: false, bpm: 80 }, sourceMeasures: [measure],
    performanceSequence: { expanderVersion: "repeat-v1", occurrences: [{ occurrenceId: id("occurrence"), sourceMeasureId: measure.id, sourceMeasureNumber: 1, occurrenceIndexForSource: 0, performanceIndex: 0, time: COMMON_TIME, duration: fraction(4) }] },
    sectionDefinitions: [{ id: id("definition"), type: "verse", label: input.title, sourceMeasureIds: [measure.id], confirmation: "confirmed" }],
    sectionOccurrences: [{ id: id("section"), sectionDefinitionId: id("definition"), occurrenceIndex: 0, variant: "base", lyricVerseIndex: 1, startPerformanceMeasureIndex: 0, endPerformanceMeasureIndexExclusive: 1 }],
    phraseRegions: [{ id: id("phrase"), sectionOccurrenceId: id("section"), range: musicalRange({ performanceMeasureIndex: 0, offset: fraction(0) }, { performanceMeasureIndex: 1, offset: fraction(0) }), boundarySource: "section-boundary" }],
    rights: { basis: "self-authored", allowedUses: ["generation"] },
  };
}

describe("musical source projection", () => {
  it("excludes display metadata, random IDs, revision identity, lyric text, and chord aliases", async () => {
    const left = sourceFixture({ prefix: "left", title: "Title A", chord: "CM7", emphasis: "confirmed-manual" });
    const right = sourceFixture({ prefix: "right", title: "Title B", chord: "CΔ7", emphasis: "confirmed-imported" });
    expect(await digestMusicalSource(left)).toBe(await digestMusicalSource(right));
  });

  it("distinguishes production lyric emphasis eligibility", async () => {
    const musicXml = sourceFixture({ prefix: "same", title: "same", chord: "C", emphasis: "musicxml" });
    const metric = sourceFixture({ prefix: "same", title: "same", chord: "C", emphasis: "metric" });
    expect(await digestMusicalSource(musicXml)).not.toBe(await digestMusicalSource(metric));
  });
});

