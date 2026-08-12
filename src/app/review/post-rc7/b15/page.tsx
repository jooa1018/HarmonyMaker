import { generateBaseline, longestRepeatedRelation } from "@/review/post-rc7/arranger";
import { RIGHTS_SAFE_FIXTURE_MANIFEST, fixtureById } from "@/review/post-rc7/fixtures";
import { measureArrangement } from "@/review/post-rc7/metrics";
import type { ResearchBaselineId } from "@/review/post-rc7/types";
import { B15ReviewClient, type ReviewCaseView } from "./ReviewClient";

const BASELINES: readonly ResearchBaselineId[] = ["B0", "B1", "B1.5-MATCHED", "B1.5-E2E"];

export default async function B15ReviewPage({ searchParams }: { readonly searchParams: Promise<{ readonly fixture?: string }> }) {
  const requested = (await searchParams).fixture;
  const selectedFixtureId = RIGHTS_SAFE_FIXTURE_MANIFEST.some((fixture) => fixture.id === requested)
    ? requested!
    : RIGHTS_SAFE_FIXTURE_MANIFEST[0].id;
  const fixture = fixtureById(selectedFixtureId);
  const cases: ReviewCaseView[] = await Promise.all(BASELINES.map(async (baselineId) => {
    const result = await generateBaseline(fixture, baselineId);
    const metrics = measureArrangement(result.arrangement, {
      hard: fixture.performer.hardRange,
      comfortable: fixture.performer.comfortableRange,
      preferred: fixture.performer.preferredTessitura,
      preferredLeapSemitones: fixture.preferredLeapSemitones,
      hardLeapSemitones: fixture.hardLeapSemitones,
    });
    return {
      baselineId,
      arrangement: result.arrangement,
      decisionTrace: result.decisionTrace,
      scheduleDigest: result.scheduleDigest,
      arrangementDigest: result.arrangementDigest,
      metrics,
      repeatedRelation: longestRepeatedRelation(result.decisionTrace),
    };
  }));

  return <B15ReviewClient
    fixture={{
      id: fixture.id,
      title: fixture.title,
      placement: fixture.placement,
      rightsNote: fixture.rightsNote,
      acceptanceEligibility: fixture.acceptanceEligibility,
      tags: fixture.tags,
    }}
    fixtureManifest={RIGHTS_SAFE_FIXTURE_MANIFEST}
    cases={cases}
  />;
}
