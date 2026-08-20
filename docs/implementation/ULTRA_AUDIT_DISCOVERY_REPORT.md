# HarmonyMaker Ultra whole-repository discovery audit

이 문서는 exact frozen baseline에서 수행한 **discovery-only** 소프트웨어 정확성·신뢰성·내구성·권위 감사 결과다. Finding은 이 세션에서 수정하지 않았다. 보안 침투 시험, 실제 외부 OMR provider 호출, production-live 서비스 및 실기기 검증은 수행하지 않았다.

## A. Baseline

```text
REPOSITORY = jooa1018/HarmonyMaker
MAIN_HEAD = b4e14976ab65899cc86a65c20c99a7545f1a0d9e (origin/main)
ULTRA_BRANCH = codex/harmonymaker-ultra-audit
ULTRA_BRANCH_HEAD = b4e14976ab65899cc86a65c20c99a7545f1a0d9e
MAIN_ULTRA_DIVERGENCE = 0/0
WORKTREE = CLEAN
HISTORY_REWIND = NO
CODE_AUTHORITY = 85e8913c7095caacee6a41661fe20485343b3124 (ANCESTOR, production diff 0)
SEGMENT_C_BASE = bfadfad1d4bc04e11d348c1270976802a1dc4acc (ANCESTOR)
SEGMENT_D_GATE_FROZEN = YES
SEGMENT_D_ACCEPTED_AT_START = YES
ULTRA_AUDIT_READY_AT_START = YES
STEP_11_STARTED = NO
```

Remote fetch 후 두 remote branch의 exact SHA, 0/0 divergence, 두 authority commit의 ancestry, clean worktree를 확인했다. 제한된 기존 fetch refspec 때문에 `origin/main`과 Ultra ref를 명시적으로 fetch했지만 history를 reset, merge, rebase, amend 또는 force-update하지 않았다.

## B. Audit contract

```text
AUDIT_TYPE = WHOLE_REPOSITORY_SOFTWARE_CORRECTNESS_RELIABILITY_DISCOVERY
DISCOVERY_ONLY = YES
CYBER_SECURITY_AUDIT = NOT PERFORMED
PRODUCTION_CODE_CHANGES = 0
TEST_CHANGES = 0
MIGRATION_CHANGES = 0
EXTERNAL_PROVIDER_CALLS = 0
DEPLOYMENT_CONTRACT = clean PostgreSQL/S3, migrations 1 -> latest before traffic,
                      current latest schema and supported current restart/retry/concurrency paths
```

Source-of-truth 순서는 다음과 같이 적용했다.

1. exact current repository
2. `docs/HARMONYMAKER_SPEC_v3.1.5.md`
3. frozen WAG v1.0.1 authority
4. deployment contract freeze
5. current domain/store/application contracts
6. production composition
7. migrations/schema
8. automated tests
9. Segment A/B/C/D handoff/evidence
10. prior reports

지원되지 않은 pre-production migration 중간 상태, 미연결 real provider 자체, corpus·live service·실기기 미검증 자체는 blocker로 만들지 않았다. 모든 P1은 `SUPPORTED/CURRENT/MATERIAL/HISTORICAL = YES/YES/YES/NO`를 충족한다.

## C. Audit passes

```text
PASS_1_INVENTORY = COMPLETE
PASS_2_STATIC_CONTRACT = COMPLETE
PASS_3_STATE_MACHINE = COMPLETE
PASS_4_FAILURE_BOUNDARY = COMPLETE
PASS_5_END_TO_END = COMPLETE
PASS_6_TEST_GAP = COMPLETE
```

### Repository/subsystem inventory

| Subsystem | Input | Authoritative state | Output/persistence | Retry authority/downstream |
|---|---|---|---|---|
| MusicXML/MXL import | XML/ZIP bytes | normalized `SongSourceDocument`, import provenance | Quick Review draft/project | explicit review state; project generation |
| OMR browser/domain | image/PDF pages | page digest/order, durable recovery envelope, job handle | API jobs, evidence/review handoff | browser K/handle plus server operation leases |
| OMR application | actor/job/provider binding | PostgreSQL `omr_*` rows and provider snapshot | pages/status/result/delete | idempotency, claim tokens, leases, cleanup |
| Object storage | page/result bytes | publication/generation ledger | S3 object plus DB reference | exact generation token, Head reconciliation, cleanup |
| Project/domain | source, performer/config, generation/edit | current-schema `HarmonyProject` | IndexedDB/export/share | integrity validator and version registry |
| Grammar/generation | canonical source and WAG config | frozen WAG/registry/hash authority | candidates, diagnostics, metrics | deterministic digests and lifecycle |
| Product Core | project/preset/edit | variants, active arrangement, snapshots | render/playback/export | reload validation, regeneration boundary |
| Share/session | session, share payload | PostgreSQL session/share/idempotency/quota rows | URL/store share and practice page | encrypted replay envelope, expiry/delete/cleanup |
| HTTP/UI | browser actions | route/service contract and client state | structured response/UI state | caller-held recovery identity |
| Runtime/deployment | env/DB/S3/provider config | one production composition root | Next/Vercel/API | migrations, scheduler/worker, CI |

State-machine review는 create/upload/start/status/capture/cancel/delete/cleanup, project load/generate/edit/share, import/review/handoff를 대상으로 정상·중복·충돌·응답 유실·restart·stale worker·lease expiry·cleanup·user delete를 추적했다. Failure-boundary review는 local/external effect 전후, DB commit acknowledgement loss, ambiguous Put/Delete, audit failure, process exit와 browser reload를 포함했다.

### End-to-end flows

| Flow | Result |
|---|---|
| MusicXML/MXL → normalize → Quick Review → project → generation → edit → render/playback/export | COMPLETE; P1-ULTRA-01/03 및 P2-ULTRA-01/02/04/05/06 발견 |
| OMR image → create/upload/start/status/result/evidence → review → project | COMPLETE; P1-ULTRA-06..09 및 P2-ULTRA-13..15 발견 |
| Project/arrangement → share create/replay → public load → playback/delete/report/expiry | COMPLETE; P1-ULTRA-04/05 및 P2-ULTRA-03/07..11 발견 |
| Durable transition → process/browser restart → retry/completion/cleanup | COMPLETE; caller replay와 cleanup entrypoint 결함 발견 |

## D. Coverage matrix

`COMPLETE`는 해당 영역의 code/spec/tests/production caller를 감사했다는 뜻이며 defect-free를 뜻하지 않는다.

```text
SPEC_AUTHORITY = COMPLETE
CORE_DOMAIN = COMPLETE
DIGEST_IDENTITY = COMPLETE
MUSICXML_MXL = COMPLETE
OMR_DOMAIN = COMPLETE
OMR_SERVER = COMPLETE
OMR_BROWSER = COMPLETE
PERSISTENCE = COMPLETE
OBJECT_STORAGE = COMPLETE
GRAMMAR_GENERATION = COMPLETE
PRODUCT_CORE = COMPLETE
SHARE_SESSION = COMPLETE
API_UI = COMPLETE
CONFIG_COMPOSITION = COMPLETE
CI_DEPLOYMENT = COMPLETE
CROSS_SUBSYSTEM = COMPLETE
```

Frozen six-file hashes, WAG semantics, preset/diagnostic/99-code registries와 protected musical selection path는 exact하게 유지됐다. Current migrations 1–11은 PostgreSQL 17.11 fresh cluster에서 통과했다. 실제 provider/corpus/live storage/device 결과는 범위 밖으로 남겼다.

## E. Finding summary

```text
P0_ULTRA_COUNT = 0
P1_ULTRA_COUNT = 9
P2_ULTRA_COUNT = 15
TG_ULTRA_COUNT = 7
NOT_APPLICABLE_COUNT = 1
DUPLICATE_ROOT_COUNT = 1
ROOT_CAUSE_CLUSTER_COUNT = 24
```

| Severity | IDs | Root summary |
|---|---|---|
| P1 | 01–09 | snapshot semantic integrity; workspace key identity; MusicXML timing export; ShareStore caller recovery; absent cleanup runner; OMR create ambiguity; provider delete certainty; PostgreSQL failPage atomicity; upload-stage historical binding |
| P2 | 01–15 | browser persistence/consumer/serialization/UX, share API/runtime/deployment/moderation/docs, OMR browser/status completeness |
| TG | 01–07 | reload/derived evidence/canonical keys/phrase coverage/provider input bounds/real-PG parity/runtime pinning |

OMR와 share 양쪽에서 발견한 “production cleanup entrypoint 없음”은 P1-ULTRA-05 한 root로만 집계했다. 이전 `P1-RESAT-02-F` unsupported historical branch는 `NOT_APPLICABLE` 1건으로 유지했다.

## F. Findings

### P1-ULTRA-01

```text
TITLE = edited snapshot material authority is accepted without semantic rederivation
SEVERITY = P1
EVIDENCE_STRENGTH = PROVEN

SUPPORTED_DEPLOYMENT_REACHABLE = YES
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = YES
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO

INVARIANT = snapshot tracks/status/metrics/diagnostics/contentDigest must be the exact
            materializer+validator result for its base candidate and applied edits
ROOT_CAUSE = validateSnapshots verifies shape/references/ranges and edit-set digest but does not
             reapply edits, recompute contentDigest/metrics/diagnostics/status, or compare tracks
AFFECTED_SUBSYSTEMS = project integrity, persistence/reload, edit, render, playback, export, share
EXACT_FILES = src/domain/project-integrity.ts:752-816; src/domain/project.ts:410-427;
              src/product/project-transfer.ts:44-55; src/product/render.ts:22-49,80
EXACT_FUNCTIONS = validateSnapshots; isEditedSnapshot; exportHarmonyProject;
                  importHarmonyProject; activeArtifact; materializeActiveArrangement;
                  canDefaultExportOrShare
EXACT_STATE_FIELDS = generatedHarmonyTracks, realizedAnchors, metrics,
                     validationDiagnostics, status, contentDigest, appliedEditIds

FAILURE_SEQUENCE = make valid snapshot -> persist/export -> alter a stored pitch to C9 while
                   retaining digest/status/evidence -> import/reload validation completes ->
                   render/share/export trusts altered tracks under stale original identity
REPRODUCTION_OR_PROBE = inline Vite SSR probe; tamperedStatus=complete,
                        reloadedMutatedPitch=C9, storedDigestUnchanged=true,
                        renderedArtifactDigest equals originalSnapshotDigest
EXPECTED_RESULT = deterministic rejection or exact rederived snapshot identity/evidence
ACTUAL_RESULT = changed musical material is valid/exportable/renderable under the old digest

USER_OR_PROVIDER_IMPACT = saved/reloaded arrangement can play and share different notes than its identity asserts
DATA_OR_AUTHORITY_IMPACT = active edited musical authority and validation evidence diverge
DETERMINISM_IMPACT = same authoritative digest identifies different rendered content

CURRENT_TEST_COVERAGE = product-core.test.ts:225-245 validates genuine materializer output
CURRENT_TEST_GAP = no current-schema snapshot track/evidence mutation or import/reload counterexample
WHY_EXISTING_TESTS_PASS = tests never separate persisted derived material from its original producer

MINIMAL_REQUIRED_FIX = rederive snapshot from base candidate+immutable edits and compare every derived field
ARCHITECTURAL_FIX_IF_REQUIRED = make edits/base authority canonical and snapshot material a verified cache
REGRESSION_TESTS_REQUIRED = mutate track/pitch/anchors/metrics/diagnostics/status/digest across export,
                            import, IndexedDB reload, render and share gates
MIGRATION_REQUIRED = NO

INDEPENDENT_OR_DUPLICATE_ROOT = INDEPENDENT
RELATED_PRIOR_FINDING = P1-RESAT-03 provenance closure remains closed; this is a new snapshot-semantic root
CONFIDENCE = HIGH
```

### P1-ULTRA-02

```text
TITLE = workspace route project identity can diverge from displayed and persisted project
SEVERITY = P1
EVIDENCE_STRENGTH = PROVEN

SUPPORTED_DEPLOYMENT_REACHABLE = YES
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = YES
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO

INVARIANT = displayed project authority and IndexedDB/project route key must transition atomically
ROOT_CAUSE = query projectId changes without clearing project state; saveProject closes over the new key
AFFECTED_SUBSYSTEMS = workspace UI, local persistence, project reload/edit/generation
EXACT_FILES = src/app/workspace/WorkspaceClient.tsx:67-104,89-93
EXACT_FUNCTIONS = WorkspaceClient load effect; saveProject and all callers
EXACT_STATE_FIELDS = projectId, project, message, IndexedDB project row key

FAILURE_SEQUENCE = load A -> query-only navigation/back-forward to B -> A remains during B read and
                   indefinitely if B missing/rejected -> edit/generate/select/save -> save A under B
REPRODUCTION_OR_PROBE = exact contradictory React transition traced through effect and closure;
                        no unsupported browser behavior is required for same-route search-param navigation
EXPECTED_RESULT = clear/disable A until B is loaded, and bind save to the loaded record identity
ACTUAL_RESULT = UI shows A while every mutation writes with B key, overwriting or fabricating B

USER_OR_PROVIDER_IMPACT = normal navigation can overwrite another local project or create a mislabeled project
DATA_OR_AUTHORITY_IMPACT = project content and durable project ID are mixed
DETERMINISM_IMPACT = subsequent reload outcome depends on navigation/read timing

CURRENT_TEST_COVERAGE = local project store direct round-trip tests
CURRENT_TEST_GAP = no component test for A→B transition, missing/corrupt B, slow read, or mutation race
WHY_EXISTING_TESTS_PASS = store tests always pass matching explicit key and project value

MINIMAL_REQUIRED_FIX = reset project on key change, ignore stale completions, disable mutations, assert loaded ID on save
ARCHITECTURAL_FIX_IF_REQUIRED = route-keyed reducer/load state carrying {requestedId,loadedId,project}
REGRESSION_TESTS_REQUIRED = query navigation/back-forward, slow/missing/rejected B and save-race tests
MIGRATION_REQUIRED = NO

INDEPENDENT_OR_DUPLICATE_ROOT = INDEPENDENT
RELATED_PRIOR_FINDING = aggregate PROJECT_RELOAD
CONFIDENCE = HIGH
```

### P1-ULTRA-03

```text
TITLE = MusicXML export loses pickup and mixed-meter timing authority on supported reimport
SEVERITY = P1
EVIDENCE_STRENGTH = PROVEN

SUPPORTED_DEPLOYMENT_REACHABLE = YES
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = YES
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO

INVARIANT = export/import must preserve exact SourceMeasure duration and canonical 4/4↔6/8 meter changes
ROOT_CAUSE = exporter emits time only in measure 0 and never emits pickup implicit authority;
             ABC serializer emits one global meter; export input omits project tempo
AFFECTED_SUBSYSTEMS = Product export, MusicXML import, Source timing, score display, playback
EXACT_FILES = src/product/musicxml-export.ts:172-188; src/import/musicxml/parser.ts:522-524,
              599-600,753-760; src/import/review/quick-review.ts:130-139;
              src/product/score-adapter.ts:52-85; docs/HARMONYMAKER_SPEC_v3.1.5.md:633-640,1403
EXACT_FUNCTIONS = partXml; parseMeasure; supportedPlanningMeter; arrangementRenderDocumentToAbc
EXACT_STATE_FIELDS = measure.meter, measure.duration, measure.implicit, tempo

FAILURE_SEQUENCE = export valid 4/4 then 6/8 arrangement -> only first time signature emitted ->
                   reimport inherits 4/4 and expands second duration to 4; or export 1-quarter pickup ->
                   no implicit marker -> reimport expands duration to 4
REPRODUCTION_OR_PROBE = inline Vite probes: {timeElementCount:1,secondMeasureHasTime:false,
                        reimportedTimes:["4/4:4/1","4/4:4/1"]};
                        {exportedImplicit:false,reimportedDuration:"4/1",reimportedImplicit:false}
EXPECTED_RESULT = meter/duration/pickup/tempo round-trip exactly
ACTUAL_RESULT = supported musical timing is rewritten and ABC view assumes the wrong global meter

USER_OR_PROVIDER_IMPACT = exported arrangement reopens with wrong bar lengths/meter and needs manual repair
DATA_OR_AUTHORITY_IMPACT = current active timing authority is lost at a supported product boundary
DETERMINISM_IMPACT = deterministic but non-identity-preserving serialization

CURRENT_TEST_COVERAGE = product-core.test.ts:362-372 exports/reimports uniform full measures
CURRENT_TEST_GAP = pickup, meter transition and tempo equality assertions
WHY_EXISTING_TESTS_PASS = fixture uses one meter/full bars and checks only review-required outcome

MINIMAL_REQUIRED_FIX = emit each time change and pickup/implicit duration authority; include tempo
ARCHITECTURAL_FIX_IF_REQUIRED = one canonical render/export timing model shared by MusicXML, ABC and playback
REGRESSION_TESTS_REQUIRED = 4/4↔6/8, pickup/incomplete measure, tempo and export/import/reload equality
MIGRATION_REQUIRED = NO

INDEPENDENT_OR_DUPLICATE_ROOT = INDEPENDENT
RELATED_PRIOR_FINDING = aggregate PROJECT_RELOAD/export-import, not an unsupported legacy state
CONFIDENCE = HIGH
```

### P1-ULTRA-04

```text
TITLE = ShareStore browser caller loses idempotency and owner-delete authority after response loss/reload
SEVERITY = P1
EVIDENCE_STRENGTH = PROVEN

SUPPORTED_DEPLOYMENT_REACHABLE = YES
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = YES
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO

INVARIANT = a committed share create with lost acknowledgement must replay K1 and recover the same
            token/owner-delete secret; fresh intent alone may create K2
ROOT_CAUSE = WorkspaceClient generates random K inside every click and stores response authority only in React state
AFFECTED_SUBSYSTEMS = workspace browser, ShareStore, idempotency/quota, owner deletion
EXACT_FILES = src/app/workspace/WorkspaceClient.tsx:86-93,249-278;
              src/server/share/idempotent-create.ts:15-52;
              src/server/share/share-store-core.ts:80-115;
              src/server/persistence/postgres-store.ts:102-159
EXACT_FUNCTIONS = createShare; deleteStoredShare; createShareIdempotently;
                  createAndCompleteIdempotency; replayIdempotentCreate
EXACT_STATE_FIELDS = idempotencyKey, shareUrl, storedShare.token, ownerDeleteSecret,
                     idempotency_records.*, share_records.lifecycle

FAILURE_SEQUENCE = stored-share-sized payload -> POST K1 -> share+encrypted replay commit -> response lost/reload ->
                   K1/token/delete secret absent in browser -> retry K2 -> second active share;
                   first share remains owner-undeletable until expiry
REPRODUCTION_OR_PROBE = exact current caller/service/transaction sequence; backend tests demonstrate replay only
                        when the caller supplies the same key, which this browser cannot do after loss
EXPECTED_RESULT = durable pre-effect K1 envelope and post-commit recovery of the same response/delete authority
ACTUAL_RESULT = orphan share, duplicate share/quota effect, and permanent loss of first owner-delete authority

USER_OR_PROVIDER_IMPACT = response loss or successful-page reload makes normal owner recovery/deletion impossible
DATA_OR_AUTHORITY_IMPACT = duplicate active durable records and inaccessible deletion credential
DETERMINISM_IMPACT = logical retry outcome changes with response timing

CURRENT_TEST_COVERAGE = share-store.test.ts:90-140 reuses one fixed key at Memory service layer
CURRENT_TEST_GAP = Browser→route→PostgreSQL commit-ack loss, reload, replay and delete
WHY_EXISTING_TESTS_PASS = tests inject K1 directly and never execute client key generation/persistence

MINIMAL_REQUIRED_FIX = persist a versioned request envelope/K1 before POST; reuse it on ambiguous/network/5xx;
                       persist returned token/delete authority; rotate only on explicit fresh intent
ARCHITECTURAL_FIX_IF_REQUIRED = shared durable browser operation protocol like OMR recovery
REGRESSION_TESTS_REQUIRED = DB commit applied/response lost/reload/same response/one share/owner delete
MIGRATION_REQUIRED = UNKNOWN

INDEPENDENT_OR_DUPLICATE_ROOT = INDEPENDENT
RELATED_PRIOR_FINDING = P1-SAT-01 backend replay remains closed; aggregate BROWSER_RECOVERY reopens
CONFIDENCE = HIGH
```

### P1-ULTRA-05

```text
TITLE = production cleanup and retry authorities have no reachable scheduler/worker entrypoint
SEVERITY = P1
EVIDENCE_STRENGTH = PROVEN

SUPPORTED_DEPLOYMENT_REACHABLE = YES
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = YES
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO

INVARIANT = expired/retry-pending lifecycle, object cleanup and accounting reconciliation must be invoked durably
ROOT_CAUSE = production composition constructs cleanup services but no route, cron, worker or script calls them
AFFECTED_SUBSYSTEMS = session/share/idempotency/quota, OMR cleanup, PostgreSQL, S3, deployment
EXACT_FILES = src/server/cleanup/cleanup-service.ts:8-28;
              src/server/persistence/postgres-store.ts:545-613;
              src/server/omr/application-service.ts:940-951;
              src/server/omr/postgres-store.ts:685-723;
              src/server/substrate/services.ts:18-25,29-68; vercel.json:1-4; package.json scripts
EXACT_FUNCTIONS = CleanupService.run; PostgresGovernanceStore.cleanup;
                  DurableOmrApplicationService.cleanupExpiredJobs; claimCleanup; completeCleanup
EXACT_STATE_FIELDS = session/share/idempotency/quota expiry; object delete/upload/tombstone states;
                     OMR cleanupLeaseToken, delete/reconciliation/retry states, exposure/credit

FAILURE_SEQUENCE = row/object/job expires or enters retry/delete-pending -> no production invocation occurs ->
                   DB/S3/OMR cleanup and reserved accounting never advance; expired public handle cannot invoke delete
REPRODUCTION_OR_PROBE = repository-wide non-test caller search: services.cleanup, cleanup.run and
                        cleanupExpiredJobs callers = 0; Vercel cron and package worker = 0
EXPECTED_RESULT = bounded scheduled entrypoint with retry/backoff/metrics and restart-safe lease reclaim
ACTUAL_RESULT = correct internal algorithms are unreachable in deployed composition

USER_OR_PROVIDER_IMPACT = cleanup/retry/lease can remain permanently stalled; retained data/object/provider state accumulates
DATA_OR_AUTHORITY_IMPACT = orphan objects/rows, false nonterminal lifecycle, unreleased reserved exposure/credit
DETERMINISM_IMPACT = lifecycle completion depends on a test-only/manual call that production never makes

CURRENT_TEST_COVERAGE = security-gate, S3, OMR application/production and PostgreSQL tests call methods directly
CURRENT_TEST_GAP = deployed scheduler/entrypoint reachability, replacement process, bounded drain and telemetry
WHY_EXISTING_TESTS_PASS = tests instantiate and invoke the worker body without production orchestration

MINIMAL_REQUIRED_FIX = authenticated scheduled worker for generic cleanup plus provider-aware OMR cleanup
ARCHITECTURAL_FIX_IF_REQUIRED = lease-aware recurring job with bounded batches, backoff, metrics and deploy smoke gate
REGRESSION_TESTS_REQUIRED = production entrypoint, restart/lease expiry, pending object/vendor retry and accounting release
MIGRATION_REQUIRED = NO

INDEPENDENT_OR_DUPLICATE_ROOT = INDEPENDENT; OMR-side observation is DUPLICATE_ROOT and not recounted
RELATED_PRIOR_FINDING = CLEANUP_RECLAIM/QUOTA_CREDIT; internal P1-RESAT-02 ledger mechanics remain closed
CONFIDENCE = HIGH
```

### P1-ULTRA-06

```text
TITLE = structured ambiguous OMR create responses are misclassified as fresh-start rejections and rotate K1
SEVERITY = P1
EVIDENCE_STRENGTH = PROVEN

SUPPORTED_DEPLOYMENT_REACHABLE = YES
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = YES
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO

INVARIANT = pending/uncertain/reconciliation create outcomes must retain and replay the durable K1 envelope
ROOT_CAUSE = browser recovery special-cases only retired replay and treats other 4xx except 408/429 as deterministic rejection
AFFECTED_SUBSYSTEMS = OMR browser recovery, API error taxonomy, create idempotency/quota
EXACT_FILES = src/app/omr/browser-recovery.ts:171-232; src/app/omr/OmrClient.tsx:253-296;
              src/server/http/api.ts:23-30; src/server/omr/application-service.ts:351-407
EXACT_FUNCTIONS = BrowserOmrCreateRecovery.acquire; OmrClient create flow; mapApiFailure; create
EXACT_STATE_FIELDS = persisted request K1/envelope, fresh-start-required, recovery handle,
                     create outcome/idempotency/exposure state

FAILURE_SEQUENCE = K1 claimed/dispatched/applied -> replay sees 409 PENDING or 400 uncertain/reconciliation ->
                   browser labels deterministic rejection, deletes K1 state and arms fresh -> K2 attempt ->
                   hidden K1 remains active/reserved and K2 is blocked or duplicates effect under changed owner
REPRODUCTION_OR_PROBE = contradictory exact error-code/status branches; all codes are emitted by current service/API
EXPECTED_RESULT = keep K1 and recover/reconcile until exact retired rejection or explicit safe fresh authority
ACTUAL_RESULT = ambiguous durable authority is discarded and a fresh key is offered

USER_OR_PROVIDER_IMPACT = current OMR workflow can become unrecoverable or issue duplicate provider create
DATA_OR_AUTHORITY_IMPACT = hidden live job/reservation and browser/server idempotency divergence
DETERMINISM_IMPACT = recovery identity rotates according to HTTP mapping rather than durable outcome

CURRENT_TEST_COVERAGE = browser-recovery tests cover TypeError, 503, generic deterministic 400 and exact retired replay
CURRENT_TEST_GAP = structured PENDING/OUTCOME_UNCERTAIN/RECONCILIATION_REQUIRED and consent-stale sequences
WHY_EXISTING_TESTS_PASS = no emitted ambiguous 4xx code is fed through the browser classifier

MINIMAL_REQUIRED_FIX = explicit code taxonomy: ambiguous/pending retains K1; retired exact replay alone permits fresh
ARCHITECTURAL_FIX_IF_REQUIRED = shared typed create-outcome protocol instead of status-range inference
REGRESSION_TESTS_REQUIRED = response loss + reload + each emitted structured code + one durable job/side effect
MIGRATION_REQUIRED = NO

INDEPENDENT_OR_DUPLICATE_ROOT = INDEPENDENT
RELATED_PRIOR_FINDING = BROWSER_RECOVERY/BROWSER_FRESH_AMBIGUITY reopened; backend create certainty stays closed
CONFIDENCE = HIGH
```

### P1-ULTRA-07

```text
TITLE = provider DELETE lacks durable operation certainty and exact concurrent authority
SEVERITY = P1
EVIDENCE_STRENGTH = PROVEN

SUPPORTED_DEPLOYMENT_REACHABLE = YES
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = YES
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO

INVARIANT = one provider delete operation must have durable idempotency/outcome/lease authority across direct delete,
            cleanup, response loss, lease expiry and process replacement
ROOT_CAUSE = direct delete and cleanup dispatch provider delete without a shared exact operation token/claim;
             catch always schedules blind replay regardless of dispatch outcome or provider idempotency capability
AFFECTED_SUBSYSTEMS = OMR delete, provider lifecycle, cleanup, quota/exposure
EXACT_FILES = src/server/omr/application-service.ts:795-951;
              src/server/omr/store.ts:726-747; src/server/omr/postgres-store.ts:685-710;
              src/server/omr/reference-adapter.ts:70-73,163-171
EXACT_FUNCTIONS = deleteRecord; delete; cleanupExpiredJobs; claimCleanup; provider.delete
EXACT_STATE_FIELDS = vendorDeleteState, vendorDeleteNextAttemptAt, vendorDeleteResult,
                     cleanupLeaseToken/expiresAt; missing provider-delete operation identity/outcome

FAILURE_SEQUENCE = direct delete marks pending and blocks in provider -> cleanup claims same row and dispatches again;
                   or W1 exceeds cleanup lease and W2 reclaims; or provider applies then response is lost -> blind replay
REPRODUCTION_OR_PROBE = exact competing call paths and catch transition; reference adapter does not retain delete idempotency
EXPECTED_RESULT = exact one-operation claim/fence, outcome-uncertain reconciliation, capability-aware retry
ACTUAL_RESULT = duplicate external effect is possible; not-found replay can leave local deletion pending

USER_OR_PROVIDER_IMPACT = duplicate provider side effect or permanently incomplete user delete
DATA_OR_AUTHORITY_IMPACT = provider/local deletion authority can disagree
DETERMINISM_IMPACT = result depends on call overlap/lease timing/acknowledgement delivery

CURRENT_TEST_COVERAGE = pre-effect throws, fast cleanup, and repeated call after local finalization
CURRENT_TEST_GAP = direct-delete/cleanup overlap, slow lease expiry, apply-then-throw, non-idempotent provider, actual PG
WHY_EXISTING_TESTS_PASS = provider fault doubles do not apply before throwing and workers do not overlap

MINIMAL_REQUIRED_FIX = durable provider-delete operation idempotency/outcome token and exact claim/renew/fence
ARCHITECTURAL_FIX_IF_REQUIRED = provider-operation ledger parallel to object publication certainty
REGRESSION_TESTS_REQUIRED = overlap, expiry/reclaim, both response-loss polarities, restart and provider capability matrix
MIGRATION_REQUIRED = YES

INDEPENDENT_OR_DUPLICATE_ROOT = INDEPENDENT
RELATED_PRIOR_FINDING = vendor delete/cleanup branch; S3 AMBIGUOUS_DELETE remains closed
CONFIDENCE = HIGH
```

### P1-ULTRA-08

```text
TITLE = PostgreSQL failPage transition is non-atomic and diverges from Memory semantics
SEVERITY = P1
EVIDENCE_STRENGTH = PROVEN

SUPPORTED_DEPLOYMENT_REACHABLE = YES
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = YES
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO

INVARIANT = page failure and owning job reconciliation transition must commit atomically
ROOT_CAUSE = PostgreSQL failPage uses three autocommit statements with no transaction/row lock;
             Memory performs one atomic transition
AFFECTED_SUBSYSTEMS = OMR upload failure, Memory/PostgreSQL parity, restart/status/accounting
EXACT_FILES = src/server/omr/postgres-store.ts:451-455; src/server/omr/store.ts:547-558;
              src/server/omr/application-service.ts:486-502
EXACT_FUNCTIONS = PostgresOmrStore.failPage; MemoryOmrStore.failPage; uploadPage catch
EXACT_STATE_FIELDS = page.lifecycle, page upload lease, job.lifecycle, job.updatedAt

FAILURE_SEQUENCE = non-idempotent upload failure -> first PG update commits page=reconciliation-required and clears lease ->
                   connection/process loss before job update -> job remains uploading -> restart/status claims disagree
REPRODUCTION_OR_PROBE = exact multi-statement autocommit transition compared with Memory atomic implementation
EXPECTED_RESULT = page and job state update both commit or both roll back under exact fence
ACTUAL_RESULT = durable cross-row contradiction and false public uploading state

USER_OR_PROVIDER_IMPACT = job can become permanently unrecoverable while presenting a nonterminal status
DATA_OR_AUTHORITY_IMPACT = current PostgreSQL page/job lifecycle authority diverges
DETERMINISM_IMPACT = durable state depends on failure between statements

CURRENT_TEST_COVERAGE = service failure tests use Memory; PostgreSQL tests cover other fences/migrations
CURRENT_TEST_GAP = fault injection after statement 1 and restart/readback on actual PostgreSQL
WHY_EXISTING_TESTS_PASS = no test interrupts failPage between statements

MINIMAL_REQUIRED_FIX = one transaction with exact page/job row locks and transition predicate
ARCHITECTURAL_FIX_IF_REQUIRED = store contract requiring atomic aggregate transitions in every adapter
REGRESSION_TESTS_REQUIRED = actual-PG after-each-statement failure injection and Memory/PG semantic parity
MIGRATION_REQUIRED = NO

INDEPENDENT_OR_DUPLICATE_ROOT = INDEPENDENT
RELATED_PRIOR_FINDING = PAGE_COMMIT_ACK exact prior path remains closed; this is a distinct failure transition
CONFIDENCE = HIGH
```

### P1-ULTRA-09

```text
TITLE = unavailable historical provider during page upload is consumed as an attempted provider failure
SEVERITY = P1
EVIDENCE_STRENGTH = PROVEN

SUPPORTED_DEPLOYMENT_REACHABLE = YES
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = YES
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO

INVARIANT = missing bound adapter before dispatch must preserve existing job and retry authority until binding returns
ROOT_CAUSE = adapterFor throws BINDING_UNAVAILABLE inside generic upload catch, which consumes retry or marks
             reconciliation as if a provider call occurred
AFFECTED_SUBSYSTEMS = provider registry/rotation, page upload, retry/reconciliation, existing job recovery
EXACT_FILES = src/server/omr/application-service.ts:189-195,456-502;
              src/server/omr/store.ts:498-514; src/server/omr/postgres-store.ts:381-401
EXACT_FUNCTIONS = adapterFor; uploadPage; fail/retry page transitions
EXACT_STATE_FIELDS = provider binding snapshot, page retryCount/lifecycle/nextAttemptAt, job.lifecycle

FAILURE_SEQUENCE = create job bound to A -> deploy registry B without historical A -> page upload/recovery ->
                   lookup fails before dispatch -> retries are consumed to exhaustion or reconciliation is set ->
                   A is restored but job remains terminally blocked
REPRODUCTION_OR_PROBE = exact pre-dispatch throw flows through generic capability-dependent failure branch
EXPECTED_RESULT = no provider-attempt budget consumption; explicit unavailable-binding retry/recovery state
ACTUAL_RESULT = existing current-schema job can be lost across a temporary registry rotation error

USER_OR_PROVIDER_IMPACT = provider rotation can make an existing normal OMR job unrecoverable
DATA_OR_AUTHORITY_IMPACT = persisted A binding remains but lifecycle is irreversibly advanced without an A call
DETERMINISM_IMPACT = recoverability depends on how long A is absent rather than durable dispatch evidence

CURRENT_TEST_COVERAGE = A-retained/B-active routing and missing A at later start/status paths
CURRENT_TEST_GAP = page-stage A removal, repeated recovery, restoration after pre-dispatch failures
WHY_EXISTING_TESTS_PASS = upload lookup-unavailable path is never exercised

MINIMAL_REQUIRED_FIX = classify binding-unavailable before provider attempt; preserve exact retry authority without count burn
ARCHITECTURAL_FIX_IF_REQUIRED = explicit provider-availability lifecycle separate from provider-operation failure taxonomy
REGRESSION_TESTS_REQUIRED = create on A, remove A before upload, restart/retry, restore A, complete with zero B calls
MIGRATION_REQUIRED = NO

INDEPENDENT_OR_DUPLICATE_ROOT = INDEPENDENT
RELATED_PRIOR_FINDING = PROVIDER_ROTATION/UNAVAILABLE_HISTORICAL_BINDING partially reopened on a new upload-stage branch
CONFIDENCE = HIGH
```

### P2-ULTRA-01

```text
TITLE = browser discards the durable blocked-generation outcome
SEVERITY = P2
EVIDENCE_STRENGTH = PROVEN

SUPPORTED_DEPLOYMENT_REACHABLE = YES
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = YES
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO

INVARIANT = every generation attempt, including blocked attempts, must persist its diagnostic/input authority
ROOT_CAUSE = service returns blockedProject with lastBlockedAttempt, but browser saves only nonblocked outcomes
AFFECTED_SUBSYSTEMS = Product Core generation, workspace browser, local project persistence/diagnostics
EXACT_FILES = src/product/workspace.ts:76-123; src/app/workspace/WorkspaceClient.tsx:152-161
EXACT_FUNCTIONS = generateProjectVariant; blockedProject; WorkspaceClient.generate
EXACT_STATE_FIELDS = variants[preset].lastBlockedAttempt.{stage,inputDigest,diagnostics}; project

FAILURE_SEQUENCE = impossible lock/input -> Generate -> service returns updated blocked project -> UI sets message only ->
                   reload reads pre-attempt project and loses durable evidence
REPRODUCTION_OR_PROBE = exact caller/service return transition
EXPECTED_RESULT = outcome.project saved for blocked and completed branches
ACTUAL_RESULT = diagnostic attempt authority exists only in discarded return value

USER_OR_PROVIDER_IMPACT = user loses attempt explanation/history after reload and may repeat the same work
DATA_OR_AUTHORITY_IMPACT = no corruption of previous project, but required durable attempt evidence is omitted
DETERMINISM_IMPACT = diagnostic history depends on whether process remains alive

CURRENT_TEST_COVERAGE = product-core.test.ts:172-195 asserts the returned blocked service object
CURRENT_TEST_GAP = browser caller persistence and reload
WHY_EXISTING_TESTS_PASS = service result is inspected without executing the UI branch

MINIMAL_REQUIRED_FIX = save outcome.project before branching on status
ARCHITECTURAL_FIX_IF_REQUIRED = make generation command return one mandatory persisted transition plus UI presentation
REGRESSION_TESTS_REQUIRED = blocked browser action, IndexedDB readback and reload
MIGRATION_REQUIRED = NO

INDEPENDENT_OR_DUPLICATE_ROOT = INDEPENDENT
RELATED_PRIOR_FINDING = Product Core blocked-attempt retention claim is only service-level
CONFIDENCE = HIGH
```

### P2-ULTRA-02

```text
TITLE = re-editing one output target produces an unsavable snapshot history
SEVERITY = P2
EVIDENCE_STRENGTH = PROVEN

SUPPORTED_DEPLOYMENT_REACHABLE = YES
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = YES
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO

INVARIANT = supported replacement/reapplication of an edit must leave a valid current-schema project
ROOT_CAUSE = UI replaces mutable edit payload under the same ID but retains old snapshots, then always appends a snapshot
AFFECTED_SUBSYSTEMS = workspace edit UI, edit identity/digest, project snapshot integrity
EXACT_FILES = src/app/workspace/WorkspaceClient.tsx:214-232;
              src/domain/edit/model.ts:77-108; src/domain/project-integrity.ts:780-789;
              src/domain/project.ts:533-536
EXACT_FUNCTIONS = applyEdit; appliedEditSetDigest; validateSnapshots; project shape validation
EXACT_STATE_FIELDS = outputEdits[id,payload,ordinal], editedSnapshots[id,appliedEditSetDigest]

FAILURE_SEQUENCE = save edit E/snapshot S1 -> change payload while reusing E ID -> old S1 resolves E to new payload and
                   digest mismatches; or apply identical edit -> duplicate S ID -> integrity blocked
REPRODUCTION_OR_PROBE = inline Vite probe: changedEditWithHistoricalSnapshot=blocked;
                        repeatedIdenticalSnapshot=blocked
EXPECTED_RESULT = valid replacement/versioned history or idempotent upsert
ACTUAL_RESULT = PROJECT_INTEGRITY_INVALID; no edit-delete/replace recovery path

USER_OR_PROVIDER_IMPACT = ordinary correction of an edit cannot be saved; regeneration is the workaround
DATA_OR_AUTHORITY_IMPACT = rejected project transition, no accepted corruption
DETERMINISM_IMPACT = deterministic blocking of a supported UI action

CURRENT_TEST_COVERAGE = one first-time edit and one genuine snapshot
CURRENT_TEST_GAP = changed same target, identical reapply, historical snapshot retention
WHY_EXISTING_TESTS_PASS = no second edit operation exists in the test sequence

MINIMAL_REQUIRED_FIX = version immutable edit identities or prune/upsert dependent snapshots and dedupe identical snapshot
ARCHITECTURAL_FIX_IF_REQUIRED = explicit edit revision graph with snapshots bound to exact immutable revisions
REGRESSION_TESTS_REQUIRED = change/reapply/reload/undo sequences and snapshot uniqueness/digest assertions
MIGRATION_REQUIRED = UNKNOWN

INDEPENDENT_OR_DUPLICATE_ROOT = INDEPENDENT
RELATED_PRIOR_FINDING = new Product edit-history root
CONFIDENCE = HIGH
```

### P2-ULTRA-03

```text
TITLE = serialized PracticeShare playback defaults are ignored by the public practice player
SEVERITY = P2
EVIDENCE_STRENGTH = PROVEN

SUPPORTED_DEPLOYMENT_REACHABLE = YES
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = YES
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO

INVARIANT = validated selectedTrackIndex/speedPercent/accompanimentEnabled must initialize shared playback
ROOT_CAUSE = SharedPracticeClient does not pass defaults and ProductPracticePlayer has no defaults prop
AFFECTED_SUBSYSTEMS = share schema, public share UI, playback
EXACT_FILES = src/domain/share.ts:23-24,176-180;
              src/app/share/SharedPracticeClient.tsx:72;
              src/product/ProductPracticePlayer.tsx:14-31
EXACT_FUNCTIONS = isPracticeSharePayload; SharedPracticeClient; ProductPracticePlayer
EXACT_STATE_FIELDS = playbackDefaults.selectedTrackIndex/speedPercent/accompanimentEnabled;
                     player speed/solo/bandEnabled

FAILURE_SEQUENCE = create share with non-default playback values -> serialize/load succeeds -> player initializes
                   100%, no solo and accompaniment on
REPRODUCTION_OR_PROBE = direct schema-to-constructor/state trace
EXPECTED_RESULT = exact shared playback settings restored
ACTUAL_RESULT = all three settings silently reset

USER_OR_PROVIDER_IMPACT = share recipient hears/practices a different initial mix and speed
DATA_OR_AUTHORITY_IMPACT = payload preserved but downstream behavior ignores declared authority
DETERMINISM_IMPACT = deterministic contract mismatch

CURRENT_TEST_COVERAGE = product-core.test.ts:512-528 verifies serialization
CURRENT_TEST_GAP = mounted public player initial state
WHY_EXISTING_TESTS_PASS = consumer is never instantiated

MINIMAL_REQUIRED_FIX = typed initial settings prop and state initialization/reset keyed to share identity
ARCHITECTURAL_FIX_IF_REQUIRED = shared playback configuration contract between materializer and player
REGRESSION_TESTS_REQUIRED = share load/reload for each default and combined settings
MIGRATION_REQUIRED = NO

INDEPENDENT_OR_DUPLICATE_ROOT = INDEPENDENT
RELATED_PRIOR_FINDING = Share→Reload→Practice aggregate
CONFIDENCE = HIGH
```

### P2-ULTRA-04

```text
TITLE = practice player leaks AudioContext on reset, mixer/speed changes and some startup failures
SEVERITY = P2
EVIDENCE_STRENGTH = STRONGLY_SUPPORTED

SUPPORTED_DEPLOYMENT_REACHABLE = YES
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = YES
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO

INVARIANT = every created AudioContext must be closed/suspended or remain reachable for later cleanup
ROOT_CAUSE = stopNodes stops oscillators and clears activeRef without closing its context; reset/mixer/speed call it
AFFECTED_SUBSYSTEMS = browser Web Audio playback and control lifecycle
EXACT_FILES = src/product/ProductPracticePlayer.tsx:36-51,64-107,120-150
EXACT_FUNCTIONS = stopNodes; reset; begin; pause/finish/unmount; mixer/speed handlers
EXACT_STATE_FIELDS = activeRef.context, activeRef.nodes, playback phase/settings

FAILURE_SEQUENCE = Play creates context -> Reset or speed/mute/solo/band change -> active reference cleared without close -> repeat
REPRODUCTION_OR_PROBE = source lifecycle trace; browser resource exhaustion was not physically exercised
EXPECTED_RESULT = close context on every terminal/reset/error path
ACTUAL_RESULT = abandoned live contexts can accumulate until reload/browser limit

USER_OR_PROVIDER_IMPACT = repeated normal controls can eventually prevent further playback
DATA_OR_AUTHORITY_IMPACT = none; recoverable runtime resource leak
DETERMINISM_IMPACT = browser-resource-dependent failure timing

CURRENT_TEST_COVERAGE = pure playback/plan logic; no Web Audio lifecycle harness
CURRENT_TEST_GAP = fake AudioContext close counts for reset/settings/startup failure
WHY_EXISTING_TESTS_PASS = Web Audio resource ownership is not executed

MINIMAL_REQUIRED_FIX = close/suspend retained context before clearing activeRef, including error paths
ARCHITECTURAL_FIX_IF_REQUIRED = single owned audio-session abstraction with finally-based disposal
REGRESSION_TESTS_REQUIRED = Play→Reset and every control path asserts one create/one close
MIGRATION_REQUIRED = NO

INDEPENDENT_OR_DUPLICATE_ROOT = INDEPENDENT
RELATED_PRIOR_FINDING = none
CONFIDENCE = MEDIUM
```

### P2-ULTRA-05

```text
TITLE = multiline imported titles are not escaped at the ABC header boundary
SEVERITY = P2
EVIDENCE_STRENGTH = PROVEN

SUPPORTED_DEPLOYMENT_REACHABLE = YES
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = YES
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO

INVARIANT = arbitrary validated title text must serialize as one safe ABC title field
ROOT_CAUSE = XML text/validators preserve internal CR/LF while ABC quote removes only quote/backslash
AFFECTED_SUBSYSTEMS = MusicXML import, Source validation, workspace/share score rendering
EXACT_FILES = src/import/musicxml/xml.ts:171-178; src/domain/source/validation.ts:312-338;
              src/domain/share.ts:99-105; src/product/score-adapter.ts:45,70-85
EXACT_FUNCTIONS = xmlText; source/share validators; quote; arrangementRenderDocumentToAbc
EXACT_STATE_FIELDS = source/title, share title, ABC T header

FAILURE_SEQUENCE = valid work-title contains internal newline -> import/validation succeeds -> `T:` interpolation creates
                   an unintended ABC line/field -> renderer can fail or show divergent score
REPRODUCTION_OR_PROBE = exact accepted string-to-serializer transition
EXPECTED_RESULT = newline/control characters encoded, folded or rejected deterministically
ACTUAL_RESULT = structural ABC injection by normal metadata text

USER_OR_PROVIDER_IMPACT = valid imported score may fail or display the wrong title/notation
DATA_OR_AUTHORITY_IMPACT = source stays intact; rendered view can diverge from playback plan
DETERMINISM_IMPACT = deterministic serializer contract violation

CURRENT_TEST_COVERAGE = ordinary one-line titles
CURRENT_TEST_GAP = newline/control/unicode line-separator serialization
WHY_EXISTING_TESTS_PASS = fixtures do not contain multiline metadata

MINIMAL_REQUIRED_FIX = canonical ABC header escaping/folding or boundary normalization
ARCHITECTURAL_FIX_IF_REQUIRED = format-specific encoder for every free-text ABC field
REGRESSION_TESTS_REQUIRED = CR/LF/CRLF/control titles through import, workspace and share render
MIGRATION_REQUIRED = NO

INDEPENDENT_OR_DUPLICATE_ROOT = INDEPENDENT
RELATED_PRIOR_FINDING = none
CONFIDENCE = HIGH
```

### P2-ULTRA-06

```text
TITLE = selected lead-part key analysis remains bound to parts[0] with no populated-key override
SEVERITY = P2
EVIDENCE_STRENGTH = STRONGLY_SUPPORTED

SUPPORTED_DEPLOYMENT_REACHABLE = YES
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = YES
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO

INVARIANT = after selecting a lead candidate, key/modulation readiness must use that selected lead authority
ROOT_CAUSE = parser derives defaultKey only from first part; lead selection changes only staff key;
             UI exposes key editor only when defaultKey is absent
AFFECTED_SUBSYSTEMS = multi-part MusicXML import, Quick Review, project handoff
EXACT_FILES = src/import/musicxml/parser.ts:958-985; src/import/review/commands.ts:33-39;
              src/import/review/quick-review.ts:142-149,281-285;
              src/app/import/ImportReviewClient.tsx:645,655-659;
              src/grammar/wag-v1-diagnostic-baseline.canonical.json:81-86
EXACT_FUNCTIONS = parseScore; selectLeadCandidate; hasUnsupportedModulation; deriveQuickReview
EXACT_STATE_FIELDS = defaultKey, selectedLeadStaffKey, lead measure keys, UNSUPPORTED_MODULATION

FAILURE_SEQUENCE = first part key D, selected vocal/lead key C -> default remains D -> blocking modulation diagnostic ->
                   populated default hides override -> no handoff without editing/reordering source file
REPRODUCTION_OR_PROBE = exact state transition; differing written-key part support is not explicit enough for P1
EXPECTED_RESULT = rebase key authority on selected lead or permit an explicit override
ACTUAL_RESULT = a selectable lead may be falsely/opaquely blocked by unrelated first-part authority

USER_OR_PROVIDER_IMPACT = recoverable import UX dead end for some multi-part files
DATA_OR_AUTHORITY_IMPACT = no accepted corruption; false blocking diagnostic
DETERMINISM_IMPACT = deterministic first-part ordering dependence

CURRENT_TEST_COVERAGE = alternate part/voice selection with matching keys
CURRENT_TEST_GAP = selected part with distinct key and override workflow
WHY_EXISTING_TESTS_PASS = fixtures do not separate first-part and lead key authority

MINIMAL_REQUIRED_FIX = derive analysis key from selected lead and always expose explicit key correction
ARCHITECTURAL_FIX_IF_REQUIRED = part/staff-scoped key authority in review state
REGRESSION_TESTS_REQUIRED = multi-part key differences, selection switch and explicit override
MIGRATION_REQUIRED = NO

INDEPENDENT_OR_DUPLICATE_ROOT = INDEPENDENT
RELATED_PRIOR_FINDING = Direct MusicXML→Quick Review aggregate
CONFIDENCE = MEDIUM
```

### P2-ULTRA-07

```text
TITLE = PracticeShare runtime validator accepts payloads that the practice materializer cannot consume
SEVERITY = P2
EVIDENCE_STRENGTH = PROVEN

SUPPORTED_DEPLOYMENT_REACHABLE = YES
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = YES
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO

INVARIANT = every schema-valid/readable v3 share must either materialize or be rejected with a controlled error
ROOT_CAUSE = schema treats CompactTrack.label as arbitrary presentation text and chord symbol as nonempty,
             while consumer reparses exact role magic from label and requires parseable chords
AFFECTED_SUBSYSTEMS = share domain, ShareStore, shared practice materializer/page
EXACT_FILES = docs/HARMONYMAKER_SPEC_v3.1.5.md:4659-4663,4703-4730;
              src/domain/share.ts:17,99-181; src/product/track-roles.ts:70-84;
              src/product/shared-practice.ts:14-66; src/app/share/SharedPracticeClient.tsx:20
EXACT_FUNCTIONS = isPracticeSharePayload; parseTrackRole; materializeSharedPractice; SharedPracticeClient
EXACT_STATE_FIELDS = tracks[].label, chordTimeline[].symbol, payload/version

FAILURE_SEQUENCE = validator/store accepts `Track 0` label or nonparseable chord -> public loader succeeds ->
                   render-time materializer throws SHARE_TRACK_ROLE_INVALID/chord error outside loader catch
REPRODUCTION_OR_PROBE = existing share-store.test.ts:21-58 payload round-trips with `Track 0/1/2`,
                        but the consumer rejects its label; `Crocket` is likewise schema-valid/parser-invalid
EXPECTED_RESULT = consumer-complete validation or explicit stable role/chord authority
ACTUAL_RESULT = valid/readable share can crash the public practice render

USER_OR_PROVIDER_IMPACT = current v3 share link can show generic error instead of practice content
DATA_OR_AUTHORITY_IMPACT = durable payload preserved; contract between validator and consumer is false
DETERMINISM_IMPACT = deterministic schema/consumer mismatch

CURRENT_TEST_COVERAGE = server share round-trip fixture; Product happy path with magic first-party labels
CURRENT_TEST_GAP = pass server-accepted fixtures into shared-practice materializer/page
WHY_EXISTING_TESTS_PASS = producer, store and consumer are tested separately with different fixtures

MINIMAL_REQUIRED_FIX = explicit stable harmonyRole/placement fields or enforce every consumer constraint in validator
ARCHITECTURAL_FIX_IF_REQUIRED = versioned consumer-complete share schema independent of labels
REGRESSION_TESTS_REQUIRED = every accepted payload materializes; malformed role/chord returns controlled unavailable state
MIGRATION_REQUIRED = UNKNOWN

INDEPENDENT_OR_DUPLICATE_ROOT = INDEPENDENT
RELATED_PRIOR_FINDING = Share→Reload→Practice aggregate
CONFIDENCE = HIGH
```

### P2-ULTRA-08

```text
TITLE = public share page has no single locator/state authority and can report a different share than displayed
SEVERITY = P2
EVIDENCE_STRENGTH = PROVEN

SUPPORTED_DEPLOYMENT_REACHABLE = YES
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = YES
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO

INVARIANT = displayed payload, URL locator, load state and report target must be one exact share identity
ROOT_CAUSE = fragment payload is always preferred, token drives reporting, effect watches only token,
             and payload/reported state is not cleared on navigation/load failure
AFFECTED_SUBSYSTEMS = public share UI, URL transport, stored share load, abuse report target
EXACT_FILES = src/app/share/SharedPracticeClient.tsx:14-43,57-72
EXACT_FUNCTIONS = SharedPracticeClient load effect; report
EXACT_STATE_FIELDS = token, location.hash p, payload, message, reported

FAILURE_SEQUENCE = `/share?token=B#p=A` displays A but report POST targets B; or A→B load failure leaves player A
                   under B URL; hash-only navigation does not rerun effect; reported flag survives target change
REPRODUCTION_OR_PROBE = exact dual-locator/effect dependency state transitions
EXPECTED_RESULT = canonical mutually exclusive locator and source-keyed load/report state
ACTUAL_RESULT = stale/wrong score and wrong-target report row are reachable

USER_OR_PROVIDER_IMPACT = user can report unseen share or practice stale content; reload is a workaround
DATA_OR_AUTHORITY_IMPACT = abuse report reference may bind to B while UI evidence was A
DETERMINISM_IMPACT = outcome depends on URL composition/navigation history

CURRENT_TEST_COVERAGE = URL codec and store tests only; zero component/E2E tests
CURRENT_TEST_GAP = dual locator, hashchange, token navigation, slow/failing load and report binding
WHY_EXISTING_TESTS_PASS = browser page state is never mounted

MINIMAL_REQUIRED_FIX = reject dual locators, key reducer by displayed source, clear on start/failure and bind report to it
ARCHITECTURAL_FIX_IF_REQUIRED = canonical ShareLocator discriminant with abortable navigation state machine
REGRESSION_TESTS_REQUIRED = A/B fragment/token combinations, back-forward/hashchange, failure and report target
MIGRATION_REQUIRED = NO

INDEPENDENT_OR_DUPLICATE_ROOT = INDEPENDENT
RELATED_PRIOR_FINDING = new share browser authority root
CONFIDENCE = HIGH
```

### P2-ULTRA-09

```text
TITLE = share/session routes lack an end-to-end bounded structured-input boundary
SEVERITY = P2
EVIDENCE_STRENGTH = PROVEN

SUPPORTED_DEPLOYMENT_REACHABLE = YES
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = YES
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO

INVARIANT = body/decompression/cardinality limits and malformed-input mapping must apply before expensive work/side effects
ROOT_CAUSE = share routes use raw request.json; URL compression branch precedes plaintext cap; gunzip expansion and
             schema cardinalities are unbounded; report quota is consumed before validation
AFFECTED_SUBSYSTEMS = share/session HTTP, payload codec, quota, error mapping
EXACT_FILES = src/app/api/shares/route.ts:8-18; src/app/api/shares/[token]/route.ts:20-28;
              src/app/api/shares/[token]/report/route.ts:8-19; src/server/http/api.ts:19-33,48-53;
              src/server/http/omr-api.ts:17-53; src/domain/share.ts:99-181;
              src/server/share/share-store-core.ts:22-29,44-54
EXACT_FUNCTIONS = share POST/DELETE/report; mapApiFailure; parseShareCreateBody;
                  encode/decodeUrlShare; ShareStoreService.prepare
EXACT_STATE_FIELDS = raw request bytes, plaintext size, encoded size, arrays/strings, report quota

FAILURE_SEQUENCE = malformed JSON -> SyntaxError maps 500; or >256KiB highly compressible payload is fully
                   encode/gzip/gunzip/digested then accepted by small URL branch; invalid report consumes quota first
REPRODUCTION_OR_PROBE = inline probe: plaintextBytes=1000632, encodedBytes=1811,
                        limits=262144/6000, URL branch accepted by current ordering
EXPECTED_RESULT = auth-first bounded reader, pre-canonicalization semantic caps, limited decompression and structured 4xx
ACTUAL_RESULT = unbounded CPU/memory paths, cap bypass and inconsistent errors/side-effect ordering

USER_OR_PROVIDER_IMPACT = recoverable request failures and resource pressure; no cybersecurity exploit claim is made
DATA_OR_AUTHORITY_IMPACT = malformed reports may consume quota; durable share size policy is inconsistent
DETERMINISM_IMPACT = none material; boundary behavior depends on compression ratio/body parser

CURRENT_TEST_COVERAGE = omr-api bounded reader tests; small share fixtures and forceStore cap
CURRENT_TEST_GAP = share routes, malformed JSON, compression ratio/expansion/cardinality and quota ordering
WHY_EXISTING_TESTS_PASS = bounded helper is OMR-only and share tests start after body parsing

MINIMAL_REQUIRED_FIX = shared bounded JSON/error helper, explicit field/cardinality/plaintext limits, limited decompression
ARCHITECTURAL_FIX_IF_REQUIRED = one route input-budget policy consumed by validator and codecs
REGRESSION_TESTS_REQUIRED = raw bytes, invalid UTF-8/JSON, compressed expansion, oversized fields/arrays and quota order
MIGRATION_REQUIRED = NO

INDEPENDENT_OR_DUPLICATE_ROOT = INDEPENDENT
RELATED_PRIOR_FINDING = P2-SAT-04 remains closed for OMR routes; this is a new share boundary
CONFIDENCE = HIGH
```

### P2-ULTRA-10

```text
TITLE = deployment performs schema migration lazily inside first API traffic instead of a pretraffic gate
SEVERITY = P2
EVIDENCE_STRENGTH = PROVEN

SUPPORTED_DEPLOYMENT_REACHABLE = YES
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = YES
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO

INVARIANT = frozen deployment contract requires sequential migrations 1→latest before traffic
ROOT_CAUSE = first getProductionServices call creates pool and runs applyMigrations; no release command/job/readiness gate exists
AFFECTED_SUBSYSTEMS = production composition, migrations, Vercel deployment/readiness
EXACT_FILES = docs/implementation/SEGMENT_D_HANDOFF.md:961-970;
              src/server/substrate/services.ts:29-52; src/server/persistence/migrations.ts:409-450;
              package.json; .github/workflows/ci.yml; vercel.json
EXACT_FUNCTIONS = getProductionServices; applyMigrations
EXACT_STATE_FIELDS = servicesPromise, schema version/advisory lock, first-request timeout/readiness

FAILURE_SEQUENCE = fresh deployment receives concurrent cold API requests -> each instance reaches lazy migration ->
                   requests wait for migration/advisory lock within request timeout instead of pretraffic readiness
REPRODUCTION_OR_PROBE = exact production composition/deployment config inspection
EXPECTED_RESULT = release-phase migration completes, then runtime verifies exact applied version before routing traffic
ACTUAL_RESULT = migration DDL is first-request work; no repository deploy ordering enforces the frozen contract

USER_OR_PROVIDER_IMPACT = fresh deploy can expose first-request latency/timeout/unavailability
DATA_OR_AUTHORITY_IMPACT = no current migration corruption reproduced
DETERMINISM_IMPACT = availability depends on cold-start concurrency/timing

CURRENT_TEST_COVERAGE = helper/fresh PostgreSQL migrations and build
CURRENT_TEST_GAP = deployment ordering, first-traffic and multi-instance readiness
WHY_EXISTING_TESTS_PASS = tests invoke migrations directly before store work; build does not execute services

MINIMAL_REQUIRED_FIX = explicit migrate release command/job and applied-version readiness gate
ARCHITECTURAL_FIX_IF_REQUIRED = runtime verify-only schema contract separated from deployment mutation
REGRESSION_TESTS_REQUIRED = clean deploy migration gate, concurrent instance readiness and timeout smoke
MIGRATION_REQUIRED = NO

INDEPENDENT_OR_DUPLICATE_ROOT = INDEPENDENT
RELATED_PRIOR_FINDING = deployment contract freeze
CONFIDENCE = HIGH
```

### P2-ULTRA-11

```text
TITLE = abuse reports are write-only and no supported moderation/takedown workflow is reachable
SEVERITY = P2
EVIDENCE_STRENGTH = PROVEN

SUPPORTED_DEPLOYMENT_REACHABLE = YES
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = YES
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO

INVARIANT = accepted abuse report must have an operator-readable, reviewable and auditable takedown path
ROOT_CAUSE = store contract only inserts reports; takedown has no non-test caller/internal route and requires raw token,
             while reports preserve shareRecordId but raw token is intentionally not stored
AFFECTED_SUBSYSTEMS = share reporting, moderation, takedown, production composition
EXACT_FILES = docs/HARMONYMAKER_SPEC_v3.1.5.md:4807-4811;
              src/app/api/shares/[token]/report/route.ts:8-19;
              src/server/share/share-store-core.ts:138-158;
              src/server/persistence/store.ts:46-53,147; src/server/persistence/postgres-store.ts:182-186
EXACT_FUNCTIONS = report route; ShareStoreService.report/takedown; createAbuseReport
EXACT_STATE_FIELDS = abuse_reports.shareRecordId/category/detail; share lifecycle; raw token/internal key

FAILURE_SEQUENCE = user report receives truthful 202 and row is inserted -> no list/claim/resolve consumer exists ->
                   operator cannot reach record-based disable -> share remains until owner delete/expiry
REPRODUCTION_OR_PROBE = non-test takedown callers=0; persistence contract has create-only report operation
EXPECTED_RESULT = authenticated moderation queue and exact shareRecordId-based fenced resolution/takedown
ACTUAL_RESULT = reports accumulate without a repository-supported action path

USER_OR_PROVIDER_IMPACT = reporting feature cannot lead to review/removal; not a false auto-takedown claim
DATA_OR_AUTHORITY_IMPACT = report evidence persists but is operationally dead-ended
DETERMINISM_IMPACT = none

CURRENT_TEST_COVERAGE = share-store.test.ts:78-88 directly calls report and takedown separately
CURRENT_TEST_GAP = report→operator claim/review→disable→audit production flow
WHY_EXISTING_TESTS_PASS = tests possess raw token/internal authority and bypass orchestration

MINIMAL_REQUIRED_FIX = authenticated internal list/claim/resolve workflow and record-ID fenced disable
ARCHITECTURAL_FIX_IF_REQUIRED = moderation lifecycle with least-secret authority, audit and runbook
REGRESSION_TESTS_REQUIRED = report-to-resolution, concurrent moderation, unauthorized access and audit
MIGRATION_REQUIRED = UNKNOWN

INDEPENDENT_OR_DUPLICATE_ROOT = INDEPENDENT
RELATED_PRIOR_FINDING = separate from periodic cleanup because authority and resolution differ
CONFIDENCE = HIGH
```

### P2-ULTRA-12

```text
TITLE = root README states the opposite of current implementation and gate authority
SEVERITY = P2
EVIDENCE_STRENGTH = PROVEN

SUPPORTED_DEPLOYMENT_REACHABLE = YES
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = YES
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO

INVARIANT = repository entry documentation must describe current implemented/deferred/runtime boundaries truthfully
ROOT_CAUSE = README inventory stopped at Step 3 and was not updated with Segment B/C/D implementation
AFFECTED_SUBSYSTEMS = documentation authority, onboarding, deployment/operations
EXACT_FILES = README.md:5-10,27-44; docs/HARMONYMAKER_V0_IMPLEMENTATION_HANDOFF.md:5-33;
              docs/implementation/SEGMENT_D_HANDOFF.md
EXACT_FUNCTIONS = documentation capability/gate declarations
EXACT_STATE_FIELDS = implemented/deferred steps, WAG gate, persistence/auth/DB/share/edit/OMR statements

FAILURE_SEQUENCE = maintainer follows root README -> is told automatic harmony/edit/PracticeShare/storage/auth/DB/Step4+
                   are unimplemented -> contradicts actual routes/domain/server/migrations and frozen Segment D gate
REPRODUCTION_OR_PROBE = direct documentation-to-current-tree comparison
EXPECTED_RESULT = current v0/Segment D inventory and exact external remaining boundary
ACTUAL_RESULT = materially stale and false repository entry guidance

USER_OR_PROVIDER_IMPACT = maintainers/operators can omit required env/migration/cleanup review or duplicate implemented work
DATA_OR_AUTHORITY_IMPACT = runtime data unchanged; evidence/maintenance authority is wrong
DETERMINISM_IMPACT = none

CURRENT_TEST_COVERAGE = no root documentation consistency check
CURRENT_TEST_GAP = implemented route/script/gate inventory drift
WHY_EXISTING_TESTS_PASS = README is outside executable tests

MINIMAL_REQUIRED_FIX = update only root README to current capability/gate/external status in closure work
ARCHITECTURAL_FIX_IF_REQUIRED = generate/check capability matrix from authoritative handoff where practical
REGRESSION_TESTS_REQUIRED = documentation review/checklist, not production test
MIGRATION_REQUIRED = NO

INDEPENDENT_OR_DUPLICATE_ROOT = INDEPENDENT; README_APPLY frozen file is correct and unrelated
RELATED_PRIOR_FINDING = documentation authority ordering
CONFIDENCE = HIGH
```

### P2-ULTRA-13

```text
TITLE = mutable browser page order breaks immutable OMR pageIndex/evidence binding after job creation
SEVERITY = P2
EVIDENCE_STRENGTH = PROVEN

SUPPORTED_DEPLOYMENT_REACHABLE = YES
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = YES
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO

INVARIANT = evidence/handoff pageIndex must remain bound to the exact uploaded page digest/order
ROOT_CAUSE = movePages reorders local pages without clearing/invalidating live handle/status/result;
             overlay and handoff resolve server pageIndex against current reordered array
AFFECTED_SUBSYSTEMS = OMR browser, evidence overlay, import/review handoff
EXACT_FILES = src/app/omr/OmrClient.tsx:112-116,235-250,350-369,402,429-435;
              src/app/import/ImportReviewClient.tsx:540-541,600-609
EXACT_FUNCTIONS = replacePages; movePages; result polling/render; handoff image lookup
EXACT_STATE_FIELDS = pages order/digest, handle, status, result evidence.pageIndex, handoff image URLs

FAILURE_SEQUENCE = upload [A,B] -> receive evidence page0 -> after completion reorder [B,A] -> overlay page0 on B and
                   handoff current reordered images -> evidence/correction targets wrong image
REPRODUCTION_OR_PROBE = exact page-index lookup and mutation path
EXPECTED_RESULT = freeze order while handle exists or bind evidence by immutable page digest/upload identity
ACTUAL_RESULT = displayed/handoff evidence can mismatch server-recognized page

USER_OR_PROVIDER_IMPACT = user may correct/approve the wrong page image
DATA_OR_AUTHORITY_IMPACT = browser evidence presentation/handoff association is wrong; backend job remains intact
DETERMINISM_IMPACT = depends on post-upload UI reordering

CURRENT_TEST_COVERAGE = backend page identity/evidence and pure helpers
CURRENT_TEST_GAP = component reorder after live/completed job and handoff digest assertion
WHY_EXISTING_TESTS_PASS = browser pages array is not mutated in backend tests

MINIMAL_REQUIRED_FIX = disable/reject reorder for a bound job or rebind by immutable digest
ARCHITECTURAL_FIX_IF_REQUIRED = persisted page manifest identity shared by browser, API, evidence and review
REGRESSION_TESTS_REQUIRED = A/B reorder at every job state and exact evidence/handoff mapping
MIGRATION_REQUIRED = NO

INDEPENDENT_OR_DUPLICATE_ROOT = INDEPENDENT
RELATED_PRIOR_FINDING = OMR_PROVENANCE_READINESS backend remains closed; browser evidence binding is new
CONFIDENCE = HIGH
```

### P2-ULTRA-14

```text
TITLE = browser OMR workflow cannot durably operate the server retry lifecycle and can hide a live job
SEVERITY = P2
EVIDENCE_STRENGTH = PROVEN

SUPPORTED_DEPLOYMENT_REACHABLE = YES
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = YES
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO

INVARIANT = durable retry-pending jobs must remain visible/resumable/cancellable across backoff, reload and input replacement
ROOT_CAUSE = polling ends at ~67.5s while retry backoff reaches minutes/hours; cancel omits retry states;
             replacePages clears local handle without cancelling/deleting backend/recovery authority
AFFECTED_SUBSYSTEMS = OMR browser state machine, sync/capture retry, cancel, page replacement
EXACT_FILES = src/server/omr/application-service.ts:36,213-233,771;
              src/server/omr/store.ts:34-35; src/app/omr/OmrClient.tsx:112-116,235-250
EXACT_FUNCTIONS = retry scheduling; cancel; poll; replacePages
EXACT_STATE_FIELDS = sync/capture-retry-pending, nextAttemptAt, handle, recovery key, pages/status/result

FAILURE_SEQUENCE = second retry scheduled 5m -> UI stops polling ~67.5s and offers no resume; cancel returns not allowed;
                   or replace input clears H1 locally but H1 remains active/recoverable -> H2 hits active quota
REPRODUCTION_OR_PROBE = exact backoff/poll/cancel state-set comparison and replacement transition
EXPECTED_RESULT = durable scheduled resume/sync and cancel support; input change explicitly resolves existing job
ACTUAL_RESULT = recoverable backend authority becomes hidden/stalled until manual reload/same files/delete path

USER_OR_PROVIDER_IMPACT = normal transient failure or file replacement can strand the browser workflow
DATA_OR_AUTHORITY_IMPACT = backend state remains durable but browser loses usable control of it
DETERMINISM_IMPACT = recovery depends on user timing/reload

CURRENT_TEST_COVERAGE = service tests advance clock/call sync directly; browser recovery helper tests create only
CURRENT_TEST_GAP = real backoff duration, retry cancel, reload resume and input-switch live-job tests
WHY_EXISTING_TESTS_PASS = no mounted browser clock/state lifecycle consumes server retry schedule

MINIMAL_REQUIRED_FIX = persisted next-attempt UI/resume scheduler, support cancel states, explicit resolve-before-replace
ARCHITECTURAL_FIX_IF_REQUIRED = one durable browser job reducer driven by server lifecycle rather than bounded polling loop
REGRESSION_TESTS_REQUIRED = 60s/5m/30m backoff, reload, cancel, replace and max-active behavior
MIGRATION_REQUIRED = NO

INDEPENDENT_OR_DUPLICATE_ROOT = INDEPENDENT
RELATED_PRIOR_FINDING = backend retry persistence closed; browser consumer is partial
CONFIDENCE = HIGH
```

### P2-ULTRA-15

```text
TITLE = legal provider status `created` is omitted after claiming the status-observation lease
SEVERITY = P2
EVIDENCE_STRENGTH = PROVEN

SUPPORTED_DEPLOYMENT_REACHABLE = YES
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = YES
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO

INVARIANT = every status kind in the provider contract must produce an exact transition or release its lease
ROOT_CAUSE = synchronizeStatus handles unknown/failed/cancelled/processing/needs-input/completed/queued but not created
AFFECTED_SUBSYSTEMS = OMR provider contract, status lease, browser polling
EXACT_FILES = src/domain/omr/contracts.ts:102-110; src/server/omr/reference-adapter.ts:101-106;
              src/server/omr/application-service.ts:660-715
EXACT_FUNCTIONS = provider getStatus; synchronizeStatus
EXACT_STATE_FIELDS = provider status.kind, local lifecycle/statusObservationLeaseToken/expiresAt

FAILURE_SEQUENCE = accepted start -> adapter returns legal created -> service has already claimed lease -> no branch releases
                   or completes it -> subsequent sync remains pending for 5m; repeated created can repeat stall
REPRODUCTION_OR_PROBE = exhaustive contract-vs-switch comparison; reference adapter can return created
EXPECTED_RESULT = explicit local transition/observation completion for created
ACTUAL_RESULT = stale local queued status and recurring lease delay

USER_OR_PROVIDER_IMPACT = recoverable repeated five-minute status stalls
DATA_OR_AUTHORITY_IMPACT = no false completion; observation lease/state freshness is wrong
DETERMINISM_IMPACT = deterministic missing enum branch

CURRENT_TEST_COVERAGE = many provider statuses but not created after local queued
CURRENT_TEST_GAP = exhaustive status-kind table
WHY_EXISTING_TESTS_PASS = test adapters skip this legal return value

MINIMAL_REQUIRED_FIX = handle created explicitly and complete/release the exact observation token
ARCHITECTURAL_FIX_IF_REQUIRED = compile/runtime exhaustive status transition table
REGRESSION_TESTS_REQUIRED = every ProviderJobStatus kind with lease readback and repeated polling
MIGRATION_REQUIRED = NO

INDEPENDENT_OR_DUPLICATE_ROOT = INDEPENDENT
RELATED_PRIOR_FINDING = STATUS_CAPTURE_FENCING mechanics remain closed; contract completeness is partial
CONFIDENCE = HIGH
```

### TG-ULTRA-01

```text
TITLE = direct MusicXML Quick Review pre-project reload recovery is unverified
SEVERITY = TG
EVIDENCE_STRENGTH = TEST_GAP_ONLY

SUPPORTED_DEPLOYMENT_REACHABLE = YES
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = NO (durability requirement before project creation is not explicit)
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO

INVARIANT = if pre-project review is intended durable, reload should recover the exact draft/file authority
ROOT_CAUSE = draft/analysis/direct file state is React-only; no explicit direct-import recovery contract/test
AFFECTED_SUBSYSTEMS = MusicXML import browser/Quick Review
EXACT_FILES = src/app/import/ImportReviewClient.tsx:354-423
EXACT_FUNCTIONS = ImportReviewClient direct-import state/effects
EXACT_STATE_FIELDS = file, draft, analysis, preview URLs

FAILURE_SEQUENCE = import and edit review -> browser reload -> state clears
REPRODUCTION_OR_PROBE = no defect probe; requirement is not established
EXPECTED_RESULT = to be specified
ACTUAL_RESULT = coverage/contract absent

USER_OR_PROVIDER_IMPACT = possible recoverable lost review work, unproven as current contract defect
DATA_OR_AUTHORITY_IMPACT = no persisted authority shown lost
DETERMINISM_IMPACT = none proven

CURRENT_TEST_COVERAGE = parser/review pure tests
CURRENT_TEST_GAP = mounted reload/recovery
WHY_EXISTING_TESTS_PASS = no browser lifecycle test

MINIMAL_REQUIRED_FIX = first specify direct-import draft durability; add test or documented non-durable boundary
ARCHITECTURAL_FIX_IF_REQUIRED = versioned draft manifest if durability is required
REGRESSION_TESTS_REQUIRED = reload/file-reselection recovery
MIGRATION_REQUIRED = UNKNOWN

INDEPENDENT_OR_DUPLICATE_ROOT = INDEPENDENT TEST GAP
RELATED_PRIOR_FINDING = none
CONFIDENCE = MEDIUM
```

### TG-ULTRA-02

```text
TITLE = candidate reload integrity does not independently recompute every derived evidence field
SEVERITY = TG
EVIDENCE_STRENGTH = TEST_GAP_ONLY

SUPPORTED_DEPLOYMENT_REACHABLE = YES
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = NO (no normal producer/counterexample proven)
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO

INVARIANT = persisted candidate metrics/diagnostics/canonical path should match rederived content
ROOT_CAUSE = validator reconstructs notes/contentDigest but lacks independent checks for all derived evidence
AFFECTED_SUBSYSTEMS = project candidate integrity/reload
EXACT_FILES = src/domain/project-integrity.ts:618-667
EXACT_FUNCTIONS = validateCandidate
EXACT_STATE_FIELDS = candidate metrics, diagnostics, canonicalPathKey

FAILURE_SEQUENCE = hypothetical derived-evidence mutation -> current validation path may not compare every field
REPRODUCTION_OR_PROBE = no supported producer failure reproduced
EXPECTED_RESULT = independent derived-field verification
ACTUAL_RESULT = coverage gap only

USER_OR_PROVIDER_IMPACT = unproven
DATA_OR_AUTHORITY_IMPACT = unproven
DETERMINISM_IMPACT = unproven

CURRENT_TEST_COVERAGE = genuine generated candidates and content mutation checks
CURRENT_TEST_GAP = field-by-field derived evidence mutation
WHY_EXISTING_TESTS_PASS = genuine producer output remains internally consistent

MINIMAL_REQUIRED_FIX = add counterexample tests, then rederive fields if gap proves material
ARCHITECTURAL_FIX_IF_REQUIRED = canonical candidate evidence rederiver
REGRESSION_TESTS_REQUIRED = mutate each derived field independently
MIGRATION_REQUIRED = UNKNOWN

INDEPENDENT_OR_DUPLICATE_ROOT = INDEPENDENT TEST GAP; not merged with proven snapshot root
RELATED_PRIOR_FINDING = P1-ULTRA-01 is snapshot-specific
CONFIDENCE = MEDIUM
```

### TG-ULTRA-03

```text
TITLE = canonical JSON has no test/policy for NFC-equivalent object-key collisions
SEVERITY = TG
EVIDENCE_STRENGTH = TEST_GAP_ONLY

SUPPORTED_DEPLOYMENT_REACHABLE = YES
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = NO (no current producer collision shown)
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO

INVARIANT = canonical codec must define behavior when distinct raw keys normalize to the same NFC key
ROOT_CAUSE = keys are sorted raw and normalized only while writing; normalized-key duplicates are not rejected
AFFECTED_SUBSYSTEMS = canonical digest/identity, arbitrary metadata maps
EXACT_FILES = src/domain/digest/canonical.ts:18-19,49-58; src/domain/source/validation.ts:69-76
EXACT_FUNCTIONS = canonical JSON object encoding; metadata validation
EXACT_STATE_FIELDS = object property names and semantic digests

FAILURE_SEQUENCE = hypothetical metadata contains canonically equivalent keys -> ambiguous canonical object text/order
REPRODUCTION_OR_PROBE = no supported producer demonstrated
EXPECTED_RESULT = explicit collision rejection or one unambiguous canonical rule
ACTUAL_RESULT = behavior untested/unspecified

USER_OR_PROVIDER_IMPACT = unproven
DATA_OR_AUTHORITY_IMPACT = potential identity ambiguity only
DETERMINISM_IMPACT = potential cross-producer inconsistency

CURRENT_TEST_COVERAGE = value/string normalization and ordinary object ordering
CURRENT_TEST_GAP = NFC-equivalent key pair
WHY_EXISTING_TESTS_PASS = fixtures use ASCII distinct keys

MINIMAL_REQUIRED_FIX = add codec collision test and reject duplicates after normalization
ARCHITECTURAL_FIX_IF_REQUIRED = normalize+deduplicate keys before sorting/writing
REGRESSION_TESTS_REQUIRED = composed/decomposed Unicode key collisions and insertion permutations
MIGRATION_REQUIRED = UNKNOWN

INDEPENDENT_OR_DUPLICATE_ROOT = INDEPENDENT TEST GAP
RELATED_PRIOR_FINDING = FROZEN_AUTHORITY remains exact
CONFIDENCE = MEDIUM
```

### TG-ULTRA-04

```text
TITLE = source validator does not directly prove full melody-bearing phrase coverage
SEVERITY = TG
EVIDENCE_STRENGTH = TEST_GAP_ONLY

SUPPORTED_DEPLOYMENT_REACHABLE = YES
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = NO (current Quick Review producer creates full-section phrases)
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO

INVARIANT = phrase authority should cover the required melody-bearing interval without gaps
ROOT_CAUSE = validator checks non-overlap but not every full-coverage condition in the spec
AFFECTED_SUBSYSTEMS = Source phrase/section validation, generation readiness
EXACT_FILES = src/domain/source/validation.ts:402-418; docs/HARMONYMAKER_SPEC_v3.1.5.md:1499-1525
EXACT_FUNCTIONS = source phrase validation
EXACT_STATE_FIELDS = phrase start/end, section and melody coverage

FAILURE_SEQUENCE = hypothetical manual/current-schema source with phrase gap
REPRODUCTION_OR_PROBE = no current producer failure; Quick Review finalizer fills coverage
EXPECTED_RESULT = explicit coverage validation or documented producer-only invariant
ACTUAL_RESULT = test gap only

USER_OR_PROVIDER_IMPACT = unproven
DATA_OR_AUTHORITY_IMPACT = unproven
DETERMINISM_IMPACT = unproven

CURRENT_TEST_COVERAGE = overlap/range and Quick Review generated phrases
CURRENT_TEST_GAP = gap/missing-tail counterexamples at project import boundary
WHY_EXISTING_TESTS_PASS = producer creates complete phrases

MINIMAL_REQUIRED_FIX = add gap tests and enforce at authoritative import/project boundary if supported
ARCHITECTURAL_FIX_IF_REQUIRED = one phrase-coverage predicate shared by producer/validator
REGRESSION_TESTS_REQUIRED = head/middle/tail gaps and empty melody cases
MIGRATION_REQUIRED = UNKNOWN

INDEPENDENT_OR_DUPLICATE_ROOT = INDEPENDENT TEST GAP
RELATED_PRIOR_FINDING = none
CONFIDENCE = MEDIUM
```

### TG-ULTRA-05

```text
TITLE = needs-input provider payload lacks a consumer-complete runtime bound/validator
SEVERITY = TG
EVIDENCE_STRENGTH = TEST_GAP_ONLY

SUPPORTED_DEPLOYMENT_REACHABLE = NO (real adapter absent; malformed provider output not reproduced)
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = NO (unproven)
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO

INVARIANT = external adapter status must be runtime-validated and bounded before persistence/UI rendering
ROOT_CAUSE = synchronizeStatus persists status.request directly; contract types alone do not validate runtime payload
AFFECTED_SUBSYSTEMS = OMR provider adapter, status persistence/API/browser input UI
EXACT_FILES = src/domain/omr/contracts.ts:92-100;
              src/server/omr/application-service.ts:706-708;
              src/app/omr/OmrClient.tsx:238-240,420-422
EXACT_FUNCTIONS = synchronizeStatus; needs-input rendering/submission
EXACT_STATE_FIELDS = requestId, kind, choices/pageIndices/vendor payload

FAILURE_SEQUENCE = hypothetical malformed/unbounded adapter response -> persist/render without validation
REPRODUCTION_OR_PROBE = no real adapter or malformed response probe
EXPECTED_RESULT = explicit schema/cardinality/size/order validation
ACTUAL_RESULT = coverage/validation gap

USER_OR_PROVIDER_IMPACT = unproven UI/API failure
DATA_OR_AUTHORITY_IMPACT = potential invalid persisted interaction state
DETERMINISM_IMPACT = unproven

CURRENT_TEST_COVERAGE = typed fake adapters with valid bounded requests
CURRENT_TEST_GAP = malformed/oversized runtime values
WHY_EXISTING_TESTS_PASS = TypeScript fixtures satisfy the interface

MINIMAL_REQUIRED_FIX = runtime validator with explicit limits before store transition
ARCHITECTURAL_FIX_IF_REQUIRED = adapter boundary codec shared by service and tests
REGRESSION_TESTS_REQUIRED = wrong kind/id/order, oversized choices/payload and invalid primitives
MIGRATION_REQUIRED = NO

INDEPENDENT_OR_DUPLICATE_ROOT = INDEPENDENT TEST GAP
RELATED_PRIOR_FINDING = real provider remains external
CONFIDENCE = MEDIUM
```

### TG-ULTRA-06

```text
TITLE = actual PostgreSQL parity is absent for session/share/quota/idempotent share workflows
SEVERITY = TG
EVIDENCE_STRENGTH = TEST_GAP_ONLY

SUPPORTED_DEPLOYMENT_REACHABLE = YES
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = NO (no semantic divergence reproduced)
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO

INVARIANT = production PostgreSQL must match Memory for session/share/quota/idempotency lifecycle and concurrency
ROOT_CAUSE = the only *.postgres.test.ts suite focuses on OMR/store/S3; share/session services are Memory-only
AFFECTED_SUBSYSTEMS = PostgreSQL governance store, sessions, shares, quota/idempotency
EXACT_FILES = src/server/omr/postgres-store.postgres.test.ts;
              src/server/share/share-store.test.ts; src/server/security/security.test.ts
EXACT_FUNCTIONS = AnonymousSessionService; ShareStoreService; QuotaAndIdempotencyService;
                  create/complete/read/delete/report/cleanup operations
EXACT_STATE_FIELDS = session/share/idempotency/quota/report PostgreSQL rows, locks, timestamps, JSONB/envelopes

FAILURE_SEQUENCE = no production defect sequence proven
REPRODUCTION_OR_PROBE = topology inspection: actual PG suite 1 file/22 tests; none invoke these services/flows
EXPECTED_RESULT = actual-PG parity campaign for production share/session paths
ACTUAL_RESULT = Memory behavior is the only semantic execution evidence

USER_OR_PROVIDER_IMPACT = unknown
DATA_OR_AUTHORITY_IMPACT = unknown
DETERMINISM_IMPACT = concurrency/rowcount/timestamp parity unproved

CURRENT_TEST_COVERAGE = Memory share/session/quota unit tests; current migrations and OMR/S3 actual PG tests
CURRENT_TEST_GAP = actual-PG create replay/conflict/ack loss/read/delete/report/expiry/cleanup/concurrency
WHY_EXISTING_TESTS_PASS = adapter-independent services use the Memory implementation in their tests

MINIMAL_REQUIRED_FIX = add actual-PG parity fixtures and service-level scenarios
ARCHITECTURAL_FIX_IF_REQUIRED = shared conformance suite executed against Memory and PostgreSQL
REGRESSION_TESTS_REQUIRED = listed lifecycle, transaction and concurrency branches
MIGRATION_REQUIRED = NO

INDEPENDENT_OR_DUPLICATE_ROOT = INDEPENDENT TEST GAP
RELATED_PRIOR_FINDING = Memory/PostgreSQL parity aggregate PARTIAL
CONFIDENCE = HIGH
```

### TG-ULTRA-07

```text
TITLE = Node 22 runtime contract is not pinned in package or Vercel configuration
SEVERITY = TG
EVIDENCE_STRENGTH = TEST_GAP_ONLY

SUPPORTED_DEPLOYMENT_REACHABLE = YES
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = NO (current CI/build/preview failure not reproduced)
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO

INVARIANT = deployment runtime should enforce the same Node major tested by CI and documented for maintainers
ROOT_CAUSE = CI/readme name Node 22, but package engines and Vercel runtime pin are absent
AFFECTED_SUBSYSTEMS = package/runtime/deployment
EXACT_FILES = README.md:14; .github/workflows/ci.yml:25-35; package.json; vercel.json
EXACT_FUNCTIONS = runtime selection/configuration
EXACT_STATE_FIELDS = Node major and package engine contract

FAILURE_SEQUENCE = future platform default changes Node major without repository diff
REPRODUCTION_OR_PROBE = current build passes; no current failure
EXPECTED_RESULT = explicit supported Node engine/platform configuration
ACTUAL_RESULT = future-maintenance test gap

USER_OR_PROVIDER_IMPACT = unproven
DATA_OR_AUTHORITY_IMPACT = none proven
DETERMINISM_IMPACT = future environment drift risk

CURRENT_TEST_COVERAGE = Actions pins Node 22
CURRENT_TEST_GAP = package-install and Vercel runtime enforcement
WHY_EXISTING_TESTS_PASS = CI supplies its own Node version

MINIMAL_REQUIRED_FIX = pin supported Node engine/runtime after confirming Vercel contract
ARCHITECTURAL_FIX_IF_REQUIRED = one runtime version source for local/CI/deploy
REGRESSION_TESTS_REQUIRED = engine/platform configuration check
MIGRATION_REQUIRED = NO

INDEPENDENT_OR_DUPLICATE_ROOT = INDEPENDENT TEST GAP
RELATED_PRIOR_FINDING = none
CONFIDENCE = MEDIUM
```

## G. Existing closure revalidation

이 평가는 과거 finding의 **정확한 original invariant**와 이번에 새로 발견한 독립 root를 구분한다. 이전 closure를 동일 root가 아닌 새 caller/transition 때문에 거짓으로 소급 무효화하지 않는다.

```text
P1_01_TO_07 = CLOSED_CONFIRMED (exact original invariants)
P2_01_TO_05 = CLOSED_CONFIRMED (exact original invariants)
P1_SAT_01 = CLOSED_CONFIRMED (backend replay); browser aggregate reopened independently
P1_SAT_02 = CLOSED_CONFIRMED
P1_SAT_03 = CLOSED_CONFIRMED
P2_SAT_04 = CLOSED_CONFIRMED for OMR bounded JSON; new share route boundary is P2-ULTRA-09
P1_RESAT_01 = CLOSED_CONFIRMED for exact status/capture token fencing
P1_RESAT_02 = CLOSED_CONFIRMED for S3 publication generations/ambiguous Put/Delete
P1_RESAT_03 = CLOSED_CONFIRMED for import provenance; snapshot semantic cache is independent
P2_RESAT_01_TO_04 = CLOSED_CONFIRMED (exact original invariants)

CREATE_CERTAINTY = CLOSED_CONFIRMED
CREATE_REPLAY_REJECTION = CLOSED_CONFIRMED at backend
CREATE_LATER_SUCCESS = CLOSED_CONFIRMED
STALE_CREATE_FENCING = CLOSED_CONFIRMED
BROWSER_RECOVERY = REOPENED_CURRENT_SUPPORTED (P1-ULTRA-04, P1-ULTRA-06)
BROWSER_FRESH_AMBIGUITY = REOPENED_CURRENT_SUPPORTED (P1-ULTRA-06)
PROVIDER_ROTATION = PARTIAL (A-retained routing closed; upload-stage A-unavailable is P1-ULTRA-09)
UNAVAILABLE_HISTORICAL_BINDING = PARTIAL (prior branches closed; upload pre-dispatch taxonomy open)
PAGE_COMMIT_ACK = PARTIAL (prior commit-ack closed; failPage aggregate atomicity is P1-ULTRA-08)
RESULT_COMMIT_ACK = CLOSED_CONFIRMED
STATUS_CAPTURE_FENCING = PARTIAL (token mechanics closed; legal created status omitted)
OBJECT_PUBLICATION_LEDGER = CLOSED_CONFIRMED conditional on invocation
AMBIGUOUS_PUT = CLOSED_CONFIRMED
AMBIGUOUS_DELETE = CLOSED_CONFIRMED for S3; provider DELETE is a separate root
GENERATION_PHYSICAL_KEY_ISOLATION = CLOSED_CONFIRMED
CLEANUP_RECLAIM = REOPENED_CURRENT_SUPPORTED at production entrypoint/provider-delete authority
QUOTA_CREDIT = PARTIAL (accounting mechanics closed; scheduled release path unreachable)
OMR_PROVENANCE_READINESS = PARTIAL (backend closed; browser page/evidence rebinding open)
PROJECT_RELOAD = REOPENED_CURRENT_SUPPORTED (P1-ULTRA-01/02/03)
FROZEN_AUTHORITY = CLOSED_CONFIRMED

P1_RESAT_02_F = NOT_APPLICABLE_PRE_PRODUCTION_LEGACY_PATH
```

따라서 exact-current supported P1이 존재하므로 Segment D gate 재개방 조건은 충족한다. 이는 closure 구현을 시작한다는 뜻이 아니며 이 문서는 discovery finding만 기록한다.

## H. Commands

Bundled local runtime를 PATH에 노출하기 전 첫 literal `npm ci` 시도는 host command-not-found였고 repository code는 실행되지 않았다. 이후 동일 npm CLI를 Node로 실행해 필수 캠페인을 완료했다. Local runtime은 Node 24.19.0/npm 11.6.2였고 CI는 repository workflow대로 Node 22를 사용한다.

```text
npm ci = PASS — 451 packages added, 452 audited, 0 vulnerabilities
npm run typecheck = PASS
npm run lint = PASS
npm test = PASS — final full rerun 66 files/689 tests
  first full attempt = 688/689; security-gate.test.ts one 5-second timeout
  isolated retry = PASS, 1 file/8 tests, test body 269 ms
  second full attempt = PASS, 66 files/689 tests, 25.98 s
npm run test:postgres = PASS — PostgreSQL 17.11 fresh cluster, migrations 1–11, 1 file/22 tests
npm run build = PASS — Next.js 16.3.0 production build, 13 static pages/routes compiled
git diff --check = PASS

TEST_FILES = 66
TEST_COUNT = 689
POSTGRES_TEST_FILES = 1
POSTGRES_TEST_COUNT = 22

SEGMENT_B_101 = PASS — segment-b deterministic test, 101 complete executions
OMR_101 = PASS — pipeline-determinism, 101 provider-call permutations
FROZEN_AUTHORITY = PASS — 2 files/7 tests; six hashes and 99-code/config/version bindings exact
TARGETED_CORE_CAMPAIGN = PASS — 11 files/218 tests
```

Exact targeted commands:

```powershell
npm test -- src/grammar/segment-b.test.ts -t 'is deterministic across 101 complete executions'
npm test -- src/server/omr/pipeline-determinism.test.ts
npm test -- src/grammar/authority.test.ts src/domain/registries.test.ts
npm test -- src/grammar/authority.test.ts src/grammar/segment-b.test.ts src/grammar/pipeline.test.ts src/grammar/lifecycle.test.ts src/grammar/validator.test.ts src/product/product-core.test.ts src/domain/project-integrity.test.ts src/import/musicxml/import.test.ts src/import/mxl/archive.test.ts src/import/review/quick-review.test.ts src/import/review/acceptance.test.ts
```

Fresh PostgreSQL command used `TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55439/harmonymaker_ultra`; the server was stopped and its validated task-local cluster directory was permanently removed after the run.

Six SHA-256 values:

```text
README_APPLY.md = 5c8c704fc0e5ab51adb628022aeaf7e97b33b287610b1fd5533a177b65fd4ede
docs/WORSHIP_ARRANGEMENT_GRAMMAR_v1.md = ee09ded709273cc6468f1fd3f1df319d04458716f6ad911a878bffdb9b4498d5
docs/WORSHIP_ARRANGEMENT_GRAMMAR_v1.freeze.json = 3ded5968b34d7fbd48a3f58f22b67370a8ec4ea36fbd4e0ed834c81d5ed080ba
src/grammar/worship-arrangement-grammar-v1.0.1.canonical.json = 676780f8ceacda6d88c5724156f84f95fb5b337b4d13d16342f5342cb617330d
src/grammar/wag-v1-diagnostic-baseline.canonical.json = 0fa15cf0652e41b1509df0f8d140bfa165726a6799a83b19eed59b58dbbbab4c
src/grammar/wag-v1-diagnostic-extension.canonical.json = 4be25a0ae3cc28812b85da585e1ef6f0aa2f0ce5fc560e34177aa49eee06379b
```

## I. Temporary probes

```text
PROBE_COUNT = 4
PROBE_FILES = 0
ALL_PROBES_REMOVED = YES
EXTERNAL_NETWORK_OR_PROVIDER_CALLS = 0
```

세 개의 core probe는 PowerShell here-string을 다음 exact wrapper의 stdin으로 전달했다. 각 script는 Vite middleware server의 `ssrLoadModule`로 current production modules를 읽고 `finally`에서 server를 닫았다. 파일은 만들지 않았다.

```powershell
@'<inline ESM using createServer({server:{middlewareMode:true},appType:"custom",logLevel:"silent"})>'@ |
  & 'C:\Users\eccto\AppData\Local\OpenAI\Codex\runtimes\cua_node\2fb562745e6d66f0\bin\node.exe' --input-type=module -
```

```text
PROBE_1 = snapshot semantic mutation plus repeat-edit state
RESULT_1 = {"tamperedStatus":"complete","exportedBytes":45415,"reloadedMutatedPitch":"C9",
            "storedDigestUnchanged":true,
            "renderedArtifactDigest":"dec4994ad4de49aca3f2888f87aad05dc8f3d68a80c57f9fd43ecfdb51756850",
            "originalSnapshotDigest":"dec4994ad4de49aca3f2888f87aad05dc8f3d68a80c57f9fd43ecfdb51756850",
            "changedEditWithHistoricalSnapshot":"blocked","repeatedIdenticalSnapshot":"blocked"}

PROBE_2 = 4/4→6/8 MusicXML export/reimport
RESULT_2 = {"timeElementCount":1,"secondMeasureHasTime":false,
            "reimportedTimes":["4/4:4/1","4/4:4/1"]}

PROBE_3 = one-quarter 4/4 pickup export/reimport
RESULT_3 = {"exportedImplicit":false,"reimportedDuration":"4/1","reimportedImplicit":false}

PROBE_4 = schema-valid highly compressible URL-share size ordering, inline bundled Node -e
RESULT_4 = plaintextBytes=1000632, encodedBytes=1811, plaintextLimit=262144, urlLimit=6000;
           URL branch accepts before the plaintext limit
```

OMR lifecycle findings은 별도 fault script 없이 current emitted error taxonomy, exact state transitions, Memory/PG implementation 차이와 non-test caller reachability로 증명했다.

## J. Repository mutation check

Documentation file 생성 직전과 probe/runtime 정리 후 `git status`, tracked/cached diff, untracked list, `git diff --check`를 확인했다. Documentation commit에는 이 파일 하나만 포함한다.

```text
PRODUCTION_DIFF = 0
TEST_DIFF = 0
MIGRATION_DIFF = 0
DEPENDENCY_DIFF = 0
CONFIG_DIFF = 0
EXISTING_HANDOFF_DIFF = 0
TEMPORARY_PROBE_FILES = 0
NEW_REPORT_FILE_ONLY = YES
```

## K. Documentation commit

Git commit은 그 commit hash를 자기 파일 내용에 포함할 수 없다. 파일 내용이 바뀌면 tree와 commit hash도 바뀌므로 이는 SHA 자기참조 고정점 문제다. 따라서 거짓 placeholder SHA를 쓰지 않고, containing documentation commit의 exact SHA와 remote divergence는 push 뒤 이 세션의 최종 외부 evidence에서 보고한다. 이 방식은 기존 Segment D handoff의 “containing additive commit은 push 후 외부 exact-SHA 검증” 패턴과 같다.

```text
ULTRA_AUDIT_BASE_CODE_SHA = b4e14976ab65899cc86a65c20c99a7545f1a0d9e
ULTRA_DISCOVERY_DOCUMENTATION_SHA = EXTERNAL_POST_COMMIT_EXACT_SHA
COMMIT_MESSAGE = docs: record Ultra discovery audit
REMOTE_BRANCH_EXACT = EXTERNAL_POST_PUSH_VERIFICATION
LOCAL_REMOTE_DIVERGENCE = EXTERNAL_POST_PUSH_VERIFICATION
WORKTREE = CLEAN_REQUIRED_AFTER_COMMIT
```

## L. CI / Vercel

Actions와 Vercel은 containing commit이 존재하고 push된 뒤에만 실행되므로, 동일한 자기참조 이유로 immutable containing commit 안에 그 사후 결과를 사실처럼 미리 쓸 수 없다. 최종 exact documentation SHA에 대한 terminal evidence는 세션 최종 출력에서 아래 필드 그대로 확정한다.

```text
GITHUB_ACTIONS_RUN = EXTERNAL_POST_PUSH_TERMINAL_EVIDENCE
QUALITY_JOB = EXTERNAL_POST_PUSH_TERMINAL_EVIDENCE
HEAD_SHA = EXTERNAL_POST_COMMIT_EXACT_SHA
RESULT = EXTERNAL_POST_PUSH_TERMINAL_EVIDENCE
TEST_FILES = 66 (expected current suite; exact log rechecked after push)
TEST_COUNT = 689 (expected current suite; exact log rechecked after push)
POSTGRES_TEST_FILES = 1 (expected current suite; exact log rechecked after push)
POSTGRES_TEST_COUNT = 22 (expected current suite; exact log rechecked after push)

VERCEL_DEPLOYMENT_ID = EXTERNAL_POST_PUSH_TERMINAL_EVIDENCE
GITHUB_DEPLOYMENT_ID = EXTERNAL_POST_PUSH_TERMINAL_EVIDENCE
STATUS_ID = EXTERNAL_POST_PUSH_TERMINAL_EVIDENCE
HEAD_SHA = EXTERNAL_POST_COMMIT_EXACT_SHA
RESULT = EXTERNAL_POST_PUSH_TERMINAL_EVIDENCE
PREVIEW = EXTERNAL_POST_PUSH_TERMINAL_EVIDENCE
```

CI/Vercel green은 위 finding을 닫거나 severity를 변경하지 않는다.

## M. External verification remaining

```text
REAL_PROVIDER = NOT CONNECTED; selection/credentials/accuracy/pricing/refund/retention/
                deletion/idempotency/reconciliation remain external
CORPUS = rights-safe Dev >=36 and sealed >=24 remain external
PRODUCTION_LIVE_POSTGRES = NOT PERFORMED
PRODUCTION_LIVE_S3 = NOT PERFORMED
IPHONE_SAFARI = NOT PERFORMED
KAKAO_IN_APP = NOT PERFORMED
```

Unconfigured production provider는 fail-closed하고, reference mode는 production에서 허용되지 않으며, repository는 real capability를 연결된 것처럼 노출하지 않는다. 비-OMR Product Core는 provider 미구성 때문에 차단되지 않는다. 따라서 외부 remaining 자체를 finding으로 계산하지 않았다.

## N. Discovery verdict

```text
SUPPORTED_P0 = 0
SUPPORTED_P1 = 9
NONBLOCKING_P2 = 15
TEST_GAPS = 7
HISTORICAL_OR_EXTERNAL_NA = 1 unsupported historical finding + listed external verification

SEGMENT_D_GATE_REOPEN_REQUIRED = YES — exact current supported P1 reproduction exists
ULTRA_DISCOVERY_COMPLETE = YES
ULTRA_FINDINGS_READY_FOR_INDEPENDENT_REVIEW = YES
ULTRA_CLOSURE_STARTED = NO
ULTRA_REAUDIT_STARTED = NO
ULTRA_ACCEPTED = NOT_YET_ASSESSED
STEP_11_STARTED = NO
```

이 보고서는 finding discovery에서 멈춘다. Production/test/migration/config patch, closure, re-audit, Step 11, real-provider integration 또는 main update를 수행하지 않았다.
