import { describe, expect, it } from "vitest";

import { resolvePracticePlayerInitialState } from "./ProductPracticePlayer";

const plan = { trackIds: ["track:lead", "track:H1", "track:H2", "track:band"] } as const;

describe("PracticeShare playback defaults", () => {
  it("applies each serialized default and the combined state exactly", () => {
    expect(resolvePracticePlayerInitialState(plan, { selectedTrackIndex: 2 })).toEqual({ speed: 100, solo: "track:H2", bandEnabled: true });
    expect(resolvePracticePlayerInitialState(plan, { selectedTrackId: "track:H1" })).toEqual({ speed: 100, solo: "track:H1", bandEnabled: true });
    expect(resolvePracticePlayerInitialState(plan, { selectedTrackId: "track:H1", selectedTrackIndex: 2 })).toEqual({ speed: 100, solo: "track:H1", bandEnabled: true });
    expect(resolvePracticePlayerInitialState(plan, { speedPercent: 75 })).toEqual({ speed: 75, bandEnabled: true });
    expect(resolvePracticePlayerInitialState(plan, { accompanimentEnabled: false })).toEqual({ speed: 100, bandEnabled: false });
    expect(resolvePracticePlayerInitialState(plan, { selectedTrackIndex: 1, speedPercent: 125, accompanimentEnabled: false })).toEqual({ speed: 125, solo: "track:H1", bandEnabled: false });
  });

  it("resolves a new share identity from its new payload instead of stale player state", () => {
    const first = resolvePracticePlayerInitialState(plan, { selectedTrackIndex: 1, speedPercent: 50, accompanimentEnabled: false });
    const next = resolvePracticePlayerInitialState(plan, { selectedTrackIndex: 2, speedPercent: 150, accompanimentEnabled: true });
    expect(next).not.toEqual(first);
    expect(next).toEqual({ speed: 150, solo: "track:H2", bandEnabled: true });
  });
});
