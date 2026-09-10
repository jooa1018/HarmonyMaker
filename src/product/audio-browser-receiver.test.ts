import { describe, expect, it, vi } from "vitest";
import { PracticeAudioOwnershipController, type OwnedAudioSession } from "./practice-audio-ownership";

describe("browser timer receiver at the audio ownership boundary", () => {
  it("releases native-like timers without binding clearInterval to the controller", () => {
    const cleared: ReturnType<typeof setInterval>[] = [];
    // Web IDL timer methods reject a controller object as their receiver. Node's
    // timers and the existing injected spies do not enforce that browser rule.
    vi.stubGlobal("clearInterval", function (this: unknown, timer: ReturnType<typeof setInterval>) {
      if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
      cleared.push(timer);
    });
    try {
      for (const reason of ["pause", "reset", "unmount"] as const) {
        const owner = new PracticeAudioOwnershipController<OwnedAudioSession>();
        const close = vi.fn(async () => undefined);
        const stop = vi.fn();
        const session: OwnedAudioSession = { context: { close }, nodes: [{ stop }], disposed: false };
        const timer = { reason } as unknown as ReturnType<typeof setInterval>;
        owner.replace(session);
        owner.installTimer(session, timer);
        expect(() => owner.release(reason)).not.toThrow();
        owner.release(reason);
        expect(owner.active).toBeUndefined();
        expect(session.disposed).toBe(true);
        expect(close).toHaveBeenCalledTimes(1);
        expect(stop).toHaveBeenCalledTimes(1);
        expect(cleared.filter((value) => value === timer)).toHaveLength(1);
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
