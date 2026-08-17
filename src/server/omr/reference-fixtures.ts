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
      { id: "reference-evidence:page", vendorTargetId: "page_1", granularity: "page", box: { frameId: "reference-frame:original", xMu: coordinateMicrounit(0), yMu: coordinateMicrounit(0), widthMu: coordinateMicrounit(1_000_000), heightMu: coordinateMicrounit(1_000_000) }, vendorId: "hm-reference" },
      { id: "reference-evidence:staff", vendorTargetId: "staff_main", granularity: "staff", box: { frameId: "reference-frame:original", xMu: coordinateMicrounit(30_000), yMu: coordinateMicrounit(80_000), widthMu: coordinateMicrounit(940_000), heightMu: coordinateMicrounit(180_000) }, confidenceBp: basisPoints(8600), vendorId: "hm-reference" },
      { id: "reference-evidence:measure", vendorTargetId: "measure_42", granularity: "measure", box: { frameId: "reference-frame:original", xMu: coordinateMicrounit(50_000), yMu: coordinateMicrounit(40_000), widthMu: coordinateMicrounit(900_000), heightMu: coordinateMicrounit(280_000) }, confidenceBp: basisPoints(9000), vendorId: "hm-reference" },
      { id: "reference-evidence:symbol", vendorTargetId: "symbol_abc", granularity: "symbol", box: { frameId: "reference-frame:original", xMu: coordinateMicrounit(90_000), yMu: coordinateMicrounit(70_000), widthMu: coordinateMicrounit(180_000), heightMu: coordinateMicrounit(90_000) }, confidenceBp: basisPoints(9300), vendorId: "hm-reference" },
    ],
  },
  normalizationMappings: [
    { vendorTargetId: "page_1", target: { kind: "measure", measureOrdinal: 0 } },
    { vendorTargetId: "staff_main", target: { kind: "voice-event", measureOrdinal: 0, eventOrdinal: 0 } },
    { vendorTargetId: "measure_42", target: { kind: "measure-start", measureOrdinal: 0 } },
    { vendorTargetId: "symbol_abc", target: { kind: "chord-event", measureOrdinal: 0, eventOrdinal: 0 } },
  ],
  retentionInfo: { canDeleteImmediately: true, policyReference: "in-repository-reference-fixture" },
}]);
