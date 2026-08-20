import type { ArrangementPresetId } from "../domain/config";
import type { SemanticDigest } from "../domain/digest/canonical";
import type { EditedArrangementSnapshot } from "../domain/edit/model";
import type { ArrangementCandidate, ArrangementRenderDocument, GeneratedHarmonyTrack } from "../domain/generation/model";
import { validateRenderDocumentAuthority } from "../domain/generation/render";
import type { HarmonyProject } from "../domain/project";
import { isVerifiedEditedSnapshot } from "../integrity/edited-snapshot-authority";
import { productTrackRoles, trackRoleHasPlacement, type ProductTrackRoleRegistry } from "./track-roles";

export type ScoreProjection = "lead" | "upper" | "lower" | "full";
export interface MaterializedArrangement {
  readonly document: ArrangementRenderDocument;
  readonly artifactDigest: SemanticDigest;
  readonly artifactKind: "candidate" | "edited-snapshot";
  readonly validity: "valid" | "invalid";
  readonly trackRoles: ProductTrackRoleRegistry;
}

function tracksForCandidate(candidate: ArrangementCandidate): readonly GeneratedHarmonyTrack[] {
  return Object.entries(candidate.generatedEventsByTrack).map(([trackPlanId, events]) => ({ trackPlanId, events }));
}

function activeArtifact(project: HarmonyProject, presetId: ArrangementPresetId): { readonly tracks: readonly GeneratedHarmonyTrack[]; readonly digest: SemanticDigest; readonly kind: "candidate" | "edited-snapshot"; readonly validity: "valid" | "invalid" } {
  const variant = project.variants[presetId];
  if (!variant || variant.lifecycle !== "generation-attempted" || variant.staleness || !variant.activeArrangement) throw new RangeError("ACTIVE_ARRANGEMENT_UNAVAILABLE");
  const active = variant.activeArrangement;
  if (active.kind === "candidate") {
    const candidate = variant.generationResult.candidates.find((item) => item.id === active.candidateId);
    if (!candidate) throw new RangeError("ACTIVE_ARRANGEMENT_UNAVAILABLE");
    return { tracks: tracksForCandidate(candidate), digest: candidate.contentDigest, kind: "candidate", validity: "valid" };
  }
  const snapshot = variant.editedSnapshots.find((item) => item.id === active.snapshotId);
  if (!snapshot) throw new RangeError("ACTIVE_ARRANGEMENT_UNAVAILABLE");
  if (!isVerifiedEditedSnapshot(snapshot)) throw new RangeError("EDIT_SNAPSHOT_UNVERIFIED");
  return { tracks: snapshot.generatedHarmonyTracks, digest: snapshot.contentDigest, kind: "edited-snapshot", validity: snapshot.status };
}

export function materializeActiveArrangement(project: HarmonyProject, presetId: ArrangementPresetId): MaterializedArrangement {
  if (project.chordTimelineState.status !== "resolved" || project.sourceLeadAtomizationState.status !== "resolved") throw new RangeError("PROJECT_AUTHORITY_STALE");
  const artifact = activeArtifact(project, presetId);
  const ordinal = Object.fromEntries(project.trackPlans.map((track) => [track.id, track.canonicalOrdinal]));
  const document: ArrangementRenderDocument = {
    measures: project.source.performanceSequence.occurrences,
    sourceLeadTrack: { trackPlanId: "track:source-lead", atomizationDigest: project.sourceLeadAtomizationState.atomization.digest, atoms: project.sourceLeadAtomizationState.atomization.atoms },
    generatedHarmonyTracks: artifact.tracks.slice().sort((left, right) => ordinal[left.trackPlanId] - ordinal[right.trackPlanId]),
    effectiveChordTimeline: project.chordTimelineState.timeline,
    lyricTokens: project.source.sourceMeasures.flatMap((measure) => measure.lyricTokens),
  };
  if (!validateRenderDocumentAuthority(document)) throw new RangeError("RENDER_DOCUMENT_INVALID");
  const trackRoles = productTrackRoles(project, presetId, document.generatedHarmonyTracks.map((track) => track.trackPlanId));
  return { document, artifactDigest: artifact.digest, artifactKind: artifact.kind, validity: artifact.validity, trackRoles };
}

export function projectRenderDocument(project: HarmonyProject, presetId: ArrangementPresetId, projection: ScoreProjection): MaterializedArrangement {
  const materialized = materializeActiveArrangement(project, presetId);
  if (projection === "full") return materialized;
  const generatedHarmonyTracks = projection === "lead" ? [] : materialized.document.generatedHarmonyTracks.filter((track) => {
    const metadata = materialized.trackRoles.byTrackPlanId[track.trackPlanId];
    return metadata !== undefined && trackRoleHasPlacement(metadata, projection);
  });
  const included = new Set(generatedHarmonyTracks.map((track) => track.trackPlanId));
  const generatedTracks = materialized.trackRoles.generatedTracks.filter((metadata) => included.has(metadata.trackPlanId));
  return {
    ...materialized,
    document: { ...materialized.document, generatedHarmonyTracks },
    trackRoles: { generatedTracks, byTrackPlanId: Object.fromEntries(generatedTracks.map((metadata) => [metadata.trackPlanId, metadata])) },
  };
}

export function selectActiveCandidate(project: HarmonyProject, presetId: ArrangementPresetId, candidateId: string): HarmonyProject {
  const variant = project.variants[presetId];
  if (!variant || variant.lifecycle !== "generation-attempted" || variant.staleness || !variant.generationResult.candidates.some((candidate) => candidate.id === candidateId)) throw new RangeError("ACTIVE_ARRANGEMENT_UNAVAILABLE");
  return { ...project, variants: { ...project.variants, [presetId]: { ...variant, activeArrangement: { kind: "candidate", candidateId } } } };
}

export function selectActiveSnapshot(project: HarmonyProject, presetId: ArrangementPresetId, snapshotId: string): HarmonyProject {
  const variant = project.variants[presetId];
  if (!variant || variant.lifecycle !== "generation-attempted" || variant.staleness || !variant.editedSnapshots.some((snapshot) => snapshot.id === snapshotId)) throw new RangeError("ACTIVE_ARRANGEMENT_UNAVAILABLE");
  return { ...project, variants: { ...project.variants, [presetId]: { ...variant, activeArrangement: { kind: "edited-snapshot", snapshotId } } } };
}

export function canDefaultExportOrShare(materialized: MaterializedArrangement): boolean { return materialized.validity === "valid"; }

export function snapshotFromActive(project: HarmonyProject, presetId: ArrangementPresetId): EditedArrangementSnapshot | undefined {
  const variant = project.variants[presetId];
  if (!variant || variant.lifecycle !== "generation-attempted" || variant.activeArrangement?.kind !== "edited-snapshot") return undefined;
  const snapshotId = variant.activeArrangement.snapshotId;
  return variant.editedSnapshots.find((snapshot) => snapshot.id === snapshotId);
}
