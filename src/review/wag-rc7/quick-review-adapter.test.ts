import type { SemanticDigest } from "../../domain/digest/canonical";
import type { SongSourceDocument } from "../../domain/source/model";
import type { QuickReviewAnalysis } from "../../import/review/quick-review";
import { describe, expect, it } from "vitest";
import { runPreparedRc7ReviewInput } from "./harness";
import { prepareRc7ReferenceCase } from "./prepare";
import { prepareRc7QuickReviewInput } from "./quick-review-adapter";
import { RC7_REFERENCE_CASES } from "./reference-cases";

function quickReviewState(readyForPlanning: boolean): QuickReviewAnalysis["state"] {
  return {
    selectedLeadStaffKey: readyForPlanning ? "selected-lead" : undefined,
    unresolvedChordGapDiagnosticIds: [],
    unconfirmedChordEventIds: [],
    unconfirmedSectionDefinitionIds: [],
    invalidPerformerIds: [],
    unsupportedPerformanceFlowIds: [],
    missingRightsUses: [],
    blockingDiagnosticIds: [],
    readyForPlanning,
  };
}

describe("rc.7 Quick Review adapter", () => {
  it("admits only readyForPlanning source authority and remains non-persisting", async () => {
    const synthetic = await prepareRc7ReferenceCase(RC7_REFERENCE_CASES[0]);
    const source: SongSourceDocument = {
      schemaVersion: 9,
      documentId: "doc:quick-review-test",
      revisionOrdinal: 0,
      revisionDigest: synthetic.musicalSourceDigest,
      revisionHistory: [],
      revisionHistoryDigest: "0".repeat(64) as SemanticDigest,
      title: "Original Quick Review Test",
      defaultKey: synthetic.defaultKey,
      defaultTempo: synthetic.defaultTempo,
      sourceMeasures: synthetic.sourceMeasures,
      performanceSequence: synthetic.performanceSequence,
      sectionDefinitions: [synthetic.sectionDefinition],
      sectionOccurrences: [synthetic.sectionOccurrence],
      phraseRegions: [synthetic.phrase],
      rights: { basis: "self-authored", allowedUses: ["generation"] },
    };
    const analysis: QuickReviewAnalysis = {
      state: quickReviewState(true),
      diagnostics: [],
      source,
      chordTimelineState: {
        status: "resolved",
        timeline: synthetic.effectiveChordTimeline,
        diagnostics: [],
      },
      atomization: synthetic.sourceLeadAtomization,
    };
    const prepared = prepareRc7QuickReviewInput({
      analysis,
      caseId: "QUICK-REVIEW-READY",
      presetId: "simple",
      performers: synthetic.performers,
      userCaps: { maxHarmonyTracks: 2, allowOctaveDouble: true },
    });
    expect(prepared.sourceKind).toBe("quick-review-import");
    expect(prepared.sourceIdentity).toContain(source.revisionDigest);
    const output = await runPreparedRc7ReviewInput(prepared);
    expect(output.authorityBoundary.persistsHarmonyProject).toBe(false);
    expect(output.authorityBoundary.mutatesHarmonyProject).toBe(false);
    expect(source.revisionDigest).toBe(synthetic.musicalSourceDigest);

    expect(() => prepareRc7QuickReviewInput({
      analysis: { ...analysis, state: quickReviewState(false) },
      caseId: "QUICK-REVIEW-BLOCKED",
      presetId: "simple",
      performers: synthetic.performers,
    })).toThrow("QUICK_REVIEW_NOT_READY_FOR_PLANNING");
  }, 30_000);
});
