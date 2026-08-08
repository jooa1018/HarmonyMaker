import { describe, expect, it } from "vitest";
import { canonicalJson, type SemanticDigest } from "./digest/canonical";
import { fraction } from "./fraction";
import { findPitchAnchorConflicts, type AnchorLock, type PitchLock } from "./locks";
import { validateIntentAuthority, type ArrangementIntentPlan, type WorshipArrangementGrammar } from "./plans";

const digest = "0".repeat(64) as SemanticDigest;
const position = { performanceMeasureIndex: 0, offset: fraction(1) };

describe("plan and lock authority", () => {
  it("represents Grammar blocked without a fake Intent", () => {
    const grammar: WorshipArrangementGrammar = {
      grammarId: "worship-arrangement-grammar-v1", grammarVersion: "not-accepted", grammarConfigDigest: digest,
      planSection: () => ({ status: "blocked", diagnostics: [] }),
      planPhrase: () => ({ status: "blocked", candidateTrace: [], diagnostics: [] }),
    };
    expect(grammar.planSection({} as never)).toEqual({ status: "blocked", diagnostics: [] });
    expect("sectionIntent" in grammar.planSection({} as never)).toBe(false);
  });

  it("keeps section intensity only on Section Intent and trace out of Phrase Intent", () => {
    const plan: ArrangementIntentPlan = {
      stage: "intent", presetId: "simple", intentInputDigest: digest, effectiveChordTimelineDigest: digest, sourceLeadAtomizationDigest: digest, effectiveConfigDigest: digest, presetProfileVersion: "v", presetProfileDigest: digest, grammarId: "worship-arrangement-grammar-v1", grammarVersion: "v", plannerVersion: "v", grammarConfigDigest: digest, plannerConfigDigest: digest, diagnosticRegistryVersion: "v", diagnosticRegistryDigest: digest,
      sectionIntents: [{ id: "si:0", sectionOccurrenceId: "so:0", presetId: "simple", intensityTarget: { participationCoverageBp: 0 as never, harmonicDivergenceCoverageBp: 0 as never, exactlyTwoPitchCoverageBp: 0 as never, exactlyThreePitchCoverageBp: 0 as never, maxHarmonyAttackRatioBp: 0 as never, registerSpreadRange: [0, 0], maxActiveVoiceCount: 1 }, grammarRuleIds: [] }],
      phraseIntents: [{ id: "pi:0", phraseId: "ph:0", presetId: "simple", sectionIntentId: "si:0", textureId: "UNISON", trackRoles: [], lyricPolicy: "same-lyrics", cadencePolicy: "open", grammarRuleIds: [] }], intentPlanDigest: digest,
    };
    expect(validateIntentAuthority(plan)).toBe(true);
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

