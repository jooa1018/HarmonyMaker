import { describe, expect, it } from "vitest";
import type { SemanticDigest } from "../digest/canonical";
import { fraction } from "../fraction";
import { countRate, durationRate, extendedCountRate } from "../rates";
import { musicalRange } from "../time";
import { buildArrangementCandidate, validateGenerationResultState, type CandidateBuildInput } from "./candidate";
import type { FullSongMetrics, TextureDensityMetrics } from "./model";

const d = "0".repeat(64) as SemanticDigest;
const zeroDensity: TextureDensityMetrics = { participationCoverage: durationRate(fraction(0), fraction(0)), harmonyAttackRatio: extendedCountRate(0, 0), harmonyOverLeadRestCoverage: durationRate(fraction(0), fraction(0)), maxSimultaneousHarmonyTracks: 0, harmonicDivergenceCoverage: durationRate(fraction(0), fraction(0)), exactlyTwoPitchCoverage: durationRate(fraction(0), fraction(0)), exactlyThreePitchCoverage: durationRate(fraction(0), fraction(0)), medianRegisterSpreadSemitones: 0 };
const metrics: FullSongMetrics = { densityBySectionOccurrence: { "so:0": zeroDensity }, maxLeapSemitonesByTrack: { "track:1": 0 }, hardDiagnosticCount: 0, plannedNctResolution: countRate(0, 0), sourceChordRespect: countRate(0, 0) };
const range = musicalRange({ performanceMeasureIndex: 0, offset: fraction(0) }, { performanceMeasureIndex: 0, offset: fraction(1) });
const base: CandidateBuildInput = {
  presetId: "simple", candidateStatus: "complete", anchorPlanDigest: d, effectiveConfigDigest: d, presetProfileDigest: d, effectiveChordTimelineDigest: d, sourceLeadAtomizationDigest: d,
  tracks: [{ trackPlanId: "track:1", events: [{ kind: "note", range, pitch: { step: "E", alter: 0, octave: 4 }, tieStart: false, tieStop: false, lyricTokenIds: ["ly:0"], source: "anchor", originDirectiveId: "ha:0" }] }],
  realizedAnchors: [{ directiveId: "ha:0", trackPlanId: "track:1", position: range.start, pitch: { step: "E", alter: 0, octave: 4 } }],
  ordinals: { trackOrdinalById: { "track:1": 1 }, lyricOrdinalById: { "ly:0": 0 }, anchorDirectiveOrdinalById: { "ha:0": 0 } }, metrics, diagnostics: [], canonicalPathKey: "path-a",
};

describe("candidate projection and deterministic generated IDs", () => {
  it("builds digest before Candidate and Generated Event IDs", async () => {
    const candidate = await buildArrangementCandidate(base);
    expect(candidate.id).toBe(`cand:simple:${candidate.contentDigest}`);
    expect(candidate.generatedEventsByTrack["track:1"][0].id).toBe(`gen:${candidate.contentDigest}:1:0:0/1:0`);
  });

  it("excludes diagnostics, metrics, trace/path, and persistent input IDs", async () => {
    const first = await buildArrangementCandidate(base);
    const second = await buildArrangementCandidate({ ...base, diagnostics: [{ id: "random", code: "GEN_TIMEOUT", severity: "warning", messageKo: "display" }], metrics: { ...metrics, hardDiagnosticCount: 99 }, canonicalPathKey: "path-b" });
    expect(second.contentDigest).toBe(first.contentDigest);
    expect(second.id).toBe(first.id);
  });

  it("validates generation result truth table without fake candidates", async () => {
    const complete = await buildArrangementCandidate(base);
    const partial = await buildArrangementCandidate({ ...base, candidateStatus: "partial" });
    expect(validateGenerationResultState("blocked", [], true)).toBe(true);
    expect(validateGenerationResultState("blocked", [complete], true)).toBe(false);
    expect(validateGenerationResultState("complete", [complete], false)).toBe(true);
    expect(validateGenerationResultState("partial", [partial], false)).toBe(true);
  });
});
