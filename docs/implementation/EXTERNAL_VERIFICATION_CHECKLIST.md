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
3. Confirm migrations `1..6` apply transactionally; restart twice and require checksum/order repeat safety.
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

## Final correctness-closure checkpoint

Use code checkpoint `85c6e2a78cb7e87010169b1062895870baf5ae0c` or its verified additive handoff descendant. GitHub Actions run `32017117803`/quality job `95348852985` and Vercel deployment `5942664716`/status `16908237205` passed for the exact code checkpoint. These green build results do not satisfy any real-provider, real-corpus, live-service, or physical-device item above.

When sections 1 and 3 become authorized, additionally exercise the final recovery/fencing boundaries against the real services:

1. Lose the create HTTP response and separately lose the Vendor response before local persistence. Verify the same stored canonical request and idempotency key are replayed byte/semantically unchanged until a usable public handle is durably recovered.
2. Return a definitive Vendor rejection and verify it is not retried. Return uncertain transport outcomes with and without provider idempotency; require resumable replay only for the former and explicit reconciliation for the latter.
3. Race result capture workers, page completion with delete, and two cleanup workers. Verify operation request digests, lease tokens, fencing generations, and cleanup completion reject stale writers.
4. Submit a different provider-input payload after an abandoned lease and require a request-digest conflict rather than accidental replay.
5. Return multi-part/multi-staff evidence with real Vendor IDs. Verify mapping binds the exact provider bundle/result and selected MusicXML part/staff/voice, while every frame page/digest reaches the uploaded canonical page; stale/unmappable evidence must archive or fail closed.
6. Compare browser-downscaled and server-decoded high-resolution inputs. The server preflight report must remain the final quality gate for blur, perspective, glare, crop risk, and 12/18-pixel staff-space boundaries.
7. Apply sequential mixed-target corrections across Source revisions, restart, export/import, and verify correction order, before-projection, original target, resolved target, and SourceIdRemap linkage.

Until those authorized external runs occur, retain the existing external classifications and do not turn deterministic reference-adapter behavior into a provider-accuracy claim.

## Persisted-integrity closure checkpoint

Use code checkpoint `8e17373b9815e17dc5c659ab535db0b46e25c71d` or its verified additive handoff descendant. GitHub Actions run `32021883373`/quality job `95363100218` and Vercel deployment `5943490925`/status `16910436295` passed for that exact code checkpoint. These repository/deployment build results do not close any authorized real-provider, real-corpus, live-service, or physical-device item.

For future authorized provider/service verification, retain both page digests in the evidence record:

1. Record the raw byte SHA-256 bound to the create request and upload.
2. Record the authoritative server-preflight canonical decoded-page digest used for evidence and duplicate comparison.
3. Upload two raw-distinct encodings of identical decoded content. Require a duplicate warning and explicit acknowledgment, then verify both raw uploads remain integrity-bound while both canonical page digests compare equal.
4. Export a project with sequential mixed-target OMR corrections, tamper each of before-projection, correction ID, resolved target/revision, correction order, and original review-target/remap linkage, and verify Source load, project-file import, and IndexedDB reload all reject it through the same integrity gate.
5. Reload an untampered sequential history and verify correction replay plus Product Core generation remain valid.

Until external sections 1–5 are actually performed with authorization, classifications remain `EXTERNAL_PROVIDER_SELECTION_OR_CREDENTIAL_REQUIRED`, `EXTERNAL_OMR_CALIBRATION_CORPUS_REQUIRED`, `EXTERNAL_DATABASE_VERIFICATION_UNAVAILABLE`, `EXTERNAL_OBJECT_STORE_VERIFICATION_UNAVAILABLE`, and `EXTERNAL_DEVICE_VERIFICATION_UNAVAILABLE`.

## Persisted OMR-context integrity closure checkpoint

Use code checkpoint `8dc0f8eedad7b5c075a95efbb4a36c707a21cd18` or its verified additive handoff descendant. GitHub Actions run `32025713245`/quality job `95374571925` and Vercel deployment `5944166770`/status `16912233530` passed for the exact code checkpoint. These repository/deployment build results do not close any real-provider, real-corpus, live-service, or physical-device item.

For every future authorized real-provider/export sample, retain and verify the canonical persisted context now required by the repository:

1. Record the raw Vendor result digest, Vendor ID, declared evidence granularity, review record, SourceEvidenceIndex, and OmrEvidenceArchive.
2. Recompute the mapped index digest, unmapped archive digest, and combined provider-bundle digest from both evidence partitions plus their shared frames/transforms. Require current exact Source revisions and exactly-one review evidence membership.
3. Export and reload sequential same-target and mixed-target corrections. Reapply every typed patch to before-projection, compare after-projection, follow `SourceIdRemap`, and require exactly one accepted review/manual/auto-repair authority reference.
4. Tamper Vendor/result identity, evidence membership/digests, correction patch/projection/chain/reference/remap, and remove each OMR context member. Require Source load, project-file import, and IndexedDB reload to fail through the same asynchronous integrity boundary.
5. Confirm deterministic reference and duplicate fixture controls are absent in production and whenever the selected provider is real, regardless of any development flag.

Until external sections 1–5 are actually performed with authorization, retain `EXTERNAL_PROVIDER_SELECTION_OR_CREDENTIAL_REQUIRED`, `EXTERNAL_OMR_CALIBRATION_CORPUS_REQUIRED`, `EXTERNAL_DATABASE_VERIFICATION_UNAVAILABLE`, `EXTERNAL_OBJECT_STORE_VERIFICATION_UNAVAILABLE`, and `EXTERNAL_DEVICE_VERIFICATION_UNAVAILABLE`. Do not convert deterministic reference-adapter integrity evidence into provider-accuracy evidence.
