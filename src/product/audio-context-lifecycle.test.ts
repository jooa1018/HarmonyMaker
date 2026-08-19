import { describe, expect, it, vi } from "vitest";
import { disposeOwnedAudioSession, type OwnedAudioSession } from "./ProductPracticePlayer";

function fakeSession(nodeCount = 2) {
  const close = vi.fn(async () => undefined);
  const stops = Array.from({ length: nodeCount }, () => vi.fn());
  const session: OwnedAudioSession = {
    context: { close } as Pick<AudioContext, "close">,
    nodes: stops.map((stop) => ({ stop }) as Pick<OscillatorNode, "stop">),
    disposed: false,
  };
  return { session, close, stops };
}

describe("practice AudioContext ownership", () => {
  it.each(["reset", "speed", "solo", "mute", "band", "finish", "pause", "startup-failure", "unmount", "replacement"])(
    "closes every owned context exactly once on %s",
    () => {
      const { session, close, stops } = fakeSession();
      disposeOwnedAudioSession(session);
      disposeOwnedAudioSession(session);
      expect(close).toHaveBeenCalledTimes(1);
      for (const stop of stops) expect(stop).toHaveBeenCalledTimes(1);
    },
  );

  it("closes a context even when no oscillator was created", () => {
    const { session, close } = fakeSession(0);
    disposeOwnedAudioSession(session);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
