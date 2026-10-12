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
  setValueCurveAtTime(curve: Float32Array, time: number, duration: number) {
    this.events.push({ kind: "curve-start", value: curve[0], time }, { kind: "curve-end", value: curve[curve.length - 1], time: time + duration }); return this;
  }
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
  setPeriodicWave = vi.fn();
}
class Gain extends Node { gain = new Param(); }
class Filter extends Node { frequency = new Param(); Q = new Param(); type = "lowpass"; }
class Compressor extends Node { threshold = new Param(); knee = new Param(); ratio = new Param(); attack = new Param(); release = new Param(); }
function fakeContext() {
  const gains: Gain[] = [], oscillators: Oscillator[] = [];
  const limiter = new Compressor(), filters: Filter[] = [];
  const context = { currentTime: 10, state: "suspended", destination: {},
    createDynamicsCompressor: () => limiter,
    createBiquadFilter: () => { const f = new Filter(); filters.push(f); return f; },
    createPeriodicWave: vi.fn((real: Float32Array, imag: Float32Array) => ({real, imag})),
    close: vi.fn(async () => undefined),
    createGain: () => { const g = new Gain(); gains.push(g); return g; },
    createOscillator: () => { const o = new Oscillator(); oscillators.push(o); return o; } };
  return { context, audio: context as unknown as AudioContext, gains, oscillators, limiter, filters };
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
  it("lowers only Lead audio by one octave and leaves plan bytes and timing unchanged", () => {
    const f=fakeContext(), before=JSON.stringify(plan);
    schedulePracticeAudio(f.audio,plan,{...options,leadOctave:-1});
    for (const [i,event] of plan.events.entries()) {
      expect(f.oscillators[i].frequency.value).toBe(440*2**((event.midi-69)/12)/(event.trackId==="track:source-lead"?2:1));
      expect(f.oscillators[i].stop).toHaveBeenCalledWith(options.startedAt+(event.startQuarter+event.durationQuarter)*options.secondsPerQuarter);
    }
    expect(JSON.stringify(plan)).toBe(before);
  });
  it.each([[0,0.5],[3.5,1],[1,0.4]])("lookahead matches full scheduling within 1ms (from %s at %s seconds/quarter)", (fromQuarter,secondsPerQuarter) => {
    vi.useFakeTimers();
    try {
      const long = {...plan,totalQuarter:32,events:Array.from({length:8},(_,i)=>plan.events.map(e=>({...e,eventId:`${i}:${e.eventId}`,startQuarter:e.startQuarter+i*4}))).flat()};
      const full=fakeContext(), live=fakeContext();
      schedulePracticeAudio(full.audio,long,{...options,fromQuarter,secondsPerQuarter});
      const graph=schedulePracticeAudio(live.audio,long,{...options,fromQuarter,secondsPerQuarter,lookahead:true});
      expect(live.oscillators.length).toBeLessThan(full.oscillators.length);
      for(let tick=1;tick<=140;tick++){
        live.context.currentTime=10+tick*0.25;
        vi.advanceTimersByTime(250);
      }
      const notes=(f:ReturnType<typeof fakeContext>)=>f.oscillators.map(o=>[o.start.mock.calls[0][0],o.stop.mock.calls[0][0],o.frequency.value]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]||a[2]-b[2]);
      const actual=notes(live), expected=notes(full);
      expect(actual).toHaveLength(expected.length);
      actual.forEach((note,i)=>note.forEach((value,j)=>expect(Math.abs(value-expected[i][j])).toBeLessThan(0.001)));
      expect(graph.lateStartCount).toBe(0);expect(graph.expiredCount).toBe(0);expect(vi.getTimerCount()).toBe(0);
    } finally {vi.useRealTimers();}
  });

  it("resumes only the unelapsed portion after a delayed refill and counts late starts",()=>{
    vi.useFakeTimers();
    try {
      const f=fakeContext();
      const delayed={...plan,totalQuarter:16,events:[plan.events[0],{...plan.events[1],startQuarter:4},{...plan.events[2],startQuarter:6,durationQuarter:4}]};
      const graph=schedulePracticeAudio(f.audio,delayed,{...options,lookahead:true});
      expect(f.oscillators).toHaveLength(1);
      f.context.currentTime=14;vi.advanceTimersByTime(250);
      expect(f.oscillators).toHaveLength(2);
      const oscillator = f.oscillators[1];
      const start = oscillator.start.mock.calls[0][0];
      expect(start).toBeGreaterThanOrEqual(14);
      expect(start - 14).toBeLessThan(1 / oscillator.frequency.value);
      expect((start - options.startedAt) * oscillator.frequency.value).toBeCloseTo(Math.round((start - options.startedAt) * oscillator.frequency.value), 8);
      expect(f.oscillators[1].stop).toHaveBeenCalledWith(15.05);
      expect(graph.lateStartCount).toBe(1);expect(graph.expiredCount).toBe(1);
    } finally {vi.useRealTimers();}
  });

  it("keeps future sources on the current solo/mute buses and cancels refill on pause/reset",()=>{
    vi.useFakeTimers();
    try {
      const f=fakeContext();
      const future={...plan,totalQuarter:32,events:plan.events.map(e=>({...e,startQuarter:e.startQuarter+8}))};
      const graph=schedulePracticeAudio(f.audio,future,{...options,lookahead:true});
      expect(f.oscillators).toHaveLength(0);
      updatePracticeAudioMix(graph,{audible:new Set(["track:h1"]),levels:{"track:h1":0.5},masterLevel:1});
      f.context.currentTime=13;vi.advanceTimersByTime(250);
      expect(f.oscillators.length).toBeGreaterThan(0);
      expect(graph.tracks.get("track:source-lead")!.gain).toMatchObject({events:expect.arrayContaining([expect.objectContaining({value:0})])});
      const count=f.oscillators.length;
      releasePracticeAudio(graph,f.audio);
      f.context.currentTime=30;vi.advanceTimersByTime(10000);
      expect(f.oscillators).toHaveLength(count);expect(vi.getTimerCount()).toBe(0);
    } finally {vi.useRealTimers();}
  });

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
    const envelope = f.gains[5].gain.events;
    expect(envelope.map(e => e.value)).toEqual([0, 1, 1, 1, 0]);
    expect(envelope[0].time).toBe(10.05);
    expect(envelope.at(-1)!.time).toBeCloseTo(10.051, 10);
    expect(envelope.every((e, i) => i === 0 || e.time >= envelope[i - 1].time)).toBe(true);
    expect(envelope[0].kind).toBe("curve-start");
    expect(envelope[4].kind).toBe("curve-end");
  });

  it("resumes inside sustained notes without scheduling the elapsed notes or moving the remaining end", () => {
    const f = fakeContext();
    schedulePracticeAudio(f.audio, plan, { ...options, fromQuarter: 1.5 });
    expect(f.oscillators).toHaveLength(3);
    expect(f.oscillators[0].start).toHaveBeenCalledWith(10.05);
    expect(f.oscillators[0].stop).toHaveBeenCalledWith(10.3);
    expect(f.oscillators[1].stop).toHaveBeenCalledWith(11.3);
  });

  it.each([0.075, 0.15, 0.225, 0.3, 0.375, 0.45, 0.525, 0.6, 0.675, 0.75].flatMap(delay =>
    ([0, -1] as const).map(leadOctave => ({ delay, leadOctave }))))("aligns staggered unisons and octaves at $delay s with Lead octave $leadOctave", ({delay, leadOctave}) => {
    const f = fakeContext();
    const events = [72, 72, 60].map((midi, i) => ({ ...plan.events[0], eventId: String(i), midi,
      startQuarter: i ? delay / options.secondsPerQuarter : 0, durationQuarter: 1 }));
    const input = { ...plan, events }, before = JSON.stringify(input);
    schedulePracticeAudio(f.audio, input, {...options, leadOctave});
    for (const [i, oscillator] of f.oscillators.entries()) {
      const start = oscillator.start.mock.calls[0][0], frequency = oscillator.frequency.value;
      const onset = options.startedAt + events[i].startQuarter * options.secondsPerQuarter;
      expect(start).toBeLessThanOrEqual(onset);
      expect(onset - start).toBeLessThan(1 / frequency);
      const cycles = (start - options.startedAt) * frequency;
      expect(cycles).toBeCloseTo(Math.round(cycles), 8);
      expect(f.gains[5 + i].gain.value).toBe(0);
      expect(f.gains[5 + i].gain.events[0].time).toBe(onset);
    }
    expect(JSON.stringify(input)).toBe(before);
  });

  it("uses separate track and master buses; live mix never restarts or duplicates sources", () => {
    const f = fakeContext(), graph = schedulePracticeAudio(f.audio, plan, options);
    expect([...graph.tracks.values()].map(g => g.gain.value)).toEqual([PRACTICE_AUDIO_GAINS.lead, PRACTICE_AUDIO_GAINS.harmony, PRACTICE_AUDIO_GAINS.band]);
    expect(graph.master.gain.value).toBe(1);
    updatePracticeAudioMix(graph, { audible: new Set(["track:h1"]), levels: { "track:h1": 1.5 }, masterLevel: 0.5 });
    expect(f.gains[2].gain.events.at(-1)?.value).toBe(0);
    expect(f.gains[3].gain.events.at(-1)?.value).toBe(PRACTICE_AUDIO_GAINS.harmony * 1.5);
    expect(f.gains[4].gain.events.at(-1)?.value).toBe(0);
    expect(f.gains[0].gain.events.at(-1)?.value).toBe(0.5);
    for (const node of f.oscillators) expect(node.start).toHaveBeenCalledOnce();
    expect(graph.scheduledCount).toBe(4);
    expect(f.gains[3].gain.events[0].kind).toBe("hold");
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
      expect(f.gains[0].gain.events.at(-1)).toEqual({ kind: "ramp", value: 0, time: 10.08 });
      for (const node of f.oscillators) expect(node.stop).toHaveBeenLastCalledWith(10.08);
      vi.runAllTimers();
      expect(f.context.close).toHaveBeenCalledOnce();
      expect(graph.nodes.size).toBe(0);
      expect(f.limiter.disconnect).toHaveBeenCalledOnce();
      for (const filter of f.filters) expect(filter.disconnect).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });

  it("closes every replaced playing context after rapid seeks and cancels every refill", () => {
    vi.useFakeTimers();
    try {
      const sessions=Array.from({length:20},()=>fakeContext());
      for(const f of sessions){
        const graph=schedulePracticeAudio(f.audio,{...plan,totalQuarter:32,events:plan.events.map(e=>({...e,startQuarter:e.startQuarter+8}))},{...options,lookahead:true});
        f.context.currentTime=13;vi.advanceTimersByTime(250);f.context.state="running";
        releasePracticeAudio(graph,f.audio);
      }
      vi.advanceTimersByTime(101);
      for(const f of sessions)expect(f.context.close).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally {vi.useRealTimers();}
  });

  it("uses harmonic waves through per-track lowpass filters and one post-master limiter", () => {
    const f = fakeContext(), graph = schedulePracticeAudio(f.audio, {...plan, trackRoles:{"track:h1":"lower"}}, options);
    expect(graph.master.connect).toBeDefined();
    expect(f.gains[0].outputs).toEqual([f.limiter]);
    expect(f.limiter.outputs).toEqual([graph.output]);
    expect(f.gains[1].outputs).toEqual([f.context.destination]);
    expect(graph.output.gain.value).toBe(0.6);
    expect(f.limiter.threshold.value).toBe(-9);
    expect(f.limiter.ratio.value).toBe(20);
    expect(f.filters.map(filter => filter.frequency.value)).toEqual([2600,1800,900]);
    expect(f.context.createPeriodicWave).toHaveBeenCalledTimes(3);
    for (const oscillator of f.oscillators) expect(oscillator.setPeriodicWave).toHaveBeenCalledOnce();
  });
});
