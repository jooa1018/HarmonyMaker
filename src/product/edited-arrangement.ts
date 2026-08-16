import { APPLICATION_ALGORITHM_VERSION_REGISTRY } from "../app/algorithm-version-registry";
import { semanticDigest } from "../domain/digest/canonical";
import { createDiagnostics, type Diagnostic } from "../domain/diagnostics";
import { digestAppliedOutputEditSet, isArrangementOutputEdit, validateOutputEdits, type ArrangementOutputEdit, type EditedArrangementSnapshot } from "../domain/edit/model";
import { buildArrangementCandidate, type CandidateOrdinalRegistry } from "../domain/generation/candidate";
import type { ArrangementCandidate, FullSongMetrics, GeneratedHarmonyTrack, GeneratedVoiceEvent, RealizedHarmonyAnchor } from "../domain/generation/model";
import { pitchMidiNumber } from "../domain/pitch";
import { countRate } from "../domain/rates";
import { comparePositions } from "../domain/time";
import type { ArrangementActivityPlan, ArrangementAnchorPlan, ArrangementIntentPlan } from "../domain/plans";
import { loadFrozenWagAuthority } from "../grammar/authority";
import type { WagLifecycleInput } from "../grammar/lifecycle";
import { validateWagCandidate } from "../grammar/validator";

export type EditedArrangementMaterialization =
  | { readonly status: "complete"; readonly snapshot: EditedArrangementSnapshot; readonly diagnostics: readonly Diagnostic[] }
  | { readonly status: "blocked"; readonly diagnostics: readonly Diagnostic[] };

function ordinals(input: WagLifecycleInput, anchor: ArrangementAnchorPlan): CandidateOrdinalRegistry {
  const trackOrdinalById = Object.fromEntries(input.trackPlans.map((track) => [track.id, track.canonicalOrdinal]));
  const lyricIds = input.source.sourceMeasures.flatMap((measure) => measure.lyricTokens.map((token) => token.id));
  const directives = anchor.phraseAnchorPlans.flatMap((phrase) => phrase.anchorDirectives).slice().sort((left, right) => comparePositions(left.position, right.position) || trackOrdinalById[left.trackPlanId] - trackOrdinalById[right.trackPlanId]);
  return {
    trackOrdinalById,
    lyricOrdinalById: Object.fromEntries(lyricIds.map((id, index) => [id, index])),
    anchorDirectiveOrdinalById: Object.fromEntries(directives.map((directive, index) => [directive.id, index])),
  };
}

function applyEdit(event: GeneratedVoiceEvent, edit: ArrangementOutputEdit): GeneratedVoiceEvent {
  if (edit.kind === "replace-pitch") {
    if (event.kind !== "note") throw new RangeError("EDIT_MATERIALIZATION_BLOCKED");
    return { ...event, pitch: edit.pitch, source: "user-edit" };
  }
  if (edit.kind === "set-tie") {
    if (event.kind !== "note") throw new RangeError("EDIT_MATERIALIZATION_BLOCKED");
    return { ...event, tieStart: edit.tieStart, tieStop: edit.tieStop, source: "user-edit" };
  }
  if (edit.replacement.kind === "rest") return { kind: "rest", id: event.id, range: event.range };
  return {
    kind: "note", id: event.id, range: event.range, pitch: edit.replacement.pitch,
    tieStart: edit.replacement.tieStart, tieStop: edit.replacement.tieStop,
    lyricTokenIds: event.kind === "note" ? event.lyricTokenIds : [], source: "user-edit",
    ...(event.kind === "note" && event.originDirectiveId ? { originDirectiveId: event.originDirectiveId } : {}),
  };
}

function materializedTracks(candidate: ArrangementCandidate, edits: readonly ArrangementOutputEdit[]): readonly GeneratedHarmonyTrack[] {
  const targetToEdit = new Map<string, ArrangementOutputEdit>();
  for (const edit of edits) {
    const target = edit.kind === "replace-event" ? edit.oldEventId : edit.eventId;
    if (targetToEdit.has(target)) throw new RangeError("EDIT_MATERIALIZATION_BLOCKED");
    targetToEdit.set(target, edit);
  }
  return Object.entries(candidate.generatedEventsByTrack).map(([trackPlanId, events]) => ({
    trackPlanId,
    events: events.map((event) => {
      const edit = targetToEdit.get(event.id);
      return edit ? applyEdit(event, edit) : event;
    }),
  }));
}

function updateAnchors(anchors: readonly RealizedHarmonyAnchor[], tracks: readonly GeneratedHarmonyTrack[]): readonly RealizedHarmonyAnchor[] {
  const byDirective = new Map(tracks.flatMap((track) => track.events.flatMap((event) => event.kind === "note" && event.originDirectiveId ? [[event.originDirectiveId, event.pitch] as const] : [])));
  return anchors.map((anchor) => byDirective.has(anchor.directiveId) ? { ...anchor, pitch: byDirective.get(anchor.directiveId)! } : anchor);
}

function metrics(base: FullSongMetrics, tracks: readonly GeneratedHarmonyTrack[], hardDiagnosticCount: number): FullSongMetrics {
  const maxLeapSemitonesByTrack = Object.fromEntries(tracks.map((track) => {
    let previous: number | undefined;
    let max = 0;
    for (const event of track.events) {
      if (event.kind === "rest") { previous = undefined; continue; }
      const midi = pitchMidiNumber(event.pitch);
      if (previous !== undefined) max = Math.max(max, Math.abs(midi - previous));
      previous = midi;
    }
    return [track.trackPlanId, max];
  }));
  const sounding = tracks.reduce((sum, track) => sum + track.events.filter((event) => event.kind === "note").length, 0);
  return { ...base, maxLeapSemitonesByTrack, hardDiagnosticCount, sourceChordRespect: countRate(sounding, sounding) };
}

async function blocked(code: "EDIT_BASE_CANDIDATE_STALE" | "EDIT_MATERIALIZATION_BLOCKED", reason: string): Promise<EditedArrangementMaterialization> {
  const authority = await loadFrozenWagAuthority();
  const diagnostics = await createDiagnostics([{ code, severity: "blocking", messageKo: code, details: { reason } }], authority.diagnostics);
  return { status: "blocked", diagnostics };
}

export async function materializeEditedArrangement(input: {
  readonly lifecycleInput: WagLifecycleInput;
  readonly intentPlan: ArrangementIntentPlan;
  readonly activityPlan: ArrangementActivityPlan;
  readonly anchorPlan: ArrangementAnchorPlan;
  readonly candidate: ArrangementCandidate;
  readonly edits: readonly ArrangementOutputEdit[];
}): Promise<EditedArrangementMaterialization> {
  const { lifecycleInput, intentPlan, activityPlan, anchorPlan, candidate } = input;
  if (candidate.id !== `cand:${candidate.presetId}:${candidate.contentDigest}`
    || candidate.effectiveChordTimelineDigest !== lifecycleInput.effectiveChordTimeline.digest
    || candidate.sourceLeadAtomizationDigest !== lifecycleInput.sourceLeadAtomization.digest) return blocked("EDIT_BASE_CANDIDATE_STALE", "authority");
  if (input.edits.some((edit) => !isArrangementOutputEdit(edit))) return blocked("EDIT_MATERIALIZATION_BLOCKED", "malformed-edit");
  const orderedEdits = input.edits.slice().sort((left, right) => left.editOrdinal - right.editOrdinal || left.id.localeCompare(right.id));
  const eventIds = new Set(Object.values(candidate.generatedEventsByTrack).flat().map((event) => event.id));
  const structuralErrors = validateOutputEdits(candidate.id, candidate.contentDigest, eventIds, orderedEdits);
  if (structuralErrors.length > 0 || new Set(orderedEdits.map((edit) => edit.editOrdinal)).size !== orderedEdits.length) return blocked(structuralErrors.some((error) => error.startsWith("EDIT_BASE_CANDIDATE_STALE")) ? "EDIT_BASE_CANDIDATE_STALE" : "EDIT_MATERIALIZATION_BLOCKED", structuralErrors[0] ?? "duplicate-ordinal");
  let tracks: readonly GeneratedHarmonyTrack[];
  try { tracks = materializedTracks(candidate, orderedEdits); } catch { return blocked("EDIT_MATERIALIZATION_BLOCKED", "target-provenance"); }
  const realizedAnchors = updateAnchors(candidate.realizedAnchors, tracks);
  const registry = ordinals(lifecycleInput, anchorPlan);
  const initialMetrics = metrics(candidate.metrics, tracks, 0);
  const transient = await buildArrangementCandidate({
    presetId: candidate.presetId, candidateStatus: candidate.candidateStatus,
    anchorPlanDigest: candidate.anchorPlanDigest, effectiveConfigDigest: candidate.effectiveConfigDigest,
    presetProfileDigest: candidate.presetProfileDigest, effectiveChordTimelineDigest: candidate.effectiveChordTimelineDigest,
    sourceLeadAtomizationDigest: candidate.sourceLeadAtomizationDigest,
    tracks: tracks.map((track) => ({ trackPlanId: track.trackPlanId, events: track.events.map((event) => {
      const { id: _id, ...payload } = event;
      return payload.kind === "note" && payload.source === "user-edit" ? { ...payload, source: "anchor" as const } : payload;
    }) })),
    realizedAnchors, ordinals: registry, metrics: initialMetrics, diagnostics: candidate.diagnostics,
    canonicalPathKey: candidate.canonicalPathKey,
  });
  const validation = await validateWagCandidate(lifecycleInput, intentPlan, activityPlan, anchorPlan, transient);
  const finalMetrics = metrics(candidate.metrics, tracks, validation.diagnostics.filter((diagnostic) => diagnostic.severity === "blocking" || diagnostic.severity === "error").length);
  const authority = await loadFrozenWagAuthority();
  const appliedEditSetDigest = await digestAppliedOutputEditSet(orderedEdits);
  const directiveOrdinal = registry.anchorDirectiveOrdinalById;
  const trackOrdinal = registry.trackOrdinalById;
  const lyricOrdinal = registry.lyricOrdinalById;
  const contentDigest = await semanticDigest({
    projectionSchema: "hm-edited-arrangement-snapshot-content-v1",
    baseCandidateDigest: candidate.contentDigest,
    effectiveChordTimelineDigest: lifecycleInput.effectiveChordTimeline.digest,
    sourceLeadAtomizationDigest: lifecycleInput.sourceLeadAtomization.digest,
    appliedEditSetDigest,
    editMaterializerVersion: APPLICATION_ALGORITHM_VERSION_REGISTRY.editMaterializerVersion,
    validatorVersion: APPLICATION_ALGORITHM_VERSION_REGISTRY.validatorVersion,
    validatorConfigDigest: authority.wagOwnedConfigDigests.validatorConfigDigest,
    metricsVersion: APPLICATION_ALGORITHM_VERSION_REGISTRY.metricsVersion,
    metricConfigDigest: authority.wagOwnedConfigDigests.metricConfigDigest,
    diagnosticRegistryVersion: authority.diagnostics.registryVersion,
    diagnosticRegistryDigest: authority.diagnostics.registryDigest,
    tracks: tracks.map((track) => ({ trackOrdinal: trackOrdinal[track.trackPlanId], events: track.events.map((event) => event.kind === "rest" ? { kind: "rest", range: event.range } : { kind: "note", range: event.range, pitch: event.pitch, tieStart: event.tieStart, tieStop: event.tieStop, lyricOrdinals: event.lyricTokenIds.map((id) => lyricOrdinal[id]).sort((a, b) => a - b), source: event.source, originDirectiveOrdinal: event.originDirectiveId ? directiveOrdinal[event.originDirectiveId] : null }) })),
    realizedAnchors: realizedAnchors.map((anchor) => ({ directiveOrdinal: directiveOrdinal[anchor.directiveId], trackOrdinal: trackOrdinal[anchor.trackPlanId], position: anchor.position, pitch: anchor.pitch })),
    validation: validation.diagnostics.map((diagnostic) => ({ code: diagnostic.code, severity: diagnostic.severity, blocksGeneration: authority.diagnostics.definitions[diagnostic.code].blocksGeneration, blocksComplete: authority.diagnostics.definitions[diagnostic.code].blocksComplete, ...(diagnostic.location ? { location: diagnostic.location } : {}), ...(diagnostic.details ? { details: diagnostic.details } : {}) })),
    metrics: finalMetrics,
  });
  const snapshot: EditedArrangementSnapshot = {
    id: `es:${candidate.presetId}:${contentDigest}`,
    materializerVersion: APPLICATION_ALGORITHM_VERSION_REGISTRY.editMaterializerVersion,
    validatorVersion: APPLICATION_ALGORITHM_VERSION_REGISTRY.validatorVersion,
    validatorConfigDigest: authority.wagOwnedConfigDigests.validatorConfigDigest,
    metricsVersion: APPLICATION_ALGORITHM_VERSION_REGISTRY.metricsVersion,
    metricConfigDigest: authority.wagOwnedConfigDigests.metricConfigDigest,
    diagnosticRegistryVersion: authority.diagnostics.registryVersion,
    diagnosticRegistryDigest: authority.diagnostics.registryDigest,
    effectiveChordTimelineDigest: lifecycleInput.effectiveChordTimeline.digest,
    sourceLeadAtomizationDigest: lifecycleInput.sourceLeadAtomization.digest,
    presetId: candidate.presetId, baseCandidateId: candidate.id, baseCandidateDigest: candidate.contentDigest,
    appliedEditIds: orderedEdits.map((edit) => edit.id), appliedEditSetDigest,
    generatedHarmonyTracks: tracks, realizedAnchors, metrics: finalMetrics,
    validationDiagnostics: validation.diagnostics, status: validation.valid ? "valid" : "invalid", contentDigest,
  };
  return { status: "complete", snapshot, diagnostics: validation.diagnostics };
}
