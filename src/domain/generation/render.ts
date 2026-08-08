import type { ArrangementRenderDocument } from "./model";

/** Validates the Step 2 composition boundary; it does not render or generate music. */
export function validateRenderDocumentAuthority(document: ArrangementRenderDocument): boolean {
  return document.sourceLeadTrack.trackPlanId === "track:source-lead"
    && document.generatedHarmonyTracks.every((track) => track.trackPlanId !== "track:source-lead")
    && new Set(document.generatedHarmonyTracks.map((track) => track.trackPlanId)).size === document.generatedHarmonyTracks.length;
}

