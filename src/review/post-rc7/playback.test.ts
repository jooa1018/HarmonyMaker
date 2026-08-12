import { describe, expect, it } from "vitest";
import { parseChord } from "../../domain/chord/parser";
import { fraction } from "../../domain/fraction";
import type { SpelledPitch } from "../../domain/pitch";
import { generateBaseline } from "./arranger";
import { fixtureById, RIGHTS_SAFE_FIXTURES } from "./fixtures";
import { createBandPlaybackProjection, createPlaybackArtifact, sourceChordBandVoicing } from "./playback";
import type { ResearchArrangement, ResearchChordSpan, ResearchNoteEvent } from "./types";

const pitch = (step: SpelledPitch["step"], octave = 4): SpelledPitch => ({ step, alter: 0, octave });
const pitchLabel = (value: SpelledPitch): string => `${value.step}${value.alter < 0 ? "b".repeat(-value.alter) : "#".repeat(value.alter)}${value.octave}`;
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
    expect(full.sourceChordEventIds).toEqual([]);
    expect(lead.abc).toContain("%%score (lead)");
    expect(harmony.abc).toContain("%%score (harmony)");
    expect(full.abc).toContain("%%score (lead harmony)");
  });

  it("adds an exact deterministic C/F Source-chord band without changing Lead or H1", async () => {
    const fixture = fixtureById("hm-original-major-stepwise-v0");
    const result = await generateBaseline(fixture, "B1.5-E2E");
    const artifact = createPlaybackArtifact(result.arrangement, "BAND_LEAD_AND_HARMONY", "COMPETENT_PLAIN", fixture.chords);
    expect(artifact.playbackProjection.lead.map((item) => item.sourceEventIds).flat()).toEqual(result.arrangement.lead.map((item) => item.id));
    expect(artifact.playbackProjection.harmony.map((item) => item.sourceEventIds).flat()).toEqual(result.arrangement.harmony.map((item) => item.id));
    expect(artifact.playbackProjection.band.map((item) => item.pitches.map(pitchLabel))).toEqual([
      ["C2", "G2", "C3", "E3"],
      ["F2", "C3", "F3", "A3"],
    ]);
    expect(artifact.playbackProjection.band.map((item) => item.durationQ)).toEqual([fraction(2), fraction(2)]);
    expect(artifact.sourceChordEventIds).toEqual(fixture.chords.map((chord) => chord.id));
    expect(artifact.abc).toContain("%%score (lead harmony) band");
    expect(artifact.abc).toContain("[V:band] %%MIDI program 0");
    expect(artifact.abc).toContain("[V:lead] %%MIDI program 53");
  });

  it("uses the Source slash bass and preserves sus omissions and explicit extensions", () => {
    const parsed = ["C/E", "Csus2", "Cadd9"].map((symbol) => {
      const result = parseChord(symbol);
      if (result.status !== "ok") throw new Error(`test chord failed: ${symbol}`);
      return result.chord;
    });
    expect(parsed.map((chord) => sourceChordBandVoicing(chord).map(pitchLabel))).toEqual([
      ["E2", "G2", "C3", "E3"],
      ["C2", "G2", "C3", "D3"],
      ["C2", "G2", "C3", "E3", "D4"],
    ]);
  });

  it("coalesces contiguous identical Source voicings while retaining every chord event ID", () => {
    const parsed = parseChord("C");
    if (parsed.status !== "ok") throw new Error("test chord failed");
    const chords: readonly ResearchChordSpan[] = [
      { id: "chord-a", onsetQ: fraction(0), durationQ: fraction(1), sourceText: "C", chord: parsed.chord },
      { id: "chord-b", onsetQ: fraction(1), durationQ: fraction(1), sourceText: "C", chord: parsed.chord },
    ];
    expect(createBandPlaybackProjection(chords)).toEqual([{
      onsetQ: fraction(0),
      durationQ: fraction(2),
      sourceChordSymbol: "C",
      pitches: sourceChordBandVoicing(parsed.chord),
      sourceChordEventIds: ["chord-a", "chord-b"],
    }]);
  });

  it("is deterministic across 101 Source-band projections for every rights-safe fixture", () => {
    for (const fixture of RIGHTS_SAFE_FIXTURES) {
      const projections = new Set<string>();
      for (let run = 0; run < 101; run += 1) projections.add(JSON.stringify(createBandPlaybackProjection(fixture.chords)));
      expect(projections.size, fixture.id).toBe(1);
    }
  });

  it("fails honestly when a band mix lacks Source chord spans", async () => {
    const result = await generateBaseline(fixtureById("hm-original-major-stepwise-v0"), "B1.5-E2E");
    expect(() => createPlaybackArtifact(result.arrangement, "BAND_ONLY")).toThrow("BAND_CONTEXT_REQUIRES_SOURCE_CHORDS");
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
