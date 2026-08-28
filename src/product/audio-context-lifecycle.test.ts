import { describe, expect, it, vi } from "vitest";

import {
  PracticeAudioOwnershipController,
  disposeOwnedAudioSession,
  type OwnedAudioSession,
  type PracticeAudioReleaseReason,
} from "./practice-audio-ownership";

function fakeAudioSession(nodeCount = 2) {
  const close = vi.fn(async () => undefined);
  const stops = Array.from({ length: nodeCount }, () => vi.fn());
  const session: OwnedAudioSession = {
    context: { close } as Pick<AudioContext, "close">,
    nodes: stops.map((stop) => ({ stop }) as Pick<OscillatorNode, "stop">),
    disposed: false,
  };
  return { session, close, stops };
}

const terminalTransitions: readonly PracticeAudioReleaseReason[] = [
  "reset",
  "speed",
  "solo",
  "mute",
  "band",
  "finish",
  "pause",
  "startup-failure",
  "unmount",
  "identity-change",
];

describe("practice AudioContext ownership controller wired by ProductPracticePlayer", () => {
  it.each(terminalTransitions)(
    "drives fake AudioContext/timer through %s with exactly one close/dispose",
    (reason) => {
      const clearTimer = vi.fn();
      const owner = new PracticeAudioOwnershipController<OwnedAudioSession>(clearTimer);
      const { session, close, stops } = fakeAudioSession();
      const timer = { reason } as unknown as ReturnType<typeof setInterval>;
      owner.replace(session);
      expect(owner.installTimer(session, timer)).toBe(true);

      owner.release(reason);
      owner.release(reason);

      expect(owner.active).toBeUndefined();
      expect(clearTimer).toHaveBeenCalledTimes(1);
      expect(clearTimer).toHaveBeenCalledWith(timer);
      expect(close).toHaveBeenCalledTimes(1);
      for (const stop of stops) expect(stop).toHaveBeenCalledTimes(1);
    },
  );

  it("replaces a playing session by closing old and new contexts exactly once", () => {
    const clearTimer = vi.fn();
    const owner = new PracticeAudioOwnershipController<OwnedAudioSession>(clearTimer);
    const first = fakeAudioSession();
    const second = fakeAudioSession();
    const firstTimer = { session: 1 } as unknown as ReturnType<typeof setInterval>;
    const secondTimer = { session: 2 } as unknown as ReturnType<typeof setInterval>;

    owner.replace(first.session);
    owner.installTimer(first.session, firstTimer);
    owner.replace(second.session);
    owner.installTimer(second.session, secondTimer);
    owner.release("unmount");

    expect(first.close).toHaveBeenCalledTimes(1);
    expect(second.close).toHaveBeenCalledTimes(1);
    expect(clearTimer.mock.calls).toEqual([[firstTimer], [secondTimer]]);
  });

  it("clears a timer that arrives after its startup session was superseded", () => {
    const clearTimer = vi.fn();
    const owner = new PracticeAudioOwnershipController<OwnedAudioSession>(clearTimer);
    const first = fakeAudioSession(0);
    const second = fakeAudioSession(0);
    const staleTimer = { stale: true } as unknown as ReturnType<typeof setInterval>;
    owner.replace(first.session);
    owner.replace(second.session);
    expect(owner.installTimer(first.session, staleTimer)).toBe(false);
    expect(clearTimer).toHaveBeenCalledWith(staleTimer);
    owner.release("unmount");
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(second.close).toHaveBeenCalledTimes(1);
  });

  it("closes a context even when startup failed before an oscillator was created", () => {
    const { session, close } = fakeAudioSession(0);
    disposeOwnedAudioSession(session);
    disposeOwnedAudioSession(session);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
