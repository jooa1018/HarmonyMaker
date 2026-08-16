import { generateDeterministicAccompaniment, type DeterministicAccompaniment } from "../accompaniment/deterministic";
import type { Diagnostic } from "../domain/diagnostics";
import type { ArrangementGenerationResult } from "../domain/generation/model";
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
    }
  | {
      readonly status: "blocked";
      readonly stage: WagSegmentBStage;
      readonly diagnostics: readonly Diagnostic[];
      readonly rejectedResult?: ArrangementGenerationResult;
    };

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
  return { status: generation.result.status, generation, validation, accompaniment };
}
