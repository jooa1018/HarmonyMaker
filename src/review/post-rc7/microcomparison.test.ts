import { describe, expect, it } from "vitest";
import { generateBaseline } from "./arranger";
import { fixtureById } from "./fixtures";
import {
  createMicroPlaybackArtifact,
  MICROCOMPARISON_REFERENCES,
  microRankingComplete,
  pitchName,
} from "./microcomparison";

const byId = (id: "A" | "B" | "C") => MICROCOMPARISON_REFERENCES.find((reference) => reference.id === id)!;
const names = (id: "A" | "B" | "C") => byId(id).harmony.map((event) => pitchName(event.pitch));

describe("post-rc.7 band-backed static microcomparison", () => {
  it("keeps the lead identical across A/B/C", () => {
    expect(byId("B").lead).toEqual(byId("A").lead);
    expect(byId("C").lead).toEqual(byId("A").lead);
    expect(byId("A").lead.map((event) => pitchName(event.pitch))).toEqual(["C4", "D4", "E4", "G4"]);
  });

  it("keeps the exact sustained band accompaniment identical across A/B/C", () => {
    expect(byId("B").band).toEqual(byId("A").band);
    expect(byId("C").band).toEqual(byId("A").band);
    expect(byId("A").band.map((event) => event.pitches.map(pitchName))).toEqual([
      ["C2", "G2", "C3", "E3"],
      ["F2", "C3", "F3", "A3"],
    ]);
  });

  it("changes only H1 between the three references", () => {
    for (const reference of MICROCOMPARISON_REFERENCES) {
      expect(reference.lead).toBe(byId("A").lead);
      expect(reference.band).toBe(byId("A").band);
      expect(reference.chords).toBe(byId("A").chords);
      expect(reference.provenance).toBe("HUMAN_SPECIFIED_MICROREFERENCE");
      expect(reference.harmony.every((event) => event.provenance === "HUMAN_SPECIFIED_MICROREFERENCE")).toBe(true);
    }
  });

  it("defines exact reference A", () => expect(names("A")).toEqual(["E4", "E4", "F4", "C5"]));
  it("defines exact reference B", () => expect(names("B")).toEqual(["E4", "E4", "G4", "C5"]));
  it("defines exact reference C", () => expect(names("C")).toEqual(["E4", "F4", "G4", "C5"]));

  it("classifies every A event as a Source chord tone", () => {
    expect(byId("A").analysis.map((row) => row.chordTone)).toEqual([true, true, true, true]);
    expect(byId("A").analysis.map((row) => row.genericInterval)).toEqual(["3rd", "2nd", "2nd", "4th"]);
    expect(byId("A").analysis.map((row) => row.chromaticInterval)).toEqual(["major 3rd", "major 2nd", "minor 2nd", "perfect 4th"]);
  });

  it("classifies B's G4 over F as the intended Source-chord NCT", () => {
    expect(byId("B").analysis.map((row) => [row.harmonyPitch, row.sourceChord, row.chordTone])).toEqual([
      ["E4", "C", true], ["E4", "C", true], ["G4", "F", false], ["C5", "F", true],
    ]);
  });

  it("classifies C's F4 over C and G4 over F as the intended Source-chord NCTs", () => {
    expect(byId("C").analysis.map((row) => [row.harmonyPitch, row.sourceChord, row.chordTone])).toEqual([
      ["E4", "C", true], ["F4", "C", false], ["G4", "F", false], ["C5", "F", true],
    ]);
  });

  it("projects identical accompaniment and distinct static H1 into playback", () => {
    const artifacts = MICROCOMPARISON_REFERENCES.map((reference) => createMicroPlaybackArtifact(reference, "BAND_LEAD_AND_H1"));
    expect(artifacts[1].playbackProjection.band).toEqual(artifacts[0].playbackProjection.band);
    expect(artifacts[2].playbackProjection.band).toEqual(artifacts[0].playbackProjection.band);
    expect(artifacts[1].playbackProjection.lead).toEqual(artifacts[0].playbackProjection.lead);
    expect(artifacts[2].playbackProjection.lead).toEqual(artifacts[0].playbackProjection.lead);
    expect(artifacts.map((artifact) => artifact.playbackProjection.harmony.map((event) => pitchName(event.pitch))))
      .toEqual([names("A"), names("B"), names("C")]);
    expect(artifacts.every((artifact) => artifact.abc.includes("%%MIDI program 0"))).toBe(true);
    expect(artifacts.every((artifact) => artifact.abc.includes("%%MIDI program 53"))).toBe(true);
  });

  it("does not alter B1.5 arrangement digests", async () => {
    const fixture = fixtureById("hm-original-major-stepwise-v0");
    const before = await generateBaseline(fixture, "B1.5-E2E");
    for (const reference of MICROCOMPARISON_REFERENCES) createMicroPlaybackArtifact(reference, "BAND_LEAD_AND_H1");
    const after = await generateBaseline(fixture, "B1.5-E2E");
    expect(after.arrangementDigest).toBe(before.arrangementDigest);
    expect(after.scheduleDigest).toBe(before.scheduleDigest);
  });

  it("requires a complete, unique A/B/C ranking", () => {
    expect(microRankingComplete({ best: "A", second: "B", worst: "C" })).toBe(true);
    expect(microRankingComplete({ best: "A", second: "A", worst: "C" })).toBe(false);
    expect(microRankingComplete({ best: "A", second: "", worst: "C" })).toBe(false);
  });
});
