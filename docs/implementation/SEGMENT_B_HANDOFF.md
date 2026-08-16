# Segment B handoff

## Checkpoint

- Exact Segment A base SHA: `a32b5eaf99ba6d1b73f0d0202d4580c912a26b76`
- Segment B branch: `codex/harmonymaker-v0-segment-b`
- Segment B final implementation commit SHA: `864ff797d15de3c80fbc3a750973038ec5d1618c`
- Exact Segment C starting SHA: `864ff797d15de3c80fbc3a750973038ec5d1618c`
- Fixed decision: `KEEP_WAG_V1_0_1`

Segment C must start from the final implementation checkpoint above. The handoff commit is a documentation-only descendant on the Segment B branch and does not change that implementation checkpoint.

## Commit boundaries

- B1 Intent: `7e9ae1eab09f9d9657d6af28aacec35bee3f73b4`
- B2 Activity and B3 Anchor/local Solver: `66361c00053cfbfe8aefc54900b98a6e76ba98d6`
- B4 marginals/pair: `f04f2524d833977d7d15c97603db5df993afe660`
- B5 independent Validator: `3c9844f3e1cefed343efb9767db8501c4f1e5938`
- B6/B7 closure and accompaniment: `322578c1ed65953087f2ae1b2efc8dbe50f0927c`
- B8 fixture corpus: `998666892d85dfeddf55d19705a86dddb3d436ca`
- Persisted plan-shape closure: `c3548953a649e22ca08de0b27d912684d7dde378`
- Metrics/Validator hardening: `233167479615812382b9a21a1cd940b9ea9ef354`
- Final authority/order/determinism closure: `864ff797d15de3c80fbc3a750973038ec5d1618c`

## Frozen authority

- WAG ZIP SHA-256: `9b27e30c10315622022c7d459fac3515ddd0fe2168321cd74870d941c9bc5b4b`
- Contract SHA-256: `ee09ded709273cc6468f1fd3f1df319d04458716f6ad911a878bffdb9b4498d5`
- WAG config semantic digest: `5a71f18d5687c4884f8dad209c162f39b8152c1e3030fc4af4b429c7c41f4482`
- Preset profile semantic digest: `ae0fce2af71b10e7f387521b22fe737cb840f02881b95121761b2953154cd681`
- Diagnostic baseline semantic digest: `96e396a1fdb97a9cc9eba2b21a20c709cd5a96285126bfba1a406cba2f42ef70`
- Diagnostic extension semantic digest: `aee570a5fc6110107979c40708ebb0b48f645e23853a0e75084854c2cd6ce794`
- Full 99-code registry digest: `0bdb9f5067cba55dad165d3679460a04f21e98b450a4624fa21eca1ffa3dcc77`

All six frozen package artifacts remain byte-identical. The production authorities remain `loadFrozenWagAuthority(...)` and `selectLocalHarmonyDecision(...)`. No diagnostic code, frozen rank tuple, selector/config/grammar version, or frozen artifact changed. The selector experiment branch was not inspected, merged, or cherry-picked; E1, E3, E4, V4, and V5 were not adopted, and no grammar v1.0.2 was created.

## Implemented lifecycle and pipeline

- `src/grammar/lifecycle.ts`: source/config/timeline/atomization authority recomputation; stage-lock validation; canonical Intent, Activity, and Anchor planning; R1/R2/R3/R5/R7; exact upstream authority-chain validation.
- `src/grammar/solver.ts`: exhaustive finite stage-local replay of the frozen selector, PitchLock enforcement, exact event/tie/provenance materialization, chord-tone anchors only, and zero generated NCT plans.
- `src/grammar/pipeline.ts`: independent Upper/Lower marginals, perceptibility, H1/H2 selection, rejection-only pair screening, Lead-only R4 behavior, exact metrics, LASC candidate projection, LASI dropout parity, IDs, digests, ordering, and complete/partial/blocked assembly.
- `src/grammar/segment-b.ts`: canonical end-to-end executor and deterministic semantic render document composition.
- `src/grammar/fixtures.ts` and `src/grammar/fixture-conformance.test.ts`: reusable canonical inputs and explicit outcomes for all 43 required Segment B fixture IDs.
- `src/domain/plans.ts`, `src/domain/digest/plans.ts`, and `src/domain/project.ts`: durable `harmonyExpectation` and non-musical `decisionEvidence` persistence/validation with the accepted digest boundary.

## Independent Validator

`src/grammar/validator.ts` independently recomputes candidate admission, chord/range/timing/role/anchor/lyric/tie/perceptibility/pair/dropout/digest/status/order invariants. It does not import the selector, Solver, pipeline, or generation admission helpers. Mutation tests reject wrong tones, range/crossing/timing/dropout/full-only repair, event IDs/ties, authority/version drift, ordering drift, hard leaps, invented lyrics, peer-anchor leakage, and false status claims.

## Deterministic accompaniment

`src/accompaniment/deterministic.ts` uses the same `EffectiveChordTimeline`, preserves exact span timing, emits silence for N.C./unparsed spans, honors slash bass, and creates deterministic semantic bass/pad events. Authority is `accompaniment-v1` with config digest `e15cdb1f539cae882d1238e3a57fe22422b484148a86b52dd8b78ae3ca24f21e`.

## Verification

Local verification at `864ff797d15de3c80fbc3a750973038ec5d1618c`:

```text
npm ci                                                                       PASS — 452 packages audited, 0 vulnerabilities
npm run typecheck                                                            PASS
npm run lint                                                                 PASS
npm test                                                                     PASS — 43 files, 435 tests
npx vitest run src/grammar/segment-b.test.ts -t "is deterministic across 101 complete executions"
                                                                             PASS — 1 targeted test, 101 executions
npm run build                                                                PASS — Next.js 16.3.0 production build
git diff --check                                                             PASS
```

Frozen-authority and Segment B focused verification passed 2 files/11 tests. The implementation worktree was clean before push.

Push-triggered GitHub Actions CI:

- Workflow: `CI` run #71, run ID `31932932623`
- Commit: `864ff797d15de3c80fbc3a750973038ec5d1618c`
- Event: `push`
- Quality job ID: `95130380369`
- Conclusion: `success`
- Run: `https://github.com/jooa1018/HarmonyMaker/actions/runs/31932932623`
- All steps passed: checkout, Node setup, `npm ci`, typecheck, lint, 435 tests, and production build.

## Continuation state

Known non-blocking debt: GitHub Actions reports that the Node.js 20 runtime used internally by `actions/checkout@v4` and `actions/setup-node@v4` is deprecated and currently forced to Node.js 24. This is workflow-maintenance debt; it did not affect any Segment B check.

Segment B has no runtime external dependency beyond the accepted local authorities. No live PostgreSQL, S3, vendor, or Product Core integration was required or added.

Explicitly deferred: Segment C; PostgreSQL migrations and persistence; production session/CSRF/quota work; S3 storage; ShareStore; save/import/export/share product flows; MusicXML product export UI; editing UI/snapshots; generation UI; production playback controls; Product Core; OMR Core; vendor integration; and field pilot. These are intentional boundaries, not Segment B defects.
