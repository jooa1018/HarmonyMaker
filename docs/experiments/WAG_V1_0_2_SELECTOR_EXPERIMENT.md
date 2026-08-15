# HarmonyMaker WAG v1.0.2 Selector Experiment
## Pre-registered, production-isolated experiment for E1 / E3 / E4

> **Status:** EXPERIMENT DESIGN — NOT A PRODUCT CONTRACT  
> **Repository:** `jooa1018/HarmonyMaker`  
> **Experiment branch:** `codex/wag-v102-selector-experiment`  
> **Exact branch base:** `a32b5eaf99ba6d1b73f0d0202d4580c912a26b76`  
> **Current production grammar:** WAG v1.0.1  
> **Current production selector:** `src/grammar/local-selection.ts`  
> **Post-freeze clarification:** `docs/implementation/WAG_v1.0.1_IMPLEMENTATION_RESOLUTION_r1.md`  
> **Supplied experiment artifact:** `HarmonyMaker_WAG_v1.0.2_Selector_Experiment.md`  
> **Required installed path:** `docs/experiments/WAG_V1_0_2_SELECTOR_EXPERIMENT.md`

---

# 0. Purpose

This experiment answers one narrow question:

> Do three conservative selector changes produce enough measurable and audible improvement to justify issuing WAG v1.0.2 **before Segment B begins**?

The three changes are:

```text
E1 — avoid hard-range-only tessitura when a comfortable legal alternative exists
E3 — avoid a current choice that makes the immediately next decision hard-infeasible
E4 — prefer a closer legal re-entry after a rest
```

The experiment does **not** evaluate or authorize:

```text
B3
beam search
phrase-wide dynamic programming
generated NCT
phrase-final refinement
stable color
joint Upper/Lower optimization
learned selection
new product scope
```

The frozen v1.0.1 contract, config, diagnostic registry, selector, and Segment A branch must remain unchanged during the experiment.

---

# 1. Why this experiment is required

The current frozen selector deliberately uses:

```text
3rd/6th family before rangeBand
future lookahead = none
no re-entry leap preference after continuity reset
```

These choices are deterministic and valid, but they create three plausible quality risks:

1. a legal but hard-only 3rd/6th can beat a comfortable contextual chord tone;
2. a locally best pitch can force an avoidable rest at the next decision;
3. after a rest, the line can re-enter far from the last sounding pitch.

These are hypotheses, not established defects. A contract bump is permitted only if the experiment produces both:

```text
automated mechanism evidence
+
blind listening evidence
```

---

# 2. Hard isolation rules

## 2.1 Branch

Work only on:

```text
codex/wag-v102-selector-experiment
```

The branch must start from:

```text
a32b5eaf99ba6d1b73f0d0202d4580c912a26b76
```

Do not commit experiment code to:

```text
codex/harmonymaker-v0-segment-a
```

## 2.2 Production authority

Do not modify:

```text
docs/WORSHIP_ARRANGEMENT_GRAMMAR_v1.md
docs/WORSHIP_ARRANGEMENT_GRAMMAR_v1.freeze.json
src/grammar/worship-arrangement-grammar-v1.0.1.canonical.json
src/grammar/wag-v1-diagnostic-baseline.canonical.json
src/grammar/wag-v1-diagnostic-extension.canonical.json
src/grammar/local-selection.ts
src/grammar/authority.ts
src/app/algorithm-version-registry.ts
```

Do not change any frozen SHA or semantic digest.

Do not create `grammar-v1.0.2` during this experiment.

## 2.3 Production integration

Do not begin Segment B.

Do not implement production Intent, Activity, Anchor, Solver, marginals, pair screening, Validator, accompaniment, Product Core, or OMR Core.

All experiment code must remain under an explicit experiment/review namespace and absent from production navigation.

## 2.4 Research reuse

PR #7 at:

```text
79dec6efbb555d2dad074b0a29ada600c4051c1b
```

may be inspected only for:

- project-original rights-safe musical fixture data;
- band/Lead/Harmony playback-projection ideas;
- heard-complete playback validity;
- blinded review UI patterns;
- evidence JSON export.

Do not import its `ResearchFixture`, `ResearchArrangement`, arranger, or research domain as production authority. Re-express any reused musical data through experiment-local adapters over accepted canonical domain primitives.

---

# 3. Experiment variants

Implement a small experiment-only selector adapter. The production selector remains the source of the legal candidate set and the exact v1.0.1 baseline rank tuple.

Recommended location:

```text
src/experiments/wag-v102/
```

Recommended API:

```ts
type SelectorExperimentVariant =
  | "V0_FROZEN"
  | "V1_HARD_ONLY_TESSITURA"
  | "V2_NEXT_FEASIBILITY"
  | "V3_REENTRY_DISTANCE"
  | "V4_HARD_ONLY_PLUS_NEXT"
  | "V5_HARD_ONLY_PLUS_NEXT_PLUS_REENTRY";
```

Every variant must use the exact hard-legal candidates returned by the frozen production selector. A variant may only rerank those candidates. It may not create a new pitch, tone, rest, NCT, role, or activity decision.

## 3.1 V0 — exact frozen control

```text
V0_FROZEN
```

Requirements:

- call the exact production `selectLocalHarmonyDecision()`;
- preserve exact status, selected candidate, candidate order, rank tuple, and exclusions;
- on every existing selector test input, V0 must be semantic-equal to production;
- V0 parity is a blocking experiment gate.

## 3.2 E1 — hard-only tessitura avoidance

```text
V1_HARD_ONLY_TESSITURA
```

Derived ordinal:

```text
hardOnlyRangeOrdinal =
  1 if candidate is inside hardRange but outside comfortableRange
  0 otherwise
```

This does not distinguish preferred from comfortable. It only strongly avoids `rangeBand=2`.

Exact experimental order:

### Lead is a Source chord tone

```text
hardOnlyRangeOrdinal
then exact frozen v1.0.1 rank tuple
```

### Lead is a Source NCT

Preserve legal-continuation and low-motion authority first:

```text
frozen legalContinuationOrdinal
frozen lowMotionOrdinal
hardOnlyRangeOrdinal
then the remaining frozen tuple beginning at thirdOrSixthFamilyOrdinal
```

Consequences:

- a comfortable contextual tone may beat a hard-only 3rd/6th;
- a legal continuation or low-motion Source chord tone is not displaced merely because it is hard-only;
- hardRange remains a hard filter;
- preferred-tessitura misses remain the existing soft ordering;
- no new weight or floating-point score is introduced.

## 3.3 E3 — immediate next-decision feasibility guard

```text
V2_NEXT_FEASIBILITY
```

For each current hard-legal pitch candidate, calculate:

```text
immediateDeadEndOrdinal =
  1 if choosing this pitch makes the immediately next applicable decision
    have zero hard-legal pitch candidates
  0 otherwise
```

Exact restrictions:

1. Inspect exactly one next canonical decision; never recurse beyond it.
2. The next-decision feasibility call uses the exact frozen v1.0.1 selector and hard filters.
3. Do not use V2 recursively for the probe.
4. The probe asks only whether at least one next pitch is hard-legal. It does not optimize or score the next note.
5. Set `previousSoundingPitch` to the current candidate and `continuityState="continuous"` only when the next decision is an ordinary continuous decision in the same phrase/track.
6. Use ordinal `0` for every current candidate when:
   - there is no next decision;
   - the next decision is outside the phrase;
   - the next decision is a Lead rest;
   - the next chord is explicit N.C.;
   - Activity/fixture policy forces a rest;
   - a canonical phrase reset makes the next sounding decision initial/re-entry;
   - the next decision is otherwise not baseline-eligible.
7. If every current candidate has ordinal `1`, preserve the frozen current order.
8. Exact current rank:

```text
immediateDeadEndOrdinal
then exact frozen v1.0.1 rank tuple
```

This is a one-step hard-feasibility guard, not phrase optimization.

## 3.4 E4 — re-entry distance preference

```text
V3_REENTRY_DISTANCE
```

Experiment sequence state may retain:

```text
lastSoundingPitchBeforeRest
```

for diagnostic/ranking use even though production v1.0.1 resets continuous leap authority at rest.

Derived value:

```text
reentryDistanceSemitones =
  abs(candidateMidi - lastSoundingPitchBeforeRestMidi)
```

Use `0` for all candidates when:

- the decision is not `reentry`;
- there is no prior sounding pitch;
- the decision is an initial phrase entry.

This is soft preference only:

- no hard re-entry cap;
- no continuous-hard-leap change;
- no candidate deletion.

Insert the value after range/preferred-leap criteria and before Lead-proximity/tone/register tie-break criteria.

### Lead chord-tone conceptual order

```text
third/6th family and E1 guard as applicable
source color
range band
preferred-leap fields
reentryDistanceSemitones
lead proximity
remaining frozen fields
```

### Lead Source-NCT conceptual order

```text
legal continuation
low motion
third/6th family and E1 guard as applicable
source color
range band
preferred-leap fields
reentryDistanceSemitones
lead proximity
remaining frozen fields
```

## 3.5 Cumulative variants

```text
V4_HARD_ONLY_PLUS_NEXT
= E1 + E3

V5_HARD_ONLY_PLUS_NEXT_PLUS_REENTRY
= E1 + E3 + E4
```

For cumulative ordering:

```text
immediateDeadEndOrdinal
then the applicable E1 rank
with reentryDistance inserted at the E4 location for V5
```

No feature may be enabled implicitly. Every variant ID must map to an exact declared feature set.

---

# 4. Candidate and sequence trace

Each experimental decision must export:

```text
fixture/case ID
decision ordinal
exact range
Lead pitch
Source chord span ID and canonical symbol
placement role
performer profile digest or canonical projection
continuity state
last sounding pitch before rest, if any
production V0 candidate list and rank tuples
experimental extra ordinals per candidate
selected candidate per variant
whether the next-feasibility probe was applicable
next-feasibility probe result
rest reason, if any
```

Experiment traces are non-production evidence and do not enter musical production digests.

No variant is allowed to hide a hard-filtered candidate as if it were legal.

---

# 5. Corpus construction

Use only project-original, synthetic, or user-owned material. Do not add copyrighted worship melodies to the repository.

## 5.1 Source corpus

Port the musical data—not the research types or arranger—from the PR #7 rights-safe fixtures where useful, including representative cases such as:

```text
hm-original-major-stepwise-v0
hm-original-minor-phrase-v0
hm-original-lead-nct-passing-v0
hm-original-held-no-common-upper-v0
hm-original-held-no-common-lower-v0
hm-original-hard-range-edge-v0
hm-original-sus-omission-v0
hm-original-add9-v0
```

Add experiment-specific project-original cases only where the existing corpus cannot exercise a mechanism.

## 5.2 Required mechanism fixtures

Create stable canonical experiment IDs:

```text
hm-v102-e1-hard-only-upper-v0
hm-v102-e1-hard-only-lower-v0
hm-v102-e3-dead-end-upper-v0
hm-v102-e3-dead-end-lower-v0
hm-v102-e4-reentry-upper-v0
hm-v102-e4-reentry-lower-v0
hm-v102-neutral-upper-v0
hm-v102-neutral-lower-v0
```

Required properties:

### E1 fixtures

- V0 chooses a hard-only candidate because of the frozen family order;
- V1 chooses a comfortable hard-legal candidate;
- both candidates respect Source chord, placement, and hard leap;
- neither output adds a rest.

### E3 fixtures

- V0's selected current pitch causes the next eligible decision to have zero hard-legal pitches;
- V2 selects a different current hard-legal pitch;
- the next eligible decision then has at least one hard-legal pitch;
- the avoidable mid-phrase rest disappears;
- no lookahead beyond one decision is used.

### E4 fixtures

- a real rest occurs before re-entry;
- V0 and V3 have at least two otherwise-comparable re-entry candidates;
- V3 chooses the closer re-entry;
- no candidate is hard-pruned solely for re-entry distance.

### Neutral fixtures

- all feature variants must return the same semantic music;
- they detect unnecessary perturbation.

## 5.3 Canonical selection against cherry-picking

Build a deterministic candidate pool from:

```text
rights-safe fixture
× applicable Upper/Lower placement
× Simple/Standard/Full config
× fixed performer-profile variants
```

Fixed performer-profile variants:

```text
NEUTRAL_WIDE
UPPER_EDGE_NARROW_COMFORTABLE
LOWER_EDGE_NARROW_COMFORTABLE
```

Sort the pool by:

```text
fixture ID
placement ordinal: upper, lower
preset ordinal: simple, standard, full
performer-profile ID
```

For each isolated feature, select the first four canonical eligible cases that actually produce a V0-vs-feature difference, with at least one Upper and one Lower case. If fewer than four natural cases exist, use the named mechanism fixtures to fill the deficit and report the count separately.

Do not manually choose only cases where the challenger sounds favorable.

---

# 6. Automated metrics

For every case and variant calculate at minimum:

```text
generated sounding decision count
independent sounding duration
local rest count and duration
avoidable mid-phrase rest count
hard-only range decision count and duration
comfortable-range miss count and duration
preferred-tessitura miss count and duration
max continuous leap
preferred leap excess
re-entry distance sequence
maximum re-entry distance
3rd/6th duration
longest repeated directed 3rd/6th run
Source-chord respect
hard-range violations
hard-leap violations
placement/crossing violations
deterministic semantic experiment digest
number and exact positions changed from V0
```

`longest repeated directed 3rd/6th run` is diagnostic only. E2 is not an active variant in this experiment.

---

# 7. Automated hard gates

Every variant must pass:

```text
exact Source chord-tone membership
sus/omit/no3/alter/add/extension preservation
slash bass does not expand the vocal vocabulary
explicit N.C. silence
performer hard range
strict placement
continuous hard leap
no new lyric onset
held-syllable boundary integrity
direct Upper/Lower semantics
determinism
```

Additional gates:

## V0 parity

Across all existing production selector tests and experiment fixtures:

```text
V0 result == exact production selector result
```

Any V0 mismatch blocks the experiment.

## E1 mechanism

Across the full pool:

```text
V1 hard-only duration <= V0 hard-only duration
V1 rest count == V0 rest count
```

Both named E1 mechanism fixtures must improve hard-only usage.

## E3 mechanism

Across the full pool:

```text
V2 avoidable mid-phrase rest count <= V0
```

Both named E3 fixtures must remove the designated avoidable rest. V2 must not create a new mid-phrase rest in a neutral control.

## E4 mechanism

Across the full pool:

```text
V3 rest positions == V0 rest positions
```

Both named E4 fixtures must reduce the designated re-entry distance. V3 must not introduce a hard-range, placement, or continuous-leap violation.

## Determinism

Run 101 repetitions for:

- every named mechanism fixture;
- every blinded listening item;
- all six variants.

Each case/variant must produce one experiment semantic digest.

---

# 8. Listening harness

Recommended hidden route:

```text
/review/wag-v102-selector-experiment
```

It must not appear in production navigation.

Reuse only the proven review/playback ideas from PR #7:

- `heard-complete` eligibility;
- band + Lead + harmony projection;
- identical Source-chord accompaniment across variants;
- playback-context reset;
- audibility invalidation;
- evidence JSON export.

## 8.1 Pairwise comparisons

Do not ask the listener to rank six variants at once.

Use these isolated comparisons:

```text
E1: V0_FROZEN vs V1_HARD_ONLY_TESSITURA
E3: V0_FROZEN vs V2_NEXT_FEASIBILITY
E4: V0_FROZEN vs V3_REENTRY_DISTANCE
```

After isolated results exist, include global comparisons:

```text
V0_FROZEN vs V4_HARD_ONLY_PLUS_NEXT
V0_FROZEN vs V5_HARD_ONLY_PLUS_NEXT_PLUS_REENTRY
```

## 8.2 Blindness

Before a vote:

- show opaque labels `A` and `B` only;
- randomize left/right mapping per comparison;
- conceal variant ID, score, note names, trace, metrics, and construction;
- use identical Lead, tempo, Source chord accompaniment, renderer, instrument program, gain, and playback projection;
- expose the mapping only after the response has been recorded or in the exported administrator/reveal section.

Use a deterministic per-session seed so reload does not silently remap an answered comparison.

## 8.3 Required playback

Required vote mix:

```text
BAND + LEAD + HARMONY
```

Optional post-vote diagnostic mixes:

```text
LEAD + HARMONY
HARMONY ONLY
BAND ONLY
```

Both A and B must reach `heard-complete` before voting is enabled.

A stopped-early, no-audio, glitch, or context-changed attempt is invalid.

## 8.4 Response

For each comparison collect:

```text
preference:
  strongly A
  slightly A
  tie
  slightly B
  strongly B

primary reason:
  singability/tessitura
  continuity/no dropout
  re-entry naturalness
  harmonic fit
  line naturalness
  no meaningful difference
  other

confidence:
  low
  medium
  high

optional short note
```

Do not reveal notation or metrics until the vote is locked.

## 8.5 Consistency controls

Include:

- one duplicate E1 comparison with A/B order reversed;
- one duplicate E3 comparison with A/B order reversed;
- at least two neutral controls;
- no more than 18 required comparisons in one listening session.

A single listener is acceptable for directional development evidence, but the report must state that it is not a population-level preference study. If three or more listeners participate, preserve anonymous per-listener responses and aggregate by comparison majority.

---

# 9. Pre-registered decision rules

No finding may be upgraded because the implementer prefers a new algorithm.

## 9.1 Feature cannot be adopted when

Any of the following rejects a feature:

```text
hard invariant regression
V0 parity failure
nondeterminism
Source-chord vocabulary change
new rest in a neutral control
mechanism fixture failure
fewer than four valid isolated listening comparisons
inconsistent hidden duplicate responses
```

## 9.2 Isolated listening evidence

Map the five-point response to challenger-oriented points:

```text
strongly baseline   = -2
slightly baseline   = -1
tie                 = 0
slightly challenger = +1
strongly challenger = +2
```

A feature earns `LISTENING_SUPPORT` only when:

1. all automated mechanism and safety gates pass;
2. at least four valid targeted isolated comparisons exist;
3. challenger is preferred in at least three of four targeted comparison decisions;
4. there is no `strongly baseline` result on a targeted comparison;
5. mean challenger-oriented score across targeted comparisons is at least `+0.5`;
6. hidden duplicates preserve the same preference direction, allowing `tie` as adjacent only;
7. neutral controls show no audible or semantic regression.

With multiple listeners, first derive each comparison's median/majority response, then apply the same case-level rule.

These thresholds are an engineering promotion gate, not a claim of statistical significance.

## 9.3 Automated feature requirements

### E1

In addition to listening support:

```text
both named E1 fixtures reduce hard-only usage
full-pool hard-only duration does not increase
rest count does not increase
```

### E3

In addition to listening support:

```text
both named E3 fixtures remove the avoidable next-decision rest
full-pool avoidable mid-phrase rest count does not increase
no more than one-decision feasibility is consulted
```

### E4

In addition to listening support:

```text
both named E4 fixtures reduce re-entry distance
rest positions do not change
no hard re-entry cap is introduced
```

## 9.4 Overall cumulative gate

A cumulative v1.0.2 candidate must include only isolated features that passed their own gates.

Compare the resulting cumulative candidate against V0 on at least six representative cases spanning:

```text
Upper and Lower
major and minor
4/4 and 6/8 where available
targeted and neutral cases
```

Promotion requires:

```text
cumulative preferred in at least 4 cases
V0 preferred in at most 1 case
no strong V0 preference
no automated metric/hard-invariant regression
```

## 9.5 Final experiment status

Return exactly one:

```text
KEEP_WAG_V1_0_1
RECOMMEND_WAG_V1_0_2_WITH_E1
RECOMMEND_WAG_V1_0_2_WITH_E3
RECOMMEND_WAG_V1_0_2_WITH_E4
RECOMMEND_WAG_V1_0_2_WITH_<FEATURE_COMBINATION>
EXPERIMENT_INCONCLUSIVE
EXPERIMENT_BLOCKED
```

No v1.0.2 contract is created automatically.

---

# 10. Required implementation files

Recommended structure:

```text
src/experiments/wag-v102/variants.ts
src/experiments/wag-v102/sequence-runner.ts
src/experiments/wag-v102/fixtures.ts
src/experiments/wag-v102/metrics.ts
src/experiments/wag-v102/evidence.ts
src/experiments/wag-v102/*.test.ts

src/app/review/wag-v102-selector-experiment/page.tsx
src/app/review/wag-v102-selector-experiment/ReviewClient.tsx
src/app/review/wag-v102-selector-experiment/review.module.css

docs/experiments/WAG_V1_0_2_SELECTOR_EXPERIMENT_REPORT.md
```

Generated listening exports should be downloaded by the evaluator. Do not commit personal response data by default.

---

# 11. Implementation sequence

## Phase X0 — Preflight

- copy the supplied `HarmonyMaker_WAG_v1.0.2_Selector_Experiment.md` byte-identically to `docs/experiments/WAG_V1_0_2_SELECTOR_EXPERIMENT.md` and record its SHA-256;
- verify exact experiment branch/base;
- verify CI green;
- verify frozen six artifacts and all semantic digests unchanged;
- read current selector and its tests;
- inspect PR #7 only for bounded fixture/playback ideas;
- record baseline test counts.

## Phase X1 — Experiment adapter

- implement V0 parity adapter;
- implement V1, V2, V3, V4, V5;
- keep production selector untouched;
- add exact unit tests for rank construction and one-step probe boundaries.

## Phase X2 — Corpus and metrics

- port rights-safe musical data through experiment-local canonical adapters;
- add named mechanism and neutral fixtures;
- implement deterministic pool selection;
- implement metrics and automated gates;
- run focused tests.

## Phase X3 — Blind listening route

- implement pairwise opaque A/B playback;
- add heard-complete validity;
- hide construction until vote;
- add response and evidence export;
- add duplicate/neutral controls;
- run browser smoke.

## Phase X4 — Verification and checkpoint

Run:

```text
npm ci
npm run typecheck
npm run lint
npm test
npm run build
git diff --check
```

Also run:

```text
V0 parity
all automated hard gates
101-repeat selected-case determinism
browser route smoke
A/B mapping stability
no frozen artifact change
no production selector change
```

Commit and push the experiment branch.

Stop at:

```text
WAG_V1_0_2_EXPERIMENT_READY_FOR_BLIND_LISTENING
```

Do not start Segment B or issue v1.0.2.

---

# 12. Deliverable before listening

The implementation report must contain:

```text
branch and final SHA
base SHA
changed-file list
proof frozen files unchanged
proof production selector unchanged
variant definitions
fixture/corpus manifest
automated metric table
hard-gate results
V0 parity evidence
determinism evidence
route URL
exact listening instructions
known limitations
```

The route must export a JSON bundle containing:

```text
experiment schema/version
experiment branch SHA
case manifest
blind mappings
valid playback attempts
locked responses
variant metrics
variant traces
automated gate results
```

The evaluator sends that JSON back for final analysis.

---

# 13. Goal text for Codex

Use this as the Goal:

```text
Build and validate the isolated HarmonyMaker WAG v1.0.2 selector experiment defined in the
supplied HarmonyMaker_WAG_v1.0.2_Selector_Experiment.md artifact. First install that artifact
byte-identically at docs/experiments/WAG_V1_0_2_SELECTOR_EXPERIMENT.md and use the installed
document as the experiment authority.

Work only on codex/wag-v102-selector-experiment from
a32b5eaf99ba6d1b73f0d0202d4580c912a26b76.

Preserve WAG v1.0.1 production authority and Segment A exactly.
Do not modify the frozen contract/config/diagnostics, production selector, or algorithm versions.
Do not begin Segment B.

Implement the pre-registered V0–V5 variants, canonical rights-safe corpus,
automated metrics/gates, and blind pairwise band-context listening route.
Stop only at WAG_V1_0_2_EXPERIMENT_READY_FOR_BLIND_LISTENING with a green checkpoint,
or at a proven experiment blocker.
```

---

# 14. First execution message for Codex

```text
Execute the complete supplied HarmonyMaker_WAG_v1.0.2_Selector_Experiment.md plan.
First copy it byte-identically to
docs/experiments/WAG_V1_0_2_SELECTOR_EXPERIMENT.md and record the SHA-256.

Important execution posture:

- This is a bounded selector experiment, not product implementation.
- Use the production selector only as an immutable baseline/candidate-space authority.
- Do not edit frozen WAG v1.0.1 bytes or digests.
- Do not edit src/grammar/local-selection.ts.
- Do not create WAG v1.0.2.
- Do not begin Segment B.
- Do not introduce B3, beam, phrase-wide search, generated NCT, or phrase-final refinement.
- Prefer the smallest experiment-only code.
- Do not cherry-pick cases manually; follow the canonical case-pool rule.
- Do not claim musical improvement before valid blind listening results exist.

Implement, test, build, browser-smoke, commit, push, and stop at
WAG_V1_0_2_EXPERIMENT_READY_FOR_BLIND_LISTENING.
```

---

# 15. Post-listening analysis prompt

After exporting the response JSON, use:

```text
Audit the attached WAG v1.0.2 selector experiment result against the exact
pre-registered decision rules in
docs/experiments/WAG_V1_0_2_SELECTOR_EXPERIMENT.md.

Verify:
- branch SHA and experiment schema;
- V0 production parity;
- all hard gates;
- mechanism metrics;
- blind mapping integrity;
- playback validity;
- duplicate-response consistency;
- feature-isolated preference scores;
- cumulative comparison;
- absence of scope leakage.

Do not reinterpret thresholds after seeing results.
Return exactly one final experiment status allowed by Section 9.5,
then list the evidence for or against each of E1, E3, and E4.

Do not draft a v1.0.2 contract unless the final status recommends it.
```

---

# 16. Hard stop

This experiment may recommend a future contract change. It may not make that change.

After the listening-ready checkpoint:

```text
STOP
```

The next actions are:

```text
human blind listening
→ exported evidence audit
→ keep v1.0.1 or authorize a separately frozen v1.0.2
```
