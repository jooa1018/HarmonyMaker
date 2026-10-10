import { afterEach, expect, it, vi } from "vitest";
import type { PlaybackPlan } from "./playback-plan";
import { encodePracticeWav, practiceExportMix, PRACTICE_WAV_PEAK, renderPracticeAudio } from "./render-practice-audio";
import { schedulePracticeAudio } from "./practice-audio";

vi.mock("./practice-audio", () => ({ schedulePracticeAudio: vi.fn() }));
const plan: PlaybackPlan = { events: [], totalQuarter: 8, trackIds: ["track:source-lead", "alto", "tenor", "track:band"], trackLabels: {}, effectiveChordTimelineDigest: "test" };
const input = { plan, tempo: { beatUnit: 4, dotted: false, bpm: 120 } as const, speed: 100 as const, mix: { kind: "full" } as const, bandEnabled: true };
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it("uses balanced defaults or 0.35 other voices while keeping band independently optional", () => {
  const before = JSON.stringify(plan);
  expect(practiceExportMix(plan, {kind:"full"}, true)).toEqual({audible:new Set(plan.trackIds), levels:{"track:source-lead":1,alto:1,tenor:1,"track:band":1},masterLevel:1});
  const mix = practiceExportMix(plan, {kind:"emphasize",trackId:"tenor"}, false);
  expect(mix.levels).toEqual({"track:source-lead":0.35,alto:0.35,tenor:1,"track:band":1});
  expect([...mix.audible]).toEqual(plan.trackIds.slice(0,3));
  expect(practiceExportMix(plan, {kind:"emphasize",trackId:"alto"}, true).audible.has("track:band")).toBe(true);
  expect(JSON.stringify(plan)).toBe(before);
  for (const trackId of ["unknown", "track:band"]) expect(() => practiceExportMix(plan,{kind:"emphasize",trackId},true)).toThrow("PRACTICE_AUDIO_MIX_INVALID");
});

it("writes exact mono PCM16 WAV headers, signed samples and a -1 dBFS peak without clipping", async () => {
  const samples = new Float32Array([0,0.1,-0.2,0.2]);
  const blob = await encodePracticeWav(samples), bytes = await blob.arrayBuffer(), data = new DataView(bytes);
  expect(blob.type).toBe("audio/wav"); expect(blob.size).toBe(52);
  const text = (at:number,n:number) => new TextDecoder().decode(new Uint8Array(bytes,at,n));
  expect([text(0,4),text(8,4),text(12,4),text(36,4)]).toEqual(["RIFF","WAVE","fmt ","data"]);
  expect([data.getUint32(4,true),data.getUint32(16,true),data.getUint16(20,true),data.getUint16(22,true)]).toEqual([44,16,1,1]);
  expect([data.getUint32(24,true),data.getUint32(28,true),data.getUint16(32,true),data.getUint16(34,true),data.getUint32(40,true)]).toEqual([22050,44100,2,16,8]);
  const pcm = Array.from({length:4},(_,i)=>data.getInt16(44+i*2,true));
  expect(pcm).toEqual([0,Math.round(PRACTICE_WAV_PEAK*32767/2),Math.round(-PRACTICE_WAV_PEAK*32767),Math.round(PRACTICE_WAV_PEAK*32767)]);
  expect(pcm.every(x=>Math.abs(x)<32767)).toBe(true);
  expect([...samples]).toEqual([...new Float32Array([0,0.1,-0.2,0.2])]);
});

it("normalizes both quiet and hot input, preserves silence and rejects nonfinite samples", async () => {
  for (const peak of [0.0001,2]) {
    const wav = new DataView(await (await encodePracticeWav(new Float32Array([peak]))).arrayBuffer());
    expect(wav.getInt16(44,true)/32767).toBeCloseTo(PRACTICE_WAV_PEAK,4);
  }
  const silence = new Uint8Array(await (await encodePracticeWav(new Float32Array(4))).arrayBuffer());
  expect([...silence.slice(44)]).toEqual(Array(8).fill(0));
  await expect(encodePracticeWav(new Float32Array([NaN]))).rejects.toThrow("PRACTICE_AUDIO_SAMPLE_INVALID");
});

it("cancels before allocation and during PCM encoding with AbortError", async () => {
  const controller = new AbortController(); controller.abort();
  await expect(renderPracticeAudio({...input,signal:controller.signal})).rejects.toMatchObject({name:"AbortError"});
  expect(schedulePracticeAudio).not.toHaveBeenCalled();
  const during = new AbortController();
  const result = encodePracticeWav(new Float32Array(300000),during.signal); during.abort();
  await expect(result).rejects.toMatchObject({name:"AbortError"});
});

it("uses the live sound scheduler and stops at a prearranged checkpoint after abort", async () => {
  let pause!: () => void;
  const suspend = vi.fn(() => new Promise<void>(resolve=>{pause=resolve;})), resume = vi.fn(async()=>{});
  const startRendering = vi.fn(() => new Promise<AudioBuffer>(()=>{}));
  const constructor = vi.fn();
  vi.stubGlobal("OfflineAudioContext",class { constructor(...args:unknown[]){constructor(...args);} suspend=suspend;resume=resume;startRendering=startRendering; });
  const disconnect = vi.fn(), stop = vi.fn();
  const graph = {nodes:new Set([{stop,disconnect}]),tracks:new Map(),filters:new Map(),master:{disconnect},limiter:{disconnect},output:{disconnect},released:false};
  vi.mocked(schedulePracticeAudio).mockReturnValue(graph as unknown as ReturnType<typeof schedulePracticeAudio>);
  const controller = new AbortController(), result = renderPracticeAudio({...input,signal:controller.signal});
  expect(constructor).toHaveBeenCalledWith(1,88200,22050);
  expect(schedulePracticeAudio).toHaveBeenCalledWith(expect.anything(),plan,expect.objectContaining({fromQuarter:0,startedAt:0,secondsPerQuarter:0.5}));
  expect(suspend).toHaveBeenCalledWith(1);
  controller.abort(); await expect(result).rejects.toMatchObject({name:"AbortError"});
  pause(); await Promise.resolve();
  expect(resume).not.toHaveBeenCalled(); expect(stop).toHaveBeenCalledOnce(); expect(graph.released).toBe(true); expect(graph.nodes.size).toBe(0);
});
