import { describe, expect, it } from "vitest";

import { COMMON_TIME } from "../meter";
import { fraction } from "../fraction";
import { type SemanticDigest } from "../digest/canonical";
import { computeOmrMetricReport, createOmrCorpusManifest, createOmrGroundTruthPage, createOmrSealedRunReport, freezeOmrThresholdArtifact, validateOmrCorpusManifest, validateOmrGroundTruthPage } from "./evaluation";

const groundTruthDigest = "0".repeat(64) as SemanticDigest;

function page(pageId: string, correct: number, total: number) {
  const exact = Object.fromEntries(["pitchExactRate", "durationExactRate", "accidentalExactRate", "restExactRate", "tieExactRate", "keySignatureExactRate", "timeSignatureExactRate", "chordSymbolExactRate", "measureExactMatchRate"].map((name) => [name, { correct, total }])) as never;
  return { pageId, exact, boolean: { parseableMusicXmlRate: true, measureDurationValidRate: true, voiceTimelineValidRate: true, runtimeValidatorReadyRate: true, harmonizationReadyRate: correct === total }, correctionTimeMs: 1000, corrections: total - correct, noteCount: total, retake: false, abandoned: false };
}

describe("honest OMR evaluation harness", () => {
  it("canonicalizes and integrity-checks versioned page ground truth", async () => {
    const truth = await createOmrGroundTruthPage({ pageId: "truth:1", measures: [{
      measureOrdinal: 0, time: COMMON_TIME, key: { tonic: { step: "C", alter: 0 }, mode: "major" },
      events: [
        { kind: "rest", onset: fraction(2), duration: fraction(2) },
        { kind: "note", onset: fraction(0), duration: fraction(2), pitch: { step: "C", alter: 0, octave: 4 }, tieStart: false, tieStop: false },
      ],
      chordSymbols: [{ onset: fraction(0), canonicalSymbol: "C" }],
    }] });
    expect(truth.version).toBe("hm-omr-ground-truth-v1");
    expect(truth.measures[0].events.map((event) => event.onset.n)).toEqual([0, 2]);
    expect(await validateOmrGroundTruthPage(truth)).toBe(true);
    expect(await validateOmrGroundTruthPage({ ...truth, pageId: "tampered" })).toBe(false);
  });

  it("computes deterministic micro/macro, structural, and product metrics", () => {
    const report = computeOmrMetricReport([page("p1", 8, 10), page("p2", 1, 2)]);
    expect(report.micro.pitchExactRate).toBe(7500);
    expect(report.macro.pitchExactRate).toBe(6500);
    expect(report.micro.parseableMusicXmlRate).toBe(10_000);
    expect(report.micro.harmonizationReadyRate).toBe(0);
    expect(report.medianCorrectionTime).toBe(1000);
  });

  it("detects rights and same-song/capture split leakage", async () => {
    const manifest = await createOmrCorpusManifest([
      { pageId: "dev:1", songId: "song:1", captureId: "capture:1", split: "dev", sourceKind: "digital-pdf", meter: "4/4", keyMode: "major", features: ["ties"], groundTruthDigest, rights: { basis: "self-authored", allowedUses: ["evaluation"], reference: "fixture" } },
      { pageId: "sealed:1", songId: "song:1", captureId: "capture:2", split: "sealed", sourceKind: "camera-photo", meter: "6/8", keyMode: "minor", features: ["accidentals"], groundTruthDigest, rights: { basis: "self-authored", allowedUses: ["evaluation"], reference: "fixture" } },
    ]).catch((error) => error as RangeError);
    expect(manifest).toBeInstanceOf(RangeError);
    const valid = await createOmrCorpusManifest([{ pageId: "dev:1", songId: "song:1", captureId: "capture:1", split: "dev", sourceKind: "digital-pdf", meter: "4/4", keyMode: "major", features: ["ties"], groundTruthDigest, rights: { basis: "self-authored", allowedUses: ["evaluation"], reference: "fixture" } }]);
    expect(await validateOmrCorpusManifest(valid)).toEqual(expect.arrayContaining(["EXTERNAL_OMR_CALIBRATION_CORPUS_REQUIRED:dev", "EXTERNAL_OMR_CALIBRATION_CORPUS_REQUIRED:sealed"]));
  });

  it("refuses to freeze thresholds from mock/reference fixtures", async () => {
    await expect(freezeOmrThresholdArtifact({ providerId: "hm-reference", manifest: await createOmrCorpusManifest([]), thresholds: { pitchExactRate: 9000 }, frozenAt: "2026-01-01T00:00:00.000Z", evidenceKind: "reference-fixture" })).rejects.toThrow("EXTERNAL_OMR_CALIBRATION_CORPUS_REQUIRED");
  });

  it("refuses to seal reference results as external accuracy evidence", async () => {
    const manifest = await createOmrCorpusManifest([]);
    await expect(createOmrSealedRunReport({
      providerId: "hm-reference", sourceCommit: "a".repeat(40), manifest,
      thresholdArtifact: { version: "hm-omr-threshold-artifact-v1", providerId: "hm-reference", devManifestDigest: manifest.manifestDigest, thresholds: {}, frozenAt: "2026-01-01T00:00:00.000Z", artifactDigest: "0".repeat(64) as never },
      pages: [], executedAt: "2026-01-02T00:00:00.000Z", evidenceKind: "reference-fixture",
    })).rejects.toThrow("EXTERNAL_OMR_CALIBRATION_CORPUS_REQUIRED");
  });

  it("exercises immutable freeze/sealed formats with synthetic schema data without claiming campaign accuracy", async () => {
    const entries = Array.from({ length: 60 }, (_, index) => {
      const split = index < 36 ? "dev" as const : "sealed" as const;
      const ordinal = split === "dev" ? index : index - 36;
      return {
        pageId: `${split}:page:${ordinal}`, songId: `${split}:song:${ordinal}`, captureId: `${split}:capture:${ordinal}`, split,
        sourceKind: (["digital-pdf", "scanned-pdf", "camera-photo"] as const)[ordinal % 3],
        meter: (["4/4", "6/8"] as const)[ordinal % 2], keyMode: (["major", "minor"] as const)[ordinal % 2],
        features: [(["accidentals", "dotted-notes", "ties"] as const)[ordinal % 3]], groundTruthDigest,
        rights: { basis: "self-authored", allowedUses: ["evaluation"], reference: `synthetic-schema:${split}:${ordinal}` },
      };
    });
    const manifest = await createOmrCorpusManifest(entries);
    expect(await validateOmrCorpusManifest(manifest)).toEqual([]);
    const thresholdArtifact = await freezeOmrThresholdArtifact({ providerId: "synthetic-schema-provider", manifest, thresholds: { pitchExactRate: 9000 }, frozenAt: "2026-01-01T00:00:00.000Z", evidenceKind: "real-provider" });
    const sealedPages = entries.filter((entry) => entry.split === "sealed").map((entry) => page(entry.pageId, 10, 10));
    const input = { providerId: "synthetic-schema-provider", sourceCommit: "a".repeat(40), manifest, thresholdArtifact, pages: sealedPages, executedAt: "2026-01-02T00:00:00.000Z", evidenceKind: "real-provider" as const };
    const first = await createOmrSealedRunReport(input);
    const second = await createOmrSealedRunReport(input);
    expect(second).toEqual(first);
    expect(first).toMatchObject({ version: "hm-omr-sealed-report-v1", metrics: { pageCount: 24 } });
  });
});
