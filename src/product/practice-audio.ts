import type { PlaybackPlan } from "./playback-plan";

/** Output amplitude only. These values never enter the musical plan or WAG. */
export const PRACTICE_AUDIO_GAINS = Object.freeze({ lead: 0.34, harmony: 0.30, band: 0.025, master: 1 });
export const PRACTICE_AUDIO_ATTACK_SECONDS = 0.015;
export const PRACTICE_AUDIO_RELEASE_SECONDS = 0.08;
export const PRACTICE_AUDIO_START_LEAD_SECONDS = 0.05;

// Zero slope at both ends prevents a step even on repeated, separate attacks.
const ATTACK_CURVE = Float32Array.from({ length: 33 }, (_, i) => (1 - Math.cos(Math.PI * i / 32)) / 2);
const RELEASE_CURVE = Float32Array.from(ATTACK_CURVE, value => 1 - value);
function timbre(role: string) {
  if (role === "band") return { harmonics: [0, 1, 0.18, 0.05, 0.01], cutoff: 900 };
  if (role === "upper") return { harmonics: [0, 1, 0.45, 0.22, 0.1], cutoff: 2200 };
  if (role === "lower") return { harmonics: [0, 1, 0.35, 0.28, 0.09], cutoff: 1800 };
  return { harmonics: [0, 1, 0.55, 0.22, 0.12], cutoff: 2600 };
}

export interface PracticeAudioMix {
  readonly audible: ReadonlySet<string>;
  /** Multipliers: 1 = the balanced default, 0 = silence, 2 = 200%. */
  readonly levels: Readonly<Record<string, number>>;
  readonly masterLevel: number;
}

export interface PracticeAudioGraph {
  readonly context: BaseAudioContext;
  /** Includes scheduled future sources; ended sources remove themselves. */
  readonly nodes: Set<OscillatorNode>;
  readonly tracks: ReadonlyMap<string, GainNode>;
  readonly master: GainNode;
  readonly limiter: DynamicsCompressorNode;
  readonly output: GainNode;
  readonly filters: ReadonlyMap<string, BiquadFilterNode>;
  readonly startedAt: number;
  readonly endsAt: number;
  readonly scheduledCount: number;
  released: boolean;
}

export function practiceVolume(value: number, maximum = 2): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(maximum, value)) : 0;
}

function trackGain(trackId: string): number {
  return trackId === "track:band" ? PRACTICE_AUDIO_GAINS.band
    : trackId === "track:source-lead" ? PRACTICE_AUDIO_GAINS.lead : PRACTICE_AUDIO_GAINS.harmony;
}

function rampGain(param: AudioParam, value: number, now: number): void {
  // Holding the in-flight value avoids a discontinuity during rapid slider moves.
  param.cancelAndHoldAtTime(now);
  param.linearRampToValueAtTime(value, now + PRACTICE_AUDIO_RELEASE_SECONDS);
}

export function updatePracticeAudioMix(graph: PracticeAudioGraph, mix: PracticeAudioMix): void {
  if (graph.released) return;
  const now = graph.context.currentTime;
  for (const [id, bus] of graph.tracks) {
    const value = mix.audible.has(id) ? trackGain(id) * practiceVolume(mix.levels[id] ?? 1) : 0;
    rampGain(bus.gain, value, now);
  }
  rampGain(graph.master.gain, PRACTICE_AUDIO_GAINS.master * practiceVolume(mix.masterLevel, 1), now);
}

/**
 * Schedule against one audio clock while the live context is suspended. The
 * complete plan is queued before resume, so JS/cursor stalls cannot omit notes.
 * Also accepts OfflineAudioContext for actual deterministic WebAudio rendering.
 */
export function schedulePracticeAudio(
  context: BaseAudioContext,
  plan: PlaybackPlan,
  options: PracticeAudioMix & { readonly fromQuarter: number; readonly secondsPerQuarter: number; readonly startedAt: number },
): PracticeAudioGraph {
  const { fromQuarter, secondsPerQuarter, startedAt } = options;
  if (![fromQuarter, secondsPerQuarter, startedAt, plan.totalQuarter].every(Number.isFinite)
    || fromQuarter < 0 || fromQuarter > plan.totalQuarter || secondsPerQuarter <= 0 || startedAt < context.currentTime
    || !Number.isFinite(startedAt + plan.totalQuarter * secondsPerQuarter)) throw new RangeError("PLAYBACK_TIMING_INVALID");
  for (const event of plan.events) {
    if (![event.startQuarter, event.durationQuarter, event.midi].every(Number.isFinite)
      || event.startQuarter < 0 || event.durationQuarter <= 0 || event.midi < 0 || event.midi > 127
      || event.startQuarter + event.durationQuarter > plan.totalQuarter + 1e-8
      || !plan.trackIds.includes(event.trackId)) throw new RangeError("PLAYBACK_EVENT_INVALID");
  }
  const nodes = new Set<OscillatorNode>();
  const tracks = new Map<string, GainNode>();
  const filters = new Map<string, BiquadFilterNode>();
  const waves = new Map<string, PeriodicWave>();
  const master = context.createGain();
  master.gain.value = PRACTICE_AUDIO_GAINS.master * practiceVolume(options.masterLevel, 1);
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -9;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.12;
  // Web Audio's compressor includes makeup gain. Leave measured output
  // headroom after it instead of assuming threshold is a hard peak ceiling.
  const output = context.createGain();
  output.gain.value = 0.6;
  master.connect(limiter).connect(output).connect(context.destination);
  let scheduledCount = 0;
  try {
    for (const id of plan.trackIds) {
      const bus = context.createGain();
      bus.gain.value = options.audible.has(id) ? trackGain(id) * practiceVolume(options.levels[id] ?? 1) : 0;
      tracks.set(id, bus);
      const tone = timbre(id === "track:band" ? "band" : plan.trackRoles?.[id] ?? "lead");
      const filter = context.createBiquadFilter();
      filters.set(id, filter);
      filter.type = "lowpass";
      filter.frequency.value = tone.cutoff;
      filter.Q.value = 0.5;
      bus.connect(filter).connect(master);
      waves.set(id, context.createPeriodicWave(new Float32Array(tone.harmonics.length), new Float32Array(tone.harmonics)));
    }
    for (const event of plan.events) {
      if (event.startQuarter + event.durationQuarter <= fromQuarter) continue;
      const start = startedAt + (Math.max(event.startQuarter, fromQuarter) - fromQuarter) * secondsPerQuarter;
      const end = startedAt + (event.startQuarter + event.durationQuarter - fromQuarter) * secondsPerQuarter;
      const duration = end - start;
      const oscillator = context.createOscillator();
      nodes.add(oscillator);
      const envelope = context.createGain();
      oscillator.setPeriodicWave(waves.get(event.trackId)!);
      oscillator.frequency.value = 440 * 2 ** ((event.midi - 69) / 12);
      // Short ramps remain inside the original audible range, including short
      // notes. Explicit ties were already merged by the unchanged playback plan.
      const attack = Math.min(PRACTICE_AUDIO_ATTACK_SECONDS, duration / 4);
      const release = Math.min(PRACTICE_AUDIO_RELEASE_SECONDS, duration / 2);
      envelope.gain.setValueCurveAtTime(ATTACK_CURVE, start, attack);
      envelope.gain.setValueAtTime(1, end - release);
      envelope.gain.setValueCurveAtTime(RELEASE_CURVE, end - release, release);
      oscillator.connect(envelope).connect(tracks.get(event.trackId)!);
      oscillator.onended = () => { nodes.delete(oscillator); oscillator.disconnect(); envelope.disconnect(); };
      oscillator.start(start);
      oscillator.stop(end);
      scheduledCount += 1;
    }
  } catch (error) {
    for (const node of nodes) { try { node.stop(); } catch { /* not started */ } node.disconnect(); }
    for (const bus of tracks.values()) bus.disconnect();
    for (const filter of filters.values()) filter.disconnect();
    master.disconnect();
    limiter.disconnect();
    output.disconnect();
    throw error;
  }
  return { context, nodes, tracks, master, limiter, output, filters, startedAt,
    endsAt: startedAt + (plan.totalQuarter - fromQuarter) * secondsPerQuarter, scheduledCount, released: false };
}

/** Ownership is released immediately; the audio clock applies the short tail. */
export function releasePracticeAudio(graph: PracticeAudioGraph, context: AudioContext): void {
  if (graph.released) return;
  graph.released = true;
  const tail = context.state === "running" && graph.nodes.size > 0 ? PRACTICE_AUDIO_RELEASE_SECONDS : 0;
  const stopAt = context.currentTime + tail;
  if (tail) rampGain(graph.master.gain, 0, context.currentTime);
  for (const node of graph.nodes) { try { node.stop(stopAt); } catch { /* already ended */ } }
  const close = () => {
    for (const node of graph.nodes) node.disconnect();
    graph.nodes.clear();
    for (const bus of graph.tracks.values()) bus.disconnect();
    for (const filter of graph.filters.values()) filter.disconnect();
    graph.master.disconnect();
    graph.limiter.disconnect();
    graph.output.disconnect();
    void context.close().catch(() => undefined);
  };
  // This timer only frees an already-silent graph. It never schedules music.
  if (tail) setTimeout(close, (tail + 0.02) * 1000);
  else close();
}
