import type { ArrangementPresetId } from "../config";
import type { SemanticDigest } from "../digest/canonical";
import type { Diagnostic } from "../diagnostics";
import type { FullSongMetrics, GeneratedHarmonyTrack, RealizedHarmonyAnchor } from "../generation/model";
import type { SpelledPitch } from "../pitch";

interface ArrangementOutputEditBase { readonly id: string; readonly presetId: ArrangementPresetId; readonly baseCandidateId: string; readonly baseCandidateDigest: SemanticDigest; readonly editOrdinal: number }
export type ReplacementGeneratedEventPayload = { readonly kind: "note"; readonly pitch: SpelledPitch; readonly tieStart: boolean; readonly tieStop: boolean } | { readonly kind: "rest" };
export type ArrangementOutputEdit =
  | (ArrangementOutputEditBase & { readonly kind: "replace-pitch"; readonly eventId: string; readonly pitch: SpelledPitch })
  | (ArrangementOutputEditBase & { readonly kind: "replace-event"; readonly oldEventId: string; readonly replacement: ReplacementGeneratedEventPayload })
  | (ArrangementOutputEditBase & { readonly kind: "set-tie"; readonly eventId: string; readonly tieStart: boolean; readonly tieStop: boolean });
export interface EditedArrangementSnapshot { readonly id: string; readonly materializerVersion: string; readonly validatorVersion: string; readonly validatorConfigDigest: SemanticDigest; readonly metricsVersion: string; readonly metricConfigDigest: SemanticDigest; readonly diagnosticRegistryVersion: string; readonly diagnosticRegistryDigest: SemanticDigest; readonly effectiveChordTimelineDigest: SemanticDigest; readonly sourceLeadAtomizationDigest: SemanticDigest; readonly presetId: ArrangementPresetId; readonly baseCandidateId: string; readonly baseCandidateDigest: SemanticDigest; readonly appliedEditIds: readonly string[]; readonly appliedEditSetDigest: SemanticDigest; readonly generatedHarmonyTracks: readonly GeneratedHarmonyTrack[]; readonly realizedAnchors: readonly RealizedHarmonyAnchor[]; readonly metrics: FullSongMetrics; readonly validationDiagnostics: readonly Diagnostic[]; readonly status: "valid" | "invalid"; readonly contentDigest: SemanticDigest }

export function isReplacementGeneratedEventPayload(value: unknown): value is ReplacementGeneratedEventPayload {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Readonly<Record<string, unknown>>;
  const allowed = payload.kind === "rest" ? ["kind"] : ["kind", "pitch", "tieStart", "tieStop"];
  if (Object.keys(payload).some((key) => !allowed.includes(key))) return false;
  return payload.kind === "rest" || (payload.kind === "note" && typeof payload.pitch === "object" && typeof payload.tieStart === "boolean" && typeof payload.tieStop === "boolean");
}

