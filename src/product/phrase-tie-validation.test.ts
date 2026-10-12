import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import * as solverModule from "../grammar/solver";
import { validateWagCandidate } from "../grammar/validator";
import { comparePositions } from "../domain/time";
import type { GeneratedVoiceEvent } from "../domain/generation/model";
import { phraseTieExercise } from "./fixtures/phrase-tie-exercise";
import { pickupRepeatExercise } from "./fixtures/pickup-repeat-exercise";
import { prepareQuickHarmony, generateQuickHarmony } from "./quick-harmony";
import { exportHarmonyProject, importHarmonyProject } from "./project-transfer";

// Captured on develop 2975c6a before changing the phrase partition or validator.
const baseline = JSON.parse(readFileSync(new URL("./fixtures/phrase-tie-baseline.json", import.meta.url), "utf8")) as {
  boundary: "repeat" | "ordinary"; lyrics: boolean; part: "alto" | "tenor"; status: string;
  phraseCount: number; projectSha256?: string; solverSha256: string;
}[];
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const choice = { rightsConfirmed: true, confirmedAt: "2026-10-12T00:00:00.000Z" } as const;
const prepare = (xml: string) => prepareQuickHarmony({ bytes: new TextEncoder().encode(xml), fileName: "phrase-tie.musicxml" });
afterEach(() => vi.restoreAllMocks());

it.each(baseline)("validates $boundary lyrics=$lyrics $part without changing solver or previously complete project bytes", async row => {
  const solve = solverModule.solveWagLocally, outputs: unknown[] = [];
  let args!: Parameters<typeof solve>;
  vi.spyOn(solverModule, "solveWagLocally").mockImplementation(async (...input) => {
    args = input; const result = await solve(...input);
    expect(result.status).toBe("complete"); outputs.push(result); return result;
  });
  const result = await generateQuickHarmony(await prepare(phraseTieExercise(row.boundary, row.lyrics)), { ...choice, parts: [row.part] });
  expect(result.status).toBe("complete");
  if (result.status !== "complete") throw Error(result.status);
  expect(result.project.source.phraseRegions).toHaveLength(row.phraseCount);
  expect(outputs.length).toBeGreaterThan(0);
  expect(sha(JSON.stringify(outputs))).toBe(row.solverSha256);
  const encoded = await exportHarmonyProject(result.project);
  if (row.projectSha256) expect(sha(encoded)).toBe(row.projectSha256);
  expect(await exportHarmonyProject(await importHarmonyProject(encoded))).toBe(encoded);
  const variant = result.project.variants.standard;
  if (variant?.lifecycle !== "generation-attempted") throw Error("missing generation");
  const candidate = variant.generationResult.candidates[0];
  const [trackId, events] = Object.entries(candidate.generatedEventsByTrack)[0];
  const boundary = [...args[0].source.phraseRegions].sort((a, b) => comparePositions(a.range.start, b.range.start))[1].range.start;
  const next = events.findIndex(e => comparePositions(e.range.start, boundary) === 0);
  expect(next).toBeGreaterThan(0);
  expect(events[next]).toMatchObject({ kind: "note", tieStop: false });
  expect(events[next - 1]).toMatchObject({ kind: "note", tieStart: false });
  // False cross-phrase ties must still fail, including equal-pitch/no-lyric boundaries.
  const cross = events.map((e, index) => e.kind !== "note" ? e
    : index === next - 1 ? { ...e, tieStart: true } : index === next ? { ...e, tieStop: true } : e);
  const check = (changed: readonly GeneratedVoiceEvent[]) => validateWagCandidate(...args,
    { ...candidate, generatedEventsByTrack: { ...candidate.generatedEventsByTrack, [trackId]: changed } });
  expect((await check(cross)).diagnostics.some(d => d.code === "INPUT_INVALID_TIE")).toBe(true);
  if (row.boundary === "ordinary" && !row.lyrics) {
    const tied = events.findIndex(e => e.kind === "note" && e.tieStop);
    expect(tied).toBeGreaterThan(0);
    const untied = events.map((e, index) => e.kind !== "note" ? e
      : index === tied - 1 ? { ...e, tieStart: false } : index === tied ? { ...e, tieStop: false } : e);
    expect((await check(untied)).diagnostics.some(d => d.code === "INPUT_INVALID_TIE")).toBe(true);
  }
});

it.each([false, true])("generates the 1-26 inside listening input without lyrics, rest=%s, for every part choice", async rest => {
  const xml = pickupRepeatExercise("inside", rest).replace(/<lyric[\s\S]*?<\/lyric>/gu, "");
  const prep = await prepare(xml);
  for (const parts of [["alto"], ["tenor"], ["alto", "tenor"]] as const) {
    const result = await generateQuickHarmony(prep, { ...choice, parts, answers: { pickupChord: "use-following-first-chord" } });
    expect(result.status, parts.join("+")).toBe("complete");
    if (result.status !== "complete") throw Error(result.status);
    const encoded = await exportHarmonyProject(result.project);
    expect(await exportHarmonyProject(await importHarmonyProject(encoded))).toBe(encoded);
  }
});
