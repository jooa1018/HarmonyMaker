import "server-only";

import { basisPoints } from "../../domain/rates";
import { coordinateMicrounit } from "../../domain/omr/foundation";
import { REFERENCE_OMR_MUSICXML, REFERENCE_OMR_PAGE_DIGEST } from "../../domain/omr/reference-fixture-data";
import type { ReferenceOmrFixture } from "./reference-adapter";

export const REFERENCE_OMR_FIXTURES: readonly ReferenceOmrFixture[] = Object.freeze([{
  id: "hm-reference-complete-needs-input-v1",
  orderedPageDigests: [REFERENCE_OMR_PAGE_DIGEST],
  statusScript: [
    { kind: "queued" },
    { kind: "processing", progressBp: basisPoints(3000) },
    { kind: "needs-input", request: { kind: "select-instrument", requestId: "reference-request:lead", choices: ["voice", "piano"] } },
    { kind: "processing", progressBp: basisPoints(8000) },
    { kind: "completed" },
  ],
  musicXml: REFERENCE_OMR_MUSICXML,
  evidence: {
    granularity: "measure",
    frames: [{ id: "reference-frame:original", pageIndex: 0, coordinateSpace: "normalized-original", widthPixels: 260, heightPixels: 340, imageDigest: REFERENCE_OMR_PAGE_DIGEST }],
    transforms: [],
    evidence: [
      { id: "reference-evidence:page", granularity: "page", box: { frameId: "reference-frame:original", xMu: coordinateMicrounit(0), yMu: coordinateMicrounit(0), widthMu: coordinateMicrounit(1_000_000), heightMu: coordinateMicrounit(1_000_000) }, vendorId: "hm-reference" },
      { id: "reference-evidence:measure", vendorTargetId: "ch:0:0", granularity: "measure", box: { frameId: "reference-frame:original", xMu: coordinateMicrounit(50_000), yMu: coordinateMicrounit(40_000), widthMu: coordinateMicrounit(900_000), heightMu: coordinateMicrounit(280_000) }, confidenceBp: basisPoints(9000), vendorId: "hm-reference" },
    ],
  },
  retentionInfo: { canDeleteImmediately: true, policyReference: "in-repository-reference-fixture" },
}]);
