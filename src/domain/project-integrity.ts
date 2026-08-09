import {
  createPresetProfileRegistry, resolveEffectiveArrangementConfig,
  type ArrangementPresetId, type EffectiveArrangementConfig,
} from "./config";
import {
  canonicalJson, compareCanonicalValues, semanticDigest,
  type SemanticDigest,
} from "./digest/canonical";
import {
  digestActivityPlan, digestAnchorPlan, digestIntentPlan,
  type PlanOrdinalRegistry,
} from "./digest/plans";
import {
  digestActivityInput, digestAnchorInput, digestGenerationInput, digestIntentInput,
  type CanonicalAssignmentProjection, type CanonicalPerformerProjection,
  type CanonicalTrackProjection,
} from "./digest/stages";
import { digestMusicalSource } from "./digest/source";
import type { Diagnostic, DiagnosticCode } from "./diagnostics";
import {
  digestAppliedOutputEditSet, validateOutputEdits,
  type ArrangementOutputEdit, type EditedArrangementSnapshot,
} from "./edit/model";
import { buildArrangementCandidate } from "./generation/candidate";
import type {
  ArrangementCandidate, FullSongMetrics, GeneratedVoiceEventPayload,
} from "./generation/model";
import {
  digestEffectiveChordTimeline, digestPerformanceSequence,
  digestSourceChordProjection, resolveEffectiveChordTimeline,
  type EffectiveChordTimeline,
} from "./harmony/chord-timeline";
import {
  harmonyTrackId, outputEditId, performanceChordSpanId, performerId,
  timelineAtomId,
} from "./ids";
import type { LockedAnchorEndpointSpec, VariantStageLocks } from "./locks";
import type {
  ArrangementActivityPlan, ArrangementAnchorPlan, ArrangementIntentPlan,
  NonChordTonePlan,
} from "./plans";
import type { HarmonyProject, ArrangementVariant } from "./project";
import type { AlgorithmExecutionRegistry } from "./registries";
import {
  atomizeSourceLead, type SourceLeadAtomization,
} from "./source/atomization";
import { resolveProductionLyricEmphasis } from "./source/lyrics";
import type { LeadEvent, SongSourceDocument } from "./source/model";
import { validateSongSourceDocumentIntegrity } from "./source/validation";
import { compareRanges } from "./time";
import type { StageExecutionResult } from "./plans";

export type HarmonyProjectIntegrityResult = StageExecutionResult<HarmonyProject>;

class ProjectIntegrityError extends Error {
  constructor(
    message: string,
    readonly code: DiagnosticCode = "CANDIDATE_PROJECTION_INVALID",
  ) {
    super(message);
    this.name = "ProjectIntegrityError";
  }
}

function requireIntegrity(
  condition: unknown,
  message: string,
  code?: DiagnosticCode,
): asserts condition {
  if (!condition) throw new ProjectIntegrityError(message, code);
}

function blockedIntegrity(
  message: string,
  code: DiagnosticCode = "CANDIDATE_PROJECTION_INVALID",
): HarmonyProjectIntegrityResult {
  return {
    status: "blocked",
    diagnostics: [{
      id: `dg:${code}:project-integrity:0`,
      code,
      severity: "blocking",
      messageKo: message,
      details: { reason: message },
    }],
  };
}

export function blockedHarmonyProjectIntegrity(
  message: string,
  code: DiagnosticCode = "SOURCE_REVISION_INVALID",
): HarmonyProjectIntegrityResult {
  return blockedIntegrity(message, code);
}

function exact(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function resolvedTimeline(project: HarmonyProject): EffectiveChordTimeline | undefined {
  return project.chordTimelineState.status === "resolved"
    ? project.chordTimelineState.timeline
    : undefined;
}

function resolvedAtomization(project: HarmonyProject): SourceLeadAtomization | undefined {
  return project.sourceLeadAtomizationState.status === "resolved"
    ? project.sourceLeadAtomizationState.atomization
    : undefined;
}

function resolvedChordFromSource(event: SongSourceDocument["sourceMeasures"][number]["chordEvents"][number]): object | undefined {
  if (event.confirmation !== "confirmed") return undefined;
  if (event.parseResult.status === "ok") {
    return { status: "ok", chord: event.parseResult.chord };
  }
  return event.parseResult.status === "no-chord"
    ? { status: "no-chord", sourceText: event.parseResult.sourceText }
    : undefined;
}

async function validateTimelineArtifact(
  timeline: EffectiveChordTimeline,
  source: SongSourceDocument,
): Promise<void> {
  const sourceChordById = new Map(source.sourceMeasures.flatMap((measure) =>
    measure.chordEvents.map((event) => [event.id, event] as const)));
  const spanById = new Map(timeline.spans.map((span) => [span.id, span]));
  requireIntegrity(spanById.size === timeline.spans.length, "duplicate chord span ID");
  for (let index = 0; index < timeline.spans.length; index += 1) {
    const span = timeline.spans[index];
    requireIntegrity(
      span.id === performanceChordSpanId(span.range.start, span.range.end),
      `non-canonical chord span ID: ${span.id}`,
    );
    if (span.origin.kind === "source-event") {
      const event = sourceChordById.get(span.origin.sourceChordEventId);
      requireIntegrity(event !== undefined, "chord span references a missing source chord", "STALE_REFERENCE");
      requireIntegrity(exact(resolvedChordFromSource(event), span.parseResult), "source chord span payload mismatch");
      continue;
    }
    const carriedOrigin = span.origin;
    const origin = sourceChordById.get(carriedOrigin.originatingSourceChordEventId);
    const previous = spanById.get(carriedOrigin.previousSpanId);
    const previousIndex = timeline.spans.findIndex((candidate) => candidate.id === carriedOrigin.previousSpanId);
    requireIntegrity(origin !== undefined, "carried span references a missing source chord", "STALE_REFERENCE");
    requireIntegrity(previous !== undefined && previousIndex >= 0 && previousIndex < index, "carried span previousSpanId is not an earlier span", "STALE_REFERENCE");
    requireIntegrity(exact(previous.parseResult, span.parseResult), "carried span payload differs from previous span");
    requireIntegrity(exact(resolvedChordFromSource(origin), span.parseResult), "carried span payload differs from origin source chord");
    if (carriedOrigin.carrySource === "explicit-carry-token") {
      const token = carriedOrigin.carryTokenSourceChordEventId === undefined
        ? undefined
        : sourceChordById.get(carriedOrigin.carryTokenSourceChordEventId);
      requireIntegrity(token?.parseResult.status === "carry", "explicit carry span lacks a carry token", "STALE_REFERENCE");
    } else {
      requireIntegrity(carriedOrigin.carryTokenSourceChordEventId === undefined, "gap-policy carry stores a carry token");
    }
  }
  requireIntegrity(
    timeline.digest === await digestEffectiveChordTimeline(
      {
        sourceChordProjectionDigest: timeline.sourceChordProjectionDigest,
        performanceSequenceDigest: timeline.performanceSequenceDigest,
        resolutionPolicy: timeline.resolutionPolicy,
        chordTimelineResolverVersion: timeline.chordTimelineResolverVersion,
        spans: timeline.spans,
      },
      source.sourceMeasures,
    ),
    "EffectiveChordTimeline digest mismatch",
    "EFFECTIVE_CHORD_TIMELINE_STALE",
  );
}

interface SourceEventOrdinal {
  readonly sourceMeasureOrdinal: number;
  readonly sourceEventOrdinal: number;
  readonly event: LeadEvent;
}

async function digestStoredAtomization(
  atomization: SourceLeadAtomization,
  source: SongSourceDocument,
): Promise<SemanticDigest> {
  const leadById = new Map<string, SourceEventOrdinal>();
  const lyricById = new Map(source.sourceMeasures.flatMap((measure) =>
    measure.lyricTokens.map((token) => [token.id, token] as const)));
  source.sourceMeasures.forEach((measure, sourceMeasureOrdinal) => {
    measure.leadEvents.forEach((event, sourceEventOrdinal) => {
      leadById.set(event.id, { sourceMeasureOrdinal, sourceEventOrdinal, event });
    });
  });
  const atomEntries = atomization.atoms.map((atom) => {
    const occurrence = source.performanceSequence.occurrences[atom.range.start.performanceMeasureIndex];
    const lead = leadById.get(atom.sourceEventId);
    requireIntegrity(occurrence !== undefined && lead !== undefined, "atom references a missing occurrence or source event", "STALE_REFERENCE");
    requireIntegrity(
      source.sourceMeasures[lead.sourceMeasureOrdinal]?.id === occurrence.sourceMeasureId,
      "atom source event is outside its performance occurrence",
      "STALE_REFERENCE",
    );
    const section = source.sectionOccurrences.find((candidate) =>
      occurrence.performanceIndex >= candidate.startPerformanceMeasureIndex
      && occurrence.performanceIndex < candidate.endPerformanceMeasureIndexExclusive);
    requireIntegrity(section !== undefined, "atom occurrence lacks a section", "SECTION_COVERAGE_INVALID");
    const lyricTokens = atom.lyricTokenIds.map((id) => {
      const token = lyricById.get(id);
      requireIntegrity(token !== undefined && token.leadEventId === atom.sourceEventId, "atom references a missing lyric token", "STALE_REFERENCE");
      requireIntegrity(token.verse === section.lyricVerseIndex, "atom lyric verse differs from section authority");
      return {
        syllabic: token.syllabic,
        extend: token.extend,
        emphasis: resolveProductionLyricEmphasis(token),
      };
    });
    requireIntegrity(
      atom.id === timelineAtomId(
        occurrence.performanceIndex,
        lead.sourceEventOrdinal,
        atom.range.start.offset,
        atom.range.end.offset,
      ),
      `non-canonical TimelineAtom ID: ${atom.id}`,
    );
    return {
      atom,
      projection: {
        occurrenceOrdinal: occurrence.performanceIndex,
        sourceMeasureOrdinal: lead.sourceMeasureOrdinal,
        sourceEventOrdinal: lead.sourceEventOrdinal,
        range: atom.range,
        pitch: atom.pitch,
        tiedFromPrevious: atom.tiedFromPrevious,
        tiedToNext: atom.tiedToNext,
        lyricTokens,
      },
    };
  }).sort((left, right) => compareRanges(left.atom.range, right.atom.range)
    || compareCanonicalValues(left.projection, right.projection));
  requireIntegrity(new Set(atomEntries.map((entry) => entry.atom.id)).size === atomEntries.length, "duplicate TimelineAtom ID");
  return semanticDigest({
    projectionSchema: "hm-source-lead-atomization-v1",
    atomizerVersion: atomization.atomizerVersion,
    musicalSourceDigest: atomization.musicalSourceDigest,
    effectiveChordTimelineDigest: atomization.effectiveChordTimelineDigest,
    atoms: atomEntries.map((entry) => entry.projection),
  });
}

async function validateAtomizationArtifact(
  atomization: SourceLeadAtomization,
  source: SongSourceDocument,
): Promise<void> {
  requireIntegrity(
    atomization.digest === await digestStoredAtomization(atomization, source),
    "SourceLeadAtomization digest mismatch",
    "SOURCE_LEAD_ATOMIZATION_STALE",
  );
}

interface ProjectOrdinals extends PlanOrdinalRegistry {
  readonly performerOrdinalById: Readonly<Record<string, number>>;
  readonly lyricOrdinalById: Readonly<Record<string, number>>;
}

function performerOrdinalRegistry(project: HarmonyProject): Readonly<Record<string, number>> {
  const trackOrdinalById = Object.fromEntries(
    project.trackPlans.map((track) => [track.id, track.canonicalOrdinal]),
  );
  const assignedTracksByPerformer = new Map<string, number[]>();
  for (const assignment of project.assignments) {
    const trackOrdinal = trackOrdinalById[assignment.trackPlanId];
    requireIntegrity(Number.isSafeInteger(trackOrdinal), "assignment references a missing track", "TRACK_ASSIGNMENT_INVALID");
    const ordinals = assignedTracksByPerformer.get(assignment.performerId) ?? [];
    ordinals.push(trackOrdinal);
    assignedTracksByPerformer.set(assignment.performerId, ordinals);
  }
  const entries = project.performers.map((performer, originalOrdinal) => ({
    performer,
    originalOrdinal,
    projection: {
      assignedTrackOrdinals: [...(assignedTracksByPerformer.get(performer.id) ?? [])].sort((left, right) => left - right),
      hardRange: performer.hardRange,
      comfortableRange: performer.comfortableRange,
      preferredTessitura: performer.preferredTessitura ?? null,
    },
  })).sort((left, right) => compareCanonicalValues(left.projection, right.projection)
    || left.originalOrdinal - right.originalOrdinal);
  const result: Record<string, number> = {};
  entries.forEach((entry, ordinal) => {
    requireIntegrity(entry.performer.id === performerId(ordinal), `non-canonical performer ID: ${entry.performer.id}`);
    result[entry.performer.id] = ordinal;
  });
  return result;
}

function buildProjectOrdinals(project: HarmonyProject): ProjectOrdinals {
  const timeline = resolvedTimeline(project);
  const atomization = resolvedAtomization(project);
  const trackOrdinalById = Object.fromEntries(
    project.trackPlans.map((track) => [track.id, track.canonicalOrdinal]),
  );
  for (const track of project.trackPlans) {
    if (track.kind === "generated-harmony") {
      requireIntegrity(track.id === harmonyTrackId(track.canonicalOrdinal), `non-canonical track ID: ${track.id}`, "TRACK_ORDINAL_INVALID");
    }
  }
  const lyricEntries = project.source.sourceMeasures.flatMap((measure) => measure.lyricTokens);
  return {
    sectionOccurrenceOrdinalById: Object.fromEntries(
      project.source.sectionOccurrences.map((section, ordinal) => [section.id, ordinal]),
    ),
    phraseOrdinalById: Object.fromEntries(
      project.source.phraseRegions.map((phrase, ordinal) => [phrase.id, ordinal]),
    ),
    trackOrdinalById,
    leadAtomOrdinalById: Object.fromEntries(
      (atomization?.atoms ?? []).map((atom, ordinal) => [atom.id, ordinal]),
    ),
    chordSpanOrdinalById: Object.fromEntries(
      (timeline?.spans ?? []).map((span, ordinal) => [span.id, ordinal]),
    ),
    performerOrdinalById: performerOrdinalRegistry(project),
    lyricOrdinalById: Object.fromEntries(lyricEntries.map((token, ordinal) => [token.id, ordinal])),
  };
}

function requiredOrdinal(
  registry: Readonly<Record<string, number>>,
  id: string,
  kind: string,
): number {
  const value = registry[id];
  requireIntegrity(Number.isSafeInteger(value) && value >= 0, `missing ${kind} target: ${id}`, "STALE_REFERENCE");
  return value;
}

function validateEndpointReference(
  endpoint: LockedAnchorEndpointSpec,
  ordinals: ProjectOrdinals,
  atomizationDigest: SemanticDigest | undefined,
): void {
  if (endpoint.kind === "chord-tone") {
    requiredOrdinal(ordinals.chordSpanOrdinalById, endpoint.chordSpanId, "chord span");
    return;
  }
  requiredOrdinal(ordinals.leadAtomOrdinalById, endpoint.leadAtom.leadAtomId, "lead atom");
  requireIntegrity(endpoint.leadAtom.sourceLeadAtomizationDigest === atomizationDigest, "lead atom digest binding mismatch", "ANCHOR_LOCK_INVALID");
}

function validateLockReference(
  lock: VariantStageLocks[keyof VariantStageLocks][number],
  ordinals: ProjectOrdinals,
  atomizationDigest: SemanticDigest | undefined,
): void {
  requiredOrdinal(ordinals.phraseOrdinalById, lock.phraseId, "phrase");
  if ("trackPlanId" in lock) {
    requiredOrdinal(ordinals.trackOrdinalById, lock.trackPlanId, "track");
  }
  if (lock.kind === "anchor-chord-tone") {
    requiredOrdinal(ordinals.chordSpanOrdinalById, lock.chordSpanId, "chord span");
  } else if (lock.kind === "anchor-lead-derived") {
    requiredOrdinal(ordinals.leadAtomOrdinalById, lock.leadAtom.leadAtomId, "lead atom");
    requireIntegrity(
      lock.leadAtom.sourceLeadAtomizationDigest === atomizationDigest,
      "AnchorLock lead atom digest mismatch",
      "ANCHOR_LOCK_INVALID",
    );
  } else if (lock.kind === "anchor-planned-nct") {
    requiredOrdinal(ordinals.chordSpanOrdinalById, lock.nctSpec.contextChordSpanId, "chord span");
    requiredOrdinal(ordinals.chordSpanOrdinalById, lock.nctSpec.targetChordSpanId, "chord span");
    validateEndpointReference(lock.nctSpec.preparation, ordinals, atomizationDigest);
    validateEndpointReference(lock.nctSpec.resolution, ordinals, atomizationDigest);
  }
}

function validateLockReferences(
  project: HarmonyProject,
  ordinals: ProjectOrdinals,
  atomizationDigest: SemanticDigest | undefined,
): void {
  const lockIds: string[] = [];
  for (const [presetId, locks] of Object.entries(project.locksByPreset)) {
    if (!locks) continue;
    const variant = project.variants[presetId as ArrangementPresetId];
    const stages = [
      { stage: "intent", locks: locks.intent },
      { stage: "activity", locks: locks.activity },
      { stage: "anchor", locks: locks.anchor },
      { stage: "generation", locks: locks.solver },
    ] as const;
    for (const stage of stages) {
      for (const lock of stage.locks) {
        lockIds.push(lock.id);
        if (variant === undefined || isFresh(variant, stage.stage)) {
          validateLockReference(lock, ordinals, atomizationDigest);
        }
      }
    }
  }
  requireIntegrity(new Set(lockIds).size === lockIds.length, "duplicate StageLock ID");
}

function canonicalPerformerProjections(
  project: HarmonyProject,
  ordinals: ProjectOrdinals,
): readonly CanonicalPerformerProjection[] {
  return project.performers.map((performer) => ({
    performerOrdinal: requiredOrdinal(ordinals.performerOrdinalById, performer.id, "performer"),
    hardRange: performer.hardRange,
    comfortableRange: performer.comfortableRange,
    preferredTessitura: performer.preferredTessitura ?? null,
  }));
}

function canonicalTrackProjections(project: HarmonyProject): readonly CanonicalTrackProjection[] {
  return project.trackPlans.map((track) => ({
    trackOrdinal: track.canonicalOrdinal,
    kind: track.kind,
    enabled: track.enabled,
  }));
}

function canonicalAssignmentProjections(
  project: HarmonyProject,
  ordinals: ProjectOrdinals,
): readonly CanonicalAssignmentProjection[] {
  return project.assignments.map((assignment) => ({
    trackOrdinal: requiredOrdinal(ordinals.trackOrdinalById, assignment.trackPlanId, "track"),
    performerOrdinal: requiredOrdinal(ordinals.performerOrdinalById, assignment.performerId, "performer"),
  }));
}

function assertIntentReferences(
  plan: ArrangementIntentPlan,
  project: HarmonyProject,
  ordinals: ProjectOrdinals,
): void {
  const sectionIntentById = new Map(plan.sectionIntents.map((intent) => [intent.id, intent]));
  const phraseById = new Map(project.source.phraseRegions.map((phrase) => [phrase.id, phrase]));
  for (const intent of plan.sectionIntents) {
    requiredOrdinal(ordinals.sectionOccurrenceOrdinalById, intent.sectionOccurrenceId, "section occurrence");
  }
  for (const intent of plan.phraseIntents) {
    const phrase = phraseById.get(intent.phraseId);
    const sectionIntent = sectionIntentById.get(intent.sectionIntentId);
    requireIntegrity(phrase !== undefined && sectionIntent !== undefined, "Intent Plan has a missing phrase or section plan target", "STALE_REFERENCE");
    requireIntegrity(phrase.sectionOccurrenceId === sectionIntent.sectionOccurrenceId, "phrase intent points to the wrong section intent");
    for (const role of intent.trackRoles) {
      requireIntegrity(role.phraseId === intent.phraseId, "track role phrase mismatch");
      requiredOrdinal(ordinals.trackOrdinalById, role.trackPlanId, "track");
    }
  }
  if (plan.grammarTrace) {
    requireIntegrity(
      plan.grammarTrace.grammarVersion === plan.grammarVersion,
      "Grammar trace version mismatch",
      "ALGORITHM_CONFIG_MISMATCH",
    );
    for (const [phraseId, candidates] of Object.entries(
      plan.grammarTrace.candidatesByPhraseId,
    )) {
      requiredOrdinal(ordinals.phraseOrdinalById, phraseId, "phrase");
      for (const candidate of candidates) {
        requireIntegrity(
          candidate.phraseId === phraseId && candidate.presetId === plan.presetId,
          "Grammar trace references the wrong phrase or preset",
          "STALE_REFERENCE",
        );
      }
    }
  }
}

function assertActivityReferences(
  activity: ArrangementActivityPlan,
  intent: ArrangementIntentPlan,
  ordinals: ProjectOrdinals,
): void {
  const intentById = new Map(intent.phraseIntents.map((item) => [item.id, item]));
  for (const phrase of activity.phraseActivityPlans) {
    requiredOrdinal(ordinals.phraseOrdinalById, phrase.phraseId, "phrase");
    requireIntegrity(intentById.get(phrase.intentId)?.phraseId === phrase.phraseId, "Activity Plan intent reference mismatch", "STALE_REFERENCE");
    for (const span of phrase.activitySpans) requiredOrdinal(ordinals.trackOrdinalById, span.trackPlanId, "track");
    for (const attack of phrase.attackEvents) requiredOrdinal(ordinals.trackOrdinalById, attack.trackPlanId, "track");
  }
}

function assertAnchorReferences(
  anchor: ArrangementAnchorPlan,
  activity: ArrangementActivityPlan,
  ordinals: ProjectOrdinals,
  atomizationDigest: SemanticDigest,
): void {
  const activityById = new Map(activity.phraseActivityPlans.map((item) => [item.id, item]));
  for (const phrase of anchor.phraseAnchorPlans) {
    requiredOrdinal(ordinals.phraseOrdinalById, phrase.phraseId, "phrase");
    requireIntegrity(activityById.get(phrase.activityPlanId)?.phraseId === phrase.phraseId, "Anchor Plan activity reference mismatch", "STALE_REFERENCE");
    for (const directive of phrase.anchorDirectives) {
      requiredOrdinal(ordinals.trackOrdinalById, directive.trackPlanId, "track");
      if (directive.kind === "chord-tone") requiredOrdinal(ordinals.chordSpanOrdinalById, directive.chordSpanId, "chord span");
      if (directive.kind === "planned-nct") requiredOrdinal(ordinals.chordSpanOrdinalById, directive.contextChordSpanId, "chord span");
      if (directive.kind === "lead-derived") {
        requiredOrdinal(ordinals.leadAtomOrdinalById, directive.leadAtom.leadAtomId, "lead atom");
        requireIntegrity(directive.leadAtom.sourceLeadAtomizationDigest === atomizationDigest, "anchor directive lead atom digest mismatch");
      }
    }
    for (const nct of phrase.nctPlans) {
      requiredOrdinal(ordinals.trackOrdinalById, nct.trackPlanId, "track");
      requiredOrdinal(ordinals.chordSpanOrdinalById, nct.contextChordSpanId, "chord span");
      requiredOrdinal(ordinals.chordSpanOrdinalById, nct.targetChordSpanId, "chord span");
    }
  }
}

function nctSemanticProjection(
  nct: NonChordTonePlan,
  directiveProjectionById: Readonly<Record<string, object>>,
  ordinals: ProjectOrdinals,
): object {
  const common = {
    kind: nct.kind,
    trackOrdinal: requiredOrdinal(ordinals.trackOrdinalById, nct.trackPlanId, "track"),
    position: nct.position,
    contextChordSpanOrdinal: requiredOrdinal(ordinals.chordSpanOrdinalById, nct.contextChordSpanId, "chord span"),
    targetChordSpanOrdinal: requiredOrdinal(ordinals.chordSpanOrdinalById, nct.targetChordSpanId, "chord span"),
    preparation: directiveProjectionById[nct.preparationDirectiveId],
    resolution: directiveProjectionById[nct.resolutionDirectiveId],
    resolutionDeadline: nct.resolutionDeadline,
  };
  requireIntegrity(common.preparation !== undefined && common.resolution !== undefined, "NCT endpoint reference is missing", "STALE_REFERENCE");
  return nct.kind === "passing" || nct.kind === "neighbor"
    ? { ...common, direction: nct.direction }
    : nct.kind === "suspension"
      ? { ...common, resolutionDirection: nct.resolutionDirection }
      : common;
}

function anchorDirectiveOrdinalRegistry(
  anchor: ArrangementAnchorPlan,
  ordinals: ProjectOrdinals,
): Readonly<Record<string, number>> {
  const entries: Array<{ readonly id: string; readonly projection: object }> = [];
  for (const phrase of anchor.phraseAnchorPlans) {
    const phraseOrdinal = requiredOrdinal(ordinals.phraseOrdinalById, phrase.phraseId, "phrase");
    const endpointProjectionById: Record<string, object> = {};
    for (const directive of phrase.anchorDirectives.filter((item) => item.kind !== "planned-nct")) {
      const common = {
        phraseOrdinal,
        kind: directive.kind,
        trackOrdinal: requiredOrdinal(ordinals.trackOrdinalById, directive.trackPlanId, "track"),
        position: directive.position,
      };
      const projection = directive.kind === "chord-tone"
        ? { ...common, chordSpanOrdinal: requiredOrdinal(ordinals.chordSpanOrdinalById, directive.chordSpanId, "chord span"), selectedTone: directive.selectedTone }
        : { ...common, leadAtomOrdinal: requiredOrdinal(ordinals.leadAtomOrdinalById, directive.leadAtom.leadAtomId, "lead atom"), sourceLeadAtomizationDigest: directive.leadAtom.sourceLeadAtomizationDigest, relation: directive.relation };
      endpointProjectionById[directive.id] = projection;
      entries.push({ id: directive.id, projection });
    }
    const nctProjectionById = Object.fromEntries(phrase.nctPlans.map((nct) => [
      nct.id,
      nctSemanticProjection(nct, endpointProjectionById, ordinals),
    ]));
    for (const directive of phrase.anchorDirectives.filter((item) => item.kind === "planned-nct")) {
      const projection = {
        phraseOrdinal,
        kind: directive.kind,
        trackOrdinal: requiredOrdinal(ordinals.trackOrdinalById, directive.trackPlanId, "track"),
        position: directive.position,
        contextChordSpanOrdinal: requiredOrdinal(ordinals.chordSpanOrdinalById, directive.contextChordSpanId, "chord span"),
        nct: nctProjectionById[directive.nctPlanId],
      };
      requireIntegrity(projection.nct !== undefined, "planned NCT directive target is missing", "STALE_REFERENCE");
      entries.push({ id: directive.id, projection });
    }
  }
  entries.sort((left, right) => compareCanonicalValues(left.projection, right.projection));
  requireIntegrity(new Set(entries.map((entry) => canonicalJson(entry.projection))).size === entries.length, "duplicate semantic anchor directive");
  return Object.fromEntries(entries.map((entry, ordinal) => [entry.id, ordinal]));
}

function eventPayload(event: ArrangementCandidate["generatedEventsByTrack"][string][number]): GeneratedVoiceEventPayload {
  if (event.kind === "rest") return { kind: "rest", range: event.range };
  return {
    kind: "note",
    range: event.range,
    pitch: event.pitch,
    tieStart: event.tieStart,
    tieStop: event.tieStop,
    lyricTokenIds: event.lyricTokenIds,
    source: event.source,
    ...(event.originDirectiveId === undefined ? {} : { originDirectiveId: event.originDirectiveId }),
  };
}

function validateMetricReferences(
  metrics: FullSongMetrics,
  ordinals: ProjectOrdinals,
): void {
  for (const sectionOccurrenceId of Object.keys(metrics.densityBySectionOccurrence)) {
    requiredOrdinal(
      ordinals.sectionOccurrenceOrdinalById,
      sectionOccurrenceId,
      "section occurrence",
    );
  }
  for (const trackPlanId of Object.keys(metrics.maxLeapSemitonesByTrack)) {
    requiredOrdinal(ordinals.trackOrdinalById, trackPlanId, "track");
  }
}

async function validateCandidateIntegrity(
  candidate: ArrangementCandidate,
  project: HarmonyProject,
  anchor: ArrangementAnchorPlan,
  ordinals: ProjectOrdinals,
): Promise<void> {
  const anchorDirectiveOrdinalById = anchorDirectiveOrdinalRegistry(anchor, ordinals);
  validateMetricReferences(candidate.metrics, ordinals);
  const generatedTrackIds = new Set(project.trackPlans
    .filter((track) => track.kind === "generated-harmony")
    .map((track) => track.id));
  for (const [trackPlanId, events] of Object.entries(candidate.generatedEventsByTrack)) {
    requireIntegrity(generatedTrackIds.has(trackPlanId), "Candidate references a missing generated track", "TRACK_PLAN_MISSING");
    for (const event of events) {
      if (event.kind !== "note") continue;
      for (const lyricId of event.lyricTokenIds) requiredOrdinal(ordinals.lyricOrdinalById, lyricId, "lyric token");
      if (event.originDirectiveId !== undefined) requiredOrdinal(anchorDirectiveOrdinalById, event.originDirectiveId, "anchor directive");
    }
  }
  for (const realized of candidate.realizedAnchors) {
    requiredOrdinal(anchorDirectiveOrdinalById, realized.directiveId, "anchor directive");
    requiredOrdinal(ordinals.trackOrdinalById, realized.trackPlanId, "track");
  }
  const rebuilt = await buildArrangementCandidate({
    presetId: candidate.presetId,
    candidateStatus: candidate.candidateStatus,
    anchorPlanDigest: candidate.anchorPlanDigest,
    effectiveConfigDigest: candidate.effectiveConfigDigest,
    presetProfileDigest: candidate.presetProfileDigest,
    effectiveChordTimelineDigest: candidate.effectiveChordTimelineDigest,
    sourceLeadAtomizationDigest: candidate.sourceLeadAtomizationDigest,
    tracks: Object.entries(candidate.generatedEventsByTrack).map(([trackPlanId, events]) => ({
      trackPlanId,
      events: events.map(eventPayload),
    })),
    realizedAnchors: candidate.realizedAnchors,
    ordinals: {
      trackOrdinalById: ordinals.trackOrdinalById,
      lyricOrdinalById: ordinals.lyricOrdinalById,
      anchorDirectiveOrdinalById,
    },
    metrics: candidate.metrics,
    diagnostics: candidate.diagnostics,
    canonicalPathKey: candidate.canonicalPathKey,
  });
  requireIntegrity(candidate.contentDigest === rebuilt.contentDigest, "Candidate content digest mismatch");
  requireIntegrity(candidate.id === rebuilt.id, "Candidate ID mismatch");
  requireIntegrity(exact(candidate.generatedEventsByTrack, rebuilt.generatedEventsByTrack), "Generated Event ID or canonical order mismatch");
  requireIntegrity(exact(candidate.realizedAnchors, rebuilt.realizedAnchors), "realized anchor canonical order mismatch");
}

function generationRegistryKeys(): {
  readonly versions: readonly (keyof AlgorithmExecutionRegistry["versions"])[];
  readonly configs: readonly (keyof AlgorithmExecutionRegistry["configDigests"])[];
} {
  return {
    versions: [
      "domainSchemaVersion", "digestCodecVersion", "chordParserVersion",
      "chordTimelineResolverVersion", "performanceExpanderVersion",
      "sourceLeadAtomizerVersion", "presetProfileVersion", "candidateProjectionVersion",
      "plannerVersion", "grammarVersion", "activityPlannerVersion", "anchorPlannerVersion",
      "solverVersion", "assemblerVersion", "validatorVersion", "metricsVersion",
      "diagnosticRegistryVersion",
    ],
    configs: [
      "solverConfigDigest", "assemblerConfigDigest", "validatorConfigDigest",
      "metricConfigDigest", "diagnosticRegistryDigest",
    ],
  };
}

function assertExactRegistrySubset(
  actual: Readonly<Record<string, string>>,
  expected: object,
  keys: readonly string[],
  kind: string,
): void {
  requireIntegrity(exact(Object.keys(actual).sort(), [...keys].sort()), `Generation Result ${kind} registry keys mismatch`, "ALGORITHM_CONFIG_MISMATCH");
  const expectedRecord = expected as Readonly<Record<string, string>>;
  for (const key of keys) {
    requireIntegrity(actual[key] === expectedRecord[key], `${kind} registry mismatch: ${key}`, "ALGORITHM_CONFIG_MISMATCH");
  }
}

function stageIndex(stage: "intent" | "activity" | "anchor" | "generation"): number {
  return ["intent", "activity", "anchor", "generation"].indexOf(stage);
}

function isFresh(variant: ArrangementVariant, stage: "intent" | "activity" | "anchor" | "generation"): boolean {
  return variant.staleness === undefined
    || stageIndex(stage) < stageIndex(variant.staleness.staleFrom);
}

function freshDiagnosticArrays(project: HarmonyProject): readonly (readonly Diagnostic[])[] {
  const values: Array<readonly Diagnostic[]> = [];
  const timelineState = project.chordTimelineState;
  if (timelineState.status === "resolved" || timelineState.status === "unresolved") {
    values.push(timelineState.diagnostics);
  }
  const atomizationState = project.sourceLeadAtomizationState;
  if (atomizationState.status === "resolved") values.push(atomizationState.diagnostics);
  for (const variant of Object.values(project.variants)) {
    if (!variant || variant.staleness !== undefined) continue;
    values.push(variant.diagnostics);
    if (variant.lastBlockedAttempt) values.push(variant.lastBlockedAttempt.diagnostics);
    if (variant.lifecycle !== "generation-attempted") continue;
    values.push(variant.generationResult.diagnostics);
    variant.generationResult.candidates.forEach((candidate) => values.push(candidate.diagnostics));
    variant.editedSnapshots.forEach((snapshot) => values.push(snapshot.validationDiagnostics));
  }
  return values;
}

function assertDiagnosticReferences(
  project: HarmonyProject,
  ordinals: ProjectOrdinals,
): void {
  const sourceEventIds = new Set(project.source.sourceMeasures.flatMap((measure) => [
    ...measure.leadEvents.map((event) => event.id),
    ...measure.chordEvents.map((event) => event.id),
    ...measure.textEvents.map((event) => event.id),
  ]));
  for (const diagnostics of freshDiagnosticArrays(project)) {
    for (const diagnostic of diagnostics) {
      const location = diagnostic.location;
      if (!location) continue;
      if (location.phraseId !== undefined) requiredOrdinal(ordinals.phraseOrdinalById, location.phraseId, "phrase");
      if (location.sectionOccurrenceId !== undefined) requiredOrdinal(ordinals.sectionOccurrenceOrdinalById, location.sectionOccurrenceId, "section occurrence");
      for (const id of location.trackPlanIds ?? []) requiredOrdinal(ordinals.trackOrdinalById, id, "track");
      requireIntegrity((location.sourceEventIds ?? []).every((id) => sourceEventIds.has(id)), "Diagnostic references a missing source event", "STALE_REFERENCE");
    }
  }
}

async function validateSnapshots(
  snapshots: readonly EditedArrangementSnapshot[],
  edits: readonly ArrangementOutputEdit[],
  candidates: readonly ArrangementCandidate[],
  anchor: ArrangementAnchorPlan,
  project: HarmonyProject,
  expected: AlgorithmExecutionRegistry,
  ordinals: ProjectOrdinals,
): Promise<void> {
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const editById = new Map(edits.map((edit) => [edit.id, edit]));
  const directiveOrdinals = anchorDirectiveOrdinalRegistry(anchor, ordinals);
  const timeline = resolvedTimeline(project);
  const atomization = resolvedAtomization(project);
  for (const snapshot of snapshots) {
    validateMetricReferences(snapshot.metrics, ordinals);
    const candidate = candidateById.get(snapshot.baseCandidateId);
    requireIntegrity(candidate !== undefined && candidate.contentDigest === snapshot.baseCandidateDigest, "Snapshot base Candidate binding mismatch", "EDIT_BASE_CANDIDATE_STALE");
    requireIntegrity(snapshot.id === `es:${snapshot.presetId}:${snapshot.contentDigest}`, "Edited Snapshot ID mismatch", "EDIT_SNAPSHOT_INVALID");
    requireIntegrity(snapshot.materializerVersion === expected.versions.editMaterializerVersion, "snapshot materializer version mismatch", "ALGORITHM_CONFIG_MISMATCH");
    requireIntegrity(snapshot.validatorVersion === expected.versions.validatorVersion, "snapshot validator version mismatch", "ALGORITHM_CONFIG_MISMATCH");
    requireIntegrity(snapshot.metricsVersion === expected.versions.metricsVersion, "snapshot metrics version mismatch", "ALGORITHM_CONFIG_MISMATCH");
    requireIntegrity(snapshot.diagnosticRegistryVersion === expected.versions.diagnosticRegistryVersion, "snapshot diagnostic registry version mismatch", "ALGORITHM_CONFIG_MISMATCH");
    requireIntegrity(snapshot.validatorConfigDigest === expected.configDigests.validatorConfigDigest, "snapshot validator config mismatch", "ALGORITHM_CONFIG_MISMATCH");
    requireIntegrity(snapshot.metricConfigDigest === expected.configDigests.metricConfigDigest, "snapshot metric config mismatch", "ALGORITHM_CONFIG_MISMATCH");
    requireIntegrity(snapshot.diagnosticRegistryDigest === expected.configDigests.diagnosticRegistryDigest, "snapshot diagnostic config mismatch", "ALGORITHM_CONFIG_MISMATCH");
    requireIntegrity(snapshot.effectiveChordTimelineDigest === timeline?.digest, "snapshot timeline provenance mismatch", "EDIT_SNAPSHOT_INVALID");
    requireIntegrity(snapshot.sourceLeadAtomizationDigest === atomization?.digest, "snapshot atomization provenance mismatch", "EDIT_SNAPSHOT_INVALID");
    const appliedEdits = snapshot.appliedEditIds.map((id) => {
      const edit = editById.get(id);
      requireIntegrity(edit !== undefined && edit.baseCandidateId === candidate.id, "Snapshot references a missing OutputEdit", "EDIT_BASE_CANDIDATE_STALE");
      return edit;
    });
    const orderedEditIds = [...appliedEdits]
      .sort((left, right) => left.editOrdinal - right.editOrdinal || left.id.localeCompare(right.id))
      .map((edit) => edit.id);
    requireIntegrity(exact(snapshot.appliedEditIds, orderedEditIds), "Snapshot applied edit order mismatch", "EDIT_SNAPSHOT_INVALID");
    requireIntegrity(snapshot.appliedEditSetDigest === await digestAppliedOutputEditSet(appliedEdits), "Snapshot applied edit set digest mismatch", "EDIT_SNAPSHOT_INVALID");
    const baseEventsByTrack = new Map(Object.entries(candidate.generatedEventsByTrack).map(([trackId, events]) => [
      trackId,
      new Map(events.map((event) => [event.id, event])),
    ]));
    requireIntegrity(new Set(snapshot.generatedHarmonyTracks.map((track) => track.trackPlanId)).size === snapshot.generatedHarmonyTracks.length, "Snapshot has duplicate tracks", "EDIT_SNAPSHOT_INVALID");
    requireIntegrity(exact(
      [...baseEventsByTrack.keys()].sort(),
      snapshot.generatedHarmonyTracks.map((track) => track.trackPlanId).sort(),
    ), "Snapshot track set differs from base Candidate", "EDIT_SNAPSHOT_INVALID");
    for (const track of snapshot.generatedHarmonyTracks) {
      const baseEvents = baseEventsByTrack.get(track.trackPlanId);
      requireIntegrity(baseEvents !== undefined, "Snapshot references a missing track", "TRACK_PLAN_MISSING");
      requireIntegrity(new Set(track.events.map((event) => event.id)).size === track.events.length, "Snapshot has duplicate event IDs", "EDIT_SNAPSHOT_INVALID");
      for (const event of track.events) {
        const baseEvent = baseEvents.get(event.id);
        requireIntegrity(baseEvent !== undefined && exact(baseEvent.range, event.range), "Snapshot event lineage or range mismatch", "EDIT_SNAPSHOT_INVALID");
        if (event.kind === "note") {
          for (const lyricId of event.lyricTokenIds) requiredOrdinal(ordinals.lyricOrdinalById, lyricId, "lyric token");
          if (event.originDirectiveId !== undefined) requiredOrdinal(directiveOrdinals, event.originDirectiveId, "anchor directive");
        }
      }
    }
    for (const realized of snapshot.realizedAnchors) {
      requiredOrdinal(directiveOrdinals, realized.directiveId, "anchor directive");
      requiredOrdinal(ordinals.trackOrdinalById, realized.trackPlanId, "track");
    }
  }
}

async function validateVariantIntegrity(
  variant: ArrangementVariant,
  project: HarmonyProject,
  expected: AlgorithmExecutionRegistry,
  ordinals: ProjectOrdinals,
  effectiveConfig: EffectiveArrangementConfig,
  musicalSourceDigest: SemanticDigest,
  timeline: EffectiveChordTimeline | undefined,
  atomization: SourceLeadAtomization | undefined,
): Promise<void> {
  if (variant.staleness) {
    const diagnosticIds = new Set(variant.diagnostics.map((diagnostic) => diagnostic.id));
    requireIntegrity(
      variant.staleness.staleDiagnosticIds.every((id) => diagnosticIds.has(id)),
      "Variant staleness references a missing diagnostic",
      "STALE_REFERENCE",
    );
  }
  if (variant.lifecycle === "empty") return;
  const locks: VariantStageLocks = project.locksByPreset[variant.presetId]
    ?? { intent: [], activity: [], anchor: [], solver: [] };
  const intent = variant.intentPlan;
  if (!isFresh(variant, "intent")) return;
  assertIntentReferences(intent, project, ordinals);
  requireIntegrity(intent.plannerVersion === expected.versions.plannerVersion, "Intent planner version mismatch", "ALGORITHM_CONFIG_MISMATCH");
  requireIntegrity(intent.grammarVersion === expected.versions.grammarVersion, "Intent grammar version mismatch", "ALGORITHM_CONFIG_MISMATCH");
  requireIntegrity(intent.diagnosticRegistryVersion === expected.versions.diagnosticRegistryVersion, "Intent diagnostic registry version mismatch", "ALGORITHM_CONFIG_MISMATCH");
  requireIntegrity(intent.plannerConfigDigest === expected.configDigests.plannerConfigDigest, "Intent planner config mismatch", "ALGORITHM_CONFIG_MISMATCH");
  requireIntegrity(intent.grammarConfigDigest === expected.configDigests.grammarConfigDigest, "Intent grammar config mismatch", "ALGORITHM_CONFIG_MISMATCH");
  requireIntegrity(intent.diagnosticRegistryDigest === expected.configDigests.diagnosticRegistryDigest, "Intent diagnostic config mismatch", "ALGORITHM_CONFIG_MISMATCH");
  requireIntegrity(intent.intentPlanDigest === await digestIntentPlan(intent, ordinals), "Intent Plan digest mismatch");
  requireIntegrity(timeline !== undefined && atomization !== undefined, "fresh Intent Plan lacks resolved timeline/atomization");
  const currentIntentInput = await digestIntentInput({
      musicalSourceDigest,
      effectiveChordTimelineDigest: timeline.digest,
      sourceLeadAtomizationDigest: atomization.digest,
      atomizerVersion: atomization.atomizerVersion,
      performers: canonicalPerformerProjections(project, ordinals),
      tracks: canonicalTrackProjections(project),
      assignments: canonicalAssignmentProjections(project, ordinals),
      mode: project.settings.mode,
      userCaps: project.settings.userCaps,
      presetId: variant.presetId,
      effectiveConfigDigest: effectiveConfig.digest,
      presetProfileVersion: project.presetProfiles.presetProfileVersion,
      presetProfileDigest: project.presetProfiles.presetProfileDigest,
      locks: locks.intent,
      plannerVersion: expected.versions.plannerVersion,
      grammarVersion: expected.versions.grammarVersion,
      plannerConfigDigest: expected.configDigests.plannerConfigDigest,
      grammarConfigDigest: expected.configDigests.grammarConfigDigest,
      diagnosticRegistryVersion: expected.versions.diagnosticRegistryVersion,
      diagnosticRegistryDigest: expected.configDigests.diagnosticRegistryDigest,
  }, ordinals);
  requireIntegrity(intent.intentInputDigest === currentIntentInput, "Intent input digest mismatch");
  requireIntegrity(intent.effectiveChordTimelineDigest === timeline.digest
    && intent.sourceLeadAtomizationDigest === atomization.digest
    && intent.effectiveConfigDigest === effectiveConfig.digest
    && intent.presetProfileVersion === project.presetProfiles.presetProfileVersion
    && intent.presetProfileDigest === project.presetProfiles.presetProfileDigest, "Intent provenance mismatch");
  if (variant.lifecycle === "intent-ready") return;
  const activity = variant.activityPlan;
  if (!isFresh(variant, "activity")) return;
  assertActivityReferences(activity, intent, ordinals);
  requireIntegrity(activity.activityPlannerVersion === expected.versions.activityPlannerVersion, "Activity planner version mismatch", "ALGORITHM_CONFIG_MISMATCH");
  requireIntegrity(activity.diagnosticRegistryVersion === expected.versions.diagnosticRegistryVersion, "Activity diagnostic registry version mismatch", "ALGORITHM_CONFIG_MISMATCH");
  requireIntegrity(activity.activityPlannerConfigDigest === expected.configDigests.activityPlannerConfigDigest, "Activity planner config mismatch", "ALGORITHM_CONFIG_MISMATCH");
  requireIntegrity(activity.diagnosticRegistryDigest === expected.configDigests.diagnosticRegistryDigest, "Activity diagnostic config mismatch", "ALGORITHM_CONFIG_MISMATCH");
  requireIntegrity(activity.activityPlanDigest === await digestActivityPlan(activity, ordinals), "Activity Plan digest mismatch");
  const currentActivityInput = await digestActivityInput({
      intentPlanDigest: intent.intentPlanDigest,
      sourceLeadAtomizationDigest: atomization.digest,
      atomizerVersion: atomization.atomizerVersion,
      effectiveConfigDigest: effectiveConfig.digest,
      presetProfileVersion: project.presetProfiles.presetProfileVersion,
      presetProfileDigest: project.presetProfiles.presetProfileDigest,
      locks: locks.activity,
      activityPlannerVersion: expected.versions.activityPlannerVersion,
      activityPlannerConfigDigest: expected.configDigests.activityPlannerConfigDigest,
      diagnosticRegistryVersion: expected.versions.diagnosticRegistryVersion,
      diagnosticRegistryDigest: expected.configDigests.diagnosticRegistryDigest,
  }, ordinals);
  requireIntegrity(activity.activityInputDigest === currentActivityInput, "Activity input digest mismatch");
  requireIntegrity(activity.intentPlanDigest === intent.intentPlanDigest
    && activity.sourceLeadAtomizationDigest === atomization.digest
    && activity.effectiveConfigDigest === effectiveConfig.digest
    && activity.presetProfileDigest === project.presetProfiles.presetProfileDigest, "Activity provenance mismatch");
  if (variant.lifecycle === "activity-ready") return;
  const anchor = variant.anchorPlan;
  if (!isFresh(variant, "anchor")) return;
  assertAnchorReferences(anchor, activity, ordinals, atomization.digest);
  requireIntegrity(anchor.anchorPlannerVersion === expected.versions.anchorPlannerVersion, "Anchor planner version mismatch", "ALGORITHM_CONFIG_MISMATCH");
  requireIntegrity(anchor.diagnosticRegistryVersion === expected.versions.diagnosticRegistryVersion, "Anchor diagnostic registry version mismatch", "ALGORITHM_CONFIG_MISMATCH");
  requireIntegrity(anchor.anchorPlannerConfigDigest === expected.configDigests.anchorPlannerConfigDigest, "Anchor planner config mismatch", "ALGORITHM_CONFIG_MISMATCH");
  requireIntegrity(anchor.diagnosticRegistryDigest === expected.configDigests.diagnosticRegistryDigest, "Anchor diagnostic config mismatch", "ALGORITHM_CONFIG_MISMATCH");
  requireIntegrity(anchor.anchorPlanDigest === await digestAnchorPlan(anchor, ordinals), "Anchor Plan digest mismatch");
  const currentAnchorInput = await digestAnchorInput({
      activityPlanDigest: activity.activityPlanDigest,
      sourceLeadAtomizationDigest: atomization.digest,
      atomizerVersion: atomization.atomizerVersion,
      effectiveConfigDigest: effectiveConfig.digest,
      presetProfileVersion: project.presetProfiles.presetProfileVersion,
      presetProfileDigest: project.presetProfiles.presetProfileDigest,
      locks: locks.anchor,
      anchorPlannerVersion: expected.versions.anchorPlannerVersion,
      anchorPlannerConfigDigest: expected.configDigests.anchorPlannerConfigDigest,
      diagnosticRegistryVersion: expected.versions.diagnosticRegistryVersion,
      diagnosticRegistryDigest: expected.configDigests.diagnosticRegistryDigest,
  }, ordinals);
  requireIntegrity(anchor.anchorInputDigest === currentAnchorInput, "Anchor input digest mismatch");
  requireIntegrity(anchor.activityPlanDigest === activity.activityPlanDigest
    && anchor.sourceLeadAtomizationDigest === atomization.digest
    && anchor.effectiveConfigDigest === effectiveConfig.digest
    && anchor.presetProfileDigest === project.presetProfiles.presetProfileDigest, "Anchor provenance mismatch");
  if (variant.lifecycle === "anchor-ready") return;
  const generation = variant.generationResult;
  if (!isFresh(variant, "generation")) return;
  const registryKeys = generationRegistryKeys();
  assertExactRegistrySubset(generation.versions, expected.versions, registryKeys.versions, "version");
  assertExactRegistrySubset(generation.configDigests, expected.configDigests, registryKeys.configs, "config");
  const currentGenerationInput = await digestGenerationInput({
      anchorPlanDigest: anchor.anchorPlanDigest,
      effectiveConfigDigest: effectiveConfig.digest,
      presetProfileVersion: project.presetProfiles.presetProfileVersion,
      presetProfileDigest: project.presetProfiles.presetProfileDigest,
      locks: locks.solver,
      solverVersion: expected.versions.solverVersion,
      assemblerVersion: expected.versions.assemblerVersion,
      validatorVersion: expected.versions.validatorVersion,
      metricsVersion: expected.versions.metricsVersion,
      candidateProjectionVersion: expected.versions.candidateProjectionVersion,
      solverConfigDigest: expected.configDigests.solverConfigDigest,
      assemblerConfigDigest: expected.configDigests.assemblerConfigDigest,
      validatorConfigDigest: expected.configDigests.validatorConfigDigest,
      metricConfigDigest: expected.configDigests.metricConfigDigest,
      diagnosticRegistryVersion: expected.versions.diagnosticRegistryVersion,
      diagnosticRegistryDigest: expected.configDigests.diagnosticRegistryDigest,
  }, ordinals);
  requireIntegrity(exact(generation.digests, {
    musicalSourceDigest,
    effectiveChordTimelineDigest: timeline.digest,
    sourceLeadAtomizationDigest: atomization.digest,
    presetProfileDigest: project.presetProfiles.presetProfileDigest,
    effectiveConfigDigest: effectiveConfig.digest,
    intentInputDigest: currentIntentInput,
    activityInputDigest: currentActivityInput,
    anchorInputDigest: currentAnchorInput,
    generationInputDigest: currentGenerationInput,
    intentPlanDigest: intent.intentPlanDigest,
    activityPlanDigest: activity.activityPlanDigest,
    anchorPlanDigest: anchor.anchorPlanDigest,
  }), "Generation digest envelope mismatch");
  for (const candidate of generation.candidates) {
    requireIntegrity(candidate.presetId === variant.presetId
      && candidate.anchorPlanDigest === anchor.anchorPlanDigest
      && candidate.effectiveConfigDigest === generation.digests.effectiveConfigDigest
      && candidate.presetProfileDigest === generation.digests.presetProfileDigest
      && candidate.effectiveChordTimelineDigest === generation.digests.effectiveChordTimelineDigest
      && candidate.sourceLeadAtomizationDigest === generation.digests.sourceLeadAtomizationDigest, "Candidate provenance mismatch");
    await validateCandidateIntegrity(candidate, project, anchor, ordinals);
  }
  const candidateById = new Map(generation.candidates.map((candidate) => [candidate.id, candidate]));
  const editsByCandidate = new Map<string, ArrangementOutputEdit[]>();
  for (const edit of variant.outputEdits) {
    const candidate = candidateById.get(edit.baseCandidateId);
    requireIntegrity(candidate !== undefined && candidate.contentDigest === edit.baseCandidateDigest, "OutputEdit base Candidate binding mismatch", "EDIT_BASE_CANDIDATE_STALE");
    requireIntegrity(edit.id === outputEditId(edit.presetId, edit.baseCandidateDigest, edit.editOrdinal), "OutputEdit ID mismatch", "EDIT_MATERIALIZATION_BLOCKED");
    const eventIds = new Set(Object.values(candidate.generatedEventsByTrack).flat().map((event) => event.id));
    requireIntegrity(validateOutputEdits(candidate.id, candidate.contentDigest, eventIds, [edit]).length === 0, "OutputEdit target binding mismatch", "EDIT_BASE_CANDIDATE_STALE");
    const values = editsByCandidate.get(candidate.id) ?? [];
    values.push(edit);
    editsByCandidate.set(candidate.id, values);
  }
  for (const values of editsByCandidate.values()) {
    values.sort((left, right) => left.editOrdinal - right.editOrdinal);
    requireIntegrity(values.every((edit, index) => edit.editOrdinal === index), "OutputEdit ordinals are not continuous", "EDIT_MATERIALIZATION_BLOCKED");
  }
  await validateSnapshots(
    variant.editedSnapshots,
    variant.outputEdits,
    generation.candidates,
    anchor,
    project,
    expected,
    ordinals,
  );
}

export async function validateHarmonyProjectIntegrity(
  project: HarmonyProject,
  expectedExecutionRegistry: AlgorithmExecutionRegistry,
): Promise<HarmonyProjectIntegrityResult> {
  try {
    requireIntegrity(
      await validateSongSourceDocumentIntegrity(project.source, expectedExecutionRegistry),
      "SongSourceDocument integrity failed",
      "SOURCE_REVISION_INVALID",
    );
    const musicalSourceDigest = await digestMusicalSource(project.source);
    requireIntegrity(project.source.revisionDigest === musicalSourceDigest, "musicalSourceDigest does not equal source.revisionDigest", "SOURCE_REVISION_MISMATCH");
    const expectedProfiles = await createPresetProfileRegistry(
      expectedExecutionRegistry.versions.presetProfileVersion,
    );
    requireIntegrity(exact(project.presetProfiles, expectedProfiles), "PresetProfileRegistry content or digest mismatch", "PRESET_PROFILE_VERSION_MISMATCH");

    const sourceChordProjectionDigest = await digestSourceChordProjection(project.source.sourceMeasures);
    const performanceSequenceDigest = await digestPerformanceSequence(
      project.source.performanceSequence,
      project.source.sourceMeasures,
    );
    const timeline = resolvedTimeline(project);
    if (timeline) {
      requireIntegrity(
        timeline.chordTimelineResolverVersion
          === expectedExecutionRegistry.versions.chordTimelineResolverVersion,
        "chord timeline resolver version mismatch",
        "ALGORITHM_CONFIG_MISMATCH",
      );
      await validateTimelineArtifact(timeline, project.source);
      requireIntegrity(timeline.sourceChordProjectionDigest === sourceChordProjectionDigest, "source chord projection digest mismatch", "EFFECTIVE_CHORD_TIMELINE_STALE");
      requireIntegrity(timeline.performanceSequenceDigest === performanceSequenceDigest, "performance sequence digest mismatch", "EFFECTIVE_CHORD_TIMELINE_STALE");
      const recalculated = await resolveEffectiveChordTimeline({
        sourceMeasures: project.source.sourceMeasures,
        performanceSequence: project.source.performanceSequence,
        sourceChordProjectionDigest,
        performanceSequenceDigest,
        policy: timeline.resolutionPolicy,
        resolverVersion: timeline.chordTimelineResolverVersion,
        expectedResolverVersion: expectedExecutionRegistry.versions.chordTimelineResolverVersion,
      });
      requireIntegrity(recalculated.status === "resolved" && exact(recalculated.timeline, timeline), "authoritative EffectiveChordTimeline recalculation mismatch", "EFFECTIVE_CHORD_TIMELINE_STALE");
    }

    const atomization = resolvedAtomization(project);
    if (atomization) {
      requireIntegrity(
        atomization.atomizerVersion
          === expectedExecutionRegistry.versions.sourceLeadAtomizerVersion,
        "atomizer version mismatch",
        "ALGORITHM_CONFIG_MISMATCH",
      );
      await validateAtomizationArtifact(atomization, project.source);
      requireIntegrity(project.chordTimelineState.status === "resolved", "resolved atomization lacks resolved chord timeline", "SOURCE_LEAD_ATOMIZATION_STALE");
      const recalculated = await atomizeSourceLead({
        sourceMeasures: project.source.sourceMeasures,
        performanceSequence: project.source.performanceSequence,
        sectionOccurrences: project.source.sectionOccurrences,
        phraseRegions: project.source.phraseRegions,
        chordTimeline: project.chordTimelineState.timeline,
        musicalSourceDigest,
        atomizerVersion: expectedExecutionRegistry.versions.sourceLeadAtomizerVersion,
      });
      requireIntegrity(exact(recalculated, atomization), "authoritative SourceLeadAtomization recalculation mismatch", "SOURCE_LEAD_ATOMIZATION_STALE");
    }

    const ordinals = buildProjectOrdinals(project);
    validateLockReferences(project, ordinals, atomization?.digest);
    const enabledAssignedHarmonyTracks = project.trackPlans.filter((track) =>
      track.kind === "generated-harmony"
      && track.enabled
      && project.assignments.some((assignment) => assignment.trackPlanId === track.id)).length;
    for (const [presetId, variant] of Object.entries(project.variants)) {
      if (!variant) continue;
      const effectiveConfig = await resolveEffectiveArrangementConfig({
        registry: project.presetProfiles,
        expectedPresetProfileVersion: expectedExecutionRegistry.versions.presetProfileVersion,
        mode: project.settings.mode,
        presetId: presetId as ArrangementPresetId,
        userCaps: project.settings.userCaps,
        assignedEnabledHarmonyTrackCount: enabledAssignedHarmonyTracks,
      });
      await validateVariantIntegrity(
        variant,
        project,
        expectedExecutionRegistry,
        ordinals,
        effectiveConfig,
        musicalSourceDigest,
        timeline,
        atomization,
      );
      if ((project.chordTimelineState.status !== "resolved"
        || project.sourceLeadAtomizationState.status !== "resolved")
        && variant.lifecycle !== "empty") {
        requireIntegrity(variant.staleness !== undefined, "non-empty variant is fresh while source authority is unresolved");
      }
    }
    assertDiagnosticReferences(project, ordinals);
    return { status: "complete", value: project, diagnostics: [] };
  } catch (error) {
    if (error instanceof ProjectIntegrityError) return blockedIntegrity(error.message, error.code);
    return blockedIntegrity(error instanceof Error ? error.message : "unknown project integrity failure");
  }
}
