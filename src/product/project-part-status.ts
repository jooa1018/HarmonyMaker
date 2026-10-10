import type { ArrangementRenderDocument } from "../domain/generation/model";
import type { HarmonyProject } from "../domain/project";
import { comparePositions } from "../domain/time";

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
