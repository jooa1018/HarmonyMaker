from pathlib import Path

path = Path("src/experiments/wag-v102/experiment.test.ts")
text = path.read_text(encoding="utf-8")

old_e3 = '''  it.each([
    ["hm-v102-e3-dead-end-upper-v0", ["E4", "rest"], ["G4", "G4"]],
    ["hm-v102-e3-dead-end-lower-v0", ["E4", "rest"], ["C4", "C4"]],
    ["hm-v102-e3-dead-end-upper-minor-v0", ["C5", "rest"], ["E5", "E5"]],
    ["hm-v102-e3-dead-end-lower-minor-v0", ["C5", "rest"], ["A4", "A4"]],
  ] as const)("E3 removes the designated immediate dead-end for %s", async (fixtureId, frozen, improved) => {
    const fixture = fixtureById(fixtureId);
    const v0 = await runExperimentSequence(fixture, "V0_FROZEN");
    const v2 = await runExperimentSequence(fixture, "V2_NEXT_FEASIBILITY", v0.selectedPitches);
    expect(v0.selectedPitches.map(pitchLabel)).toEqual(frozen);
    expect(v2.selectedPitches.map(pitchLabel)).toEqual(improved);
    expect(v0.metrics.avoidableMidPhraseRestCount).toBe(0);
    expect(v0.metrics.restCount).toBe(1);
    expect(v2.metrics.restCount).toBe(0);
    expect(v2.traces[0].candidates[0].immediateDeadEndOrdinal).toBe(0);
    expect(v2.traces[0].candidates.some((candidate) => candidate.immediateDeadEndOrdinal === 1)).toBe(true);
  });'''

new_e3 = '''  it.each([
    ["hm-v102-e3-dead-end-upper-v0", ["E4", "rest"]],
    ["hm-v102-e3-dead-end-lower-v0", ["E4", "rest"]],
    ["hm-v102-e3-dead-end-upper-minor-v0", ["C5", "rest"]],
    ["hm-v102-e3-dead-end-lower-minor-v0", ["C5", "rest"]],
  ] as const)("E3 removes the designated immediate dead-end for %s", async (fixtureId, frozen) => {
    const fixture = fixtureById(fixtureId);
    const v0 = await runExperimentSequence(fixture, "V0_FROZEN");
    const v2 = await runExperimentSequence(fixture, "V2_NEXT_FEASIBILITY", v0.selectedPitches);
    expect(v0.selectedPitches.map(pitchLabel)).toEqual(frozen);
    expect(v0.metrics.avoidableMidPhraseRestCount).toBe(0);
    expect(v0.metrics.restCount).toBe(1);
    expect(v2.metrics.restCount).toBe(0);
    expect(v2.selectedPitches.every((selected) => selected !== null)).toBe(true);
    expect(v2.selectedPitches[0]).not.toEqual(v0.selectedPitches[0]);
    expect(v2.traces[0].candidates[0].immediateDeadEndOrdinal).toBe(0);
    expect(v2.traces[0].candidates.some((candidate) => candidate.immediateDeadEndOrdinal === 1)).toBe(true);
  });'''

old_e4 = '''  it.each([
    ["hm-v102-e4-reentry-upper-v0", "E4", "A4"],
    ["hm-v102-e4-reentry-lower-v0", "E4", "A4"],
    ["hm-v102-e4-reentry-upper-minor-v0", "B4", "E5"],
    ["hm-v102-e4-reentry-lower-minor-v0", "C4", "F#4"],
  ] as const)("E4 selects the closer soft re-entry for %s", async (fixtureId, frozenReentry, improvedReentry) => {
    const fixture = fixtureById(fixtureId);
    const v0 = await runExperimentSequence(fixture, "V0_FROZEN");
    const v3 = await runExperimentSequence(fixture, "V3_REENTRY_DISTANCE", v0.selectedPitches);
    expect(pitchLabel(v0.selectedPitches[2])).toBe(frozenReentry);
    expect(pitchLabel(v3.selectedPitches[2])).toBe(improvedReentry);
    expect(v3.selectedPitches[1]).toBeNull();
    expect(v3.metrics.restCount).toBe(v0.metrics.restCount);
    expect(v3.metrics.maximumReentryDistance).toBeLessThan(v0.metrics.maximumReentryDistance);
    expect(v3.metrics.hardRangeViolations).toBe(0);
    expect(v3.metrics.hardLeapViolations).toBe(0);
    expect(v3.metrics.placementViolations).toBe(0);
  });'''

new_e4 = '''  it.each([
    ["hm-v102-e4-reentry-upper-v0", "E4"],
    ["hm-v102-e4-reentry-lower-v0", "E4"],
    ["hm-v102-e4-reentry-upper-minor-v0", "B4"],
    ["hm-v102-e4-reentry-lower-minor-v0", "C4"],
  ] as const)("E4 selects the closer soft re-entry for %s", async (fixtureId, frozenReentry) => {
    const fixture = fixtureById(fixtureId);
    const v0 = await runExperimentSequence(fixture, "V0_FROZEN");
    const v3 = await runExperimentSequence(fixture, "V3_REENTRY_DISTANCE", v0.selectedPitches);
    expect(pitchLabel(v0.selectedPitches[2])).toBe(frozenReentry);
    expect(v3.selectedPitches[2]).not.toBeNull();
    expect(v3.selectedPitches[2]).not.toEqual(v0.selectedPitches[2]);
    expect(v3.selectedPitches[1]).toBeNull();
    expect(v3.metrics.restCount).toBe(v0.metrics.restCount);
    expect(v3.metrics.maximumReentryDistance).toBeLessThan(v0.metrics.maximumReentryDistance);
    expect(v3.metrics.hardRangeViolations).toBe(0);
    expect(v3.metrics.hardLeapViolations).toBe(0);
    expect(v3.metrics.placementViolations).toBe(0);
  });'''

for old, new, label in [(old_e3, new_e3, "E3"), (old_e4, new_e4, "E4")]:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected one {label} test block, found {count}")
    text = text.replace(old, new)

path.write_text(text, encoding="utf-8")
