import {
  RC7_GRAMMAR_CONFIG_DIGEST,
  RC7_GRAMMAR_VERSION,
  RC7_LISTENING_AXES,
  RC7_REVIEW_BOUNDARY,
  RC7_REVIEW_PACKAGE_SHA256,
} from "./constants";
import type { Rc7ReviewOutput } from "./types";

export interface Rc7ReviewArtifactFile {
  readonly path: string;
  readonly mediaType: "application/json" | "text/vnd.abc";
  readonly content: string;
  readonly layer: "authoritative-semantics" | "diagnostic-trace" | "playback" | "manifest";
}

export interface Rc7BlindListeningBallot {
  readonly schema: "hm-wag-rc7-blind-ballot-v1";
  readonly comparisonId: string;
  readonly labels: readonly ["A", "B"];
  readonly scale: readonly [1, 2, 3, 4, 5];
  readonly axes: typeof RC7_LISTENING_AXES;
  readonly ratings: Readonly<Record<"A" | "B", Readonly<Record<string, number | null>>>>;
  readonly freeText: Readonly<Record<"A" | "B", string>>;
  readonly hiddenMetadata: {
    readonly A: { readonly caseId: string; readonly candidateId: string; readonly preset: string };
    readonly B: { readonly caseId: string; readonly candidateId: string; readonly preset: string };
  };
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function safeCaseDirectory(caseId: string): string {
  const value = caseId.replace(/[^A-Za-z0-9_-]/gu, "-");
  if (!value) throw new RangeError("RC7_ARTIFACT_CASE_ID_INVALID");
  return `review-output/cases/${value}`;
}

export function createRc7CaseArtifacts(output: Rc7ReviewOutput): readonly Rc7ReviewArtifactFile[] {
  const directory = safeCaseDirectory(output.caseId);
  return [
    {
      path: `${directory}/input.json`,
      mediaType: "application/json",
      layer: "authoritative-semantics",
      content: json({
        caseId: output.caseId,
        sourceIdentity: output.sourceIdentity,
        meter: output.meter,
        key: output.key,
        section: output.section,
        sectionVariant: output.sectionVariant,
        preset: output.preset,
        performerRanges: output.performerRanges,
        phraseBounds: output.phraseBounds,
        phraseFeatures: output.phraseFeatures,
        leadAtoms: output.leadAtomsSummary,
        effectiveChordSpans: output.effectiveChordSpans,
      }),
    },
    {
      path: `${directory}/intent.json`,
      mediaType: "application/json",
      layer: "authoritative-semantics",
      content: json(output.intent.plan),
    },
    {
      path: `${directory}/activity.json`,
      mediaType: "application/json",
      layer: "authoritative-semantics",
      content: json(output.activity.plan),
    },
    {
      path: `${directory}/anchor.json`,
      mediaType: "application/json",
      layer: "authoritative-semantics",
      content: json(output.anchor.plan),
    },
    {
      path: `${directory}/generated.json`,
      mediaType: "application/json",
      layer: "authoritative-semantics",
      content: json({
        generationInputDigest: output.generated.generationInputDigest,
        candidate: output.generated.candidate,
        rangeChecks: output.rangeChecks,
        verticalLegalityChecks: output.verticalLegalityChecks,
        nctClassification: output.nctClassification,
      }),
    },
    {
      path: `${directory}/score-breakdown.json`,
      mediaType: "application/json",
      layer: "diagnostic-trace",
      content: json({
        grammarCandidates: output.candidateScoreBreakdown,
        pitchCandidates: output.generated.pitchTrace,
      }),
    },
    {
      path: `${directory}/trace.json`,
      mediaType: "application/json",
      layer: "diagnostic-trace",
      content: json({
        authoritative: false,
        grammarTrace: output.trace,
        cacheRequired: output.activity.cacheRequired,
        traceRequired: output.activity.traceRequired,
      }),
    },
    {
      path: `${directory}/playback.abc`,
      mediaType: "text/vnd.abc",
      layer: "playback",
      content: output.playback.fullArrangementAbc,
    },
    {
      path: `${directory}/lead-only.abc`,
      mediaType: "text/vnd.abc",
      layer: "playback",
      content: output.playback.leadOnlyAbc,
    },
  ];
}

export function createRc7ReviewArtifactBundle(
  outputs: readonly Rc7ReviewOutput[],
): readonly Rc7ReviewArtifactFile[] {
  if (outputs.length === 0) throw new RangeError("RC7_ARTIFACT_PACK_EMPTY");
  const manifest: Rc7ReviewArtifactFile = {
    path: "review-output/manifest.json",
    mediaType: "application/json",
    layer: "manifest",
    content: json({
      schema: "hm-wag-rc7-review-manifest-v1",
      authorityBoundary: RC7_REVIEW_BOUNDARY,
      grammarVersion: RC7_GRAMMAR_VERSION,
      grammarConfigDigest: RC7_GRAMMAR_CONFIG_DIGEST,
      reviewPackageSha256: RC7_REVIEW_PACKAGE_SHA256,
      cases: outputs.map((output) => ({
        caseId: output.caseId,
        title: output.title,
        preset: output.preset,
        winner: output.winner.textureId,
        opportunityKey: output.opportunityKey,
        candidateId: output.generated.candidate.id,
        candidateContentDigest: output.generated.candidate.contentDigest,
        playbackPath: `${safeCaseDirectory(output.caseId)}/playback.abc`,
      })),
    }),
  };
  return [manifest, ...outputs.flatMap(createRc7CaseArtifacts)];
}

export function createRc7BlindListeningBallot(
  comparisonId: string,
  a: Rc7ReviewOutput,
  b: Rc7ReviewOutput,
): Rc7BlindListeningBallot {
  const emptyRatings = Object.fromEntries(RC7_LISTENING_AXES.map((axis) => [axis, null]));
  return {
    schema: "hm-wag-rc7-blind-ballot-v1",
    comparisonId,
    labels: ["A", "B"],
    scale: [1, 2, 3, 4, 5],
    axes: RC7_LISTENING_AXES,
    ratings: { A: { ...emptyRatings }, B: { ...emptyRatings } },
    freeText: { A: "", B: "" },
    hiddenMetadata: {
      A: { caseId: a.caseId, candidateId: a.generated.candidate.id, preset: a.preset },
      B: { caseId: b.caseId, candidateId: b.generated.candidate.id, preset: b.preset },
    },
  };
}
