# External verification checklist

Run this checklist only with explicitly authorized services, rights-safe material, and deployment access. Do not treat the in-repository reference adapter or synthetic evaluation tests as external evidence.

## 1. Authorized real OMR provider

Prerequisites:

- record provider approval, pricing/credit ceiling, terms, geographic processing, retention/deletion policy, supported formats, page limit, evidence granularity, idempotency, and needs-input capabilities;
- implement only the provider-specific `OmrVendorAdapter` binding behind `OMR_PROVIDER_MODE=real`; do not change `OmrApplicationService` or Product Core semantics;
- provision independent 32-byte OMR handle/encryption keys and a positive daily credit ceiling.

Pre-deployment repository gate:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
git diff --check
```

Expected: all pass; production reference mode remains rejected; no raw Vendor job ID, provider error, credential, or result object key appears in client bundles or public JSON.

Before asking for transfer consent, call the provider-capability preflight and record the exact snapshot digest, Vendor identity/name, external-transfer flag, retention disclosure/reference, immediate-delete capability, and evidence granularity. Change any capability and confirm stale consent is rejected.

Real-provider procedure with a rights-safe self-authored score:

1. Set `OMR_PROVIDER_MODE=real`, `OMR_HANDLE_HMAC_KEY`, `OMR_VENDOR_JOB_ENCRYPTION_KEY`, `OMR_DAILY_GLOBAL_CREDIT_CEILING`, provider credentials, PostgreSQL, and S3-compatible variables in the deployment secret store.
2. Create a fresh anonymous session and use `/omr` to upload one clean page after confirming rights and provider transfer.
3. Repeat the create request with the same idempotency key and confirm one provider job/one credit reservation.
4. Repeat an identical page upload and confirm no second provider page effect; submit a conflicting digest and confirm rejection.
5. Exercise every provider-returned `needs-input` type, poll to completion, export MusicXML/evidence, and complete OMR review plus Quick Review into workspace generation.
6. Confirm evidence granularity is declared-or-better and all mappings are explicit. Use provider-native IDs that do not resemble HarmonyMaker IDs, retain those raw IDs, and verify only the validated Vendor-export-to-canonical mapping artifact creates Source targets; archive every unmappable item. A downgrade/missing bundle must fail.
7. Cancel a nonterminal job twice and confirm one safe provider effect.
8. Delete a completed job and record the exact provider result. If deletion is unsupported or fails, record returned retention policy/status rather than claiming deletion.
9. Inspect browser/network/server logs and durable rows: no raw Vendor job ID or credential crosses the server boundary; result/evidence/page objects are gone or truthfully retained.

Expected: lifecycle and cost controls pass with actual provider receipts. Record provider, adapter version, commit, deployment, timestamps, job receipt IDs in a restricted evidence store, deletion response, and sanitized public result. Until completed: `EXTERNAL_PROVIDER_SELECTION_OR_CREDENTIAL_REQUIRED`.

## 2. Rights-safe Dev and sealed corpus

Use `tests/fixtures/omr/corpus-manifest.template.json` only as a schema template. Ground truth must be created with `createOmrGroundTruthPage`; its digest is placed in each manifest entry. Do not commit copyrighted pages or sealed labels.

Harness gate:

```bash
npm test -- src/domain/omr/evaluation.test.ts
```

Expected: ground-truth codec, metric aggregation, rights/split/leakage/category gates, mock freeze prohibition, and immutable report codec pass.

Corpus procedure:

1. Assemble Dev `>=36` and sealed `>=24` rights-safe pages with auditable basis/reference and `evaluation` allowed use.
2. Give every page a unique page ID, group related renditions by song/capture ID, and keep every song/capture entirely in one split.
3. In each split include digital PDF, scanned PDF, camera photo, 4/4, 6/8, major, minor, accidentals, dotted notes, and ties.
4. Canonicalize each label with `createOmrGroundTruthPage`; create the combined manifest with `createOmrCorpusManifest`; require `validateOmrCorpusManifest(manifest)` to return `[]`.
5. Run only the authorized real provider on Dev. Compute micro/macro and structural/product metrics with `computeOmrMetricReport`.
6. Freeze thresholds once with `freezeOmrThresholdArtifact({ evidenceKind: "real-provider", manifest, ... })`. The function must reject reference/synthetic evidence.
7. Keep sealed labels unavailable until the artifact is frozen. Run the provider exactly once on sealed pages.
8. Create the immutable report with `createOmrSealedRunReport({ evidenceKind: "real-provider", manifest, thresholdArtifact, ... })`; verify its digest independently and publish both passing and failing metrics without changing thresholds.

Expected: zero leakage/errors, exact page counts/category coverage, frozen artifact bound to the Dev split digest, report bound to sealed split digest and source commit. Until completed: `EXTERNAL_OMR_CALIBRATION_CORPUS_REQUIRED`.

## 3. Live PostgreSQL and S3-compatible storage

Set secrets in a disposable nonproduction deployment, then run:

```bash
npm ci
npm run build
```

Procedure:

1. Start the app with `DATABASE_URL`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, all Segment C keys, and all OMR keys/credit variables.
2. Invoke `/api/substrate-compatibility`; require Node/pg/S3/PDF.js/Sharp readiness.
3. Confirm migrations `1..5` apply transactionally; restart twice and require checksum/order repeat safety.
4. Submit simultaneous create requests from the same session and same IP. Require exact session/IP quotas and daily credit ceiling under database concurrency.
5. Interrupt after each provider effect and before persistence: create, page upload, start, submit-input, and cancel. With provider idempotency, recover under the stable key and fence; without it, require explicit reconciliation and no blind replay. Abandon a pending page claim and require lease recovery. Confirm `maxRetriesPerPage=2` permits the initial attempt plus exactly two retries.
6. Complete a job; verify private object ownership, digest, type, size, expiry, and no public bucket/object URL.
7. Force Vendor cancel failure and require persisted cancel-pending/failure rather than `cancelled`.
8. Force Vendor delete and local S3 delete failures independently; require `delete-pending`, independent idempotent retries, sibling cleanup progress, and audit records. Expire the public handle and prove internal cleanup remains claimable.
9. Return deletion-not-supported with `vendorDeletesAt`; require a durable retry at that time. Delete/expire the OMR job and verify result/page cleanup plus truthful provider retention.

Expected: no migration drift, quota/credit oversubscription, duplicate provider effects, ownership bypass, public object exposure, or lost cleanup retry. Until completed: `EXTERNAL_DATABASE_VERIFICATION_UNAVAILABLE` and `EXTERNAL_OBJECT_STORE_VERIFICATION_UNAVAILABLE`.

## 4. Production/Vercel smoke

After sections 1 and 3 are configured, deploy the exact audit SHA and require:

```text
GitHub Actions CI                  success
Vercel deployment                 success
Vercel Preview Comments           success
/api/substrate-compatibility      200 with all readiness checks true
/omr → Quick Review → workspace   complete with the real provider
delete/retention                  exact provider result recorded
```

Record deployment ID/URL, Git commit, CI run/job, provider configuration version, and sanitized lifecycle timestamps. A green build alone does not satisfy live provider/database/object-store verification.

## 5. Physical iPhone Safari and Kakao in-app browser

Test the exact deployed SHA on at least one supported physical iPhone in Safari and Kakao in-app browser:

1. open `/omr` at portrait phone width;
2. select camera and photo-library images plus a two-page PDF;
3. verify orientation, page order, quality messages, warning acknowledgement, background/resume, and cancellation;
4. complete provider review, Quick Review, workspace generation, score/practice playback, audio unlock, pause/resume/reset, and export/download;
5. delete the OMR job and local project; verify truthful UI and no stale data after reload;
6. capture OS/browser/app versions, viewport, console/network evidence where available, screenshots, and result.

Expected: no horizontal overflow, picker failure, lost page/order, duplicate submission, memory crash, stale handle, blocked audio, or failed user-initiated download. Until completed: `EXTERNAL_DEVICE_VERIFICATION_UNAVAILABLE`.
