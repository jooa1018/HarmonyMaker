export interface OwnedAudioSession {
  readonly context: Pick<AudioContext, "close">;
  readonly nodes: readonly Pick<OscillatorNode, "stop">[];
  disposed: boolean;
}

export type PracticeAudioReleaseReason =
  | "reset"
  | "speed"
  | "solo"
  | "mute"
  | "band"
  | "finish"
  | "pause"
  | "startup-failure"
  | "unmount"
  | "replacement"
  | "identity-change";

export function disposeOwnedAudioSession(session: OwnedAudioSession | undefined): void {
  if (!session || session.disposed) return;
  session.disposed = true;
  for (const node of session.nodes) {
    try { node.stop(); } catch { /* already stopped */ }
  }
  void session.context.close().catch(() => undefined);
}

/** Owns the exact active context and its polling timer as one resource. */
export class PracticeAudioOwnershipController<T extends OwnedAudioSession> {
  private activeValue?: T;
  private timerValue?: ReturnType<typeof setInterval>;

  constructor(
    // Call the browser timer API as a global function, not with this controller
    // as its receiver (Web IDL otherwise throws before audio can be released).
    private readonly clearTimer: (timer: ReturnType<typeof setInterval>) => void = (timer) => clearInterval(timer),
  ) {}

  get active(): T | undefined { return this.activeValue; }

  isCurrent(session: T): boolean { return this.activeValue === session && !session.disposed; }

  replace(session: T): void {
    this.release("replacement");
    this.activeValue = session;
  }

  installTimer(session: T, timer: ReturnType<typeof setInterval>): boolean {
    if (!this.isCurrent(session)) {
      this.clearTimer(timer);
      return false;
    }
    if (this.timerValue !== undefined) this.clearTimer(this.timerValue);
    this.timerValue = timer;
    return true;
  }

  release(reason: PracticeAudioReleaseReason): void {
    void reason;
    if (this.timerValue !== undefined) this.clearTimer(this.timerValue);
    this.timerValue = undefined;
    const active = this.activeValue;
    this.activeValue = undefined;
    disposeOwnedAudioSession(active);
  }
}
