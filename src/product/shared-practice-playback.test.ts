import { describe, expect, it } from "vitest";

import type { SemanticDigest } from "../domain/digest/canonical";
import { isPracticeSharePayload, type PracticeSharePayload } from "../domain/share";
import { buildPlaybackPlanSafely } from "./playback-plan";
import { materializeSharedPractice, materializeSharedPracticeSafely } from "./shared-practice";

const digest = "0".repeat(64) as SemanticDigest;

function payload(measures: PracticeSharePayload["arrangement"]["measures"]): PracticeSharePayload {
  return {
    schemaVersion: 4,
    title: "Timing boundary",
    tempo: { beatUnit: 4, dotted: false, bpm: 80 },
    key: { tonic: { step: "C", alter: 0 }, mode: "major" },
    presetId: "standard",
    arrangementArtifactDigest: digest,
    effectiveChordTimelineDigest: digest,
    arrangement: {
      measures,
      tracks: [{ kind: "source-lead", label: "Lead", events: [] }],
    },
    lyrics: [],
    rightsShareConfirmed: true,
  };
}

describe("public PracticeShare playback timing boundary", () => {
  it.each([
    ["4/4 pickup", [4, 4], [1, 1]],
    ["4/4 full", [4, 4], [4, 1]],
    ["6/8 pickup", [6, 8], [1, 1]],
    ["6/8 full", [6, 8], [3, 1]],
  ] as const)("accepts and consumes %s", (_label, timeSignature, duration) => {
    const candidate = payload([{ index: 0, lyricVerseIndex: 1, timeSignature, duration }]);
    expect(isPracticeSharePayload(candidate)).toBe(true);
    const materialized = materializeSharedPracticeSafely(candidate);
    expect(materialized.status).toBe("available");
    if (materialized.status !== "available") throw new Error("expected materialized share");
    expect(buildPlaybackPlanSafely(materialized.value.document, materialized.value.trackRoles)).toMatchObject({ status: "available" });
  });

  it("rejects the former cumulative overflow counterexample and contains bypassed construction failure", () => {
    const oversized = payload([0, 1].map((index) => ({
      index,
      lyricVerseIndex: 1,
      timeSignature: [4, 4] as const,
      duration: [10_000_000, 1] as const,
    })));
    expect(isPracticeSharePayload(oversized)).toBe(false);

    const bypassed = materializeSharedPractice(oversized);
    expect(buildPlaybackPlanSafely(bypassed.document, bypassed.trackRoles)).toEqual({
      status: "unavailable",
      code: "PLAYBACK_PLAN_UNAVAILABLE",
    });
  });
});
