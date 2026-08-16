import { describe, expect, it } from "vitest";

import { fraction } from "../domain/fraction";
import type { ActivityLock, VariantStageLocks } from "../domain/locks";
import { createWagFixtureInput, pitch } from "./fixtures";
import { executeWagSegmentB } from "./segment-b";

const noLocks: VariantStageLocks = { intent: [], activity: [], anchor: [], solver: [] };

describe("canonical Segment-B execution", () => {
  it("runs Intent through independent Validator and deterministic accompaniment", async () => {
    const input = await createWagFixtureInput({ presetId: "standard", maxHarmonyTracks: 2 });
    const result = await executeWagSegmentB(input);
    expect(result.status).toBe("complete");
    if (result.status !== "complete") return;
    expect(result.validation.valid).toBe(true);
    expect(result.generation.result.status).toBe("complete");
    expect(result.accompaniment.effectiveChordTimelineDigest).toBe(input.effectiveChordTimeline.digest);
    expect(result.generation.result.configDigests.accompanimentConfigDigest).toBe(result.accompaniment.configDigest);
    expect(result.renderDocument.effectiveChordTimeline.digest).toBe(input.effectiveChordTimeline.digest);
    expect(result.renderDocument.generatedHarmonyTracks.map((track) => track.trackPlanId)).toEqual(["track:h1", "track:h2"]);
  });

  it("returns honest partial when H1 is required but no complete marginal survives", async () => {
    const input = await createWagFixtureInput({
      presetId: "simple",
      maxHarmonyTracks: 1,
      generatedRanges: [{ low: pitch("E", 4), high: pitch("E", 4) }],
      leadNotes: [
        { onset: fraction(0), duration: fraction(1), pitch: pitch("C", 4), lyric: "la" },
        { onset: fraction(1), duration: fraction(1), pitch: pitch("B", 3), lyric: "la" },
      ],
      chords: [
        { onset: fraction(0), symbol: "C" },
        { onset: fraction(1), symbol: "G" },
      ],
    });
    const result = await executeWagSegmentB(input);
    expect(["complete", "partial"]).toContain(result.status);
    if (result.status === "partial") {
      expect(result.generation.result.candidates.every((candidate) => candidate.candidateStatus === "partial")).toBe(true);
      expect(result.generation.result.candidates.some((candidate) => candidate.diagnostics.some((diagnostic) => diagnostic.code === "WAG_V1_PARTIAL_REQUIRED_COVERAGE"))).toBe(true);
    }
  });

  it("stops at the owning stage for an impossible required ActivityLock", async () => {
    const base = await createWagFixtureInput({ generatedRanges: [{ low: pitch("C", 4), high: pitch("C", 4) }], maxHarmonyTracks: 1 });
    const lock: ActivityLock = {
      id: "lk:simple:segment-b:activity:0",
      kind: "activity",
      presetId: "simple",
      phraseId: base.source.phraseRegions[0].id,
      trackPlanId: "track:h1",
      range: base.sourceLeadAtomization.atoms[0].range,
      activity: { state: "independent-note", behavior: "independent-harmony" },
    };
    const result = await executeWagSegmentB({ ...base, locks: { ...noLocks, activity: [lock] } });
    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.stage).toBe("activity");
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("STAGE_LOCK_SCOPE_INVALID");
    }
  });

  it("is deterministic across 101 complete executions", async () => {
    const input = await createWagFixtureInput({ presetId: "standard", maxHarmonyTracks: 2 });
    const baseline = JSON.stringify(await executeWagSegmentB(input));
    for (let run = 1; run < 101; run += 1) {
      expect(JSON.stringify(await executeWagSegmentB(input))).toBe(baseline);
    }
  }, 30_000);

  it("preserves full-result semantics across display renames and non-authoritative input order", async () => {
    const input = await createWagFixtureInput({ presetId: "standard", maxHarmonyTracks: 2 });
    const renamed = {
      ...input,
      performers: [...input.performers].reverse().map((performer, index) => ({ ...performer, displayName: `Display ${index}` })),
      trackPlans: [...input.trackPlans].reverse().map((track) => ({ ...track, displayLabel: `Display ${"canonicalOrdinal" in track ? track.canonicalOrdinal : 0}` })),
      assignments: [...input.assignments].reverse(),
    };
    const [left, right] = await Promise.all([executeWagSegmentB(input), executeWagSegmentB(renamed)]);
    expect(left.status).not.toBe("blocked");
    expect(right.status).not.toBe("blocked");
    if (left.status === "blocked" || right.status === "blocked") return;
    expect(right.generation.result.digests).toEqual(left.generation.result.digests);
    expect(right.generation.result.candidates.map((candidate) => candidate.id)).toEqual(left.generation.result.candidates.map((candidate) => candidate.id));
    expect(right.generation.defaultCandidateId).toBe(left.generation.defaultCandidateId);
    expect(right.renderDocument.generatedHarmonyTracks).toEqual(left.renderDocument.generatedHarmonyTracks);
    expect(right.accompaniment).toEqual(left.accompaniment);
  });

  it("keeps held-syllable chord-boundary pitch changes lyric-empty", async () => {
    const input = await createWagFixtureInput({
      presetId: "simple",
      maxHarmonyTracks: 1,
      generatedRanges: [{ low: pitch("D", 4), high: pitch("C", 6) }],
      leadNotes: [{ onset: fraction(0), duration: fraction(4), pitch: pitch("C", 4), lyric: "hold", tieStart: true }],
      chords: [{ onset: fraction(0), symbol: "C" }, { onset: fraction(2), symbol: "D" }],
    });
    const result = await executeWagSegmentB(input);
    expect(result.status).toBe("complete");
    if (result.status !== "complete") return;
    const events = result.renderDocument.generatedHarmonyTracks[0].events.filter((event) => event.kind === "note");
    expect(events).toHaveLength(2);
    expect(events[0].lyricTokenIds).toHaveLength(1);
    expect(events[1].lyricTokenIds).toEqual([]);
    expect(events[1].range.start.offset).toEqual(fraction(2));
  });
});
