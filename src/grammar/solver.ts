import type { ChordToneSpec } from "../domain/chord/model";
import { createDiagnostics, type Diagnostic } from "../domain/diagnostics";
import { compareFractions } from "../domain/fraction";
import type { AnchorLock, PitchLock } from "../domain/locks";
import { findPitchAnchorConflicts } from "../domain/locks";
import type {
  ArrangementActivityPlan,
  ArrangementAnchorPlan,
  ArrangementIntentPlan,
  HarmonyAnchorDirective,
  StageExecutionResult,
  VoiceActivityDirective,
} from "../domain/plans";
import { pitchMidiNumber, type SpelledPitch } from "../domain/pitch";
import type {
  GeneratedVoiceEventPayload,
  RealizedHarmonyAnchor,
} from "../domain/generation/model";
import { comparePositions, compareRanges, type MusicalRange } from "../domain/time";
import type { VocalPlacementRole } from "../domain/performer";
import {
  activityAt,
  localContext,
  localDecisionsForPhrase,
  performerForTrack,
  placementRoleFor,
  prepareWagLifecycle,
  primaryPulseAt,
  rangeDuration,
  wagAnchorAuthorityMatches,
  type WagLifecycleInput,
  type WagLocalDecision,
} from "./lifecycle";
import type { V0HarmonyCandidateFamily } from "./local-selection";
import { selectLocalHarmonyDecision, type RankedLocalHarmonyCandidate } from "./local-selection";

export interface SolvedWagDecision {
  readonly phraseId: string;
  readonly sectionOccurrenceId: string;
  readonly trackPlanId: string;
  readonly placementRole?: VocalPlacementRole;
  readonly range: MusicalRange;
  readonly activity: VoiceActivityDirective;
  readonly leadAtomId: string;
  readonly chordSpanId?: string;
  readonly leadPitch: SpelledPitch | null;
  readonly lyricTokenIds: readonly string[];
  readonly originDirectiveId?: string;
  readonly selectedTone?: ChordToneSpec;
  readonly selectedPitch?: SpelledPitch;
  readonly candidateFamily?: Exclude<V0HarmonyCandidateFamily, "REST">;
  readonly rankTuple?: readonly number[];
  readonly exhaustiveCandidateCount: number;
}

export interface SolvedWagTrack {
  readonly trackPlanId: string;
  readonly trackOrdinal: 1 | 2;
  readonly selectedByIntent: boolean;
  readonly decisions: readonly SolvedWagDecision[];
  readonly eventPayloads: readonly GeneratedVoiceEventPayload[];
  readonly realizedAnchors: readonly RealizedHarmonyAnchor[];
  readonly perceptible: boolean;
  readonly fullRequiredCoverage: boolean;
  readonly realizedPitchByAnchorLockId: Readonly<Record<string, SpelledPitch>>;
}

export interface WagLocalSolverOutput {
  readonly tracks: readonly SolvedWagTrack[];
  readonly generatedNctPlanCount: 0;
}

function samePosition(left: Parameters<typeof comparePositions>[0], right: Parameters<typeof comparePositions>[1]): boolean {
  return comparePositions(left, right) === 0;
}

function samePitch(left: SpelledPitch, right: SpelledPitch): boolean {
  return left.step === right.step && left.alter === right.alter && left.octave === right.octave;
}

function toneEqual(left: ChordToneSpec, right: ChordToneSpec): boolean {
  return left.degree === right.degree
    && left.alteration === right.alteration
    && left.role === right.role
    && left.origin === right.origin;
}

function directiveAt(
  anchorPlan: ArrangementAnchorPlan,
  phraseId: string,
  trackPlanId: string,
  decision: WagLocalDecision,
): HarmonyAnchorDirective | undefined {
  return anchorPlan.phraseAnchorPlans.find((phrase) => phrase.phraseId === phraseId)
    ?.anchorDirectives.find((directive) => directive.trackPlanId === trackPlanId && samePosition(directive.position, decision.range.start));
}

function pitchLocksAt(
  locks: readonly PitchLock[],
  phraseId: string,
  trackPlanId: string,
  decision: WagLocalDecision,
): readonly PitchLock[] {
  return locks.filter((lock) => lock.phraseId === phraseId
    && lock.trackPlanId === trackPlanId && samePosition(lock.position, decision.range.start));
}

function anchorLockAt(
  locks: readonly AnchorLock[],
  phraseId: string,
  trackPlanId: string,
  decision: WagLocalDecision,
): AnchorLock | undefined {
  return locks.find((lock) => lock.phraseId === phraseId
    && lock.trackPlanId === trackPlanId && samePosition(lock.position, decision.range.start));
}

function diagnostic(
  code: Diagnostic["code"],
  phraseId: string,
  details: Readonly<Record<string, string | number | boolean>>,
): Omit<Diagnostic, "id"> {
  return { code, severity: "blocking", messageKo: code, location: { phraseId }, details };
}

function candidateForTone(
  candidates: readonly RankedLocalHarmonyCandidate[],
  tone: ChordToneSpec,
): RankedLocalHarmonyCandidate | undefined {
  return candidates.find((candidate) => toneEqual(candidate.tone, tone));
}

function withTies(events: readonly GeneratedVoiceEventPayload[]): readonly GeneratedVoiceEventPayload[] {
  const result = events.map((event) => ({ ...event })) as GeneratedVoiceEventPayload[];
  for (let index = 1; index < result.length; index += 1) {
    const previous = result[index - 1];
    const current = result[index];
    if (previous.kind !== "note" || current.kind !== "note"
      || !samePosition(previous.range.end, current.range.start)
      || current.lyricTokenIds.length > 0
      || !samePitch(previous.pitch, current.pitch)) continue;
    result[index - 1] = { ...previous, tieStart: true };
    result[index] = { ...current, tieStop: true };
  }
  return result;
}

function isChordEligible(decision: WagLocalDecision): boolean {
  return decision.atom.pitch !== null && decision.chordSpan?.parseResult.status === "ok";
}

function selectedCandidate(
  candidates: readonly RankedLocalHarmonyCandidate[],
  directive: Extract<HarmonyAnchorDirective, { readonly kind: "chord-tone" }>,
  pitchLock: PitchLock | undefined,
): RankedLocalHarmonyCandidate | undefined {
  return candidates.find((candidate) => toneEqual(candidate.tone, directive.selectedTone)
    && (!pitchLock || samePitch(candidate.pitch, pitchLock.pitch)));
}

export async function solveWagLocally(
  input: WagLifecycleInput,
  intentPlan: ArrangementIntentPlan,
  activityPlan: ArrangementActivityPlan,
  anchorPlan: ArrangementAnchorPlan,
): Promise<StageExecutionResult<WagLocalSolverOutput>> {
  const preparedResult = await prepareWagLifecycle(input);
  if (preparedResult.status === "blocked") return preparedResult;
  const prepared = preparedResult.value;
  if (!await wagAnchorAuthorityMatches(prepared, intentPlan, activityPlan, anchorPlan)
    || anchorPlan.phraseAnchorPlans.some((phrase) => phrase.nctPlans.length !== 0
      || phrase.anchorDirectives.some((directive) => directive.kind !== "chord-tone"))) {
    return {
      status: "blocked",
      diagnostics: await createDiagnostics([
        diagnostic("ALGORITHM_CONFIG_MISMATCH", input.source.phraseRegions[0]?.id ?? "none", { stage: "solver", reason: "ANCHOR_PLAN_INVALID" }),
      ], prepared.authority.diagnostics),
    };
  }
  const tracks: SolvedWagTrack[] = [];
  const rawDiagnostics: Omit<Diagnostic, "id">[] = [];
  const consumedPitchLockIds = new Set<string>();
  for (const assigned of prepared.assignedTracks) {
    const solvedDecisions: SolvedWagDecision[] = [];
    const eventPayloads: GeneratedVoiceEventPayload[] = [];
    const realizedAnchors: RealizedHarmonyAnchor[] = [];
    const realizedPitchByAnchorLockId: Record<string, SpelledPitch> = {};
    let selectedByIntent = false;
    let fullRequiredCoverage = true;
    for (const phrase of prepared.phrases) {
      const role = placementRoleFor(intentPlan, phrase.id, assigned.trackPlan.id);
      const phraseIntent = intentPlan.phraseIntents.find((candidate) => candidate.phraseId === phrase.id);
      const phraseActivity = activityPlan.phraseActivityPlans.find((candidate) => candidate.phraseId === phrase.id);
      const phraseAnchor = anchorPlan.phraseAnchorPlans.find((candidate) => candidate.phraseId === phrase.id);
      if (!phraseIntent || !phraseActivity || !phraseAnchor) {
        rawDiagnostics.push(diagnostic("STALE_REFERENCE", phrase.id, { stage: "solver", trackPlanId: assigned.trackPlan.id }));
        continue;
      }
      if (role) selectedByIntent = true;
      const boundaries = phraseActivity.activitySpans.flatMap((span) => [span.range.start, span.range.end]);
      const decisions = localDecisionsForPhrase(prepared, phrase, boundaries);
      let previous: SpelledPitch | undefined;
      let continuity: "continuous" | "reentry" | "initial" = "initial";
      let divergenceLockId: string | undefined;
      const phraseEvents: GeneratedVoiceEventPayload[] = [];
      for (const decision of decisions) {
        const activity = activityAt(activityPlan, phrase.id, assigned.trackPlan.id, decision.range) ?? { state: "rest" as const };
        if (activity.state !== "independent-note") {
          if (role && phraseIntent.harmonyExpectation === "H1-required" && isChordEligible(decision)) fullRequiredCoverage = false;
          const event: GeneratedVoiceEventPayload = { kind: "rest", range: decision.range };
          phraseEvents.push(event);
          solvedDecisions.push({
            phraseId: phrase.id,
            sectionOccurrenceId: phrase.sectionOccurrenceId,
            trackPlanId: assigned.trackPlan.id,
            ...(role ? { placementRole: role } : {}),
            range: decision.range,
            activity,
            leadAtomId: decision.atom.id,
            ...(decision.chordSpan ? { chordSpanId: decision.chordSpan.id } : {}),
            leadPitch: decision.atom.pitch,
            lyricTokenIds: [],
            exhaustiveCandidateCount: 0,
          });
          previous = undefined;
          continuity = continuity === "initial" ? "initial" : "reentry";
          continue;
        }
        const directive = directiveAt(anchorPlan, phrase.id, assigned.trackPlan.id, decision);
        if (!role || !directive || directive.kind !== "chord-tone"
          || !decision.atom.pitch || decision.chordSpan?.parseResult.status !== "ok") {
          rawDiagnostics.push(diagnostic("WAG_V1_ANCHOR_SOLVER_SELECTION_PARITY_MISMATCH", phrase.id, { trackPlanId: assigned.trackPlan.id }));
          continue;
        }
        const pitchLocks = pitchLocksAt(prepared.locks.solver, phrase.id, assigned.trackPlan.id, decision);
        pitchLocks.forEach((lock) => consumedPitchLockIds.add(lock.id));
        if (pitchLocks.length > 1) {
          rawDiagnostics.push(diagnostic("STAGE_LOCK_SCOPE_INVALID", phrase.id, { stage: "solver", reason: "MULTIPLE_PITCH_LOCKS", trackPlanId: assigned.trackPlan.id }));
          continue;
        }
        const pitchLock = pitchLocks[0];
        const selection = selectLocalHarmonyDecision(
          localContext(prepared, decision, assigned.trackPlan.id, role, previous, continuity),
          decision.chordSpan.parseResult.chord,
          performerForTrack(prepared, assigned.trackPlan.id),
          input.effectiveConfig,
          { restFallback: "forbidden" },
        );
        if (selection.status !== "note") {
          if (pitchLock || divergenceLockId) {
            rawDiagnostics.push(diagnostic("STAGE_LOCK_SCOPE_INVALID", phrase.id, {
              stage: "solver", lockId: pitchLock?.id ?? divergenceLockId ?? "none", reason: "LOCK_INDUCED_NO_LEGAL_CANDIDATE",
            }));
          } else rawDiagnostics.push(diagnostic("WAG_V1_ANCHOR_SOLVER_SELECTION_PARITY_MISMATCH", phrase.id, { trackPlanId: assigned.trackPlan.id }));
          continue;
        }
        const selected = selectedCandidate(selection.candidates, directive, pitchLock);
        if (!selected) {
          rawDiagnostics.push(diagnostic(pitchLock ? "STAGE_LOCK_SCOPE_INVALID" : "WAG_V1_ANCHOR_SOLVER_SELECTION_PARITY_MISMATCH", phrase.id, {
            stage: "solver",
            lockId: pitchLock?.id ?? "none",
            reason: pitchLock ? "LOCK_INDUCED_NO_LEGAL_CANDIDATE" : "ANCHOR_TONE_NOT_REALIZABLE",
          }));
          continue;
        }
        if (pitchLock && !samePitch(selected.pitch, candidateForTone(selection.candidates, directive.selectedTone)?.pitch ?? selected.pitch)) {
          divergenceLockId = pitchLock.id;
        }
        const event: GeneratedVoiceEventPayload = {
          kind: "note",
          range: decision.range,
          pitch: selected.pitch,
          tieStart: false,
          tieStop: false,
          lyricTokenIds: decision.lyricTokenIds,
          source: "anchor",
          originDirectiveId: directive.id,
        };
        phraseEvents.push(event);
        realizedAnchors.push({
          directiveId: directive.id,
          trackPlanId: assigned.trackPlan.id,
          position: decision.range.start,
          pitch: selected.pitch,
        });
        const anchorLock = anchorLockAt(prepared.locks.anchor, phrase.id, assigned.trackPlan.id, decision);
        if (anchorLock) realizedPitchByAnchorLockId[anchorLock.id] = selected.pitch;
        solvedDecisions.push({
          phraseId: phrase.id,
          sectionOccurrenceId: phrase.sectionOccurrenceId,
          trackPlanId: assigned.trackPlan.id,
          placementRole: role,
          range: decision.range,
          activity,
          leadAtomId: decision.atom.id,
          chordSpanId: decision.chordSpan.id,
          leadPitch: decision.atom.pitch,
          lyricTokenIds: decision.lyricTokenIds,
          originDirectiveId: directive.id,
          selectedTone: directive.selectedTone,
          selectedPitch: selected.pitch,
          candidateFamily: selected.family,
          rankTuple: selected.rankTuple,
          exhaustiveCandidateCount: selection.candidates.length,
        });
        previous = selected.pitch;
        continuity = "continuous";
      }
      eventPayloads.push(...withTies(phraseEvents));
    }
    const conflicts = findPitchAnchorConflicts(prepared.locks.anchor, prepared.locks.solver, realizedPitchByAnchorLockId);
    if (conflicts.length > 0) {
      rawDiagnostics.push(diagnostic("STAGE_LOCK_SCOPE_INVALID", prepared.phrases[0]?.id ?? "none", { stage: "solver", reason: "POST_PITCH_LOCK_CONFLICT", conflictCount: conflicts.length }));
    }
    const soundingDecisions = solvedDecisions.filter((decision) => decision.selectedPitch !== undefined);
    const perceptible = soundingDecisions.length >= 2 || soundingDecisions.some((decision) =>
      compareFractions(rangeDuration(decision.range, prepared.measureDurations), primaryPulseAt(prepared, decision.range.start)) >= 0);
    tracks.push({
      trackPlanId: assigned.trackPlan.id,
      trackOrdinal: assigned.trackPlan.canonicalOrdinal,
      selectedByIntent,
      decisions: solvedDecisions.sort((left, right) => compareRanges(left.range, right.range)),
      eventPayloads,
      realizedAnchors: realizedAnchors.sort((left, right) => comparePositions(left.position, right.position)),
      perceptible,
      fullRequiredCoverage,
      realizedPitchByAnchorLockId,
    });
  }
  for (const lock of prepared.locks.solver) {
    if (!consumedPitchLockIds.has(lock.id)) rawDiagnostics.push(diagnostic("STAGE_LOCK_SCOPE_INVALID", lock.phraseId, {
      stage: "solver", lockId: lock.id, reason: "LOCK_TARGET_NOT_MATERIALIZED",
    }));
  }
  if (rawDiagnostics.length > 0) {
    return { status: "blocked", diagnostics: await createDiagnostics(rawDiagnostics, prepared.authority.diagnostics) };
  }
  return { status: "complete", value: { tracks, generatedNctPlanCount: 0 }, diagnostics: [] };
}

export function trackProjectionWithoutWrapperIds(track: SolvedWagTrack): object {
  return {
    trackOrdinal: track.trackOrdinal,
    events: track.eventPayloads,
    realizedAnchors: track.realizedAnchors.map((anchor) => ({
      position: anchor.position,
      pitch: anchor.pitch,
    })),
  };
}

export function immutableTrackProjectionEqual(left: SolvedWagTrack, right: SolvedWagTrack): boolean {
  return JSON.stringify(trackProjectionWithoutWrapperIds(left)) === JSON.stringify(trackProjectionWithoutWrapperIds(right));
}

export function soundingMidi(decision: SolvedWagDecision): number | undefined {
  return decision.selectedPitch ? pitchMidiNumber(decision.selectedPitch) : undefined;
}
