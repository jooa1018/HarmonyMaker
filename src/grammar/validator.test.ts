import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

import type { ArrangementCandidate, ArrangementGenerationResult, GeneratedVoiceEvent } from "../domain/generation/model";
import { fraction } from "../domain/fraction";
import { createWagFixtureInput, pitch } from "./fixtures";
import { planWagActivity, planWagAnchor, planWagIntent } from "./lifecycle";
import { assembleWagGeneration } from "./pipeline";
import { solveWagLocally } from "./solver";
import { validateWagAssembly, validateWagCandidate } from "./validator";

async function fixture() {
  const input = await createWagFixtureInput({
    fixtureId: "hm-segment-b-validator-corruption-matrix-v0",
    presetId: "standard",
    maxHarmonyTracks: 2,
    generatedRanges: [
      { low: pitch("D", 4), high: pitch("C", 6) },
      { low: pitch("C", 2), high: pitch("B", 3) },
    ],
  });
  const intent = await planWagIntent(input);
  if (intent.status !== "complete") throw new Error("intent failed");
  const activity = await planWagActivity(input, intent.value);
  if (activity.status !== "complete") throw new Error("activity failed");
  const anchor = await planWagAnchor(input, intent.value, activity.value);
  if (anchor.status !== "complete") throw new Error("anchor failed");
  const solver = await solveWagLocally(input, intent.value, activity.value, anchor.value);
  if (solver.status !== "complete") throw new Error("solver failed");
  const assembly = await assembleWagGeneration(input, intent.value, activity.value, anchor.value, solver.value);
  return { input, intent: intent.value, activity: activity.value, anchor: anchor.value, assembly };
}

function transformFirstNote(
  candidate: ArrangementCandidate,
  transform: (event: Extract<GeneratedVoiceEvent, { readonly kind: "note" }>) => GeneratedVoiceEvent,
): ArrangementCandidate {
  const entries = Object.entries(candidate.generatedEventsByTrack);
  let transformed = false;
  return {
    ...candidate,
    generatedEventsByTrack: Object.fromEntries(entries.map(([trackPlanId, events]) => [trackPlanId, events.map((event) => {
      if (!transformed && event.kind === "note") {
        transformed = true;
        return transform(event);
      }
      return event;
    })])),
  };
}

describe("independent WAG v1.0.1 Validator", () => {
  it("has no dependency on selector or generator admission/pair helpers", async () => {
    const source = await readFile(new URL("./validator.ts", import.meta.url), "utf8");
    expect(source).not.toContain("selectLocalHarmonyDecision");
    expect(source).not.toContain('from "./pipeline"');
    expect(source).not.toContain('from "./solver"');
    expect(source).not.toContain("validateGenerationResultState");
  });

  it("accepts the unmodified canonical sibling set", async () => {
    const value = await fixture();
    const report = await validateWagAssembly(value.input, value.intent, value.activity, value.anchor, value.assembly.result);
    expect(report.valid).toBe(true);
    expect(report.diagnostics).toEqual([]);
  });

  it("rejects Source-tone illegality without consulting the selector", async () => {
    const value = await fixture();
    const marginal = value.assembly.result.candidates.find((candidate) => Object.keys(candidate.generatedEventsByTrack).length === 1)!;
    const corrupt = transformFirstNote(marginal, (event) => ({ ...event, pitch: { ...event.pitch, step: "F", alter: 1 } }));
    const report = await validateWagCandidate(value.input, value.intent, value.activity, value.anchor, corrupt);
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toContain("GENERATED_CHORD_ROLE_CONFLICT");
  });

  it("rejects hard-range and strict-placement corruption", async () => {
    const value = await fixture();
    const marginals = value.assembly.result.candidates.filter((candidate) => Object.keys(candidate.generatedEventsByTrack).length === 1);
    const outOfRange = transformFirstNote(marginals[0], (event) => ({ ...event, pitch: pitch("C", 8) }));
    const crossing = transformFirstNote(marginals[0], (event) => ({ ...event, pitch: pitch("C", 4) }));
    const [rangeReport, crossingReport] = await Promise.all([
      validateWagCandidate(value.input, value.intent, value.activity, value.anchor, outOfRange),
      validateWagCandidate(value.input, value.intent, value.activity, value.anchor, crossing),
    ]);
    expect(rangeReport.diagnostics.map((diagnostic) => diagnostic.code)).toContain("GENERATED_OUT_OF_RANGE");
    expect(crossingReport.diagnostics.map((diagnostic) => diagnostic.code)).toContain("GENERATED_VOICE_CROSSING");
  });

  it("rejects timing divergence from the canonical decision grid", async () => {
    const value = await fixture();
    const marginal = value.assembly.result.candidates.find((candidate) => Object.keys(candidate.generatedEventsByTrack).length === 1)!;
    const corrupt = transformFirstNote(marginal, (event) => ({
      ...event,
      range: { ...event.range, end: { ...event.range.end, offset: fraction(1, 2) } },
    }));
    const report = await validateWagCandidate(value.input, value.intent, value.activity, value.anchor, corrupt);
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toContain("CANDIDATE_PROJECTION_INVALID");
  });

  it("rejects pair dropout mismatch", async () => {
    const value = await fixture();
    const pair = value.assembly.result.candidates.find((candidate) => Object.keys(candidate.generatedEventsByTrack).length === 2)!;
    const corruptPair = transformFirstNote(pair, (event) => ({ ...event, pitch: { ...event.pitch, octave: event.pitch.octave + 1 } }));
    const result: ArrangementGenerationResult = {
      ...value.assembly.result,
      candidates: value.assembly.result.candidates.map((candidate) => candidate.id === pair.id ? corruptPair : candidate),
    };
    const report = await validateWagAssembly(value.input, value.intent, value.activity, value.anchor, result);
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toContain("WAG_V1_DROPOUT_PROJECTION_MISMATCH");
  });

  it("rejects a full-stack-only repair when a stored marginal is corrupted", async () => {
    const value = await fixture();
    const marginal = value.assembly.result.candidates.find((candidate) => Object.keys(candidate.generatedEventsByTrack).length === 1)!;
    const corruptMarginal = transformFirstNote(marginal, (event) => ({ kind: "rest", id: event.id, range: event.range }));
    const result: ArrangementGenerationResult = {
      ...value.assembly.result,
      candidates: value.assembly.result.candidates.map((candidate) => candidate.id === marginal.id ? corruptMarginal : candidate),
    };
    const report = await validateWagAssembly(value.input, value.intent, value.activity, value.anchor, result);
    expect(report.valid).toBe(false);
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining([
      "ACTIVITY_SPAN_INVALID",
      "WAG_V1_DROPOUT_PROJECTION_MISMATCH",
    ]));
  });
});
