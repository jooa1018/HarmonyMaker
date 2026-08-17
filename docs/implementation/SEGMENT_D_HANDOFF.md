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
- Review has deterministic per-item alternatives and auto-repair proposals; accepted/rejected/manual/auto resolution linkage; typed pitch, duration, accidental, chord, time/key, tie, note/rest replacement, and source-text patches; canonical before projections; Source revisions; one-to-one remaps; deletion markers; and repair history. Structural barline split/merge is explicitly deferred and rejected rather than represented by the false `SourceMeasure.implicit` toggle.
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
