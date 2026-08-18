# HarmonyMaker v0 evidence report

## Automated implementation evidence

Code checkpoint: `713a5d02f1091df9d273ef16f4fb5eb7108561fc`; CI-stabilized verification checkpoint: `6834f1f2df7733785bd99724be5697244dd7d4b9`; exact base: `bfadfad1d4bc04e11d348c1270976802a1dc4acc`.

P1/P2 verification-closure code checkpoint: `9132731c960793e24bb83544a685949733f19cdd`; closure base: `caf5953e0c8fde9511aee020f6d4a4fd04e57a6c`.

```text
typecheck                         PASS
lint                              PASS
full Vitest                       PASS — 59 files, 558 tests
Next.js production build         PASS
git diff --check                 PASS
npm audit --audit-level=high     PASS — 0 vulnerabilities
frozen/protected authority audit PASS — 0 changed paths
credential signature scan        PASS — 0 findings
```

The full suite covers classification/MIME/magic/limits, PDF raster policy, orientation and canonical image decode, quality heuristics, session ownership/CSRF, concurrent quotas/global credit, create and page crash windows, page replay/conflict/retry, needs-input, status sanitization, capability/evidence gates, cancel/delete/expiry/retention, accepted MusicXML import, semantic readiness, fixed-point evidence and transforms, mapping/archive, review resolution/correction/revision/remap/history, Product Core compatibility, Segment B 101-run, and OMR 101-run.

Remote code-checkpoint evidence:

- GitHub Actions: `https://github.com/jooa1018/HarmonyMaker/actions/runs/32000608829`, quality job `95300072553`, success.
- Vercel deployment `5939923221`, deployment status `16900977339`, success.
- Vercel Preview Comments check, success.
- Preview URL: `https://harmony-maker-6s87uzfp6-ecctom1.vercel.app`.

An intermediate documentation-only HEAD produced GitHub Actions failure `32001097255` in a cleanup fixture: asynchronous fixture hashing made record-array order nondeterministic. The subsequent local full run also exposed a random-handle test that could replace a terminal `0` with the same `0`. Neither observation was a production failure. Test-only checkpoint `6834f1f2df7733785bd99724be5697244dd7d4b9` makes allocation sequential in the ordering-sensitive fixture and guarantees the tampered handle differs. Focused tests, all 59 files/558 tests, typecheck, lint, and build then passed locally. GitHub Actions run `32001540954`/quality job `95302682451` and Vercel deployment `5940071810`/status `16901345450` passed for that exact checkpoint; Preview Comments also passed. Preview URL: `https://harmony-maker-bk5qn4xl9-ecctom1.vercel.app`.

The handoff-inclusive commit receives its own final run after this report is committed; that exact run and final remote SHA are reported in the Segment D completion response.

## P1/P2 closure evidence

The closure-focused Vitest campaign passed 51 tests in 9 files. It covers two retries after initial page upload, all idempotent post-effect recovery windows, non-idempotent reconciliation, row-locked expected-state concurrency, stale fences, expired-handle cleanup, mixed Vendor/S3 sibling failures, vendor deletion follow-up, noncanonical page/staff/measure/symbol mappings, cross-measure/pickup/same-measure ties, rejected/unseen/mixed review items, explicit barline deferral, IndexedDB TTL/recovery, high-resolution original-scale quality parity, and oversized pre-canvas rejection.

The full suite passed 61 files and 573 tests. Separate named runs passed Segment B 101-execution determinism and OMR 101-permutation determinism. Frozen authority verification passed all six file SHA-256 values, four semantic authority digests, the full 99-code registry digest, algorithm bindings, insertion-order invariance, and zero changed frozen/protected paths.

Browser verification used local reference mode only and observed:

- capability disclosure before consent and consent bound to the returned snapshot;
- completed create/upload/start/needs-input/input/result flow;
- three initially open items with actual chord-event, voice-event, and measure-start targets plus page, evidence, and confidence;
- a rejected voice value remained unresolved and kept workspace handoff disabled until typed manual correction;
- typed chord and voice corrections plus the measure decision reduced the true open count to zero;
- IndexedDB persistence loaded the schema-v9 workspace; Product Core generation completed with one candidate and independent Validator success.

No console warning/error was observed in that browser run. This is plumbing/semantic-boundary evidence only, never reference-adapter accuracy evidence.

Remote closure evidence for `9132731c960793e24bb83544a685949733f19cdd`:

- GitHub Actions: `https://github.com/jooa1018/HarmonyMaker/actions/runs/32008741642`, quality job `95323564571`, success. Workflow steps `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` each succeeded.
- Vercel deployment `5941245985`, deployment status `16904469707`, success; preview `https://harmony-maker-p0s3or6d0-ecctom1.vercel.app`.

Local `npm ci` could not launch lifecycle child processes on this Windows execution host (`EPERM`); `npm ci --ignore-scripts` installed the exact lock graph with zero vulnerabilities, direct tool equivalents passed, and unmodified exact `npm ci` passed remotely. No local exact-`npm ci` success is claimed.

## Deterministic mock/reference lifecycle evidence

This category proves Core plumbing only and is not provider-accuracy evidence.

- Known PNG digest accepted; arbitrary pages rejected.
- Exactly-once Vendor job creation, idempotent page upload, queued/processing/needs-input/completed status, instrument input, MusicXML/evidence export, retention disclosure, and deletion passed in tests and browser.
- Browser reached accepted importer, evidence-aware OMR review, full Quick Review, schema-v9 workspace, unchanged frozen generation, score, and practice UI.
- Completed browser deletion reported local handle deletion `true` and Vendor status `deleted`.
- The OMR 101-run varies governance IDs/timestamps/nonces, Vendor job ordinal, arbitrary evidence/frame IDs, and array order while producing one semantic result set.
- The reference adapter is prohibited in production and makes no claim about recognition quality.

## Real-provider evidence

Status: **not available**.

No provider was selected, purchased, authorized, or credentialed. There is no claim for live recognition, live needs-input behavior, live retention policy, live delete success, latency, cost, granularity, or accuracy. Classification: `EXTERNAL_PROVIDER_SELECTION_OR_CREDENTIAL_REQUIRED`.

## Real-corpus calibration evidence

Status: **not available**.

The repository contains the versioned harness and manifest template, but no copyrighted material was created/downloaded and no synthetic fixture was counted toward the required rights-safe Dev `>=36` pages or sealed `>=24` pages. No threshold is frozen and no sealed PASS or accuracy number is claimed. Classification: `EXTERNAL_OMR_CALIBRATION_CORPUS_REQUIRED`.

## Live service evidence

Status: **not available for production credentials**.

PostgreSQL store/migration and private S3-compatible object-store code are implemented and unit-tested. No live database or bucket credentials were supplied, so live migration, true database concurrency, S3 deletion retry, and deployed production OMR E2E are not claimed. Classifications: `EXTERNAL_DATABASE_VERIFICATION_UNAVAILABLE` and `EXTERNAL_OBJECT_STORE_VERIFICATION_UNAVAILABLE`.

## Physical-device evidence

Status: **not available**.

Responsive browser automation passed at `390×844` without horizontal overflow. No physical iPhone Safari or Kakao in-app browser was available, so camera-picker, memory pressure, background/resume, download, audio unlock, and in-app-browser behavior are not claimed. Classification: `EXTERNAL_DEVICE_VERIFICATION_UNAVAILABLE`.

## Final correctness-closure evidence

Scope base: `871b79ce7aa2efa90591e0998ed2bc194c08b2bb`
Code checkpoint: `85c6e2a78cb7e87010169b1062895870baf5ae0c`

The full direct suite passed 61 files and 582 tests. Named campaigns passed the Segment B 101-run determinism gate; canonical OMR 101-run determinism; exact create-request replay after lost HTTP/Vendor responses; definitive rejection and non-idempotent uncertainty; simultaneous result capture, page-complete/delete, two-worker cleanup, and abandoned submit-input digest conflict; multi-part/multi-staff mapping and stale result/bundle/frame/page-digest rejection; actual high-resolution browser downscale versus server decode at 12/18-pixel staff-space boundaries; sequential mixed-target correction export/import/reload; and OMR to Quick Review to persisted workspace to validated generation.

The browser run used only the deterministic reference adapter. It obtained provider capability disclosure before consent, completed create/upload/start/needs-input/result, displayed normalized evidence boxes through `mapEvidenceBoxToNormalizedOriginal`, reloaded and recovered the same handle, and reached three item-scoped mixed targets. Rejecting the chord kept handoff blocked until a typed `Dm` replacement was recorded; the true open count reached zero only after the remaining voice and measure items were resolved. The persisted workspace then reloaded and generated one independently validated candidate. There were no observed console warnings/errors. This proves product plumbing, not recognition accuracy.

Authority verification recalculated all six frozen-file SHA-256 values, their semantic authority digests, and the exact 99-code diagnostic-registry digest. The diff from closure base contains zero frozen/protected authority paths and no accepted production musical-selection path.

Local execution truth:

```text
npm ci                            HOST-LIMITED — spawn EPERM before lifecycle scripts
npm ci --ignore-scripts           PASS — 447 packages, 0 vulnerabilities
direct TypeScript                 PASS
direct ESLint                     PASS — 0 warnings/errors
direct Vitest                     PASS — 61 files, 582 tests
direct Next build                 PASS
npm audit --audit-level=high      PASS — 0 vulnerabilities
git diff --check                  PASS
```

No local exact-npm-script PASS is asserted. Remote GitHub Actions ran the exact unmodified commands successfully for the code checkpoint: run `https://github.com/jooa1018/HarmonyMaker/actions/runs/32017117803`, quality job `95348852985`, conclusion `success`. Vercel deployment `5942664716`, status `16908237205`, concluded `success`; preview `https://harmony-maker-e6rpor2yt-ecctom1.vercel.app`.

External classifications remain unchanged: `EXTERNAL_PROVIDER_SELECTION_OR_CREDENTIAL_REQUIRED`, `EXTERNAL_OMR_CALIBRATION_CORPUS_REQUIRED`, `EXTERNAL_DATABASE_VERIFICATION_UNAVAILABLE`, `EXTERNAL_OBJECT_STORE_VERIFICATION_UNAVAILABLE`, and `EXTERNAL_DEVICE_VERIFICATION_UNAVAILABLE`. No paid provider was selected and no accuracy, frozen threshold, sealed-corpus PASS, live-service PASS, or physical-device PASS is fabricated.

## Persisted-integrity closure evidence

- Scope base: `c10ee4b43a5a25a64c3d5eae9804d2c5ef2e3f99`
- Code checkpoint: `8e17373b9815e17dc5c659ab535db0b46e25c71d`

The shared asynchronous SongSourceDocument integrity boundary now replays and verifies any attached OMR correction history. Five independently tampered histories cover before-projection, stable correction ID, resolved application target/revision, correction order, and original review target/SourceIdRemap linkage; every preliminary shape-valid tamper fails persisted Source/project integrity. A sequential three-target correction record passes Source JSON reload, HarmonyProject export/import, the local-store transfer path used by IndexedDB reload, and subsequent generation.

The upload evidence separates two meanings that previously shared one field. Raw SHA-256 remains bound to the browser create request and page upload. The server quality-preflight `inspection.digest` is retained as the canonical decoded-page digest and alone controls client duplicate detection. Two JPEG fixtures have raw digests `512dcf51793ae06fef06c248a53ad7f56932b8fc0026ac9e99474d8339559275` and `ac321be7722441493098752c5b98a693af22a8590dbead278b16431719ef3ffa`, but both decode to canonical digest `0356aea0d0b26fb92768b49200bf5c3543b0716293a1e6550cb5bf9b72e82db0`. The durable service rejects the second upload before acknowledgment and accepts it afterward. The browser displays the canonical-duplicate acknowledgment, uploads both pages, and completes the deterministic reference result.

Local evidence:

```text
npm ci                            HOST-LIMITED — spawn EPERM at lifecycle child creation
npm ci --ignore-scripts           PASS — added 451, audited 452, 0 vulnerabilities
direct TypeScript                 PASS
direct ESLint                     PASS
direct full Vitest                PASS — 61 files, 584 tests
direct Next build                 PASS
git diff --check                  PASS
Segment B 101-run                 PASS
canonical OMR 101-run             PASS
review history tamper/reload      PASS — 1 file, 6 tests
duplicate page decode/upload      PASS — 2 files, 29 tests
Product Core transfer/reload      PASS — 1 file, 25 tests plus canonical OMR project fixture
frozen WAG/diagnostic authority   PASS — 2 files, 7 tests and zero protected-path diff
```

Browser evidence used only the deterministic reference adapter. It proved two canonically identical JPEG pages are recognized as duplicates despite different raw bytes, the acknowledgment gates the upload, and the resulting OMR lifecycle completes. A separate canonical flow resolved chord, voice, and measure review items, handed off through Quick Review, loaded the workspace from IndexedDB after reload, and produced one independently validated generation candidate. This is plumbing and integrity evidence, not provider-accuracy evidence.

Remote evidence for the exact code checkpoint:

- GitHub Actions: `https://github.com/jooa1018/HarmonyMaker/actions/runs/32021883373`, quality job `95363100218`, `success`.
- Vercel deployment `5943490925`, status `16910436295`, `success`; preview `https://harmony-maker-2etxsaj0a-ecctom1.vercel.app`.

The six frozen artifacts and their accepted semantic digests remain exact; the 99-code registry and accepted musical-selection path are unchanged. The external classifications above remain open and unchanged.

## Persisted OMR-context integrity closure evidence

- Scope base: `c01f53f316ae99502d1d999cd584180b2af2aaa3`
- Code checkpoint: `8dc0f8eedad7b5c075a95efbb4a36c707a21cd18`

For an OMR Source, the asynchronous integrity boundary now requires and cross-verifies `rawDigest`, provider metadata, the review record, evidence archive, and Source evidence index. The review result and metadata bind the same raw Vendor result; Vendor identity, current Source revision, provider granularity, evidence IDs, frames/transforms, mapped/unmapped partition, SourceEvidenceIndex bundle digest, archive digest, and combined provider-bundle digest are all independently revalidated.

Correction replay proves each patch transforms its revision record's canonical before-projection into its after-projection. A logical target corrected more than once must carry the preceding after-projection into the next before-projection after remap. Every correction has exactly one accepted review/manual/auto-repair authority reference, and accepted auto-repair targets must remap to the recorded application target.

The tamper matrix rejects changed patch plus recomputed ID, after-projection mismatch, same-target chain break, orphan correction, wrong auto-repair target, nonexistent and double-present evidence IDs, index/archive/provider digest changes, mismatched Vendor result/ID, and removed review/evidence context. Sequential same-target and mixed-target records pass JSON Source reload, HarmonyProject export/import, local persistence, and generation.

Local evidence:

```text
npm ci                            HOST-LIMITED — spawn EPERM at lifecycle child creation
npm ci --ignore-scripts           PASS — added 451, audited 452, 0 vulnerabilities
direct TypeScript                 PASS
direct ESLint                     PASS
direct full Vitest                PASS — 62 files, 587 tests
direct Next build                 PASS
git diff --check                  PASS
Segment B 101-run                 PASS
canonical OMR 101-run             PASS
persisted OMR tamper/reload       PASS
mapping/archive round-trip        PASS
browser OMR/Product Core flow     PASS — 3 review items, IndexedDB reload, 1 validated candidate
fixture-control visibility        PASS — explicit development/test reference flag only
frozen WAG/diagnostic authority   PASS — 2 files, 7 tests and zero protected-path diff
```

Remote evidence for the exact code checkpoint:

- GitHub Actions: `https://github.com/jooa1018/HarmonyMaker/actions/runs/32025713245`, quality job `95374571925`, `success`; exact `npm ci` and every configured npm gate passed.
- Vercel deployment `5944166770`, status `16912233530`, `success`; preview `https://harmony-maker-3akfdt50a-ecctom1.vercel.app`.

The deterministic reference adapter remains plumbing/integrity evidence only. The six frozen artifacts, semantic authority digests, 99-code diagnostic registry, and accepted musical-selection path remain exact. All real-provider, rights-safe corpus, live PostgreSQL/S3, and physical-device external classifications remain open.

## Broad final Segment D closure evidence

- Exact scope base: `6d8f0d17d0758d7118e7895f300cd0bdca23fa84`
- Code checkpoint: `16421f532721dcd4843717658a21f709ffcd5b81`
- Final handoff-inclusive remote HEAD: the additive commit containing this section; exact SHA and terminal remote records are reported in the completion response because a commit cannot embed its own SHA.

The new evidence matrix directly exercises every reported finding:

- Persisted readiness rejects open or rejected-unresolved items, pending auto repair, invalid runtime state, and unacknowledged semantic warnings. A JSON-reloaded acknowledgement remains valid, while the generation boundary refuses an invalid OMR project.
- Immutable import identity tests cover insertion, deletion, reorder, multi-part, and multi-staff selection. A separate mismatch fixture swaps an evidence target while keeping other digests internally consistent and is rejected.
- Correction tests reject onset reorder and duration-gap `replace-event`, reject acceptance after a manual edit stales a proposal, and execute insert-barline then delete-barline as a structural round trip with canonical IDs, mapped-many/merge remaps, performance/section/phrase updates, evidence IDs, and replayable correction history.
- Provider lifecycle tests create through A, rotate active configuration to B, complete every old-job operation through A, replay a lost create without B preflight, and create the next job through B. Capability-set order does not affect the snapshot digest.
- Reconciliation counts against session, IP, and credit exposure. Status, XML export, evidence, mapping, retention, and object persistence transient failures enter durable retry and recover; bounded exhaustion enters reconciliation with credit and binding retained. Explicit provider/contract/integrity failures remain terminal.
- A JPEG-only provider is rejected because it lacks actual PNG transfer support. A PNG-capable provider accepts a JPEG user input only after server canonicalization, and the adapter observes a real `image/png` Blob.
- Evidence items cannot exceed declared granularity. Concurrent identical uploads to different page indices admit exactly one without explicit duplicate acknowledgement. Oversized XML, evidence, frame, transform, mapping, or string payloads fail before expensive canonicalization/storage. Static route evidence proves authorization precedes body reading.

Fresh final local gates:

```text
npm ci                    PASS — added 451, audited 452, 0 vulnerabilities
npm run typecheck         PASS
npm run lint              PASS
npm test                  PASS — 63 files, 599 tests
npm run build             PASS
git diff --check          PASS
Segment B 101-run         PASS
OMR 101-run               PASS
```

The six frozen artifacts match their pinned byte SHA-256 values and no protected grammar/diagnostic authority path differs from the scope base. The 99-code registry and accepted WAG v1.0.1 musical selection path are unchanged. The repository closure count is `P0=0`, `P1=0`, `P2=0`. Reference-adapter evidence remains plumbing/integrity evidence, not recognition accuracy.

## Targeted P1-04 / P1-06 closure evidence

- Scope base: `782e0b39dc9c0172acce82de240210407acb1fc5`
- Code checkpoint: `c53a2d7f1c7b7bbffbedcb5290cd4757cd4e1735`
- Full suite: 64 files, 607 tests

The production-factory evidence constructs deployment generation 1 with active Provider A, persists the derived A binding, then reconstructs the service over the same durable store with active Provider B and historical A. The old A job replays create, uploads, starts, polls, captures XML/evidence/mapping/retention, exports, and deletes through A only. A new job stores the B binding. A separate generation without historical A produces reconciliation and makes zero B status calls. A response-lost A create resumes through A after lease expiry and makes zero B preflight/create calls. Different configuration generations produce distinct bindings, and no production path uses `configured-real`.

Lifecycle taxonomy evidence proves malformed mapping schema, invalid mapping digest, malformed evidence graph, result-binding mismatch, payload limit, and explicit Vendor failed status are terminal with `creditState=released`, absent retry metadata, and no second capture/status attempt. Temporary status, XML export, evidence, mapping transport, retention read, and object-store write failures remain retryable and recover with binding/credit retained. Persistent transient export failures exhaust the bounded schedule into reconciliation while preserving the provider identity, encrypted Vendor job ID, and reserved credit.

Fresh gate evidence:

```text
npm ci                    PASS — 451 packages added, 452 audited, 0 vulnerabilities
npm run typecheck         PASS
npm run lint              PASS
npm test                  PASS — 64 files, 607 tests
npm run build             PASS
git diff --check          PASS
Segment B 101-run         PASS
OMR 101-run               PASS
frozen authority          PASS — six pinned hashes, semantic/99-code tests, 0 protected changes
```

No new finding was introduced: `NEW_P0=0`, `NEW_P1=0`, `NEW_P2=0`. Reopened P1-04 and P1-06 are closed, leaving `UNRESOLVED_P0=0`, `UNRESOLVED_P1=0`, `UNRESOLVED_P2=0`. Deterministic adapters establish routing and integrity behavior only; they do not establish real-provider recognition accuracy.

## P1-04 delete/cleanup final closure evidence

- Scope base: `193585008ddd00fc2ffef4a65bd7f5e5e7ac1674`
- Code checkpoint: `f4dded0ea5ac80e0f50e730e0bc993c046e038ec`
- Full suite: 64 files, 610 tests

The production factory campaign creates and completes an A-bound job with live local page and result objects, deploys B without historical A, and calls user delete. Delete returns `localHandleDeleted=true` with sanitized `OMR_PROVIDER_BINDING_UNAVAILABLE`; B delete and retention calls remain zero. The job becomes `delete-pending`, retains the A binding/version/encrypted Vendor ID, persists a future Vendor retry, releases its public handle, deletes both local objects, and clears local result/evidence/mapping references.

An expired-job cleanup campaign proves the same unavailable binding cannot escape the worker: local cleanup completes, a truthful Vendor retry result is returned, and both cleanup lease fields are cleared. After the retry deadline, restoring exact historical A causes one A deletion with the original A Vendor job ID, zero B calls, final `deleted`, and envelope removal. A separate transient campaign proves A deletion failure uses A—not active B—for retention, keeps local cleanup independent, and succeeds through A on the next due cleanup. The existing inverse sibling case—Vendor deletion succeeds while local object deletion retries—also remains green.

Local gates passed `npm ci`, typecheck, lint, 64/610 tests, production build, and diff check. Segment B and OMR 101-run tests passed separately. All six frozen hashes and authority tests remain exact; the 99-code registry and accepted Segment B/C musical paths have zero diff. `NEW_P0=0`, `NEW_P1=0`, `NEW_P2=0`; all unresolved counts are zero. This deterministic evidence proves isolation and lifecycle correctness, not real-provider recognition accuracy or live S3 behavior.

## Create-outcome certainty / expiry reconciliation closure evidence

- Scope base: `d943a0121913149c28fb8c3ebeee2519850c9899`
- Code checkpoint: `e81c6b16d317ce00e37e3629aa57bd7461550bfb`
- Focused campaign: 4 files, 54 tests
- Full suite: 64 files, 614 tests

Production composition tests create a real deterministic side effect in Provider A, lose the response, withhold a usable local envelope, rotate active deployment to B, and advance directly past handle expiry. Cleanup resolves the persisted A binding, replays the exact original create input and idempotency key, receives the same logical A Vendor job, persists its encrypted ID/confirmed outcome, and deletes it through A. A single logical Vendor job exists, A receives the delete for the recovered ID, B receives zero capability/create/delete/retention calls, credit changes from reserved only after resolution/deletion, and the cleanup lease and envelope clear at final deletion.

A separate deployment omits historical A. Cleanup makes zero B calls, retains `outcome-uncertain`, A binding/version/create key, absent envelope, reserved credit, and a future Vendor retry while completing local deletion and clearing the lease. Restoring exact A after the retry deadline replays the same key, deletes through A, and reaches final deleted. This also preserves the previously closed unavailable-binding P1-04 behavior for already-confirmed jobs.

The non-idempotent post-Vendor/pre-persist crash test creates the Vendor side effect, forces `completeVendorCreation()` failure, attaches a live HarmonyMaker object, and advances through expiry. Cleanup does not call create/delete/retention, never marks Vendor or job deleted, exposes `OMR_VENDOR_CREATE_OUTCOME_UNCERTAIN`, retains provider/create authority and reserved global credit across the day boundary, deletes the local object, persists a future retry, and clears the cleanup lease. A new request at the same global ceiling is denied, proving unresolved exposure remains accounted.

Definitive rejection records `definitive-no-job`, releases credit, completes durable create idempotency, performs no Vendor delete at expiry, and permits local tombstone. PostgreSQL store evidence verifies uncertain cleanup claims retain reserved credit while definitive-no-job claims release it. Migration evidence verifies monotonic inventory 1–8 and the four-state CHECK/backfill authority.

All required repository gates passed after exact `npm ci`: typecheck, lint, 64/614 tests, build, and diff check. Separate authority/determinism execution passed 3 files/12 tests including both 101-run campaigns and all 99 diagnostics. Six frozen byte hashes are exact and protected-path diff is zero. `KNOWN_NEW_P1_CREATE_OUTCOME=CLOSED`, `ADDITIONAL_NEW_P0=0`, `ADDITIONAL_NEW_P1=0`, `ADDITIONAL_NEW_P2=0`; unresolved counts are all zero.

## Replay-certainty and P1-05 authority evidence

Scope base is exact remote HEAD `bd109fe552d193bfd9236c0b1403c544bbcafa0d`; implementation-and-test checkpoint is `a299ebb39d36d51396d0b7afcaa14b2e00d431ac`. No schema or migration changed.

The historical-certainty production test commits a real deterministic reference-adapter side effect, loses the first response, advances directly to expiry cleanup, and returns a definitive rejection from the ordinary same-key replay. The persisted job remains `outcome-uncertain`, `delete-pending`, Vendor-delete failed, local-delete complete, credit reserved, and explicitly `OMR_VENDOR_CREATE_OUTCOME_UNCERTAIN`. Provider binding, adapter contract, and create key remain exact; no Vendor delete is reported; the cleanup lease clears; and the due retry is claimed again. A separate create-endpoint resume test proves the same rejection cannot become definitive-no-job. The original first-attempt rejection fixture still records definitive-no-job, releases credit, and tombstones without a Vendor delete.

Memory service tests place uncertain jobs into `delete-pending` and prove both same-session and same-IP creates fail `OMR_QUOTA_EXCEEDED`. PostgreSQL claim tests execute the store decision over semantic exposure fixtures and the shared lifecycle/cleanup-state parameters. The v0 rule counts ordinary active work, every uncertain create, and confirmed effects during unresolved expiry/delete cleanup; completed retained data is excluded until operational cleanup begins.

Two charged-job campaigns reach `creditState=settled`, then perform user deletion or same-day expiry cleanup. Final deleted rows remain settled and a second session's create at ceiling one fails `OMR_GLOBAL_CREDIT_CEILING_EXCEEDED`. PostgreSQL cleanup, handle-delete, and daily-claim fixtures prove equivalent settled behavior. Existing uncertain cross-day and definitive-no-job release tests prevent overcorrection.

Memory and PostgreSQL stale-completion tests reject deleted/definitive, wrong lifecycle, different/newer outcome, and stale cleanup-lease completion. Pre-call marking and first-attempt failure also require the current create lease. Pending idempotency cannot resume once cleanup made the handle inactive. The cleanup audit found and fixed one related defect: an `expired + handleActive=false` row left by a crashed worker was not formerly reclaimable. Both selectors now include lease-expired `expired` rows; the regression proves no early claim and successful post-expiry re-claim.

Verification evidence:

```text
npm ci                            PASS — 451 added, 452 audited, 0 vulnerabilities
npm run typecheck                 PASS
npm run lint                      PASS
npm test                          PASS — 64 files, 622 tests
npm run build                     PASS
git diff --check                  PASS
focused Memory/PostgreSQL         PASS — 2 files, 50 tests
Segment B determinism             PASS — 101 complete executions
OMR determinism                   PASS — 101 canonical permutations
frozen WAG / 99-code authority    PASS — six exact SHA-256 values, 7 authority tests
protected path diff               PASS — zero changed frozen/musical paths
migration                         NONE REQUIRED
```

`CREATE_REPLAY_REJECTION_P1=CLOSED`, `P1_05_VENDOR_EXPOSURE_AND_CREDIT=CLOSED`, and the cleanup-lease audit finding is fixed. `ADDITIONAL_NEW_P0=0`, `ADDITIONAL_NEW_P1=0`, `ADDITIONAL_NEW_P2=0`; all unresolved counts are zero. Repository acceptance and Ultra-audit readiness are restored, while external provider/corpus/live-service/device evidence remains unclaimed.

## Residual create-reconciliation lifecycle/fencing evidence

- Scope base: `f73f53bf53ac2ae25a098e51f1d903a0218d4c44`
- Prior code checkpoint: `a299ebb39d36d51396d0b7afcaa14b2e00d431ac`
- New code checkpoint: `61dbe29e93d7a8a9857becb342090c61ff2a8981`
- Focused campaign: 2 files, 55 tests
- Full suite: 64 files, 627 tests
- Migration: none required

The sequential service evidence commits one logical Provider A create, loses the response, receives an ordinary same-key definitive rejection after the first lease expiry, and preserves `outcome-uncertain`, create reconciliation, reserved credit, and public uncertainty. After the next lease expiry, the same key returns the original A Vendor job ID. One atomic public-recovery operation records `created`, `confirmed`, the encrypted envelope, cleared `reconciliationKind`, cleared public failure code/message, and completed idempotency. The returned handle reports created, uploads its page, starts A, enters normal queued status, and is returned unchanged by the identical post-recovery create. Provider A has one logical job; active Provider B receives zero create/upload/start/status calls.

The delayed-worker evidence lets Worker A hold an expired create lease while waiting on the replay response. Worker B claims the next lease, obtains the original Vendor ID, and confirms the usable handle. A's later rejection is routed through fenced `markVendorCreationUnresolved()` and returns pending/superseded. Direct stale completion and first-attempt failure writes also fail. The durable record remains exactly the newer `created`/`confirmed` record with its envelope, cleared reconciliation/failure metadata, active handle, and completed idempotency.

The cleanup evidence replays an uncertain expired A create under the current cleanup lease, observes `delete-pending`, inactive handle, confirmed envelope, and retained cleanup lease immediately before completion, deletes the exact A job, performs local cleanup, clears the lease/envelope, and reaches `deleted`. Provider B create/delete counts remain zero. PostgreSQL semantic fakes apply the same public recovery from both `created` and `reconciliation-required/create`, the same cleanup lifecycle/lease preservation, current/stale unresolved fences, metadata clearing, and idempotency decisions.

Bounded matrix evidence:

```text
uncertain -> rejection -> later success          PASS
created public recovery                          PASS
create-reconciliation public recovery            PASS
lifecycle/reconciliation/failure clearing        PASS
usable upload/start/status handle                PASS
identical post-recovery handle replay            PASS
one logical Vendor job / zero Provider B calls   PASS
stale rejection after newer confirmation         PASS
stale completion/failure after newer authority   PASS
current/stale create lease fencing               PASS
delete-pending cleanup recovery                  PASS
inactive handle / retained cleanup lease         PASS
current/stale cleanup lease fencing              PASS
first-attempt definitive-no-job                  PASS
historical replay rejection remains uncertain    PASS
P1-05 session/IP exposure and settled credit     PASS
P1-04 / P1-06 / Vendor-local cleanup              PASS
Memory/PostgreSQL parity                          PASS
```

Fresh gate evidence:

```text
npm ci                    PASS — 451 added, 452 audited, 0 vulnerabilities
npm run typecheck         PASS
npm run lint              PASS
npm test                  PASS — 64 files, 627 tests
npm run build             PASS
git diff --check          PASS
Segment B 101-run         PASS
OMR 101-run               PASS
frozen authority          PASS — six exact hashes, unchanged 99-code authority
protected path diff       PASS — zero changed frozen/musical paths
```

`ADDITIONAL_NEW_P0=0`, `ADDITIONAL_NEW_P1=0`, `ADDITIONAL_NEW_P2=0`, and all unresolved counts are zero. The current authoritative gate is:

```text
TARGETED_CREATE_RECONCILIATION_P1 = CLOSED
SEGMENT_D_SATURATION_AUDIT_READY = YES
SEGMENT_D_ACCEPTED = NO
ULTRA_AUDIT_READY = NO
```

This deliberately supersedes earlier readiness statements until the separately planned Segment D saturation audit is performed. That audit and all external provider/corpus/live-service/device work remain outside this closure.

## Segment D saturation findings closure evidence

- Audit baseline: `3367e7775b029f42fc7b3372cde46e5027fee67f`
- New implementation-and-test checkpoint: `456312527684d419cb3ee54c3e4f031d4c2cd613`
- Migration: none
- Default suite: 65 files/646 tests
- Actual PostgreSQL suite: 1 file/5 tests
- Code-checkpoint Actions: run `32158587762`, quality job `95781697271`, success
- Code-checkpoint Vercel: deployment `6Nkn2y6FEmgSXYimyLC856XmV1DZ`, status `52442449575`, success
- Final handoff-inclusive HEAD: the containing additive documentation commit, reported after exact-SHA remote verification

`P1-SAT-01`: one shared `isCreateReplayUsable()` authority checks active handle, cryptographic expiry, and non-retired lifecycle. Memory decides inside its serialized `atomic()` section. PostgreSQL selects idempotency plus job expiry/state/active fields with `FOR UPDATE OF i,j`, computes the result before commit, and therefore serializes against handle deactivation/cleanup updates. Completed success becomes either exact replay or `replay-unavailable`; it never resumes Vendor create, reopens idempotency, issues a new handle, or creates a new job. Tests cover active completed result replay, user deletion, pre-cleanup expiry, partial `delete-pending`, final cleanup deletion, exact rejection mapping, one job, and one Vendor side effect.

`P1-SAT-02`: `recordAuditBestEffort()` catches audit persistence failure and emits only the sanitized event kind to server error visibility. Every Segment D audit call site was reviewed and routed through the lower-authority policy. Page/result ownership transfers exactly when the durable completion returns true. Post-commit audit failure preserves page/result objects, uploaded/completed state, settled credit, read/export access, and restart access. Page pre-commit interruption still deletes the compensatable object. A superseded result completion still deletes the unreferenced result object. Create/start/input/cancel/delete remain authoritative under injected audit failure.

`P1-SAT-03`: `utcAccountingWindow()` returns explicit normalized UTC day start and exclusive next-day start. Memory and PostgreSQL share `reserved OR (settled AND createdAt in UTC window)` semantics; released credit is excluded. PostgreSQL receives the two instants as query parameters and no longer uses `date_trunc`. The actual PostgreSQL 17 suite applies migrations 1–8 in an isolated schema, pins sessions independently to `Asia/Seoul` and UTC, and passes same-UTC-day/local-next-day denial, prior-UTC-day exclusion, cross-day reservation, UTC parity, and real-store replay authority.

`P2-SAT-04`: `readBoundedJson()` validates numeric/safe/nonnegative declared length, then reads the Web `ReadableStream` incrementally. It counts raw bytes, retains no data beyond the maximum, cancels on the first crossing chunk, concatenates only bounded chunks, decodes with fatal UTF-8, and parses JSON. Tests observe early cancellation and incomplete source consumption, single-chunk rejection, bounded multi-chunk parsing, multibyte byte accounting, malformed UTF-8 rejection, pre-read header rejection, and stream authority despite under-declaration. Static route checks retain authorization-before-body ordering for create, input, page PUT, Origin/session, and CSRF gates.

Regression matrix:

```text
active create replay                               PASS
response-loss and later-success recovery           PASS
stale replay rejection/create fencing              PASS
expired/inactive/delete-pending/deleted replay      PASS — explicit unavailable
same key second Vendor side effect                  PASS — none
page pre-commit compensation                        PASS
page post-commit audit preservation                 PASS
result superseded cleanup                           PASS
result post-commit audit preservation/reload        PASS
uncertain session/IP exposure                       PASS
settled user-delete and expiry accounting           PASS
non-UTC actual PostgreSQL UTC ceiling               PASS
reserved cross-day/released exclusion               PASS
Provider A/B and unavailable historical binding     PASS
transient/terminal taxonomy                         PASS
Vendor/local cleanup and lease recovery             PASS
chunked JSON early bound/cancellation                PASS
authorization-before-body                           PASS
duplicate upload/provider payload limits            PASS
```

Fresh local verification used npm 11.6.2: `npm ci` added 451 packages and audited 452 with zero vulnerabilities; typecheck, lint, 65 files/646 tests, production build, and diff check passed. Separate Segment B 101-run, OMR 101-run, and 2-file/7-test frozen authority campaigns passed. All six frozen SHA-256 values and the 99-code registry remain exact; protected WAG/Product Core musical paths have zero diff.

No additional defect was found: `ADDITIONAL_NEW_P0=0`, `ADDITIONAL_NEW_P1=0`, `ADDITIONAL_NEW_P2=0`. Targeted unresolved counts are zero. The authoritative post-closure gate is `TARGETED_SATURATION_FINDINGS_CLOSED=YES`, `SEGMENT_D_RESATURATION_AUDIT_READY=YES`, `SEGMENT_D_ACCEPTED=NO`, `ULTRA_AUDIT_READY=NO`. Earlier acceptance/Ultra-ready text is superseded until a separate audit-only re-saturation pass succeeds. No such audit, Ultra, Step 11, real provider, production live PostgreSQL/S3, corpus calibration, or physical-device verification was performed.
