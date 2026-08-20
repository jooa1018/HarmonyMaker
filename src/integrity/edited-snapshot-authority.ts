import { APPLICATION_ALGORITHM_VERSION_REGISTRY } from "../app/algorithm-version-registry";
import { semanticDigest } from "../domain/digest/canonical";
import { createDiagnostics, type Diagnostic } from "../domain/diagnostics";
import { digestAppliedOutputEditSet, isArrangementOutputEdit, validateOutputEdits, type ArrangementOutputEdit, type EditedArrangementSnapshot } from "../domain/edit/model";
import type { CandidateOrdinalRegistry } from "../domain/generation/candidate";
import type { ArrangementCandidate, GeneratedHarmonyTrack, GeneratedVoiceEvent, RealizedHarmonyAnchor } from "../domain/generation/model";
import { comparePositions, type MusicalRange } from "../domain/time";
import type { ArrangementActivityPlan, ArrangementAnchorPlan, ArrangementIntentPlan } from "../domain/plans";
import { loadFrozenWagAuthority } from "../grammar/authority";
import type { WagLifecycleInput } from "../grammar/lifecycle";
import { validateEditedSnapshot } from "./edited-snapshot-validation";

export type EditedArrangementMaterialization =
  | { readonly status: "complete"; readonly snapshot: EditedArrangementSnapshot; readonly diagnostics: readonly Diagnostic[] }
  | { readonly status: "blocked"; readonly diagnostics: readonly Diagnostic[] };

const verifiedSnapshots = new WeakSet<object>();

function deepFreeze<T>(value: T, visited = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object" || visited.has(value)) return value;
  visited.add(value);
  for (const child of Object.values(value as Readonly<Record<string, unknown>>)) deepFreeze(child, visited);
  return Object.freeze(value);
}

/** Attest this exact immutable object after canonical production or comparison. */
export function attestVerifiedEditedSnapshot(snapshot: EditedArrangementSnapshot): EditedArrangementSnapshot {
  deepFreeze(snapshot);
  verifiedSnapshots.add(snapshot);
  return snapshot;
}

/** Deserialized or copied snapshots must pass project integrity before rendering. */
export function isVerifiedEditedSnapshot(snapshot: EditedArrangementSnapshot): boolean {
  return verifiedSnapshots.has(snapshot) && Object.isFrozen(snapshot);
}

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

function rangeContains(outer: MusicalRange, inner: MusicalRange): boolean {
  return comparePositions(outer.start, inner.start) <= 0 && comparePositions(inner.end, outer.end) <= 0;
}

function applyEdit(event: GeneratedVoiceEvent, edit: ArrangementOutputEdit, lifecycleInput: WagLifecycleInput): GeneratedVoiceEvent {
  if (edit.kind === "replace-pitch") {
    if (event.kind !== "note") throw new RangeError("EDIT_MATERIALIZATION_BLOCKED");
    return { ...event, pitch: edit.pitch, source: "user-edit" };
  }
  if (edit.kind === "set-tie") {
    if (event.kind !== "note") throw new RangeError("EDIT_MATERIALIZATION_BLOCKED");
    return { ...event, tieStart: edit.tieStart, tieStop: edit.tieStop, source: "user-edit" };
  }
  if (edit.replacement.kind === "rest") return { kind: "rest", id: event.id, range: event.range };
  const atom = lifecycleInput.sourceLeadAtomization.atoms.find((candidate) => rangeContains(candidate.range, event.range));
  const lyricTokenIds = event.kind === "note"
    ? event.lyricTokenIds
    : atom && comparePositions(atom.range.start, event.range.start) === 0 ? atom.lyricTokenIds : [];
  return {
    kind: "note", id: event.id, range: event.range, pitch: edit.replacement.pitch,
    tieStart: edit.replacement.tieStart, tieStop: edit.replacement.tieStop,
    lyricTokenIds, source: "user-edit",
    ...(event.kind === "note" && event.originDirectiveId ? { originDirectiveId: event.originDirectiveId } : {}),
  };
}

function materializedTracks(candidate: ArrangementCandidate, edits: readonly ArrangementOutputEdit[], lifecycleInput: WagLifecycleInput): readonly GeneratedHarmonyTrack[] {
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
      return edit ? applyEdit(event, edit, lifecycleInput) : event;
    }),
  }));
}

function updateAnchors(anchors: readonly RealizedHarmonyAnchor[], tracks: readonly GeneratedHarmonyTrack[]): readonly RealizedHarmonyAnchor[] {
  const byDirective = new Map(tracks.flatMap((track) => track.events.flatMap((event) => event.kind === "note" && event.originDirectiveId ? [[event.originDirectiveId, event.pitch] as const] : [])));
  return anchors.map((anchor) => byDirective.has(anchor.directiveId) ? { ...anchor, pitch: byDirective.get(anchor.directiveId)! } : anchor);
}

function preservesRequiredAnchorProvenance(candidate: ArrangementCandidate, edits: readonly ArrangementOutputEdit[]): boolean {
  const events = new Map(Object.values(candidate.generatedEventsByTrack).flat().map((event) => [event.id, event]));
  return edits.every((edit) => {
    if (edit.kind !== "replace-event" || edit.replacement.kind !== "rest") return true;
    const original = events.get(edit.oldEventId);
    return original?.kind !== "note" || original.originDirectiveId === undefined;
  });
}

function tiesAreStructurallyValid(tracks: readonly GeneratedHarmonyTrack[]): boolean {
  return tracks.every((track) => {
    const events = track.events.slice().sort((left, right) => comparePositions(left.range.start, right.range.start));
    return events.every((event, index) => {
      if (event.kind !== "note") return true;
      const previous = events[index - 1];
      const next = events[index + 1];
      const validStart = !event.tieStart || (next?.kind === "note" && comparePositions(event.range.end, next.range.start) === 0 && event.pitch.step === next.pitch.step && event.pitch.alter === next.pitch.alter && event.pitch.octave === next.pitch.octave && next.tieStop);
      const validStop = !event.tieStop || (previous?.kind === "note" && comparePositions(previous.range.end, event.range.start) === 0 && previous.pitch.step === event.pitch.step && previous.pitch.alter === event.pitch.alter && previous.pitch.octave === event.pitch.octave && previous.tieStart);
      return validStart && validStop;
    });
  });
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
  if (!preservesRequiredAnchorProvenance(candidate, orderedEdits)) return blocked("EDIT_MATERIALIZATION_BLOCKED", "required-anchor-provenance");
  let tracks: readonly GeneratedHarmonyTrack[];
  try { tracks = materializedTracks(candidate, orderedEdits, lifecycleInput); } catch { return blocked("EDIT_MATERIALIZATION_BLOCKED", "target-provenance"); }
  if (!tiesAreStructurallyValid(tracks)) return blocked("EDIT_MATERIALIZATION_BLOCKED", "tie-structure");
  const realizedAnchors = updateAnchors(candidate.realizedAnchors, tracks);
  const registry = ordinals(lifecycleInput, anchorPlan);
  const validation = await validateEditedSnapshot({ lifecycleInput, intentPlan, activityPlan, anchorPlan, tracks, realizedAnchors });
  const finalMetrics = validation.metrics;
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
  return { status: "complete", snapshot: attestVerifiedEditedSnapshot(snapshot), diagnostics: validation.diagnostics };
}
