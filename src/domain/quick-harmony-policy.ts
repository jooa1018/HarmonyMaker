import { defaultHarmonyPart, isHarmonyPartPreset, type HarmonyPartPreset } from "./part-presets";
import { pitchMidiNumber } from "./pitch";
import type { SongSourceDocument } from "./source/model";

/** Only the sealed v2 request activates the new part convention. Legacy sources
 * retain their original role selection and sounding-pitch presets. */
export function quickHarmonyParts(source: SongSourceDocument): readonly HarmonyPartPreset[] | undefined {
  const info = source.importInfo;
  if (info?.sourceKind !== "score-workspace" || info.workspaceMetadata.autoDraft?.policyVersion !== "hm-auto-draft-policy-v2") return undefined;
  const marker = JSON.parse(info.workspaceMetadata.autoDraft.marker);
  const parts: unknown = marker.options.harmonyParts;
  if (parts !== undefined) {
    if (!Array.isArray(parts) || !parts.every(isHarmonyPartPreset)) throw new RangeError("AUTO_DRAFT_OPTIONS_INVALID");
    return parts;
  }
  const pitches = source.sourceMeasures.flatMap(m => m.leadEvents).flatMap(e => e.kind === "note" ? [pitchMidiNumber(e.pitch)] : []).sort((a,b) => a-b);
  return [defaultHarmonyPart(pitches[Math.floor(pitches.length / 2)])];
}

export function usesWag11(source: SongSourceDocument): boolean {
  return quickHarmonyParts(source) !== undefined || source.sourceMeasures.some(m =>
    (m.time.numerator === 3 && m.time.denominator === 4) || (m.time.numerator === 12 && m.time.denominator === 8));
}
