import { describe, expect, it } from "vitest";
import { canonicalJson, type SemanticDigest } from "./digest/canonical";
import { fraction } from "./fraction";
import { findPitchAnchorConflicts, type AnchorLock, type PitchLock } from "./locks";
import { validateIntentAuthority, type ArrangementIntentPlan, type WorshipArrangementGrammar } from "./plans";
import { digestIntentPlan } from "./digest/plans";
import { basisPoints, extendedBasisPoints } from "./rates";

const digest = "0".repeat(64) as SemanticDigest;
const position = { performanceMeasureIndex: 0, offset: fraction(1) };

describe("plan and lock authority", () => {
  it("represents Grammar blocked without a fake Intent", () => {
    const grammar: WorshipArrangementGrammar = {
      grammarId: "worship-arrangement-grammar-v1", grammarVersion: "not-accepted", grammarConfigDigest: digest,
      planSection: () => ({ status: "blocked", diagnostics: [] }),
      planPhrase: () => ({ status: "blocked", candidateTrace: [], diagnostics: [] }),
    };
    const blocked: ReturnType<WorshipArrangementGrammar["planSection"]> = { status: "blocked", diagnostics: [] };
    expect(blocked).toEqual({ status: "blocked", diagnostics: [] });
    expect("sectionIntent" in blocked).toBe(false);
    expect(grammar.grammarId).toBe("worship-arrangement-grammar-v1");
  });

  it("keeps section intensity only on Section Intent and trace out of semantic Plan digest", async () => {
    const plan: ArrangementIntentPlan = {
      stage: "intent", presetId: "simple", intentInputDigest: digest, effectiveChordTimelineDigest: digest, sourceLeadAtomizationDigest: digest, effectiveConfigDigest: digest, presetProfileVersion: "v", presetProfileDigest: digest, grammarId: "worship-arrangement-grammar-v1", grammarVersion: "v", plannerVersion: "v", grammarConfigDigest: digest, plannerConfigDigest: digest, diagnosticRegistryVersion: "v", diagnosticRegistryDigest: digest,
      sectionIntents: [{ id: "si:0", sectionOccurrenceId: "so:0", presetId: "simple", intensityTarget: { participationCoverageBp: basisPoints(0), harmonicDivergenceCoverageBp: basisPoints(0), exactlyTwoPitchCoverageBp: basisPoints(0), exactlyThreePitchCoverageBp: basisPoints(0), maxHarmonyAttackRatioBp: extendedBasisPoints(0), registerSpreadRange: [0, 0], maxActiveVoiceCount: 1 }, grammarRuleIds: [] }],
      phraseIntents: [{ id: "pi:0", phraseId: "ph:0", presetId: "simple", sectionIntentId: "si:0", textureId: "UNISON", trackRoles: [], lyricPolicy: "same-lyrics", cadencePolicy: "open", grammarRuleIds: [] }], intentPlanDigest: digest,
    };
    expect(validateIntentAuthority(plan)).toBe(true);
    const ordinals = { sectionOccurrenceOrdinalById: { "so:0": 0 }, phraseOrdinalById: { "ph:0": 0 }, trackOrdinalById: {}, leadAtomOrdinalById: {}, chordSpanOrdinalById: {} };
    const baseDigest = await digestIntentPlan(plan, ordinals);
    const explanationChanged = await digestIntentPlan({ ...plan, sectionIntents: [{ ...plan.sectionIntents[0], grammarRuleIds: ["explanation-only"] }], grammarTrace: { grammarVersion: "v", candidatesByPhraseId: {} } }, ordinals);
    expect(explanationChanged).toBe(baseDigest);
    const splitChanged = await digestIntentPlan({ ...plan, phraseIntents: [{ ...plan.phraseIntents[0], splitDirective: { position, reasonCode: "PHRASE_MIDPOINT" } }] }, ordinals);
    expect(splitChanged).not.toBe(baseDigest);
  });

  it("round-trips a self-contained planned-NCT lock without an nctPlanId", () => {
    const endpoint = { kind: "chord-tone", position: { performanceMeasureIndex: 0, offset: fraction(0) }, chordSpanId: "pcs:0", selectedTone: { degree: 3, alteration: 0, role: "third", origin: "quality" } } as const;
    const lock: AnchorLock = { id: "lock:0", presetId: "standard", kind: "anchor-planned-nct", phraseId: "ph:0", trackPlanId: "track:1", position, nctSpec: { kind: "passing", preparation: endpoint, resolution: { ...endpoint, position: { performanceMeasureIndex: 0, offset: fraction(2) } }, direction: "up", contextChordSpanId: "pcs:0", targetChordSpanId: "pcs:1", resolutionDeadline: { performanceMeasureIndex: 0, offset: fraction(3) } } };
    const encoded = canonicalJson(lock);
    expect(encoded).toContain("preparation");
    expect(encoded).toContain("resolutionDeadline");
    expect(encoded).not.toContain("nctPlanId");
  });

  it("reports incompatible PitchLock and AnchorLock instead of choosing silently", () => {
    const anchor: AnchorLock = { id: "anchor:0", presetId: "simple", kind: "anchor-chord-tone", phraseId: "ph:0", trackPlanId: "track:1", position, chordSpanId: "pcs:0", selectedTone: { degree: 3, alteration: 0, role: "third", origin: "quality" } };
    const pitch: PitchLock = { id: "pitch:0", presetId: "simple", kind: "pitch", phraseId: "ph:0", trackPlanId: "track:1", position, pitch: { step: "D", alter: 0, octave: 4 } };
    expect(findPitchAnchorConflicts([anchor], [pitch], { "anchor:0": { step: "E", alter: 0, octave: 4 } })).toEqual(["STAGE_LOCK_SCOPE_INVALID:anchor:0:pitch:0"]);
  });
});
