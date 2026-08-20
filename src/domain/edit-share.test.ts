import { describe, expect, it } from "vitest";
import type { SemanticDigest } from "./digest/canonical";
import { isReplacementGeneratedEventPayload, validateOutputEdits } from "./edit/model";
import {
  decodePracticeShare, encodePracticeShare, isPracticeSharePayload, type PracticeSharePayload,
} from "./share";

const d = "0".repeat(64) as SemanticDigest;
const validSharePayload: PracticeSharePayload = {
  schemaVersion: 3,
  title: "Fixture",
  tempo: { beatUnit: 4, dotted: false, bpm: 80 },
  key: { tonic: { step: "C", alter: 0 }, mode: "major" },
  presetId: "simple",
  arrangementArtifactDigest: d,
  effectiveChordTimelineDigest: d,
  arrangement: {
    measures: [{ index: 0, sourceMeasureNumber: 1, lyricVerseIndex: 1, timeSignature: [4, 4], duration: [4, 1] }],
    tracks: [{
      kind: "source-lead",
      label: "Lead",
      events: [{ kind: "note", occurrenceIndex: 0, offset: [0, 1], duration: [4, 1], pitch: ["C", 0, 4], lyricTokenIds: ["ly:0"] }],
    }],
  },
  lyrics: [{ id: "ly:0", text: "la", verse: 1, syllabic: "single", extend: false }],
  chords: [{ kind: "no-chord", startOccurrenceIndex: 0, startOffset: [0, 1], endOccurrenceIndex: 1, endOffset: [0, 1] }],
  rightsShareConfirmed: true,
};

describe("Step 2 edit and PracticeShare foundation", () => {
  it("rejects replacement payload authority injection", () => {
    expect(isReplacementGeneratedEventPayload({ kind: "note", pitch: { step: "C", alter: 0, octave: 4 }, tieStart: false, tieStop: false })).toBe(true);
    expect(isReplacementGeneratedEventPayload({ kind: "note", pitch: { step: "C", alter: 0, octave: 4 }, tieStart: false, tieStop: false, id: "injected" })).toBe(false);
    expect(isReplacementGeneratedEventPayload({ kind: "rest", range: "injected" })).toBe(false);
    expect(isReplacementGeneratedEventPayload({ kind: "note", pitch: {}, tieStart: false, tieStop: false })).toBe(false);
  });

  it("binds output edits to an exact base candidate and event", () => {
    const valid = { id: "edit:0", presetId: "simple", baseCandidateId: "cand:0", baseCandidateDigest: d, editOrdinal: 0, kind: "replace-event", oldEventId: "gen:0", replacement: { kind: "rest" } } as const;
    expect(validateOutputEdits("cand:0", d, new Set(["gen:0"]), [valid])).toEqual([]);
    expect(validateOutputEdits("cand:other", d, new Set(["gen:0"]), [valid])).toContain("EDIT_BASE_CANDIDATE_STALE:edit:0");
  });

  it("round-trips a reconstructable PracticeShare domain payload", () => {
    expect(decodePracticeShare(encodePracticeShare(validSharePayload))).toEqual(validSharePayload);
  });

  it("rejects malformed nested PracticeShare values and unknown fields", () => {
    expect(isPracticeSharePayload(validSharePayload)).toBe(true);
    expect(isPracticeSharePayload({ ...validSharePayload, tempo: { ...validSharePayload.tempo, bpm: "80" } })).toBe(false);
    expect(isPracticeSharePayload({ ...validSharePayload, key: { tonic: { step: "H", alter: 0 }, mode: "major" } })).toBe(false);
    expect(isPracticeSharePayload({ ...validSharePayload, presetId: "wide" })).toBe(false);
    expect(isPracticeSharePayload({ ...validSharePayload, arrangementArtifactDigest: "ABC" })).toBe(false);
    expect(isPracticeSharePayload({
      ...validSharePayload,
      arrangement: {
        ...validSharePayload.arrangement,
        tracks: [{
          ...validSharePayload.arrangement.tracks[0],
          events: [{ kind: "note", occurrenceIndex: 0, offset: [0, 1], duration: [5, 1], pitch: ["C", 0, 4] }],
        }],
      },
    })).toBe(false);
    expect(isPracticeSharePayload({ ...validSharePayload, injectedAuthority: "forbidden" })).toBe(false);
    const withMeter = (timeSignature: readonly [number, number], duration: readonly [number, number]) => ({
      ...validSharePayload,
      arrangement: {
        measures: [{ ...validSharePayload.arrangement.measures[0], timeSignature, duration }],
        tracks: [{ ...validSharePayload.arrangement.tracks[0], events: [] }],
      },
    });
    expect(isPracticeSharePayload(withMeter([4, 4], [1, 1]))).toBe(true); // pickup
    expect(isPracticeSharePayload(withMeter([4, 4], [4, 1]))).toBe(true); // full measure
    expect(isPracticeSharePayload(withMeter([6, 8], [1, 1]))).toBe(true); // pickup
    expect(isPracticeSharePayload(withMeter([6, 8], [3, 1]))).toBe(true); // full measure
    expect(isPracticeSharePayload(withMeter([4, 4], [9, 2]))).toBe(false);
    expect(isPracticeSharePayload(withMeter([6, 8], [7, 2]))).toBe(false);
    expect(isPracticeSharePayload(withMeter([4, 4], [10_000_000, 1]))).toBe(false);
    expect(isPracticeSharePayload(withMeter([3, 4], [3, 1]))).toBe(false);
    expect(isPracticeSharePayload(withMeter([4, 8], [2, 1]))).toBe(false);
    expect(isPracticeSharePayload(withMeter([Number.MAX_SAFE_INTEGER, 8], [1, 1]))).toBe(false);
    const withPitch = (pitch: readonly [string, number, number]) => ({
      ...validSharePayload,
      arrangement: {
        ...validSharePayload.arrangement,
        tracks: [{ ...validSharePayload.arrangement.tracks[0], events: [{ ...validSharePayload.arrangement.tracks[0].events[0], pitch }] }],
      },
    });
    expect(isPracticeSharePayload(withPitch(["C", 0, -1]))).toBe(true);
    expect(isPracticeSharePayload(withPitch(["G", 0, 9]))).toBe(true);
    expect(isPracticeSharePayload(withPitch(["C", -2, -1]))).toBe(false);
    expect(isPracticeSharePayload(withPitch(["A", 0, 9]))).toBe(false);
    expect(isPracticeSharePayload(withPitch(["C", 0, Number.MAX_SAFE_INTEGER]))).toBe(false);
  });
});
