import { expect, it } from "vitest";
import { audioChoices, audioDuration, audioFileName, audioSize, initialAudioSettings, renderSilentPreview, silentAudio, type AudioPlayer } from "./audio-export";
const player: AudioPlayer = { speed: 75, solo: "alto", bandEnabled: true, totalSeconds: 96, tracks: [{ id: "lead", label: "멜로디", role: "lead" }, { id: "alto", label: "알토", role: "lower" }] };
it("offers full and only present parts, with melody last in emphasis choices", () => {
  expect(audioChoices(player.tracks).map(choice => choice.label)).toEqual(["전체", "알토 강조", "멜로디 강조"]);
  const tracks = [...player.tracks, { id: "tenor", label: "테너", role: "upper" as const }, { id: "band", label: "반주", role: "band" as const }];
  expect(audioChoices(tracks).map(choice => choice.label)).toEqual(["전체", "알토 강조", "테너 강조", "멜로디 강조"]);
  expect(audioChoices([{ id: "legacy", label: "Upper A", role: "other" }])[1]).toMatchObject({ label: "Upper A 강조", role: "other" });
});
it("copies the solo, speed and accompaniment; absent solos fall back to full", () => {
  expect(initialAudioSettings(player)).toEqual({ mix: { kind: "emphasize", trackId: "alto" }, speed: 75, bandEnabled: true });
  expect(initialAudioSettings({ ...player, solo: undefined, bandEnabled: false }).mix).toEqual({ kind: "full" });
  expect(initialAudioSettings({ ...player, solo: "missing", hasBand: false })).toEqual({ mix: { kind: "full" }, speed: 75, bandEnabled: false });
});
it("keeps useful filename suffixes within 80 characters without forbidden characters or broken emoji", () => {
  expect(audioFileName('시냇가: <나무> / "곡"?*|\\', "알토 강조", 75)).toBe("시냇가 나무  곡 - 알토 강조 - 75%.wav");
  const name = audioFileName("🎵".repeat(100), "테너 강조", 150);
  expect(name.length).toBeLessThanOrEqual(80); expect(name.endsWith(" - 테너 강조 - 150%.wav")).toBe(true);
  expect(name).not.toMatch(/[<>:"/\\|?*\u0000-\u001f]/u);
  expect(audioFileName("...", "전체", 100)).toBe("제목 없는 악보 - 전체 - 100%.wav");
});
it("formats the approved mono WAV estimate", () => {
  expect(audioDuration(96)).toBe("1분 36초"); expect(audioSize(96)).toBe("4.2MB");
});
it("provides a valid short silent WAV only for temporary UI rendering", async () => {
  const result = silentAudio(); const view = new DataView(await result.blob.arrayBuffer());
  expect(result.seconds).toBe(1); expect(result.bytes).toBe(44_144);
  expect(view.getUint16(22, true)).toBe(1); expect(view.getUint32(24, true)).toBe(22_050); expect(view.getUint16(34, true)).toBe(16);
});
it("aborts the temporary renderer", async () => {
  const work = new AbortController(); const result = renderSilentPreview({ ...initialAudioSettings(player), signal: work.signal });
  work.abort(); await expect(result).rejects.toMatchObject({ name: "AbortError" });
});
