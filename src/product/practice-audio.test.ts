import { describe, expect, it, vi } from "vitest";
import type { PlaybackPlan } from "./playback-plan";
import { PRACTICE_AUDIO_GAINS, practiceVolume, releasePracticeAudio, schedulePracticeAudio, updatePracticeAudioMix } from "./practice-audio";
import { PracticeAudioOwnershipController, type OwnedAudioSession } from "./practice-audio-ownership";

class Param {
  value = 1;
  events: { kind: string; value: number; time: number }[] = [];
  setValueAtTime(value: number, time: number) { this.events.push({ kind: "set", value, time }); return this; }
  linearRampToValueAtTime(value: number, time: number) { this.events.push({ kind: "ramp", value, time }); return this; }
  cancelAndHoldAtTime(time: number) { this.events.push({ kind: "hold", value: this.value, time }); return this; }
}
class Node {
  outputs: unknown[] = [];
  connect(target: unknown) { this.outputs.push(target); return target as Node; }
  disconnect = vi.fn();
}
class Oscillator extends Node {
  frequency = new Param();
  type = "sine";
  start = vi.fn();
  stop = vi.fn();
  onended?: () => void;
}
class Gain extends Node { gain = new Param(); }
function fakeContext() {
  const gains: Gain[] = [], oscillators: Oscillator[] = [];
  const context = { currentTime: 10, state: "suspended", destination: {},
    close: vi.fn(async () => undefined),
    createGain: () => { const g = new Gain(); gains.push(g); return g; },
    createOscillator: () => { const o = new Oscillator(); oscillators.push(o); return o; } };
  return { context, audio: context as unknown as AudioContext, gains, oscillators };
}
const plan: PlaybackPlan = {
  totalQuarter: 4, trackIds: ["track:source-lead", "track:h1", "track:band"],
  trackLabels: { "track:source-lead": "Lead", "track:h1": "Lower", "track:band": "Band" }, effectiveChordTimelineDigest: "same",
  events: [
    { eventId: "lead-1", trackId: "track:source-lead", kind: "voice", midi: 69, startQuarter: 0, durationQuarter: 1, lyricOnset: true },
    { eventId: "lead-2", trackId: "track:source-lead", kind: "voice", midi: 69, startQuarter: 1, durationQuarter: 1, lyricOnset: true },
    { eventId: "merged-tie", trackId: "track:h1", kind: "voice", midi: 65, startQuarter: 0, durationQuarter: 4, lyricOnset: false },
    { eventId: "band-1", trackId: "track:band", kind: "band", midi: 48, startQuarter: 0, durationQuarter: 4, lyricOnset: false },
  ],
};
const options = { fromQuarter: 0, secondsPerQuarter: 0.5, startedAt: 10.05, audible: new Set(plan.trackIds), levels: {}, masterLevel: 1 };

describe("practice audio signal and scheduling contract", () => {
  it("preserves every frequency/start/end and sustains a merged tie on one source", () => {
    const f = fakeContext(), before = JSON.stringify(plan);
    const graph = schedulePracticeAudio(f.audio, plan, options);
    expect(graph.scheduledCount).toBe(4);
    for (const [i, event] of plan.events.entries()) {
      expect(f.oscillators[i].frequency.value).toBe(440 * 2 ** ((event.midi - 69) / 12));
      expect(f.oscillators[i].start).toHaveBeenCalledExactlyOnceWith(10.05 + event.startQuarter * 0.5);
      expect(f.oscillators[i].stop).toHaveBeenCalledExactlyOnceWith(10.05 + (event.startQuarter + event.durationQuarter) * 0.5);
    }
    expect(JSON.stringify(plan)).toBe(before);
    expect(f.oscillators[2].start).toHaveBeenCalledTimes(1);
    f.oscillators[0].onended?.();
    expect(graph.nodes.size).toBe(3);
    expect(f.oscillators[0].disconnect).toHaveBeenCalledOnce();
  });

  it("ramps each attack and release inside the exact duration, even for tiny notes", () => {
    const f = fakeContext();
    const short = { ...plan, events: [{ ...plan.events[0], durationQuarter: 0.002 }] };
    schedulePracticeAudio(f.audio, short, options);
    const envelope = f.gains[4].gain.events;
    expect(envelope.map(e => e.value)).toEqual([0, 1, 1, 0]);
    expect(envelope[0].time).toBe(10.05);
    expect(envelope[3].time).toBe(10.051);
    expect(envelope.every((e, i) => i === 0 || e.time > envelope[i - 1].time)).toBe(true);
    expect(envelope[1].kind).toBe("ramp");
    expect(envelope[3].kind).toBe("ramp");
  });

  it("resumes inside sustained notes without scheduling the elapsed notes or moving the remaining end", () => {
    const f = fakeContext();
    schedulePracticeAudio(f.audio, plan, { ...options, fromQuarter: 1.5 });
    expect(f.oscillators).toHaveLength(3);
    expect(f.oscillators[0].start).toHaveBeenCalledWith(10.05);
    expect(f.oscillators[0].stop).toHaveBeenCalledWith(10.3);
    expect(f.oscillators[1].stop).toHaveBeenCalledWith(11.3);
  });

  it("uses separate track and master buses; live mix never restarts or duplicates sources", () => {
    const f = fakeContext(), graph = schedulePracticeAudio(f.audio, plan, options);
    expect([...graph.tracks.values()].map(g => g.gain.value)).toEqual([PRACTICE_AUDIO_GAINS.lead, PRACTICE_AUDIO_GAINS.harmony, PRACTICE_AUDIO_GAINS.band]);
    expect(graph.master.gain.value).toBe(1);
    updatePracticeAudioMix(graph, { audible: new Set(["track:h1"]), levels: { "track:h1": 1.5 }, masterLevel: 0.5 });
    expect(f.gains[1].gain.events.at(-1)?.value).toBe(0);
    expect(f.gains[2].gain.events.at(-1)?.value).toBe(0.048);
    expect(f.gains[3].gain.events.at(-1)?.value).toBe(0);
    expect(f.gains[0].gain.events.at(-1)?.value).toBe(0.5);
    for (const node of f.oscillators) expect(node.start).toHaveBeenCalledOnce();
    expect(graph.scheduledCount).toBe(4);
    expect(f.gains[2].gain.events[0].kind).toBe("hold");
  });

  it("silences invalid volume and rejects malformed timing before allocating nodes", () => {
    expect([NaN, Infinity, -Infinity, -1].map(x => practiceVolume(x))).toEqual([0, 0, 0, 0]);
    expect(practiceVolume(20)).toBe(2);
    expect(practiceVolume(20, 1)).toBe(1);
    const f = fakeContext();
    expect(() => schedulePracticeAudio(f.audio, plan, { ...options, secondsPerQuarter: NaN })).toThrow("PLAYBACK_TIMING_INVALID");
    expect(() => schedulePracticeAudio(f.audio, { ...plan, events: [{ ...plan.events[0], midi: Infinity }] }, options)).toThrow("PLAYBACK_EVENT_INVALID");
    expect(f.oscillators).toHaveLength(0);
    expect(f.gains).toHaveLength(0);
  });

  it("removes ownership immediately but closes a playing context after the scheduled silence, once", () => {
    vi.useFakeTimers();
    try {
      const f = fakeContext(), graph = schedulePracticeAudio(f.audio, plan, options);
      f.context.state = "running";
      const session: OwnedAudioSession = { context: f.audio, nodes: graph.nodes, disposed: false, disposeAudio: () => releasePracticeAudio(graph, f.audio) };
      const owner = new PracticeAudioOwnershipController();
      owner.replace(session); owner.release("pause"); owner.release("reset");
      expect(owner.active).toBeUndefined();
      expect(graph.released).toBe(true);
      expect(f.context.close).not.toHaveBeenCalled();
      expect(f.gains[0].gain.events.at(-1)).toEqual({ kind: "ramp", value: 0, time: 10.008 });
      for (const node of f.oscillators) expect(node.stop).toHaveBeenLastCalledWith(10.008);
      vi.runAllTimers();
      expect(f.context.close).toHaveBeenCalledOnce();
      expect(graph.nodes.size).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});
