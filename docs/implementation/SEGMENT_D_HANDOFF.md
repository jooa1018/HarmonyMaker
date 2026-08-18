# Segment D handoff

## Checkpoint

- Exact accepted Segment C handoff-inclusive base: `bfadfad1d4bc04e11d348c1270976802a1dc4acc`.
- Branch: `codex/harmonymaker-v0-segment-d`.
- Segment D code checkpoint: `713a5d02f1091df9d273ef16f4fb5eb7108561fc`.
- CI-stabilized verification checkpoint: `6834f1f2df7733785bd99724be5697244dd7d4b9` (test fixtures only; no production behavior changed).
- Verification-closure accepted remote HEAD: `caf5953e0c8fde9511aee020f6d4a4fd04e57a6c`.
- Verification-closure code checkpoint: `9132731c960793e24bb83544a685949733f19cdd`.
- Final handoff-inclusive remote HEAD: the additive documentation commit containing this file. Its immutable SHA is reported after that commit is pushed and its final CI/Vercel checks pass; a Git commit cannot contain its own SHA.
- Fixed musical decision: `KEEP_WAG_V1_0_1`.
- Logical Segment D implementation commit: `713a5d02f1091df9d273ef16f4fb5eb7108561fc` (`feat: complete provider-neutral OMR core`).

No commit was amended, rebased, squashed, or force-pushed. The production selector, lifecycle, Solver, marginal/pair assembly, Validator, Product Core musical selection semantics, diagnostic registry, and frozen WAG files have zero diff from the accepted base. Step 11 and the separate Ultra audit were not started.

The supplied frozen WAG ZIP SHA-256 is `9b27e30c10315622022c7d459fac3515ddd0fe2168321cd74870d941c9bc5b4b`, exactly matching the accepted Segment C authority record.

## OMR policies and limits

- Input: `omr-input-policy-v1`; MusicXML/MXL bypass, PDF, JPEG, and PNG are classified from bounded bytes plus MIME/magic.
- PDF raster: `omr-raster-policy-v1`; PDF.js legacy build, fixed scale `2`, page rotation honored, white sRGB canvas, PNG output, 0-based ordered pages, digest per rendered page. The constant gives a deterministic 2× quality/memory boundary and is independent of `devicePixelRatio`.
- Image decode: `omr-image-policy-v1`; Sharp orientation normalization, sRGB, alpha removal, metadata-free canonical PNG.
- Quality: `omr-image-quality-policy-v1`; integer basis-point blur, perspective, glare, crop-risk, and deterministic staff-space proxies. Staff space `<12 px` is retake, `12–17 px` is warning, and `>=18 px` does not add a staff-space warning.
- Limits: 32 MiB source file, 12 MiB page, 12 pages/job, 12,000 px maximum dimension, and 60,000,000 pixels.
- Normalization: `omr-normalizer-v1` through the accepted MusicXML importer and Quick Review.
- Evaluation: `hm-omr-ground-truth-v1`, `hm-omr-corpus-manifest-v1`, `hm-omr-threshold-artifact-v1`, and `hm-omr-sealed-report-v1`.

## Durable application and provider boundary

- Migrations `004_omr_core.sql` and `005_omr_recovery.sql` add durable OMR job/page state, capability snapshots, encrypted replay/vendor-job envelopes, credit state, evidence/result/retention fields, row/operation leases and fencing, reconciliation state, independent deletion retry state, lifecycle checks, expiry indexes, and audit linkage.
- Production configuration adds independent exact 32-byte `OMR_HANDLE_HMAC_KEY` and `OMR_VENDOR_JOB_ENCRYPTION_KEY`, a positive `OMR_DAILY_GLOBAL_CREDIT_CEILING`, and `OMR_PROVIDER_MODE`. Reference mode is prohibited in production. Production has no memory/filesystem fallback.
- Lifecycle: `created → uploading → queued → processing/needs-input → completed`, with sanitized `failed`, idempotent `cancelled`, `expired`, and truthful `delete-pending → deleted` paths.
- `OmrApplicationService` owns opaque signed 24-hour handles, ownership, encrypted Vendor job IDs, rights/provider-transfer consent, exact quotas, global credit reservation, exactly-once Vendor job creation, idempotent/retry-fenced page upload, needs-input replay, status sanitization, result/evidence durability, cancel, expiry, delete, and cleanup.
- Fixed quotas: 1 concurrent job/session, 2/IP, 3 jobs/session-hour, 5/IP-hour, 2 page retries, 12 pages/job, plus the deployment credit ceiling.
- `OmrVendorAdapter` is the exact provider-neutral boundary. `ReferenceOmrVendorAdapter` accepts only known page digests, is deterministic/idempotent, exercises needs-input, emits MusicXML plus real fixture evidence, and reports retention/deletion truth. It is not a recognizer and supplies no accuracy claim.
- Every mutation uses the accepted anonymous session plus exact same-origin Origin/Host and session-bound CSRF authorization.

Connected routes:

```text
POST   /api/omr/jobs
GET    /api/omr/provider-capabilities
PUT    /api/omr/jobs/:handle/pages/:pageIndex
GET    /api/omr/jobs/:handle/pages/:pageIndex
POST   /api/omr/jobs/:handle/start
GET    /api/omr/jobs/:handle
POST   /api/omr/jobs/:handle/input
GET    /api/omr/jobs/:handle/result
POST   /api/omr/jobs/:handle/cancel
DELETE /api/omr/jobs/:handle
```

## Normalization, evidence, and review

- Raw Vendor MusicXML is SHA-256 verified before the accepted safe importer is called. Completion requires durable MusicXML, recomputed evidence digest, declared-or-better evidence granularity, nonempty evidence, and retention disclosure.
- Runtime semantic readiness returns `validator-ready`, `review-required`, or `blocked`; blocking measure/timeline/tie errors never auto-ready.
- Evidence uses integer microunits, nanounit homographies, sign-restored half-up decimal quantization, normalized matrices, deterministic frame/transform/evidence ordering, ID-invariant semantic projections, shortest transform path then transform-ID tie-break, exact provider digest recomputation, revision-scoped target mapping, and a durable unmapped archive.
- The browser shows only the actual available page/staff/measure fallback and never invents symbol/measure alignment.
- Review has deterministic per-item alternatives and auto-repair proposals; accepted/rejected/manual/auto resolution linkage; typed pitch, duration, accidental, chord, time/key, tie, note/rest replacement, source-text, and real barline split/merge patches; canonical before projections; Source revisions; complete one/many/deleted remaps; and repair history. Barline changes transform measures, events, performance occurrences, sections, phrases, IDs, evidence targets, and history rather than toggling `SourceMeasure.implicit`.
- The browser carries the Vendor result and original page blobs through IndexedDB to the accepted importer, OMR evidence review, Quick Review, schema-v9 project creation, and the unchanged Product Core generation pipeline.

## Verification

Local verification at the code checkpoint:

```text
accepted Segment C baseline       PASS — 50 files, 510 tests
lockfile install                  PASS — exact graph via npm ci --ignore-scripts after local Windows cmd.exe spawn EPERM
npm audit --audit-level=high      PASS — 0 vulnerabilities
npm run typecheck                 PASS
npm run lint                      PASS
npm test                          PASS — 59 files, 558 tests
npm run build                     PASS — Next.js 16.3.0 production build, all OMR routes emitted
git diff --check                  PASS
frozen/protected authority diff  PASS — 0 changed paths
secret signature scan            PASS — 0 findings
```

The full suite includes the existing Segment B 101-complete-execution gate, Product Core project/export/share determinism, the new 101-run canonical OMR fixture pipeline, OMR-to-workspace Quick Review, and one unchanged frozen-WAG generation. The OMR gate varies session/IP/idempotency identities, timestamps, opaque handle and AEAD nonces, Vendor job ordinals, arbitrary frame/evidence IDs, and Vendor array order while requiring one page digest, Vendor result digest, provider bundle digest, SourceEvidenceIndex digest, archive digest, review result, canonical identity result, and corrected Source digest.

Browser verification on local Next.js passed:

- deterministic reference page quality PASS;
- queued/processing/needs-input/completed lifecycle and instrument response;
- measure evidence overlay, accepted importer, OMR alternative, complete Quick Review, schema-v9 workspace, one valid generated candidate, score/practice UI, and no observed console warning/error;
- truthful completed-job deletion: `local handle deleted: true`, Vendor `deleted`;
- self-authored two-page live PDF.js probe: digital classification, ordered pages, fixed 2× output at `200×300`, and both quality PASS;
- phone viewport `390×844` with no horizontal overflow.

Remote verification for code checkpoint `713a5d02f1091df9d273ef16f4fb5eb7108561fc`:

- GitHub Actions `CI` run `32000608829`, quality job `95300072553`: `success`.
- Vercel deployment `5939923221`, status `16900977339`: `success`.
- Vercel Preview Comments: `success`.
- Preview: `https://harmony-maker-6s87uzfp6-ecctom1.vercel.app`.

The first documentation-only HEAD exposed two probabilistic assertions rather than a production defect: concurrent fixture hashing did not guarantee record-array order, and replacing a random handle's last character with `0` did not guarantee a changed handle. Checkpoint `6834f1f2df7733785bd99724be5697244dd7d4b9` makes those two test fixtures deterministic. At that checkpoint, focused tests, the full 59-file/558-test suite, typecheck, lint, and production build passed locally. Remote GitHub Actions `CI` run `32001540954`, quality job `95302682451`, passed; Vercel deployment `5940071810`, status `16901345450`, and Preview Comments passed. Preview: `https://harmony-maker-bk5qn4xl9-ecctom1.vercel.app`.

The final handoff-commit CI/Vercel result is reported with `SEGMENT_D_COMPLETE` because it occurs after this document is committed.

## P1/P2 verification closure

Closure checkpoint `9132731c960793e24bb83544a685949733f19cdd` resolves P1-01 through P1-08 and the requested P2s without changing the frozen musical authority:

- item-scoped review displays every target, page, evidence reference, confidence, alternative, and resolution; rejected or unseen items remain unresolved; all unresolved items and pending repairs block handoff; mixed voice/chord/measure targets support typed correction and repair history;
- normalization now carries a separately digested `VendorNormalizationMappingArtifact`; raw IDs such as `page_1`, `staff_main`, `measure_42`, and `symbol_abc` remain raw, and only deterministic export ordinals map to canonical Source targets; unmappable evidence is archived;
- PostgreSQL transitions use row locks and expected-state validation, page/operation leases are fenced and recoverable, every provider effect has a durable crash boundary, non-idempotent uncertain effects enter reconciliation, and `maxRetriesPerPage=2` means two retries after the initial attempt;
- cancel failure remains `cancel-failed`/retryable, delete-pending cleanup is claimable after handle expiry, Vendor and S3 deletion retry independently, and disclosed `vendorDeletesAt` follow-up is durable;
- PDF bounds are checked before canvas allocation, partial raster output is discarded, staff-space is evaluated at original scale, and high-resolution/borderline/oversized/malformed parity fixtures pass;
- tie validation uses one Source-order event timeline across measure boundaries and covers valid/invalid cross-measure, pickup, and same-measure cases;
- provider capability preflight discloses identity, external transfer, retention, immediate deletion, and evidence granularity, and create is bound to the consented snapshot digest;
- confirm-page-order, bounded provider input, multi-image ordering, IndexedDB TTL/recovery, unsupported accidental/voice repair diagnostics, and OMR-derived Product Core authority rebuild are connected.

Closure verification:

```text
local npm ci                       HOST-LIMITED — Windows .cmd/process spawn EPERM
local npm ci --ignore-scripts      PASS — 447 packages, 0 vulnerabilities
direct typecheck equivalent        PASS
direct ESLint equivalent           PASS
direct full Vitest                 PASS — 61 files, 573 tests
direct Next.js production build    PASS
git diff --check                   PASS
focused closure fixtures           PASS — 9 files, 51 tests
Segment B determinism              PASS — 101 complete executions
OMR determinism                    PASS — 101 provider/governance permutations
browser item review                PASS — 3 mixed targets; rejected value blocked until manual correction
OMR → Quick Review → workspace     PASS — persisted workspace and complete validated generation
frozen/protected authority audit   PASS — 0 frozen paths, 0 protected paths changed
```

Remote verification for the exact closure code checkpoint:

- GitHub Actions CI run `32008741642`, quality job `95323564571`: `success`; exact `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` all passed.
- Vercel deployment `5941245985`, status `16904469707`: `success` (`Deployment has completed`).
- Preview: `https://harmony-maker-p0s3or6d0-ecctom1.vercel.app`.

The additive commit containing this section receives a separate final CI/Vercel run. Its immutable SHA and final statuses are reported in the Segment D completion response because a commit cannot contain its own SHA.

## External verification and non-blocking debt

In-repository Segment D is complete. Genuine external items are:

- authorized real OMR provider selection, credentials, provider-specific adapter binding, E2E, and verified Vendor deletion;
- rights-safe Dev corpus `>=36` pages and sealed holdout `>=24` pages, real-provider results, frozen thresholds, and immutable sealed report;
- live PostgreSQL migration/concurrency/recovery and private S3-compatible object lifecycle with deployment credentials;
- deployed production OMR smoke after those services and provider are configured;
- physical iPhone Safari and Kakao in-app browser.

These are recorded in `EXTERNAL_VERIFICATION_CHECKLIST.md`. No real-provider accuracy, threshold, sealed PASS, or device PASS is claimed. The documented local Windows `npm ci` postinstall spawn failure is runner-specific; unmodified remote `npm ci` passed in GitHub Actions.

## Final correctness closure

The final Segment D correctness closure starts additively from accepted remote HEAD `871b79ce7aa2efa90591e0998ed2bc194c08b2bb`. Its immutable code checkpoint is `85c6e2a78cb7e87010169b1062895870baf5ae0c`. It does not change a frozen WAG artifact, production selection path, Product Core musical-selection semantic, or the 99-code diagnostic registry.

The checkpoint completes the remaining exactness boundaries:

- the complete canonical create request, stable rights timestamp, consent/capability binding, page order/digests, source kind, and idempotency key survive response loss and are replayed exactly until a usable public handle is durably recovered; definitive rejection and idempotent/non-idempotent uncertainty have distinct durable outcomes;
- submit-input request digests, dedicated result-capture leases, page-completion state/lease checks, and cleanup leases/tokens fence competing workers; status GET is read-only and Vendor synchronization is a CSRF-protected mutation;
- normalization mappings are bound to the exact Vendor result and provider bundle, selectors preserve MusicXML part/staff/voice identity until the selected melody candidate is known, and every evidence frame is bound through a processed-to-original path to the uploaded canonical page digest;
- server quality preflight is the authoritative upload gate; the browser report remains advisory, including when the browser downsamples a high-resolution source;
- correction records retain both the original review target and the resolved application-revision target, use the latter in their stable ID, and verify remap linkage, before-projection, canonical order, and revision history across export/import and reload;
- the result screen maps evidence with `mapEvidenceBoxToNormalizedOriginal`, unsupported automatic-repair diagnostics require acknowledgment, and IndexedDB handoff reads no longer consume the record absent an actual failed decode or explicit abandonment.

Final local and focused evidence:

```text
local npm ci                       HOST-LIMITED — Windows child-process spawn EPERM
local npm ci --ignore-scripts      PASS — 447 packages, 0 vulnerabilities
direct typecheck equivalent        PASS
direct ESLint equivalent           PASS — 0 warnings/errors
direct full Vitest                 PASS — 61 files, 582 tests
direct Next.js production build    PASS — sync and quality-preflight routes emitted
npm audit --audit-level=high       PASS — 0 vulnerabilities
git diff --check                   PASS
Segment B determinism              PASS — 101 complete executions
OMR determinism                    PASS — 101 canonical permutations
correctness-focused fixtures       PASS — response loss/uncertainty, fencing/races, mapping/frame binding, high-resolution quality, correction reload
browser persisted product flow     PASS — OMR, reload/recovery, item review, Quick Review, IndexedDB workspace, generation
frozen/protected authority audit   PASS — all six SHA-256 values and semantic digests exact; 99-code registry exact; 0 protected paths changed
```

The browser flow recovered the same opaque job handle after reload, showed three mixed-target review items with their actual page/evidence/confidence, kept handoff blocked after rejecting the chord value, accepted a typed `Dm` replacement plus the remaining item resolutions, loaded the persisted schema-v9 workspace, and generated one independently validated Product Core candidate. No browser console warning or error was observed.

Remote evidence for the exact code checkpoint:

- GitHub Actions `CI` run `32017117803`, quality job `95348852985`: `success`; the unmodified workflow ran exact `npm ci`, typecheck, lint, test, and build gates.
- Vercel deployment `5942664716`, status `16908237205`: `success` (`Deployment has completed`).
- Preview: `https://harmony-maker-e6rpor2yt-ecctom1.vercel.app`.

The additive documentation commit containing this section receives its own final CI/Vercel run. Its immutable final remote SHA and terminal statuses are reported in the Segment D completion response. Real-provider accuracy, real-corpus thresholds, live PostgreSQL/S3 behavior, and physical-device behavior remain external verification items; the reference adapter remains plumbing evidence only.

## Persisted-integrity closure

This final narrow closure starts additively from accepted remote HEAD `c10ee4b43a5a25a64c3d5eae9804d2c5ef2e3f99` and produces immutable code checkpoint `8e17373b9815e17dc5c659ab535db0b46e25c71d`. It does not change a frozen WAG artifact, the 99-code diagnostic registry, or an accepted musical-selection path.

- Every asynchronous `validateSongSourceDocumentIntegrity()` call now rejects an attached OMR review record unless `validateOmrCorrectionHistory()` returns zero errors. The synchronous shape validator remains the preliminary schema gate. HarmonyProject import, project-file import, and IndexedDB/local-store reload all reach this same check through `importHarmonyProject()`.
- Tamper fixtures reject changed before-projection, correction ID, resolved application target/revision, correction order, and original review-target/remap linkage. A valid three-step chord/voice/measure correction history survives JSON Source reload, project export/import, local-store reload, and Product Core generation.
- `PreparedPage` now carries both the raw byte digest used by create/upload integrity and the authoritative preflight canonical decoded-page digest. Client duplicate detection uses only the canonical digest.
- Two deterministic JPEGs with different raw SHA-256 values but identical decoded pixels prove the browser warning/acknowledgment path and the server duplicate gate; both pages upload only after acknowledgment.

Verification evidence:

```text
npm ci                            HOST-LIMITED — lifecycle child spawn EPERM
npm ci --ignore-scripts           PASS — 451 packages installed, 452 audited, 0 vulnerabilities
direct TypeScript                 PASS
direct ESLint                     PASS — 0 warnings/errors
direct Vitest                     PASS — 61 files, 584 tests
direct Next.js production build  PASS
git diff --check                  PASS
Segment B determinism             PASS — 101 complete executions
OMR determinism                   PASS — 101 canonical permutations
history tamper/reload campaign    PASS
raw/canonical duplicate campaign PASS
browser persisted product flow   PASS — OMR review, IndexedDB reload, one validated generation candidate
frozen-authority audit            PASS — six frozen SHA-256 values, semantic digests, 99 codes, 0 protected-path changes
```

Remote code-checkpoint evidence:

- GitHub Actions `CI` run `32021883373`, quality job `95363100218`: `success`; exact remote `npm ci`, typecheck, lint, test, and build passed.
- Vercel deployment `5943490925`, status `16910436295`: `success` (`Deployment has completed`).
- Preview: `https://harmony-maker-2etxsaj0a-ecctom1.vercel.app`.

The containing handoff-only commit receives a separate final remote run and is reported as the handoff-inclusive remote HEAD after that run reaches terminal success. External classifications remain unchanged, and neither Step 11 nor the separate Ultra audit was begun.

## Persisted OMR-context integrity closure

This additive closure starts from accepted remote HEAD `c01f53f316ae99502d1d999cd584180b2af2aaa3` and produces code checkpoint `8dc0f8eedad7b5c075a95efbb4a36c707a21cd18`. It changes no frozen WAG artifact, diagnostic-registry entry, or accepted musical-selection path.

- One asynchronous persisted OMR-context validator is called by `validateSongSourceDocumentIntegrity()`. Every OMR Source must retain raw/result/provider/review/archive/index context; exact Vendor identity/result digest, current Source revision, provider granularity, evidence membership, shared frame/transform graph, index/archive digests, and the recomputed combined provider-bundle digest must agree.
- Correction-history integrity now replays every typed patch from the revision record's before-projection to its after-projection, verifies repeated-target projection continuity through `SourceIdRemap`, requires exactly one authoritative accepted review/auto-repair reference per correction, and binds an accepted auto repair to its remapped application target.
- Focused tamper fixtures reject a changed patch with recomputed correction ID, after-projection mismatch, broken same-target chain, orphan correction, wrong auto-repair target, missing/duplicated review evidence, all three evidence-digest mutations, Vendor result/ID mismatch, and removed OMR context. Valid sequential same-target plus mixed-target histories survive Source JSON, HarmonyProject, local-store/IndexedDB-equivalent reload, and generation.
- Deterministic reference and canonical-duplicate controls are rendered only when the explicit `OMR_ENABLE_REFERENCE_FIXTURE_CONTROLS=enabled` flag is present in non-production reference mode. Unit policy tests reject missing-flag, real-provider, and production exposure; a browser run with the flag absent showed zero fixture controls.

Verification evidence:

```text
npm ci                            HOST-LIMITED — lifecycle child spawn EPERM
npm ci --ignore-scripts           PASS — 451 packages installed, 452 audited, 0 vulnerabilities
direct TypeScript                 PASS
direct ESLint                     PASS — 0 warnings/errors
direct full Vitest                PASS — 62 files, 587 tests
direct Next.js production build  PASS
git diff --check                  PASS
Segment B determinism             PASS — 101 complete executions
OMR determinism                   PASS — 101 canonical permutations
persisted context/tamper campaign PASS — Source, project, local-store/IndexedDB-equivalent reload
mapping/archive round-trip        PASS
browser persisted product flow   PASS — 3 item resolutions, IndexedDB reload, one validated generation candidate
fixture-control policy           PASS — explicit dev/test reference flag only
frozen-authority audit            PASS — six SHA-256 values, semantic digests, 99 codes, 0 protected-path changes
```

Remote evidence for the exact code checkpoint:

- GitHub Actions `CI` run `32025713245`, quality job `95374571925`: `success`; exact remote `npm ci`, typecheck, lint, test, and build passed.
- Vercel deployment `5944166770`, status `16912233530`: `success` (`Deployment has completed`).
- Preview: `https://harmony-maker-3akfdt50a-ecctom1.vercel.app`.

The containing handoff-only commit receives a separate final remote run and is reported as the handoff-inclusive remote HEAD after terminal CI/Vercel success. Real-provider accuracy, rights-safe real-corpus thresholds, live PostgreSQL/S3 behavior, and physical-device behavior remain external verification items. Step 11 and the separate Ultra audit were not begun.

## Broad final P1/P2 closure handoff

Scope base is exact remote HEAD `6d8f0d17d0758d7118e7895f300cd0bdca23fa84`; code checkpoint is `16421f532721dcd4843717658a21f709ffcd5b81`. The containing additive documentation commit is the final handoff-inclusive remote HEAD, with its immutable SHA and terminal GitHub Actions/Vercel identifiers reported in the completion response.

The closure extends the existing architecture rather than adding a parallel OMR subsystem:

1. `validatePersistedOmrContext()` now requires zero unresolved review items, zero pending repairs, valid runtime semantic readiness, persistent warning acknowledgements, and exact evidence-target bindings. `generateProjectVariant()` reuses full `validateHarmonyProject()` at the common generation boundary.
2. MusicXML parsing emits an immutable identity inventory before Quick Review. `musicXmlSourceTargetMap` remaps original event/chord/text selectors across every Source revision, represents deletion explicitly, and is the only Vendor normalization route to current Source targets.
3. Structural event moves are rejected. Auto repairs reject stale original projections. Barline insert/delete performs real overfull-measure split and adjacent-measure merge with canonical Source IDs and complete measure/event/chord/text/lyric/performance/section/phrase remaps; review evidence and correction history remain linked.
4. Durable jobs persist provider binding and adapter-contract version. Old A-created jobs continue poll/export/evidence/mapping/retention/cancel/delete/recovery through A after B becomes active; create-response replay resolves A before fresh B preflight, while new jobs use B.
5. `reconciliation-required`, `sync-retry-pending`, and `capture-retry-pending` retain concurrent session/IP and credit exposure. Transient operations use persisted bounded backoff and retry counts; exhaustion moves to reconciliation without discarding provider identity or credit.
6. Provider transfer representation is always canonical PNG. JPEG-only providers fail preflight, PNG-capable providers receive an inspected `image/png` Blob, and capability sets are canonicalized before snapshot digesting.
7. Evidence granularity, concurrent duplicates, provider payload sizes/counts/string lengths, authorization-before-body, and persisted warning acknowledgement are enforced at production boundaries.

Verification truth:

```text
npm ci                            PASS — 451 packages installed, 452 audited, 0 vulnerabilities
npm run typecheck                 PASS
npm run lint                      PASS — zero warnings/errors
npm test                          PASS — 63 files, 599 tests
npm run build                     PASS — Next.js production build
git diff --check                  PASS
Segment B determinism             PASS — 101 complete executions
OMR determinism                   PASS — 101 canonical permutations
persisted readiness/generation    PASS
identity/evidence remapping       PASS — insert/delete/reorder/multi-part/multi-staff/swap
correction structural safety      PASS — replace-event, stale repair, split/merge/history
provider rotation/replay          PASS
quota/transient recovery          PASS
JPEG to canonical PNG             PASS
concurrent duplicate fencing      PASS
frozen-authority audit            PASS — six exact hashes, 99 codes, zero protected-path diff
```

No new P0, P1, or P2 finding remains from this closure. Repository verdict is `SEGMENT_D_ACCEPTED=YES` and `ULTRA_AUDIT_READY=YES`; external real-provider/corpus/live-service/device classifications remain open and are not converted into PASS claims.

## Targeted reopened P1-04 / P1-06 closure

- Exact starting remote HEAD: `782e0b39dc9c0172acce82de240210407acb1fc5`
- Prior code checkpoint below the documentation-only start: `16421f532721dcd4843717658a21f709ffcd5b81`
- New implementation-and-test checkpoint: `c53a2d7f1c7b7bbffbedcb5290cd4757cd4e1735`
- Final handoff-inclusive remote HEAD: the additive documentation commit containing this section; its SHA and terminal remote identifiers are recorded in the completion response.

Production composition now materializes exact provider bindings from `providerId + configurationGeneration + adapterContractVersion`, exposes active and historical registrations separately, and passes that registry through the real production service factory. Every existing-job Vendor operation uses the persisted binding/version/vendor triple. Generation 2 can keep A available while B is active; generation 3 without A moves an old A job to reconciliation without invoking B. Lost-response create replay uses A before B preflight/create. The focused factory campaign also asserts zero A Vendor-job-ID calls into adapter B.

The centralized failure taxonomy distinguishes `vendor-terminal`, `contract-integrity`, `transient-provider`, `transient-local`, and binding unavailability. Contract/integrity and explicit Vendor terminal outcomes release credit, clear retry metadata, and do not capture twice. Transient status/export/evidence/mapping/retention/object-store failures retain credit and binding, persist bounded retry, and can recover; exhaustion alone enters reconciliation.

Verification truth at the code checkpoint:

```text
npm ci                            PASS — 451 added, 452 audited, 0 vulnerabilities
npm run typecheck                 PASS
npm run lint                      PASS — zero warnings/errors
npm test                          PASS — 64 files, 607 tests
npm run build                     PASS — Next.js production build
git diff --check                  PASS
Segment B determinism             PASS — 101 complete executions
OMR determinism                   PASS — 101 canonical permutations
production A -> B composition     PASS
historical A unavailable          PASS — reconciliation, zero B status calls
lost A create response replay     PASS — zero B preflight/create calls
mapping schema/digest terminal    PASS — no retry, one capture attempt
evidence/integrity terminal       PASS — no retry, one capture attempt
payload/Vendor terminal           PASS — no retry
transient matrix and exhaustion   PASS
frozen-authority audit            PASS — six exact hashes, 99 codes, zero protected-path diff
```

The reopened counts are closed: `UNRESOLVED_P0=0`, `UNRESOLVED_P1=0`, `UNRESOLVED_P2=0`. Repository acceptance is `SEGMENT_D_ACCEPTED=YES` and `ULTRA_AUDIT_READY=YES`. This section does not authorize or begin Ultra, Step 11, a real provider, corpus calibration, live-service testing, or device testing.

## Final unavailable-binding delete/cleanup closure

- Exact starting remote HEAD: `193585008ddd00fc2ffef4a65bd7f5e5e7ac1674`
- Prior implementation checkpoint: `c53a2d7f1c7b7bbffbedcb5290cd4757cd4e1735`
- New code checkpoint: `f4dded0ea5ac80e0f50e730e0bc993c046e038ec`
- Final handoff-inclusive HEAD and terminal CI/Vercel identifiers: reported in the completion response for the additive documentation commit containing this section.

Root cause: the initial unavailable-A resolution entered the Vendor-delete `catch`, where a second synchronous `adapterFor(job)` call was evaluated before `.catch()` could attach to `getRetentionInfo()`. The exception escaped, skipping the local sibling deletion loop and `completeCleanup()`.

The final implementation resolves an existing-job adapter once into `available` or `binding-unavailable`. Delete and retention share the exact available adapter. Binding unavailability performs no retention lookup and persists `delete-pending`, failed Vendor deletion, future retry, sanitized `OMR_PROVIDER_BINDING_UNAVAILABLE`, and the original A binding/version/envelope. Local objects are still deleted and local-only result/evidence/mapping references are cleared. Cleanup completion releases the lease. Restoring the exact historical A registration allows the next due cleanup to delete through A, clear the envelope, and reach `deleted` when local deletion is already complete.

```text
unavailable A user delete          PASS — truthful result, zero B calls
unavailable A expired cleanup      PASS — local cleanup and lease completion
local page/result object cleanup   PASS
durable Vendor retry               PASS
A binding/version/envelope retain  PASS
historical A restoration           PASS — original A job ID, final deleted
normal A historical delete         PASS
historical A transient retry       PASS — delete/retention share A
local object-delete retry          PASS
P1-06 taxonomy regression          PASS

npm ci                             PASS — 451 added, 452 audited, 0 vulnerabilities
npm run typecheck                  PASS
npm run lint                       PASS
npm test                           PASS — 64 files, 610 tests
npm run build                      PASS
git diff --check                   PASS
Segment B 101-run                  PASS
OMR 101-run                        PASS
frozen/protected authority         PASS — six hashes, 99 codes, 0 changed paths
```

The final in-repository result is `UNRESOLVED_P0=0`, `UNRESOLVED_P1=0`, `UNRESOLVED_P2=0`, `SEGMENT_D_ACCEPTED=YES`, and `ULTRA_AUDIT_READY=YES`. External provider/corpus/database/object-store/device classifications remain open and unchanged.

## Final create-outcome certainty / expiry cleanup reconciliation closure

- Exact starting remote HEAD: `d943a0121913149c28fb8c3ebeee2519850c9899`
- Prior code checkpoint: `f4dded0ea5ac80e0f50e730e0bc993c046e038ec`
- New code checkpoint: `e81c6b16d317ce00e37e3629aa57bd7461550bfb`
- Additive persistence migration: `008_omr_create_outcome_certainty.sql`
- Final handoff-inclusive HEAD and terminal CI/Vercel identifiers: reported in the completion response.

The root cause was an invalid equivalence between `vendorJobIdEnvelope === undefined` and “Vendor job does not exist.” A Vendor call may have committed its side effect while its response or the local envelope write failed. Cleanup then entered its no-envelope no-op branch, set Vendor deletion to deleted, released credit, and removed reconciliation authority even though the external job could still exist.

The new orthogonal durable model records four states: `not-attempted`, `definitive-no-job`, `outcome-uncertain`, and `confirmed`. Memory and PostgreSQL creation, row mapping, updates, cleanup claims, and credit accounting share the model. Reserved exposure remains counted across day boundaries while unresolved. Definitive rejection remains a released-credit no-job case and can tombstone without a Vendor delete.

Idempotent uncertainty replays only through the exact stored provider binding/version with the original canonical page count and Vendor create idempotency key, persists the recovered envelope and confirmed outcome, then deletes through the same adapter. Active B receives no A preflight/create/delete/retention operation. If historical A is unavailable, cleanup persists a future retry, retains A authority and reserved credit, deletes local objects, and clears the cleanup lease. Restoring A permits reconciliation and final deletion. Non-idempotent uncertainty performs no replay and cannot reach Vendor-deleted or final deleted.

```text
idempotent uncertain create expiry     PASS
same key / same logical Vendor job     PASS
active B A-operation count             PASS — 0
historical A unavailable/restored      PASS
non-idempotent no replay/no deletion   PASS
uncertain credit through expiry/day    PASS
definitive rejection/no-envelope       PASS
local cleanup / cleanup lease          PASS
P1-04 delete regression                PASS
P1-06 taxonomy regression              PASS
Vendor/local independent retry         PASS

npm ci                                 PASS — 451 added, 452 audited, 0 vulnerabilities
npm run typecheck                      PASS
npm run lint                           PASS
npm test                               PASS — 64 files, 614 tests
npm run build                          PASS
git diff --check                       PASS
focused campaign                       PASS — 4 files, 54 tests
Segment B 101-run                      PASS
OMR 101-run                            PASS
frozen/protected authority             PASS — six hashes, 99 codes, 0 changed paths
```

The known new create-outcome P1 is closed with no additional P0/P1/P2. Final counts are zero and repository acceptance is restored. No Ultra, Step 11, real provider, corpus calibration, live PostgreSQL/S3, or physical-device work was begun.

## Final replay-certainty plus quota/credit closure

- Exact starting remote HEAD: `bd109fe552d193bfd9236c0b1403c544bbcafa0d`
- Prior code checkpoint: `e81c6b16d317ce00e37e3629aa57bd7461550bfb`
- New code checkpoint: `a299ebb39d36d51396d0b7afcaa14b2e00d431ac`
- Migration: none required
- Final handoff-inclusive HEAD and exact terminal Actions/Vercel identifiers: reported in the completion response for the additive documentation commit containing this section.

Historical create uncertainty is monotonic without explicit historical authority. A first-attempt definitive rejection remains a no-job authority; an ordinary rejection after response loss or persistence uncertainty does not. The replay path keeps uncertainty, reserved exposure, original provider authority, retry, explicit failure, truthful non-deletion, independent local cleanup, and a cleared lease. The obsolete general no-job completion mutation was removed.

`hasActiveOmrVendorExposure()` defines Memory authority and supplies the PostgreSQL lifecycle-state parameters. It counts normal active states, any uncertain create, and confirmed effects during unresolved `expired`/`delete-pending` cleanup. Settled credit never becomes released merely because data is deleted; only an unused/no-charge reservation can release under the current contract. Daily accounting remains created-day based for settled use and cross-day conservative for unresolved reservations.

Create begin/failure/completion now require expected outcome, lifecycle, create lease, cleanup lease where applicable, and absent superseding authority. Cleanup-reconciled confirmed authority is read back from the persisted envelope before deletion. Inactive cleanup rows cannot resume through create. Lease-expired `expired` rows are reclaimable after a worker crash.

```text
uncertain replay success                  PASS
uncertain replay definitive rejection     PASS — remains uncertain
false definitive-no-job/deleted prevention PASS
initial definitive no-job                 PASS — reservation released
historical A unavailable/restored         PASS
active B A-operation count                PASS — 0
uncertain reconciliation-required quota   PASS
uncertain delete-pending session quota    PASS
uncertain delete-pending IP quota          PASS
Memory/PostgreSQL exposure parity          PASS
uncertain reserved through cleanup/day    PASS
completed result settled                   PASS
settled after user delete                  PASS
settled after expiry cleanup               PASS
same-day capacity bypass prevention        PASS
Memory/PostgreSQL credit parity            PASS
stale create completion fencing            PASS
cleanup crash/lease recovery               PASS
Vendor/local independent cleanup           PASS
P1-04 unavailable-binding delete           PASS
P1-06 failure taxonomy                     PASS

npm ci                                     PASS — 451 added, 452 audited, 0 vulnerabilities
npm run typecheck                          PASS
npm run lint                               PASS
npm test                                   PASS — 64 files, 622 tests
npm run build                              PASS
git diff --check                           PASS
focused campaign                           PASS — 2 files, 50 tests
Segment B 101-run                          PASS
OMR 101-run                                PASS
frozen/protected authority                  PASS — six hashes, 99 codes, 0 changed paths
```

Final repository verdict: `UNRESOLVED_P0=0`, `UNRESOLVED_P1=0`, `UNRESOLVED_P2=0`, `SEGMENT_D_ACCEPTED=YES`, and `ULTRA_AUDIT_READY=YES`. Real-provider historical reconciliation/refund contracts, rights-safe corpus calibration, live PostgreSQL/S3, and physical-device checks remain external and incomplete. Ultra and Step 11 were not started.

## Residual create-reconciliation lifecycle/fencing targeted closure

- Exact starting remote HEAD: `f73f53bf53ac2ae25a098e51f1d903a0218d4c44`
- Prior implementation checkpoint: `a299ebb39d36d51396d0b7afcaa14b2e00d431ac`
- New implementation-and-test checkpoint: `61dbe29e93d7a8a9857becb342090c61ff2a8981`
- Migration: none required
- Final handoff-inclusive HEAD and exact terminal Actions/Vercel identifiers: reported in the completion response for the additive documentation commit containing this section.

Root cause: public replay success completed the Vendor outcome, envelope, and create-idempotency row without restoring the lifecycle or clearing create-reconciliation failure authority. It returned a handle that upload rejected, and completed idempotency replayed that same unusable handle. In parallel, replay rejection used unfenced `store.transition()`, so a delayed worker could restore uncertainty metadata after a newer worker confirmed the job.

`completeVendorCreation()` now takes an explicit completion mode. `public-handle-recovery` accepts only active `created` or `reconciliation-required/create` authority with an exact current create lease, uncertain outcome, absent envelope/cleanup lease, and pending idempotency. In one Memory critical section or PostgreSQL transaction it writes `created`, `confirmed`, the encrypted Vendor ID, clears reconciliation/public failure metadata, and completes idempotency. `cleanup-reconciliation` accepts inactive `delete-pending` authority with the exact cleanup or direct-delete lease, persists confirmation without restoring `created` or reactivating the handle, and retains cleanup ownership until `completeCleanup()`.

`markVendorCreationUnresolved()` is the only replay-rejection mutation. It fences job ID, expected public create lifecycle, uncertain outcome, exact create lease, absent Vendor envelope, active handle, absent cleanup lease, and pending create idempotency. Confirmed envelope, definitive-no-job, completed idempotency, cleanup ownership, inactive handle, different state/lease, or deletion wins and produces superseded/pending behavior without mutation. Create inspection/begin also restrict reconciliation resume to `reconciliationKind=create`.

```text
uncertain -> replay rejection -> later success   PASS
later success restores created lifecycle         PASS
later success clears reconciliationKind          PASS
later success clears public failure metadata     PASS
later success returns usable handle              PASS
recovered handle upload/start/status              PASS
identical create returns same usable handle      PASS
one logical Vendor job / original key            PASS
Provider B operation count                       PASS — 0

stale replay rejection after newer success       PASS
confirmed outcome/envelope preserved             PASS
reconciliation/failure not restored              PASS
stale complete/fail rejected                     PASS
current/stale create lease fencing               PASS

cleanup remains delete-pending during recovery   PASS
cleanup never reactivates public handle          PASS
current/stale cleanup lease fencing              PASS
cleanup crash recovery                           PASS
exact Provider A deletion / zero B calls         PASS

first-attempt definitive rejection               PASS
historical replay rejection remains uncertain    PASS
P1-05 session and IP exposure                    PASS
settled credit delete and expiry                 PASS
P1-04 unavailable binding                        PASS
P1-06 taxonomy                                   PASS
Vendor/local independent cleanup                 PASS
Memory/PostgreSQL semantic parity                PASS

npm ci                                           PASS — 451 added, 452 audited, 0 vulnerabilities
npm run typecheck                                PASS
npm run lint                                     PASS
npm test                                         PASS — 64 files, 627 tests
npm run build                                    PASS
git diff --check                                 PASS
focused campaign                                 PASS — 2 files, 55 tests
Segment B 101-run                                PASS
OMR 101-run                                      PASS
frozen/protected authority                       PASS — six exact hashes, 99 codes, zero path diff
```

No additional P0/P1/P2 was found; `UNRESOLVED_P0=0`, `UNRESOLVED_P1=0`, and `UNRESOLVED_P2=0`. The current authoritative gate deliberately supersedes the preceding acceptance/readiness statement:

```text
TARGETED_CREATE_RECONCILIATION_P1 = CLOSED
SEGMENT_D_SATURATION_AUDIT_READY = YES
SEGMENT_D_ACCEPTED = NO
ULTRA_AUDIT_READY = NO
```

The reason is procedural and explicit: a separate full Segment D saturation audit is planned after this targeted code closure. This work did not perform that audit and did not begin Ultra, Step 11, a real provider, corpus calibration, live PostgreSQL/S3, or physical-device verification.
