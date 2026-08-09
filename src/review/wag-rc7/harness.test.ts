import { describe, expect, it } from "vitest";
import { createRc7ReviewArtifactBundle } from "./artifacts";
import { RC7_PRESET_ORDER } from "./constants";
import { runRc7ReferenceCase, runRc7ReferencePack } from "./harness";
import { RC7_REFERENCE_CASES } from "./reference-cases";

describe("rc.7 isolated review harness outputs", () => {
  it("reaches actual generated events and playback for every A–O reference case", async () => {
    const outputs = await runRc7ReferencePack();
    expect(outputs).toHaveLength(17);
    expect(new Set(outputs.map((output) => output.caseId)).size).toBe(17);
    for (const output of outputs) {
      expect(output.authorityBoundary).toEqual({
        production: false,
        isolated: true,
        persistsHarmonyProject: false,
        mutatesHarmonyProject: false,
        reviewOnly: true,
      });
      expect(output.generated.candidate.id).toBe(`cand:${output.preset}:${output.generated.candidate.contentDigest}`);
      expect(output.generated.candidate.canonicalPathKey).toBe(output.opportunityKey);
      expect(output.generated.candidate.diagnostics).toEqual([]);
      expect(Object.values(output.generated.candidate.generatedEventsByTrack).flat().every((event) => (
        event.id.startsWith(`gen:${output.generated.candidate.contentDigest}:`)
      ))).toBe(true);
      expect(output.rangeChecks.every((check) => check.insideHardRange)).toBe(true);
      expect(output.verticalLegalityChecks.every((check) => check.legal)).toBe(true);
      expect(output.playback.fullArrangementAbc).toContain("%%score (lead h1 h2)");
      expect(output.playback.fullArrangementAbc).toContain("[V:lead]");
      expect(output.playback.leadOnlyAbc).toContain("%%score lead");
      expect(output.intent.serializedAuthoritativePlan).not.toContain("opportunities");
      expect(output.intent.serializedAuthoritativePlan).not.toContain("grammarTrace");
    }

    const byId = new Map(outputs.map((output) => [output.caseId, output]));
    expect(new Set(outputs.map((output) => output.winner.textureId))).toEqual(new Set([
      "UNISON",
      "UNISON_TO_SPLIT",
      "TWO_PART_PARALLEL",
      "ACCENT_BLOCK",
      "SUSTAINED_PAD",
      "SUSPENSION_RELEASE",
    ]));
    expect(byId.get("A-SPARSE-BASE-VERSE")?.winner.activeTrackOrdinals).toHaveLength(0);
    expect(byId.get("A-SPARSE-BASE-VERSE")?.activationCues).toHaveLength(0);
    expect(Object.values(byId.get("A-SPARSE-BASE-VERSE")?.generated.candidate.generatedEventsByTrack ?? {})
      .flat()).toHaveLength(0);
    expect(byId.get("B-CUE-ACTIVE-UNISON")?.winner.textureId).toBe("UNISON");
    expect(byId.get("B-CUE-ACTIVE-UNISON")?.winner.activeTrackOrdinals).toHaveLength(1);
    expect(Object.values(byId.get("B-CUE-ACTIVE-UNISON")?.generated.candidate.generatedEventsByTrack ?? {})
      .flat().length).toBeGreaterThan(0);
    expect(byId.get("C-STANDARD-CHORUS-BOUNDED-TPP")?.activity.plan.phraseActivityPlans[0].attackEvents).toHaveLength(4);
    expect(byId.get("C-STANDARD-CHORUS-BOUNDED-TPP")?.winner.semanticPayload.sourceAtomCanonicalOrdinals).not.toHaveLength(8);
    const accent = byId.get("D-BUSY-CHORUS-ACCENT")!;
    expect(accent.winner.textureId).toBe("ACCENT_BLOCK");
    expect(accent.activationCues.every((cue) => cue.semantic === "lyric-emphasis-confirmed")).toBe(true);
    expect(accent.winner.semanticPayload.attackOrdinals).toEqual([1, 5]);
    expect(new Set(accent.activity.plan.phraseActivityPlans[0].attackEvents.map((event) => (
      JSON.stringify(event.position)
    ))).size).toBe(2);
    expect(byId.get("E-LATE-LONG-U2S")?.winner.textureId).toBe("UNISON_TO_SPLIT");
    expect(byId.get("F-SUSTAINED-PAD")?.winner.textureId).toBe("SUSTAINED_PAD");
    expect(byId.get("O-SIMPLE-BOUNDED-TPP")?.activity.plan.phraseActivityPlans[0].attackEvents).toHaveLength(2);
    expect(byId.get("H-STANDARD-THIRD-POSITIVE")?.winner.activeTrackOrdinals).toHaveLength(2);
    expect(byId.get("I-STANDARD-THIRD-NEGATIVE")?.winner.activeTrackOrdinals).toHaveLength(1);
    expect(byId.get("I-STANDARD-THIRD-NEGATIVE")?.intent.plan.phraseIntents[0].trackRoles).toHaveLength(1);
    expect(byId.get("J-NO-CUE-THIRD-NEGATIVE")?.winner.activeTrackOrdinals).toHaveLength(1);
    expect(byId.get("K-FULL-SELECTIVE-EXPANSION")?.winner.activeTrackOrdinals).toHaveLength(2);
    expect(byId.get("L-FINAL-VERSE-NEGATIVE")?.winner.activeTrackOrdinals).toHaveLength(0);
    expect(byId.get("L-FINAL-VERSE-NEGATIVE")?.activationCues).toHaveLength(0);
    expect(byId.get("L-FINAL-VERSE-NEGATIVE")?.phraseFeatures.lateChordChange).toBe(true);
    expect(byId.get("L-FINAL-VERSE-NEGATIVE")?.phraseFeatures.lateLongNote).toBe(false);
    expect(byId.get("M0-BASE-VERSE-REAL-CUE")?.winner.activeTrackOrdinals.length).toBeGreaterThan(0);
    expect(byId.get("M-FINAL-VERSE-REAL-CUE")?.winner.activeTrackOrdinals.length).toBeGreaterThan(0);
    expect(byId.get("N-44-NORMALIZED")?.winner.textureId).toBe(byId.get("N-68-NORMALIZED")?.winner.textureId);
    const suspension = byId.get("G-SUSPENSION-RELEASE");
    expect(suspension?.anchor.plan.phraseAnchorPlans[0].nctPlans.map((nct) => nct.kind)).toEqual(["suspension"]);
    expect(suspension?.nctClassification.some((entry) => entry.classification === "suspension" && entry.legal)).toBe(true);
  }, 60_000);

  it("separates authoritative semantics, diagnostic trace, and playback artifacts", async () => {
    const outputs = await runRc7ReferencePack();
    const files = createRc7ReviewArtifactBundle(outputs);
    expect(files[0].path).toBe("review-output/manifest.json");
    expect(new Set(files.map((file) => file.layer))).toEqual(new Set([
      "manifest",
      "authoritative-semantics",
      "diagnostic-trace",
      "playback",
    ]));
    expect(files.some((file) => file.path.endsWith("/generated.json"))).toBe(true);
    expect(files.some((file) => file.path.endsWith("/playback.abc"))).toBe(true);
    expect(files.find((file) => file.path.endsWith("/trace.json"))?.content).toContain('"authoritative": false');
  }, 60_000);

  it("generates the complete 17-case by 3-preset browser review matrix", async () => {
    const outputs = await Promise.all(RC7_REFERENCE_CASES.flatMap((definition) => (
      RC7_PRESET_ORDER.map((preset) => runRc7ReferenceCase(definition, { presetOverride: preset }))
    )));
    expect(outputs).toHaveLength(51);
    expect(new Set(outputs.map((output) => `${output.caseId}:${output.preset}`)).size).toBe(51);
    expect(outputs.every((output) => output.generated.candidate.candidateStatus === "complete")).toBe(true);

    const simple = outputs.filter((output) => output.preset === "simple");
    expect(simple.every((output) => output.winner.activeTrackOrdinals.length <= 1)).toBe(true);
    expect(simple.some((output) => output.winner.textureId === "TWO_PART_PARALLEL")).toBe(true);
    expect(simple.flatMap((output) => output.nctClassification)
      .some((entry) => entry.classification === "suspension")).toBe(false);

    const standard = outputs.filter((output) => output.preset === "standard");
    expect(standard.some((output) => output.winner.activeTrackOrdinals.length === 2)).toBe(true);

    const full = outputs.filter((output) => output.preset === "full");
    expect(full.some((output) => output.winner.activeTrackOrdinals.length === 2)).toBe(true);
    expect(full.some((output) => output.winner.activeTrackOrdinals.length === 0)).toBe(true);
  }, 60_000);
});
