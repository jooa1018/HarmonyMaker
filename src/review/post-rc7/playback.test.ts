import { describe, expect, it } from "vitest";
import { fraction } from "../../domain/fraction";
import type { SpelledPitch } from "../../domain/pitch";
import { generateBaseline } from "./arranger";
import { fixtureById } from "./fixtures";
import { createPlaybackArtifact } from "./playback";
import type { ResearchArrangement, ResearchNoteEvent } from "./types";

const pitch = (step: SpelledPitch["step"], octave = 4): SpelledPitch => ({ step, alter: 0, octave });
const event = (id: string, onset: number, value: SpelledPitch, attack: boolean, lyricOnset = attack): ResearchNoteEvent => ({
  id,
  onsetQ: fraction(onset),
  durationQ: fraction(1),
  pitch: value,
  syllableId: "held-syllable",
  lyric: "ah",
  lyricOnset,
  attack,
  provenance: attack ? "LEAD_COUPLED" : "CANONICAL_CHORD_BOUNDARY",
});

describe("post-rc.7 playback projections", () => {
  it("provides Lead-only, Harmony-only, and combined artifacts without regenerating notes", async () => {
    const result = await generateBaseline(fixtureById("hm-original-held-no-common-upper-v0"), "B1.5-E2E");
    const lead = createPlaybackArtifact(result.arrangement, "LEAD_ONLY");
    const harmony = createPlaybackArtifact(result.arrangement, "HARMONY_ONLY");
    const full = createPlaybackArtifact(result.arrangement, "LEAD_AND_HARMONY");
    expect(lead.sourceEventIds).toEqual(result.arrangement.lead.map((item) => item.id));
    expect(harmony.sourceEventIds).toEqual(result.arrangement.harmony.map((item) => item.id));
    expect(full.sourceEventIds).toEqual([...lead.sourceEventIds, ...harmony.sourceEventIds]);
    expect(lead.abc).toContain("%%score (lead)");
    expect(harmony.abc).toContain("%%score (harmony)");
    expect(full.abc).toContain("%%score (lead harmony)");
  });

  it("coalesces same-pitch same-syllable contiguous non-attack continuation without mutating research events", () => {
    const harmony = [event("source-a", 0, pitch("E"), true), event("source-b", 1, pitch("E"), false)];
    const arrangement: ResearchArrangement = { fixtureId: "continuation", baselineId: "B1.5-E2E", lead: [], harmony };
    const artifact = createPlaybackArtifact(arrangement, "HARMONY_ONLY");
    expect(artifact.playbackProjection.harmony).toEqual([{
      onsetQ: fraction(0),
      durationQ: fraction(2),
      pitch: pitch("E"),
      syllableId: "held-syllable",
      attack: true,
      lyricOnset: true,
      sourceEventIds: ["source-a", "source-b"],
    }]);
    expect(artifact.sourceEventIds).toEqual(["source-a", "source-b"]);
    expect(arrangement.harmony).toEqual(harmony);
  });

  it("keeps a non-attack held-syllable pitch transition audible at the canonical boundary", () => {
    const arrangement: ResearchArrangement = {
      fixtureId: "adaptation",
      baselineId: "B1.5-E2E",
      lead: [],
      harmony: [event("source-a", 0, pitch("E"), true), event("source-b", 1, pitch("F"), false, false)],
    };
    const artifact = createPlaybackArtifact(arrangement, "HARMONY_ONLY");
    expect(artifact.playbackProjection.harmony).toHaveLength(2);
    expect(artifact.playbackProjection.harmony[1]).toMatchObject({
      pitch: pitch("F"),
      attack: false,
      lyricOnset: false,
      sourceEventIds: ["source-b"],
    });
    expect(artifact.abc).toContain("=E");
    expect(artifact.abc).toContain("=F");
  });

  it("exposes all renderer tiers while keeping HIGH an unevaluated infrastructure slot", async () => {
    const result = await generateBaseline(fixtureById("hm-original-major-stepwise-v0"), "B1.5-MATCHED");
    expect(createPlaybackArtifact(result.arrangement, "LEAD_AND_HARMONY", "POOR").abc).toContain("program 80");
    expect(createPlaybackArtifact(result.arrangement, "LEAD_AND_HARMONY", "COMPETENT_PLAIN").abc).toContain("program 53");
    expect(createPlaybackArtifact(result.arrangement, "LEAD_AND_HARMONY", "HIGH").rendererTier).toBe("HIGH");
  });
});
