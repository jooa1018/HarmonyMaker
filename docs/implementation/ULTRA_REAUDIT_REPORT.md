# HarmonyMaker Ultra post-closure 독립 re-audit 보고서

이 문서는 Ultra closure 이후 exact repository를 대상으로 수행한 **software correctness / reliability / data integrity only** re-audit 결과다. 기존 closure의 `CLOSED` 선언을 전제로 삼지 않았고, 실제 code path, production caller, durable state transition, actual PostgreSQL 17을 우선했다. Finding은 이 세션에서 수정하지 않았다. 보안 평가·공격적 검증은 수행하지 않았고 보안 PASS를 선언하지 않는다.

## A. Exact baseline

```text
REPOSITORY = jooa1018/HarmonyMaker
MAIN_HEAD = b4e14976ab65899cc86a65c20c99a7545f1a0d9e
DISCOVERY_HEAD = d81d7dfb3f749a78cb2ebac45b8319dd865598a8
CLOSURE_CODE_CHECKPOINT = fac726f7f56f73ebaab24916f88b6da7aba5a910
CLOSURE_FINAL_HEAD = 2b14c6a091b6060dd9ebadaf569e561b23e491b2
CLOSURE_HEAD = 2b14c6a091b6060dd9ebadaf569e561b23e491b2
SEGMENT_C_BASE = bfadfad1d4bc04e11d348c1270976802a1dc4acc
PRE_ULTRA_SEGMENT_D_CODE_AUTHORITY = 85e8913c7095caacee6a41661fe20485343b3124
REAUDIT_BRANCH = codex/harmonymaker-ultra-reaudit
REAUDIT_START_HEAD = 2b14c6a091b6060dd9ebadaf569e561b23e491b2
START_REAUDIT_HEAD = 2b14c6a091b6060dd9ebadaf569e561b23e491b2
WORKTREE_BEFORE_REPORT = CLEAN
WORKTREE = CLEAN AT START; NEW REPORT ONLY BEFORE COMMIT
LOCAL_REMOTE_DIVERGENCE_AT_START = main 0/0; discovery 0/0; closure 0/0
DIVERGENCE = main 0/0; discovery 0/0; closure 0/0; re-audit absent at start
HISTORY_REWIND = NO
MAIN_UNCHANGED = YES
```

`git fetch --prune origin` 후 local/remote exact SHA를 대조했다. Re-audit branch는 local과 remote 모두 없었으므로 closure final SHA에서 생성했다. 다음 ancestry가 모두 성립했다.

```text
d81d7df... IS_ANCESTOR_OF fac726f... = YES
fac726f... IS_ANCESTOR_OF 2b14c6a... = YES
2b14c6a... DIRECT_PARENT = fac726f...
bfadfad... IS_ANCESTOR_OF 85e8913... = YES
85e8913... IS_ANCESTOR_OF d81d7df... = YES
DISCOVERY_REPORT_DIFF_AFTER_DISCOVERY_SHA = 0
```

`fac726f... → 2b14c6a...`는 README와 기존 handoff/evidence/runbook, 새 closure report만 변경한 documentation-only descendant다. Production/test/migration/dependency/config 변경은 없다. `main`은 closure code를 포함하지 않으며 exact frozen SHA에 남아 있다.

## B. Closure history와 diff inventory

```text
DISCOVERY_TO_CODE_CHECKPOINT_COMMITS = 15
DISCOVERY_TO_CODE_CHECKPOINT_DIFF = 118 files, +10585/-904
CODE_CHECKPOINT = fac726f7f56f73ebaab24916f88b6da7aba5a910
DOCUMENTATION_ONLY_FINAL_DESCENDANT = YES
ORPHAN_ARCHITECTURE_EXPANSION = NONE FOUND
```

| Commit | 연결 finding / root cause | 새 authority와 downstream / 검증 효과 |
|---|---|---|
| `843e911` | P1-01/02/03, P2-01/02/05/06/12, TG-02/03/04 | Candidate/Edit/Snapshot 재도출, route controller, MusicXML timing authority를 project persistence·render·export·playback에 연결. 31 files, +2017/-481. |
| `6e28c62` | P1-04/05, P2-03/07/08/09/10/11, TG-06/07 | Share recovery envelope, bounded route, cleanup/runtime/migration authority를 browser/API/PG/Vercel에 연결. 55 files, +2039/-161. |
| `bcd3e53` | P1-04 | completed/pending replay branch가 실제 `ShareStore` caller에서 도달하도록 복구. 2 files, +37/-3. |
| `b4251de` | Wave 1 closure evidence | snapshot tamper, route/timing/phrase/config evidence와 production caller 보강. 9 files, +706/-129. |
| `75cdbc1` | P1-02 | stale workspace project-delete completion fence. 3 files, +74/-4. |
| `13b036f` | Wave 2 closure evidence | Share/session/moderation/cleanup/migration cross-boundary tests. 20 files, +591/-68. |
| `1cd7877` | P1-06..10, P2-14/15, TG-05 | typed OMR create, provider binding/delete/failPage, manifest/retry/status codec. 22 files, +2984/-164. |
| `7181f25` | P2-10, TG-06 | migration checksum 및 Memory/PostgreSQL parity alignment. 3 files, +27/-6. |
| `0bcd19d` | P1-06/10, P2-14 | browser recovery/start fence와 persisted create authority. 5 files, +122/-5. |
| `8c9e56c` | P1-07 | provider-delete operation ledger와 two-aggregate monotonic finalization. 5 files, +384/-25. |
| `6cb3759` | P2-14 | stale OMR monitor/abort/generation fence. 6 files, +406/-54. |
| `f3de247` | P1-04/05, P2-03/07/08/09/10/11 | Share playback, scheduler isolation, moderation, migration/runtime gaps. 30 files, +761/-114. |
| `661a966` | P2-03/07 | bounded Share playback timing/default authority. 5 files, +117/-22. |
| `7abdd12` | P1-07/09/10, P2-14/15 | OMR delete/status/upload/browser race hardening. 6 files, +420/-55. |
| `fac726f` | P1-01/02/03, P2-02/06 | final project integrity, workspace and timing authority gaps. 8 files, +341/-54. |

모든 changed production file을 original finding, root cause, canonical authority, downstream consumer, test, migration/runtime effect에 연결했다. Finding과 무관한 새 product surface나 별도 architecture expansion은 찾지 못했다. 다만 아래 finding처럼 closure authority 자체의 generation/fairness/CAS 범위가 불충분한 변경은 존재한다.

Changed-file inventory는 production 67, test 40, migration code 4, docs 2, dependency/config 4, script 1로 분류됐다. Exact `git diff --name-only d81d7df... fac726f...` 결과는 다음 118개다.

```text
.env.example
README.md
docs/implementation/PRETRAFFIC_MIGRATION_RUNBOOK.md
package-lock.json
package.json
scripts/migrate.mjs
src/app/api/internal/cleanup/route.ts
src/app/api/internal/moderation/reports/[reportId]/claim/route.ts
src/app/api/internal/moderation/reports/[reportId]/resolve/route.ts
src/app/api/internal/moderation/reports/route.ts
src/app/api/session/route.ts
src/app/api/shares/[token]/reconcile/route.ts
src/app/api/shares/[token]/report/route.ts
src/app/api/shares/[token]/route.ts
src/app/api/shares/recover/route.ts
src/app/api/shares/route.ts
src/app/import/ImportReviewClient.tsx
src/app/omr/OmrClient.tsx
src/app/omr/browser-job-lifecycle.test.ts
src/app/omr/browser-job-lifecycle.ts
src/app/omr/browser-job-manifest.indexeddb.test.ts
src/app/omr/browser-job-manifest.test.ts
src/app/omr/browser-job-manifest.ts
src/app/omr/browser-monitor.test.ts
src/app/omr/browser-recovery.test.ts
src/app/omr/browser-recovery.ts
src/app/share/SharedPracticeClient.tsx
src/app/workspace/WorkspaceClient.tsx
src/domain/digest/canonical.test.ts
src/domain/digest/canonical.ts
src/domain/edit-share.test.ts
src/domain/omr/browser-handoff.test.ts
src/domain/omr/browser-handoff.ts
src/domain/omr/contracts.ts
src/domain/omr/normalization-readiness.test.ts
src/domain/omr/review.test.ts
src/domain/omr/vendor-input-codec.test.ts
src/domain/project-integrity.test.ts
src/domain/project-integrity.ts
src/domain/share-compression.ts
src/domain/share.ts
src/domain/source/phrase-coverage.test.ts
src/domain/source/validation.ts
src/import/review/commands.ts
src/import/review/draft-durability.test.ts
src/import/review/draft-durability.ts
src/import/review/quick-review.test.ts
src/integrity/candidate-evidence.ts
src/integrity/edited-snapshot-authority.ts
src/integrity/edited-snapshot-validation.ts
src/product/ProductPracticePlayer.tsx
src/product/audio-context-lifecycle.test.ts
src/product/edited-arrangement.ts
src/product/edited-validation.ts
src/product/local-project-store.ts
src/product/musicxml-export.ts
src/product/musicxml-timing.test.ts
src/product/playback-plan.ts
src/product/practice-audio-ownership.ts
src/product/practice-player-defaults.test.ts
src/product/practice-share.ts
src/product/product-core.test.ts
src/product/render.ts
src/product/score-adapter.ts
src/product/share-create-api.test.ts
src/product/share-create-api.ts
src/product/share-create-key.ts
src/product/share-create-recovery.test.ts
src/product/share-create-recovery.ts
src/product/share-locator.test.ts
src/product/share-locator.ts
src/product/share-report.test.ts
src/product/share-report.ts
src/product/share-url.ts
src/product/shared-practice-playback.test.ts
src/product/shared-practice.ts
src/product/track-roles.ts
src/product/workspace-controls.ts
src/product/workspace-route-controller.test.ts
src/product/workspace-route-state.test.ts
src/product/workspace-route-state.ts
src/server/cleanup/scheduled-cleanup.test.ts
src/server/cleanup/scheduled-cleanup.ts
src/server/http/api.ts
src/server/http/bounded-json.test.ts
src/server/http/bounded-json.ts
src/server/http/internal-api.ts
src/server/http/moderation-route.test.ts
src/server/http/omr-api.test.ts
src/server/http/omr-api.ts
src/server/http/share-create-recovery-route.test.ts
src/server/http/share-owner-reconcile-route.test.ts
src/server/omr/application-service.test.ts
src/server/omr/application-service.ts
src/server/omr/postgres-store.postgres.test.ts
src/server/omr/postgres-store.ts
src/server/omr/production-service.test.ts
src/server/omr/production-service.ts
src/server/omr/store.ts
src/server/persistence/memory-store.test-adapter.ts
src/server/persistence/migrations.test.ts
src/server/persistence/migrations.ts
src/server/persistence/migrations/012_share_moderation_lifecycle.sql
src/server/persistence/migrations/013_omr_provider_delete_authority.sql
src/server/persistence/migrations/014_share_create_cross_session_recovery.sql
src/server/persistence/postgres-store.ts
src/server/persistence/store.ts
src/server/security/quota-core.ts
src/server/security/session-admission.test.ts
src/server/security/session-admission.ts
src/server/security/session-core.ts
src/server/share/idempotent-create.ts
src/server/share/share-session-conformance.postgres.test.ts
src/server/share/share-store-core.ts
src/server/share/share-store.test.ts
src/server/substrate/runtime-contract.test.ts
src/server/substrate/services.ts
vercel.json
```

## C. Re-audit passes

Latest 요청의 four-pass 구조와 원 요청의 six-pass 요구를 함께 충족했다.

```text
PASS_1_CLOSURE_REVALIDATION = FAIL — original 3 REOPENED, 5 PARTIAL
PASS_2_CHANGED_SURFACE = FAIL — supported new P1/P2 regressions confirmed
PASS_3_CROSS_SYSTEM = FAIL — workspace/timing/share/OMR combined flows fail
PASS_4_FULL_VALIDATION = PASS — Node 22, full tests, PG17, migrate, build, frozen authority

PASS_1_DIFF_INVENTORY = COMPLETE
PASS_2_ORIGINAL_REPRODUCTION = COMPLETE
PASS_3_ADVERSARIAL_STATE = COMPLETE
PASS_4_CROSS_WAVE = COMPLETE
PASS_5_POSTGRES_DEPLOYMENT = COMPLETE
PASS_6_TEST_GAP = COMPLETE
```

Stale worker, response loss, concurrent caller/tab, reload, session rotation, process replacement, lease expiry/reclaim, old/new identity overlap, malformed persisted state, cleanup overlap, cancel/delete/current supersession을 추적했다. Test가 helper/reducer/Memory/fake SQL만 검증하는 경우 production caller와 actual DB에서 별도 추적하거나 temporary probe로 보완했다.

## D. Original P1 revalidation

| Finding | 상태 | Original reproduction now / invariant / actual result |
|---|---|---|
| `P1-ULTRA-01` | `CLOSED_CONFIRMED` | Persisted Candidate/Snapshot의 pitch, duration, lyric, anchor, metrics, diagnostics, status, digest, edit order를 변조하면 current materializer/validator의 independent rederivation과 exact comparison에서 거부된다. Import/IndexedDB/render/playback/share/export gate까지 연결됨. |
| `P1-ULTRA-02` | `PARTIAL` | A→B stale load 및 다른-ID mutation은 닫혔으나 mutation token이 `projectId`만 담는다. 같은 ID의 newer revision 또는 A→B→A ABA 뒤 old async mutation이 current로 승인되어 stale project를 저장할 수 있다. |
| `P1-ULTRA-03` | `PARTIAL` | Pickup, incomplete measure, mixed meter, tempo core는 닫혔다. 그러나 exporter의 `divisions` LCM이 harmony chord offset denominator를 누락해 `1/3` offset을 decimal로 쓰고 importer가 drop한다. Timing round-trip invariant가 여전히 깨진다. |
| `P1-ULTRA-04` | `REOPENED_SUPPORTED` | Single-tab K1 response-loss/reload는 닫혔다. 두 탭 최초 create는 비원자적 IDB load/save로 K1/K2를 각각 만들고 PostgreSQL에 active share 2개를 생성하며 마지막 completion만 delete authority를 보존한다. |
| `P1-ULTRA-05` | `CLOSED_CONFIRMED` | Vercel cron, auth-before-composition, 25s budget, generic/OMR isolation, lease reclaim, structured 207가 production route에 연결됐다. 별도 신규 fairness P1은 아래에 기록한다. |
| `P1-ULTRA-06` | `CLOSED_CONFIRMED` | 모든 current typed create error가 browser exhaustive policy에 연결되고 pending/uncertain/reconciliation은 K1을 보존한다. 별도 신규 cross-session idempotency P1은 아래에 기록한다. |
| `P1-ULTRA-07` | `CLOSED_CONFIRMED` | Direct/direct, direct/cleanup, stale lease, idempotent/non-idempotent response loss와 restart가 하나의 durable provider-delete ledger로 수렴하며 job aggregate merge는 monotonic하다. |
| `P1-ULTRA-08` | `CLOSED_CONFIRMED` | Actual PG17에서 job→page lock, exact token, page/job atomic update와 fault rollback을 확인했다. Stale token은 무변경이며 Memory/PG supported semantics가 일치한다. |
| `P1-ULTRA-09` | `CLOSED_CONFIRMED` | Historical adapter resolution이 page claim 전 수행된다. A 부재 시 page/retry budget 불변, B call 0, restart/A restore 후 exact upload가 재개된다. |
| `P1-ULTRA-10` | `REOPENED_SUPPORTED` | Manual reorder/replace와 reload manifest는 닫혔으나 concurrent async page preparation에 generation fence가 없다. Manifest/upload A와 React preview/evidence overlay B가 분리될 수 있다. |

```text
P1_CLOSED_CONFIRMED = 6/10
P1_REOPENED_SUPPORTED = 2/10
P1_PARTIAL = 2/10
```

```text
P1_ULTRA_01 = CLOSED_CONFIRMED
P1_ULTRA_02 = PARTIAL
P1_ULTRA_03 = PARTIAL
P1_ULTRA_04 = REOPENED_SUPPORTED
P1_ULTRA_05 = CLOSED_CONFIRMED
P1_ULTRA_06 = CLOSED_CONFIRMED
P1_ULTRA_07 = CLOSED_CONFIRMED
P1_ULTRA_08 = CLOSED_CONFIRMED
P1_ULTRA_09 = CLOSED_CONFIRMED
P1_ULTRA_10 = REOPENED_SUPPORTED
```

## E. Original P2 revalidation

| Finding | 상태 | ORIGINAL_FAILURE_REPRODUCES / caller·cross-system result |
|---|---|---|
| `P2-ULTRA-01` blocked generation persistence | `CLOSED_CONFIRMED` | Original failure `NO`; blocked result persistence는 구현됨. Mounted browser/real IDB coverage는 신규 TG로 분리. |
| `P2-ULTRA-02` edit revision/snapshot history | `CLOSED_CONFIRMED` | Original second-edit overwrite `NO`; immutable ordinal/history는 유지. Closure가 만든 unbounded history 비용은 신규 P2. |
| `P2-ULTRA-03` PracticeShare playback defaults | `PARTIAL` | Source-first fixtures는 통과하지만 schema-valid reordered payload에서 index authority가 다른 track을 선택. |
| `P2-ULTRA-04` AudioContext lifecycle | `CLOSED_CONFIRMED` | Pure lifecycle state의 resume/close contract는 닫힘. Mounted Web Audio coverage는 신규 TG. |
| `P2-ULTRA-05` ABC free-text encoding | `CLOSED_CONFIRMED` | Title/lyrics/directive 경계 encoding·escaping이 exact하게 적용되고 original injection/corruption sequence는 재현되지 않음. |
| `P2-ULTRA-06` selected lead key authority | `REOPENED_SUPPORTED` | Non-selected first part의 global modulation diagnostic이 selected lead를 계속 막고, explicit key override가 lead switch에서 source key로 덮인다. |
| `P2-ULTRA-07` consumer-complete PracticeShare | `CLOSED_CONFIRMED` | Validator/materializer의 role/chord/timing bounds와 controlled unavailable state가 caller까지 연결됨. |
| `P2-ULTRA-08` single share locator identity | `CLOSED_CONFIRMED` | Dual source 거부, token/inline discriminator, stale reducer fence와 exact report identity 확인. |
| `P2-ULTRA-09` bounded structured share/session input | `PARTIAL` | Raw/fatal UTF-8/JSON/cardinality/report ordering은 닫힘. 256–384KiB valid payload는 quota를 먼저 소비한 뒤 plaintext cap에서 거부됨. |
| `P2-ULTRA-10` pretraffic migration/runtime verify-only | `CLOSED_CONFIRMED` | Node22 fresh/repeat migrate와 actual production composition schema no-write를 확인. |
| `P2-ULTRA-11` moderation/report lifecycle | `CLOSED_CONFIRMED` | First report→list→claim→resolve/takedown/audit flow는 닫힘. Terminal acknowledgement-loss idempotency는 신규 P2. |
| `P2-ULTRA-12` README/current authority | `CLOSED_CONFIRMED` | Closure documentation과 runtime/migration/frozen authority가 일치하고 protected path diff 0. |
| `P2-ULTRA-14` browser retry lifecycle | `PARTIAL` | 60s/5m/30m, reload, manual resume, cancel, stale monitor는 닫힘. Handoff 후 delete authority 소실과 expired delete-pending browser lock이 남음. |
| `P2-ULTRA-15` provider status handling | `CLOSED_CONFIRMED` | 모든 legal status, 특히 repeated `created`, exact lease release 확인. Malformed top-level runtime object는 신규 TG. |

```text
P2_CLOSED_CONFIRMED = 10/14
P2_REOPENED_SUPPORTED = 1/14
P2_PARTIAL = 3/14
```

```text
P2_ULTRA_01 = STATUS CLOSED_CONFIRMED; ORIGINAL_FAILURE_REPRODUCES NO; CLOSURE_TEST_VALID YES; CURRENT_CALLER_VALID YES; CROSS_SYSTEM_REGRESSION TG-REAUDIT-03
P2_ULTRA_02 = STATUS CLOSED_CONFIRMED; ORIGINAL_FAILURE_REPRODUCES NO; CLOSURE_TEST_VALID YES; CURRENT_CALLER_VALID YES; CROSS_SYSTEM_REGRESSION P2-REAUDIT-02
P2_ULTRA_03 = STATUS PARTIAL; ORIGINAL_FAILURE_REPRODUCES PARTIAL; CLOSURE_TEST_VALID PARTIAL; CURRENT_CALLER_VALID NO; CROSS_SYSTEM_REGRESSION P2-REAUDIT-03
P2_ULTRA_04 = STATUS CLOSED_CONFIRMED; ORIGINAL_FAILURE_REPRODUCES NO; CLOSURE_TEST_VALID YES; CURRENT_CALLER_VALID STATIC; CROSS_SYSTEM_REGRESSION TG-REAUDIT-04
P2_ULTRA_05 = STATUS CLOSED_CONFIRMED; ORIGINAL_FAILURE_REPRODUCES NO; CLOSURE_TEST_VALID YES; CURRENT_CALLER_VALID YES; CROSS_SYSTEM_REGRESSION NONE
P2_ULTRA_06 = STATUS REOPENED_SUPPORTED; ORIGINAL_FAILURE_REPRODUCES YES; CLOSURE_TEST_VALID PARTIAL; CURRENT_CALLER_VALID NO; CROSS_SYSTEM_REGRESSION P2-REAUDIT-01
P2_ULTRA_07 = STATUS CLOSED_CONFIRMED; ORIGINAL_FAILURE_REPRODUCES NO; CLOSURE_TEST_VALID YES; CURRENT_CALLER_VALID YES; CROSS_SYSTEM_REGRESSION P2-REAUDIT-03
P2_ULTRA_08 = STATUS CLOSED_CONFIRMED; ORIGINAL_FAILURE_REPRODUCES NO; CLOSURE_TEST_VALID YES; CURRENT_CALLER_VALID YES; CROSS_SYSTEM_REGRESSION P2-REAUDIT-05
P2_ULTRA_09 = STATUS PARTIAL; ORIGINAL_FAILURE_REPRODUCES PARTIAL; CLOSURE_TEST_VALID PARTIAL; CURRENT_CALLER_VALID NO; CROSS_SYSTEM_REGRESSION P2-REAUDIT-04
P2_ULTRA_10 = STATUS CLOSED_CONFIRMED; ORIGINAL_FAILURE_REPRODUCES NO; CLOSURE_TEST_VALID YES; CURRENT_CALLER_VALID YES; CROSS_SYSTEM_REGRESSION NONE
P2_ULTRA_11 = STATUS CLOSED_CONFIRMED; ORIGINAL_FAILURE_REPRODUCES NO; CLOSURE_TEST_VALID YES; CURRENT_CALLER_VALID YES FOR FIRST ATTEMPT; CROSS_SYSTEM_REGRESSION P2-REAUDIT-06/07
P2_ULTRA_12 = STATUS CLOSED_CONFIRMED; ORIGINAL_FAILURE_REPRODUCES NO; CLOSURE_TEST_VALID YES; CURRENT_CALLER_VALID YES; CROSS_SYSTEM_REGRESSION NONE
P2_ULTRA_14 = STATUS PARTIAL; ORIGINAL_FAILURE_REPRODUCES PARTIAL; CLOSURE_TEST_VALID PARTIAL; CURRENT_CALLER_VALID NO; CROSS_SYSTEM_REGRESSION P2-REAUDIT-08/09/10
P2_ULTRA_15 = STATUS CLOSED_CONFIRMED; ORIGINAL_FAILURE_REPRODUCES NO FOR LEGAL STATUS; CLOSURE_TEST_VALID YES; CURRENT_CALLER_VALID YES; CROSS_SYSTEM_REGRESSION TG-REAUDIT-06
```

## F. Original TG revalidation

| Finding | 상태 | 결과 |
|---|---|---|
| `TG-ULTRA-01` | `CLOSED_TEST_GAP_CONFIRMED` | Direct-import Quick Review는 project creation 전까지 deterministic non-durable라는 contract/test disposition이 정확하다. |
| `TG-ULTRA-02` | `CLOSED_CONFIRMED` | Candidate status/metrics/diagnostics/path/digest/ID independent rederivation과 coordinated forgery 거부 확인. |
| `TG-ULTRA-03` | `CLOSED_CONFIRMED` | NFC normalization 전 sort 및 normalized duplicate rejection 확인. |
| `TG-ULTRA-04` | `CLOSED_CONFIRMED` | Head/middle/tail/zero/section/full phrase coverage matrix와 production validator 연결 확인. |
| `TG-ULTRA-05` | `CLOSED_CONFIRMED` | 세 needs-input variant의 request ID, choice/order/key/byte/number runtime bound 확인. |
| `TG-ULTRA-06` | `CLOSED_TEST_GAP_CONFIRMED` | Shared Memory/PostgreSQL suite를 actual PG17에서 2 files/35 tests로 재실행. |
| `TG-ULTRA-07` | `CLOSED_CONFIRMED` | package `22.x`, CI Node22, migrate/runtime docs 계약 일치. |

```text
TG_DISPOSITIONS_CONFIRMED = 7/7

TG_ULTRA_01 = CLOSED_TEST_GAP_CONFIRMED
TG_ULTRA_02 = CLOSED_CONFIRMED
TG_ULTRA_03 = CLOSED_CONFIRMED
TG_ULTRA_04 = CLOSED_CONFIRMED
TG_ULTRA_05 = CLOSED_CONFIRMED
TG_ULTRA_06 = CLOSED_TEST_GAP_CONFIRMED
TG_ULTRA_07 = CLOSED_CONFIRMED

CLOSED_CONFIRMED_COUNT = 21
CLOSED_TEST_GAP_CONFIRMED_COUNT = 2
CLOSED_DISPOSITION_TOTAL = 23
ORIGINAL_31_CLOSED_CONFIRMED_COUNT = 21
ORIGINAL_31_REOPENED_COUNT = 3
ORIGINAL_31_PARTIAL_COUNT = 5
REOPENED_COUNT = 3
PARTIAL_COUNT = 5
```

## G. Cross-wave 및 end-to-end 결과

```text
PROJECT_SNAPSHOT_WORKSPACE = FAIL — P1-REAUDIT-01, P2-REAUDIT-01/02
TIMING_RENDER_PLAYBACK = FAIL — P1-REAUDIT-02, P2-REAUDIT-03
SHARE_SESSION_RECOVERY = FAIL — P1-REAUDIT-03, P2-REAUDIT-04..07
CLEANUP_RUNTIME = FAIL — production reachability PASS, eventual fairness FAIL
MIGRATION_RUNTIME = PASS
OMR_CREATE_MANIFEST = FAIL — P1-REAUDIT-04/05
OMR_DELETE_CLEANUP = FAIL — P1-REAUDIT-06, P2-REAUDIT-08..10
PERSISTENCE_PARITY = PASS for covered Memory/PG transitions; browser cross-tab authority FAIL
```

### Flow A

Pickup + mixed-meter import, Quick Review, project/generation/edit revision 1/2, snapshot validation, IDB, standard route A→B→A, MusicXML/ABC export, playback, single-tab Share/reload/public practice는 기존 campaigns에서 통과했다. 그러나 same-ID/ABA stale mutation, fractional chord offset, selected lead-key authority 및 reordered Share default가 결합 경로를 실패시킨다.

```text
FLOW_A = FAIL
DURABLE_PROJECT_ID = preserved on standard path; stale mutation generation is not preserved
SNAPSHOT_DIGEST = independently rederived
MUSICXML_CHORD_OFFSET_1_3 = LOST ON REIMPORT
AUTHORITY_OBSERVATION = existing E2E tests + inline full-flow trace
DURABLE_IDS = project.id, candidate.id, outputEdit.id/ordinal, snapshot.id exact-equal on standard reload
DIGESTS = candidate content/evidence, applied-edit, snapshot content, arrangement artifact independently checked
ROW_COUNTS = IndexedDB project key 1 on standard path; same-K Share active row 1
EXTERNAL_CALL_COUNTS = 0
BROWSER_STORAGE_IDENTITY = project.id key; Share projectId + K1 + requestDigest envelope
```

### Flow B

Single K1의 PG commit/response loss/same-session reload는 same token/secret, share row 1로 수렴한다. Report/competing moderator claim/takedown/cleanup first attempt도 통과했다. 두 탭 최초 create는 K1/K2, active rows 2, quota effects 2가 되었고, terminal moderation acknowledgement loss와 create replay-after-takedown이 current authority를 회복하지 못한다.

```text
FLOW_B = FAIL
SINGLE_K_RESPONSE_LOSS = PASS
TWO_TAB_DISTINCT_KEYS = 2
ACTIVE_SHARE_ROWS = 2
TERMINAL_MODERATION_RETRY = 409 CLAIM CONFLICT
REQUEST_DIGESTS = exact-equal for one logical payload; K1/K2 differ in two-tab failure
IDEMPOTENCY_ROWS = 2 completed in two-key counterexample; 1 in same-K recovery
QUOTA_ROW_USED_COUNT = 2 in two-key counterexample
EXTERNAL_CALL_COUNTS = 0
BROWSER_STORAGE_IDENTITY = projectId + idempotencyKey + requestDigest + sessionAuthority + createdResponse
MODERATION_DURABLE_ID = exact shareRecordId through report/claim/resolve first attempt
```

### Flow C

Manifest [A,B], same-session K1 recovery, historical A binding unavailable/restored, upload/start/long retry, completed frozen evidence, manual reorder block, handoff binding, provider-delete ledger core는 통과했다. Session rotation, stale async selection, handoff delete authority, two-tab handoff CAS, delete-pending expiry, cleanup fairness에서 실패한다.

```text
FLOW_C = FAIL
SAME_SESSION_K1 = PASS
SESSION_ROTATION_K1 = FAIL
HISTORICAL_A_RESTORE_ACTIVE_B_CALLS = 0
MANUAL_REORDER = BLOCKED
ASYNC_PREPARATION_GENERATION_FENCE = ABSENT
POST_HANDOFF_OWNER_DELETE = UNREACHABLE
PROVIDER_DELETE_LEDGER = PASS
CLEANUP_EVENTUAL_FAIRNESS = FAIL
AUTHORITY_OBSERVATION = helper/browser-state trace + Memory/actual-PG campaigns
DURABLE_IDS = manifestId/manifestDigest, createStorageKey/K1, recoveryStorageKey/jobHandle,
              providerBindingId/vendorJobId envelope, provider-delete operationId/generation
DIGESTS = rawDigest/canonicalPageDigest/uploadIdentity/evidence imageDigest exact on linear path
ROW_COUNTS = same-session create 1 job + 1 idempotency authority; cross-session counterexample permits 2 jobs
EXTERNAL_CALL_COUNTS = historical active B 0; same-session idempotent create/delete ledger one logical effect
BROWSER_STORAGE_IDENTITY = active manifest record + create/recovery localStorage keys;
                           handoff is a separate DB and loses delete identity
```

### Flow D

```text
FLOW_D = PASS
FRESH_DB_MIGRATE_1_TO_14 = PASS
SECOND_MIGRATE = PASS, installed=[]
RUNTIME_VERIFY_ONLY = PASS
CONCURRENT_API_COLD_START_AUTHORITY = read-only verification
SCHEMA_HASH_BEFORE = c0b67f7beb8ddde88ab822f58339514cb5f316b4bee4e85bbd345d312a6b76d8
SCHEMA_HASH_AFTER = c0b67f7beb8ddde88ab822f58339514cb5f316b4bee4e85bbd345d312a6b76d8
RUNTIME_DDL = 0
SCHEMA_MIGRATION_ROW_COUNT = 14
EXTERNAL_CALL_COUNTS = 0; S3 client constructed but no live request
```

## H. New findings

```text
NEW_P0 = 0
NEW_P1 = 6
NEW_P2 = 10
NEW_TG = 6
P0_REAUDIT_COUNT = 0
P1_REAUDIT_COUNT = 6
P2_REAUDIT_COUNT = 10
TG_REAUDIT_COUNT = 6
```

아래 finding schema에서 `ACTUAL`과 `MATERIAL_PRODUCT_IMPACT`가 `IMPACT`를, `WHY_CLOSURE_TESTS_PASS`가 `WHY_EXISTING_TESTS_MISSED`를, `MINIMAL_FIX`가 `REQUIRED_FIX`를 각각 함께 표현한다. Heading의 ID와 함께 원 요청 및 post-closure 요청의 두 evidence schema를 모두 적용했다. 상세 순서는 evidence가 확정된 순서이며 ID/severity가 최종 authority다.

### P1-REAUDIT-01 — Workspace mutation authority가 same-ID revision과 ABA를 구분하지 못한다

```text
TITLE = stale same-ID/ABA workspace mutation can overwrite the current project revision
SEVERITY = P1
EVIDENCE_STRENGTH = PROVEN

SUPPORTED_DEPLOYMENT_REACHABLE = YES
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = YES
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO

RELATED_CLOSURE_FINDING = P1-ULTRA-02
ROOT_CAUSE = mutation token contains projectId but no route epoch or loaded-project revision
EXACT_FILES = src/product/workspace-route-state.ts; src/app/workspace/WorkspaceClient.tsx
EXACT_FUNCTIONS = beginMutation; mutationStillCurrent; saveProject; generate; createShare
EXACT_STATE_FIELDS = requestedProjectId; loadedProjectId; project.id; route epoch; current revision

FAILURE_SEQUENCE = load A/v0 -> start slow mutation -> replace/reimport A/v1, or A→B→A ->
                   old A/v0 completion sees the same projectId -> accepted -> saves/displays A/v0
REPRODUCTION = inline delayed-controller probe returned
               sameIdApplied=true, afterSameId=A-v0-late-share,
               abaApplied=true, finalStored=A-v0-late-generation
EXPECTED = only the exact loaded route generation/revision may complete a mutation
ACTUAL = projectId equality admits stale same-ID and ABA completions

WHY_CLOSURE_TESTS_PASS = tests cover A→B different-ID stale promises, not same-ID replacement/ABA
MINIMAL_FIX = monotonic route/load generation plus exact loaded revision in every mutation token
REGRESSION_TESTS_REQUIRED = same-ID delete/reimport; A→B→A; stale generate/share/save/delete
MIGRATION_REQUIRED = NO
CONFIDENCE = HIGH
```

### P2-REAUDIT-01 — selected lead key authority가 다른 part와 lead switch에 의해 덮인다

```text
TITLE = non-selected global modulation and lead switching override the selected lead-key authority
SEVERITY = P2
EVIDENCE_STRENGTH = PROVEN

SUPPORTED_DEPLOYMENT_REACHABLE = YES
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = YES
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO

RELATED_CLOSURE_FINDING = P2-ULTRA-06
ROOT_CAUSE = parser persists parts[0] global modulation diagnostic and lead switching reinitializes explicit override
EXACT_FILES = src/import/musicxml/parser.ts; src/import/review/commands.ts;
              src/import/review/quick-review.ts
EXACT_FUNCTIONS = parseScore; selectLeadCandidate; setDefaultKey; selectedLeadDiagnostics;
                  diagnosticAppliesToSelection; deriveQuickReview
EXACT_STATE_FIELDS = selectedLeadPartId; sourceKey; selectedLeadKeyOverride; diagnostics; modulation

FAILURE_SEQUENCE = select stable part B while part A carries modulation -> A diagnostic remains global and blocks B;
                   alternatively set explicit G override -> switch lead -> override becomes source D
REPRODUCTION = inline Quick Review probe: nonSelectedModulationSurvives=true; override G became D after switch
EXPECTED = validation/generation uses exact selected lead and preserves explicit override until user changes it
ACTUAL = unrelated part or selection transition changes current key authority

WHY_CLOSURE_TESTS_PASS = fixtures select parts[0] or do not combine nonselected modulation and explicit override switching
MINIMAL_FIX = scope diagnostics to selected part and model override as independent explicit authority
REGRESSION_TESTS_REQUIRED = stable selected part with other-part modulation; repeated A/B lead switch with override
MIGRATION_REQUIRED = NO
CONFIDENCE = HIGH
```

### P2-REAUDIT-02 — immutable edit history가 unbounded quadratic validation을 만든다

```text
TITLE = supported repeated edits make project storage and save/import validation unbounded
SEVERITY = P2
EVIDENCE_STRENGTH = STRONGLY_SUPPORTED

SUPPORTED_DEPLOYMENT_REACHABLE = YES
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = YES
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO

RELATED_CLOSURE_FINDING = P2-ULTRA-02; P1-ULTRA-01
ROOT_CAUSE = immutable revisions have no cap/compaction and each save revalidates every full historical snapshot
EXACT_FILES = src/app/workspace/WorkspaceClient.tsx; src/domain/edit/model.ts;
              src/product/workspace-controls.ts; src/domain/project.ts;
              src/domain/project-integrity.ts; src/product/local-project-store.ts
EXACT_FUNCTIONS = applyOutputEdit; upsertEditedSnapshotHistory; isHarmonyProjectShape;
                  validateSnapshots; validateHarmonyProject; IndexedDbProjectStore.save
EXACT_STATE_FIELDS = outputEdits; editOrdinal; appliedEditIds; editedSnapshots; full generated tracks

FAILURE_SEQUENCE = repeat non-identical A↔B edits -> each gets new ordinal/digest/snapshot -> no retention limit ->
                   shape validation performs snapshots×edit IDs×linear lookup -> full materializer/validator per snapshot ->
                   IndexedDB save waits on expanding history
REPRODUCTION = static complexity/cardinality trace; schema has no edit/snapshot upper bound
EXPECTED = bounded retention/compaction or bounded incremental verification
ACTUAL = storage O(N·E) and validation at least O(N²) for supported user actions

WHY_CLOSURE_TESTS_PASS = immutable-history regression stops at two revisions with no bytes/time bound
MINIMAL_FIX = explicit retention/compaction policy and indexed/incremental verification
REGRESSION_TESTS_REQUIRED = long A↔B campaign with bounded bytes/latency and exact active reload
MIGRATION_REQUIRED = NO for cap/compaction; compatibility handling required
CONFIDENCE = HIGH
```

### P2-REAUDIT-03 — reordered PracticeShare의 selectedTrackIndex 의미가 바뀐다

```text
TITLE = payload index authority is applied to a source-first reconstructed playback plan
SEVERITY = P2
EVIDENCE_STRENGTH = PROVEN

SUPPORTED_DEPLOYMENT_REACHABLE = YES
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = YES
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO

RELATED_CLOSURE_FINDING = P2-ULTRA-03
ROOT_CAUSE = validator permits source lead anywhere, materializer/plan moves it to index 0, consumer reuses raw index
EXACT_FILES = src/domain/share.ts; src/product/shared-practice.ts;
              src/product/playback-plan.ts; src/product/ProductPracticePlayer.tsx
EXACT_FUNCTIONS = isPracticeSharePayload; materializeSharedPractice; buildPlaybackPlan;
                  resolvePracticePlayerInitialState
EXACT_STATE_FIELDS = arrangement.tracks; playbackDefaults.selectedTrackIndex; plan.trackIds

FAILURE_SEQUENCE = tracks=[H1,lead,H2], selectedTrackIndex=0 -> valid -> plan=[lead,H1,H2] -> initial solo=lead
REPRODUCTION = direct validator→materializer→plan→initial-state probe;
               valid=true, payload index0=H1, resolved=lead
EXPECTED = H1 selected
ACTUAL = lead selected

WHY_CLOSURE_TESTS_PASS = test constructs source-first synthetic plan; production fixtures are source-first
MINIMAL_FIX = resolve payload index to stable track ID or enforce/canonicalize one ordering
REGRESSION_TESTS_REQUIRED = reordered v3/v4 lead/H1/H2 and accompaniment/default reset
MIGRATION_REQUIRED = NO
CONFIDENCE = HIGH
```

### P2-REAUDIT-04 — Share plaintext oversize가 quota를 먼저 소비한다

```text
TITLE = 256–384KiB valid payload consumes hourly quota before plaintext rejection
SEVERITY = P2
EVIDENCE_STRENGTH = PROVEN

SUPPORTED_DEPLOYMENT_REACHABLE = YES
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = YES
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO

RELATED_CLOSURE_FINDING = P2-ULTRA-09
ROOT_CAUSE = raw 384KiB and canonical plaintext 256KiB limits execute on opposite sides of quota accounting
EXACT_FILES = src/server/http/api.ts; src/domain/share.ts; src/server/share/idempotent-create.ts;
              src/server/share/share-store-core.ts; src/server/persistence/postgres-store.ts
EXACT_FUNCTIONS = readBoundedShareJson; parseShareCreateBody; createShareIdempotently;
                  ShareStoreService.prepare; consumeQuota
EXACT_STATE_FIELDS = raw bytes; canonical plaintext bytes; quota_windows.used_count; idempotency state

FAILURE_SEQUENCE = schema-valid raw<384KiB and canonical>256KiB -> parse pass -> claim+quota increment ->
                   practiceSharePlaintext throws -> pending idempotency release only -> repeat exhausts quota
REPRODUCTION = payload raw=272159, canonical=272061; 12 oversize attempts all SHARE_PAYLOAD_TOO_LARGE;
               subsequent small valid create returned 429 QUOTA_EXCEEDED
EXPECTED = policy rejection before quota/idempotency side effects
ACTUAL = rejected requests consume the entire hourly allowance

WHY_CLOSURE_TESTS_PASS = bounded JSON tests stop at parser; no service-route quota row readback after semantic oversize
MINIMAL_FIX = canonical plaintext validation before quota or atomic reversible accounting
REGRESSION_TESTS_REQUIRED = 256KiB±1/384KiB boundaries, chunked input and actual quota readback
MIGRATION_REQUIRED = NO
CONFIDENCE = HIGH
```

### P2-REAUDIT-05 — 늦은 owner-delete 응답이 다른 project의 Share UI authority를 지운다

```text
TITLE = Workspace Share delete lacks the project mutation fence used by create
SEVERITY = P2
EVIDENCE_STRENGTH = PROVEN

SUPPORTED_DEPLOYMENT_REACHABLE = YES
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = YES
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO

RELATED_CLOSURE_FINDING = P1-ULTRA-02; P1-ULTRA-04
ROOT_CAUSE = deleteStoredShare captures project state without beginMutation/mutationStillCurrent
EXACT_FILES = src/app/workspace/WorkspaceClient.tsx
EXACT_FUNCTIONS = WorkspaceClient; deleteStoredShare
EXACT_STATE_FIELDS = projectId; storedShareState.projectId; shareUrlState.projectId; recovery IDB row

FAILURE_SEQUENCE = A DELETE pending -> navigate B -> B recovery displayed -> late A 2xx ->
                   A closure clears storedShare/shareUrl and writes state tagged A -> B authority disappears until reload
REPRODUCTION = exact delayed caller trace; no route token exists in delete path
EXPECTED = late A completion is scoped to A or discarded
ACTUAL = current B UI loses a still-durable token/delete action

WHY_CLOSURE_TESTS_PASS = route tests cover project deletion/create mutations, not Share owner-delete caller
MINIMAL_FIX = exact project route/revision token around request and local IDB/UI completion
REGRESSION_TESTS_REQUIRED = delayed A delete across A→B→A with B recovery
MIGRATION_REQUIRED = NO
CONFIDENCE = HIGH
```

### P2-REAUDIT-06 — moderation terminal response loss가 idempotent하지 않다

```text
TITLE = committed resolve/takedown retry is indistinguishable from claim conflict
SEVERITY = P2
EVIDENCE_STRENGTH = PROVEN

SUPPORTED_DEPLOYMENT_REACHABLE = YES
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = YES
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO

RELATED_CLOSURE_FINDING = P2-ULTRA-11
ROOT_CAUSE = terminal transition clears claim_token and only accepts status=claimed; no exact terminal replay/read authority
EXACT_FILES = src/server/persistence/postgres-store.ts; src/server/share/share-store-core.ts;
              src/app/api/internal/moderation/reports/[reportId]/resolve/route.ts;
              src/server/persistence/migrations/012_share_moderation_lifecycle.sql
EXACT_FUNCTIONS = PostgresGovernanceStore.resolveAbuseReport;
                  ShareStoreService.resolveModerationReport; POST
EXACT_STATE_FIELDS = report.status/claim_token/claim_expires_at/resolution/resolved_at;
                     share.lifecycle; audit_events

FAILURE_SEQUENCE = claim -> takedown transaction commits report/share/audit -> response lost ->
                   same claimToken+resolution retry -> status!=claimed/token null -> 409 MODERATION_CLAIM_CONFLICT
REPRODUCTION = exact PG transaction and retry trace
EXPECTED = exact same terminal request returns committed outcome once; different request conflicts
ACTUAL = operator cannot determine whether takedown committed through the mutation API

WHY_CLOSURE_TESTS_PASS = conformance resolves once; route test checks unauthorized path only
MINIMAL_FIX = durable terminal idempotency verifier and exact report outcome read
REGRESSION_TESTS_REQUIRED = actual PG apply-then-response-loss, same/conflicting retry and audit row count
MIGRATION_REQUIRED = YES unless existing durable audit authority can safely verify replay
CONFIDENCE = HIGH
```

### P2-REAUDIT-07 — completed Share replay가 current moderation lifecycle을 무시한다

```text
TITLE = create replay returns stale success after the current share is disabled or deleted
SEVERITY = P2
EVIDENCE_STRENGTH = PROVEN

SUPPORTED_DEPLOYMENT_REACHABLE = YES
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = YES
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO

RELATED_CLOSURE_FINDING = P1-ULTRA-04; P2-ULTRA-11
ROOT_CAUSE = encrypted completed response is replayed without reconciling current share_records.lifecycle
EXACT_FILES = src/server/share/idempotent-create.ts; src/server/share/share-store-core.ts;
              src/server/persistence/postgres-store.ts; src/app/workspace/WorkspaceClient.tsx
EXACT_FUNCTIONS = createShareIdempotently; recoverShareCreateIdempotently;
                  replayIdempotentCreate; reconcileOwnerAuthority
EXACT_STATE_FIELDS = idempotency.response_json/expires_at; share.lifecycle/disabled_at/deleted_at;
                     browser createdResponse/sessionAuthority

FAILURE_SEQUENCE = create K1 -> moderator takedown/owner delete -> reload completed envelope ->
                   replay checks response expiry only -> 200 original token/secret -> UI presents dead link as active
REPRODUCTION = exact Flow B cross-wave state trace
EXPECTED = typed retired/disabled result or current lifecycle reconciliation
ACTUAL = stale creation authority supersedes current lifecycle in browser presentation

WHY_CLOSURE_TESTS_PASS = moderation tests stop at read failure; no replay after takedown/delete
MINIMAL_FIX = bind replay to current token-hash aggregate and return a typed retired result
REGRESSION_TESTS_REQUIRED = same/cross-session replay after takedown, owner delete, expiry and cleanup
MIGRATION_REQUIRED = NO
CONFIDENCE = HIGH
```

### P2-REAUDIT-08 — expired delete-pending OMR manifest가 browser를 영구 잠근다

```text
TITLE = valid delete-pending manifest becomes unrecoverable and undiscardable after handle expiry
SEVERITY = P2
EVIDENCE_STRENGTH = PROVEN

SUPPORTED_DEPLOYMENT_REACHABLE = YES
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = YES
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO

RELATED_CLOSURE_FINDING = P2-ULTRA-14
ROOT_CAUSE = deletion retry uses the expiring read handle and valid pending state has no automatic terminal reconciliation/release
EXACT_FILES = src/server/omr/application-service.ts; src/app/omr/OmrClient.tsx;
              src/app/omr/browser-job-manifest.ts; src/app/omr/browser-job-lifecycle.ts
EXACT_FUNCTIONS = DurableOmrApplicationService.issueHandle;
                  DurableOmrApplicationService.handleHash; DurableOmrApplicationService.delete;
                  OmrClient; remove; readOmrBrowserJobManifest; markOmrBrowserJobDeletePending
EXACT_STATE_FIELDS = handleExpiresAt/handleActive; manifest.lifecycle/pendingDeletion;
                     jobHandle/recoveryStorageKey; vendorDeleteState/nextAttemptAt

FAILURE_SEQUENCE = DELETE pending -> browser persists delete-pending -> return after 24h ->
                   handle verifier rejects -> every retry OMR_JOB_UNAVAILABLE -> valid manifest cannot use invalid-discard -> new input locked
REPRODUCTION = 24h verifier, recovery early-return, UI retry-only and valid-manifest lock exact trace
EXPECTED = reconcile server terminal cleanup or safely release local authority
ACTUAL = browser blobs/manifest can remain locked after server cleanup completes

WHY_CLOSURE_TESTS_PASS = immediate reload/disposition only; no handle expiry plus scheduler completion
MINIMAL_FIX = deletion-only recovery authority beyond read TTL or same-owner terminal reconciliation
REGRESSION_TESTS_REQUIRED = pending delete→24h→cron→reload clear; unresolved state remains protected
MIGRATION_REQUIRED = NO for same-session verifier; possibly YES for new durable secret
CONFIDENCE = HIGH
```

### P2-REAUDIT-09 — normal OMR handoff가 later owner-delete authority를 지운다

```text
TITLE = Quick Review handoff clears the only browser job/delete authority before project completion
SEVERITY = P2
EVIDENCE_STRENGTH = PROVEN

SUPPORTED_DEPLOYMENT_REACHABLE = YES
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = YES
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO

RELATED_CLOSURE_FINDING = P2-ULTRA-14
ROOT_CAUSE = handoff persists result/pages but not jobHandle/delete authority, then clears manifest and recovery key
EXACT_FILES = src/app/omr/OmrClient.tsx; src/domain/omr/browser-handoff.ts
EXACT_FUNCTIONS = OmrClient.handoff; storeOmrImportHandoff; clearOmrBrowserJobManifest
EXACT_STATE_FIELDS = jobHandle; handleRecoveryStorageKey; StoredHandoff; manifest lifecycle;
                     pageImages; omrProviderResult

FAILURE_SEQUENCE = completed -> handoff -> result/pages saved -> handle key and manifest removed ->
                   correction/project -> requested owner delete -> no browser state can address DELETE
REPRODUCTION = handoff write/clear order and StoredHandoff/OmrImportHandoff schema
EXPECTED = Flow C retains safe deletion/reconciliation capability through project handoff
ACTUAL = user delete is impossible; only eventual expiry cron remains

WHY_CLOSURE_TESTS_PASS = handoff tests assert bytes/digests/TTL only
MINIMAL_FIX = retain deletion authority separately until terminal state or carry owner-only verifier through handoff
REGRESSION_TESTS_REQUIRED = completed→handoff→correction→project→DELETE loss→cron→browser final state
MIGRATION_REQUIRED = NO for browser retention; possibly YES for a server recovery verifier
CONFIDENCE = HIGH
```

### P2-REAUDIT-10 — two-tab OMR handoff와 manifest clear가 non-atomic하다

```text
TITLE = lifecycle-blind digest CAS and separate IndexedDB stores permit stale-tab supersession
SEVERITY = P2
EVIDENCE_STRENGTH = PROVEN

SUPPORTED_DEPLOYMENT_REACHABLE = YES
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = YES
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO

RELATED_CLOSURE_FINDING = P1-ULTRA-10; P2-ULTRA-14
ROOT_CAUSE = manifest digest omits lifecycle/jobHandle/pendingDeletion; handoff is written before digest-only clear in another DB
EXACT_FILES = src/app/omr/OmrClient.tsx; src/app/omr/browser-job-manifest.ts;
              src/domain/omr/browser-handoff.ts
EXACT_FUNCTIONS = OmrClient.handoff/remove; manifestProjection; markOmrBrowserJobDeletePending;
                  clearOmrBrowserJobManifest; store/takeOmrImportHandoff
EXACT_STATE_FIELDS = manifestDigest/lifecycle/jobHandle/pendingDeletion; active manifest; pending handoff/handoffId

FAILURE_SEQUENCE = case 1: A marks D1 delete-pending; stale B completed D1 writes H1 then clear(D1) succeeds -> delete intent lost.
                   case 2: current D2 exists; stale B writes H1 then clear(D1) fails -> H1 remains and later import consumes stale result.
REPRODUCTION = exact write order; mutable authority excluded from digest; separate IDB transactions cannot rollback together
EXPECTED = handoff publication and exact lifecycle/generation supersession are atomic
ACTUAL = stale tab can erase deletion authority or publish stale import data

WHY_CLOSURE_TESTS_PASS = fake-IDB tests use one-tab linear transitions and digest-only clear
MINIMAL_FIX = lifecycle/jobHandle/generation CAS plus handoff rollback, or one transactional authority store
REGRESSION_TESTS_REQUIRED = completed-vs-delete-pending tabs and D1 stale handoff against current D2
MIGRATION_REQUIRED = NO server migration; browser schema versioning may be required
CONFIDENCE = HIGH
```

### P1-REAUDIT-02 — MusicXML fractional chord offset가 export/import에서 소실된다

```text
TITLE = exporter divisions omit harmony offsets and emit importer-invalid decimal offsets
SEVERITY = P1
EVIDENCE_STRENGTH = PROVEN

SUPPORTED_DEPLOYMENT_REACHABLE = YES
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = YES
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO

RELATED_CLOSURE_FINDING = P1-ULTRA-03
ROOT_CAUSE = divisions LCM considers rhythmic event durations but not chord-offset denominators
EXACT_FILES = src/product/musicxml-export.ts; src/import/musicxml/parser.ts
EXACT_FUNCTIONS = exportArrangementMusicXml; harmonyXml; parseInteger; parseHarmony
EXACT_STATE_FIELDS = chord.offset; measure divisions; serialized <offset>; chord timeline

FAILURE_SEQUENCE = supported chord offset 1/3 -> export divisions not divisible by 3 ->
                   <offset>0.3333333333333333</offset> -> integer-only importer rejects/drops harmony ->
                   reload/export/playback uses a different chord timeline
REPRODUCTION = full importer→Quick Review→project→generation→render→export→reimport probe;
               sourceChordOffset=1/3, serializedDecimal=true, roundTripChordCount=0
EXPECTED = exact rational offset survives canonical export/import/export
ACTUAL = supported chord is silently lost

WHY_CLOSURE_TESTS_PASS = pickup/meter/tempo fixtures use integer-scalable offsets and omit fractional chord offset
MINIMAL_FIX = include every emitted offset/duration denominator in divisions authority and assert integral output
REGRESSION_TESTS_REQUIRED = 1/3, 1/5 and mixed denominator chord offsets across pickup/meter changes
MIGRATION_REQUIRED = NO
CONFIDENCE = HIGH
```

### P1-REAUDIT-03 — 두 탭 Share create가 K authority를 분기한다

```text
TITLE = component-local gate and non-atomic IndexedDB load/save create K1 and K2 for one logical share
SEVERITY = P1
EVIDENCE_STRENGTH = PROVEN

SUPPORTED_DEPLOYMENT_REACHABLE = YES
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = YES
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO

RELATED_CLOSURE_FINDING = P1-ULTRA-04
ROOT_CAUSE = browser gate is per React instance and per-project IDB claim has no atomic CAS/cross-tab lock
EXACT_FILES = src/product/share-create-recovery.ts; src/app/workspace/WorkspaceClient.tsx;
              src/server/persistence/postgres-store.ts
EXACT_FUNCTIONS = ShareCreateOperationGate.tryBegin; IndexedDbShareCreateRecoveryStore.load/save;
                  prepareShareCreateRecovery; completeShareCreateRecovery; WorkspaceClient.createShare;
                  PostgresGovernanceStore.claimIdempotency
EXACT_STATE_FIELDS = projectId; idempotencyKey; requestDigest; operationLifecycle;
                     sessionAuthority; createdResponse; completedAuthorities; share_records.lifecycle

FAILURE_SEQUENCE = tabs A/B both load undefined -> generate K1/K2 -> separate puts overwrite ->
                   both retain local envelope -> both POST -> distinct session+key hashes both claim ->
                   two active shares -> stale completion overwrites one local token/delete secret
REPRODUCTION = fake-indexeddb 20/20 trials: distinctKeys=20, lostCompletedAuthority=20;
               actual PG: HTTP statuses [201,201], distinctTokens=2, activeRows=2,
               completedIdempotencyRows=2, quotaUsed=2
EXPECTED = one atomic browser operation generation, one K, one share and retained delete authority
ACTUAL = two durable effects and only last-writer browser authority

WHY_CLOSURE_TESTS_PASS = rapid-click uses one gate; IDB test is sequential; PG concurrency injects the same K
MINIMAL_FIX = atomic generation CAS plus cross-tab coordination; generation-fenced bind/complete/fresh writes
REGRESSION_TESTS_REQUIRED = real fake-indexeddb two-tab overlap; stale completion after fresh generation;
                            exact one POST/row/quota/token/delete authority
MIGRATION_REQUIRED = NO
CONFIDENCE = HIGH
```

### P1-REAUDIT-04 — OMR K1은 browser에서 session-independent지만 DB에서는 session-scoped다

```text
TITLE = session replacement after committed response loss creates a second OMR job authority
SEVERITY = P1
EVIDENCE_STRENGTH = PROVEN

SUPPORTED_DEPLOYMENT_REACHABLE = YES
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = YES
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO

RELATED_CLOSURE_FINDING = P1-ULTRA-06; cross-wave P1-ULTRA-04
ROOT_CAUSE = durable browser K1 survives cookie replacement while server key is (owner_session_id,key_hash)
EXACT_FILES = src/app/omr/browser-recovery.ts; src/app/omr/OmrClient.tsx;
              src/server/security/session-core.ts; src/server/security/session-admission.ts;
              src/app/api/session/route.ts; src/server/omr/application-service.ts;
              src/server/omr/store.ts; src/server/omr/postgres-store.ts;
              src/server/persistence/migrations/004_omr_core.sql
EXACT_FUNCTIONS = acquireOmrJob; OmrClient.start; AnonymousSessionService.issue/verify;
                  DurableOmrApplicationService.createJob; Memory/Postgres inspectCreate/claimCreate
EXACT_STATE_FIELDS = request.idempotencyKey/requestDigest/canonicalInputIdentity;
                     owner_session_id/key_hash/job_id/state; vendorCreateIdempotencyKey;
                     vendorCreateOutcomeState; creditState; publicHandleHash

FAILURE_SEQUENCE = S1 POST K1 -> Vendor effect + PG commit -> response loss -> legitimate S2 replacement ->
                   same manifest/localStorage K1 reload -> S2 lookup misses S1 -> IP cap 2 permits second claim
REPRODUCTION = browser envelope has no session authority/expiry; migration PK and both stores include owner session;
               route injects current session. Exact static durable-state trace.
EXPECTED = same K1/request recovers one local and one logical Vendor authority across session replacement
ACTUAL = two DB rows/reservations; an idempotent provider may bind one Vendor ID to both rows,
         while a non-idempotent provider may create two external jobs

WHY_CLOSURE_TESTS_PASS = OMR create tests retain one actor/session; Share alone has cross-session recovery
MINIMAL_FIX = durable cross-session recovery/ownership-transfer authority or globally unique exact request claim
REGRESSION_TESTS_REQUIRED = S1 commit/lost response→S2 same K; one row/provider effect/handle;
                            old-row cleanup cannot delete recovered current authority
MIGRATION_REQUIRED = YES unless an existing durable global verifier is reused
CONFIDENCE = HIGH
```

### P1-REAUDIT-05 — stale OMR file preparation이 manifest와 표시 page를 분리한다

```text
TITLE = stale async selection can render B while manifest/upload/evidence remains A
SEVERITY = P1
EVIDENCE_STRENGTH = STRONGLY_SUPPORTED

SUPPORTED_DEPLOYMENT_REACHABLE = YES
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = YES
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO

RELATED_CLOSURE_FINDING = P1-ULTRA-10
ROOT_CAUSE = drop ignores busy, selection has no generation/abort fence, and manifestRef is set only after async persistence
EXACT_FILES = src/app/omr/OmrClient.tsx; src/app/omr/browser-job-manifest.ts
EXACT_FUNCTIONS = selectFile; selectFiles; replacePages; start;
                  createOmrBrowserJobManifest; persistNewOmrBrowserJobManifest
EXACT_STATE_FIELDS = busy; pages/pagesRef; manifest/manifestRef/manifestDigest;
                     pageIndex/rawDigest/canonicalPageDigest/uploadIdentity; evidence.frames

FAILURE_SEQUENCE = slow B and faster A preparation overlap via drop -> A completion sets busy=false while B pending ->
                   start A -> async manifest hash/IDB persist while manifestRef undefined ->
                   B completion passes replacePages -> manifest A installs/uploads -> UI/evidence overlay uses B
REPRODUCTION = exact caller trace at OmrClient selection, start, manifest persistence and overlay paths;
               no synchronous reservation or selection generation exists
EXPECTED = start reserves A synchronously and stale selection cannot publish
ACTUAL = provider pageIndex/digest A can be displayed against B image; handoff still uses A

WHY_CLOSURE_TESTS_PASS = no mounted OmrClient test; helper/fake-IDB tests are linear
MINIMAL_FIX = selection generation/abort fence, busy-aware drop, synchronous start reservation,
              and rendering from active manifest authority
REGRESSION_TESTS_REQUIRED = delayed B after A start with exact bytes/digest/preview/upload/evidence/handoff assertions
MIGRATION_REQUIRED = NO
CONFIDENCE = HIGH
```

### P1-REAUDIT-06 — fixed daily OMR cleanup batch에 head-of-line starvation이 있다

```text
TITLE = 25 persistent oldest OMR rows can starve all later cleanup indefinitely
SEVERITY = P1
EVIDENCE_STRENGTH = STRONGLY_SUPPORTED

SUPPORTED_DEPLOYMENT_REACHABLE = YES
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = YES
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO

RELATED_CLOSURE_FINDING = P1-ULTRA-05; P1-ULTRA-07
ROOT_CAUSE = one daily batch of 25 ordered by expires_at/id has no fairness cursor or repeated drain;
             persistent failures remain the earliest due prefix
EXACT_FILES = vercel.json; src/server/cleanup/scheduled-cleanup.ts;
              src/server/omr/application-service.ts; src/server/omr/store.ts;
              src/server/omr/postgres-store.ts;
              src/server/persistence/migrations/013_omr_provider_delete_authority.sql
EXACT_FUNCTIONS = runScheduledCleanup; cleanupExpiredJobsForScheduler;
                  MemoryOmrStore.claimCleanup; PostgresOmrStore.claimCleanup;
                  providerDeleteSummary; authoritativeProviderDeleteProjection; mergeOmrJobDeleteFinalization
EXACT_STATE_FIELDS = expiresAt; cleanupLeaseToken/ExpiresAt; vendor/local DeleteState/NextAttemptAt;
                     dispatchOutcome; reconciliationRequired; operation.nextAttemptAt

FAILURE_SEQUENCE = 25 earliest rows remain unresolved through historical binding loss,
                   non-idempotent reconciliation, or not-supported/no vendorDeletesAt ->
                   every daily cron selects same prefix -> row 26 and all later expired/owner-delete rows never claim
REPRODUCTION = cron daily; scheduler calls exactly cleanupExpiredJobs(25) once;
               PG query ORDER BY expires_at,id LIMIT 25; no fairness update/cursor/drain test
EXPECTED = every due supported row eventually receives cleanup authority within bounded capacity
ACTUAL = admissible persistent prefix causes indefinite retention, false lifecycle and unreleased exposure

WHY_CLOSURE_TESTS_PASS = scheduler mocks one invocation; store campaigns use small sets and no 26+ cross-run prefix
MINIMAL_FIX = fair last-attempt ordering/persisted backoff or bounded continuation drain under runtime budget
REGRESSION_TESTS_REQUIRED = 25 persistent + later resolvable jobs across repeated cron runs for each failure class
MIGRATION_REQUIRED = NO if existing timestamps suffice; otherwise only for durable fairness metadata
CONFIDENCE = HIGH
```

### TG-REAUDIT-01 — snapshot attestation이 caller-owned graph를 freeze한다

```text
TITLE = semantic rederivation observably mutates caller input through recursive Object.freeze
SEVERITY = TG
EVIDENCE_STRENGTH = PROVEN
SUPPORTED_DEPLOYMENT_REACHABLE = YES
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = NO current user-visible failure proven
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO
RELATED_CLOSURE_FINDING = P1-ULTRA-01
ROOT_CAUSE = materializer reuses unchanged Candidate event/anchor nodes and attestation recursively freezes them and stored snapshots
EXACT_FILES = src/integrity/edited-snapshot-authority.ts; src/domain/project-integrity.ts
EXACT_FUNCTIONS = materializeEditedArrangement; attestVerifiedEditedSnapshot; validateSnapshots
EXACT_STATE_FIELDS = Candidate event/anchor objects; stored snapshot property descriptors/extensibility
FAILURE_SEQUENCE = validate/materialize -> shared nodes and input snapshots become frozen although JSON is unchanged
REPRODUCTION = exact object identity/Object.freeze trace
EXPECTED = rederivation is observationally pure on caller-owned project state
ACTUAL = property descriptors and extensibility are mutated
WHY_CLOSURE_TESTS_PASS = purity test compares JSON only, not descriptors/Object.isFrozen
MINIMAL_FIX = clone shared nodes or return a verified clone without freezing caller input
REGRESSION_TESTS_REQUIRED = deep identity/descriptor/frozen-state before/after checks
MIGRATION_REQUIRED = NO
CONFIDENCE = HIGH
```

### TG-REAUDIT-02 — retained stale registry가 네 config digest를 보존하지 않는다

```text
TITLE = stale retained generation can mix old plan authority with current config-only changes
SEVERITY = TG
EVIDENCE_STRENGTH = TEST_GAP_ONLY
SUPPORTED_DEPLOYMENT_REACHABLE = YES
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = NO in exact frozen config
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO
RELATED_CLOSURE_FINDING = P1-ULTRA-01; P2-ULTRA-02
ROOT_CAUSE = persisted/retained checks omit plannerConfigDigest, grammarConfigDigest,
             activityPlannerConfigDigest and anchorPlannerConfigDigest
EXACT_FILES = src/product/workspace.ts; src/domain/project-integrity.ts
EXACT_FUNCTIONS = generateProjectVariant; validateRetainedGenerationArtifacts
EXACT_STATE_FIELDS = four config digests; stage versions; stale plan
FAILURE_SEQUENCE = future config-only change with same version -> stale boundary returns after incomplete retained validation
REPRODUCTION = static persisted field and stale matrix comparison; current frozen config unchanged
EXPECTED = retained old authority is completely identified before current execution registry is used
ACTUAL = config-only identity is absent
WHY_CLOSURE_TESTS_PASS = stale tests mutate versions; config-only mutation is limited to solver
MINIMAL_FIX = persist/compare complete config identity for each retained stage
REGRESSION_TESTS_REQUIRED = config-only changes at planner/grammar/activity/anchor stale boundaries
MIGRATION_REQUIRED = NO for compatibility rejection; persisted schema versioning may be needed
CONFIDENCE = MEDIUM
```

### TG-REAUDIT-03 — blocked generation persistence에 mounted browser/IDB 검증이 없다

```text
TITLE = blocked-generation persistence is covered below the mounted Workspace browser boundary only
SEVERITY = TG
EVIDENCE_STRENGTH = TEST_GAP_ONLY
SUPPORTED_DEPLOYMENT_REACHABLE = YES
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = NO defect reproduced
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO
RELATED_CLOSURE_FINDING = P2-ULTRA-01
ROOT_CAUSE = tests use domain/store helpers without mounted caller, reload and real IDB scheduling
EXACT_FILES = src/app/workspace/WorkspaceClient.tsx; src/product/local-project-store.ts
EXACT_FUNCTIONS = generate; saveProject; loadProject
EXACT_STATE_FIELDS = blocked generation; project ID; persisted lifecycle; route generation
FAILURE_SEQUENCE = coverage gap for blocked result -> component state -> IDB -> browser reload -> route rendering
REPRODUCTION = test inventory; no mounted Workspace caller campaign
EXPECTED = production caller persistence/reload evidence
ACTUAL = implementation traces correctly, but independent mounted evidence is absent
WHY_CLOSURE_TESTS_PASS = helper/domain assertions do not exercise React/browser scheduling
MINIMAL_FIX = none proven; add browser-level regression evidence
REGRESSION_TESTS_REQUIRED = mounted blocked generation, reload, route switch and stale completion
MIGRATION_REQUIRED = NO
CONFIDENCE = MEDIUM
```

### TG-REAUDIT-04 — AudioContext lifecycle에 mounted Web Audio 검증이 없다

```text
TITLE = AudioContext lifecycle closure lacks mounted component and fake Web Audio evidence
SEVERITY = TG
EVIDENCE_STRENGTH = TEST_GAP_ONLY
SUPPORTED_DEPLOYMENT_REACHABLE = YES
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = NO defect reproduced
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO
RELATED_CLOSURE_FINDING = P2-ULTRA-04
ROOT_CAUSE = reducer/helper tests do not exercise browser context creation, suspend/resume, unmount and replacement
EXACT_FILES = src/product/ProductPracticePlayer.tsx; src/product/practice-audio-ownership.ts;
              src/product/audio-context-lifecycle.test.ts
EXACT_FUNCTIONS = ProductPracticePlayer; ProductPracticePlayerSession;
                  PracticeAudioOwnershipController; disposeOwnedAudioSession
EXACT_STATE_FIELDS = AudioContext state; active nodes; component identity; abort/cleanup generation
FAILURE_SEQUENCE = coverage gap across user gesture -> context -> route/unmount -> new player/context
REPRODUCTION = test inventory; no mounted fake Web Audio caller
EXPECTED = exact one active context/nodes and deterministic close on replacement
ACTUAL = code trace is plausible, runtime evidence absent
WHY_CLOSURE_TESTS_PASS = pure lifecycle reducer only
MINIMAL_FIX = none proven; add mounted fake-browser contract test
REGRESSION_TESTS_REQUIRED = suspended/resumed context, rapid play, unmount, route replacement
MIGRATION_REQUIRED = NO
CONFIDENCE = MEDIUM
```

### TG-REAUDIT-05 — malformed Share 2xx codec와 실제 consumer bound가 모순된다

```text
TITLE = browser accepts success credentials rejected by public locator and owner-delete routes
SEVERITY = TG
EVIDENCE_STRENGTH = PROVEN contract/test gap
SUPPORTED_DEPLOYMENT_REACHABLE = NO for exact current server generator
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = NO current server emission reproduced
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO
RELATED_CLOSURE_FINDING = P1-ULTRA-04
ROOT_CAUSE = create/recovery accepts token/secret 8..512 while consumers require token 16..512 and secret 22..256
EXACT_FILES = src/product/share-create-api.ts; src/product/share-create-recovery.ts;
              src/product/share-locator.ts; src/server/http/api.ts
EXACT_FUNCTIONS = classifyShareCreateApiResult; validResponse; resolveShareLocator;
                  parseShareDeleteBody; parseShareOwnerReconcileBody
EXACT_STATE_FIELDS = token; ownerDeleteSecret; durable completed response
FAILURE_SEQUENCE = malformed 2xx with 8-char credentials -> browser persists completed -> link/delete immediately reject
REPRODUCTION = inline classifier/locator/parser probe; classifier completed, locator invalid, DELETE SHARE_DELETE_INVALID
EXPECTED = producer and every consumer share one exact success codec
ACTUAL = closure test fixture itself uses a route-invalid secret
WHY_CLOSURE_TESTS_PASS = test copies permissive browser implementation rather than production consumer contract
MINIMAL_FIX = one shared exact response/credential codec
REGRESSION_TESTS_REQUIRED = all boundary lengths through classifier, public lookup, delete and reconcile
MIGRATION_REQUIRED = NO
CONFIDENCE = HIGH
```

### TG-REAUDIT-06 — top-level provider status runtime codec가 없다

```text
TITLE = malformed top-level provider status can leak the observation lease until expiry
SEVERITY = TG
EVIDENCE_STRENGTH = TEST_GAP_ONLY
SUPPORTED_DEPLOYMENT_REACHABLE = NO; real adapter path remains external
CURRENT_SCHEMA_REACHABLE = YES
MATERIAL_PRODUCT_IMPACT = NO current adapter failure reproduced
REQUIRES_UNSUPPORTED_HISTORICAL_STATE = NO
RELATED_CLOSURE_FINDING = P2-ULTRA-15; TG-ULTRA-05
ROOT_CAUSE = nested needs-input has a codec, but VendorOmrStatus itself has no runtime codec/default/finally branch
EXACT_FILES = src/domain/omr/contracts.ts; src/server/omr/application-service.ts
EXACT_FUNCTIONS = DurableOmrApplicationService.synchronizeStatus; validateVendorInputRequest
EXACT_STATE_FIELDS = status.kind; statusObservationLeaseToken/ExpiresAt; retry metadata
FAILURE_SEQUENCE = adapter returns null or {kind:alien} after lease claim -> TypeError or fallthrough -> lease remains to expiry
REPRODUCTION = static exhaustive comparison of runtime branch chain to the typed union
EXPECTED = every runtime object maps legally or fails closed while releasing exact lease
ACTUAL = legal statuses are exhaustive; malformed top-level objects are not
WHY_CLOSURE_TESTS_PASS = malformed nested needs-input only; no null/unknown top-level result
MINIMAL_FIX = full runtime status codec and exact-lease fail-closed completion
REGRESSION_TESTS_REQUIRED = null/array/missing/unknown kind, invalid branch fields and throwing getters
MIGRATION_REQUIRED = NO
CONFIDENCE = MEDIUM
```

## I. Migration / PostgreSQL / runtime verify-only

```text
POSTGRESQL_VERSION = 17.11
MIGRATIONS_1_TO_11_UNCHANGED = YES
MIGRATIONS_12_TO_14 = PRESENT, deterministic
INVENTORY_CONTIGUOUS = 1..14
POSTGRES_FRESH_1_TO_14 = PASS
SECOND_APPLY = PASS, installed=[]
SCHEMA_MIGRATION_ROWS = 14; min=1; max=14
MISSING_MIGRATION_DETECTION = PASS — MIGRATION_REQUIRED
CHECKSUM_DIVERGENCE_DETECTION = PASS — MIGRATION_HISTORY_DIVERGED
RUNTIME_VERIFY_ONLY = PASS
ORDINARY_RUNTIME_DDL = 0
FINAL_POOL_CONNECTIONS = 0
DOCUMENTED_LATEST_VERSION = 14
```

Closure migrations의 actual runtime checksums는 다음과 같다.

```text
012_share_moderation_lifecycle = 68fae44f5fb02cbdf42bb0a4d510627a4a5b8b29b279378590ab41d776ed44d2
013_omr_provider_delete_authority = d86e98a41a0e72f121e7bd12a89bbca7b8c7fa4578a9f09cec3a7778d7d3ccb5
014_share_create_cross_session_recovery = bcb47b6c00099e24c215e829259def5e981f0e6757cc36e431f5f1b8f79f3140
```

Official EDB PostgreSQL 17.11 portable archive를 task-local temp에 사용했다. Node 22.23.2 / npm 10.9.8에서 fresh database `npm run migrate`가 `[1..14]`, 반복 실행이 `[]`를 반환했다. Production composition은 `PostgresOmrStore`와 `S3OwnedObjectStore`를 구성했고 schema-only canonical hash가 전후 동일했다. Cluster/process를 정상 종료하고 exact validated temp directory와 Node archive를 영구 제거했다.

## J. Commands와 test evidence

최종 authoritative local run은 repository contract인 Node `v22.23.2`에서 수행했다.

```text
npm ci = PASS — 452 packages, 453 audited, vulnerabilities 0
npm run typecheck = PASS
npm run lint = PASS
npm test = PASS
npm run test:postgres = PASS — actual PostgreSQL 17.11
npm run build = PASS — Next.js 16.3.0, 16 static pages generated
git diff --check = PASS
npm run migrate = PASS — fresh [1..14], repeated []
runtime verify-only = PASS — schema hash unchanged

TEST_FILES = 90
TEST_COUNT = 882
POSTGRES_TEST_FILES = 2
POSTGRES_TEST_COUNT = 35

SEGMENT_B_101 = PASS — 1 test passed, 5 skipped by exact name filter
OMR_101 = PASS — 1 file / 1 test, 101 permutations
FROZEN_AUTHORITY = PASS — 2 files / 7 tests
```

Targeted independent campaigns:

```text
WAVE_1_TARGETED = PASS — 10 files / 142 tests
WAVE_2_TARGETED = PASS — 17 distinct files / 110 tests
WAVE_3_TARGETED = PASS — 11 files / 166 tests

SNAPSHOT_TAMPER_MATRIX = PASS; adjacent purity/performance TG/P2 remain
MUSICXML_TIMING_ROUNDTRIP = PASS for named fixtures; fractional chord-offset probe FAIL
WORKSPACE_IDENTITY_CAMPAIGN = PASS for different-ID paths; same-ID/ABA probe FAIL
SHARE_RESPONSE_LOSS_CAMPAIGN = PASS for one K/tab; two-tab K split FAIL
PG_SHARE_SESSION_CONFORMANCE = PASS
CLEANUP_SCHEDULER_CAMPAIGN = PASS for one batch; 26+ fairness FAIL
PROVIDER_DELETE_CERTAINTY = PASS for ledger/merge core
PG_FAILPAGE_FAULT_CAMPAIGN = PASS
HISTORICAL_PROVIDER_UPLOAD = PASS
OMR_PAGE_MANIFEST = PASS for linear helper path; mounted stale preparation FAIL
BROWSER_RETRY_LIFECYCLE = PARTIAL
PROVIDER_STATUS_EXHAUSTIVE = PASS for legal statuses
MEMORY_POSTGRESQL_PARITY = PASS for covered transitions
```

Green tests do not close caller/concurrency findings. Major overfitting patterns were single component gate, sequential fake IDB, same injected K, source-first fixture, helper-only input limits, one-shot scheduler, fixed actor/session, and no mounted `WorkspaceClient`/`OmrClient`/Web Audio caller.

## K. Temporary probes

```text
PROBE_COUNT = 12 logical probes
PROBE_FILES_COMMITTED = 0
TEMPORARY_PROBE_FILES_FINAL = 0
EXTERNAL_REAL_PROVIDER_CALLS = 0
ALL_TEMP_DATABASE_AND_RUNTIME_ASSETS_REMOVED = YES
PROBE_COMMANDS = CMD-W1-ROUTE; CMD-W1-FRACTIONAL; CMD-W1-LEAD-KEY; CMD-W1-FLOW;
                 CMD-W2-TWO-TAB; CMD-W2-CODECS; CMD-W2-TWO-KEY-PG; CMD-W2-OVERSIZE;
                 CMD-DB-VERIFY; CMD-DB-MIGRATE; CMD-RUNTIME-VERIFY
PROBE_RESULTS = 12 logical results recorded in the table below
ALL_REMOVED = YES
```

Re-execution entrypoint forms used in the final authoritative run were:

```powershell
$env:TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55441/postgres'; npm run test:postgres
$env:DATABASE_URL='postgresql://postgres@127.0.0.1:55441/harmonymaker_node22_final'; npm run migrate
$env:DATABASE_URL='postgresql://postgres@127.0.0.1:55441/harmonymaker_node22_final'; npm run migrate
@'<inline fake-indexeddb / production-composition probe recorded by the result table>'@ | node --input-type=module
pg_dump -h 127.0.0.1 -p 55441 -U postgres -d harmonymaker_node22_final --schema-only --no-owner --no-privileges
```

Fault-specific programs were intentionally never committed; their exact inputs, transition fields and outputs are preserved in the finding `REPRODUCTION` fields and the following table rather than as reusable production/test files.

Inline program의 literal text는 Codex append-only JSONL command transcript에 보존했다. 아래 `session/exec ordinal`, UTF-8 byte count와 SHA-256은 `response_item.payload.input` 전체(outer tool command 포함)에 대한 값이다. 따라서 표의 extraction command로 실제 실행 문자열을 byte-exact하게 다시 읽고 hash를 검증할 수 있다.

```powershell
$session = "$env:USERPROFILE\.codex\sessions\2026\08\19\rollout-2026-08-19T23-15-23-01a01a60-70a2-7151-9cc3-38710795a614.jsonl"
$wanted = 55
$ordinal = 0
Get-Content -LiteralPath $session | ForEach-Object {
  $row = $_ | ConvertFrom-Json -Depth 100
  if ($row.type -eq 'response_item' -and $row.payload.type -eq 'custom_tool_call' -and $row.payload.name -eq 'exec') {
    $ordinal++
    if ($ordinal -eq $wanted) {
      $literal = [string]$row.payload.input
      $literal
      [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($literal))).ToLowerInvariant()
    }
  }
}
```

`CMD-W1-*` transcript는 `rollout-2026-08-19T23-17-58-01a01a62-cf9b-7d42-82b6-c7fabc38c949.jsonl`, 나머지는 위 root transcript에 있다.

| Command ID | Logical probe | session / exec ordinal | UTF-8 bytes | command transcript SHA-256 | exact terminal result |
|---|---|---:|---:|---|---|
| CMD-W1-ROUTE | Workspace same-ID/ABA | `01a01a62…c949 / 38` | 2296 | `23e147c53f08dbec7b60ea5be5d13c7241648568de4955321384f882aa9d9661` | exit 0; `sameIdApplied=true`, `abaApplied=true`, final `A-v0-late-generation` |
| CMD-W1-FRACTIONAL | MusicXML fractional offset | `01a01a62…c949 / 39` | 3977 | `90eef18c1680acc1b1705ef9c57a2c1357df5f8566f9e7fb7d3cdc27ce6217d1` | exit 0; offset `0.3333333333333333`, chordCount `0`, invalid-offset diagnostic `true` |
| CMD-W1-LEAD-KEY | selected lead key | `01a01a62…c949 / 40` | 3304 | `bb0f0f049e9816e1a6e5e718d81e6e68a04ade171ee30e9965f445252562b0bd` | exit 0; nonselected modulation `true`, override G, after switch D |
| CMD-W1-FLOW | reachable import→project→generation→export→reimport | `01a01a62…c949 / 42` | 4576 | `d1930ad78584e0978795d6111aa239c21c977594c5915ce8ee5a7e2cf5885067` | exit 0; ready `true`, generation `complete`, offset `1/3`, round-trip chordCount `0` |
| CMD-W2-TWO-TAB | two-tab browser Share | `01a01a60…a614 / 55` | 3167 | `7a11770aebcc34e9c07e1d5576d50341854126ad533b5079daeffbb93af4bcd5` | exit 0; trials 20, distinct K 20, lost authority 20 |
| CMD-W2-CODECS | malformed 2xx + reordered PracticeShare | `01a01a60…a614 / 59` | 2782 | `deb8f8416603e2bbe0d047707ef94ed209ab7a8ced927bd8047ef377dfdc2609` | exit 0; browser completed / locator invalid / DELETE invalid; H1 index resolved lead |
| CMD-W2-TWO-KEY-PG | concurrent distinct K on actual PG | `01a01a60…a614 / 64` | 3750 | `383b56312dbfb131c7da81f8f755b42dda2b4cbb2b1d380eecc8547b0277c34b` | exit 0; statuses `[201,201]`, distinct tokens 2, shares/completions/quota `2/2/2` |
| CMD-W2-OVERSIZE | semantic oversize quota ordering | `01a01a60…a614 / 69` | 3763 | `132f43858b3768724ee43a5b466f02489319c9d31c9e2b1ee6198fa66a770c5b` | exit 0; raw/plaintext `272159/272061`, 12 rejects, next small `429 QUOTA_EXCEEDED` |
| CMD-DB-VERIFY | current/missing/diverged migration inventory | `01a01a60…a614 / 48` | 1835 | `831beeebddb5899581594d7c639ef4c7fd570da966f26f3b55ffb772cca9019d` | exit 0; `PASS / MIGRATION_REQUIRED / MIGRATION_HISTORY_DIVERGED` |
| CMD-DB-MIGRATE | Node22 fresh migrate/repeat/build pair | `01a01a60…a614 / 96` | 1106 | `da8b8625e47541c56342405cfe06366de3217e58ebab7a37b6bed19249c3acdd` | exit 0; installed `[1..14]`, repeat `[]`, schema rows `14:1:14` |
| CMD-RUNTIME-VERIFY | production composition + schema hash | `01a01a60…a614 / 100` | 2504 | `008c875a769628b6a49af7d7ca0c755c9d64b184149c2c980028ba274344f397` | exit 0; `S3OwnedObjectStore/PostgresOmrStore`, before=after `c0b67f…76d8` |

| Probe | Command form / result |
|---|---|
| Workspace same-ID/ABA | Inline route-controller delay probe: both stale mutations applied; stale A/v0 became current. |
| MusicXML fractional offset | Inline importer/project/generation/export/reimport: decimal offset emitted, chord count became 0. |
| Full Wave-1 flow | Inline MusicXML→Quick Review→project→generation→render→reimport: standard path ready; defect-specific branches recorded separately. |
| Lead-key authority | Inline Quick Review command probe: other-part modulation survived; G override became D. |
| Two-tab Share browser | Node + `fake-indexeddb`, 20 trials: 20 distinct K splits and 20 lost completion authorities. |
| Two-key Share PG | Actual PG service calls: `[201,201]`, 2 tokens, 2 share rows, 2 quota effects. |
| Share malformed 2xx | Browser classifier accepted; locator/delete parser rejected. |
| Reordered PracticeShare | Validator→materializer→plan→player: payload H1 became lead. |
| Oversize Share quota | 12 valid semantic-oversize attempts consumed quota; next small request 429. |
| Migration missing/diverged | Actual PG verify returned `MIGRATION_REQUIRED` and `MIGRATION_HISTORY_DIVERGED`. |
| Runtime composition | Vite SSR production composition plus schema-only hash before/after; unchanged. |
| Node22 fresh migration | `npm run migrate` on fresh PG17: 1..14, repeat empty, pool readback 0. |

환경상 초기 shell PATH에 `npm`이 없어 literal command는 실행 전 실패했다. 한 sub-agent가 금지 지시 수신 전 `pnpm exec vitest`를 1회 시도해 test 실행 전 실패하면서 untracked `pnpm-lock.yaml`/`pnpm-workspace.yaml`과 `node_modules` 재배치를 만들었다. 두 파일은 즉시 제거했고 root가 clean `npm ci`, 이후 Node22 `npm ci`를 다시 실행했다. Final tracked diff에는 영향이 없다. Runtime probe의 초기 `server-only` externalization 시도도 pre-service failure였고, 최종 noExternal virtual stub probe만 evidence로 사용했다.

## L. Frozen musical authority

```text
README_APPLY_SHA256 = 5c8c704fc0e5ab51adb628022aeaf7e97b33b287610b1fd5533a177b65fd4ede
WAG_V1_0_1_SHA256 = ee09ded709273cc6468f1fd3f1df319d04458716f6ad911a878bffdb9b4498d5
FREEZE_JSON_SHA256 = 3ded5968b34d7fbd48a3f58f22b67370a8ec4ea36fbd4e0ed834c81d5ed080ba
GRAMMAR_JSON_SHA256 = 676780f8ceacda6d88c5724156f84f95fb5b337b4d13d16342f5342cb617330d
DIAGNOSTIC_BASELINE_SHA256 = 0fa15cf0652e41b1509df0f8d140bfa165726a6799a83b19eed59b58dbbbab4c
DIAGNOSTIC_EXTENSION_SHA256 = 4be25a0ae3cc28812b85da585e1ef6f0aa2f0ce5fc560e34177aa49eee06379b

SIX_HASHES_EXACT = YES
DIAGNOSTIC_CODE_COUNT = 99
FROZEN_MUSICAL_AUTHORITY_CHANGED = NO
PROTECTED_PATH_DIFF_85e8913_TO_fac726f = 0
```

## M. Repository mutation

```text
PRODUCTION_DIFF = 0
TEST_DIFF = 0
MIGRATION_DIFF = 0
DEPENDENCY_DIFF = 0
CONFIG_DIFF = 0
DISCOVERY_REPORT_DIFF = 0
CLOSURE_REPORT_DIFF = 0
EXISTING_HANDOFF_EVIDENCE_DIFF = 0
TEMPORARY_FILES = 0
NEW_REAUDIT_REPORT_ONLY = YES
```

## N. Documentation commit / exact-SHA CI / Vercel

```text
REAUDIT_BASE_CODE_SHA = fac726f7f56f73ebaab24916f88b6da7aba5a910
REAUDIT_BRANCH_BASE_SHA = 2b14c6a091b6060dd9ebadaf569e561b23e491b2
REAUDIT_DOCUMENTATION_SHA = EXTERNAL_POST_COMMIT_OBSERVATION
REMOTE_BRANCH_EXACT = EXTERNAL_POST_PUSH_OBSERVATION
LOCAL_REMOTE_DIVERGENCE = EXTERNAL_POST_PUSH_OBSERVATION

GITHUB_ACTIONS_RUN = EXTERNAL_POST_COMMIT_OBSERVATION
QUALITY_JOB = EXTERNAL_POST_COMMIT_OBSERVATION
HEAD_SHA = EXTERNAL_POST_COMMIT_OBSERVATION
RESULT = EXTERNAL_POST_COMMIT_OBSERVATION

VERCEL_DEPLOYMENT_ID = EXTERNAL_POST_COMMIT_OBSERVATION
GITHUB_DEPLOYMENT_ID = EXTERNAL_POST_COMMIT_OBSERVATION
STATUS_ID = EXTERNAL_POST_COMMIT_OBSERVATION
HEAD_SHA = EXTERNAL_POST_COMMIT_OBSERVATION
RESULT = EXTERNAL_POST_COMMIT_OBSERVATION
PREVIEW = EXTERNAL_POST_COMMIT_OBSERVATION
```

이 파일은 자신을 포함하는 documentation commit SHA와 그 commit에서 시작되는 external CI/deployment terminal result를 스스로 정확하게 포함할 수 없다. Report-only commit/push 후 exact SHA observations는 최종 handoff에 기록한다.

## O. External remaining

```text
REAL_OMR_PROVIDER_CONNECTED = NO
REAL_PROVIDER = NOT_CONNECTED / EXTERNAL_REMAINING
REAL_PROVIDER_SELECTION_CREDENTIALS_ACCURACY_PRICING_RETENTION = NOT_PERFORMED
RIGHTS_SAFE_CORPUS_DEV_GE_36 = NOT_PERFORMED
RIGHTS_SAFE_CORPUS_SEALED_GE_24 = NOT_PERFORMED
CORPUS = NOT_PERFORMED
PRODUCTION_LIVE_POSTGRES = NOT_PERFORMED
PRODUCTION_LIVE_S3 = NOT_PERFORMED
IPHONE_SAFARI = NOT_PERFORMED
KAKAO_IN_APP_BROWSER = NOT_PERFORMED
KAKAO_IN_APP = NOT_PERFORMED
CYBER_SECURITY_AUDIT = OUT_OF_SCOPE / NOT_PERFORMED
SECURITY_PASS_DECLARED = NO
```

Real provider 미연결, corpus, live infrastructure, physical-device 미검증 자체를 finding으로 만들지 않았다.

## P. Final verdict

```text
UNRESOLVED_SUPPORTED_P0 = 0
UNRESOLVED_SUPPORTED_P1 = 6
UNRESOLVED_MATERIAL_P2 = 10
UNRESOLVED_PRODUCT_RELEVANT_TG = 4
UNRESOLVED_PRODUCT_TG = 4
P1_RESAT_02_F = NOT_APPLICABLE_PRE_PRODUCTION_LEGACY_PATH

ORIGINAL_P1_CLOSED_CONFIRMED = 6/10
ORIGINAL_P2_CLOSED_CONFIRMED = 10/14
ORIGINAL_TG_DISPOSITIONS_CONFIRMED = 7/7

SUPPORTED_NEW_P0 = 0
SUPPORTED_NEW_P1 = 6
NONBLOCKING_NEW_P2 = 10
NEW_TEST_GAPS = 6

ULTRA_REAUDIT_COMPLETE = YES
ULTRA_REAUDIT_PASS = NO
ULTRA_ACCEPTANCE_RECOMMENDED = NO
SEGMENT_D_REACCEPTANCE_RECOMMENDED = NO

ULTRA_ACCEPTED = NO
ULTRA_GATE_FROZEN = NO
SEGMENT_D_ACCEPTED = NO
SEGMENT_D_GATE_FROZEN = NO
STEP_11_READY = NO
STEP_11_STARTED = NO
```

Supported P1이 존재하고 original closure finding이 재개방되었으므로 closure acceptance gate는 실패한다. 이 세션에서는 finding을 수정하지 않고 전체 finding set만 기록한다.
