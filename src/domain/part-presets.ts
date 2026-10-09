import { comparePitches, type PitchRange, type SpelledPitch } from "./pitch";
import type { PerformerProfile } from "./performer";

/**
 * Product defaults for the generated harmony voice. They are practice presets,
 * not a measurement or confirmation of any particular singer's ability. The
 * generated voice is checked against `hardRange` by the existing WAG validator;
 * requests that cannot be met are reported, never silently widened.
 */
export const HARMONY_PART_PRESET_VERSION = "hm-harmony-part-presets-v1" as const;
export type HarmonyPartPreset = "alto" | "tenor";
export const HARMONY_PART_PRESETS: Readonly<Record<HarmonyPartPreset, { readonly labelKo: string; readonly hardRange: PitchRange; readonly comfortableRange: PitchRange }>> = {
  // Sounding pitch. Common choral compass, narrowed for comfortable practice.
  alto: {
    labelKo: "알토",
    hardRange: { low: { step: "F", alter: 0, octave: 3 }, high: { step: "D", alter: 0, octave: 5 } },
    comfortableRange: { low: { step: "A", alter: 0, octave: 3 }, high: { step: "C", alter: 0, octave: 5 } },
  },
  tenor: {
    labelKo: "테너",
    hardRange: { low: { step: "C", alter: 0, octave: 3 }, high: { step: "A", alter: 0, octave: 4 } },
    comfortableRange: { low: { step: "D", alter: 0, octave: 3 }, high: { step: "G", alter: 0, octave: 4 } },
  },
};
export function isHarmonyPartPreset(value: unknown): value is HarmonyPartPreset {
  return value === "alto" || value === "tenor";
}
/** Generated-track performer, assigned in canonical alto → tenor order. */
export function presetPerformer(preset: HarmonyPartPreset, id: "pf:1" | "pf:2" = "pf:1"): PerformerProfile {
  const p = HARMONY_PART_PRESETS[preset];
  return { id, displayName: `${p.labelKo} 프리셋 (${HARMONY_PART_PRESET_VERSION}, 제품 기본값·가수 능력 확인 아님)`, hardRange: p.hardRange, comfortableRange: p.comfortableRange };
}
/**
 * The source Lead is the printed melody, not a singer. For the automatic draft
 * its track needs a performer record; it spans exactly the printed Lead so the
 * melody is never blocked, transposed or trimmed by a hypothetical singer.
 */
export function sourceLeadSpanPerformer(pitches: readonly SpelledPitch[]): PerformerProfile {
  if (!pitches.length) throw new RangeError("AUTO_DRAFT_LEAD_EMPTY");
  const sorted = [...pitches].sort(comparePitches);
  const range = { low: sorted[0], high: sorted.at(-1)! };
  return { id: "pf:0", displayName: "원본 Lead 음역 (악보 그대로, 가수 음역 아님)", hardRange: range, comfortableRange: range };
}
/** Default when the user did not choose: lower harmony under a treble melody. */
export function defaultHarmonyPart(leadMedianMidi: number): HarmonyPartPreset {
  return leadMedianMidi >= 67 ? "alto" : "tenor";
}
