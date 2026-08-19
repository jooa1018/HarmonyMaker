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

## Final P1-04 delete/cleanup sibling closure

The follow-up audit reopened only the unavailable-historical-binding delete/cleanup path at exact remote HEAD `193585008ddd00fc2ffef4a65bd7f5e5e7ac1674`. The new implementation-and-test checkpoint is `f4dded0ea5ac80e0f50e730e0bc993c046e038ec`; its additive documentation descendant is the final handoff-inclusive remote HEAD reported with terminal CI/Vercel evidence in the completion response.

The defect was a synchronous second `adapterFor(job)` call inside a Promise `.catch()` fallback. When historical A was unavailable, that call escaped `deleteRecord()` before HarmonyMaker-owned object deletion, durable Vendor retry persistence, or cleanup-lease completion. Delete now resolves the existing-job adapter exactly once. An unavailable binding produces a truthful sanitized `OMR_PROVIDER_BINDING_UNAVAILABLE` Vendor failure and future retry while local page/result cleanup proceeds independently. The A binding, adapter contract, and encrypted A Vendor job ID remain until exact historical A is restored and Vendor deletion succeeds; active B is never used as fallback.

Production-composition tests cover user delete, expired cleanup, lease release, local page/result removal, binding/envelope retention, exact A restoration, zero B Vendor calls, same-A retention after transient delete failure, and final deletion. Existing normal A routing and independent Vendor/local retry tests remain green. Fresh verification passed npm 11.6.2 `npm ci` (451 added, 452 audited, zero vulnerabilities), typecheck, lint, 64 files/610 tests, Next.js build, diff check, both 101-run determinism campaigns, six exact frozen hashes, the 99-code authority, and zero protected-path changes.

Repository counts are `UNRESOLVED_P0=0`, `UNRESOLVED_P1=0`, `UNRESOLVED_P2=0`; `SEGMENT_D_ACCEPTED=YES` and `ULTRA_AUDIT_READY=YES`. Real-provider/corpus/live-service/device evidence remains external. Ultra, Step 11, provider selection/integration, corpus calibration, and physical-device verification were not started.

## Final create-outcome certainty and expiry-reconciliation closure

The independent audit reopened one new P1 at exact remote HEAD `d943a0121913149c28fb8c3ebeee2519850c9899`: an absent Vendor-job-ID envelope was being treated as proof that no Vendor side effect existed. The additive implementation-and-test checkpoint is `e81c6b16d317ce00e37e3629aa57bd7461550bfb`; the final handoff-inclusive documentation descendant and its exact terminal CI/Vercel evidence are reported in the completion response.

Durable OMR records now persist `vendorCreateOutcomeState` as `not-attempted`, `definitive-no-job`, `outcome-uncertain`, or `confirmed`. Additive migration 008 backfills from the encrypted Vendor ID and durable create-idempotency authority, adds a PostgreSQL CHECK constraint, and preserves Memory/PostgreSQL parity. A create is marked conservatively uncertain immediately before the Vendor call, becomes confirmed only with durable Vendor-ID persistence, and becomes definitive-no-job only after authoritative rejection.

Expiry cleanup never infers no-job from envelope absence. Idempotent uncertainty resolves the exact creation-time provider binding, contract version, canonical page count, and persisted Vendor create idempotency key; it durably recovers the same Vendor job ID before deleting through that same adapter. Missing historical A makes zero B calls and retains uncertainty, A identity, retry authority, and reserved credit. Non-idempotent uncertainty is never replayed or falsely deleted. HarmonyMaker-owned objects still clean independently and cleanup leases complete with a future reconciliation retry.

Fresh clean-install verification passed npm 11.6.2 `npm ci` (451 added, 452 audited, zero vulnerabilities), typecheck, lint, 64 Vitest files/614 tests, Next.js production build, and `git diff --check`. The focused create/cleanup/store campaign passed 4 files/54 tests. Separate Segment B 101-execution and OMR 101-permutation campaigns passed. All six frozen SHA-256 values, semantic/99-code authority tests, and protected musical-path diff remain exact/zero. P1-04 delete/cleanup and P1-06 taxonomy regressions remain closed.

The repository verdict is `UNRESOLVED_P0=0`, `UNRESOLVED_P1=0`, `UNRESOLVED_P2=0`, `SEGMENT_D_ACCEPTED=YES`, and `ULTRA_AUDIT_READY=YES`. Real-provider selection/integration, rights-safe corpus calibration, live PostgreSQL/S3, and physical-device verification remain external. Ultra and Step 11 were not started.

## Final replay-certainty and quota/credit authority closure

The final targeted audit starts from exact remote HEAD `bd109fe552d193bfd9236c0b1403c544bbcafa0d`, preserves prior code checkpoint `e81c6b16d317ce00e37e3629aa57bd7461550bfb`, and produces implementation-and-test checkpoint `a299ebb39d36d51396d0b7afcaa14b2e00d431ac`. The additive documentation commit containing this section is identified with exact terminal CI/Vercel evidence in the completion response.

An ordinary create replay rejection is now explicitly non-authoritative for historical side effects. Once a create is `outcome-uncertain`, a later definitive rejection keeps that state, reserved credit, the original provider binding/version/create key, a failed Vendor-delete result, a future reconciliation retry, and a non-deleted lifecycle. The general historical no-job mutation method was removed. Only the first attempt's authoritative definitive rejection can record `definitive-no-job` and release an unused reservation.

One centralized exposure rule is shared by the Memory implementation and PostgreSQL query parameters: normal active lifecycle work counts; every uncertain create counts regardless of cleanup lifecycle; and a confirmed Vendor effect counts while `expired`/`delete-pending` cleanup remains operationally unresolved. A normally completed retained result does not permanently consume concurrency before cleanup begins. Settled credit remains settled through user deletion, Vendor deletion, expiry, and final local tombstoning; same-day daily accounting therefore cannot be bypassed by deletion. Reserved uncertainty continues to count across accounting-day boundaries, while definitive no-job remains releasable.

Create pre-call, definitive failure, and completion writes are fenced by expected lifecycle, expected outcome, create lease, cleanup lease, and absent prior authority. Inactive cleanup rows cannot resume through the create endpoint. A persisted confirmed envelope wins over a different stale response. Cleanup claims now reselect `expired` rows after a crashed worker's lease expires, while local cleanup remains independent from Vendor reconciliation.

No migration is required: the existing four-state create-outcome and three-state credit model expresses the corrected authority. Fresh npm 11.6.2 verification passed `npm ci` (451 added, 452 audited, zero vulnerabilities), typecheck, lint, 64 Vitest files/622 tests, production build, and `git diff --check`. The focused Memory/PostgreSQL campaign passed 2 files/50 tests; separate Segment B and OMR 101-run campaigns passed; all six frozen hashes and the 99-code authority remain exact with zero protected-path change.

Final in-repository counts are `UNRESOLVED_P0=0`, `UNRESOLVED_P1=0`, and `UNRESOLVED_P2=0`; `SEGMENT_D_ACCEPTED=YES` and `ULTRA_AUDIT_READY=YES`. Real-provider historical-reconciliation capability, authoritative refund evidence, rights-safe corpus work, live PostgreSQL/S3, and physical-device verification remain external. Ultra and Step 11 were not begun.

## Residual create-reconciliation lifecycle and fencing closure

This targeted additive closure starts from exact remote HEAD `f73f53bf53ac2ae25a098e51f1d903a0218d4c44`, retains prior implementation checkpoint `a299ebb39d36d51396d0b7afcaa14b2e00d431ac` in its ancestry, and produces implementation-and-test checkpoint `61dbe29e93d7a8a9857becb342090c61ff2a8981`. The documentation-only descendant and its exact terminal GitHub Actions/Vercel evidence are identified in the completion response.

The residual defect had two parts. A successful same-key create replay persisted `confirmed`, the encrypted Vendor job ID, and completed idempotency, but left a create-reconciliation job in `reconciliation-required` with stale public failure metadata, so the returned and subsequently replayed handle was unusable. Separately, a delayed replay rejection used a general lifecycle transition and could overwrite a newer worker's confirmed authority.

Vendor creation completion now has explicit `public-handle-recovery` and `cleanup-reconciliation` modes. Public recovery atomically requires the current active create authority and pending idempotency, then commits `created`, `confirmed`, the envelope, cleared reconciliation/failure metadata, and completed idempotency. Cleanup recovery requires inactive `delete-pending` cleanup authority, preserves that lifecycle and the cleanup lease, and lets the worker delete the exact recovered Provider A job before final local/Vendor cleanup. `markVendorCreationUnresolved()` replaces the general replay-rejection transition and fences job, expected create lifecycle, uncertain outcome, exact create lease, absent envelope, active handle, absent cleanup lease, and pending idempotency. Any newer confirmation, no-job authority, cleanup ownership, completed idempotency, or deletion supersedes the stale write.

Fresh npm 11.6.2 verification passed `npm ci` (451 packages added, 452 audited, zero vulnerabilities), typecheck, lint, 64 Vitest files/627 tests, production build, and `git diff --check`. The focused Memory/PostgreSQL campaign passed 2 files/55 tests. Separate Segment B and OMR 101-run campaigns passed. The six frozen hashes remain exact, the 99-code authority remains unchanged, and protected WAG/diagnostic/Segment B/C musical paths have zero diff. No migration is required.

The required sequential campaign proves actual Provider A side effect plus response loss, later same-key replay rejection, a still-later same-key success returning the original Vendor job ID, atomic restoration to a usable `created` handle, normal upload/start/status progression, and identical post-recovery handle replay with one logical job and zero Provider B calls. The delayed-worker race proves a newer lease can confirm the handle while the earlier rejection, completion, and failure writes are all rejected without changing the confirmed envelope, cleared metadata, or completed idempotency. The expiry-cleanup campaign proves successful reconciliation remains `delete-pending` and inactive with its lease until exact A deletion and final cleanup.

Current authoritative gate status, superseding earlier acceptance/readiness declarations for the present handoff, is:

```text
TARGETED_CREATE_RECONCILIATION_P1 = CLOSED
SEGMENT_D_SATURATION_AUDIT_READY = YES
SEGMENT_D_ACCEPTED = NO
ULTRA_AUDIT_READY = NO
```

`UNRESOLVED_P0=0`, `UNRESOLVED_P1=0`, `UNRESOLVED_P2=0`, and no additional P0/P1/P2 was found. Acceptance remains deliberately withheld because a separate full Segment D saturation audit is the next authorized stage. That audit, Ultra, Step 11, real-provider integration, corpus calibration, live PostgreSQL/S3, and physical-device verification were not started.

## Segment D saturation-findings targeted closure

The independent saturation audit at exact remote HEAD `3367e7775b029f42fc7b3372cde46e5027fee67f` reported `P1-SAT-01`, `P1-SAT-02`, `P1-SAT-03`, and `P2-SAT-04`. This implementation-only closure produces code checkpoint `456312527684d419cb3ee54c3e4f031d4c2cd613`. Its additive documentation descendant is the final handoff-inclusive remote HEAD reported after exact-SHA CI and Vercel verification; this document does not self-assert its containing commit SHA.

- Completed create-idempotency replay now uses one shared handle-usability authority inside the Memory critical section or the PostgreSQL idempotency/job row-lock transaction. Active, unexpired public handles still replay exactly. Inactive, cryptographically expired, `delete-pending`, or `deleted` handles return sanitized `OMR_CREATE_REPLAY_UNAVAILABLE`; the completed key is not reopened and no second Vendor create or job occurs.
- OMR audit events are explicitly lower authority than business completion. A best-effort server-visible audit helper is used across create, page, start, sync/input, result capture, cancel, and delete/cleanup decisions. After `completePage=true` or `completeResultCapture=true`, the referenced object is no longer compensatable; audit failure cannot delete it, change completed/settled authority, or enter retry. Pre-commit and superseded-result compensation remains intact.
- `utcAccountingWindow()` supplies explicit UTC `[dayStart,nextDayStart)` timestamps to both stores. Reserved credit remains counted across days, settled credit only in its original UTC day, and released credit is excluded. PostgreSQL SQL no longer calls session-timezone-dependent `date_trunc`.
- JSON mutation bodies are read from `Request.body` with a bounded raw-byte stream reader. It validates `Content-Length`, independently counts streamed bytes, cancels immediately after the limit is crossed, retains at most the bound, and applies fatal UTF-8 decoding before `JSON.parse`. Origin/session/CSRF authorization still precedes body consumption.

No schema change was required. Fresh local npm 11.6.2 verification passed `npm ci` (451 added, 452 audited, zero vulnerabilities), typecheck, lint, 65 Vitest files/646 tests, production build, and `git diff --check`. Separate Segment B and OMR 101-run campaigns passed; the six frozen hashes and 99-code authority remain exact and protected musical-path diff is zero.

Actual repository-controlled PostgreSQL evidence ran against PostgreSQL 17 in GitHub Actions with a non-UTC `Asia/Seoul` session and a UTC session. All 5 integration tests passed: same-UTC-day settled denial across a local calendar boundary, previous-UTC-day exclusion, cross-day reserved exposure, UTC-session parity, and locked active/retired create replay. Code-checkpoint remote evidence is Actions run `32158587762`, quality job `95781697271`, and Vercel deployment `6Nkn2y6FEmgSXYimyLC856XmV1DZ`, all successful. This ephemeral CI result is not production live-PostgreSQL verification.

```text
P1_SAT_01 = CLOSED
P1_SAT_02 = CLOSED
P1_SAT_03 = CLOSED
P2_SAT_04 = CLOSED

UNRESOLVED_P0 = 0
UNRESOLVED_P1 = 0
UNRESOLVED_P2 = 0

TARGETED_SATURATION_FINDINGS_CLOSED = YES
SEGMENT_D_RESATURATION_AUDIT_READY = YES
SEGMENT_D_ACCEPTED = NO
ULTRA_AUDIT_READY = NO
```

This gate supersedes every earlier Segment D acceptance or Ultra-readiness statement. A separate audit-only re-saturation pass is still required. Real-provider selection/credentials/accuracy/refund authority, rights-safe Dev `>=36` and sealed `>=24` corpora, production live PostgreSQL/S3, and physical iPhone/Kakao verification remain external and incomplete. Re-saturation, Ultra, Step 11, and real-provider integration were not started here.

## Browser replay recovery and durable commit-ack closure

This residual closure starts from exact remote HEAD `bd0f95a4fa3dd7678cb1a2eaddc8140454b94223` and produces implementation-and-test checkpoint `7e56e7e408f0a00aea50355943bc6c1b24bdd895`. The additive documentation commit containing this section is reported as the final handoff-inclusive HEAD after exact-SHA CI and Vercel verification.

The browser now retains HTTP status plus sanitized `error.code` and `error.messageKo` in `OmrApiRequestError`. A stored handle is removed from automatic recovery only for exact `404 OMR_JOB_UNAVAILABLE`; network and 5xx ambiguity retain it. A retired create key is removed only for exact `409 OMR_CREATE_REPLAY_UNAVAILABLE`; timeouts, response loss, and other errors retain the original key. Both authoritative cases stop without blind Vendor creation and expose an explicit `새 작업 시작` action. That action remains gated by the current rights and provider-transfer consent, clears the input-scoped stale keys, generates one fresh `crypto.randomUUID()` key, and performs one create attempt guarded against duplicate clicks.

Durable page/result completion errors now trigger additive store inspections instead of unconditional object deletion. Memory performs the inspection inside its serialized atomic section. PostgreSQL locks the exact job and page/result rows transactionally. Page authority requires exact job, page ordinal, canonical page digest, upload idempotency hash, uploaded state, and candidate object reference. Result authority requires completed state, settled credit, exact result object and Vendor-result digest, provider-bundle digest, and normalization-mapping artifact digest. A candidate referenced by any conflicting durable row is never deleted or adopted. Exact commit preserves the object and returns the durable outcome; definitive noncommit retains existing retry compensation; an unreferenced superseded candidate is deleted; read failure or conflicting reference is `unknown`, preserves the object and lease, and permits later crash-safe recovery.

Clean-install verification used npm 11.6.2: 451 packages added, 452 audited, zero vulnerabilities; typecheck, lint, 66 files/659 tests, production build, and `git diff --check` passed. Separate Segment B and OMR 101-run campaigns and the 2-file/7-test frozen-authority campaign passed; protected musical paths have zero diff. GitHub Actions run `32194650587`, quality job `95896062793`, passed the same gates plus PostgreSQL 17 migrations 1–8 and 1 file/7 actual PostgreSQL tests. Code-checkpoint Vercel deployment `AD1VqDimnC17Y8nSuN7oJd1j25sN` and GitHub deployment `5972714806` succeeded.

```text
P1_SAT_01_BROWSER_RECOVERY = CLOSED
P1_SAT_02_COMMIT_ACK = CLOSED
ADDITIONAL_NEW_P0 = 0
ADDITIONAL_NEW_P1 = 0
ADDITIONAL_NEW_P2 = 0
UNRESOLVED_P0 = 0
UNRESOLVED_P1 = 0
UNRESOLVED_P2 = 0
TARGETED_SATURATION_FINDINGS_CLOSED = YES
SEGMENT_D_RESATURATION_AUDIT_READY = YES
SEGMENT_D_ACCEPTED = NO
ULTRA_AUDIT_READY = NO
```

This was not a full re-saturation audit. Real-provider selection/credentials/accuracy/pricing/refund/retention/idempotency evidence, rights-safe Dev `>=36` and sealed `>=24` corpora, production live PostgreSQL/S3, and physical iPhone Safari/Kakao verification remain external. Ultra, Step 11, real-provider integration, corpus calibration, and live-service/device verification were not started.

## Browser explicit fresh-start ambiguity closure

A follow-up independent audit found one caller-state residual after the prior browser replay closure: an explicit fresh click generated and persisted K1, but `freshStartReason` was cleared only after acquisition success. A lost response, timeout, or 5xx therefore left explicit mode armed; the next sequential click used `forceFresh=true`, deleted ambiguous K1, and generated K2. This narrow closure starts from exact documentation-inclusive remote HEAD `ad0d8c5295a2a0fc0ed618d8473bedc38a4f71ab` with prior code checkpoint `7e56e7e408f0a00aea50355943bc6c1b24bdd895`, and produces implementation-and-test checkpoint `fc9ce7f930cf31f29a458b7d81f0306b26156529`.

The client now represents fresh-start authority as a small `normal` / `explicit-required` state machine. The accepted click consumes `explicit-required` synchronously, before session lookup or create network work, and passes `forceFresh=true` exactly once. Ambiguous failure leaves the state normal and the serialized canonical K1 request intact, so the next click uses `forceFresh=false` and replays K1 with the original capability snapshot, rights metadata, page identity, and idempotency key. Only exact `409 OMR_CREATE_REPLAY_UNAVAILABLE` removes K1 and re-arms an explicit action; it performs no automatic K2 request. The existing in-flight ref is retained through tested begin/finish helpers, so same-tick and rapid clicks admit one active create.

The caller-state two-attempt campaigns begin with an exact stale recovery handle, consume one explicit action, create one logical job under K1, then lose the response by `TypeError` or sanitized 503. Each second click records force-fresh history `[false,true,false]`, posts `[K1,K1]`, calls the random request factory once, creates one logical job, returns the original handle, removes the create record only on success, and installs that handle as recovery authority. A separate exact retired-K1 campaign re-arms explicit mode after one request and proves no automatic K2. Focused browser/backend/commit-ack/UTC/streaming regression passed 4 files/90 tests.

Fresh local npm 11.6.2 verification passed `npm ci` (451 packages added, 452 audited, zero vulnerabilities), typecheck, lint, 66 Vitest files/663 tests, a real ephemeral PostgreSQL 17.9 run with migrations 1–8 and 1 file/7 tests, Next.js 16.3.0 production build, and `git diff --check`. Separate Segment B and OMR 101-run campaigns passed; frozen WAG/diagnostic authority passed 2 files/7 tests with zero protected-path diff. The additive documentation commit containing this section is the final handoff-inclusive SHA reported with its own exact-SHA Actions and Vercel terminal evidence.

```text
P1_SAT_01_BROWSER_RECOVERY = CLOSED
P1_SAT_02_COMMIT_ACK = CLOSED
ADDITIONAL_NEW_P0 = 0
ADDITIONAL_NEW_P1 = 0
ADDITIONAL_NEW_P2 = 0
UNRESOLVED_P0 = 0
UNRESOLVED_P1 = 0
UNRESOLVED_P2 = 0
TARGETED_SATURATION_FINDINGS_CLOSED = YES
SEGMENT_D_RESATURATION_AUDIT_READY = YES
SEGMENT_D_ACCEPTED = NO
ULTRA_AUDIT_READY = NO
```

This section supersedes the earlier browser-closure claim only for the newly identified caller-state ambiguity. It does not claim a full re-saturation audit. Re-saturation, Ultra, Step 11, real-provider integration, corpus calibration, production live services, and physical-device verification were not started.

## Full Segment D software-correctness re-saturation audit

The independent, audit-only re-saturation started from exact remote HEAD `59fc68573f8bef2ba48568bf23d23e726dfac300`, with implementation checkpoint `fc9ce7f930cf31f29a458b7d81f0306b26156529` and Segment C base `bfadfad1d4bc04e11d348c1270976802a1dc4acc` both present in its ancestry. All three required passes and all eleven lifecycle matrices were completed. This was a software correctness/reliability audit; no cybersecurity assessment was performed.

The audit found no P0, three P1, and four P2 residuals:

- `P1-RESAT-01`: unfenced generic status/result-capture failure transitions can let a stale worker overwrite a newer result-capture lease and discard a valid completion;
- `P1-RESAT-02`: an S3 put followed by governance-reference failure and failed compensation delete leaves an object with no durable cleanup authority;
- `P1-RESAT-03`: `ImportInfo.sourceKind` is not enforced as a provenance discriminant, so incomplete OMR context can be relabelled `musicxml` and pass project readiness/generation;
- `P2-RESAT-01`: malformed or obsolete persisted browser create JSON has no bounded, explicit recovery path for the same input;
- `P2-RESAT-02`: accepted Vendor input replay uses order-sensitive `JSON.stringify`, diverging from PostgreSQL JSONB semantic key ordering;
- `P2-RESAT-03`: the declared JavaScript safe-integer credit domain is wider than PostgreSQL `integer` and `::int` aggregation, and Memory summation has no overflow guard;
- `P2-RESAT-04`: start/input/cancel tests inject failure before `completeOperation`; they do not exercise a real durable apply followed by acknowledgement loss.

Four temporary fault-injection tests reproduced both stale-worker variants, the untracked S3 orphan, and the OMR provenance discriminant bypass. A read-only PostgreSQL 17.9 query also confirmed JSONB key reordering. Every temporary source edit was removed before this documentation-only handoff.

Fresh verification passed `npm ci` (447 packages added, 448 audited, zero vulnerabilities), typecheck, lint, 66 files/663 default tests, an actual ephemeral PostgreSQL 17.9 run with migrations 1–8 and 1 file/7 tests, Next.js 16.3.0 production build, and `git diff --check`. Separate Segment B and OMR 101-run campaigns passed, as did the 2-file/7-test frozen-authority campaign. The five manifest-listed byte hashes are exact, the freeze manifest is unchanged, the 99-code registry is exact, and protected musical-authority paths have zero diff from Segment C. The only Product Core production delta remains the legitimate common integrity/readiness precondition.

The prior targeted findings remain closed on their original invariants, but they do not close these independent roots. The full audit is complete; because P1 residuals remain, `SEGMENT_D_ACCEPTED=NO` and `ULTRA_AUDIT_READY=NO`. The containing additive documentation-only commit is the final audit HEAD reported with exact-SHA GitHub Actions and Vercel evidence.

```text
AUDIT_TYPE = SOFTWARE_CORRECTNESS_RELIABILITY_ONLY
CYBER_SECURITY_AUDIT = NOT_PERFORMED
P0_RESAT_COUNT = 0
P1_RESAT_COUNT = 3
P2_RESAT_COUNT = 4
UNRESOLVED_P0 = 0
UNRESOLVED_P1 = 3
UNRESOLVED_P2 = 4
SEGMENT_D_RESATURATION_AUDIT_COMPLETE = YES
SEGMENT_D_ACCEPTED = NO
ULTRA_AUDIT_READY = NO
```
