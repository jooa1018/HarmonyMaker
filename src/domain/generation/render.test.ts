import { describe, expect, it } from "vitest";
import type { ArrangementRenderDocument } from "./model";
import { validateRenderDocumentAuthority } from "./render";
import type { SemanticDigest } from "../digest/canonical";

describe("Source Lead render authority", () => {
  it("keeps Source Lead separate from generated harmony tracks", () => {
    const digest = "0".repeat(64) as SemanticDigest;
    const document: ArrangementRenderDocument = {
      measures: [], sourceLeadTrack: { trackPlanId: "track:source-lead", atomizationDigest: digest, atoms: [] }, generatedHarmonyTracks: [{ trackPlanId: "track:h1", events: [] }],
      effectiveChordTimeline: { sourceChordProjectionDigest: digest, performanceSequenceDigest: digest, resolutionPolicy: { gapPolicy: "carry-until-next" }, chordTimelineResolverVersion: "v", spans: [], digest }, lyricTokens: [],
    };
    expect(validateRenderDocumentAuthority(document)).toBe(true);
    expect(validateRenderDocumentAuthority({ ...document, generatedHarmonyTracks: [{ trackPlanId: "track:source-lead", events: [] }] })).toBe(false);
  });
});
