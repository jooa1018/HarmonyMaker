import type { ArrangementPresetId } from "../config";
import { compareCanonicalValues, semanticDigest, type SemanticDigest } from "../digest/canonical";
import type { Diagnostic } from "../diagnostics";
import type { FullSongMetrics, GeneratedHarmonyTrack, RealizedHarmonyAnchor } from "../generation/model";
import type { SpelledPitch } from "../pitch";
import {
  hasExactKeys, isCanonicalId, isCanonicalSpelledPitch, isPlainRecord, isSemanticDigest,
} from "../validation";

interface ArrangementOutputEditBase { readonly id: string; readonly presetId: ArrangementPresetId; readonly baseCandidateId: string; readonly baseCandidateDigest: SemanticDigest; readonly editOrdinal: number }
export type ReplacementGeneratedEventPayload = { readonly kind: "note"; readonly pitch: SpelledPitch; readonly tieStart: boolean; readonly tieStop: boolean } | { readonly kind: "rest" };
export type ArrangementOutputEdit =
  | (ArrangementOutputEditBase & { readonly kind: "replace-pitch"; readonly eventId: string; readonly pitch: SpelledPitch })
  | (ArrangementOutputEditBase & { readonly kind: "replace-event"; readonly oldEventId: string; readonly replacement: ReplacementGeneratedEventPayload })
  | (ArrangementOutputEditBase & { readonly kind: "set-tie"; readonly eventId: string; readonly tieStart: boolean; readonly tieStop: boolean });
export interface EditedArrangementSnapshot { readonly id: string; readonly materializerVersion: string; readonly validatorVersion: string; readonly validatorConfigDigest: SemanticDigest; readonly metricsVersion: string; readonly metricConfigDigest: SemanticDigest; readonly diagnosticRegistryVersion: string; readonly diagnosticRegistryDigest: SemanticDigest; readonly effectiveChordTimelineDigest: SemanticDigest; readonly sourceLeadAtomizationDigest: SemanticDigest; readonly presetId: ArrangementPresetId; readonly baseCandidateId: string; readonly baseCandidateDigest: SemanticDigest; readonly appliedEditIds: readonly string[]; readonly appliedEditSetDigest: SemanticDigest; readonly generatedHarmonyTracks: readonly GeneratedHarmonyTrack[]; readonly realizedAnchors: readonly RealizedHarmonyAnchor[]; readonly metrics: FullSongMetrics; readonly validationDiagnostics: readonly Diagnostic[]; readonly status: "valid" | "invalid"; readonly contentDigest: SemanticDigest }

export function isReplacementGeneratedEventPayload(value: unknown): value is ReplacementGeneratedEventPayload {
  if (!isPlainRecord(value)) return false;
  if (value.kind === "rest") return hasExactKeys(value, ["kind"]);
  return value.kind === "note"
    && hasExactKeys(value, ["kind", "pitch", "tieStart", "tieStop"])
    && isCanonicalSpelledPitch(value.pitch)
    && typeof value.tieStart === "boolean"
    && typeof value.tieStop === "boolean";
}

export function isArrangementOutputEdit(value: unknown): value is ArrangementOutputEdit {
  if (!isPlainRecord(value)
    || !isCanonicalId(value.id)
    || !["simple", "standard", "full"].includes(String(value.presetId))
    || !isCanonicalId(value.baseCandidateId)
    || !isSemanticDigest(value.baseCandidateDigest)
    || !Number.isSafeInteger(value.editOrdinal)
    || (value.editOrdinal as number) < 0) return false;
  const base = ["id", "presetId", "baseCandidateId", "baseCandidateDigest", "editOrdinal", "kind"];
  if (value.kind === "replace-pitch") {
    return hasExactKeys(value, [...base, "eventId", "pitch"])
      && isCanonicalId(value.eventId)
      && isCanonicalSpelledPitch(value.pitch);
  }
  if (value.kind === "replace-event") {
    return hasExactKeys(value, [...base, "oldEventId", "replacement"])
      && isCanonicalId(value.oldEventId)
      && isReplacementGeneratedEventPayload(value.replacement);
  }
  return value.kind === "set-tie"
    && hasExactKeys(value, [...base, "eventId", "tieStart", "tieStop"])
    && isCanonicalId(value.eventId)
    && typeof value.tieStart === "boolean"
    && typeof value.tieStop === "boolean";
}

export function validateOutputEdits(
  candidateId: string,
  candidateDigest: SemanticDigest,
  candidateEventIds: ReadonlySet<string>,
  edits: readonly ArrangementOutputEdit[],
): readonly string[] {
  const errors: string[] = [];
  const ordinals = new Set<number>();
  for (const edit of edits) {
    if (!isArrangementOutputEdit(edit)) {
      errors.push("EDIT_MATERIALIZATION_BLOCKED:malformed-edit");
      continue;
    }
    if (edit.baseCandidateId !== candidateId || edit.baseCandidateDigest !== candidateDigest) errors.push(`EDIT_BASE_CANDIDATE_STALE:${edit.id}`);
    if (!Number.isSafeInteger(edit.editOrdinal) || edit.editOrdinal < 0 || ordinals.has(edit.editOrdinal)) errors.push(`EDIT_MATERIALIZATION_BLOCKED:${edit.id}`);
    ordinals.add(edit.editOrdinal);
    const eventId = edit.kind === "replace-event" ? edit.oldEventId : edit.eventId;
    if (!candidateEventIds.has(eventId)) errors.push(`EDIT_BASE_CANDIDATE_STALE:${edit.id}:event`);
    if (edit.kind === "replace-event" && !isReplacementGeneratedEventPayload(edit.replacement)) errors.push(`EDIT_MATERIALIZATION_BLOCKED:${edit.id}:payload`);
  }
  return errors;
}

function outputEditProjection(edit: ArrangementOutputEdit): object {
  const common = {
    presetId: edit.presetId,
    baseCandidateDigest: edit.baseCandidateDigest,
    editOrdinal: edit.editOrdinal,
    kind: edit.kind,
  };
  if (edit.kind === "replace-pitch") {
    return { ...common, eventId: edit.eventId, pitch: edit.pitch };
  }
  if (edit.kind === "replace-event") {
    return { ...common, oldEventId: edit.oldEventId, replacement: edit.replacement };
  }
  return {
    ...common,
    eventId: edit.eventId,
    tieStart: edit.tieStart,
    tieStop: edit.tieStop,
  };
}

export async function digestAppliedOutputEditSet(
  edits: readonly ArrangementOutputEdit[],
): Promise<SemanticDigest> {
  if (new Set(edits.map((edit) => edit.editOrdinal)).size !== edits.length) {
    throw new RangeError("duplicate output edit ordinal");
  }
  const projections = edits.map(outputEditProjection).sort(compareCanonicalValues);
  return semanticDigest({
    projectionSchema: "hm-applied-output-edit-set-v1",
    edits: projections,
  });
}
