import { describe, expect, it } from "vitest";
import { semanticDigest } from "../digest/canonical";
import { fraction } from "../fraction";
import { COMMON_TIME } from "../meter";
import type { PerformanceSequence } from "../performance/repeat";
import { musicalRange } from "../time";
import { isLyricToken, resolveProductionLyricEmphasis } from "./lyrics";
import { makePhraseId, validateRights, validateSectionPartition, type LyricToken, type SourceMeasure } from "./model";
import { createSourceIdRemap, remapSourceId } from "./revision";

const digest = "0".repeat(64) as Awaited<ReturnType<typeof semanticDigest>>;

describe("source canonical contracts", () => {
  it("keeps phrase identity range-based and independent of source revision", () => {
    const range = musicalRange({ performanceMeasureIndex: 0, offset: fraction(0) }, { performanceMeasureIndex: 1, offset: fraction(0) });
    expect(makePhraseId(2, range)).toBe("ph:2:0:0/1:1:0/1");
    expect(makePhraseId(2, range)).toBe(makePhraseId(2, range));
  });

  it("validates section definitions and exact occurrence partition", () => {
    const sourceMeasures: SourceMeasure[] = ["m1", "m2"].map((id, index) => ({ id, number: index + 1, implicit: false, time: COMMON_TIME, duration: fraction(4), leadEvents: [], chordEvents: [], lyricTokens: [], textEvents: [], repeat: { startRepeat: false } }));
    const performance: PerformanceSequence = { expanderVersion: "v", occurrences: sourceMeasures.map((measure, index) => ({ occurrenceId: `pm:${index}:0`, sourceMeasureId: measure.id, sourceMeasureNumber: measure.number, occurrenceIndexForSource: 0, performanceIndex: index, time: COMMON_TIME, duration: fraction(4) })) };
    const definitions = [{ id: "sd:0", type: "verse", label: "Verse", sourceMeasureIds: ["m1", "m2"], confirmation: "confirmed" }] as const;
    const occurrences = [{ id: "so:0", sectionDefinitionId: "sd:0", occurrenceIndex: 0, variant: "base", lyricVerseIndex: 1, startPerformanceMeasureIndex: 0, endPerformanceMeasureIndexExclusive: 2 }] as const;
    expect(validateSectionPartition(definitions, occurrences, sourceMeasures, performance)).toEqual([]);
    expect(validateSectionPartition(definitions, [{ ...occurrences[0], endPerformanceMeasureIndexExclusive: 1 }], sourceMeasures, performance)).toContain("partition:1");
  });

  it("validates rights instead of defaulting to permission", () => {
    expect(validateRights({ basis: "user-confirmed-rights", allowedUses: ["generation"] })).toBe(false);
    expect(validateRights({ basis: "licensed", allowedUses: ["generation"], licenseNote: "licensed" })).toBe(true);
  });

  it("validates lyric emphasis unions and resolves production semantics", () => {
    const base = { id: "ly:0", text: "la", syllabic: "single", leadEventId: "le:0", verse: 1, extend: false } as const;
    const musicXml = { ...base, emphasis: "suggested", emphasisSource: "musicxml-accent" } as const;
    const metric = { ...base, emphasis: "suggested", emphasisSource: "metric-heuristic" } as const;
    expect(isLyricToken(musicXml)).toBe(true);
    expect(isLyricToken({ ...base, emphasis: "none", emphasisSource: "manual" })).toBe(false);
    expect(isLyricToken({ ...base, emphasis: "suggested" })).toBe(false);
    expect(resolveProductionLyricEmphasis(musicXml)).toBe("musicxml-accent-suggested");
    expect(resolveProductionLyricEmphasis(metric)).toBe("none");
    const confirmedManual: LyricToken = { ...base, emphasis: "confirmed", emphasisSource: "manual" };
    const confirmedImported: LyricToken = { ...base, emphasis: "confirmed", emphasisSource: "musicxml-accent" };
    expect(resolveProductionLyricEmphasis(confirmedManual)).toBe(resolveProductionLyricEmphasis(confirmedImported));
  });

  it("maps revision-scoped IDs only for safe mapped-one outcomes", async () => {
    const fromRevision = { documentId: "doc", revisionOrdinal: 0, revisionDigest: digest };
    const toRevision = { documentId: "doc", revisionOrdinal: 1, revisionDigest: digest };
    const remap = await createSourceIdRemap(fromRevision, toRevision, [
      { entityKind: "phrase", fromId: "old", toIds: ["new"], status: "mapped-one" },
      { entityKind: "lead-event", fromId: "split", toIds: ["a", "b"], status: "mapped-many" },
    ]);
    expect(remapSourceId(remap, "phrase", "old")).toEqual(["new"]);
    expect(remapSourceId(remap, "lead-event", "split")).toBeUndefined();
    expect(remap.remapDigest).toHaveLength(64);
  });
});
