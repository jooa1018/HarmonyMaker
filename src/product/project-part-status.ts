import type { ArrangementRenderDocument } from "../domain/generation/model";
import type { HarmonyProject } from "../domain/project";
import { comparePositions } from "../domain/time";
import type { ArrangementPresetId } from "../domain/config";
import { quickHarmonyPartReason } from "./quick-harmony-notices";

/** Only recorded, attributable diagnostics can explain a saved partial result.
 * Other candidates may document this requested track's incomplete coverage;
 * unscoped diagnostics from nonselected candidates are not evidence for it. */
export function recordedPartReason(project: HarmonyProject, preset: ArrangementPresetId, trackId: string, part: "alto" | "tenor", coverage: ReturnType<typeof projectPartStatus>): string | undefined {
  if (coverage.status === "complete") return undefined;
  const variant = project.variants[preset];
  if (variant?.lifecycle !== "generation-attempted" || variant.staleness || !variant.activeArrangement) return undefined;
  const active = variant.activeArrangement;
  const diagnostics = active.kind === "edited-snapshot"
    ? variant.editedSnapshots.find(s => s.id === active.snapshotId)?.validationDiagnostics ?? []
    : variant.generationResult.candidates.flatMap(candidate => candidate.diagnostics.filter(diagnostic =>
      candidate.id === active.candidateId || diagnostic.location?.trackPlanIds?.includes(trackId)));
  const recorded = diagnostics.some(diagnostic => diagnostic.code === "WAG_V1_PARTIAL_REQUIRED_COVERAGE"
    && (!diagnostic.location?.trackPlanIds?.length || diagnostic.location.trackPlanIds.includes(trackId)));
  return recorded ? quickHarmonyPartReason(part,coverage.status,coverage.missingMeasures) : undefined;
}

/** Same coverage contract for a newly generated result and a saved active output. */
export function projectPartStatus(project: HarmonyProject, document: ArrangementRenderDocument | undefined, trackId: string | undefined): {
  readonly status: "complete" | "partial" | "missing";
  readonly missingMeasures: readonly number[];
} {
  const atoms = project.sourceLeadAtomizationState.status === "resolved" ? project.sourceLeadAtomizationState.atomization.atoms : [];
  const timeline = project.chordTimelineState.status === "resolved" ? project.chordTimelineState.timeline : undefined;
  // Source rests and N.C. are intentional silence, not missing harmony.
  const eligible = atoms.filter(atom => atom.pitch && timeline?.spans.some(span => span.parseResult.status === "ok"
    && comparePositions(span.range.start, atom.range.end) < 0 && comparePositions(atom.range.start, span.range.end) < 0));
  const notes = document?.generatedHarmonyTracks.find(t => t.trackPlanId === trackId)?.events.filter(e => e.kind === "note") ?? [];
  const missing = eligible.filter(atom => {
    let cursor = atom.range.start;
    for (const note of notes) {
      if (comparePositions(note.range.end, cursor) <= 0) continue;
      if (comparePositions(note.range.start, cursor) > 0) break;
      cursor = note.range.end;
      if (comparePositions(cursor, atom.range.end) >= 0) return false;
    }
    return true;
  });
  const missingMeasures = [...new Set(missing.map(atom => project.source.performanceSequence.occurrences[atom.range.start.performanceMeasureIndex].sourceMeasureNumber))].sort((a,b) => a-b);
  return {status:notes.length === 0 ? "missing" : missing.length ? "partial" : "complete", missingMeasures};
}
