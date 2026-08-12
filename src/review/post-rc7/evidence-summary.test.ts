import { describe, expect, it } from "vitest";
import { addFractions, fraction, type Fraction } from "../../domain/fraction";
import { generateBaseline } from "./arranger";
import { RIGHTS_SAFE_FIXTURES } from "./fixtures";
import { measureArrangement } from "./metrics";
import { createPlaybackArtifact } from "./playback";
import type { ResearchBaselineId } from "./types";

const add = (left: Fraction, right: Fraction): Fraction => addFractions(left, right);

describe("post-rc.7 required evidence summary", () => {
  it("aggregates actual events, runs, relations, and hard diagnostics", async () => {
    const summary: Record<string, unknown> = {};
    for (const baselineId of ["B0", "B1", "B1.5-MATCHED", "B1.5-E2E"] as readonly ResearchBaselineId[]) {
      let generatedEventCount = 0;
      let independentRunCount = 0;
      let independentRunDurationQ = fraction(0);
      let leadSoundingDurationQ = fraction(0);
      let participationDurationQ = fraction(0);
      let unisonDurationQ = fraction(0);
      let divergenceDurationQ = fraction(0);
      let hardRangeFailures = 0;
      let hardLeapFailures = 0;
      let playbackArtifactCount = 0;
      const relationHistogram = new Map<string, Fraction>();
      for (const fixture of RIGHTS_SAFE_FIXTURES) {
        const result = await generateBaseline(fixture, baselineId);
        const metrics = measureArrangement(result.arrangement, {
          hard: fixture.performer.hardRange,
          comfortable: fixture.performer.comfortableRange,
          preferred: fixture.performer.preferredTessitura,
          preferredLeapSemitones: fixture.preferredLeapSemitones,
          hardLeapSemitones: fixture.hardLeapSemitones,
        });
        generatedEventCount += result.arrangement.harmony.length;
        independentRunCount += metrics.independentRuns.length;
        independentRunDurationQ = add(independentRunDurationQ, metrics.independentRuns.reduce((sum, run) => add(sum, run.durationQ), fraction(0)));
        leadSoundingDurationQ = add(leadSoundingDurationQ, metrics.leadSoundingDurationQ);
        participationDurationQ = add(participationDurationQ, metrics.harmonyParticipation.numerator);
        unisonDurationQ = add(unisonDurationQ, metrics.actualUnison.numerator);
        divergenceDurationQ = add(divergenceDurationQ, metrics.harmonicDivergence.numerator);
        hardRangeFailures += metrics.diagnostics.hardRangeFailures;
        hardLeapFailures += metrics.diagnostics.hardLeapFailures;
        for (const bucket of metrics.relationDurations) relationHistogram.set(bucket.relation, add(relationHistogram.get(bucket.relation) ?? fraction(0), bucket.durationQ));
        playbackArtifactCount += ["LEAD_ONLY", "HARMONY_ONLY", "LEAD_AND_HARMONY"].map((mix) => createPlaybackArtifact(result.arrangement, mix as "LEAD_ONLY" | "HARMONY_ONLY" | "LEAD_AND_HARMONY")).filter((artifact) => artifact.abc.length > 0).length;
      }
      summary[baselineId] = {
        generatedEventCount,
        independentRunCount,
        independentRunDurationQ,
        leadSoundingDurationQ,
        participationDurationQ,
        unisonDurationQ,
        divergenceDurationQ,
        relationHistogram: Object.fromEntries([...relationHistogram.entries()].sort(([left], [right]) => left.localeCompare(right))),
        hardRangeFailures,
        hardLeapFailures,
        playbackArtifactCount,
      };
    }
    expect(summary["B1.5-MATCHED"]).toMatchObject({ hardRangeFailures: 0, hardLeapFailures: 0, playbackArtifactCount: 39 });
    expect(summary["B1.5-E2E"]).toMatchObject({ hardRangeFailures: 0, hardLeapFailures: 0, playbackArtifactCount: 39 });
    expect(summary.B0).toMatchObject({ generatedEventCount: 0 });
    console.info(`POST_RC7_EVIDENCE_SUMMARY=${JSON.stringify(summary)}`);
  });
});
