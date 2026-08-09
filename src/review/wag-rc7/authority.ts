import {
  createPresetProfileRegistry,
  resolveEffectiveArrangementConfig,
} from "../../domain/config";
import {
  canonicalJson,
  compareCanonicalValues,
  semanticDigest,
  type SemanticDigest,
} from "../../domain/digest/canonical";
import type { PlanOrdinalRegistry } from "../../domain/digest/plans";
import { digestIntentInput } from "../../domain/digest/stages";
import type { IntentLock } from "../../domain/locks";
import type { GeneratedHarmonyTrackPlan } from "../../domain/performer";
import { compareRanges } from "../../domain/time";
import {
  createRc7StageConfigDigests,
  verifyFrozenRc7Config,
} from "./config";
import {
  RC7_GRAMMAR_CONFIG_DIGEST,
  RC7_GRAMMAR_VERSION,
  RC7_REVIEW_VERSIONS,
} from "./constants";
import type {
  Rc7AuthoritativeIntentProjection,
  Rc7IntentInputReconstructionWitness,
  Rc7PipelineContext,
  Rc7PreparedCase,
  Rc7VerifiedAssignedTrack,
} from "./types";

export const RC7_ACCEPTED_PROJECTOR_PROVENANCE = Object.freeze({
  repository: "jooa1018/HarmonyMaker",
  path: "src/domain/digest/stages.ts",
  function: "digestIntentInput",
  acceptedBlob: "2ca6a7e18dfaaa3db1c99f6ecb32b959475a2ef8",
  projectionSchema: "hm-intent-input-v1",
  metadataPlacement: "out-of-band-verifier-dependency",
});

function buildOrdinals(prepared: Rc7PreparedCase): PlanOrdinalRegistry {
  const trackEntries = [...prepared.tracks]
    .sort((left, right) => left.canonicalOrdinal - right.canonicalOrdinal)
    .map((track) => [track.id, track.canonicalOrdinal] as const);
  const atoms = [...prepared.sourceLeadAtomization.atoms].sort((left, right) => compareRanges(left.range, right.range));
  const spans = [...prepared.effectiveChordTimeline.spans].sort((left, right) => compareRanges(left.range, right.range));
  return {
    sectionOccurrenceOrdinalById: { [prepared.sectionOccurrence.id]: 0 },
    phraseOrdinalById: { [prepared.phrase.id]: 0 },
    trackOrdinalById: Object.fromEntries(trackEntries),
    leadAtomOrdinalById: Object.fromEntries(atoms.map((atom, ordinal) => [atom.id, ordinal])),
    chordSpanOrdinalById: Object.fromEntries(spans.map((span, ordinal) => [span.id, ordinal])),
  };
}

export async function createRc7PipelineContext(prepared: Rc7PreparedCase): Promise<Rc7PipelineContext> {
  await verifyFrozenRc7Config();
  const registry = await createPresetProfileRegistry("preset-profile-v1");
  const assignedEnabledHarmonyTrackCount = prepared.tracks.filter(
    (track) => track.kind === "generated-harmony" && track.enabled,
  ).length;
  const effectiveConfig = await resolveEffectiveArrangementConfig({
    registry,
    expectedPresetProfileVersion: "preset-profile-v1",
    mode: prepared.mode,
    presetId: prepared.presetId,
    userCaps: prepared.userCaps,
    assignedEnabledHarmonyTrackCount,
  });
  return {
    prepared,
    effectiveConfig,
    ordinals: buildOrdinals(prepared),
    ...await createRc7StageConfigDigests(),
  };
}

function lockProjection(lock: IntentLock, ordinals: PlanOrdinalRegistry): object {
  const phraseOrdinal = ordinals.phraseOrdinalById[lock.phraseId];
  if (!Number.isSafeInteger(phraseOrdinal)) throw new RangeError("STALE_REFERENCE:phrase lock ordinal");
  if (lock.kind === "texture") {
    return {
      presetId: lock.presetId,
      kind: lock.kind,
      phraseOrdinal,
      textureId: lock.textureId,
    };
  }
  const trackOrdinal = ordinals.trackOrdinalById[lock.trackPlanId];
  if (!Number.isSafeInteger(trackOrdinal)) throw new RangeError("STALE_REFERENCE:track lock ordinal");
  return {
    presetId: lock.presetId,
    kind: lock.kind,
    phraseOrdinal,
    trackOrdinal,
    placementRole: lock.placementRole,
  };
}

function canonicalInputPieces(context: Rc7PipelineContext) {
  const { prepared } = context;
  const performers = prepared.performers.map((entry) => ({
    performerOrdinal: entry.performerOrdinal,
    hardRange: entry.profile.hardRange,
    comfortableRange: entry.profile.comfortableRange,
    preferredTessitura: entry.profile.preferredTessitura ?? null,
  })).sort((left, right) => left.performerOrdinal - right.performerOrdinal);
  const tracks = prepared.tracks.map((track) => ({
    trackOrdinal: track.canonicalOrdinal,
    kind: track.kind,
    enabled: track.enabled,
  })).sort((left, right) => left.trackOrdinal - right.trackOrdinal);
  const performerOrdinalById = Object.fromEntries(
    prepared.performers.map((entry) => [entry.profile.id, entry.performerOrdinal]),
  );
  const trackOrdinalById = Object.fromEntries(
    prepared.tracks.map((track) => [track.id, track.canonicalOrdinal]),
  );
  const assignments = prepared.assignments.map((assignment) => {
    const trackOrdinal = trackOrdinalById[assignment.trackPlanId];
    const performerOrdinal = performerOrdinalById[assignment.performerId];
    if (!Number.isSafeInteger(trackOrdinal) || !Number.isSafeInteger(performerOrdinal)) {
      throw new RangeError("STALE_REFERENCE:assignment ordinal graph");
    }
    return { trackOrdinal, performerOrdinal };
  }).sort((left, right) => left.trackOrdinal - right.trackOrdinal);
  const locks = prepared.locks.intent.map((lock) => lockProjection(lock, context.ordinals))
    .sort(compareCanonicalValues);
  return { performers, tracks, assignments, locks };
}

export async function createIntentWitness(context: Rc7PipelineContext): Promise<{
  readonly digest: SemanticDigest;
  readonly witness: Rc7IntentInputReconstructionWitness;
}> {
  const pieces = canonicalInputPieces(context);
  const input = {
    musicalSourceDigest: context.prepared.musicalSourceDigest,
    effectiveChordTimelineDigest: context.prepared.effectiveChordTimeline.digest,
    sourceLeadAtomizationDigest: context.prepared.sourceLeadAtomization.digest,
    atomizerVersion: context.prepared.sourceLeadAtomization.atomizerVersion,
    performers: pieces.performers,
    tracks: pieces.tracks,
    assignments: pieces.assignments,
    mode: context.prepared.mode,
    userCaps: context.prepared.userCaps,
    presetId: context.prepared.presetId,
    effectiveConfigDigest: context.effectiveConfig.digest,
    presetProfileVersion: context.effectiveConfig.presetProfileVersion,
    presetProfileDigest: context.effectiveConfig.presetProfileDigest,
    locks: context.prepared.locks.intent,
    plannerVersion: RC7_REVIEW_VERSIONS.plannerVersion,
    grammarVersion: RC7_GRAMMAR_VERSION,
    plannerConfigDigest: context.plannerConfigDigest,
    grammarConfigDigest: RC7_GRAMMAR_CONFIG_DIGEST as SemanticDigest,
    diagnosticRegistryVersion: RC7_REVIEW_VERSIONS.diagnosticRegistryVersion,
    diagnosticRegistryDigest: context.diagnosticRegistryDigest,
  };
  const digest = await digestIntentInput(input, context.ordinals);
  const projection: Rc7AuthoritativeIntentProjection = {
    projectionSchema: "hm-intent-input-v1",
    ...input,
    locks: pieces.locks,
  };
  const observedDigest = await semanticDigest(projection);
  if (observedDigest !== digest) {
    throw new RangeError("AUTHORITATIVE_PROJECTOR_WITNESS_MISMATCH");
  }
  return {
    digest,
    witness: {
      projectionSchema: "hm-intent-input-reconstruction-witness-v2",
      authoritativeIntentInputProjection: projection,
    },
  };
}

function priorRole(
  prepared: Rc7PreparedCase,
  track: GeneratedHarmonyTrackPlan,
): "upper" | "lower" | null {
  const previous = prepared.priorPersistedPhraseIntent;
  if (!previous) return null;
  return previous.trackRoles.find((role) => role.trackPlanId === track.id)?.placementRole ?? null;
}

export async function verifyIntentWitness(
  context: Rc7PipelineContext,
  expectedDigest: SemanticDigest,
  witness: Rc7IntentInputReconstructionWitness,
): Promise<readonly Rc7VerifiedAssignedTrack[]> {
  if (witness.projectionSchema !== "hm-intent-input-reconstruction-witness-v2") {
    throw new RangeError("STALE_REFERENCE:witness schema");
  }
  const projection = witness.authoritativeIntentInputProjection;
  if (projection.projectionSchema !== "hm-intent-input-v1"
    || "value" in projection
    || "assignedHarmonyTrackContexts" in projection) {
    throw new RangeError("STALE_REFERENCE:non-product projector shape");
  }
  if (await semanticDigest(projection) !== expectedDigest) {
    throw new RangeError("STALE_REFERENCE:intent input digest");
  }
  const current = canonicalInputPieces(context);
  if (canonicalJson(projection.performers) !== canonicalJson(current.performers)
    || canonicalJson(projection.tracks) !== canonicalJson(current.tracks)
    || canonicalJson(projection.assignments) !== canonicalJson(current.assignments)
    || canonicalJson(projection.locks) !== canonicalJson(current.locks)) {
    throw new RangeError("STALE_REFERENCE:current ordinal graph mismatch");
  }

  const trackByOrdinal = new Map(
    context.prepared.tracks
      .filter((track): track is GeneratedHarmonyTrackPlan => track.kind === "generated-harmony")
      .map((track) => [track.canonicalOrdinal, track]),
  );
  const performerByOrdinal = new Map(
    context.prepared.performers.map((entry) => [entry.performerOrdinal, entry.profile]),
  );
  const assignmentByTrackOrdinal = new Map(
    projection.assignments.map((assignment) => [assignment.trackOrdinal, assignment.performerOrdinal]),
  );
  return projection.tracks
    .filter((track) => track.kind === "generated-harmony" && track.enabled)
    .map((track): Rc7VerifiedAssignedTrack => {
      if (track.trackOrdinal !== 1 && track.trackOrdinal !== 2) {
        throw new RangeError("STALE_REFERENCE:generated track ordinal");
      }
      const runtimeTrack = trackByOrdinal.get(track.trackOrdinal);
      const performerOrdinal = assignmentByTrackOrdinal.get(track.trackOrdinal);
      const performer = performerOrdinal === undefined ? undefined : performerByOrdinal.get(performerOrdinal);
      if (!runtimeTrack || !performer || performerOrdinal === undefined) {
        throw new RangeError("STALE_REFERENCE:runtime ordinal join");
      }
      return {
        trackPlanId: runtimeTrack.id,
        trackOrdinal: track.trackOrdinal,
        performerOrdinal,
        hardRange: performer.hardRange,
        comfortableRange: performer.comfortableRange,
        preferredTessitura: performer.preferredTessitura ?? null,
        previousPlacementRole: priorRole(context.prepared, runtimeTrack),
      };
    })
    .sort((left, right) => left.trackOrdinal - right.trackOrdinal);
}
