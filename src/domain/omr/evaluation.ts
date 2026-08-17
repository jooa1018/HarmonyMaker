import { compareCanonicalValues, semanticDigest, type SemanticDigest } from "../digest/canonical";
import type { Fraction } from "../fraction";
import type { TimeSignature } from "../meter";
import type { KeySignature, SpelledPitch } from "../pitch";
import { basisPoints, type BasisPoints } from "../rates";
import { isCanonicalFraction, isCanonicalSpelledPitch, isSemanticDigest } from "../validation";
import { isTimeSignature } from "../meter";
import { isKeySignature } from "../pitch";
import type { InputSourceKind } from "./input";

export const OMR_CORPUS_MANIFEST_VERSION = "hm-omr-corpus-manifest-v1" as const;
export const OMR_GROUND_TRUTH_VERSION = "hm-omr-ground-truth-v1" as const;
export const OMR_THRESHOLD_ARTIFACT_VERSION = "hm-omr-threshold-artifact-v1" as const;
export const OMR_SEALED_REPORT_VERSION = "hm-omr-sealed-report-v1" as const;

export const OMR_GROUND_TRUTH_METRICS = Object.freeze([
  "pitchExactRate", "durationExactRate", "accidentalExactRate", "restExactRate", "tieExactRate",
  "keySignatureExactRate", "timeSignatureExactRate", "chordSymbolExactRate", "measureExactMatchRate",
] as const);
export const OMR_STRUCTURE_METRICS = Object.freeze([
  "parseableMusicXmlRate", "measureDurationValidRate", "voiceTimelineValidRate", "runtimeValidatorReadyRate",
] as const);
export const OMR_PRODUCT_METRICS = Object.freeze([
  "harmonizationReadyRate", "medianCorrectionTime", "correctionsPer100Notes", "retakeRate", "abandonmentRate",
] as const);

type ExactMetric = (typeof OMR_GROUND_TRUTH_METRICS)[number];
type BooleanMetric = (typeof OMR_STRUCTURE_METRICS)[number] | "harmonizationReadyRate";

export type OmrGroundTruthEvent =
  | { readonly kind: "note"; readonly onset: Fraction; readonly duration: Fraction; readonly pitch: SpelledPitch; readonly tieStart: boolean; readonly tieStop: boolean }
  | { readonly kind: "rest"; readonly onset: Fraction; readonly duration: Fraction };
export interface OmrGroundTruthMeasure {
  readonly measureOrdinal: number;
  readonly time: TimeSignature;
  readonly key: KeySignature;
  readonly events: readonly OmrGroundTruthEvent[];
  readonly chordSymbols: readonly { readonly onset: Fraction; readonly canonicalSymbol: string }[];
}
export interface OmrGroundTruthPage {
  readonly version: typeof OMR_GROUND_TRUTH_VERSION;
  readonly pageId: string;
  readonly measures: readonly OmrGroundTruthMeasure[];
  readonly groundTruthDigest: SemanticDigest;
}

function normalizeGroundTruth(input: { readonly pageId: string; readonly measures: readonly OmrGroundTruthMeasure[] }): Omit<OmrGroundTruthPage, "version" | "groundTruthDigest"> {
  if (!input.pageId || input.pageId !== input.pageId.normalize("NFC") || input.measures.length === 0) throw new RangeError("OMR_GROUND_TRUTH_INVALID");
  const measures = [...input.measures].sort((left, right) => left.measureOrdinal - right.measureOrdinal).map((measure, ordinal) => {
    if (measure.measureOrdinal !== ordinal || !isTimeSignature(measure.time) || !isKeySignature(measure.key)
      || measure.events.some((event) => !isCanonicalFraction(event.onset) || !isCanonicalFraction(event.duration) || event.onset.n < 0 || event.duration.n <= 0
        || (event.kind === "note" && (!isCanonicalSpelledPitch(event.pitch) || typeof event.tieStart !== "boolean" || typeof event.tieStop !== "boolean")))
      || measure.chordSymbols.some((chord) => !isCanonicalFraction(chord.onset) || chord.onset.n < 0 || !chord.canonicalSymbol || chord.canonicalSymbol !== chord.canonicalSymbol.normalize("NFC"))) {
      throw new RangeError("OMR_GROUND_TRUTH_INVALID");
    }
    return {
      ...measure,
      events: [...measure.events].sort(compareCanonicalValues),
      chordSymbols: [...measure.chordSymbols].sort(compareCanonicalValues),
    };
  });
  return { pageId: input.pageId, measures };
}

export async function createOmrGroundTruthPage(input: { readonly pageId: string; readonly measures: readonly OmrGroundTruthMeasure[] }): Promise<OmrGroundTruthPage> {
  const normalized = normalizeGroundTruth(input);
  return { version: OMR_GROUND_TRUTH_VERSION, ...normalized, groundTruthDigest: await semanticDigest({ projectionSchema: OMR_GROUND_TRUTH_VERSION, ...normalized }) };
}

export async function validateOmrGroundTruthPage(page: OmrGroundTruthPage): Promise<boolean> {
  try {
    const normalized = normalizeGroundTruth(page);
    return page.version === OMR_GROUND_TRUTH_VERSION
      && page.groundTruthDigest === await semanticDigest({ projectionSchema: OMR_GROUND_TRUTH_VERSION, ...normalized })
      && compareCanonicalValues(page.measures, normalized.measures) === 0;
  } catch { return false; }
}

export interface OmrEvaluationPageResult {
  readonly pageId: string;
  readonly exact: Readonly<Record<ExactMetric, { readonly correct: number; readonly total: number }>>;
  readonly boolean: Readonly<Record<BooleanMetric, boolean>>;
  readonly correctionTimeMs?: number;
  readonly corrections: number;
  readonly noteCount: number;
  readonly retake: boolean;
  readonly abandoned: boolean;
}

export interface OmrMetricReport {
  readonly pageCount: number;
  readonly micro: Readonly<Record<ExactMetric | BooleanMetric | "retakeRate" | "abandonmentRate", BasisPoints | null>>;
  readonly macro: Readonly<Record<ExactMetric, BasisPoints | null>>;
  readonly medianCorrectionTime: number | null;
  readonly correctionsPer100Notes: BasisPoints | null;
}

function rate(numerator: number, denominator: number): BasisPoints | null {
  if (denominator === 0) return null;
  return basisPoints(Math.floor((numerator * 10_000 + Math.floor(denominator / 2)) / denominator));
}

export function computeOmrMetricReport(pages: readonly OmrEvaluationPageResult[]): OmrMetricReport {
  if (new Set(pages.map((page) => page.pageId)).size !== pages.length) throw new RangeError("OMR_EVALUATION_DUPLICATE_PAGE");
  const micro = {} as Record<ExactMetric | BooleanMetric | "retakeRate" | "abandonmentRate", BasisPoints | null>;
  const macro = {} as Record<ExactMetric, BasisPoints | null>;
  for (const metric of OMR_GROUND_TRUTH_METRICS) {
    let correct = 0; let total = 0; const pageRates: number[] = [];
    for (const page of pages) {
      const value = page.exact[metric];
      if (!Number.isSafeInteger(value.correct) || !Number.isSafeInteger(value.total) || value.correct < 0 || value.total < 0 || value.correct > value.total) throw new RangeError("OMR_EVALUATION_COUNT_INVALID");
      correct += value.correct; total += value.total;
      const pageRate = rate(value.correct, value.total); if (pageRate !== null) pageRates.push(pageRate);
    }
    micro[metric] = rate(correct, total);
    macro[metric] = pageRates.length === 0 ? null : basisPoints(Math.floor((pageRates.reduce((sum, value) => sum + value, 0) + Math.floor(pageRates.length / 2)) / pageRates.length));
  }
  for (const metric of [...OMR_STRUCTURE_METRICS, "harmonizationReadyRate"] as const) micro[metric] = rate(pages.filter((page) => page.boolean[metric]).length, pages.length);
  micro.retakeRate = rate(pages.filter((page) => page.retake).length, pages.length);
  micro.abandonmentRate = rate(pages.filter((page) => page.abandoned).length, pages.length);
  const correctionTimes = pages.flatMap((page) => page.correctionTimeMs === undefined ? [] : [page.correctionTimeMs]).sort((a, b) => a - b);
  if (correctionTimes.some((value) => !Number.isSafeInteger(value) || value < 0)
    || pages.some((page) => !Number.isSafeInteger(page.corrections) || page.corrections < 0 || !Number.isSafeInteger(page.noteCount) || page.noteCount < 0)) throw new RangeError("OMR_EVALUATION_PRODUCT_METRIC_INVALID");
  const corrections = pages.reduce((sum, page) => sum + page.corrections, 0);
  const notes = pages.reduce((sum, page) => sum + page.noteCount, 0);
  return {
    pageCount: pages.length, micro, macro,
    medianCorrectionTime: correctionTimes.length === 0 ? null : correctionTimes.length % 2 === 1
      ? correctionTimes[Math.floor(correctionTimes.length / 2)]
      : Math.floor((correctionTimes[correctionTimes.length / 2 - 1] + correctionTimes[correctionTimes.length / 2]) / 2),
    correctionsPer100Notes: rate(corrections, notes),
  };
}

export interface OmrCorpusEntry {
  readonly pageId: string;
  readonly songId: string;
  readonly captureId: string;
  readonly split: "dev" | "sealed";
  readonly sourceKind: Extract<InputSourceKind, "digital-pdf" | "scanned-pdf" | "camera-photo">;
  readonly meter: "4/4" | "6/8" | "other";
  readonly keyMode: "major" | "minor";
  readonly features: readonly ("accidentals" | "dotted-notes" | "ties")[];
  readonly groundTruthDigest: SemanticDigest;
  readonly publicationFont?: string;
  readonly captureDevice?: string;
  readonly editingProgram?: string;
  readonly rights: { readonly basis: string; readonly allowedUses: readonly string[]; readonly reference: string };
}

export interface OmrCorpusManifest {
  readonly version: typeof OMR_CORPUS_MANIFEST_VERSION;
  readonly entries: readonly OmrCorpusEntry[];
  readonly manifestDigest: SemanticDigest;
}

async function corpusDigest(entries: readonly OmrCorpusEntry[]): Promise<SemanticDigest> {
  return semanticDigest({ projectionSchema: OMR_CORPUS_MANIFEST_VERSION, entries: [...entries].sort((a, b) => a.pageId.localeCompare(b.pageId)) });
}

export async function omrCorpusSplitDigest(manifest: OmrCorpusManifest, split: OmrCorpusEntry["split"]): Promise<SemanticDigest> {
  return corpusDigest(manifest.entries.filter((entry) => entry.split === split));
}

export async function createOmrCorpusManifest(entries: readonly OmrCorpusEntry[]): Promise<OmrCorpusManifest> {
  const manifest = { version: OMR_CORPUS_MANIFEST_VERSION, entries: [...entries].sort((a, b) => a.pageId.localeCompare(b.pageId)), manifestDigest: await corpusDigest(entries) } as const;
  const errors = await validateOmrCorpusManifest(manifest, false);
  if (errors.length > 0) throw new RangeError(errors.join(","));
  return manifest;
}

export async function validateOmrCorpusManifest(manifest: OmrCorpusManifest, requireTargets = true): Promise<readonly string[]> {
  const errors: string[] = [];
  if (manifest.version !== OMR_CORPUS_MANIFEST_VERSION || manifest.manifestDigest !== await corpusDigest(manifest.entries)) errors.push("OMR_CORPUS_MANIFEST_INTEGRITY_INVALID");
  if (new Set(manifest.entries.map((entry) => entry.pageId)).size !== manifest.entries.length) errors.push("OMR_CORPUS_PAGE_DUPLICATE");
  if (manifest.entries.some((entry) => !entry.rights.reference || !["self-authored", "public-domain", "licensed", "user-confirmed-rights"].includes(entry.rights.basis)
    || !entry.rights.allowedUses.includes("evaluation") || !isSemanticDigest(entry.groundTruthDigest))) errors.push("RIGHTS_EVALUATION_NOT_CONFIRMED");
  if (manifest.entries.some((entry) => !["digital-pdf", "scanned-pdf", "camera-photo"].includes(entry.sourceKind)
    || !["4/4", "6/8", "other"].includes(entry.meter) || !["major", "minor"].includes(entry.keyMode)
    || new Set(entry.features).size !== entry.features.length
    || entry.features.some((feature) => !["accidentals", "dotted-notes", "ties"].includes(feature)))) errors.push("OMR_CORPUS_ENTRY_INVALID");
  const devSongs = new Set(manifest.entries.filter((entry) => entry.split === "dev").map((entry) => entry.songId));
  const devCaptures = new Set(manifest.entries.filter((entry) => entry.split === "dev").map((entry) => entry.captureId));
  if (manifest.entries.some((entry) => entry.split === "sealed" && (devSongs.has(entry.songId) || devCaptures.has(entry.captureId)))) errors.push("OMR_CORPUS_SPLIT_LEAKAGE");
  if (requireTargets) {
    if (manifest.entries.filter((entry) => entry.split === "dev").length < 36) errors.push("EXTERNAL_OMR_CALIBRATION_CORPUS_REQUIRED:dev");
    if (manifest.entries.filter((entry) => entry.split === "sealed").length < 24) errors.push("EXTERNAL_OMR_CALIBRATION_CORPUS_REQUIRED:sealed");
    for (const split of ["dev", "sealed"] as const) {
      const entries = manifest.entries.filter((entry) => entry.split === split);
      const hasSources = ["digital-pdf", "scanned-pdf", "camera-photo"].every((sourceKind) => entries.some((entry) => entry.sourceKind === sourceKind));
      const hasMeters = ["4/4", "6/8"].every((meter) => entries.some((entry) => entry.meter === meter));
      const hasModes = ["major", "minor"].every((keyMode) => entries.some((entry) => entry.keyMode === keyMode));
      const hasFeatures = ["accidentals", "dotted-notes", "ties"].every((feature) => entries.some((entry) => entry.features.includes(feature as OmrCorpusEntry["features"][number])));
      if (entries.length > 0 && (!hasSources || !hasMeters || !hasModes || !hasFeatures)) errors.push(`OMR_CORPUS_CATEGORY_COVERAGE_REQUIRED:${split}`);
    }
  }
  return errors;
}

export interface OmrThresholdArtifact {
  readonly version: typeof OMR_THRESHOLD_ARTIFACT_VERSION;
  readonly providerId: string;
  readonly devManifestDigest: SemanticDigest;
  readonly thresholds: Readonly<Record<string, number>>;
  readonly frozenAt: string;
  readonly artifactDigest: SemanticDigest;
}

export async function freezeOmrThresholdArtifact(input: Omit<OmrThresholdArtifact, "version" | "artifactDigest" | "devManifestDigest"> & { readonly manifest: OmrCorpusManifest; readonly evidenceKind: "real-provider" | "reference-fixture" }): Promise<OmrThresholdArtifact> {
  if (input.evidenceKind !== "real-provider" || !input.providerId || Object.keys(input.thresholds).length === 0
    || Object.values(input.thresholds).some((value) => !Number.isSafeInteger(value) || value < 0 || value > 10_000)
    || !Number.isFinite(Date.parse(input.frozenAt)) || (await validateOmrCorpusManifest(input.manifest, true)).length > 0) throw new RangeError("EXTERNAL_OMR_CALIBRATION_CORPUS_REQUIRED");
  const payload = { version: OMR_THRESHOLD_ARTIFACT_VERSION, providerId: input.providerId, devManifestDigest: await omrCorpusSplitDigest(input.manifest, "dev"), thresholds: input.thresholds, frozenAt: input.frozenAt } as const;
  return { ...payload, artifactDigest: await semanticDigest({ projectionSchema: OMR_THRESHOLD_ARTIFACT_VERSION, ...payload }) };
}

export interface OmrSealedRunReport {
  readonly version: typeof OMR_SEALED_REPORT_VERSION;
  readonly providerId: string;
  readonly sourceCommit: string;
  readonly sealedManifestDigest: SemanticDigest;
  readonly thresholdArtifactDigest: SemanticDigest;
  readonly metrics: OmrMetricReport;
  readonly executedAt: string;
  readonly reportDigest: SemanticDigest;
}

export async function createOmrSealedRunReport(input: {
  readonly providerId: string;
  readonly sourceCommit: string;
  readonly manifest: OmrCorpusManifest;
  readonly thresholdArtifact: OmrThresholdArtifact;
  readonly pages: readonly OmrEvaluationPageResult[];
  readonly executedAt: string;
  readonly evidenceKind: "real-provider" | "reference-fixture";
}): Promise<OmrSealedRunReport> {
  const thresholdPayload = {
    version: input.thresholdArtifact.version,
    providerId: input.thresholdArtifact.providerId,
    devManifestDigest: input.thresholdArtifact.devManifestDigest,
    thresholds: input.thresholdArtifact.thresholds,
    frozenAt: input.thresholdArtifact.frozenAt,
  } as const;
  if (input.evidenceKind !== "real-provider"
    || !/^[0-9a-f]{40}$/u.test(input.sourceCommit)
    || !Number.isFinite(Date.parse(input.executedAt))
    || input.providerId !== input.thresholdArtifact.providerId
    || input.thresholdArtifact.artifactDigest !== await semanticDigest({ projectionSchema: OMR_THRESHOLD_ARTIFACT_VERSION, ...thresholdPayload })
    || input.thresholdArtifact.devManifestDigest !== await omrCorpusSplitDigest(input.manifest, "dev")) {
    throw new RangeError("EXTERNAL_OMR_CALIBRATION_CORPUS_REQUIRED");
  }
  const manifestErrors = await validateOmrCorpusManifest(input.manifest, true);
  const sealedIds = new Set(input.manifest.entries.filter((entry) => entry.split === "sealed").map((entry) => entry.pageId));
  if (manifestErrors.length > 0 || input.pages.length !== sealedIds.size
    || input.pages.some((page) => !sealedIds.has(page.pageId))) throw new RangeError("EXTERNAL_OMR_CALIBRATION_CORPUS_REQUIRED");
  const metrics = computeOmrMetricReport(input.pages);
  const payload = {
    version: OMR_SEALED_REPORT_VERSION,
    providerId: input.providerId,
    sourceCommit: input.sourceCommit,
    sealedManifestDigest: await omrCorpusSplitDigest(input.manifest, "sealed"),
    thresholdArtifactDigest: input.thresholdArtifact.artifactDigest,
    metrics,
    executedAt: input.executedAt,
  } as const;
  return { ...payload, reportDigest: await semanticDigest({ projectionSchema: OMR_SEALED_REPORT_VERSION, ...payload }) };
}
