import { describe, expect, it } from "vitest";
import { parseChord } from "../../domain/chord/parser";
import { pitchMidiNumber } from "../../domain/pitch";
import { auditHumanReferenceCandidateSpace, generateBaseline, longestRepeatedRelation, sourceChordPitchClasses } from "./arranger";
import { fixtureById, RIGHTS_SAFE_FIXTURES } from "./fixtures";

describe("post-rc.7 isolated controls and serious B1.5 baseline", () => {
  it("implements B0 as Lead-only and B1 as a naive diatonic-third control on the same schedule", async () => {
    const fixture = fixtureById("hm-original-major-stepwise-v0");
    const b0 = await generateBaseline(fixture, "B0");
    const b1 = await generateBaseline(fixture, "B1");
    const matched = await generateBaseline(fixture, "B1.5-MATCHED");
    expect(b0.arrangement.harmony).toEqual([]);
    expect(b1.arrangement.harmony).toHaveLength(matched.arrangement.harmony.length);
    expect(b1.scheduleDigest).toBe(matched.scheduleDigest);
    expect(b1.decisionTrace.every((decision) => decision.candidates[0].family === "NAIVE_DIATONIC_THIRD")).toBe(true);
  });


  it("uses the declared fixture tonal context for major and minor diatonic thirds", async () => {
    const fixture = fixtureById("hm-original-major-stepwise-v0");
    const fullMatched = {
      ...fixture,
      matchedActivitySchedule: {
        ...fixture.matchedActivitySchedule,
        slots: fixture.matchedActivitySchedule.slots.map((slot) => ({ ...slot, allowHarmony: true })),
      },
    };
    const b1 = await generateBaseline(fullMatched, "B1");
    const intervals = b1.arrangement.harmony.slice(0, 2).map((harmony, index) =>
      pitchMidiNumber(harmony.pitch) - pitchMidiNumber(fixture.lead[index].pitch));
    expect(intervals).toEqual([4, 3]);
    expect(b1.arrangement.harmony[0].pitch).toMatchObject({ step: "E", alter: 0 });
    expect(b1.arrangement.harmony[1].pitch).toMatchObject({ step: "F", alter: 0 });
  });

  it("keeps the previous B1 pitch inside the hard leap and rests or fails honestly when impossible", async () => {
    const fixture = fixtureById("hm-original-major-stepwise-v0");
    const constrained = {
      ...fixture,
      hardLeapSemitones: 0,
      matchedActivitySchedule: {
        ...fixture.matchedActivitySchedule,
        slots: fixture.matchedActivitySchedule.slots.map((slot) => ({ ...slot, allowHarmony: true })),
      },
    };
    const rested = await generateBaseline(constrained, "B1");
    expect(rested.decisionTrace[0].candidates.find((candidate) => candidate.selected)?.family).toBe("NAIVE_DIATONIC_THIRD");
    expect(rested.decisionTrace[1].candidates.find((candidate) => candidate.selected)?.family).toBe("REST");
    const restForbidden = {
      ...constrained,
      matchedActivitySchedule: {
        ...constrained.matchedActivitySchedule,
        slots: constrained.matchedActivitySchedule.slots.map((slot) => ({ ...slot, allowRest: false })),
      },
    };
    await expect(generateBaseline(restForbidden, "B1")).rejects.toThrow("NO_LEGAL_B1_CANDIDATE_AND_REST_FORBIDDEN");
  });

  it("makes MATCHED and E2E Activity schedules experimentally distinct on two original fixtures", async () => {
    for (const id of ["hm-original-major-stepwise-v0", "hm-original-minor-phrase-v0"]) {
      const fixture = fixtureById(id);
      const matched = await generateBaseline(fixture, "B1.5-MATCHED");
      const e2e = await generateBaseline(fixture, "B1.5-E2E");
      expect(matched.scheduleDigest, id).not.toBe(e2e.scheduleDigest);
      expect(matched.arrangement.harmony, id).toHaveLength(3);
      expect(e2e.arrangement.harmony, id).toHaveLength(4);
      expect(matched.arrangement.harmony[0].onsetQ).toEqual(fixture.lead[1].onsetQ);
      expect(e2e.arrangement.harmony[0].onsetQ).toEqual(fixture.lead[0].onsetQ);
    }
  });

  it("honors sus omissions and explicit extensions from the canonical Source chord", () => {
    const sus = fixtureById("hm-original-sus-omission-v0").chords[0].chord;
    const add9 = fixtureById("hm-original-add9-v0").chords[0].chord;
    expect(new Set(sourceChordPitchClasses(sus).map((pitch) => pitch.step))).toEqual(new Set(["C", "D", "G"]));
    expect(sourceChordPitchClasses(sus).some((pitch) => pitch.step === "E")).toBe(false);
    expect(sourceChordPitchClasses(add9).map((pitch) => pitch.step)).toContain("D");
    const nonChordSlash = parseChord("C/D");
    if (nonChordSlash.status !== "ok") throw new Error("expected slash chord");
    expect(sourceChordPitchClasses(nonChordSlash.chord).map((pitch) => pitch.step)).not.toContain("D");
  });

  it("adapts on a chord boundary inside one held Lead syllable without forcing a rest", async () => {
    const fixture = fixtureById("hm-original-held-no-common-upper-v0");
    const result = await generateBaseline(fixture, "B1.5-MATCHED");
    expect(result.arrangement.harmony).toHaveLength(2);
    expect(result.arrangement.harmony[0].syllableId).toBe(result.arrangement.harmony[1].syllableId);
    expect(result.arrangement.harmony[1]).toMatchObject({ lyric: "oo", lyricOnset: false, attack: false, provenance: "CANONICAL_CHORD_BOUNDARY" });
    expect(result.decisionTrace[1].trigger).toBe("CANONICAL_CHORD_BOUNDARY");
    expect(result.decisionTrace[1].candidates.find((candidate) => candidate.selected)?.family).not.toBe("REST");
    expect(result.decisionTrace[1].candidates.some((candidate) => candidate.family === "REST" && !candidate.selected)).toBe(true);
  });

  it("generates Lower directly against its own placement and performer range", async () => {
    const fixture = fixtureById("hm-original-held-no-common-lower-v0");
    const lower = await generateBaseline(fixture, "B1.5-E2E");
    expect(lower.arrangement.harmony).toHaveLength(2);
    for (const harmony of lower.arrangement.harmony) {
      const lead = fixture.lead.find((event) => event.onsetQ.n <= harmony.onsetQ.n)!;
      expect(pitchMidiNumber(harmony.pitch)).toBeLessThan(pitchMidiNumber(lead.pitch));
      expect(pitchMidiNumber(harmony.pitch)).toBeGreaterThanOrEqual(pitchMidiNumber(fixture.performer.hardRange.low));
      expect(pitchMidiNumber(harmony.pitch)).toBeLessThanOrEqual(pitchMidiNumber(fixture.performer.hardRange.high));
    }
  });

  it("prioritizes legal continuation/low motion for a Lead NCT before a generic relation", async () => {
    const fixture = fixtureById("hm-original-lead-nct-passing-v0");
    const result = await generateBaseline(fixture, "B1.5-MATCHED");
    const nctDecision = result.decisionTrace[1];
    expect(nctDecision.leadIsSourceChordTone).toBe(false);
    const chosen = nctDecision.candidates.find((candidate) => candidate.selected)!;
    expect(["LEGAL_CONTINUATION", "LOW_MOTION_CHORD_TONE"]).toContain(chosen.family);
    expect(chosen.sourceChordTone).toBe(true);
  });

  it("keeps rejected hard-range and REST siblings in the inspectable trace", async () => {
    const result = await generateBaseline(fixtureById("hm-original-hard-range-edge-v0"), "B1.5-E2E");
    const candidates = result.decisionTrace.flatMap((decision) => decision.candidates);
    expect(candidates.some((candidate) => candidate.rejectionReasons.includes("HARD_RANGE"))).toBe(true);
    expect(candidates.some((candidate) => candidate.rejectionReasons.includes("HARD_LEAP"))).toBe(true);
    expect(candidates.some((candidate) => candidate.rejectionReasons.includes("PLACEMENT"))).toBe(true);
    expect(candidates.some((candidate) => candidate.family === "REST" && !candidate.selected)).toBe(true);
    expect(candidates.some((candidate) => String(candidate.family).includes("STABLE_COLOR"))).toBe(false);
  });

  it("is deterministic across 101 repetitions for every rights-safe fixture and both B1.5 modes", async () => {
    for (const fixture of RIGHTS_SAFE_FIXTURES) {
      for (const baselineId of ["B1.5-MATCHED", "B1.5-E2E"] as const) {
        const digests = new Set<string>();
        for (let run = 0; run < 101; run += 1) digests.add((await generateBaseline(fixture, baselineId)).arrangementDigest);
        expect(digests.size, `${fixture.id}:${baselineId}`).toBe(1);
      }
    }
  }, 30_000);

  it("reports long repeated directed-relation patterns instead of treating a third as automatically valid", async () => {
    const result = await generateBaseline(fixtureById("hm-original-major-stepwise-v0"), "B1.5-E2E");
    const diagnostic = longestRepeatedRelation(result.decisionTrace);
    expect(diagnostic.count).toBeGreaterThan(0);
    expect(diagnostic.relation).toMatch(/^(UPPER|LOWER)_/);
  });

  it("provides a non-authoritative human-reference candidate-space audit hook", async () => {
    const result = await generateBaseline(fixtureById("hm-original-major-stepwise-v0"), "B1.5-MATCHED");
    expect(auditHumanReferenceCandidateSpace(result.decisionTrace[0])).toEqual({
      status: "AVAILABLE_NOT_POPULATED", candidateId: null, rejectionReasons: [],
    });
    const selected = result.decisionTrace[0].candidates.find((candidate) => candidate.selected)!;
    expect(auditHumanReferenceCandidateSpace(result.decisionTrace[0], selected.pitch!)).toMatchObject({ status: "REFERENCE_IN_CANDIDATE_SPACE", candidateId: selected.id });
  });

  it("keeps display-only naming changes out of the musical result", async () => {
    const fixture = fixtureById("hm-original-major-stepwise-v0");
    const renamed = { ...fixture, title: "Display name changed", performer: { ...fixture.performer, displayName: "Another display label" } };
    expect((await generateBaseline(renamed, "B1.5-E2E")).arrangementDigest).toBe((await generateBaseline(fixture, "B1.5-E2E")).arrangementDigest);
  });

  it("keeps B1 musically distinct from chord-corrected B1.5", async () => {
    const fixture = fixtureById("hm-original-lead-nct-passing-v0");
    const b1 = await generateBaseline(fixture, "B1");
    const b15 = await generateBaseline(fixture, "B1.5-MATCHED");
    expect(b1.arrangementDigest).not.toBe(b15.arrangementDigest);
    expect(b1.decisionTrace.some((decision) => decision.candidates.some((candidate) => candidate.selected && candidate.chordClash))).toBe(true);
    expect(b15.decisionTrace.every((decision) => decision.candidates.some((candidate) => candidate.selected && candidate.sourceChordTone))).toBe(true);
  });

  it("selects REST only for a hard impossibility when the explicit slot permits it", async () => {
    const fixture = fixtureById("hm-original-major-stepwise-v0");
    const impossibleRange = { low: fixture.lead[0].pitch, high: fixture.lead[0].pitch };
    const impossible = {
      ...fixture,
      performer: {
        ...fixture.performer,
        hardRange: impossibleRange,
        comfortableRange: impossibleRange,
        preferredTessitura: impossibleRange,
      },
    };
    const rested = await generateBaseline(impossible, "B1.5-MATCHED");
    expect(rested.decisionTrace[0].candidates.find((candidate) => candidate.selected)?.family).toBe("REST");
    const restForbidden = {
      ...impossible,
      matchedActivitySchedule: {
        ...impossible.matchedActivitySchedule,
        slots: impossible.matchedActivitySchedule.slots.map((slot) => ({ ...slot, allowRest: false })),
      },
    };
    await expect(generateBaseline(restForbidden, "B1.5-MATCHED")).rejects.toThrow("NO_LEGAL_B15_CANDIDATE_AND_REST_FORBIDDEN");
  });
});
