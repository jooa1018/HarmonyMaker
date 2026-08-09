import { describe, expect, it } from "vitest";
import { createDiagnosticRegistry, createDiagnostics, diagnosticProjection, DIAGNOSTIC_CODES, type DiagnosticDefinition, type DiagnosticCode } from "./diagnostics";
import { fraction } from "./fraction";
import { anchorDirectiveId, leadEventId, performanceChordSpanId, phraseRegionId, sourceMeasureId, stageLockId, timelineAtomId, voiceAttackEventId } from "./ids";

describe("deterministic ID and diagnostic registry", () => {
  it("uses canonical ordinal and normalized position keys", () => {
    expect(sourceMeasureId(2)).toBe("sm:2");
    expect(leadEventId(2, 3)).toBe("le:2:3");
    expect(phraseRegionId(1, { performanceMeasureIndex: 2, offset: fraction(1, 2) }, { performanceMeasureIndex: 3, offset: fraction(0) })).toBe("ph:1:2:1/2:3:0/1");
    expect(performanceChordSpanId({ performanceMeasureIndex: 0, offset: fraction(0) }, { performanceMeasureIndex: 1, offset: fraction(0) })).toBe("pcs:0:0/1:1:0/1");
    expect(timelineAtomId(0, 1, fraction(0), fraction(2))).toBe("ta:0:1:0/1:2/1");
    expect(voiceAttackEventId("simple", 0, 1, { performanceMeasureIndex: 0, offset: fraction(1) }, "attack")).toBe("vae:simple:0:1:0:1/1:attack");
    expect(anchorDirectiveId("simple", 0, 1, { performanceMeasureIndex: 0, offset: fraction(1) }, 0)).toBe("ad:simple:0:1:0:1/1:0");
    expect(stageLockId("simple", "anchor", "ph:0", 0)).toBe("lk:simple:anchor:ph:0:0");
  });

  it("requires every DiagnosticCode exactly once and excludes messageKo from semantic projection", async () => {
    const definitions = Object.fromEntries(DIAGNOSTIC_CODES.map((code): readonly [DiagnosticCode, DiagnosticDefinition] => [code, { code, defaultSeverity: "blocking", blocksGeneration: true, blocksComplete: true, scope: "validation" }])) as Readonly<Record<DiagnosticCode, DiagnosticDefinition>>;
    const registry = await createDiagnosticRegistry("diag-v1", definitions);
    expect(Object.keys(registry.definitions)).toHaveLength(DIAGNOSTIC_CODES.length);
    const [first] = await createDiagnostics([{ code: "GEN_TIMEOUT", severity: "blocking", messageKo: "첫 문구", details: { reason: "TIMEOUT" } }], registry);
    const [second] = await createDiagnostics([{ code: "GEN_TIMEOUT", severity: "blocking", messageKo: "다른 문구", details: { reason: "TIMEOUT" } }], registry);
    expect(first.id).toBe(second.id);
    expect(diagnosticProjection(first, registry)).toEqual(diagnosticProjection(second, registry));
  });
});
