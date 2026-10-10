import type { TempoSpec } from "../domain/source/model";
import { PRACTICE_SPEEDS, quarterSeconds, type PlaybackPlan, type PracticeSpeed } from "./playback-plan";
import { schedulePracticeAudio, type PracticeAudioGraph, type PracticeAudioMix } from "./practice-audio";

export const PRACTICE_WAV_SAMPLE_RATE = 22050;
export const PRACTICE_WAV_PEAK = 10 ** (-1 / 20);
export interface RenderPracticeAudioInput {
  readonly plan: PlaybackPlan;
  readonly tempo: TempoSpec;
  readonly speed: PracticeSpeed;
  readonly mix: { readonly kind: "full" } | { readonly kind: "emphasize"; readonly trackId: string };
  readonly bandEnabled: boolean;
  readonly signal?: AbortSignal;
}
const abortError = () => new DOMException("연습 음원 만들기를 취소했어요.", "AbortError");
function checkAbort(signal?: AbortSignal): void { if (signal?.aborted) throw abortError(); }
const yieldTask = () => new Promise<void>(resolve => setTimeout(resolve, 0));

export function practiceExportMix(plan: PlaybackPlan, mix: RenderPracticeAudioInput["mix"], bandEnabled: boolean): PracticeAudioMix {
  if (mix.kind !== "full" && (mix.kind !== "emphasize" || !plan.trackIds.includes(mix.trackId) || mix.trackId === "track:band")) {
    throw new RangeError("PRACTICE_AUDIO_MIX_INVALID");
  }
  return {
    audible: new Set(plan.trackIds.filter(id => id !== "track:band" || bandEnabled)),
    levels: Object.fromEntries(plan.trackIds.map(id => [id, mix.kind === "emphasize" && id !== mix.trackId && id !== "track:band" ? 0.35 : 1])),
    masterLevel: 1,
  };
}

/** Mono PCM16 RIFF. Yield between blocks so cancellation also works during encoding. */
export async function encodePracticeWav(samples: Float32Array, signal?: AbortSignal): Promise<Blob> {
  checkAbort(signal);
  if (samples.length * 2 + 36 > 0xffffffff) throw new RangeError("PRACTICE_AUDIO_SIZE_INVALID");
  const block = 262144;
  let peak = 0;
  for (let offset = 0; offset < samples.length; offset += block) {
    for (let i = offset; i < Math.min(offset + block, samples.length); i++) {
      if (!Number.isFinite(samples[i])) throw new RangeError("PRACTICE_AUDIO_SAMPLE_INVALID");
      peak = Math.max(peak, Math.abs(samples[i]));
    }
    await yieldTask(); checkAbort(signal);
  }
  const buffer = new ArrayBuffer(44 + samples.length * 2), data = new DataView(buffer);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) data.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, "RIFF"); data.setUint32(4, buffer.byteLength - 8, true); text(8, "WAVE");
  text(12, "fmt "); data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, 1, true);
  data.setUint32(24, PRACTICE_WAV_SAMPLE_RATE, true); data.setUint32(28, PRACTICE_WAV_SAMPLE_RATE * 2, true);
  data.setUint16(32, 2, true); data.setUint16(34, 16, true); text(36, "data"); data.setUint32(40, samples.length * 2, true);
  const scale = peak > 0 ? PRACTICE_WAV_PEAK / peak : 0;
  for (let offset = 0; offset < samples.length; offset += block) {
    for (let i = offset; i < Math.min(offset + block, samples.length); i++) {
      data.setInt16(44 + i * 2, Math.round(samples[i] * scale * 32767), true);
    }
    await yieldTask(); checkAbort(signal);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function disconnectGraph(graph: PracticeAudioGraph): void {
  graph.released = true;
  for (const node of graph.nodes) { try { node.stop(); } catch { /* Already ended. */ } node.disconnect(); }
  graph.nodes.clear();
  for (const bus of graph.tracks.values()) bus.disconnect();
  for (const filter of graph.filters.values()) filter.disconnect();
  graph.master.disconnect(); graph.limiter.disconnect(); graph.output.disconnect();
}

export async function renderPracticeAudio(input: RenderPracticeAudioInput): Promise<{ readonly blob: Blob; readonly seconds: number; readonly bytes: number }> {
  const { plan, tempo, speed, signal } = input;
  checkAbort(signal);
  if (!PRACTICE_SPEEDS.includes(speed) || ![4, 8].includes(tempo.beatUnit) || typeof tempo.dotted !== "boolean"
    || !Number.isFinite(tempo.bpm) || tempo.bpm <= 0) throw new RangeError("PLAYBACK_TIMING_INVALID");
  const secondsPerQuarter = quarterSeconds(tempo, speed), seconds = plan.totalQuarter * secondsPerQuarter;
  const length = Math.ceil(seconds * PRACTICE_WAV_SAMPLE_RATE);
  if (!Number.isSafeInteger(length) || length <= 0 || length * 2 + 36 > 0xffffffff) throw new RangeError("PLAYBACK_TIMING_INVALID");
  const mix = practiceExportMix(plan, input.mix, input.bandEnabled);
  const context = new OfflineAudioContext(1, length, PRACTICE_WAV_SAMPLE_RATE);
  const graph = schedulePracticeAudio(context, plan, { ...mix, fromQuarter: 0, secondsPerQuarter, startedAt: 0 });
  let onAbort: (() => void) | undefined;
  let stopped = false;
  // OfflineAudioContext has no close/cancel API. Prearranged checkpoints let
  // cancellation leave it suspended instead of rendering the rest of a long song.
  // Suspension never advances the audio clock and changes no sample timings.
  const checkpoints = async () => {
    for (let at = 1; at < seconds; at += 1) {
      await context.suspend(at);
      if (stopped || signal?.aborted) return;
      await yieldTask();
      if (stopped || signal?.aborted) return;
      const resumed = context.resume();
      // Schedule the next checkpoint before yielding to the renderer.
      void resumed.catch(() => undefined);
    }
  };
  try {
    const pausing = checkpoints();
    const rendering = context.startRendering();
    const cancelled = new Promise<never>((_, reject) => {
      onAbort = () => { stopped = true; reject(abortError()); };
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
    // Propagate checkpoint failures too, without leaving a rejected promise unhandled.
    const buffer = await Promise.race([rendering, cancelled, pausing.then(() => rendering)]);
    checkAbort(signal);
    const blob = await encodePracticeWav(buffer.getChannelData(0), signal);
    return { blob, seconds: length / PRACTICE_WAV_SAMPLE_RATE, bytes: blob.size };
  } finally {
    stopped = true;
    if (onAbort) signal?.removeEventListener("abort", onAbort);
    disconnectGraph(graph);
  }
}
