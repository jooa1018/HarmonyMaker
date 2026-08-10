import { canonicalJson, semanticDigest } from "../../domain/digest/canonical";
import { describe, expect, it } from "vitest";
import {
  RC7_ACCEPTED_PROJECTOR_PROVENANCE,
  createIntentWitness,
  createRc7PipelineContext,
} from "./authority";
import { verifyFrozenRc7Config } from "./config";
import {
  RC7_GRAMMAR_CONFIG_DIGEST,
  RC7_GRAMMAR_VERSION,
  RC7_REVIEW_PACKAGE_SHA256,
  RC7_REVIEW_VERSIONS,
} from "./constants";
import { compareRc7Opportunities } from "./grammar";
import { runRc7ReferencePack } from "./harness";
import { prepareRc7ReferenceCase, REVIEW_SELECTOR_VERSION } from "./prepare";
import { RC7_REFERENCE_CASES, RC7_SCENARIO_ASSERTION_MAINTENANCE } from "./reference-cases";
import { runRc7IntentStage } from "./stages";

describe("rc.7 package and P1 closure contracts", () => {
  it("pins the immutable package identity and frozen semantic config", async () => {
    const observed = await verifyFrozenRc7Config();
    expect(RC7_GRAMMAR_VERSION).toBe("1.0.0-rc.7");
    expect(RC7_REVIEW_PACKAGE_SHA256).toBe("98a218bbc35866eb3cd71428698f52f2a4012170b8404b7b85b576d0679aa999");
    expect(observed.digest).toBe(RC7_GRAMMAR_CONFIG_DIGEST);
    expect(await semanticDigest({
      projectionSchema: "hm-worship-arrangement-grammar-config-v1",
      value: observed.config,
    })).toBe(RC7_GRAMMAR_CONFIG_DIGEST);
    expect(observed.config.textureLimits.TWO_PART_PARALLEL.fullPhraseAutomatic.allowed).toBe(false);
    expect(observed.config.textureLimits.UNISON.fullPhraseAttackForAttackAutomaticAllowed).toBe(false);
  });

  it("closes RC7-P1-01 through cache-free authoritative Intent rehydration", async () => {
    const definition = RC7_REFERENCE_CASES.find((candidate) => candidate.caseId === "C-STANDARD-CHORUS-BOUNDED-TPP")!;
    const prepared = await prepareRc7ReferenceCase(definition);
    expect(prepared).not.toHaveProperty("opportunityPayloadBase");
    expect(prepared).not.toHaveProperty("mandatoryAnchors");
    expect(prepared).not.toHaveProperty("primaryTrackId");
    const context = await createRc7PipelineContext(prepared);
    const result = await runRc7IntentStage(context);
    expect(result.serializedAuthoritativePlan).not.toContain("opportunities");
    expect(result.serializedAuthoritativePlan).not.toContain("trace");
    expect(result.rehydratedWinner.key).toBe(result.selection.winner.key);
    expect(result.rehydratedWinner.semanticPayload.roleTuple).toEqual(result.selection.winner.semanticPayload.roleTuple);
    expect(result.rehydratedSelection.opportunities.filter((candidate) => (
      candidate.key === result.rehydratedWinner.key
    ))).toHaveLength(1);
  });

  it("closes RC7-P1-02 with projector provenance outside the semantic witness", async () => {
    const prepared = await prepareRc7ReferenceCase(RC7_REFERENCE_CASES[0]);
    const context = await createRc7PipelineContext(prepared);
    const { digest, witness } = await createIntentWitness(context);
    expect(RC7_ACCEPTED_PROJECTOR_PROVENANCE).toMatchObject({
      path: "src/domain/digest/stages.ts",
      function: "digestIntentInput",
      metadataPlacement: "out-of-band-verifier-dependency",
      projectionSchema: "hm-intent-input-v1",
    });
    expect(witness).not.toHaveProperty("authoritativeProjector");
    expect(witness.authoritativeIntentInputProjection).not.toHaveProperty("value");
    expect(await semanticDigest(witness.authoritativeIntentInputProjection)).toBe(digest);
    expect(REVIEW_SELECTOR_VERSION).toBe("select-texture-activity-opportunity-v5");
    expect(RC7_REVIEW_VERSIONS.responseSelectorVersion).toBe("select-texture-activity-opportunity-v5");
  });

  it("closes RC7-P1-03 with bounded TPP and zero automatic full-phrase selections", async () => {
    expect(RC7_SCENARIO_ASSERTION_MAINTENANCE).toEqual({
      scenarioId: "SCN-009",
      staleAssertionRemoved: "full TPP reachable",
      requiredAssertions: [
        "bounded TPP reachable",
        "automatic full TPP selection count = 0",
        "one independent track exact",
      ],
    });
    const outputs = await runRc7ReferencePack();
    const tpp = outputs.filter((output) => output.winner.textureId === "TWO_PART_PARALLEL");
    expect(tpp.length).toBeGreaterThan(0);
    expect(tpp.filter((output) => (
      output.activity.plan.phraseActivityPlans[0].attackEvents.length
        === output.leadAtomsSummary.filter((atom) => atom.pitch !== null && !atom.tiedFromPrevious).length
    ))).toHaveLength(0);
  }, 60_000);

  it("scores every opportunity before the exact canonical selector chooses a deduplicated winner", async () => {
    for (const definition of RC7_REFERENCE_CASES) {
      const context = await createRc7PipelineContext(await prepareRc7ReferenceCase(definition));
      const result = await runRc7IntentStage(context);
      expect(result.selection.opportunities.every((candidate) => (
        Number.isSafeInteger(candidate.totalScore)
          && candidate.scoreParts.reduce((sum, part) => sum + part.cost, 0) === candidate.totalScore
      ))).toBe(true);
      expect(new Set(result.selection.opportunities.map((candidate) => candidate.key)).size)
        .toBe(result.selection.opportunities.length);
      expect([...result.selection.opportunities].sort(compareRc7Opportunities)[0].key)
        .toBe(result.selection.winner.key);
      expect(canonicalJson(result.selection.winner.semanticPayload)).not.toContain("trackPlanId");
    }
  }, 60_000);
});
