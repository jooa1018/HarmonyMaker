import type { ArrangementPresetId } from "../domain/config";
import type { GeneratedHarmonyTrackPlan, VocalPlacementRole } from "../domain/performer";
import type { HarmonyProject } from "../domain/project";

export type CandidateHarmonyRole = "H1" | "H2";

export interface ProductTrackRoleMetadata {
  readonly trackPlanId: string;
  readonly harmonyRole: CandidateHarmonyRole;
  readonly placements: readonly {
    readonly phraseId: string;
    readonly placementRole: VocalPlacementRole;
  }[];
  readonly label: string;
}

export interface ProductTrackRoleRegistry {
  readonly generatedTracks: readonly ProductTrackRoleMetadata[];
  readonly byTrackPlanId: Readonly<Record<string, ProductTrackRoleMetadata>>;
}

function placementLabel(placements: readonly ProductTrackRoleMetadata["placements"][number][]): string {
  const roles = [...new Set(placements.map((placement) => placement.placementRole))];
  return roles.length === 1 ? (roles[0] === "upper" ? "Upper" : "Lower") : "Upper/Lower";
}

function registry(entries: readonly ProductTrackRoleMetadata[]): ProductTrackRoleRegistry {
  return {
    generatedTracks: entries,
    byTrackPlanId: Object.fromEntries(entries.map((entry) => [entry.trackPlanId, entry])),
  };
}

export function productTrackRoles(
  project: HarmonyProject,
  presetId: ArrangementPresetId,
  includedTrackPlanIds: readonly string[],
): ProductTrackRoleRegistry {
  const variant = project.variants[presetId];
  if (!variant || variant.lifecycle === "empty") {
    if (includedTrackPlanIds.length === 0) return registry([]);
    throw new RangeError("TRACK_ROLE_METADATA_UNAVAILABLE");
  }
  if (variant.lifecycle !== "generation-attempted" || !variant.candidateHarmonyRoles) {
    throw new RangeError("TRACK_ROLE_METADATA_UNAVAILABLE");
  }
  const included = new Set(includedTrackPlanIds);
  const harmonyRoleByTrackPlanId = Object.fromEntries(variant.candidateHarmonyRoles.map((entry) => [entry.trackPlanId, entry.harmonyRole]));
  const tracks = project.trackPlans
    .filter((track): track is GeneratedHarmonyTrackPlan => track.kind === "generated-harmony" && included.has(track.id))
    .sort((left, right) => left.canonicalOrdinal - right.canonicalOrdinal)
    .map((track): ProductTrackRoleMetadata => {
      const placements = variant.intentPlan.phraseIntents.flatMap((phrase) => {
        const role = phrase.trackRoles.find((candidate) => candidate.trackPlanId === track.id);
        return role ? [{ phraseId: phrase.phraseId, placementRole: role.placementRole }] : [];
      });
      if (placements.length === 0) throw new RangeError(`TRACK_ROLE_METADATA_UNAVAILABLE:${track.id}`);
      const harmonyRole = harmonyRoleByTrackPlanId[track.id];
      if (!harmonyRole) throw new RangeError(`TRACK_ROLE_METADATA_UNAVAILABLE:${track.id}`);
      return { trackPlanId: track.id, harmonyRole, placements, label: `${placementLabel(placements)} / ${harmonyRole}` };
    });
  if (tracks.length !== included.size) throw new RangeError("TRACK_ROLE_METADATA_UNAVAILABLE");
  return registry(tracks);
}

export function trackRoleHasPlacement(metadata: ProductTrackRoleMetadata, role: VocalPlacementRole): boolean {
  return metadata.placements.some((placement) => placement.placementRole === role);
}

export function practiceShareTrackRoles(
  tracks: readonly { readonly kind: "source-lead" | "generated-harmony"; readonly label: string }[],
): ProductTrackRoleRegistry {
  const generated = tracks.filter((track) => track.kind === "generated-harmony").map((track): ProductTrackRoleMetadata => {
    const match = /^(Upper|Lower|Upper\/Lower) \/ (H[12])$/u.exec(track.label);
    if (!match) throw new RangeError("SHARE_TRACK_ROLE_INVALID");
    const placementText = match[1];
    const harmonyRole = match[2] as CandidateHarmonyRole;
    const placements = placementText === "Upper/Lower"
      ? [{ phraseId: "share:phrase:upper", placementRole: "upper" as const }, { phraseId: "share:phrase:lower", placementRole: "lower" as const }]
      : [{ phraseId: "share:phrase:0", placementRole: placementText.toLowerCase() as VocalPlacementRole }];
    return { trackPlanId: `share:track:${harmonyRole.toLowerCase()}`, harmonyRole, placements, label: track.label };
  });
  if (new Set(generated.map((entry) => entry.harmonyRole)).size !== generated.length) throw new RangeError("SHARE_TRACK_ROLE_INVALID");
  return registry(generated.sort((left, right) => left.harmonyRole.localeCompare(right.harmonyRole)));
}
