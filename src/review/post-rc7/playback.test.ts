import { describe, expect, it } from "vitest";
import { generateBaseline } from "./arranger";
import { fixtureById } from "./fixtures";
import { createPlaybackArtifact } from "./playback";

describe("post-rc.7 playback projections", () => {
  it("provides Lead-only, Harmony-only, and combined artifacts without regenerating notes", async () => {
    const result = await generateBaseline(fixtureById("hm-original-held-no-common-upper-v0"), "B1.5-E2E");
    const lead = createPlaybackArtifact(result.arrangement, "LEAD_ONLY");
    const harmony = createPlaybackArtifact(result.arrangement, "HARMONY_ONLY");
    const full = createPlaybackArtifact(result.arrangement, "LEAD_AND_HARMONY");
    expect(lead.sourceEventIds).toEqual(result.arrangement.lead.map((event) => event.id));
    expect(harmony.sourceEventIds).toEqual(result.arrangement.harmony.map((event) => event.id));
    expect(full.sourceEventIds).toEqual([...lead.sourceEventIds, ...harmony.sourceEventIds]);
    expect(lead.abc).toContain("%%score (lead)");
    expect(harmony.abc).toContain("%%score (harmony)");
    expect(full.abc).toContain("%%score (lead harmony)");
  });

  it("exposes all renderer tiers while keeping HIGH an unevaluated infrastructure slot", async () => {
    const result = await generateBaseline(fixtureById("hm-original-major-stepwise-v0"), "B1.5-MATCHED");
    expect(createPlaybackArtifact(result.arrangement, "LEAD_AND_HARMONY", "POOR").abc).toContain("program 80");
    expect(createPlaybackArtifact(result.arrangement, "LEAD_AND_HARMONY", "COMPETENT_PLAIN").abc).toContain("program 53");
    expect(createPlaybackArtifact(result.arrangement, "LEAD_AND_HARMONY", "HIGH").rendererTier).toBe("HIGH");
  });
});
