import { describe, expect, it } from "vitest";

import { parseChord } from "../chord/parser";
import { compareCanonicalValues } from "../digest/canonical";
import { fraction } from "../fraction";
import { COMMON_TIME } from "../meter";
import type { SongSourceDocument } from "../source/model";
import { computeRevisionHistoryDigest } from "../source/revision";
import type { ImportedChordDraft, MusicXmlImportDraft } from "../../import/musicxml/types";
import { buildMusicXmlSourceTargetMap, resolveMusicXmlSourceTarget } from "./import-identity";

const versions = { performanceExpanderVersion: "repeat-v1", chordTimelineResolverVersion: "chord-timeline-v1", sourceLeadAtomizerVersion: "source-lead-atomizer-v1" } as const;

function chord(key: string, onset: number, text: string, musicXmlEventOrdinal?: number): ImportedChordDraft {
  return {
    key, partOrdinal: 1, measureOrdinal: 0, onset: fraction(onset), sourceText: text,
    parseResult: parseChord(text), source: musicXmlEventOrdinal === undefined ? "manual" : "musicxml",
    confirmation: "unconfirmed", ...(musicXmlEventOrdinal === undefined ? {} : { musicXmlEventOrdinal }),
  };
}

function draftWithChords(chords: readonly ImportedChordDraft[]): MusicXmlImportDraft {
  const selectedKey = "candidate:p:0:s:1:v:1";
  const otherStaffKey = "candidate:p:0:s:2:v:2";
  const measureBase = { ordinal: 0, number: 1, implicit: false, time: COMMON_TIME, duration: fraction(4), textEvents: [], repeat: { startRepeat: false } };
  return {
    importerVersion: "hm-musicxml-import-v1", documentId: "doc:identity:test", rawDigest: "a".repeat(64) as never,
    containerKind: "xml", title: "Identity", selectedLeadStaffKey: selectedKey,
    parts: [
      { partOrdinal: 0, displayPartName: "Lead", measures: [{ ...measureBase, chords: [], leadEvents: [
        { kind: "note", candidateKey: selectedKey, musicXmlEventOrdinal: 0, onset: fraction(0), duration: fraction(4), pitch: { step: "C", alter: 0, octave: 4 }, tieStart: false, tieStop: false, lyrics: [] },
        { kind: "rest", candidateKey: otherStaffKey, musicXmlEventOrdinal: 0, onset: fraction(0), duration: fraction(4) },
      ] }] },
      { partOrdinal: 1, displayPartName: "Harmony", measures: [{ ...measureBase, chords, leadEvents: [] }] },
    ],
    leadCandidates: [
      { key: selectedKey, partOrdinal: 0, staffNumber: 1, voiceKey: "1", displayPartName: "Lead", noteCount: 1, lyricCount: 0, measureCoverage: [0] },
      { key: otherStaffKey, partOrdinal: 0, staffNumber: 2, voiceKey: "2", displayPartName: "Lead", noteCount: 0, lyricCount: 0, measureCoverage: [0] },
    ],
    musicXmlIdentityInventory: {
      leadEvents: [
        { candidateKey: selectedKey, partOrdinal: 0, staffNumber: 1, voiceKey: "1", measureOrdinal: 0, eventOrdinal: 0 },
        { candidateKey: otherStaffKey, partOrdinal: 0, staffNumber: 2, voiceKey: "2", measureOrdinal: 0, eventOrdinal: 0 },
      ],
      chordEvents: [
        { partOrdinal: 1, measureOrdinal: 0, eventOrdinal: 0 },
        { partOrdinal: 1, measureOrdinal: 0, eventOrdinal: 1 },
        { partOrdinal: 2, measureOrdinal: 0, eventOrdinal: 0 },
      ],
      textEvents: [],
    },
    sections: [], sectionOccurrences: [], unsupportedPerformanceFlows: [], defaultKey: { tonic: { step: "C", alter: 0 }, mode: "major" },
    defaultTempo: { beatUnit: 4, dotted: false, bpm: 100 }, algorithmVersions: versions,
    singerCount: 1, performerSlots: [{ id: "pf:0", displayName: "Lead" }], diagnostics: [],
  };
}

async function sourceFor(draft: MusicXmlImportDraft): Promise<SongSourceDocument> {
  const ordered = [...draft.parts[1].measures[0].chords].sort((left, right) => compareCanonicalValues(
    { onset: left.onset, parseResult: left.parseResult, source: left.source, confirmation: left.confirmation },
    { onset: right.onset, parseResult: right.parseResult, source: right.source, confirmation: right.confirmation },
  ));
  return {
    schemaVersion: 9, documentId: draft.documentId, revisionOrdinal: 0, revisionDigest: "b".repeat(64) as never,
    revisionHistory: [], revisionHistoryDigest: await computeRevisionHistoryDigest([]), title: draft.title,
    defaultKey: { tonic: { step: "C", alter: 0 }, mode: "major" }, defaultTempo: { beatUnit: 4, dotted: false, bpm: 100 },
    sourceMeasures: [{
      id: "sm:0", number: 1, implicit: false, time: COMMON_TIME, duration: fraction(4),
      leadEvents: [{ kind: "note", id: "le:0:0", sourceMeasureId: "sm:0", onset: fraction(0), duration: fraction(4), pitch: { step: "C", alter: 0, octave: 4 }, tieStart: false, tieStop: false, lyricTokenIds: [] }],
      chordEvents: ordered.map((item, index) => ({ id: `ch:0:${index}`, sourceMeasureId: "sm:0", onset: item.onset, sourceText: item.sourceText, parseResult: item.parseResult, source: item.source, confirmation: item.confirmation })),
      lyricTokens: [], textEvents: [], repeat: { startRepeat: false },
    }],
    performanceSequence: { expanderVersion: "repeat-v1", occurrences: [{ occurrenceId: "pm:0:0:0", sourceMeasureId: "sm:0", sourceMeasureNumber: 1, occurrenceIndexForSource: 0, performanceIndex: 0, time: COMMON_TIME, duration: fraction(4) }] },
    sectionDefinitions: [], sectionOccurrences: [], phraseRegions: [], rights: { basis: "self-authored", allowedUses: ["generation"] },
  };
}

function chordTarget(map: Awaited<ReturnType<typeof buildMusicXmlSourceTargetMap>>, ordinal: number) {
  return resolveMusicXmlSourceTarget(map, { kind: "chord-event", musicXmlPartOrdinal: 1, measureOrdinal: 0, eventOrdinal: ordinal });
}

describe("immutable MusicXML import identity", () => {
  it("tracks original chord evidence across Quick Review insertion and reorder", async () => {
    const originalG = chord("g", 2, "G", 0);
    const originalAm = chord("am", 3, "Am", 1);
    const inserted = draftWithChords([chord("manual-c", 0, "C"), originalG, originalAm]);
    const insertedSource = await sourceFor(inserted);
    const insertedMap = await buildMusicXmlSourceTargetMap(inserted, insertedSource);
    const orderedInserted = insertedSource.sourceMeasures[0].chordEvents;
    expect(chordTarget(insertedMap, 0)).toEqual({ kind: "chord-event", chordEventId: orderedInserted.find((item) => item.sourceText === "G")!.id });
    expect(chordTarget(insertedMap, 1)).toEqual({ kind: "chord-event", chordEventId: orderedInserted.find((item) => item.sourceText === "Am")!.id });

    const reordered = draftWithChords([{ ...originalG, onset: fraction(4) }, originalAm]);
    const reorderedSource = await sourceFor(reordered);
    const reorderedMap = await buildMusicXmlSourceTargetMap(reordered, reorderedSource);
    expect(chordTarget(reorderedMap, 0)).toEqual({ kind: "chord-event", chordEventId: reorderedSource.sourceMeasures[0].chordEvents.find((item) => item.sourceText === "G")!.id });
    expect(chordTarget(reorderedMap, 1)).toEqual({ kind: "chord-event", chordEventId: reorderedSource.sourceMeasures[0].chordEvents.find((item) => item.sourceText === "Am")!.id });
  });

  it("marks deleted identities and excludes unselected part/staff identities", async () => {
    const deleted = draftWithChords([chord("am", 3, "Am", 1)]);
    const source = await sourceFor(deleted);
    const map = await buildMusicXmlSourceTargetMap(deleted, source);
    expect(map.entries.find((item) => item.selector.kind === "chord-event" && item.selector.musicXmlPartOrdinal === 1 && item.selector.eventOrdinal === 0)).toEqual(expect.objectContaining({ status: "deleted", targets: [] }));
    expect(chordTarget(map, 1)).toEqual({ kind: "chord-event", chordEventId: "ch:0:0" });
    expect(map.entries.some((item) => item.selector.kind === "chord-event" && item.selector.musicXmlPartOrdinal === 2)).toBe(false);
    expect(map.entries.some((item) => item.selector.kind === "voice-event" && item.selector.musicXmlStaffNumber === 2)).toBe(false);
  });
});
