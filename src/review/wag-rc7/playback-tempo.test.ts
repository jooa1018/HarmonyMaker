import { describe, expect, it } from "vitest";
import { scaleRc7AbcTempo } from "./playback-tempo";

describe("rc.7 review playback tempo", () => {
  it("scales simple and compound beat headers deterministically", () => {
    expect(scaleRc7AbcTempo("M:4/4\nQ:1/4=92\nK:C\n", 125)).toContain("Q:1/4=115");
    expect(scaleRc7AbcTempo("M:6/8\nQ:3/8=92\nK:C\n", 75)).toContain("Q:3/8=69");
    expect(scaleRc7AbcTempo("Q:1/4=91", 50)).toBe("Q:1/4=46");
  });

  it("rejects noncanonical speed values", () => {
    expect(() => scaleRc7AbcTempo("Q:1/4=92", 49)).toThrow("RC7_PLAYBACK_SPEED_INVALID");
    expect(() => scaleRc7AbcTempo("Q:1/4=92", 151)).toThrow("RC7_PLAYBACK_SPEED_INVALID");
    expect(() => scaleRc7AbcTempo("Q:1/4=92", 100.5)).toThrow("RC7_PLAYBACK_SPEED_INVALID");
  });
});
