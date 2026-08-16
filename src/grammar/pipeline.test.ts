import { describe, expect, it } from "vitest";

import { fraction } from "../domain/fraction";
import { createWagFixtureInput, pitch } from "./fixtures";
import { planWagActivity, planWagAnchor, planWagIntent } from "./lifecycle";
import { assembleWagGeneration } from "./pipeline";
import { solveWagLocally } from "./solver";

function musicalPayloads(events: readonly import("../domain/generation/model").GeneratedVoiceEvent[]) {
  return events.map((event) => event.kind === "rest" ? { kind: event.kind, range: event.range } : {
    kind: event.kind,
    range: event.range,
    pitch: event.pitch,
    tieStart: event.tieStart,
    tieStop: event.tieStop,
    lyricTokenIds: event.lyricTokenIds,
    source: event.source,
    originDirectiveId: event.originDirectiveId,
  });
}

async function run(input: Awaited<ReturnType<typeof createWagFixtureInput>>) {
  const intent = await planWagIntent(input);
  if (intent.status !== "complete") throw new Error("intent failed");
  const activity = await planWagActivity(input, intent.value);
  if (activity.status !== "complete") throw new Error("activity failed");
  const anchor = await planWagAnchor(input, intent.value, activity.value);
  if (anchor.status !== "complete") throw new Error("anchor failed");
  const solver = await solveWagLocally(input, intent.value, activity.value, anchor.value);
  if (solver.status !== "complete") throw new Error("solver failed");
  return assembleWagGeneration(input, intent.value, activity.value, anchor.value, solver.value);
}

describe("WAG v1.0.1 standalone-first candidate assembly", () => {
  it("retains complete Lead-only when harmonyExpectation is none", async () => {
    const assembly = await run(await createWagFixtureInput({ maxHarmonyTracks: 0 }));
    expect(assembly.result.status).toBe("complete");
    expect(assembly.result.candidates).toHaveLength(1);
    expect(assembly.result.candidates[0]).toMatchObject({
      candidateStatus: "complete",
      canonicalPathKey: "wag1-local-v1|tx=0",
      generatedEventsByTrack: {},
    });
    expect(assembly.defaultCandidateId).toBe(assembly.result.candidates[0].id);
  });

  it("keeps H1 complete and isolates the H1-required Lead-only partial diagnostic", async () => {
    const assembly = await run(await createWagFixtureInput({
      presetId: "simple",
      generatedRanges: [{ low: pitch("D", 4), high: pitch("C", 6) }],
      maxHarmonyTracks: 1,
    }));
    expect(assembly.result.status).toBe("complete");
    expect(assembly.result.diagnostics).toEqual([]);
    expect(assembly.result.candidates.map((candidate) => candidate.candidateStatus)).toEqual(["complete", "partial"]);
    expect(Object.keys(assembly.result.candidates[0].generatedEventsByTrack)).toEqual(["track:h1"]);
    expect(assembly.result.candidates[1].diagnostics).toEqual([
      expect.objectContaining({ code: "WAG_V1_PARTIAL_REQUIRED_COVERAGE" }),
    ]);
    expect(assembly.result.candidates[0].canonicalPathKey).toMatch(/^wag1-local-v1\|tx=2\|d=0,tr=1,/);
  });

  it("forms a pair only from immutable complete Upper and Lower marginals", async () => {
    const assembly = await run(await createWagFixtureInput({
      presetId: "standard",
      generatedRanges: [
        { low: pitch("D", 4), high: pitch("C", 6) },
        { low: pitch("C", 2), high: pitch("B", 3) },
      ],
      maxHarmonyTracks: 2,
    }));
    expect(assembly.result.status).toBe("complete");
    expect(assembly.result.candidates.map((candidate) => Object.keys(candidate.generatedEventsByTrack).length)).toEqual([2, 1, 1, 0]);
    expect(assembly.pairMetrics).toEqual(expect.objectContaining({
      dropoutParity: true,
      threeDistinctPitchDecisionCount: expect.any(Number),
    }));
    expect(assembly.pairMetrics!.threeDistinctPitchDecisionCount).toBeGreaterThanOrEqual(2);
    const pair = assembly.result.candidates[0];
    for (const marginal of assembly.result.candidates.filter((candidate) => Object.keys(candidate.generatedEventsByTrack).length === 1)) {
      const trackId = Object.keys(marginal.generatedEventsByTrack)[0];
      expect(musicalPayloads(pair.generatedEventsByTrack[trackId])).toEqual(musicalPayloads(marginal.generatedEventsByTrack[trackId]));
    }
  });

  it("rejects an automatic one-note orphan below the perceptibility floor", async () => {
    const assembly = await run(await createWagFixtureInput({
      presetId: "simple",
      generatedRanges: [{ low: pitch("D", 4), high: pitch("C", 6) }],
      maxHarmonyTracks: 1,
      leadNotes: [{ onset: fraction(0), duration: fraction(1, 2), pitch: pitch("C", 4), lyric: "la" }],
    }));
    expect(assembly.marginals).toEqual([]);
    expect(assembly.rejections).toEqual([
      expect.objectContaining({ reason: "OPTIONAL_MARGINAL_NOT_PERCEPTIBLE", trackPlanIds: ["track:h1"] }),
    ]);
    expect(assembly.result.status).toBe("complete");
    expect(assembly.result.candidates).toHaveLength(1);
    expect(assembly.result.candidates[0].candidateStatus).toBe("complete");
  });

  it("is byte-deterministic for candidate IDs, order, metrics, and result digests", async () => {
    const input = await createWagFixtureInput({ presetId: "standard", maxHarmonyTracks: 2 });
    const [left, right] = await Promise.all([run(input), run(input)]);
    expect(JSON.stringify(right)).toBe(JSON.stringify(left));
  });
});
