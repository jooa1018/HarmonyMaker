# WAG v1.0.1 Implementation Resolution r1

## Status and scope

This document is a **normative post-freeze implementation resolution** for HarmonyMaker WAG v1.0.1. It closes implementation ambiguities discovered after the frozen package was installed and verified, without altering the frozen WAG v1.0.1 artifacts or changing the selected v0 musical strategy.

Authority order for the subjects explicitly resolved below is:

1. `docs/HARMONYMAKER_SPEC_v3.1.5.md` hard product/domain invariants;
2. this resolution, **only for the enumerated resolution IDs below**;
3. `docs/WORSHIP_ARRANGEMENT_GRAMMAR_v1.md`;
4. `src/grammar/worship-arrangement-grammar-v1.0.1.canonical.json`;
5. evidence-only research material.

Outside the enumerated resolution IDs, the frozen WAG v1.0.1 contract remains unchanged and authoritative.

This resolution does **not** change:

```text
semanticVersion = 1.0.1
grammarVersion = grammar-v1.0.1
WAG config semantic digest = 5a71f18d5687c4884f8dad209c162f39b8152c1e3030fc4af4b429c7c41f4482
preset profile semantic digest = ae0fce2af71b10e7f387521b22fe737cb840f02881b95121761b2953154cd681
diagnostic baseline semantic digest = 96e396a1fdb97a9cc9eba2b21a20c709cd5a96285126bfba1a406cba2f42ef70
diagnostic extension semantic digest = aee570a5fc6110107979c40708ebb0b48f645e23853a0e75084854c2cd6ce794
full 99-code diagnostic registry digest = 0bdb9f5067cba55dad165d3679460a04f21e98b450a4624fa21eca1ffa3dcc77
```

No frozen package file is to be edited to apply this resolution.

---

# R0 — Semantic-digest recomputation authority

The frozen package is not an independent replacement for the accepted repository's canonical codec. WAG v1.0.1 uses the accepted `canonical-json-v1` implementation from the canonical domain.

For implementation and CI, the following projections are exact:

```text
WAG config semantic digest
= semanticDigest(entire parsed worship-arrangement-grammar-v1.0.1.canonical.json payload)

diagnostic baseline semantic digest
= semanticDigest(entire parsed wag-v1-diagnostic-baseline.canonical.json payload)

diagnostic extension semantic digest
= semanticDigest(entire parsed wag-v1-diagnostic-extension.canonical.json payload)

preset profile semantic digest
= semanticDigest({
    projectionSchema: "hm-preset-profile-registry-v1",
    presetProfileVersion: "preset-profile-v2-b15-v0",
    profiles: [simple, standard, full]
  })

full diagnostic registry digest
= semanticDigest({
    registryVersion: "diagnostic-registry-v3-wag1-v0",
    entries: exact 94 baseline + exact 5 extension definitions sorted lexically by code
  })
```

The accepted repository implementation of the canonical codec, not an independently invented serializer, is the implementation authority. The codec remains the v3.1.5 rule: versioned semantic projection → RFC-8785-family canonical JSON → UTF-8 → SHA-256 → lowercase 64-hex.

This closes the implementability concern without changing any frozen digest.

---

# R1 — Exact `registerSpreadRange` derivation

`SectionIntensityTarget.registerSpreadRange` is a diagnostic target only. It MUST NOT select notes, roles, activity, anchors, or candidates.

The exact derivation is:

1. If `effectiveConfig.maxHarmonyTracks === 0`, return `[0, 0]`.
2. Evaluate every section decision position where the Lead has a sounding pitch, the position is inside a confirmed phrase of the section, the current `EffectiveChordTimeline` span has `status="ok"`, and the relevant generated track assignments are valid.
3. Because Section Intent precedes persistent Phrase role selection, enumerate every role mapping that is structurally eligible under the same performer/track cardinality rules used by §8.2, **without using a persisted downstream role winner**:
   - one generated track: evaluate each feasible `Upper` and `Lower` hypothesis for that assigned track;
   - two generated tracks: evaluate each feasible one-to-one `{Upper, Lower}` bijection.
4. For each track in a mapping, enumerate every exact `ParsedChord.tones` realization that satisfies canonical spelling, that performer's `hardRange`, and strict placement relative to the Lead.
5. Form the Cartesian product containing exactly one generated pitch for every active generated track in that mapping.
6. For each product, include the Lead pitch and compute:

```text
spreadSemitones = max({leadMidi, generatedMidi...}) - min({leadMidi, generatedMidi...})
```

7. The section range is:

```text
[min(all evaluable spreadSemitones), max(all evaluable spreadSemitones)]
```

8. If no evaluable combination exists, return `[0, 0]`.
9. This preview is intentionally computed before continuity, previous-pitch leap pruning, Activity/Anchor/Solver locks, aesthetic ranking, marginal admission, and pair screening.
10. Input array order, display names, and object insertion order must not affect the result.

This interpretation makes one-track spread equal to the Lead-to-harmony sounding distance and two-track spread equal to the full Lead-anchored register width, while avoiding circular dependence on the later persisted Phrase role decision.

---

# R2 — Exact v0 `cadencePolicy` derivation

WAG v1.0.1 does not perform phrase-final refinement, cadence-specific pitch reranking, or lookahead. Therefore `PhraseArrangementIntent.cadencePolicy` is deterministic persisted metadata and MUST NOT change local selector ranking, Activity feasibility, Anchor tone selection, Solver pitch selection, marginal admission, or pair admission in v0.

For a confirmed `PhraseRegion`, derive the value structurally as follows:

```text
if phrase.end < containingSectionOccurrence.end:
    cadencePolicy = "open"
else if phrase.end != containingSectionOccurrence.end:
    invalid phrase/section coverage; use existing coverage diagnostic
else if containing SectionDefinition.type == "ending"
     OR containing SectionOccurrence.variant == "final":
    cadencePolicy = "closed"
else if the immediately following SectionOccurrence in canonical performance order
        exists
        AND following.sectionDefinitionId == containing.sectionDefinitionId:
    cadencePolicy = "looping"
else:
    cadencePolicy = "open"
```

Rules:

- exact canonical range comparison is used; no float comparison;
- `closed` has priority over `looping` for a `final`/`ending` occurrence;
- section labels, lyric text, chord quality, emotional inference, display names, and current wall-clock position are not inputs;
- if there is no following occurrence, non-final/non-ending sections remain `open` rather than being musically guessed as closed;
- future phrase-final refinement may use this field only under a later versioned contract; WAG v1.0.1 does not.

This closes Intent digest determinism without changing current note-selection semantics.

---

# R3 — One-singer placement-role ownership

For exactly one assigned generated-harmony singer, §8.2 Intent role preview is the **sole automatic placement-role selection authority**.

The exact lifecycle is:

1. Intent evaluates both `Upper` and `Lower` hypotheses when structurally possible.
2. Each hypothesis is dry-run in phrase performance order with the frozen pure selector and the exact §8.2 preview tuple:

```text
blockingDecisionCount
localRestDurationBp
hardOnlyRangeDurationBp
preferredMissDurationBp
preferredLeapExcessSemitoneSum
totalMotionSemitones
roleChangeCount
canonicalTrackRoleTuple
```

3. The lexicographically best eligible hypothesis is stored in `PhraseArrangementIntent.trackRoles`.
4. That persisted role is the downstream semantic authority for Activity, Anchor, Solver, marginal generation, validation, rendering, playback, and export.
5. §17.3's phrase "best standalone result" means **the best standalone-capable role hypothesis determined by the §8.2 Intent preview**. It does not authorize a second post-generation Upper-vs-Lower role election.
6. Downstream locks may legitimately reduce coverage or block the chosen role at their owning stage. They do not silently trigger an automatic role swap. Such a swap requires regeneration from an Intent change/lock, not downstream repair.
7. §19.2 `placementRole ordinal` remains a deterministic tie-break where more than one retained marginal is legitimately being ordered, but it does not override the persisted Intent role for the one-singer automatic path.

This preserves stage ownership and prevents downstream candidate quality from mutating Intent semantics.

---

# R4 — Lead-only sibling and H1-required truthfulness

The frozen sibling list and failure-honesty rules are reconciled as follows.

## Harmony not expected

When `harmonyExpectation = none`:

```text
Lead-only sibling = retained
candidateStatus = complete
default eligibility = allowed
```

## H1 required

When `harmonyExpectation = H1-required`:

```text
Lead-only sibling = retained as a projection/practice sibling
candidateStatus = partial
WAG_V1_PARTIAL_REQUIRED_COVERAGE = candidate-local
complete/default eligibility = forbidden
```

A retained complete H1 or pair sibling is not poisoned by the candidate-local partial diagnostic on the Lead-only sibling.

If no complete H1 exists but a hard-valid Lead-only projection exists, the generation result may be `partial` only when the authoritative result-state rules permit a partial candidate. It MUST NOT be promoted to `complete` as a fake harmony repair.

If a current stage lock requires generated harmony and no hard-valid required candidate exists, existing blocking/failure rules apply; Lead-only MUST NOT hide the blocker.

Lead-only remains useful for practice/projection switching without satisfying a requirement for independent harmony.

---

# R5 — Primary-pulse definition is inherited exactly from v3.1.5

`primary pulse` is not an open WAG policy decision. WAG v1.0.1 inherits the exact Core-generation grouping rule from v3.1.5:

```text
4/4 with beatGroups [1,1,1,1]
→ primary pulse = 1 quarter-note unit

6/8 with beatGroups [3,3]
→ primary pulse = 3/2 quarter-note units (dotted quarter)
```

Other meter/grouping combinations may be imported/displayed but are blocked from Core generation under the authoritative product rules. All perceptibility and pair-overlap comparisons use exact `Fraction` arithmetic.

---

# R6 — Duplicate semantic candidate identity

For WAG v1.0.1, two local candidates are semantic duplicates only when their complete Source-tone and spelled-pitch semantics are equal.

The duplicate identity is equivalent to:

```text
(
  ChordToneSpec.degree,
  ChordToneSpec.alteration,
  ChordToneSpec.role,
  ChordToneSpec.origin,
  SpelledPitch.step,
  SpelledPitch.alter,
  SpelledPitch.octave
)
```

Sounding MIDI equality alone is insufficient. Two enharmonically different exact Source meanings remain distinct candidates when their `ChordToneSpec` and/or spelled pitch differ. This preserves Source spelling authority. Candidate ordering remains governed by the frozen rank tuple and final tie-break; this resolution does not add an enharmonic reranker.

---

# R7 — Durable rest-decision evidence

`LOCAL_REST_HARD_IMPOSSIBILITY` remains a candidate/reason code, not a new `DiagnosticCode`.

Whenever an automatic generated track materializes a local hard-impossibility rest, the implementation must preserve non-musical decision evidence sufficient to diagnose the rest even when verbose selector tracing is disabled. At minimum the evidence must retain:

```text
exact range
trackPlanId
placementRole
reason = LOCAL_REST_HARD_IMPOSSIBILITY
continuityState before the decision
hard-legal candidate count (= 0)
Source-tone spelling exclusion count
```

This evidence is support/debug provenance, not musical selection authority, and is excluded from candidate musical content digests and tie-breaks.

No diagnostic-registry extension is added by this resolution.

---

# R8 — Independent Validator implementation boundary

The Segment B Validator must be semantically independent from generation admission logic.

It may reuse canonical low-level primitives such as exact Fraction operations, pitch arithmetic, Source chord/timeline access, and canonical codecs. It must not establish validity by calling or trusting:

```text
selectLocalHarmonyDecision()
generator marginal-admission helpers
pair-screen admission helpers
generator-produced pass/fail booleans
```

Validator tests must include intentionally corrupted candidates proving rejection of at least Source-tone illegality, range violation, placement/crossing violation, timing divergence, dropout mismatch, and full-stack-only repair.

This is an implementation independence requirement, not a second musical grammar.

---

# R9 — Required fixture materialization

The fixture IDs and assertions in frozen §27 remain normative test cases. Segment B must materialize reusable canonical inputs and exact expected assertions in repository test/fixture code before declaring Segment B complete.

A separate pre-frozen JSON golden corpus is not required to begin implementation, but the implementation must not satisfy a fixture by inventing an expectation that contradicts the product/WAG invariants.

At minimum every frozen named fixture and every additional Segment-B lifecycle/LASI/failure case used for the Segment B exit gate must have:

```text
stable fixture ID
canonical input construction
explicit expected semantic outcome
exact expected status/reason/diagnostic where applicable
```

Research-only fixture/event types must not become production authority.

---

# Explicit non-changes after review

The following review proposals are **not adopted** in WAG v1.0.1 r1 because they would change musical selection semantics rather than clarify an ambiguity:

```text
- moving rangeBandOrdinal ahead of the frozen 3rd/6th family ordinal
- adding repeated-directed-relation run length to the local rank tuple
- adding one-step or any future lookahead
- adding a reentry hard-leap cap
- changing role-directed register preference
- adding a sixth WAG diagnostic code for downstream role degradation
- introducing B3/beam/K-best/phrase-wide optimization
- enabling generated NCT or phrase-final refinement
```

These remain deferred or evidence-driven future-version topics. A concrete product failure corpus is required before reopening them.

---

# Segment B application gate

Segment B must start from the green Segment A branch state that contains this resolution. Before Segment B implementation begins, verify:

```text
- frozen six WAG artifacts remain byte-identical
- frozen semantic digests remain unchanged
- full registry remains exactly 99 codes
- Segment A local selector tests remain unchanged unless a genuine implementation bug is found
- this resolution file is present
- CI is green
```

Segment B must implement R1–R9 where applicable as part of its Intent/Activity/Anchor/Solver/marginal/pair/assembly/Validator work.

No v1.0.2 bump is authorized by this resolution.