import type { ArrangementRenderDocument } from "./model";

/** Validates the Step 2 composition boundary; it does not render or generate music. */
export function validateRenderDocumentAuthority(document: ArrangementRenderDocument): boolean {
  return document.sourceLeadTrack.trackPlanId === "track:source-lead"
    && (!document.sourceRhythmTracks || new Set(document.sourceRhythmTracks.map((track) => track.voice)).size === document.sourceRhythmTracks.length
      && document.sourceRhythmTracks.every((track) => Number.isSafeInteger(track.voice) && track.voice > 0 && track.atoms.every((atom) => atom.pitch === null && atom.lyricTokenIds.length === 0)))
    && document.generatedHarmonyTracks.every((track) => track.trackPlanId !== "track:source-lead")
    && new Set(document.generatedHarmonyTracks.map((track) => track.trackPlanId)).size === document.generatedHarmonyTracks.length;
}
