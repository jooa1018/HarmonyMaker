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
3. Confirm migrations `1..7` apply transactionally; restart twice and require checksum/order repeat safety.
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

## Broad final Segment D closure checkpoint

Use code checkpoint `16421f532721dcd4843717658a21f709ffcd5b81` or the verified additive handoff descendant containing this section. The exact final SHA and its GitHub Actions/Vercel identifiers are recorded in the completion response. Green repository CI/deployment proves build integrity only; it does not close a real-provider, corpus, live PostgreSQL/S3, or physical-device classification.

For a future authorized real-provider/live-service run, additionally verify the new safety boundaries:

1. Create through Provider A, rotate the active provider to B, restart the service, and complete poll/export/evidence/mapping/retention/cancel/delete/reconciliation through the persisted A binding and adapter contract version. A lost create response must resolve A before any fresh B preflight; a genuinely new job must use B.
2. Confirm the capability/consent snapshot declares actual `image/png` transfer. Upload JPEG and PNG inputs and inspect the Vendor request bytes/MIME; reject a provider that supports JPEG but not PNG.
3. Put a job into `reconciliation-required` and each retry-pending state. It must continue consuming session/IP concurrency and credit until definitive reconciliation, failure, or deletion. Restart between bounded retry attempts and verify persisted backoff/count/binding/credit.
4. Inject transient status, XML, evidence, mapping, retention, and object-store failures separately. Require recovery without terminal failure; require retry exhaustion to enter reconciliation; require explicit Vendor terminal and contract/integrity failures to remain terminal.
5. Race two canonically identical uploads at different page indices under PostgreSQL. Exactly one may commit without explicit duplicate acknowledgement. Repeat across process instances.
6. Return payloads immediately below and above each hard limit for raw XML bytes, evidence items, frames, transforms, mappings, and strings. Above-limit data must fail before expensive canonicalization or object persistence.
7. Persist a completed OMR Source with legitimate acknowledged warnings, reload it, and generate. Repeat with open/rejected-unresolved review, pending repair, altered acknowledgement, and swapped evidence target; every invalid case must fail the common persisted/generation boundary.
8. Exercise structural barline split/merge on real provider evidence. Re-export/reload and verify measure/event/performance/section/phrase IDs, SourceIdRemap, evidence targets, and correction-history replay.

Until these runs are actually authorized and performed, retain `EXTERNAL_PROVIDER_SELECTION_OR_CREDENTIAL_REQUIRED`, `EXTERNAL_OMR_CALIBRATION_CORPUS_REQUIRED`, `EXTERNAL_DATABASE_VERIFICATION_UNAVAILABLE`, `EXTERNAL_OBJECT_STORE_VERIFICATION_UNAVAILABLE`, and `EXTERNAL_DEVICE_VERIFICATION_UNAVAILABLE`.

## Targeted provider-binding and failure-taxonomy closure checkpoint

Use code checkpoint `c53a2d7f1c7b7bbffbedcb5290cd4757cd4e1735` or its verified additive handoff descendant. Repository tests now close the production-composition and terminal/transient classification invariants without selecting or integrating a real provider.

For a future separately authorized real-provider/live-service verification:

1. Register Provider A with a stable non-secret configuration generation, create a job, deploy active Provider B while retaining A historically, and verify every old-job operation uses the exact persisted A binding/version/vendor identity. Capture provider-side request logs proving B received zero A opaque job IDs.
2. Remove historical A in a later deployment and verify old A work fails closed into reconciliation without a B call. Restore the exact A binding and perform the authorized reconciliation recovery.
3. Lose an idempotent A create response, rotate active to B, and retry the identical canonical request after restart. Verify A replay occurs before any B capability or create request.
4. Inject malformed mapping schema/digest, malformed evidence graph, result/bundle/page binding mismatch, payload overflow, and explicit Vendor terminal status. Each must end failed with credit released, no retry metadata, and no repeated malformed capture.
5. Separately inject temporary provider transport/read failures and temporary S3 write failure. Verify persisted bounded retry across restart, binding/opaque ID/credit retention, successful recovery, and reconciliation only after transient exhaustion.

These external runs remain unauthorized and incomplete here. Keep the existing provider/corpus/database/object-store/device classifications open; repository CI and deterministic adapters are not real-provider accuracy or live-service evidence. Ultra, Step 11, provider selection/integration, corpus calibration, and physical-device verification were not started by this checkpoint.

## Final unavailable-binding delete/cleanup checkpoint

Use code checkpoint `f4dded0ea5ac80e0f50e730e0bc993c046e038ec` or its verified additive handoff descendant. Repository tests prove that unavailable historical-provider deletion no longer blocks HarmonyMaker-owned cleanup or cleanup-lease completion.

For a future separately authorized live provider/object-store exercise:

1. Complete an A-bound job, deploy B without historical A, then delete it. Require zero B Vendor calls, a truthful `OMR_PROVIDER_BINDING_UNAVAILABLE` result, retained A binding/version/envelope, future Vendor retry, and independently deleted page/result objects.
2. Repeat through an expired-job cleanup worker and verify the cleanup lease is cleared despite unavailable A.
3. Restore the exact historical A registration after the retry deadline. Require deletion with the original A Vendor job ID, zero B calls, final `deleted`, and envelope removal.
4. Fail A deletion transiently and verify retention uses the same A adapter while local deletion completes. Separately fail local S3 deletion after successful A deletion and verify only the local sibling retries.

These live-service checks were not authorized or performed here. Retain the external provider selection/credentials, rights-safe corpus, live PostgreSQL/S3, and physical-device classifications. Repository CI and deterministic adapters do not replace those checks. Ultra and Step 11 were not started.

## Final create-outcome certainty checkpoint

Use code checkpoint `e81c6b16d317ce00e37e3629aa57bd7461550bfb` or its verified additive handoff descendant. Repository tests and migration evidence close false expiry tombstoning for an uncertain Vendor create without selecting or integrating a real provider. Exact final-SHA GitHub Actions and Vercel identifiers are reported in the completion response.

For a future separately authorized real-provider/live PostgreSQL/S3 exercise:

1. With an idempotent Provider A, commit a create side effect and lose the response. Do not retry before expiry. Rotate active provider to B while retaining A historically, run cleanup, and prove exact A binding/version, canonical create request, and original Vendor idempotency key recover the same logical A job before A deletion. Provider B logs must show zero A create/delete/retention operations.
2. Repeat with historical A absent. Require durable `outcome-uncertain`, reserved credit/cost exposure, retained A authority and create key, future reconciliation retry, independent S3 cleanup, and released cleanup lease. Restore exact A and require final reconciliation/deletion with zero B calls.
3. With a non-idempotent A, commit the create effect and fail local Vendor-ID persistence. Expiry cleanup must perform no blind create replay, no false Vendor deletion, and no credit release; local S3 objects may delete independently. Reconcile only with provider-specific definitive authority supplied under a separate design/authorization.
4. Return a definitive create rejection before side effect. Require `definitive-no-job`, released credit, no Vendor delete at expiry, local cleanup, and final tombstone. Contrast this with transport response loss and post-effect persistence failure.
5. Restart between every transition and verify PostgreSQL `vendor_create_outcome_state`, encrypted envelope, create idempotency row, provider binding/version, cleanup lease, retry timestamp, and credit state remain mutually consistent. Verify unresolved reserved exposure remains in the global ceiling after the UTC day changes.

These external checks remain unauthorized and incomplete here. Keep `EXTERNAL_PROVIDER_SELECTION_OR_CREDENTIAL_REQUIRED`, `EXTERNAL_OMR_CALIBRATION_CORPUS_REQUIRED`, `EXTERNAL_DATABASE_VERIFICATION_UNAVAILABLE`, `EXTERNAL_OBJECT_STORE_VERIFICATION_UNAVAILABLE`, and `EXTERNAL_DEVICE_VERIFICATION_UNAVAILABLE`. Ultra and Step 11 were not started.

## Replay-certainty, exposure, and settled-credit follow-up

Use code checkpoint `a299ebb39d36d51396d0b7afcaa14b2e00d431ac` or its verified additive handoff descendant. Repository tests close the ordinary-replay, concurrency, credit, stale-completion, and cleanup-lease defects without claiming a provider-specific historical reconciliation or refund contract.

For a separately authorized provider/live-service exercise:

1. Commit an idempotent Provider A create, lose its response, then make an ordinary same-key replay return a current definitive rejection. Require durable `outcome-uncertain`, reserved credit, retained A binding/version/key, no false Vendor deletion, no active-B call, independent local cleanup, released cleanup lease, and a due future retry.
2. Exercise both same-session and same-IP quotas while those uncertain jobs are `delete-pending`. The live PostgreSQL decision must match the Memory semantic predicate and deny the new create at the configured limit.
3. Complete and settle one charged job, delete it, and attempt another create in the same UTC accounting day at ceiling one. Require the original row to remain settled and the new request to fail the global credit ceiling. Repeat with expiry cleanup.
4. Supply an explicit provider refund signal only under a separately reviewed contract. Without that authority, Vendor deletion must not convert settled cost to released. An initial authoritative no-job rejection must still release its unused reservation.
5. Pause stale create workers before pre-call marking, after the Vendor response, and before durable completion. Advance create or cleanup leases and supersede the job. Require every stale write to fail its lifecycle/outcome/lease fence and never replace confirmed, definitive-no-job, cleanup-owned, or deleted authority.
6. Crash a cleanup worker after claim. Before lease expiry, require no second claim; after expiry, require the `expired` row to be reclaimed and completed exactly once by the current lease.

These live checks remain incomplete because no real provider contract, credentials, live PostgreSQL/S3 deployment, or authoritative refund API was supplied. The repository result does not authorize Ultra, Step 11, provider selection, corpus calibration, or physical-device verification.

## Residual create-reconciliation lifecycle/fencing follow-up

Use implementation-and-test checkpoint `61dbe29e93d7a8a9857becb342090c61ff2a8981` or its verified additive documentation descendant. Repository Memory/PostgreSQL and deterministic Provider A/B campaigns close the targeted lifecycle/fencing defect. They do not replace the separately planned Segment D saturation audit or any real-provider/live-service check.

For a separately authorized provider/live-service exercise:

1. Commit an idempotent Provider A create, lose its response, make the first expired-lease replay return an ordinary definitive rejection, then make the next expired-lease replay return the original A Vendor job ID. Require an active `created` handle, `confirmed`, a durable envelope, cleared reconciliation and public failure fields, completed create idempotency, normal upload/start/status, identical handle replay, one logical Vendor job, and zero B calls.
2. Delay an earlier replay worker beyond lease expiry. Let a newer worker confirm the same A job and usable handle, then release the earlier worker with a rejection. Require the stale unresolved/completion/failure writes to report pending or superseded and preserve the newer state, envelope, cleared metadata, and completed idempotency byte-for-byte.
3. Repeat the uncertain replay through expired cleanup. Require inactive `delete-pending`, the current cleanup lease retained during recovered-ID persistence, exact A deletion, independent local deletion, no public-handle reactivation, zero B calls, and final `deleted` or truthful due `delete-pending`.
4. Exercise created, create-reconciliation, delete-pending, current/stale create lease, current/stale cleanup lease, absent/present envelope, pending/complete idempotency, definitive-no-job, and deleted authority. Require Memory and live PostgreSQL to make the same bounded decisions.
5. Preserve the first-attempt authoritative rejection case as `definitive-no-job` with released unused credit and rejected idempotency. Preserve historical replay rejection as `outcome-uncertain` with reserved credit.

Repository evidence is `npm ci`, typecheck, lint, 64 files/627 tests, build, diff check, focused 2 files/55 tests, both independent 101-run campaigns, six exact frozen hashes, and zero protected-path diff. `MIGRATION = NONE REQUIRED`.

Current gate:

```text
TARGETED_CREATE_RECONCILIATION_P1 = CLOSED
SEGMENT_D_SATURATION_AUDIT_READY = YES
SEGMENT_D_ACCEPTED = NO
ULTRA_AUDIT_READY = NO
```

## Final late-Put cleanup closure checkpoint

Use implementation-and-test checkpoint `deb61929bb260608d91999d4b4e20a1053c88dfb` or its verified four-document handoff descendant. Baseline was exact remote `1a5ab906581807c8fa1b7c6ffb7d8be46c407f86`, clean and 0/0.

Repository-controlled checks completed:

1. Start a deferred S3 Put only after durable `upload-pending` generation/token authority exists; expire the publication lease and run cleanup. Require the first delete to leave `tombstone-pending`, retain exact generation authority, and forbid terminal deletion.
2. Release the Put after the first delete. Require the returning exact generation to become delete-authorized, issue a second DeleteObject for the same key, and terminalize only after its acknowledged completion.
3. Replace the service after the first delete and before late materialization. Require a later cleanup to Head the exact tombstoned key, settle the generation, delete it, and survive restart without an orphan.
4. Fail the second delete. Require the cleanup token to release while the tombstone, generation, and exact key remain durable; the next process must retry and reach truthful terminal state.
5. Start generation B after A's first delete confirmation. Require B to become the only active logical publication; when A returns, it may only clear its retained predecessor marker and may not delete B or activate over it.
6. Race two PostgreSQL cleanup claims. Require one winner under atomic row authority, exact token/generation completion, and no stale terminal update.
7. Retain normal S3 CRUD, Put/reference/activation acknowledgement loss, stable-key restart, page/result publication and commit acknowledgement, and bounded cleanup behavior.

```text
migration inventory/checksum       PASS — 1–10; migration 10 checksum 5109c4fa0272eb7ab4de1566ce7a1055739a120e5dd2d2ce403cee1f53f63505
migrations 1–9 unchanged           PASS
deferred Fake S3 campaign          PASS — 1 file/9 tests
default suite                      PASS — 66 files/678 tests
actual PostgreSQL 17.9             PASS — 1 file/13 tests
npm ci/typecheck/lint/build/diff   PASS
Segment B 101 / OMR 101            PASS
frozen authority                   PASS — 2 files/7 tests, six hashes, 99 codes, protected diff 0
code SHA Actions                   PASS — run 32213077022, quality 95949405828
code SHA Vercel                    PASS — BNj5Ak6vdAoBbo6o7YTM3iiWrPsR
```

```text
P1_RESAT_02_LATE_PUT_CLEANUP = CLOSED
ADDITIONAL_NEW_P0 = 0
ADDITIONAL_NEW_P1 = 0
ADDITIONAL_NEW_P2 = 0
UNRESOLVED_P0 = 0
UNRESOLVED_P1 = 0
UNRESOLVED_P2 = 0
SEGMENT_D_RESATURATION_FINDINGS_CLOSED = YES
SEGMENT_D_ACCEPTED = YES
ULTRA_AUDIT_READY = YES
```

Green repository/preview evidence is not production live S3/PostgreSQL or provider certification. Real provider, rights-safe corpora, production live services, iPhone Safari, and Kakao in-app verification remain external; Ultra and Step 11 were not started.

## Re-saturation findings closure evidence

Repository software-correctness closure is complete at code checkpoint `9dea42214d87dd32c4ad5b2be02fd014937d36a1`, descended additively from exact starting HEAD `2d9fd69de1cdd0e02aba0a45b2fbcf79a566ba0b`.

- `P1-RESAT-01`: verify exact status/capture token fencing, expired-lease restart reclaim, stale transient/terminal/binding failure rejection, delete/cleanup races, and preserved completed result in Memory and PostgreSQL.
- `P1-RESAT-02`: verify migration-9 publication ledger, durable intent before put, stable key retry, fake-S3 put acknowledgement loss, create/activation acknowledgement loss, failed delete, cleanup restart/reclaim, and no deletion of active/adopted objects.
- `P1-RESAT-03`: verify manual/MusicXML/OMR discriminants, separate provenance digest, explicit legacy upgrade, and deterministic rejection of relabel/provider/review/archive/evidence/map mutations at validation, project import, local reload, and generation.
- `P2-RESAT-01`: verify malformed/obsolete/page/capability/idempotency envelope rejection, explicit reset, browser reload, deterministic 4xx classification, and retained key on network/5xx ambiguity.
- `P2-RESAT-02`: verify canonical nested input replay across Memory and PostgreSQL JSONB/restart with one Vendor side effect.
- `P2-RESAT-03`: verify int32 per-job boundary, multiplication rejection, bigint aggregate above int32, safe-integer configuration boundary, UTC reserved/settled accounting, and Memory/PostgreSQL parity.
- `P2-RESAT-04`: verify real durable complete-then-throw for start/input/cancel, cleared leases, final states, restart/read-back, and no second Vendor effect.

Local gates: npm clean install (`451` added, `452` audited, zero vulnerabilities), typecheck, lint, 66 files/674 tests, actual ephemeral PostgreSQL 17.9 migrations 1–9 and 1 file/12 tests, build, and diff check all passed. Segment B 101-run, OMR 101-run, six frozen hashes, and the exact 99-code registry passed with zero protected production musical-path change.

Code-checkpoint remote evidence: Actions run `32207987858`, quality job `95934820489`, SHA `9dea42214d87dd32c4ad5b2be02fd014937d36a1`, success; Vercel `DA6H9gRB7gnHraaQxrjZJKSVR181`, GitHub deployment `5974748420`, status `52477537126`, success, preview `https://harmony-maker-nedbdqmty-ecctom1.vercel.app`. The documentation-only descendant receives its own exact-SHA Actions/Vercel verification and is reported externally because a commit cannot contain its own SHA.

Still external and not claimed here: real provider selection/credentials and recognition accuracy; provider pricing/refund/retention/deletion contracts; rights-safe Dev/sealed corpus calibration; production live PostgreSQL/S3; iPhone Safari and Kakao in-app device verification; Ultra and Step 11.

```text
UNRESOLVED_P0 = 0
UNRESOLVED_P1 = 0
UNRESOLVED_P2 = 0
SEGMENT_D_RESATURATION_FINDINGS_CLOSED = YES
SEGMENT_D_ACCEPTED = YES
ULTRA_AUDIT_READY = YES
```

The separate Segment D saturation audit remains unperformed. Real-provider selection/credentials, provider accuracy/refund authority, rights-safe corpus calibration, live PostgreSQL/S3, and physical iPhone/Kakao verification remain external and incomplete. Ultra and Step 11 were not started.

## Saturation-findings closure verification checkpoint

Scope base is exact remote HEAD `3367e7775b029f42fc7b3372cde46e5027fee67f`; implementation-and-test checkpoint is `456312527684d419cb3ee54c3e4f031d4c2cd613`. The final handoff-inclusive SHA is the additive documentation commit containing this section and is reported with its own terminal evidence.

Repository verification completed for the four saturation findings:

1. Repeat an active completed create with the same canonical request/key and require the exact usable handle. Delete it, leave it expired before cleanup, leave deletion pending, and finish cleanup to `deleted`; each retired replay must return `OMR_CREATE_REPLAY_UNAVAILABLE`, preserve the completed idempotency authority, create no new job, and make zero additional Vendor create calls.
2. Fail `page-uploaded` audit after `completePage=true`; require uploaded state, readable object, successful page GET/start, zero post-commit object deletion, and usability after service reconstruction. Fail before page commit and require the existing compensation.
3. Fail `job-completed` audit after `completeResultCapture=true`; require completed/settled state, readable/exportable result, no capture retry/failure, zero post-commit result deletion, and usability after reconstruction. Return superseded completion and require deletion of the unreferenced result object.
4. Run actual PostgreSQL with session `TimeZone=Asia/Seoul`: settled `2026-01-01T10:00:00Z` plus a create at `2026-01-01T16:00:00Z` under ceiling one must be credit-denied. Previous UTC-day settled credit must be excluded; prior-day reserved exposure must remain counted. Repeat the same-day case under UTC.
5. Send no-`Content-Length` chunked JSON, one oversized chunk, bounded multi-chunk JSON, multibyte UTF-8, malformed UTF-8, and invalid/unsafe/oversized `Content-Length`. Require early cancellation, raw-byte authority, bounded retention, stable error codes, and authorization before consumption.

The PostgreSQL campaign is not a fake SQL substring test: GitHub Actions run `32158587762`, quality job `95781697271`, started PostgreSQL 17, applied migrations 1–8 into an isolated schema, and passed 1 file/5 tests through `npm run test:postgres`. The ordinary suite passed 65 files/646 tests. Local clean-install typecheck, lint, full tests, build, diff check, both 101-run campaigns, six frozen hashes, 99-code authority, and protected-path diff also passed. `MIGRATION = NONE REQUIRED`.

Current repository gate:

```text
P1_SAT_01 = CLOSED
P1_SAT_02 = CLOSED
P1_SAT_03 = CLOSED
P2_SAT_04 = CLOSED
TARGETED_SATURATION_FINDINGS_CLOSED = YES
SEGMENT_D_RESATURATION_AUDIT_READY = YES
SEGMENT_D_ACCEPTED = NO
ULTRA_AUDIT_READY = NO
```

The ephemeral CI database is not production live PostgreSQL. Still required externally: real provider selection and credentials; provider accuracy, pricing/refund, retention/deletion, and idempotency certification; rights-safe Dev `>=36` and sealed `>=24` corpora; production live PostgreSQL and S3-compatible storage; physical iPhone Safari and Kakao in-app browser. Do not mark these PASS from CI or Vercel success.

## Browser replay recovery and commit-ack checkpoint

Use code checkpoint `7e56e7e408f0a00aea50355943bc6c1b24bdd895` or its verified additive handoff descendant. Repository evidence closes the browser and distributed-commit residuals without changing migrations 1–8.

Repository-controlled checks completed:

1. Structured browser errors retain only HTTP status, sanitized code, and Korean message. Exact stale-handle 404 stops repeated GET and requires an explicit fresh start; network/5xx retains the handle.
2. Exact retired-create 409 removes the stale input-scoped create/recovery keys. The explicit consent-gated action creates one fresh random key and one request. Timeout/response-loss retains the original key and cannot cause blind rotation.
3. Page completion applied-then-throw uses exact durable inspection, preserves the referenced object, supports page GET/start, and makes no second Vendor upload. Precommit, unreferenced superseded, and read-back-unknown paths retain their distinct compensation/preservation rules.
4. Result completion applied-then-throw preserves completed/settled authority, the exact object, export, and single capture. Precommit, superseded, and read-back-unknown paths retain retry, cleanup, and lease recovery semantics.
5. PostgreSQL 17 Actions run `32194650587`, quality job `95896062793`, applied migrations 1–8 and passed 1 file/7 tests, including exact page/result commit inspection after an applied completion wrapper throws. The ordinary suite passed 66 files/659 tests. Code-checkpoint Vercel deployment `AD1VqDimnC17Y8nSuN7oJd1j25sN` succeeded.

For a future separately authorized real-provider/live-service exercise:

1. Lose a real create response, wait beyond handle expiry, and verify the browser presents the explicit fresh-start path without rotating the key during the ambiguous loss interval.
2. Expire or revoke a real stored handle and verify one authoritative unavailable response stops automatic recovery, while 5xx/network outages retain recovery state.
3. Inject PostgreSQL commit-ack loss after real page and result commits against production-like object storage. Require exact read-back, no referenced-object deletion, and later GET/export.
4. Inject database read-back outage after an ambiguous completion. Require object retention, lease-based recovery, and lifecycle expiry cleanup of any orphan without cross-job adoption.

```text
P1_SAT_01_BROWSER_RECOVERY = CLOSED
P1_SAT_02_COMMIT_ACK = CLOSED
TARGETED_SATURATION_FINDINGS_CLOSED = YES
SEGMENT_D_RESATURATION_AUDIT_READY = YES
SEGMENT_D_ACCEPTED = NO
ULTRA_AUDIT_READY = NO
```

The ephemeral PostgreSQL 17 service and Vercel Preview are repository evidence, not production live PostgreSQL/S3 or real-provider certification. Provider selection/credentials, recognition accuracy, pricing/refund, retention/deletion/idempotency, rights-safe Dev `>=36` and sealed `>=24` corpora, physical iPhone Safari, and Kakao in-app browser remain external.

## Browser explicit-fresh ambiguity closure checkpoint

Use implementation-and-test checkpoint `fc9ce7f930cf31f29a458b7d81f0306b26156529`, based additively on exact remote HEAD `ad0d8c5295a2a0fc0ed618d8473bedc38a4f71ab`. The final handoff-inclusive SHA is the documentation-only descendant containing this section and is reported with exact-SHA terminal evidence.

Repository-controlled checks completed:

1. Drive a stale recovery handle to `explicit-required`, click once, and require the state to become `normal` before any awaited request while the one call uses `forceFresh=true`.
2. Let K1 create one logical server job and lose the response with `TypeError`. Require K1 to remain serialized, no recovery handle before response, and the next click to use `forceFresh=false`, post K1 again, return the original handle, and remove K1 only after success.
3. Repeat with exact sanitized 503 `OMR_INTERNAL`. Require one random-key generation, one logical job, POST keys `[K1,K1]`, and no K2.
4. Return exact `409 OMR_CREATE_REPLAY_UNAVAILABLE` for explicitly generated K1. Require K1/recovery removal, `retired-create-replay` re-arm, one create call, and no automatic retry or K2 in the same action.
5. Hold the first start unresolved and issue same-tick and rapid repeated starts. Require the shared in-flight guard to admit one active create, then release after completion.
6. Retain active-handle recovery, ambiguous recovery preservation, structured API errors, backend active/retired replay, page/result commit acknowledgement, audit best effort, UTC accounting, bounded streamed JSON, and prior P1/P2 authority.

Verification result:

```text
explicit fresh success                                PASS
explicit fresh response loss                          PASS
explicit fresh 503                                    PASS
second click same K1 / random generation count 1      PASS
logical job count 1 / no K2                           PASS
exact retired K1 re-arm / no automatic retry          PASS
component state machine / duplicate-click guard       PASS
focused residual and authority campaign               PASS — 4 files/90 tests
npm ci / typecheck / lint / build / diff              PASS
default suite                                          PASS — 66 files/663 tests
actual ephemeral PostgreSQL 17.9                       PASS — 1 file/7 tests, migrations 1–8
Segment B 101 / OMR 101                                PASS
frozen authority                                       PASS — 2 files/7 tests, 0 protected-path diff
```

```text
P1_SAT_01_BROWSER_RECOVERY = CLOSED
P1_SAT_02_COMMIT_ACK = CLOSED
UNRESOLVED_P0 = 0
UNRESOLVED_P1 = 0
UNRESOLVED_P2 = 0
TARGETED_SATURATION_FINDINGS_CLOSED = YES
SEGMENT_D_RESATURATION_AUDIT_READY = YES
SEGMENT_D_ACCEPTED = NO
ULTRA_AUDIT_READY = NO
```

Do not infer provider or production certification from these checks. Full re-saturation, Ultra, Step 11, real-provider work, corpus calibration, production live PostgreSQL/S3, and physical-device verification remain outside this closure.

## Full re-saturation audit follow-up

The audit-only software-correctness re-saturation of exact baseline `59fc68573f8bef2ba48568bf23d23e726dfac300` is complete. It performed no cybersecurity assessment and made no production, test, migration, dependency, or configuration change. Repository validation remains green, but green CI does not close the following implementation work:

1. Fence terminal status and capture-failure transitions to the exact observation/lease authority, including Memory and actual PostgreSQL stale-worker regressions (`P1-RESAT-01`).
2. Give an S3 object durable cleanup authority before or atomically with publication, including the put/reference/compensation triple-failure and restart (`P1-RESAT-02`).
3. Make `ImportInfo` a true provenance discriminant and bind OMR provenance to persisted source/project integrity across import, reload, and generation (`P1-RESAT-03`).
4. Add an explicit, ambiguity-safe browser recovery action for malformed/obsolete persisted create requests without automatically rotating a possibly committed idempotency key (`P2-RESAT-01`).
5. Compare accepted Vendor input canonically across Memory and PostgreSQL JSONB, including commit-ack retry (`P2-RESAT-02`).
6. Define and enforce one bounded credit numeric domain across configuration, provider capabilities, Memory, schema, and PostgreSQL aggregation (`P2-RESAT-03`).
7. Add true apply-then-throw start/input/cancel tests, including actual PostgreSQL restart/read-back (`P2-RESAT-04`).

These repository findings are separate from the still-unperformed external verification: real provider selection and credentials; provider recognition accuracy; pricing/refund, retention/deletion, and idempotency/reconciliation contracts; a rights-safe Dev corpus of at least 36 pages and sealed corpus of at least 24 pages; production live PostgreSQL and S3-compatible storage; physical iPhone Safari; and Kakao in-app browser.

```text
CYBER_SECURITY_AUDIT = NOT_PERFORMED
P0_RESAT_COUNT = 0
P1_RESAT_COUNT = 3
P2_RESAT_COUNT = 4
SEGMENT_D_RESATURATION_AUDIT_COMPLETE = YES
SEGMENT_D_ACCEPTED = NO
ULTRA_AUDIT_READY = NO
```

## Authoritative final repository gate

The subsequent seven-finding implementation closure and `Final late-Put cleanup closure checkpoint` supersede the audit follow-up list above. At code checkpoint `deb61929bb260608d91999d4b4e20a1053c88dfb`, repository software findings are closed; the separately listed provider/live-service/corpus/device items remain external.

```text
P1_RESAT_02_LATE_PUT_CLEANUP = CLOSED
UNRESOLVED_P0 = 0
UNRESOLVED_P1 = 0
UNRESOLVED_P2 = 0
SEGMENT_D_RESATURATION_FINDINGS_CLOSED = YES
SEGMENT_D_ACCEPTED = YES
ULTRA_AUDIT_READY = YES
```

## Final cross-generation publication attribution checklist

Baseline `263adfbfeddb49d56c3e6a6bfa9e25101b3aa36e` matched exactly. Code checkpoint `6fdab1189dbe403b1e515f6607f0fe0ebbaec104` closes the sole reopened repository finding.

- [x] Every S3 Put records exact publication generation and a domain-separated authority digest bound to owner, stable key, content digest, byte size, and token.
- [x] Head inspection distinguishes current, predecessor, unknown/malformed, and not-found materialization; an unqualified object never settles current authority.
- [x] A returning Put propagates its exact token/generation and cannot remove B's token or mark B quiescent.
- [x] Two blocked generations are independently reconciled; A deletion preserves B future authority and B deletion reaches truthful terminal state.
- [x] A-process and B-process replacement variants recover from attributed metadata in Memory and actual PostgreSQL 17.11.
- [x] Generation B delete failure releases only the cleanup lease, retains durable discovery authority, and succeeds on restart retry.
- [x] B-active/A-late remains one active logical object; malformed metadata remains fail-closed under tombstone authority.
- [x] Migrations 1–10 inventory/checksums are unchanged; migration 011 is not required.
- [x] Clean npm validation passed: 66 files/683 tests; actual PostgreSQL 1 file/17 tests; typecheck, lint, build, and diff check.
- [x] Segment B 101-run, OMR 101-run, and frozen authority 2 files/7 tests passed; six hashes, 99 codes, and protected musical paths are unchanged.
- [x] Exact code SHA Actions `32216013561` / quality `95957569928` succeeded.
- [x] Exact code SHA Vercel `F7WD9sse2iJ8HYh8c4jEXBxxrQks`, GitHub deployment `5976068679`, status `16997856308` succeeded at `https://harmony-maker-mqlnlbdel-ecctom1.vercel.app`.

The containing four-document descendant is the final handoff-inclusive remote HEAD and receives separate exact-SHA Actions/Vercel verification after push.

```text
P1_RESAT_02_CROSS_GENERATION_ATTRIBUTION = CLOSED
P1_RESAT_02 = CLOSED
UNRESOLVED_P0 = 0
UNRESOLVED_P1 = 0
UNRESOLVED_P2 = 0
SEGMENT_D_RESATURATION_FINDINGS_CLOSED = YES
SEGMENT_D_ACCEPTED = YES
ULTRA_AUDIT_READY = YES
```

External verification still remaining, and not part of this closure: real-provider selection/credentials/recognition accuracy and commercial/retention/idempotency contracts; rights-safe Dev `>=36` and sealed `>=24` corpora; production live PostgreSQL/S3; physical iPhone Safari; and Kakao in-app browser.

## P1-RESAT-02-D ambiguous Put-rejection closure checkpoint

Use additive implementation-and-test checkpoint `9684b3fd230bb52e4b4a6664aeff3d9beabfea2e`, based on exact clean remote HEAD `448105417052b87e49e8adc75a0828d03db500e6`.

- [x] A generic `client.send(PutObjectCommand)` rejection after invocation begins is outcome-uncertain, never evidence of remote quiescence.
- [x] Timeout/reset/5xx/response-loss/unknown SDK errors retain `publicationPutMayStillComplete=true`, exact token, generation, and metadata authority.
- [x] Only local failure before dispatch begins can use the definitive-not-dispatched settlement path.
- [x] Same-publication retry while the generation may complete performs attributed Head recovery and dispatches no duplicate Put.
- [x] An absent-key first delete leaves `tombstone-pending`; repeated not-found or unknown metadata cannot terminalize the generation.
- [x] Reject-now/materialize-later is recovered after process replacement from durable row plus exact S3 generation metadata, then exactly deleted.
- [x] Rejected A and B generations materialize and reconcile independently; neither settles the other and final object count is zero.
- [x] Exact late-object delete failure releases cleanup claim, retains token/generation authority, and succeeds on restarted retry.
- [x] Actual PostgreSQL 17.11 repeats the uncertain row transitions and proves one-of-two cleanup claim fencing.
- [x] Existing applied-then-throw, blocked Put, current/predecessor attribution, B-active/A-late, commit-ack, and page/result regressions remain green.
- [x] Migrations 1–10 are unchanged; migration 011 is not required.
- [x] Clean validation passed: 66 files/686 tests, PostgreSQL 1 file/20 tests, typecheck, lint, build, and diff check.
- [x] Segment B 101-run, OMR 101-run, and frozen authority 2 files/7 tests passed with zero protected musical-path diff.
- [x] Exact code SHA Actions run `32218299321`, quality job `95963827595`, succeeded.
- [x] Exact code SHA Vercel `2QkeJcYTVGkKtWERX9s7Svk53eno`, GitHub deployment `5976430155`, status `16998806574`, commit status `52483102528`, succeeded at `https://harmony-maker-4ngg7awo1-ecctom1.vercel.app`.

Without a storage-adapter quiescence contract, a never-materializing uncertain request intentionally leaves one bounded durable tombstone for its logical publication. External operations may monitor/reconcile that fail-closed row, but must not convert one not-found observation or elapsed grace period into terminal authority.

The containing four-document descendant is the final handoff-inclusive remote HEAD and receives separate exact-SHA Actions/Vercel verification after push.

```text
P1_RESAT_02_AMBIGUOUS_PUT_REJECTION = CLOSED
P1_RESAT_02 = CLOSED
UNRESOLVED_P0 = 0
UNRESOLVED_P1 = 0
UNRESOLVED_P2 = 0
SEGMENT_D_RESATURATION_FINDINGS_CLOSED = YES
SEGMENT_D_ACCEPTED = YES
ULTRA_AUDIT_READY = YES
```

External verification still remaining: real-provider selection/credentials/accuracy and commercial/retention/idempotency contracts; rights-safe Dev `>=36` and sealed `>=24` corpora; production live PostgreSQL/S3; physical iPhone Safari; and Kakao in-app browser.

## P1-RESAT-02-E ambiguous Delete / physical-key isolation checkpoint

Use additive implementation-and-test checkpoint `85e8913c7095caacee6a41661fe20485343b3124`, based on exact clean remote HEAD `0da22cdb2f937a3fdcc063090c3a7d10b5217d6e`.

- [x] Logical publication identity remains stable while every new generation receives a distinct, deterministic physical S3 key.
- [x] The same generation retries its exact physical key; A, B, and C never share a Delete target.
- [x] Migration 011 durably records every generation's exact key, token, Put authority, Delete outcome, cleanup lease, and terminal state.
- [x] A generic Delete rejection after `send()` begins is stored as `outcome-uncertain`, never as proof of non-effect.
- [x] Applied-but-response-lost and rejected-with-no-remote-effect Delete variants both recover after process replacement.
- [x] A delayed generation-A remote Delete applies after C is active and removes only A; C Head/Get remain exact and readable.
- [x] A/B/C overlap survives service replacement; B late materialization and one failed retry are independently reconciled.
- [x] Cleanup can select old generations while leaving the current active lifecycle and physical key unchanged.
- [x] Reference terminalization requires all generation rows to be terminal; one logical publication has at most one active current generation.
- [x] Actual PostgreSQL 17.11 applies migrations 1–11 and verifies exact generation rows, cleanup fencing, uncertain outcome, retry, and active C read-back.
- [x] Fake S3 publication campaign passed 1 file/20 tests; full default suite passed 66 files/689 tests; PostgreSQL passed 1 file/22 tests.
- [x] Clean install, typecheck, lint, build, and `git diff --check` passed.
- [x] Segment B 101-run, OMR 101-run, and frozen authority 2 files/7 tests passed; six hashes, 99 codes, and protected musical paths are unchanged.
- [x] Exact code SHA Actions run `32223628536`, quality job `95978822774`, succeeded with all required steps.
- [x] Exact code SHA Vercel `7mLtFthrEcGb3bwrmfmHCoRFws3U`, GitHub deployment `5977312411`, status `17001152094`, commit status `52486050259`, succeeded at `https://harmony-maker-9ar7u7xkx-ecctom1.vercel.app`.

The containing four-document descendant is the final handoff-inclusive remote HEAD and receives separate exact-SHA Actions/Vercel verification after push.

```text
P1_RESAT_02_AMBIGUOUS_DELETE_REJECTION = CLOSED
P1_RESAT_02 = CLOSED
UNRESOLVED_P0 = 0
UNRESOLVED_P1 = 0
UNRESOLVED_P2 = 0
SEGMENT_D_RESATURATION_FINDINGS_CLOSED = YES
SEGMENT_D_ACCEPTED = YES
ULTRA_AUDIT_READY = YES
```

External verification still remaining, and not part of this repository-only closure: real-provider selection/credentials/recognition accuracy and commercial/retention/idempotency contracts; rights-safe Dev `>=36` and sealed `>=24` corpora; production live PostgreSQL/S3; physical iPhone Safari; and Kakao in-app browser.

## Segment D deployment-contract freeze checklist

Baseline: exact clean remote HEAD `80d598e6567a5d96e50604c561287b7f7cd94fb9`, divergence `0/0`; production code remains checkpoint `85e8913c7095caacee6a41661fe20485343b3124`.

- [x] `V0_INITIAL_PRODUCTION_DEPLOYMENT_CONTRACT` requires clean PostgreSQL and clean S3-compatible storage for first production start.
- [x] Migrations `1 -> latest` must complete before initial traffic; the first live migration/version becomes the mandatory future upgrade baseline.
- [x] Compatibility after that recorded production baseline is mandatory.
- [x] Undeployed intermediate migration fixtures, local data, and ephemeral CI data are outside the production compatibility contract.
- [x] The sole historical GitHub `Production` label points to SHA `6b579da524c802f92d5f6dd52d1e230640273cc0`, whose entire tree is one documentation file and contains no application/DB/S3 path; its deployment record says `production_environment=false`.
- [x] All 94 later GitHub/Vercel deployment records are `Preview`; there are no releases and no repository/deployment evidence of pre-011 production PostgreSQL/S3 durable data.
- [x] `P1-RESAT-02-F = NOT_APPLICABLE_PRE_PRODUCTION_LEGACY_PATH` (`SUPPORTED_DEPLOYMENT_REACHABLE=NO`, `CURRENT_SCHEMA_REACHABLE=NO`, conditional `MATERIAL_PRODUCT_IMPACT=YES`, `REQUIRES_UNSUPPORTED_HISTORICAL_STATE=YES`).
- [x] A gate blocker now requires the exact matrix `YES/YES/YES/NO` for supported reachability, current-schema reachability, material impact, and unsupported-historical-state dependency.
- [x] Current generation-specific keys, exact ledger, ambiguous Put/Delete authority, three-generation isolation, current Head/Get, cleanup restart/reclaim, and active-current protection remain green.
- [x] Fresh actual PostgreSQL 17.11 migrations `1 -> 11` passed with 1 file/22 integration tests.
- [x] Clean install, typecheck, lint, 66-file/689-test default suite, build, and diff check passed.
- [x] Segment B 101-run, OMR 101-run, and frozen authority 2 files/7 tests passed; production diff from code checkpoint is zero.
- [x] `SUPPORTED_P0=0`, `SUPPORTED_P1=0`, `NONBLOCKING_P2=0`, `HISTORICAL_NA_FINDINGS=1`.
- [x] `SEGMENT_D_FINAL_SUPPORTED_PATH_AUDIT=COMPLETE`, `SEGMENT_D_GATE_FROZEN=YES`, `SEGMENT_D_ACCEPTED=YES`, `ULTRA_AUDIT_READY=YES`.

The documentation-only containing commit receives exact-SHA GitHub Actions and Vercel terminal verification after push. Reopening requires a concrete reproducible current-code defect on a supported deployment path with P0/P1 material impact. Still external: real provider and commercial/retention evidence, rights-safe Dev/sealed corpora, production-live PostgreSQL/S3, physical iPhone Safari, and Kakao in-app browser. Ultra and Step 11 were not started.
