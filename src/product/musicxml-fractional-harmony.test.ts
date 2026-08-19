import { describe, expect, it } from "vitest";

import { parseChord } from "../domain/chord/parser";
import type { SemanticDigest } from "../domain/digest/canonical";
import { fraction } from "../domain/fraction";
import type { ArrangementRenderDocument } from "../domain/generation/model";
import { COMMON_TIME } from "../domain/meter";
import { musicalRange } from "../domain/time";
import { importMusicXml } from "../import/musicxml/parser";
import { exportArrangementMusicXml } from "./musicxml-export";

const digest = "0".repeat(64) as SemanticDigest;
const versions = {
  performanceExpanderVersion: "repeat-v1",
  chordTimelineResolverVersion: "chord-timeline-v1",
  sourceLeadAtomizerVersion: "source-lead-atomizer-v1",
} as const;
const roles = { generatedTracks: [], byTrackPlanId: {} } as const;

function parsedChord(symbol: string) {
  const result = parseChord(symbol);
  if (result.status !== "ok") throw new Error(`invalid fixture chord: ${symbol}`);
  return result;
}

function documentWithFractionalHarmony(): ArrangementRenderDocument {
  const measureDurations = [fraction(4)];
  return {
    measures: [{
      occurrenceId: "pm:0:0:0",
      sourceMeasureId: "sm:0",
      sourceMeasureNumber: 1,
      occurrenceIndexForSource: 0,
      performanceIndex: 0,
      time: COMMON_TIME,
      duration: fraction(4),
    }],
    sourceLeadTrack: {
      trackPlanId: "track:source-lead",
      atomizationDigest: digest,
      atoms: [{
        id: "ta:0",
        sourceEventId: "le:0",
        range: musicalRange(
          { performanceMeasureIndex: 0, offset: fraction(0) },
          { performanceMeasureIndex: 1, offset: fraction(0) },
          measureDurations,
        ),
        pitch: { step: "C", alter: 0, octave: 4 },
        tiedFromPrevious: false,
        tiedToNext: false,
        lyricTokenIds: [],
      }],
    },
    generatedHarmonyTracks: [],
    effectiveChordTimeline: {
      sourceChordProjectionDigest: digest,
      performanceSequenceDigest: digest,
      resolutionPolicy: { gapPolicy: "carry-until-next" },
      chordTimelineResolverVersion: "chord-timeline-v1",
      spans: [
        {
          id: "pcs:0",
          range: musicalRange(
            { performanceMeasureIndex: 0, offset: fraction(0) },
            { performanceMeasureIndex: 0, offset: fraction(1, 3) },
            measureDurations,
          ),
          parseResult: parsedChord("C"),
          origin: { kind: "source-event", sourceChordEventId: "ch:0" },
        },
        {
          id: "pcs:1",
          range: musicalRange(
            { performanceMeasureIndex: 0, offset: fraction(1, 3) },
            { performanceMeasureIndex: 0, offset: fraction(2, 3) },
            measureDurations,
          ),
          parseResult: parsedChord("F"),
          origin: { kind: "source-event", sourceChordEventId: "ch:1" },
        },
        {
          id: "pcs:2",
          range: musicalRange(
            { performanceMeasureIndex: 0, offset: fraction(2, 3) },
            { performanceMeasureIndex: 1, offset: fraction(0) },
            measureDurations,
          ),
          parseResult: parsedChord("G"),
          origin: { kind: "source-event", sourceChordEventId: "ch:2" },
        },
      ],
      digest,
    },
    lyricTokens: [],
  };
}

describe("MusicXML fractional harmony authority", () => {
  it("includes harmony offset denominators in divisions and round-trips exact onsets", async () => {
    const encoded = exportArrangementMusicXml(documentWithFractionalHarmony(), roles, {
      title: "Fractional harmony",
      key: { tonic: { step: "C", alter: 0 }, mode: "major" },
      tempo: { beatUnit: 4, dotted: false, bpm: 96 },
    });

    expect(encoded).toContain("<divisions>3</divisions>");
    expect(encoded).toContain("<offset>1</offset>");
    expect(encoded).toContain("<offset>2</offset>");
    expect(encoded).not.toMatch(/<offset>[^<]*\.[^<]*<\/offset>/u);

    const imported = await importMusicXml(new TextEncoder().encode(encoded), {
      algorithmVersions: versions,
      identityFactory: () => "doc:fractional-harmony",
    });
    expect(imported.status).toBe("review-required");
    if (imported.status !== "review-required") throw new Error("fractional harmony import blocked");
    expect(imported.draft.parts[0].measures[0].chords.map((chord) => chord.onset)).toEqual([
      fraction(0),
      fraction(1, 3),
      fraction(2, 3),
    ]);
  });
});
