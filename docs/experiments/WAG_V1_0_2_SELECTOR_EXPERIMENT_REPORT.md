# WAG v1.0.2 Selector Experiment — Implementation Report

```text
WAG_V1_0_2_EXPERIMENT_READY_FOR_BLIND_LISTENING
```

## 1. Authority and isolation

- Accepted experiment base: `a32b5eaf99ba6d1b73f0d0202d4580c912a26b76`
- Branch: `codex/wag-v102-selector-experiment`
- Verified implementation checkpoint: `fc5715a835de8949841a283199b299af05ce12d8`
- Production WAG v1.0.1 selector/config/diagnostic artifacts modified: **NO**
- Segment B started: **NO**
- Grammar-version change authorized: **NO**

The branch comparison against the accepted base contains only new experiment code, an isolated review route, experiment documentation, tests, and the experiment-specific browser-smoke workflow. No pre-existing production source file was modified.

## 2. Implemented variants

```text
V0_FROZEN
V1_HARD_ONLY_TESSITURA
V2_NEXT_FEASIBILITY
V3_REENTRY_DISTANCE
V4_HARD_ONLY_PLUS_NEXT
V5_HARD_ONLY_PLUS_NEXT_PLUS_REENTRY
```

- **E1 / V1:** strongly avoids only pitches outside `comfortableRange` but still inside `hardRange`; it does not globally move every tessitura preference ahead of the frozen 3rd/6th family.
- **E3 / V2:** checks only whether a candidate leaves at least one hard-legal pitch at the immediately following sounding decision. It performs no recursion, beam search, DP, phrase optimization, or future quality scoring.
- **E4 / V3:** adds a soft re-entry-distance preference from the last sounding pitch before a rest. It adds no re-entry hard cap.
- **V4/V5:** pre-registered combinations of the isolated mechanisms above.
- Repeated 3rd/6th behavior remains measurement-only and is not a selector input.

## 3. Automated mechanism results

The automated fixture suite proves:

- `V0_FROZEN` is semantically equal to the immutable production selector across the full experiment corpus.
- E1 reduces hard-only-range selection in all four designated Upper/Lower, major/minor mechanism fixtures without adding rests.
- E3 removes the designated immediate hard-leap dead-end in all four designated fixtures and changes the affected sequence from one local hard-impossibility rest to a fully sounding two-decision path.
- E4 chooses a strictly closer legal re-entry in all four designated fixtures without changing the number of rests.
- Both neutral control fixtures remain semantically unchanged under all six variants.
- Every generated experiment note remains an exact Source chord tone, inside performer `hardRange`, on the correct side of Lead, and within the frozen continuous hard-leap constraint.
- Every fixture × variant combination reproduces one semantic result across 101 repetitions.
- The listening manifest contains exactly 18 pre-registered comparisons, including reversed duplicates and neutral controls.

The E3/E4 tests assert the mechanism outcome rather than hard-coding a tentative alternate pitch when the unchanged lower-order deterministic tie-break legitimately selects another equally mechanism-compliant note.

## 4. Automated verification evidence

GitHub Actions CI run #67 at `fc5715a835de8949841a283199b299af05ce12d8`:

```text
npm ci          PASS — 461 packages, 0 vulnerabilities
typecheck       PASS
lint            PASS
tests           PASS — 37 files, 325 tests
production build PASS — Next.js 16.3.0
```

The experiment suite contributes 18 tests. Its 101-repeat matrix completed successfully.

Experiment browser-smoke run #1 at the same checkpoint:

```text
production build                    PASS
Next production server start        PASS
experiment route HTTP 200            PASS
headless-Chrome hydration            PASS
required initial controls/text       PASS
visible pre-vote variant-name leak   0
server/runtime error scan            PASS
```

Verified route:

```text
/review/wag-v102-selector-experiment
```

Automated headless execution cannot establish audible quality. Each human attempt still requires explicit `heard-complete` confirmation in the review UI.

## 5. Blind-listening protocol

1. Check out this exact experiment branch/checkpoint or a later docs-only green checkpoint.
2. Run a clean install and development or production server.
3. Open `/review/wag-v102-selector-experiment`.
4. For each of the 18 comparisons, listen to A and B from the beginning in the fixed band-supported mix.
5. Mark an attempt complete only after it was actually audible through the end.
6. Record `A`, `B`, `TIE`, or `NO_PREFERENCE` and the requested confidence/reason fields.
7. Complete reversed duplicates and neutral controls without attempting to infer variant identity.
8. Download the final response JSON and analyze it against the pre-registered adoption criteria.

The visible pre-vote UI hides variant names, pitch labels, metrics, and traces. The exported response preserves deterministic side identity so the results can later be mapped to variants without changing the listening choices.

## 6. Decision boundary

This checkpoint does **not** mean that WAG v1.0.2 should be adopted.

Current state:

```text
AUTOMATED_SAFETY_AND_MECHANISM_GATES = PASS
BLIND_HUMAN_PREFERENCE_EVIDENCE = PENDING
PRODUCTION_WAG_V1_0_1 = UNCHANGED
V1_0_2_RELEASE_AUTHORIZED = NO
```

Only the pre-registered blind-listening result may justify a later WAG v1.0.2 contract/config/version update. If the evidence is weak, inconsistent, neutral-control-biased, or duplicate-inconsistent, production remains on v1.0.1.
