import { generateDeterministicAccompaniment, type DeterministicAccompaniment } from "../accompaniment/deterministic";
import type { Diagnostic } from "../domain/diagnostics";
import type { ArrangementCandidate, ArrangementGenerationResult, ArrangementRenderDocument } from "../domain/generation/model";
import { validateRenderDocumentAuthority } from "../domain/generation/render";
import { planWagActivity, planWagAnchor, planWagIntent, type WagLifecycleInput } from "./lifecycle";
import { assembleWagGeneration, type WagGenerationAssembly } from "./pipeline";
import { solveWagLocally } from "./solver";
import { validateWagAssembly, type WagAssemblyValidationReport } from "./validator";

export type WagSegmentBStage = "intent" | "activity" | "anchor" | "solver" | "assembly" | "validation";

export type WagSegmentBExecution =
  | {
      readonly status: "complete" | "partial";
      readonly generation: WagGenerationAssembly;
      readonly validation: WagAssemblyValidationReport;
      readonly accompaniment: DeterministicAccompaniment;
      readonly renderDocument: ArrangementRenderDocument;
    }
  | {
      readonly status: "blocked";
      readonly stage: WagSegmentBStage;
      readonly diagnostics: readonly Diagnostic[];
      readonly rejectedResult?: ArrangementGenerationResult;
    };

export function buildWagRenderDocument(
  input: WagLifecycleInput,
  candidate: ArrangementCandidate,
): ArrangementRenderDocument {
  const trackOrdinalById = Object.fromEntries(input.trackPlans.map((track) => [
    track.id,
    track.kind === "source-lead" ? 0 : track.canonicalOrdinal,
  ]));
  const generatedHarmonyTracks = Object.entries(candidate.generatedEventsByTrack)
    .sort(([left], [right]) => trackOrdinalById[left] - trackOrdinalById[right])
    .map(([trackPlanId, events]) => ({ trackPlanId, events }));
  const document: ArrangementRenderDocument = {
    measures: input.source.performanceSequence.occurrences,
    sourceLeadTrack: {
      trackPlanId: "track:source-lead",
      atomizationDigest: input.sourceLeadAtomization.digest,
      atoms: input.sourceLeadAtomization.atoms,
    },
    generatedHarmonyTracks,
    effectiveChordTimeline: input.effectiveChordTimeline,
    lyricTokens: input.source.sourceMeasures.flatMap((measure) => measure.lyricTokens),
  };
  if (!validateRenderDocumentAuthority(document)) throw new RangeError("CANDIDATE_PROJECTION_INVALID");
  return document;
}

/** Canonical Segment-B orchestration. No stage may skip, retone, or repair an earlier stage. */
export async function executeWagSegmentB(input: WagLifecycleInput): Promise<WagSegmentBExecution> {
  const intent = await planWagIntent(input);
  if (intent.status === "blocked") return { status: "blocked", stage: "intent", diagnostics: intent.diagnostics };
  const activity = await planWagActivity(input, intent.value);
  if (activity.status === "blocked") return { status: "blocked", stage: "activity", diagnostics: activity.diagnostics };
  const anchor = await planWagAnchor(input, intent.value, activity.value);
  if (anchor.status === "blocked") return { status: "blocked", stage: "anchor", diagnostics: anchor.diagnostics };
  const solver = await solveWagLocally(input, intent.value, activity.value, anchor.value);
  if (solver.status === "blocked") return { status: "blocked", stage: "solver", diagnostics: solver.diagnostics };
  const generation = await assembleWagGeneration(input, intent.value, activity.value, anchor.value, solver.value);
  if (generation.result.status === "blocked") {
    return { status: "blocked", stage: "assembly", diagnostics: generation.result.diagnostics, rejectedResult: generation.result };
  }
  const validation = await validateWagAssembly(input, intent.value, activity.value, anchor.value, generation.result);
  if (!validation.valid) {
    return {
      status: "blocked",
      stage: "validation",
      diagnostics: validation.diagnostics,
      rejectedResult: { ...generation.result, status: "blocked", candidates: [], diagnostics: validation.diagnostics },
    };
  }
  const accompaniment = await generateDeterministicAccompaniment(input.effectiveChordTimeline);
  const selected = generation.result.candidates.find((candidate) => candidate.id === generation.defaultCandidateId);
  if (!selected) throw new RangeError("GENERATION_RESULT_STATE_INVALID");
  const renderDocument = buildWagRenderDocument(input, selected);
  return { status: generation.result.status, generation, validation, accompaniment, renderDocument };
}
