import type { PracticeSpeed } from "../../product/playback-plan";
import type { PlayerController } from "./practice";

export type AudioMix = { kind: "full" } | { kind: "emphasize"; trackId: string };
export type AudioSettings = { speed: PracticeSpeed; mix: AudioMix; bandEnabled: boolean };
export type AudioResult = { blob: Blob; seconds: number; bytes: number };
export type AudioRenderer = (input: AudioSettings & { signal: AbortSignal }) => Promise<AudioResult>;
export type AudioPlayer = Pick<PlayerController, "tracks" | "solo" | "speed" | "bandEnabled" | "hasBand" | "totalSeconds">;
export function audioChoices(tracks: AudioPlayer["tracks"]) {
  const voices = tracks.filter(track => track.role !== "band");
  const order = { lower: 0, upper: 1, other: 2, lead: 3, band: 4 };
  return [{ id: "", label: "전체", description: `${voices.map(track => track.label).join("·")}를 같은 크기로`, role: "other" },
    ...[...voices].sort((a, b) => order[a.role] - order[b.role]).map(track => ({ id: track.id, label: `${track.label} 강조`, description: `${track.label}는 크게, 나머지는 작게`, role: track.role }))];
}
export function initialAudioSettings(player: AudioPlayer): AudioSettings {
  const solo = player.tracks.find(track => track.id === player.solo && track.role !== "band");
  return { mix: solo ? { kind: "emphasize", trackId: solo.id } : { kind: "full" }, speed: player.speed as PracticeSpeed, bandEnabled: player.hasBand !== false && player.bandEnabled };
}
function clean(value: string) { return value.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/gu, "").trim().replace(/[. ]+$/u, ""); }
function limit(value: string, length: number) { let result = ""; for (const char of value) { if (result.length + char.length > length) break; result += char; } return result; }
export function audioFileName(title: string, mixLabel: string, speed: number): string {
  const suffix = ` - ${limit(clean(mixLabel), 40) || "전체"} - ${speed}%.wav`;
  return `${limit(clean(title) || "제목 없는 악보", 80 - suffix.length).trimEnd()}${suffix}`;
}
export function audioDuration(seconds: number): string { const value = Math.max(0, Math.ceil(seconds)); return value >= 60 ? `${Math.floor(value / 60)}분 ${value % 60}초` : `${value}초`; }
export function audioSize(seconds: number): string { return `${(seconds * 44_100 / 1_000_000).toFixed(1)}MB`; }
export function canShareAudio(file?: File): boolean { try { return !!file && typeof navigator.share === "function" && navigator.canShare?.({ files: [file] }) === true; } catch { return false; } }

/** Silent WAV for deterministic design fixtures only. LivePractice uses H1's renderer. */
export function silentAudio(seconds = 1): AudioResult {
  const bytes = Math.round(seconds * 22_050) * 2;
  const buffer = new ArrayBuffer(44 + bytes), view = new DataView(buffer);
  const word = (offset: number, value: string) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  word(0, "RIFF"); view.setUint32(4, bytes + 36, true); word(8, "WAVE"); word(12, "fmt "); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 22_050, true); view.setUint32(28, 44_100, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  word(36, "data"); view.setUint32(40, bytes, true);
  return { blob: new Blob([buffer], { type: "audio/wav" }), seconds, bytes: buffer.byteLength };
}
export const renderSilentPreview: AudioRenderer = async ({ signal }) => {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 700);
    signal.addEventListener("abort", abort, { once: true });
  });
  signal.throwIfAborted();
  return silentAudio();
};
