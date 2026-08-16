import { describe, expect, it } from "vitest";

import {
  REQUIRED_SEGMENT_B_FIXTURE_IDS,
  materializeSegmentBFixture,
  type SegmentBFixtureId,
} from "./fixtures";
import { executeWagSegmentB } from "./segment-b";

const CORRUPTION_OR_META_FIXTURES = new Set<SegmentBFixtureId>([
  "hm-diagnostic-registry-merge-v0",
  "hm-segment-b-activity-anchor-parity-v0",
  "hm-segment-b-full-only-repair-corruption-v0",
  "hm-segment-b-result-truth-table-v0",
  "hm-segment-b-validator-corruption-matrix-v0",
]);

const EXECUTABLE_FIXTURES = REQUIRED_SEGMENT_B_FIXTURE_IDS.filter((fixtureId) =>
  !CORRUPTION_OR_META_FIXTURES.has(fixtureId));

describe("R9 canonical fixture conformance", () => {
  it.each(EXECUTABLE_FIXTURES)("matches the explicit status and reason for %s", async (fixtureId) => {
    const fixture = await materializeSegmentBFixture(fixtureId);
    const result = await executeWagSegmentB(fixture.input);
    expect(result.status).toBe(fixture.expected.expectedStatus);
    if (result.status === "blocked" && fixture.expected.expectedDiagnostic) {
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(fixture.expected.expectedDiagnostic);
    }
    if (result.status !== "blocked" && fixture.expected.expectedReason?.startsWith("OPTIONAL_")) {
      expect(result.generation.rejections.map((rejection) => rejection.reason)).toContain(fixture.expected.expectedReason);
    }
    if (result.status === "partial" && fixture.expected.expectedDiagnostic) {
      expect(result.generation.result.candidates.flatMap((candidate) => candidate.diagnostics.map((diagnostic) => diagnostic.code)))
        .toContain(fixture.expected.expectedDiagnostic);
    }
  });
});
