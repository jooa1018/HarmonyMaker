# HarmonyMaker v0 implementation handoff

## Accepted implementation boundary

HarmonyMaker v0 implementation Segments A–D are complete in-repository at Segment D code checkpoint `713a5d02f1091df9d273ef16f4fb5eb7108561fc`, with test-only CI-stabilization checkpoint `6834f1f2df7733785bd99724be5697244dd7d4b9`, descended exactly from the accepted Segment C handoff-inclusive base `bfadfad1d4bc04e11d348c1270976802a1dc4acc` on `codex/harmonymaker-v0-segment-d`.

The Segment D P1/P2 verification closure starts additively from remote HEAD `caf5953e0c8fde9511aee020f6d4a4fd04e57a6c` and has code checkpoint `9132731c960793e24bb83544a685949733f19cdd`.

The final handoff-inclusive remote HEAD is the additive documentation commit containing this handoff and is reported after its remote CI/Vercel checks pass. This document does not self-assert its containing commit SHA.

## Segment A — authority and substrate decisions

- `KEEP_WAG_V1_0_1` remains the accepted musical decision.
- Frozen WAG ZIP, contract, configuration, preset, and diagnostic authority remain byte/semantic-identical.
- Governance/substrate identities, timestamps, nonces, row/object IDs, tokens, and encryption bytes are excluded from musical semantic projections and tie-breaks.
- Production persistence is PostgreSQL plus a private S3-compatible object store and fails closed without configuration.

## Segment B — deterministic WAG execution

- The accepted production selector, lifecycle, Solver, marginal/pair assembly, Validator, rendering authority, and deterministic candidate ordering remain unchanged.
- The full repository suite preserves the 101-complete-execution determinism gate.
- No v1.0.2 experiment or new musical strategy is merged.

## Segment C — Product Core

- Accepted MusicXML/MXL import and structured Quick Review materialize schema-v9 Source authority.
- Product Core connects deterministic generation, operational H1/H2 roles, score/practice playback, locks/regeneration, edited snapshots, MusicXML export, local project lifecycle, transfer, and PracticeShare/ShareStore.
- Anonymous session, same-origin CSRF, quotas/idempotency, AES-GCM at-rest storage, PostgreSQL/S3 boundaries, cleanup, and truthful retention remain authoritative.

## Segment D — provider-neutral Step 10 OMR Core

- Safe MusicXML/MXL bypass and PDF/JPEG/PNG classification; deterministic PDF.js raster and Sharp decode; quality report and retake/warn/pass UX.
- Durable provider-neutral application service and Vendor adapter; exact quota/global-credit/idempotency/ownership/CSRF controls; needs-input, status, cancel, expiry, delete, cleanup, and retention truth.
- Deterministic fixture/reference lifecycle that is explicitly prohibited in production and makes no recognition-accuracy claim.
- Vendor MusicXML digest verification and normalization through the accepted importer; semantic readiness gate.
- Fixed-point evidence frames/transforms, canonical digest, explicit mapping, fallback, archive, remap, and browser overlay.
- Deterministic review alternatives/repairs, every v0 typed patch including structural barline split/merge, Source revisions/remaps/history, Quick Review, workspace, and unchanged Product Core handoff.
- Versioned evaluation ground truth, corpus manifest, metric report, Dev/sealed leakage/category validation, threshold-freeze boundary, and sealed-report codec.
- Per-item review authority, immutable import-target mapping, row-locked/fenced durable recovery and reconciliation, truthful independent deletion retry, pre-allocation raster bounds and original-scale quality parity, cross-measure tie validation, capability-snapshot consent, and structural barline Source remapping.

## Final verified implementation evidence

- Local: typecheck, lint, 59 files/558 tests, build, diff check, frozen audit, secret scan, and zero-vulnerability audit pass.
- Determinism: existing Segment B 101-run and new OMR 101-run pass.
- Browser: reference OMR through complete workspace/generation, deletion truth, two-page live PDF.js raster, and phone layout pass.
- Code-checkpoint remote: GitHub Actions run `32000608829`/job `95300072553` success; Vercel deployment `5939923221` and Preview Comments success.
- CI-stabilized verification checkpoint: GitHub Actions run `32001540954`/job `95302682451` success; Vercel deployment `5940071810`/status `16901345450` and Preview Comments success. The checkpoint changes only two nondeterministic test fixtures and no production behavior.
- P1/P2 verification-closure checkpoint `9132731c960793e24bb83544a685949733f19cdd`: local direct typecheck/lint, 61 files/573 tests, production build, diff check, 9-file/51-test focused campaign, Segment B 101-run, OMR 101-run, item-scoped browser review, IndexedDB workspace reload, and complete Product Core generation pass.
- Closure remote: GitHub Actions run `32008741642`/quality job `95323564571` success with exact `npm ci` and all five workflow gates; Vercel deployment `5941245985`/status `16904469707` success; preview `https://harmony-maker-p0s3or6d0-ecctom1.vercel.app`.

The six frozen files, their semantic digests, the 99-code registry, selector, lifecycle, Solver, marginal/pair assembly, Validator, and `src/product` have zero diff from closure base `caf5953e0c8fde9511aee020f6d4a4fd04e57a6c`.

## Campaign boundary

Campaign status is `HARMONYMAKER_V0_COMPLETE_WITH_EXTERNAL_VERIFICATION_REMAINING`, not `HARMONYMAKER_V0_COMPLETE`, because no paid/real provider was authorized and no rights-safe real Dev/sealed recognition corpus, live PostgreSQL/S3 deployment, or physical iPhone/Kakao device was supplied.

This handoff does not begin Step 11, select a provider, perform OCR/ML research, redesign Product Core, alter frozen musical semantics, or perform the separate final Ultra audit. The next operation is the independently authorized Ultra audit of the exact final handoff-inclusive remote HEAD reported with Segment D completion.

## Final Segment D correctness closure

An additive final closure starts from accepted remote HEAD `871b79ce7aa2efa90591e0998ed2bc194c08b2bb` and produces code checkpoint `85c6e2a78cb7e87010169b1062895870baf5ae0c`.

This checkpoint makes create-response recovery semantic/byte stable, distinguishes definitive rejection from uncertain provider outcome, and restores idempotent uncertain creates while fencing non-idempotent uncertainty behind reconciliation. Operation request digests and dedicated result, page, and cleanup leases fence concurrent completion/delete/worker races. Status reads are side-effect free. Mapping artifacts bind the exact result and provider bundle; selected MusicXML part/staff/voice identities bridge to Source only after melody selection; frame pages/digests bind the uploaded canonical page. Server preflight is the authoritative quality gate. Correction history records original and resolved targets and verifies remaps, projections, order, and revisions after reload. The remaining result-overlay, unsupported-diagnostic acknowledgment, and IndexedDB failure-count semantics are connected.

Verification for that exact checkpoint passed locally through direct installed tools: 61 Vitest files/582 tests, typecheck, ESLint with zero warnings/errors, Next.js production build, audit with zero vulnerabilities, diff check, Segment B 101-run, OMR 101-run, focused response-loss/uncertainty/concurrency/evidence/quality/history campaigns, persisted browser OMR-to-generation, and the frozen-authority audit. This Windows host could not spawn lifecycle children from exact `npm ci`/npm scripts (`EPERM`); `npm ci --ignore-scripts` installed the exact 447-package lock graph, and exact unmodified npm gates passed remotely.

Remote code-checkpoint evidence is GitHub Actions run `32017117803`/quality job `95348852985` success and Vercel deployment `5942664716`/status `16908237205` success. Preview: `https://harmony-maker-e6rpor2yt-ecctom1.vercel.app`.

The final handoff-inclusive remote HEAD is the additive commit containing this update and is reported only after its own CI and Vercel checks reach terminal success. Campaign status remains `HARMONYMAKER_V0_COMPLETE_WITH_EXTERNAL_VERIFICATION_REMAINING`; reference-adapter results are not accuracy evidence, and no real-provider, rights-safe corpus, live PostgreSQL/S3, or physical-device result is claimed. Step 11 and the separate Ultra audit were not begun.

## Final persisted-integrity closure

The additive closure from accepted remote HEAD `c10ee4b43a5a25a64c3d5eae9804d2c5ef2e3f99` has code checkpoint `8e17373b9815e17dc5c659ab535db0b46e25c71d`.

Persisted Source/project integrity now requires a zero-error OMR correction-history replay in the shared asynchronous Source validator while preserving the synchronous shape check. Because HarmonyProject transfer and IndexedDB/local-store reload both use `importHarmonyProject()`, tampered before-projection, correction ID, resolved revision target, correction order, or review-target/remap linkage fails every persisted load. A valid sequential mixed chord/voice/measure history survives export/import and reload.

Prepared OMR pages separately retain raw upload SHA-256 and the server-preflight canonical decoded-page digest. Create/upload binding uses the former; client duplicate detection uses the latter. Two raw-distinct, canonically identical JPEG fixtures require duplicate acknowledgment and then complete upload successfully in both the durable service and browser flow.

Local direct verification passed TypeScript, ESLint, 61 Vitest files/584 tests, the Next.js build, diff check, both 101-run determinism campaigns, focused history/duplicate/project reload campaigns, persisted browser OMR-to-generation, and the frozen-authority audit. Exact local npm child spawning remains host-limited (`EPERM`); `npm ci --ignore-scripts` installed 451 packages and audited 452 with zero vulnerabilities, while the unmodified remote workflow passed exact npm commands.

Remote evidence for the code checkpoint is GitHub Actions run `32021883373`/quality job `95363100218` success and Vercel deployment `5943490925`/status `16910436295` success. Preview: `https://harmony-maker-2etxsaj0a-ecctom1.vercel.app`.

Campaign status remains `HARMONYMAKER_V0_COMPLETE_WITH_EXTERNAL_VERIFICATION_REMAINING`. The final handoff-only descendant is reported after its own CI/Vercel checks pass. No Step 11, Ultra audit, paid-provider selection, accuracy claim, or frozen musical-authority change is included.

## Final persisted OMR-context integrity closure

The additive closure from accepted remote HEAD `c01f53f316ae99502d1d999cd584180b2af2aaa3` has code checkpoint `8dc0f8eedad7b5c075a95efbb4a36c707a21cd18`.

The shared asynchronous Source integrity boundary now requires complete canonical OMR provenance, review, evidence index, and archive context. It cross-binds the Vendor ID/result digest, current Source revision, provider granularity, mapped/unmapped evidence membership, shared frame/transform graph, and all index/archive/provider-bundle digests. Correction validation additionally replays each typed patch, enforces repeated-target before/after continuity through remaps, rejects orphan or multiply referenced corrections, and proves accepted auto-repair target linkage.

Tamper coverage includes every requested provenance/evidence/history mutation, while sequential same-target and mixed-target records pass Source/project transfer and reload. The live browser reference campaign exposed all three actual review targets, resolved them individually, handed off through Quick Review, reloaded the persisted IndexedDB project, and generated one independently validated candidate. Reference/duplicate fixture controls require an explicit non-production reference-mode flag and are absent with no flag, in real-provider mode, and in production.

Local direct verification passed TypeScript, ESLint, 62 Vitest files/587 tests, Next.js production build, diff check, both 101-run campaigns, persisted context/reload and mapping/archive campaigns, the browser OMR-to-generation campaign, and the frozen-authority audit. Exact local npm lifecycle child creation remains host-limited (`EPERM`); `npm ci --ignore-scripts` installed 451 packages and audited 452 with zero vulnerabilities. The unchanged remote workflow passed exact `npm ci` and all npm gates.

Remote code-checkpoint evidence is GitHub Actions run `32025713245`/quality job `95374571925` success and Vercel deployment `5944166770`/status `16912233530` success. Preview: `https://harmony-maker-3akfdt50a-ecctom1.vercel.app`.

Campaign status remains `HARMONYMAKER_V0_COMPLETE_WITH_EXTERNAL_VERIFICATION_REMAINING`. The additive handoff-only descendant is reported after its own remote checks pass. No Step 11, Ultra audit, provider selection, accuracy claim, or frozen musical-authority change is included.

## Broad final Segment D authority and provider-safety closure

This additive closure starts exactly from accepted remote HEAD `6d8f0d17d0758d7118e7895f300cd0bdca23fa84` and produces code checkpoint `16421f532721dcd4843717658a21f709ffcd5b81`. The final handoff-inclusive remote HEAD is the additive documentation commit containing this section; because a commit cannot contain its own SHA, its immutable SHA and exact remote CI/Vercel records are reported in the completion response.

All seven reported P1 findings are closed in repository code:

- Persisted OMR Source/project validation requires complete review, runtime readiness, and durable warning acknowledgement; generation revalidates the whole project before entering the unchanged WAG path.
- Parser-time immutable MusicXML identities survive Quick Review insertion, deletion, reordering, multi-part, and multi-staff selection. Every original identity is explicitly mapped-one, mapped-many, or deleted through Source revisions, and evidence-target swaps fail closed.
- `replace-event` cannot move onset/duration; auto-repair acceptance compares the current remapped projection with its stored original; real insert/delete-barline transforms the complete structural graph and history.
- Every durable job stores its creation-time `providerBindingId` and adapter contract version. Replay and every existing-job operation resolve that binding before any current-provider preflight; new jobs alone use the active provider.
- Reconciliation and bounded retry states retain session/IP/credit exposure. Transient provider or object-store failures persist retry metadata and backoff; explicit Vendor failure and contract/integrity failure remain terminal.
- Capability, consent, and snapshot semantics bind the actual canonical `image/png` Vendor transfer, not the user's raw JPEG/PNG encoding.

All five reported P2 findings are also closed: per-item evidence granularity is bounded by the bundle declaration; duplicate page admission is transactionally fenced; provider XML/evidence/frame/transform/mapping/string payloads have pre-canonicalization hard limits; page authorization precedes body reading; and legitimate runtime-warning acknowledgement persists and is integrity-validated.

Fresh verification at the code checkpoint used npm 11.6.2 against the committed lockfile: `npm ci` installed 451 packages and audited 452 with zero vulnerabilities; typecheck, ESLint, 63 Vitest files/599 tests, Next.js production build, and `git diff --check` all passed. Separate named execution passed the Segment B 101-complete-execution and OMR 101-permutation determinism campaigns. The six frozen files retain their exact SHA-256 values; frozen grammar/diagnostic authority paths have zero diff; the 99-code registry, WAG v1.0.1 selector/lifecycle/Solver/marginal/pair/Validator path, and accepted musical selection remain unchanged. The only Product Core production change is a common project-integrity precondition before generation.

In-repository verdict: `UNRESOLVED_P0=0`, `UNRESOLVED_P1=0`, `UNRESOLVED_P2=0`, `SEGMENT_D_ACCEPTED=YES`, and `ULTRA_AUDIT_READY=YES`. Overall campaign classification remains `HARMONYMAKER_V0_COMPLETE_WITH_EXTERNAL_VERIFICATION_REMAINING`: no real provider was selected, and no rights-safe Dev/sealed corpus, live PostgreSQL/S3 service, or physical iPhone/Kakao result is claimed. Step 11, the separate Ultra audit, and real-provider integration were not begun.

## Targeted P1-04 / P1-06 final closure

The independent follow-up audit reopened P1-04 and P1-06 after remote HEAD `782e0b39dc9c0172acce82de240210407acb1fc5`. This additive closure supersedes earlier acceptance claims for those two findings. Its immutable implementation-and-test checkpoint is `c53a2d7f1c7b7bbffbedcb5290cd4757cd4e1735`; the containing documentation commit is reported as the final handoff-inclusive remote HEAD after exact-SHA CI and Vercel verification.

P1-04 is closed at the production composition root. A production provider registry now separates the active registration from available historical registrations, derives a stable collision-resistant binding from provider identity, non-secret configuration generation, and adapter-contract version, and resolves existing jobs only on exact binding/version/vendor identity. The generic `configured-real` identity and active-adapter fallback were removed. Missing historical bindings fail closed into reconciliation; create-response recovery resolves the stored A binding before any active-B preflight.

P1-06 is closed by one provider-failure classifier. Vendor terminal rejection and provider contract/integrity violations become terminal `failed` records with released credit and cleared retry metadata. Only provider transport/read failures and local storage persistence failures enter durable bounded retry. Mapping schema/digest errors, malformed evidence graphs, result/bundle binding mismatches, capability violations, page/evidence integrity errors, and payload hard-limit violations no longer reach retry exhaustion.

Fresh local verification used npm 11.6.2 and the committed lockfile: `npm ci` added 451 packages and audited 452 with zero vulnerabilities; typecheck, lint, 64 Vitest files/607 tests, production build, and `git diff --check` passed. Separate named execution passed the Segment B 101-complete-execution and OMR 101-permutation campaigns. The six frozen SHA-256 values remain exact, the 99-code authority tests pass, and the protected grammar/diagnostic/Product Core musical paths have zero diff from the scope base.

Repository verdict after this targeted implementation and verification is again `UNRESOLVED_P0=0`, `UNRESOLVED_P1=0`, `UNRESOLVED_P2=0`, `SEGMENT_D_ACCEPTED=YES`, and `ULTRA_AUDIT_READY=YES`. Real-provider selection/integration, corpus calibration, live PostgreSQL/S3, physical-device verification, Step 11, and the Ultra audit remain outside this closure and were not started.
