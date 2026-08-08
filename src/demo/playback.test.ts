import { describe, expect, it } from "vitest";
import { initialPlaybackState, reducePlayback } from "./playback";

describe("playback state", () => {
  it("keeps the current position across pause and resume, unlike reset", () => {
    const playing = reducePlayback(initialPlaybackState, { type: "played" });
    const paused = reducePlayback(playing, { type: "paused" });
    const resumed = reducePlayback(paused, { type: "played" });
    const reset = reducePlayback(paused, { type: "reset" });

    expect(paused).toMatchObject({ phase: "paused", position: "current" });
    expect(resumed).toMatchObject({ phase: "playing", position: "current" });
    expect(reset).toMatchObject({ phase: "reset", position: "start" });
  });

  it("does not report a failed mixer change as an applied reset", () => {
    const failed = reducePlayback(
      reducePlayback(initialPlaybackState, { type: "played" }),
      { type: "operation-failed", message: "파트 설정 실패" },
    );

    expect(failed.phase).toBe("ready");
    expect(failed.error).toBe("파트 설정 실패");
    expect(failed).not.toEqual(reducePlayback(initialPlaybackState, { type: "mixer-applied" }));
  });
});
