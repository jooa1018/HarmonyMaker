# Astra runtime closure — 2026-09-07 KST

## 판정과 SHA 경계

**INCOMPLETE.** 로컬 수정과 검증은 진행됐지만, Render workspace 선택 승인이 없어 실제 provider의 추적 branch 및 자동 배포 영향을 확인하지 못했다. 사용자 지시의 push 전 배포 연결 확인 조건에 따라 로컬 additive commit은 아직 push하지 않았다. 현재 Preview에는 아래 표시 결함이 남아 있다. 새 HEAD의 push/PR CI 및 새 SHA Preview 검증은 완료가 아니다.

| 대상 | 직접 확인한 상태 |
| --- | --- |
| 저장소 / branch | `jooa1018/HarmonyMaker` / `codex/harmonymaker-astra-runtime-closure` |
| 시작 및 현재 원격 HEAD | `41c26ea97ab0bf057cb9febe245c422e7107ebd7` |
| base | `chatgpt/harmonymaker-audiveris-provider` / `82c01d28a8e862ed96b48da8ab405589329a8553` |
| 최종 소스 검증 commit | `58bf767f852a5106a0882934accdf0771bc3f64f`. 이 문서를 추가하는 후속 commit은 기록만 변경하며 앱·테스트 소스는 동일 |
| 기존 작업 보존 | base 이후 기존 6개 commit 보존. 별도 linked worktree 사용. 다른 checkout의 미커밋 수정과 과거 final branch는 수정하지 않음 |
| PR | [#13](https://github.com/jooa1018/HarmonyMaker/pull/13), Open / Draft / Unmerged 유지 |
| 확인한 Preview | [고정 deployment URL](https://harmony-maker-2yu868avd-ecctom1.vercel.app), `dpl_FUJGLQQYv6iSZ69FiyPu4K1vppMf`, READY, target null, source git, SHA `41c26ea` |
| branch alias | `harmony-maker-git-codex-harmonymaker-astra-runti-bfd413-ecctom1.vercel.app`, 위 deployment의 alias 목록에 존재 |
| 운영 앱 단서 | `harmony-maker-opal.vercel.app`, production deployment의 git ref `main`, SHA `b4e14976ab65899cc86a65c20c99a7545f1a0d9e`. 변경·승격하지 않음 |
| provider revision/config | BLOCKED_EXTERNAL: Render 커넥터가 사용자 확인 workspaceId를 요구. `My Workspace` (`tea-d90iarbsq97s739e0sbg`) 승인 요청 미응답 |

Vercel의 승인된 임시 인증 URL을 사용해 실제 Playwright Chromium으로 접근했다. 보호 설정을 변경하지 않았다. 원래 SSO 로그인 화면이 나타났다는 사실은 이후 인증된 Preview 흐름의 접근 불가 근거로 사용하지 않는다. 임시 접근 토큰·쿠키·owner handle은 보고서나 저장소에 포함하지 않는다.

## 결함 및 변경

| ID | 사용자 영향 / 재현 | 원인 | 변경 파일·commit | 검증 / 상태 |
| --- | --- | --- | --- | --- |
| ASTRA-01 | 기존 browser run의 OMR 진입에서 빈 AssertionError; 이후 MXL 미실행 | navigation 완료 전 전역 alert가 `__next-route-announcer__`의 빈 요소를 선택. 실제 Source 영역에는 명확한 서버 미구성 오류와 session HTTP 503이 존재 | `scripts/runtime-browser-smoke.py`, `.gitignore`; `5b1f1a3` | PASS 로컬. `/omr` URL/heading 대기, Source region alert의 실제 오류 문구, 시작 동작 부재 및 create 0건을 모두 검사. 빈 오류 허용하지 않음 |
| ASTRA-02 | 기존 clearInterval receiver 수정의 실제 브라우저 해제 보장이 필요 | 기존 wrapper 수정은 타당하며 보존. 이전 smoke의 재생만으로는 pause/reset/unmount 해제를 입증하지 못함 | `scripts/runtime-browser-smoke.py`; `5b1f1a3` | PASS 로컬 및 기존 SHA Preview. 실제 PCM, Play/Pause/Resume/Reset, 재생 중 편성 변경, unmount 후 context closed / timer baseline 복귀, live context 1개 검사 |
| ASTRA-03 | 응답 유실 후 중복 클릭·새로고침으로 다른 생성 키를 발급할 위험의 브라우저 회귀 범위 부족 | 브라우저 manifest 및 버튼 상태를 실제 reload와 함께 검사해야 함 | `scripts/runtime-browser-smoke.py`; `06ba31a` | PASS 격리 브라우저. API 전체 interception, 첫 응답 유실, 같은 키 retry의 명확한 503. 2회 요청/동일 키/논리적 simulated effect 1회/실제 외부 효과 0회. 실제 provider 장애 주입 결과가 아님 |
| ASTRA-04 | P1 표시 결함: 390px Preview가 1,056px까지 가로 넘침. 8마디도 1단/음표 머리 약 2.70px, 96마디 공유는 한 줄로 축소 | 긴 select의 최소 내용 폭과, 줄바꿈 없는 ABC를 responsive SVG로 축소하는 렌더링 | `src/app/globals.css`, `src/app/workspace/workspace.module.css`, `src/product/ProductPracticePlayer.tsx`, browser smoke; `58bf767` | 로컬 PASS: select 폭 제한, 모바일 label 분리, 실제 폭 기준 abcjs wrap + ResizeObserver 해제. 96마디 desktop 24단/mobile 96단, 음표 약 8px, pageWidth 390. 현재 Preview는 아직 FAIL; 수정 SHA 배포 검증 필요 |
| ASTRA-05 | 전체 npm test의 101회 OMR 결정성 검사 간헐적 30초 timeout | 기본 worker 병렬 실행에서 자원 경합. 동일 코드가 기본 실행 1회 PASS, 2회 timeout; worker 2개 실행은 PASS | `vitest.config.mts`; `c80206d` | PASS. worker 수만 2로 제한. 테스트·101회 순열·30초 timeout·assertion·skip 조건은 변경하지 않음. 기본 `npm test` 최종 97 files/905 tests PASS |
| ASTRA-06 | 최종 HEAD가 공유 가능한 검증된 Preview에 도달하지 못함 | provider 실제 연결/자동 배포 확인을 위한 Render workspace 승인이 남음 | 코드 변경 대상 아님 | BLOCKED_EXTERNAL. push, 새 HEAD CI, 새 Preview는 NOT_RUN. 현 Preview의 표시 결함 때문에 전체 판정은 INCOMPLETE |

예외 기록은 단계, 예외 유형, 비어 있지 않은 fallback, traceback, query/fragment를 제외한 allowlist 경로 및 API HTTP/requestfailed/pageerror를 남긴다. bearer/OMR handle/URL/secret 형태는 정리한다. failure artifact 작성은 예외 정보를 먼저 보존하며, 실패를 catch해 PASS로 바꾸지 않는다.

## 실제 Preview 사용자 흐름 — 배포 SHA 41c26ea만 해당

| 흐름 | 직접 실행 결과 | 범위 |
| --- | --- | --- |
| MusicXML 직접 입력 | PASS | 잘못된 입력 거부 → 일반 화면 → Quick Review → 프로젝트 → simple/standard/full complete → 4편성 표시 및 nonzero PCM → 저장/새로고침/프로젝트 JSON 재가져오기 → MusicXML 3파트 내보내기 및 재가져오기 |
| MXL 직접 입력 | PASS | `/omr`의 MXL 로컬 handoff → Quick Review → generation → 재생/저장/새로고침/3파트 내보내기. provider 호출 아님 |
| 실제 PNG OMR | PASS (인식/결과까지) | 이번 세션에서 작성한 8마디 악보, 이미지 품질/권리/외부전송 확인. 실제 create double-click에서 1회 요청. queued/processing 표시. 4분 관찰 종료 뒤 동일 job/handle을 sync하여 completed 및 실제 MusicXML HTTP 200 수신. 새 생성 키나 새 외부 작업으로 재시도하지 않음 |
| 실제 PDF OMR end-to-end | PASS (표시 결함은 별도) | 자체 작성 동일 악보 PDF. 페이지/품질 WARN을 명시적으로 검토 후 동의, 실제 인식 완료 → 정본 importer handoff → lead/C major/tempo/8개 코드/곡구조/3인 음역/권리 확인 → 생성 → 4편성 실제 PCM → 저장/새로고침/프로젝트 파일 재가져오기 → MusicXML 3파트 재가져오기 및 generation |
| 단순 코드 인식 | PASS, 제한된 fixture | PNG/PDF 모두 8마디/32음/8개 코드. C, G, Am, F, C, G, F, C를 검토 화면에서 확인. OCR 제목/조성 누락은 명시적 사용자 교정; 인식되지 않은 값을 자동 정답으로 꾸미지 않음 |
| URL 공유 | PASS | 읽기 전용 화면, 생성 동작 없음, 실제 PCM. 서버 저장형으로 계산하지 않음 |
| 서버 저장형 공유 | PASS (표시 결함은 별도) | 자체 작성 96마디 MusicXML을 일반 review/generation/UI에서 공유 → `kind:store`, HTTP 201. 동일 키 API replay 200/동일 응답. 실제 readonly browser PCM. UI 소유자 삭제 200 및 read-after-delete 404 |
| 로컬 프로젝트 삭제 | PASS | 이번 테스트가 만든 프로젝트만 삭제. cloud 삭제와 구분 |
| OMR 서버/provider/object 삭제 | PASS | 이번에 생성한 PNG/PDF 두 job의 소유 권한으로 애플리케이션 DELETE API 실행. 둘 다 HTTP 200, localHandleDeleted true, vendor deleted, cleanupState resolved, 이후 조회 404. provider 재시작이나 전체 데이터 삭제하지 않음 |
| 모바일 viewport | 조작/오디오 PASS, 기존 표시 FAIL | 390×844 Chromium. 물리 기기 검증이 아님. 가로 넘침/악보 축소는 ASTRA-04로 로컬 수정 |

과거 “눌렀다가 무반응” 증상은 위 정상 PNG/PDF에서 재현되지 않았다. 실제 요청과 job 상태 전이 및 결과 수신을 확인했다. 다만 인식 완료까지 수분이 걸렸으며 전체 문서/폰트/음악적 정확도 검증으로 확대하지 않는다.

## Provider 및 DB/storage 확인 범위

- 기존 `provider_entrypoint._decode_musicxml`은 실제 Audiveris 결과 정규화 후 `augment_musicxml_with_chord_ocr`를 호출한다. 삽입 후보는 unconfirmed이며 Quick Review 확인을 거쳐 Source/generation 입력에 반영된다.
- 기존 CΔ7/C°7/Cø7/unknown-symbol/slash-bass source identity 회귀를 보존했고 provider 전체 65개 테스트가 통과했다. OCR 텍스트 주입 단위 테스트는 실제 해당 glyph의 영상 인식 정확도 증거가 아니다.
- Preview capability: Audiveris 5.10.2, PNG transfer, maxPages 12, page evidence, deletion 지원, immediate deletion true, retention `self-hosted:3600s:ephemeral`, supportsIdempotency false. 실제 엔진의 단순 fixture 성공으로 재시작 후 idempotency를 보장하지 않는다.
- 실제 Render revision, 환경변수 값/timeout/memory/persistence와 현재 추적 branch는 조회하지 못했다. 저장소 `render.yaml`의 base branch 추적 및 384m/1h 설정은 현재 서비스 설정으로 확정하지 않는다. Vercel SHA로 Python 배포 SHA를 추론하지 않는다.
- Neon `harmonymaker-preview` (`red-sun-79451966`)의 `production` primary branch (`br-weathered-unit-aw8j57lo`)는 비일회용으로 취급했다. read-only SQL로 registry 1~15를 확인했다. migration/장애 주입/직접 DELETE SQL을 실행하지 않았다.
- 이번 PNG 고유 page digest와 생성 시각으로 Preview에서 만든 job이 위 DB에 존재함을 좁은 조회로 확인했다. provider binding `omr-provider:audiveris:310b16b9aa8b6850b112c43702517b33`, adapter v1, 실제 result object 존재와 읽기를 확인했다. 삭제 후 해당 job의 state/local_delete_state/vendor_delete_state 및 source object lifecycle이 모두 deleted임을 다시 조회했다.
- 실제 source upload/result 수신/소유자 cleanup은 확인했지만 bucket/endpoint의 설정 원문은 조회하지 않았다. 기존 R2 smoke 주장으로 대신하지 않았다.

## 실행 검증

환경: Windows, Node 22.23.2, Next 16.3.0, Python 3.12.14, Playwright 1.57.0 Chromium. root AGENTS 지시에 따라 설치된 Next CSS/client/navigation/testing 문서를 읽었다. Docker Desktop은 sailor-ingest.sock 초기화 오류로 사용하지 못했으며 reset하지 않았다. 공식 배포 PostgreSQL 17.11을 localhost 55439의 disposable DB에 실행했다.

| 명령/검증 | 결과 | 증거 파일/범위 |
| --- | --- | --- |
| `npm ci` | PASS | lockfile 그대로, 452 packages / 0 vulnerabilities |
| `npm run typecheck` | PASS | `typecheck-final.log` |
| `npm run lint` | PASS | `lint-final.log` |
| `npm test` | PASS | 97 files/905 tests, 68.95s. `unit-tests-final.log`. 수정 전 timeout 원본은 `unit-tests-final-layout.log`로 보존 |
| `npm run test:postgres` | PASS | disposable PG의 최종 4 files/39 tests; `postgres-tests-final.log` |
| `npm run migrate` fresh/repeat | PASS | installed 1~15 → 반복 installed []; 각각 `postgres-migrate-first.log`, `postgres-migrate-repeat.log` |
| `npm run build` | PASS | 최종 label CSS 포함 `build-final.log` |
| `git diff --check` | PASS | 변경 파일 실제 diff 검사 |
| provider requirements + pytest | PASS | 65 tests / 3 deprecation warnings; `provider-tests.log` |
| frozen authority + Segment B + OMR determinism | PASS | 3 files/12 tests; 6개 frozen 파일 hash와 두 101회 gate, `frozen-determinism.log` |
| production localhost Chromium 전체 smoke | PASS | 최종 `58bf767f852a5106a0882934accdf0771bc3f64f`, `browser-final.log`, `runtime-browser-evidence/results.json`. 모바일 screenshot을 재확인했고 수직으로 깨진 label도 최종 CSS에서 바로잡음 |
| 실제 Audiveris 엔진 CI | PASS at 41c26ea | 이번에 실행한 [34043519212](https://github.com/jooa1018/HarmonyMaker/actions/runs/34043519212): 실제 Docker image/launcher/HTTP MusicXML/hybrid OCR. fake-provider unit 경로와 실제 엔진 단계를 구분 |
| 최초 실패 CI/artifact | FAIL at 41c26ea | [33950877356](https://github.com/jooa1018/HarmonyMaker/actions/runs/33950877356), job 101265278050, artifact 9964810711 다운로드·내용 확인. 잘못된 alert 검사 재현 |
| 새 HEAD push-triggered / pull_request-triggered CI | NOT_RUN | 미push. branch HEAD, merge-ref, 실제 checkout SHA를 새로 확인해야 함 |
| 새 SHA Vercel Preview | NOT_RUN | 미push. 기존 41c26ea의 성공과 실패만 위 표에 기록 |

## 남은 필수 항목과 한계

1. 사용자에게 이미 요청한 Render **My Workspace** 사용 승인 한 항목이 필요하다. 커넥터 자체가 확인된 workspaceId 재사용을 요구한다. 운영 영향 확인을 건너뛰기 위한 대체 경로로 우회하지 않는다.
2. 승인 후 실제 `harmonymaker-audiveris-temp`의 revision/config/자동 배포 연결 및 비운영 여부를 조회해야 한다. 확인 후 기존 branch additive push, PR #13 유지, push/PR CI의 실제 checkout SHA, 새 Preview deployment SHA와 같은 사용자 흐름을 확인해야 한다.
3. 현재 Preview의 P1 표시 결함은 수정이 아직 배포되지 않아 남아 있다. 확인된 로컬 domain/security/OMR 결과 생성 결함은 없다. 배포 검증 전 PREVIEW_VERIFIED라고 선언하지 않는다.
4. physical iPhone Safari, JPEG 별도 인식, 특수 코드 glyph의 실제 이미지 인식 정확도, 광범위 악보/음악적 정확도, provider restart recovery는 NOT_RUN. 외부 서비스에 장애 주입하지 않았다. 운영 승격/릴리스는 NOT_RUN이며 이번 권한 범위 밖이다.

별도 검토자나 subagent는 사용하지 않았다. 이 문서는 단일 통합 담당자의 실행 기록이며 독립 검증 주장이나 미래 자동 완료 약속이 아니다.
