import { describe, expect, it } from "vitest";
import { parseChord } from "../chord/parser";
import { fraction } from "../fraction";
import { COMMON_TIME } from "../meter";
import type { SemanticDigest } from "./canonical";
import type { SongSourceDocument } from "../source/model";
import { musicalRange } from "../time";
import { digestMusicalSource } from "./source";
import { hasCanonicalSongSourceOrder, normalizeSongSourceDocument } from "../source/normalize";
import { computeRevisionHistoryDigest } from "../source/revision";
import { isSongSourceDocument, validateSongSourceDocumentIntegrity } from "../source/validation";

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

  it("includes section type, variant, confirmation, and lyric verse authority", async () => {
    const base = sourceFixture({ prefix: "same", title: "same", chord: "C", emphasis: "confirmed-manual" });
    const baseDigest = await digestMusicalSource(base);
    expect(await digestMusicalSource({ ...base, sectionDefinitions: [{ ...base.sectionDefinitions[0], type: "chorus" }] })).not.toBe(baseDigest);
    expect(await digestMusicalSource({ ...base, sectionDefinitions: [{ ...base.sectionDefinitions[0], confirmation: "suggested" }] })).not.toBe(baseDigest);
    expect(await digestMusicalSource({ ...base, sectionOccurrences: [{ ...base.sectionOccurrences[0], variant: "final" }] })).not.toBe(baseDigest);
    expect(await digestMusicalSource({ ...base, sectionOccurrences: [{ ...base.sectionOccurrences[0], lyricVerseIndex: 2 }] })).not.toBe(baseDigest);
  });

  it("canonicalizes source event, chord, lyric, and text permutations without raw-ID ordering", async () => {
    const base = sourceFixture({ prefix: "same", title: "same", chord: "C", emphasis: "confirmed-manual" });
    const measure = base.sourceMeasures[0];
    const lead0 = { ...measure.leadEvents[0], id: "same:lead:0", duration: fraction(2), lyricTokenIds: ["same:lyric:0"] } as const;
    const lead1 = { ...lead0, id: "same:lead:1", onset: fraction(2), pitch: { step: "D", alter: 0, octave: 4 }, lyricTokenIds: ["same:lyric:1"] } as const;
    const lyric0 = { ...measure.lyricTokens[0], id: "same:lyric:0", leadEventId: lead0.id };
    const lyric1 = { ...lyric0, id: "same:lyric:1", leadEventId: lead1.id, text: "two" };
    const chord0 = measure.chordEvents[0];
    const chord1 = { ...chord0, id: "same:chord:1", onset: fraction(2), sourceText: "G", parseResult: parseChord("G") };
    const text0 = { id: "same:text:0", sourceMeasureId: measure.id, onset: fraction(0), kind: "section-label", text: "Verse" } as const;
    const text1 = { ...text0, id: "same:text:1", onset: fraction(2), kind: "rehearsal-mark", text: "A" } as const;
    const canonical = { ...base, sourceMeasures: [{ ...measure, leadEvents: [lead0, lead1], chordEvents: [chord0, chord1], lyricTokens: [lyric0, lyric1], textEvents: [text0, text1] }] };
    const permuted = { ...canonical, sourceMeasures: [{ ...canonical.sourceMeasures[0], leadEvents: [lead1, lead0], chordEvents: [chord1, chord0], lyricTokens: [lyric1, lyric0], textEvents: [text1, text0] }] };
    expect(await digestMusicalSource(permuted)).toBe(await digestMusicalSource(canonical));
    expect(hasCanonicalSongSourceOrder(permuted)).toBe(false);
    expect(hasCanonicalSongSourceOrder(normalizeSongSourceDocument(permuted))).toBe(true);
  });

  it("strictly validates persisted SongSourceDocument shape and canonical order", () => {
    const fixture = { ...sourceFixture({ prefix: "valid", title: "Title", chord: "C", emphasis: "confirmed-manual" }), revisionOrdinal: 0 };
    expect(isSongSourceDocument(fixture)).toBe(true);
    expect(isSongSourceDocument({ ...fixture, forbidden: true })).toBe(false);
    expect(isSongSourceDocument({ ...fixture, defaultTempo: { ...fixture.defaultTempo, bpm: "80" } })).toBe(false);
    expect(isSongSourceDocument({ ...fixture, sourceMeasures: [{ ...fixture.sourceMeasures[0], duration: { n: 8, d: 2 } }] })).toBe(false);
  });

  it("recomputes source and revision-history digests before accepting persisted authority", async () => {
    const fixture = {
      ...sourceFixture({ prefix: "integrity", title: "Title", chord: "C", emphasis: "confirmed-manual" }),
      revisionOrdinal: 0,
      revisionHistoryDigest: await computeRevisionHistoryDigest([]),
    };
    const valid = { ...fixture, revisionDigest: await digestMusicalSource(fixture) };
    expect(await validateSongSourceDocumentIntegrity(valid)).toBe(true);
    expect(await validateSongSourceDocumentIntegrity({ ...valid, revisionDigest: d })).toBe(false);
  });
});
