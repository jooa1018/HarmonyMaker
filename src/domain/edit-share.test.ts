import { describe, expect, it } from "vitest";
import type { SemanticDigest } from "./digest/canonical";
import { isReplacementGeneratedEventPayload, validateOutputEdits } from "./edit/model";
import { decodePracticeShare, encodePracticeShare, type PracticeSharePayload } from "./share";

const d = "0".repeat(64) as SemanticDigest;

describe("Step 2 edit and PracticeShare foundation", () => {
  it("rejects replacement payload authority injection", () => {
    expect(isReplacementGeneratedEventPayload({ kind: "note", pitch: { step: "C", alter: 0, octave: 4 }, tieStart: false, tieStop: false })).toBe(true);
    expect(isReplacementGeneratedEventPayload({ kind: "note", pitch: { step: "C", alter: 0, octave: 4 }, tieStart: false, tieStop: false, id: "injected" })).toBe(false);
    expect(isReplacementGeneratedEventPayload({ kind: "rest", range: "injected" })).toBe(false);
  });

  it("binds output edits to an exact base candidate and event", () => {
    const valid = { id: "edit:0", presetId: "simple", baseCandidateId: "cand:0", baseCandidateDigest: d, editOrdinal: 0, kind: "replace-event", oldEventId: "gen:0", replacement: { kind: "rest" } } as const;
    expect(validateOutputEdits("cand:0", d, new Set(["gen:0"]), [valid])).toEqual([]);
    expect(validateOutputEdits("cand:other", d, new Set(["gen:0"]), [valid])).toContain("EDIT_BASE_CANDIDATE_STALE:edit:0");
  });

  it("round-trips a reconstructable PracticeShare domain payload", () => {
    const payload: PracticeSharePayload = {
      schemaVersion: 3, title: "Fixture", tempo: { beatUnit: 4, dotted: false, bpm: 80 }, key: { tonic: { step: "C", alter: 0 }, mode: "major" }, presetId: "simple", arrangementArtifactDigest: d, effectiveChordTimelineDigest: d,
      arrangement: { measures: [{ index: 0, sourceMeasureNumber: 1, lyricVerseIndex: 1, timeSignature: [4, 4], duration: [4, 1] }], tracks: [{ kind: "source-lead", label: "Lead", events: [{ kind: "note", occurrenceIndex: 0, offset: [0, 1], duration: [4, 1], pitch: ["C", 0, 4], lyricTokenIds: ["ly:0"] }] }] },
      lyrics: [{ id: "ly:0", text: "la", verse: 1, syllabic: "single", extend: false }], chords: [{ kind: "no-chord", startOccurrenceIndex: 0, startOffset: [0, 1], endOccurrenceIndex: 1, endOffset: [0, 1] }], rightsShareConfirmed: true,
    };
    expect(decodePracticeShare(encodePracticeShare(payload))).toEqual(payload);
  });
});

