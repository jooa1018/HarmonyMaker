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
