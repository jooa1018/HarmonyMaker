# 입력·교정·Source 경계 v1

## 2026-09-14 JPEG 후속 요청·원본 재대조·proof 처리

검증 제품은 `3ecdbc347faa237bccd09233f1f26914a9b69850`, 이 절 추가는 문서 전용 변경이다. 이전 revision 395의 원본 미확정과 요청 결정을 사용자 답변 및 원본 재대조로 일반 UI에 반영했다. 현재 초안은 revision 550이며 전곡 39마디 대조가 현재 이력과 일치하고 pending issue는 0개다. 비선택 원본 성부를 보존하면서 Lead 하나만 투영한다.

첫 못갖춘마디의 인쇄된 코드 없음은 원본에 유지하고 `anticipate-first-chord`를 명시 편곡 정책으로 추가했다(`68a2fc6`). 짧은 최초 implicit 구간과 인접 최초 확정 코드 등 제한 조건을 검증하며, original chordEvents를 채우지 않는다. 별도 timeline origin과 request/proof에 결합하고 프로젝트의 전체 Source와 대조한다. XML은 원본 harmony와 구분한 설명/metadata로 기록하며 재입력 metadata는 승인 권위가 아니다. 새 정책을 담는 compact share는 거절한다. 배열 gapPolicy를 String 변환으로 수용하던 반례도 literal 검사로 수정했다. WAG 음악 규칙·OMR·오디오·DB는 변경하지 않았다.

550개 이력의 반복 full replay 지연을 관측해 8M 문자 이하 검증된 exact proof 한 건만 재사용하도록 했다(`3ecdbc3`). private workspace+전체 Replay 및 호출별 반환 bundle을 복제하며, 변조/다른 text는 기존 검증을 거친다. 64M 문자/2048-operation 제한을 유지한다. 같은 r550의 Source 버튼 관측은 Chrome에서 약129초→22초였다. 10초 polling·화면 저장·변동 자원을 포함한 단일 호스트 관측이며 통제 벤치마크가 아니다. 호출자가 export await 중 같은 JS객체를 직접 변조할 때 미검증 text가 반환되는 기존 API race는 남지만, 그 결과는 cache에 등록되지 않고 parse/replay에서 거절된다.

이 제품의 깨끗한 트리에서 타입/전체 lint, 116파일1,126개 기본 및 3파일5개 실제 private 회귀(고유1,131개), production build가 통과했다. Build ID는 `9efzprW9bWuOhnFg6pSPU`, origin은 `http://127.0.0.1:3198`이다. Chrome 동일 프로필의 서버/브라우저 재시작과 Edge 새 프로필의 실제 가져오기·저장·reload·다운로드에서 r550 파일 바이트가 같았다. Edge 최초 PID의 정상 compatibility relaunch로 기동기 준비 확인이 실패한 기록을 보존하고 실제 자식 CDP로 검증을 계속했다. 동기화 설정은 조작하지 않았다. 과거 다운로드 실패도 보존한다.

**JPEG 일반 UI Source 이후 목표는 미완료다.** 유일한 현재 진단은 `PERFORMER_RANGE_INVALID`: 요청된 A 시험 Lead 범위보다 낮은 JPEG 음이43개다. 원본 결정 미해결이나 환경 차단으로 바꾸어 보고하지 않는다. 시험 하한 변경 답변을 기다리며 실제 초안은 원래 A 범위를 유지한다. 별도 메모리 진단은 complete후보1+partial후보1을 얻었지만 일반 UI 생성/재생/프로젝트/XML 성공이 아니며 음악 결과 파일을 만들지 않았다. 진단은 당시68a2fc6 위 미커밋cache 모듈 해시를 기록한다. `HUMAN_RECHECK_PENDING`이며 PostgreSQL/실제 OMR은 해당 경로 미변경으로 반복하지 않았다.

같은 비공개 인계 루트의 최신 `시작안내.md`, `검증보고서.md`, `교정기록.md`, `실행상태.json`, `followup/02-workspaces/jpeg-r550-final-resume.hm-workspace.json`과 실제 manifest를 따른다. r395 문서4개는 baseline-r395에 보존했고 선행831파일 크기/해시도 재확인했다. 원본 음악·전체 proof는 저장소에 추가하지 않았고 push·외부공유·배포·병합·기존파일삭제는 하지 않았다.

## 2026-09-14 실제 JPEG 후보의 명시 교정

검증 제품은 `2c594c2a9b43c916db61271235ad7322b14b7b0e`다. 이후 이 절의 변경은 문서 전용이다. 개별 원본 기호 제거, 성부·이벤트 삽입/이동/제거, 실제 마디 길이, 가사·slur 및 코드 교정에 근거를 남기는 typed command와 일반 UI를 추가했다. 원본과 기존 ID는 보존하며 완성 Source를 주입하지 않는다.

추가 반례로 수입 slur의 실제 선택 범위 검토 의존성, 구형 attest의 Undo/Redo 이행, Source 본문과 proof의 정확한 일치를 보완했다. 새 의존성 표식 v2와 구형 v1 replay를 구분하고, 구형 확인을 새 사용자 승인으로 자동 전환하지 않는다. WAG digest에서 제외되는 가사·구간 등도 replay/normalize한 본문과 대조한다. WAG·오디오·OMR·DB 및 음악 지원 정책은 변경하지 않았다.

보존된 최신 사용자 JPEG 후보에서 일반 UI로 원본 근거가 있는 음악 교정을 실제 적용했다. 초안은 revision 395이며 원본 이벤트 ID 283개 모두 보존, 삽입 2개, 삭제 0개다. 다수의 코드·가사·시간축을 명시적으로 보완한 결과로서 자동 인식 개선이 아니다. 과거 평가용 교정 이력을 fresh 후보에 재적용하지 않았다. 원본 의미와 편곡 요청이 필요한 조건이 남아 판정은 **SOURCE_DECISION_REQUIRED**이며, JPEG의 Source/WAG/프로젝트/편곡 MusicXML 성공은 아직 아니다.

타입·전체 lint, 기본 1,060개와 별도 private 5개 고유 회귀, production build가 통과했다. `.next-local-jpeg` Build ID는 `ZwU6BDINmGA6fktLg2I9c`, 실제 local production origin은 `http://127.0.0.1:3198`이다. 최종 제품 변경이 있는 commit 전 작업 트리를 검증했으며 build 후 생성된 next-env 타입 참조 외에는 commit 파일과 일치한다. 검증 시작 코드 집계와 commit 후 대응 기록은 비공개 실행 로그에 있다.

Chrome 일반 UI 교정·저장·reload·다운로드와 같은 origin의 서버/브라우저 재시작, Edge 새 프로필의 초안 가져오기·실제 다운로드·재입력에서 전체 proof와 요청/음악 일치를 확인했다. Edge의 기존 A 프로젝트는 새 사본·악보·믹서·Play/Pause/Resume/Reset·저장·project/XML 다운로드·재입력 smoke 및 canonical 음악 비교가 통과했다. 이는 JPEG 전곡 생성/청감 성공을 대신하지 않는다. PostgreSQL과 실제 OMR은 해당 코드 경로가 변경되지 않아 재실행하지 않았다. 사람 재확인은 **HUMAN_RECHECK_PENDING**이다.

Edge 첫 다운로드의 자동화 임시 파일 ENOENT는 실패 기록으로 보존했다. 해당 실행에 두 CDP 연결이 있었으며 브라우저 native 종료는 없었다. 단일 CDP로 재개한 5개 실제 다운로드는 통과했다. 연결 간섭은 가설이며 모든 과거 다운로드 문제가 해결됐다고 일반화하지 않는다. 설치 브라우저를 직접 기동했고 launchPersistentContext는 사용하지 않았다.

로컬 비공개 인계: `C:\Users\eccto\Documents\Codex\2026-09-12\head-docs-implementation-source-boundary-v1\outputs\HarmonyMaker-user-jpeg-assisted-v1`. `시작안내.md`, `실행.ps1`, `검증보고서.md`, `교정기록.md`, 최종 작업 공간 및 실제 manifest를 따른다. 원본 음악·이미지·전체 proof는 저장소에 추가하지 않았다. 선행 manifest의 실제 831개 파일은 크기·해시가 보존됐다. push·원격 CI·외부 공유·배포·병합·기존 파일 삭제는 하지 않았다.

## 로컬 PNG/JPEG 입력 연결

실제 로컬 homr 실행과 상태·취소·복구·후보 전달 계약은 [LOCAL_IMAGE_V1.md](LOCAL_IMAGE_V1.md)에 정리한다. 이미지 결과는 기존 영속 작업 공간과 Source 검증을 거친다. 아래 선행 실행 기록과 새 이미지 실행 결과를 구분하며, A 성공을 사용자 JPEG 전곡 복원으로 해석하지 않는다. 사용자가 최근 오디오 개선을 확인했으므로 이번 이미지 작업은 해당 믹서·envelope와 WAG 음악 규칙을 보존한다.

## 2026-09-13 첫 사람 청감 이후 오디오 수정

첫 실제 사람 청취에서 Band OFF의 생성 화음은 대체로 자연스러웠으나 Band ON 마스킹과 음표마다 동반되는 잡음이 보고됐다. 재생 renderer/mixer만 수정한 제품 commit `8fb9a5092a85643998bc6f607e24cfb26c52b300`은 **PLAYBACK_READY / HUMAN_RECHECK_NOT_RUN**이다. Source·WAG·chord·rhythm·tie와 실제 A 프로젝트 전체 내용은 보존됐다. 기본 998개 회귀, type/lint/build, production Chrome/Edge의 실제 재생·믹서·transport·다운로드와 PCM 대조를 수행했다. 새 build ID는 `-_83F5zXnvwJ1UN2_F4Jt`이며 상세 경로·수치·검증 한계는 [PLAYBACK_AUDIO_V1.md](PLAYBACK_AUDIO_V1.md)에 기록한다. 아래 사람 평가 미실행 기록은 그 당시 상태로 보존하며, 수정 후 청감은 아직 재평가하지 않았다.

## 2026-09-12 로컬 시험판 최종 안정화

**LOCAL_TRIAL_READY / HUMAN_EVALUATION_NOT_RUN.** 이 절은 아래 `LOCAL_TRIAL_PARTIAL` 기록의 유일한 주요 기술 blocker였던 브라우저 재시작 후 다운로드 종료를 별도 원인 분리하고, 같은 제품 코드로 전체 회귀와 최종 production build를 다시 검증한 결과다. 시작 상태는 `codex/harmonymaker-source-boundary-v1`, HEAD `b074a475abe4a5a873eac8f11e2883b04680dcda`, 깨끗한 작업 트리였고 제품 코드는 계속 **`33c56ae3b713d520573a508a86938977669218d6`**이다. 이번 안정화에서는 제품 코드를 바꾸지 않았다.

다운로드 종료는 HarmonyMaker의 Blob/ObjectURL helper가 아니라 Playwright `launchPersistentContext` 기동 경로로 분리됐다. Chrome 152.0.7977.83과 Edge 152.0.4191.66에서 새 전용 프로필은 26바이트 text, 22바이트 JSON, MusicXML 11,755바이트, workspace 약 806KB, project 약 956KB를 모두 받았지만 같은 프로필을 그 API로 다시 열면 첫 26바이트 text부터 native 종료했다. headless와 창 모드가 같았고, Blob/ObjectURL과 메모리에서 바로 응답하는 same-origin POST attachment도 같았다. 따라서 MIME·파일 크기·Content-Disposition·URL 해제 시점이나 앱 상태가 원인이라는 가설은 배제됐다.

같은 설치 브라우저 실행 파일을 전용 `--user-data-dir`과 loopback CDP 포트로 직접 기동하고 연결하면 Chrome과 Edge 모두 fresh/reused에서 위 5종 파일을 전부 내려받아 SHA-256까지 일치했고 browser process 종료 코드는 0이었다. 이 직접 기동 방식으로 최종 production build에서도 다음을 재검증했다.

| 검사 | 최종 안정화 결과 |
|---|---|
| 타입 / 전체 lint | PASS. 각각 종료 0. lint 첫 시도의 `.pytest_cache` ACL 중단은 같은 명령을 읽기 제한 밖에서 재실행해 PASS했으며 파일이나 권한을 바꾸지 않음 |
| 기본 / private 회귀 | 104파일 992개 기본 PASS, 보존 자료 사본의 3파일 5개 private PASS. 합계 107파일 고유 997개 |
| PostgreSQL | PostgreSQL 17.11 전용 설정 4파일 39개 PASS. 실제 PostgreSQL 경로 37개와 Memory 비교·환경 문자열 보조 검사 2개를 구분. 남은 `hm_%` 스키마 0, task-owned 서버 종료 |
| production build | PASS. Next 16.3.0 기본 build, 17개 정적 페이지, build ID `fEJihGtdVIBpRhK2MxmCX` |
| Chrome / Edge A 전체 UI | 최종 build에서 수정 전 `independent-a.review.json`부터 각각 67단계 PASS. Source·WAG·악보·WebAudio·저장·새로고침·workspace/project/MusicXML 실제 다운로드 포함 |
| 같은 프로필 재시작 | Chrome/Edge 각각 9단계 PASS. 프로젝트와 revision 20 초안 복구, project/workspace JSON 재다운로드 및 최초 canonical 내용과 일치 |
| 파일 재입력 | 별도 새 Chrome 프로필 9단계 PASS. 최종 project·workspace·MusicXML을 실제 UI로 재입력. Source 30음표, MusicXML 두 성부 60음표 확인 |
| 호환·차단 | 최종 build에서 구형 project·XML/MXL 및 손상 거절 15단계, JPEG/B/C 보존·차단 27단계, 두 pitched 성부 보존·한 Lead 투영·stale 표시 45단계 모두 PASS |

두 브라우저의 Source 30음표·D minor·점4분음표 60·WAG 음악 결과는 같았고, 내보낸 MusicXML의 두 성부 60음표도 재파싱해 같음을 확인했다. Play/Pause/Resume/Reset의 실제 AudioContext 연결과 비영 PCM은 통과했지만 음악적 자연스러움이나 가창 적합성의 사람 청감 증거는 아니다.

자동 사용성 감사에서 저장 완료와 revision, 현재/원본 상태, Source 확정 다음 동작, 프로젝트에 포함된 snapshot과 별도 초안의 관계는 화면에서 확인 가능했다. 67단계 동안 필수 입력을 다시 입력하게 하는 경로는 없었다. 긴 교정 화면과 일부 영어 진단 용어는 남은 마찰이지만 이번 범위에서 조치가 불명확한 blocker나 데이터 손실로 재현되지 않아 UI 코드는 바꾸지 않았다.

이 판정은 설치된 Chrome/Edge를 일반 실행 경로로 사용하는 로컬 시험판의 기술 상태다. `launchPersistentContext` 재사용은 이번 환경에서 실패하는 검증 harness 경로이므로 최종 브라우저 증거에 사용하지 않는다. 사람의 화면 이해·가창·스피커/헤드폰·물리 iPhone 평가는 미실행이다. OMR/homr/Audiveris 재실행, JPEG/C 복원, 3/4·tuplet 지원, 외부 공유·push·원격 CI·배포·승격·병합은 수행하지 않았다.

## 2026-09-12 후속 로컬 시험판 검증

**LOCAL_TRIAL_PARTIAL / HUMAN_EVALUATION_NOT_RUN.** 이 절은 아래 선행 `BOUNDARY_V1_VERIFIED` 기록 이후 실제 수행한 검수·실행 결과다. 시작 브랜치는 `codex/harmonymaker-source-boundary-v1`, HEAD는 `143f9dd4739d145c30a13dccdf61cf3a26e5b638`이며 작업 트리는 깨끗했다. 첨부 문서와 이 저장소 문서도 당시 SHA-256이 같았다. 기존 작업과 원본·이전 증거를 보존했다.

검증 제품 코드 commit은 **`33c56ae3b713d520573a508a86938977669218d6`**이다. 그 뒤의 이 문서 갱신은 문서 전용 commit이며 build/실행 코드와 구분한다.

| 검사 | 이번 실행 결과 |
|---|---|
| 직접 코드·계약 검수 | PASS. 새로운 반례로 아래 결함을 재현·수정. 외부 독립 감사는 수행하지 않음 |
| 타입·전체 린트 | PASS, 각각 종료 0 |
| 전체 기본/private | 104파일 992개 기본 PASS. 최초 경로 조건으로 건너뛴 3파일 5개를 실제 보존 자료 복사본으로 모두 후속 실행해 PASS. 합계 107파일 고유 997개. 실제 UI 다운로드를 읽는 관련 2개 재실행도 PASS이며 고유 수에 중복 합산하지 않음 |
| PostgreSQL | 실제 PostgreSQL 17.11 DB 시험 37개 PASS. 별도 Memory 비교 1개·환경 문자열 검사 1개를 포함한 전용 설정 총 39개 PASS. 시험 DB/스키마만 사용, 종료 후 남은 시험 스키마 0개 |
| production build | PASS. 기본 `next build`, 종료 0. build ID `DAk-neBCM3KUq1sH4qBb2` |
| production A 일반 UI | 새 Chrome 152.0.7977.83 / Edge 152.0.4191.66 프로필에서 수정 전 A부터 각각 67단계 PASS. 실제 최초 다운로드·파일 재입력·Play/Pause/Resume/Reset 포함 |
| 서버·브라우저 재시작 후 읽기 | PASS. 같은 Chrome 프로필·origin에서 프로젝트 및 revision 20 초안 복구, 출처·현재 입력 일치 확인 |
| 재시작 뒤 JSON 재다운로드 | **BLOCKED_ENVIRONMENT — 실제 브라우저 시험은 FAIL.** 새 전용 프로필 재사용에서도 Chrome/Edge native 종료 `3221225477` 재현. Chrome의 앱·악보 없는 약 950KB JSON Blob도 동일 종료. 작은 plain text는 PASS. 해결 미확정 |
| 호환·차단 | 구형 정상 v9 프로젝트·XML/MXL 및 손상/revision 거절 15단계 PASS. 두 pitched 성부 보존·한 Lead 투영·선택 변경 후 이전 결과 표시 45단계 PASS. JPEG/B/C 저장·복구·차단 27단계 PASS |

실제 수정:

1. Lead와 다른 보표의 리듬 4개를 선택했는데 기존 투영이 이를 0개로 누락하면서 Source가 승인되는 반례를 재현했다. `src/import/workspace/review.ts`에서 기존 엔진의 같은 파트·보표 조건을 적용하고 `projection.ts`에서 선택 이벤트 전체 대응을 검사한다. 지원을 확대하거나 슬래시에 pitch를 만들지 않았다.
2. 공유 권리 확인 함수가 확정 Source의 권리만 바꿔 proof와 불일치하고 프로젝트 export가 `PROJECT_INTEGRITY_INVALID`로 실패하는 것을 재현했다. `src/product/practice-share.ts`, `src/app/workspace/WorkspaceClient.tsx`에서 1회 compact 공유 확인을 불변 Source와 분리했다. 원본·전체 proof는 공유 payload에 포함하지 않는다. 실제 외부 공유는 만들지 않았다.
3. 빈 브라우저에서 프로젝트 가져오기 UI에 접근하지 못하고 기존 화면의 가져오기가 현재 프로젝트를 교체하는 경로를 수정했다. `ProjectLibrary.tsx`, `WorkspaceClient.tsx`, `src/app/page.tsx`와 `local-project-store.ts`의 atomic `saveNew`로 새 사본을 저장한다. 기존 결과 재사용 때 Source 일치도 검사한다. 새 프로필의 포함 snapshot 표시와 초안 파일 별도 복구를 실제 확인했다.

추가 회귀는 `src/import/workspace/workspace.test.ts`에 있다. Source v9 음악 구조·WAG·인식기·provider·secret·quota·Next 설정은 바꾸지 않았다. 해시 재계산 가능성과 Source/proof 구조 일치 요구를 구분하며, 해시를 음악/권리 진술의 인증 서명으로 취급하지 않는다.

원본 A 이미지를 이번에도 직접 열어 대조했다. 원래 30개 음표, 코드·시간축, D minor, 점4분음표=60을 유지했고 음표 수정 명령은 0건이다. 생성 성부 30개 표기 음표 / tie 연속 14개 / 재생 attack 16개를 구간별 pitch·시간·재발음 경계와 대조했다. 24 quarter = 16초이며 Play와 Resume에서 각각 실제 WebAudio 비영 신호를 관측했다. 이는 청감 평가가 아니다.

최초 현재 자원은 가용 RAM 약 0.36GiB, C: 여유 약 9.8GiB였다. 무거운 검사를 순차 실행했고 기존 의존성·PostgreSQL 실행 파일만 재사용했다. 이번 작업 소유 DB/스키마만 생성·시험·종료했으며 기존 사용자 DB를 초기화하지 않았다. 작은 build heap 제한, dev cache 옵션의 production 적용, 필수 환경 검사 우회, production Memory fallback, 캐시 삭제는 없었다. 기존 manifest 329개 파일과 인계 산출물 10개는 종료 시에도 모두 동일했다.

실행은 저장소에서 다음 명령을 사용했다. 시작 후 주소는 `http://127.0.0.1:3196/score-workspace`, 프로젝트 파일 열기는 `/workspace`다.

```powershell
Set-Location -LiteralPath 'C:\Users\eccto\Documents\Codex\2026-09-07\files-pasted-by-the-user-harmonymaker\work\HarmonyMaker'
$env:NEXT_TELEMETRY_DISABLED='1'
node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3196
```

새 설치 없이 사용하는 실제 안내·수정 전 A·최종 초안·최종 프로젝트·편곡 MusicXML·검증 manifest/로그는 다음 로컬 인계 폴더에 구분해서 보존한다.

`C:\Users\eccto\Documents\Codex\2026-09-12\head-docs-implementation-source-boundary-v1\outputs\HarmonyMaker-local-trial`

`시작안내.md`는 사용자 실행 절차이고 `검증보고서.md`와 `verification/`은 상세 검증/실패 증거다. `delivery-receipt.json`은 후속 문서 commit과 최종 서버 상태를 기록한다. 초안과 프로젝트 JSON은 원본/proof 복구용이고 편곡 MusicXML은 선택 Lead/생성 성부의 음악 교환용이다. 과거 `1c7569e` reader의 출처 enum은 새 출처를 받지 않으며, 이를 manual/musicxml/omr로 거짓 변환하지 않는다.

재시작 후 JSON 다운로드 문제는 과거 프로필에만 남은 문제로 축소하지 않는다. 이번 새 시험 프로필에서도 재현되므로 기술 판정을 PARTIAL로 제한한다. 저장본 읽기와 최초 다운로드 성공까지 실패로 합치지도 않는다. 인간의 화면 이해·가창·청감·물리 iPhone 평가는 미실행이다. JPEG/C 자동 완전 복원과 3/4·tuplet·임의 다성부 동시 편곡은 미지원/미해결 상태를 유지한다. 실제 OMR 호출과 앱의 음악 자료 외부 전송은 0회, push·원격 CI·배포·승격·main 병합은 미실행이다.

## 선행 단계 기록 — 당시 구현과 검증

2026-09-12. 사용자가 승인한 제한적 계약 변경이다. 출발점은 로컬 `508fb276f915b94b3a1a177b2766b75eb742eaf8`이며, `8170504` 시제품과 원격 `1c7569e`를 모두 포함한다. 시작 시 미커밋 변경은 없었다. 로컬 작업 브랜치는 `codex/harmonymaker-source-boundary-v1`이다. push·배포는 범위 밖이다.

## 유지하는 계약

- 원본 이미지·XML·인식 근거·실패·구형 교정 이력은 불변 자료다. 파일 무결성과 음악의 정확성은 다르다.
- Fraction, 명시적 note/rest/rhythm, Source/생성 성부 분리, 권리·음역·구간 확인, 기존 Source integrity와 WAG 검증을 유지한다.
- 현재 계획 엔진의 2/4·4/4·6/8 및 grouping 지원을 사용한다. 3/4·tuplet·새 가사/코드 정책을 지원했다고 확장하지 않는다.
- 로컬 OMR은 외부 provider 성공이나 직접 MusicXML 입력으로 위장하지 않는다.

## 변경하는 계약

| 기존 동작 | 새 책임 | 근거 |
|---|---|---|
| 불완전 XML은 복구 편집기, 유효 XML은 임시 Review로 갈라짐 | 기존 importer/recovery를 입구로 재사용하고 영속 악보 작업 공간에서 현재 교정 상태를 관리 | 음악 검증 실패와 초안 저장 실패를 분리 |
| XML 생성·재파싱을 편집기 간 상태 전달로 사용 | 입출력에서만 XML을 해석하고 일반 교정은 Fraction을 가진 내부 상태에 적용 | 직렬화 기본값·GRID64가 사용자 결정을 바꾸지 않도록 함 |
| 구조 수정 때 전곡 coverage 삭제 | 대상과 실제 의존 문맥의 fingerprint에 확인을 연결 | 무관한 확인 유지와 stale 확인 거절을 함께 만족 |
| 원본 성부를 Source에 전부 수용해야 진행 | 원본 전체를 보존하고 별도 편곡 요청에서 Lead/리듬 선택 | Source는 엔진 입력 투영이며 범용 악보 보관 모델이 아님 |
| mode 누락을 major로 해석한 값과 원본 mode가 같은 수준 | 관찰 fifths·명시 mode·수입 추정·사용자 문맥 확인을 구분 | A의 상대 조성 확인을 허위 조바꿈으로 만들지 않음 |
| Quick Review tempo/설정이 새로고침으로 유실 | 교정·요청·확인·이력을 프로젝트 생성 전 저장 | IndexedDB transaction과 revision 비교로 낡은 저장 거절 |

작업 공간 snapshot과 요청을 검사하는 투영 계층이 기존 Quick Review/Source/WAG를 호출한다. 불완전 초안을 WAG에 전달하지 않는다. Source provenance에는 버전이 있는 작업 공간 출처·revision·선택·대응을 기록한다. 원본 mode나 실제 조성 변화는 일괄 전역 교정으로 없애지 않는다.

미확정은 대상·종류·범위·근거·요구 조치·판단 기록을 갖는다. 보기/교정/초안 저장은 음악적 미확정으로 막지 않는다. 선택에 미치는 영향이 불명확하면 편곡을 막는다. 알려진 다른 성부의 국소 표기와 영향 불명인 곡선은 같은 규칙으로 무시하지 않는다. 외부 severity/eligibility 값을 승인 권위로 사용하지 않는다.

## 호환 방법

기존 `/import` 및 프로젝트 경로를 유지한다. 새로운 진입은 같은 앱에서 제공한다. 구형 recovery bundle을 읽을 때 먼저 기존 replay/해시/이미지 검사를 실행하고 새 작업 공간을 만든다. 구형 원본 bundle과 이력을 그대로 보관하고 ID 대응을 남긴다. 구형 DB나 파일을 덮어쓰지 않으며 465건 이력을 새 자동 후보에 적용하지 않는다.

기존 Source v9의 음악 구조와 WAG 알고리즘은 유지한다. 로컬 출처와 투영을 정직하게 표현하기 위한 ImportInfo의 최소 버전 계약만 추가한다. 구형 출처 검증은 그대로 둔다. 새 출처는 별도의 검증을 요구한다.

## 검증 기준과 시작 증거

기준선에서 `quick-review/recovery/structural-recovery/local-candidate` 4파일 43테스트를 실제 실행해 통과했다. A의 기존 161조작 기록은 수정 전 동일 자동 후보에서 Source 이전까지의 실패 기록이다. 새 성공 경로 전체 조작 수와 그대로 비교하지 않는다.

완료 판정은 다음을 모두 실제 확인한 뒤에만 `BOUNDARY_V1_VERIFIED`로 바꾼다.

1. 수정 전 독립 A를 일반 UI에서 열어 원본 대조·코드/기호/조성/템포의 명시 교정·초안 저장/재개·Source·WAG·악보·오디오·프로젝트 복구·두 종류 내보내기를 수행하고 음악 내용을 대조한다.
2. 국소 코드 지속구간, tie 경계, 박자/분리/조성 문맥, Undo/Redo/reload, 근거 교체의 확인 유효성을 회귀로 검사한다.
3. 두 pitched 성부 보존과 하나의 Lead 투영, 정확한 유리수 보존과 엔진 미지원의 구분을 확인한다.
4. JPEG/B/C의 미지원·미확정 차단과 저장/재개, 구형 자료 및 정상 XML/MXL·프로젝트 호환, stale/concurrent/손상 입력 거절을 검사한다.
5. 타입·린트·관련 단위/통합·일반 브라우저 흐름을 실제 실행한다. 미실행·실패·범위 밖을 PASS와 분리한다.

시작 자원: RAM 약 8GB 중 가용 약270MB, C: 여유 약386MB. 기존 의존성을 재사용하고 무거운 실행은 순차 진행한다. Docker/OMR 재실행·사용자 파일 일괄 삭제는 하지 않는다.

## 선행 단계의 판정

**BOUNDARY_V1_VERIFIED — 로컬 1차 입력·교정 경계의 필수 검증 완료.** 자동 OMR 전체 완성·모든 브라우저 지원·출시 완료를 뜻하지 않는다. 기존 보고서의 PASS를 이번 실행의 검증으로 재집계하지 않았다.

## 실제 구현과 재사용 범위

| 책임 | 구현 파일 | 재사용·변경 |
|---|---|---|
| 안전한 원본 입력, 관찰 mode, 안정 ID | `src/import/musicxml/parser-core.ts`, `types.ts`, `src/import/workspace/input.ts` | XML/MXL 보안 파서와 구형 recovery replay 재사용. 음악적 불완전성을 보존하는 inspection 경로 추가. 기존 정상 importer는 계속 엄격하게 작동 |
| 한 현재 상태와 이력 | `src/import/workspace/model.ts`, `edit.ts`, `journal.ts`, `encoding.ts` | 기존 import 이벤트 모델과 Fraction 재사용. 일반 교정을 XML 왕복에서 분리. 명령·전후 digest·대상·사유·시각·작성 주체를 저장 |
| 국소 검토와 기능별 조건 | `src/import/workspace/review.ts` | 코드 지속 구간, 상속 문맥, tie 양쪽 경계, 절대 시작 시간을 fingerprint에 포함. 무관한 대조는 유지 |
| 영속 초안 | `src/import/workspace/store.ts` | 별도 IndexedDB `harmonymaker-score-workspaces-v1`. 기존 프로젝트 DB는 보존. transaction 완료 후 성공 표시, CAS와 이력 접두부 검사 |
| 요청→Source와 출처 | `src/import/workspace/projection.ts`, `source-integrity.ts`, `src/import/review/finalize.ts`, `src/domain/source/model.ts`, `validation.ts`, `src/domain/omr/import-identity.ts` | 선택한 snapshot을 기존 Quick Review/최종 Validator로 전달. 새 출처에는 proof 재생·재투영 검사를 반드시 적용 |
| 일반 UI | `src/app/score-workspace/`, `src/app/page.tsx`, `src/app/import/page.tsx` | 기존 앱에 진입점 추가. 기존 원본 근거 뷰어, 음역·권리 폼 재사용. 페르마타만 제거하는 제어와 요청/교정 자동 저장 추가 |
| 결과와 내보내기 | `src/app/workspace/WorkspaceClient.tsx`, `src/product/musicxml-export.ts` | 기존 WAG·악보·WebAudio·프로젝트 저장/전송 재사용. 결과에 입력 revision·선택·범위 표시, MusicXML에도 선택 범위 메타데이터 추가 |

Source v9 음악 구조는 바꾸지 않았다. `ImportInfo.sourceKind="score-workspace"`와 `hm-workspace-projection-v1` 메타데이터를 추가했다. 출처, 원본/요청 digest, 입력 revision, 보존/선택 성부, 작업 공간→Source ID 대응, 검증 가능한 로컬 proof를 담는다. 이전 앱은 이 새 출처를 지원하지 않을 수 있으며, 직접 XML이나 provider OMR로 이름을 바꾸어 호환시키지 않는다.

v1의 Source는 확정 당시의 불변 입력 snapshot이다. 입력 교정은 악보 작업 공간에서 재개하며 새 revision은 별도 프로젝트로 저장한다. 기존 생성 성부 편집은 유지한다. WAG, performance expander, 원래 Source의 권리·범위·시간축 검증은 교체하지 않았다.

`historyDigest`는 명령과 메타데이터의 변경을 검사한다. 음악 state digest와 별개이며 전자서명이나 사람의 판단 정확성 인증은 아니다. 원시 XML과 구형 bundle의 문자열은 NFC로 고쳐 쓰지 않는다. 내보낸 proof는 ASCII escape를 사용해 기존 프로젝트 canonical JSON의 문자열 정규화에도 원시 자료가 유지되게 했다.

## 독립 A의 실제 실행

최종 주 시험은 보존된 수정 전 `independent-a.review.json`에서 새 작업 공간을 만들었다. 일반 UI의 **대조 원본 전체 열기**로 원본을 표시하고, 다음 결정을 정상 교정/요청 폼으로 입력했다.

- 마지막 마디 Dm 추가, 잘못된 페르마타만 제거. 음표 삭제·교체·재입력 명령은 **0건**이며 기존 음높이·길이·ID를 보존했다.
- 관찰 조표는 보존하고 해당 문맥 D minor를 확인했다. 템포는 원본의 **점4분음표=60**, 즉 quarter BPM=90을 명시적으로 입력했다. 자동 인식 성공으로 집계하지 않는다.
- Lead, 시험용 두 가수 음역, 전곡 구간, 독립 fixture 사용 권리와 8마디 대조 및 별도 미확정 항목을 명시했다. `actor=ui-test`로 기록하며 사용자의 실제 권리/음역 승인으로 취급하지 않는다.
- 프로젝트 생성 전 초안 저장·새로고침 후 revision 20의 요청·음악·확인을 복구했다.
- 기존 최종 Validator→Source→WAG→악보→Play/Pause→프로젝트 저장·새로고침→프로젝트와 MusicXML 다운로드를 모두 실행했다.

최종 주 시험 `a-delivery-v1.report.json`은 61개 드라이버 단계가 완료됐으며 브라우저 JavaScript 오류와 차단된 외부 요청은 0이었다. DOM/DB의 완료 상태나 정답 Source를 주입하지 않았다. 사용한 로컬 자동 후보 묶음은 원본과 동일하다.

검증은 파일 존재 확인에 그치지 않았다. 독립 원본 이미지의 30개 음표·onset·길이·코드 관찰을 Source와 비교했고, 생성 성부를 render 문서·재생 계획·MusicXML의 pitch/onset/duration/tie와 대조했다. 프로젝트 저장 전후 canonical export도 일치했다. 템포에 따른 길이는 24 quarter, 16초다. 실제 AudioDestination에 연결된 WebAudio에서 48kHz, 비영 파형 peak 약 0.028을 관측했다. AudioContext나 출력 데이터를 mock하지 않았다. 스피커 청감 평가는 하지 않았다.

동일 코드의 `a-browser-restart-v1.report.json`에서는 별도 브라우저 프로세스를 다시 열어 프로젝트와 대응 초안의 revision 일치, 편곡 가능 상태까지 재확인했다. 이 재시작 시험은 최종 주 시험 직전의 같은 sealed v1 생성본으로 수행했다.

## 설계 문제별 검증

| 항목 | 실제 확인한 결과 |
|---|---|
| 조성 | mode 없음/명시 major/명시 minor 구분. A D minor 정상 통과, 실제 다른 문맥의 조바꿈은 차단. 구형 serializer가 생략한 명시 minor는 불변 XML에서 복원 |
| 초안 저장 | UI 저장·새로고침, 브라우저 재시작 복구. CAS 경쟁에서 한 저장만 성공. 합성 quota 쓰기 실패 뒤 이전 저장본 유지, 손상된 저장 bytes 거절 |
| 국소 대조 | 코드 수정이 지속 구간만 무효화. tie 양쪽, 박자 후속 시간축, 마디 분리 의존 범위 검사. Undo/Redo/reload와 제목 변경도 확인 |
| 성부 보존 | 별도 작성한 지원 박자 fixture의 두 pitched 성부를 보존하고 하나만 Lead로 투영. workspace export는 양쪽을 유지하고 결과 MusicXML은 선택/제외 성부와 전곡 범위를 명시 |
| 시간·결정성 | 1/3 Fraction 보존. 보존 가능한 tuplet을 WAG 지원으로 승격하지 않음. 다른 작업 공간 ID·파일명·XML 공백에서도 같은 음악 Source digest와 WAG 결과 |
| 미지원 사전 안내 | B의 3/4를 초기 UI에 표시. 이를 4/4로 바꾸지 않음 |
| 미확정 차단 | JPEG/B/C 모두 보기·교정·초안 저장/복구 가능, 편곡은 차단. 영향 불명 곡선과 누락 후보를 자동 승인하지 않음 |
| 구형 호환 | 실제 구형 465건 replay 및 새 변환 round trip. 3개 원본 문서, 39마디, 284이벤트의 ID 대응 유지. 새 A에는 이 이력을 적용하지 않음 |
| 출처·보안 | 원본/명령/메타데이터 바꿔치기, stale revision, proof와 Source 내용 불일치, XML entity 등 거절. 기존 XML/MXL·project 회귀 유지 |

JPEG/B/C는 정상 UI에서 각각 저장·새로고침·workspace 다운로드를 수행했다(`preserved-ui-fresh-context-v1.report.json`, 27단계 완료). 내보낸 자료도 실제 코드로 재읽어 입력 묶음과 미확정 상태를 비교했다. JPEG 163, B 18, C 36개의 최초 차단 항목이 유지됐으며 이것은 오류 개수나 인식 정확도 점수가 아니다. JPEG의 자동 가사 후보 104개는 확인된 가사 104개가 아니다. 세 입력의 새 대조 기록은 0개다.

별도 private 검사는 실제 원본을 사용하지만 원본 XML·이미지·전체 이력을 저장소에 넣지 않는다. 공개 회귀는 코드 안에서 별도로 작성한 작은 음악 fixture를 사용한다.

## 실행한 검사와 증거

최종 타입 검사와 전체 린트는 종료 코드 0이었다. 전체 기본 회귀는 **105파일, 989테스트 통과 / 자료 경로 조건으로 2파일·2테스트 건너뜀**이었다. 건너뛴 기존 `app-import.test.ts`와 `review-handoff.test.ts`도 보존 자료의 별도 복사본으로 이어서 실행해 **2파일·2테스트 통과**했다. 합계는 **107파일의 고유 테스트 991개 통과**다. 새 경계 공개 회귀 16개, 최종 실제 산출물/원본을 읽는 private 회귀 3개가 포함된다. 기존 보고서를 덮어쓰지 않도록 이 두 호환 시험의 출력은 `compatibility-delivery-v1/`에 저장했다.

아래 명령으로 전체 기본 테스트와 이번 private 3개 시험을 함께 실행했다. PostgreSQL 전용 통합 테스트는 별도 설정에서 제외되는 서버 인프라 시험이며 이번에는 실행하지 않았다. 프로덕션 build·원격 CI·배포도 실행하지 않았다.

실제 사용한 환경은 Node 22.23.2, Next 16.3.0, React 19.2.8, Vitest 4.1.10, 설치된 Chrome 152.0.7977.83, 번들 Playwright 1.62.1이다. 새 패키지·브라우저를 설치하지 않았다.

```powershell
node --max-old-space-size=768 node_modules/typescript/bin/tsc --noEmit
node --max-old-space-size=768 node_modules/eslint/bin/eslint.js .
# 아래 세 경로는 이 노트북에서 실제 사용한 보존 자료다.
$env:HM_BOUNDARY_PRIVATE=(Resolve-Path '..\source-boundary-v1-2026-09-12.private').Path
$env:HM_BOUNDARY_INPUT='C:\Users\eccto\Documents\Codex\2026-09-09\files-pasted-by-the-user-harmonymaker\work\candidate-review-burden-2026-09-12.private'
$env:HM_BOUNDARY_LEGACY='C:\Users\eccto\Documents\Codex\2026-09-09\files-pasted-by-the-user-harmonymaker\work\structural-recovery.private\latest-recovery-bundle.private.json'
node --max-old-space-size=768 node_modules/vitest/vitest.mjs run --maxWorkers=1 --no-file-parallelism --reporter=dot
```

공개 경계 회귀 파일은 `src/import/workspace/workspace.test.ts`, 비공개 파일을 읽는 opt-in 검사는 `experiments/homr-integration/boundary-private.test.ts`, 일반 UI 시험 드라이버는 `experiments/homr-integration/boundary-ui.cjs`다. 기존 테스트를 삭제하거나 성공하도록 expected 음악을 바꾸지 않았다.

UI 재현은 아래 개발 서버를 먼저 켠 뒤 `HM_BOUNDARY_PRIVATE`를 위처럼 설정하고 실행한다. 별도 `HM_BOUNDARY_PROFILE`이 없으면 새 임시 시험 세션을 쓴다. 주 시험의 UI 입력 JSON은 원본 판독 후 기록한 명시적 시험 결정이며, 사람의 판단을 자동화했다고 주장하지 않는다.

```powershell
$env:NODE_PATH='C:\Users\eccto\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules'
$env:HM_BOUNDARY_BROWSER='chrome'
node experiments/homr-integration/boundary-ui.cjs "$env:HM_BOUNDARY_PRIVATE\a-delivery-v1.json"
```

화면을 직접 연 확인 범위는 원본 전체, 초기 후보/차단, 페르마타 제거 후 3마디, Dm 추가 후 마지막 마디, 초안 복구, 생성 악보/재생, 프로젝트 복구, B/C/JPEG 초기 차단 화면이다. 열어보지 않은 모든 UI 조합이나 전체 브라우저 지원을 검수했다고 주장하지 않는다.

비공개 증거 루트는 저장소의 형제 폴더 `../source-boundary-v1-2026-09-12.private/`다.

- 최종 초안: `a-corrected.workspace.json`
- 최종 결과: `a-project.harmonymaker.json`, `a-project-reloaded.harmonymaker.json`, `a-arrangement.musicxml`
- 실제 음악 대조: `a-content-verification.json`, `a-original-observation.json`
- JPEG/B/C: `*-ui.workspace.json`, `preserved-case-verification.json`
- 구형 변환: `legacy-conversion-verification.json`
- 보존: `preservation-before.json`, `preservation-after-final-v1.json` — 기존 329개 파일 SHA-256 일치
- 실행: `execution-delivery-v1.json`, `regression-delivery-v1.log`, 타입·린트 로그
- 추가 기존 호환: `compatibility-delivery-v1.log` 및 `compatibility-delivery-v1/`의 입력 복사본/결과
- UI: `a-delivery-v1.*`, `a-browser-restart-v1.*`, `preserved-ui-fresh-context-v1.*`, 화면 PNG와 자동화 동작 JSON
- 이전 개발 중 생성본은 `pre-seal-development-evidence/`, `sealed-integration-evidence/`, `release-restart-evidence/` 등에 보존했다. metadata seal 도입 전 임시 개발 형식은 최종 v1 복구 파일로 사용하지 않는다.

## 사용자 부담

조작의 단위는 이전 보고서와 같이 파일 선택·값 입력·선택 변경·버튼·체크·저장·새로고침이다. 탐색·읽기·assert·대기·오디오 관측은 별도로 집계했다.

| 범위 | 이전 A | 새 A |
|---|---:|---:|
| 시작 후보 | 동일 수정 전 자동 묶음 | 동일 수정 전 자동 묶음 |
| 실제 음악 내용 교정 | 3명령: 코드+음표 삭제/재입력 | 2명령: 코드+페르마타 직접 제거 |
| 성공한 UI 조작, 각 실행 전체 | 161 | 51 |
| 직접 문자열 입력 | 78 | 4 |
| 도달 지점 | 조성/영속성 제약으로 Source 이전 차단 | Source·생성·재생·복구·내용을 대조한 내보내기 |

새 실행에서 Source 이전 42조작 중 16개는 이전 시험에서 완료하지 못한 가수·구간·권리 설정이다. 원본 열기·핵심 교정·대조·초안 보존 범주는 26개, Source 확정부터 제품 내보내기까지 추가 9개다. 이전 161개에는 반복 구조/coverage 양식과 실패 마감 처리가 포함된다. **동일한 성공 종점을 가진 A/B 사용성 실험이 아니므로 감소율이나 시간 절감 효과를 계산하지 않는다.**

주 시험 자동화의 61단계와 사람의 조작/판단 시간은 다르다. 사람의 원본 판독·판단 시간은 미측정이다. 별도 시험 프로필의 브라우저 종료·재시도와 이전 드라이버 실패는 보존된 개별 로그에 남기며 주 시험의 음악 교정 횟수로 섞지 않는다.

남은 불편은 긴 한 화면, 최초 후보 근거와 현재 교정 상태를 구분해 읽어야 하는 점, 가수별 음역 입력, 명시적인 마디별 대조다. 음악적 확인을 자동 승인하여 숫자만 줄이지 않았다.

## 선행 단계의 개발 서버 실행 기록

이 절의 3195 개발 서버 명령은 이전 검증 기록이다. 현재 production 모드 로컬 시험판의 실행은 문서 첫 절과 인계 폴더의 `시작안내.md`를 따른다.

기준 HEAD `508fb276f915b94b3a1a177b2766b75eb742eaf8` 위에 로컬 브랜치 `codex/harmonymaker-source-boundary-v1`로 구현했다. 최종 additive commit은 제출 메시지와 `git log -1`로 확인한다. push·PR 업데이트·원격 CI·배포를 하지 않았다.

실제 사용한 경로와 실행 명령:

```powershell
Set-Location -LiteralPath 'C:\Users\eccto\Documents\Codex\2026-09-07\files-pasted-by-the-user-harmonymaker\work\HarmonyMaker'
$env:HM_LOCAL_NO_DISK_CACHE='1'
$env:NODE_OPTIONS='--max-old-space-size=640'
$env:NEXT_TELEMETRY_DISABLED='1'
node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3195
```

브라우저에서 `http://127.0.0.1:3195/score-workspace`를 연다. 최초 화면의 링크로 기존 Quick Review도 사용할 수 있다. 같은 브라우저·origin의 **저장한 초안**에서 재개하거나, 위 최종 `a-corrected.workspace.json`을 **작업 공간 파일 열기**로 불러온다. 프로젝트는 기존 프로젝트 가져오기로 `a-project.harmonymaker.json`을 연다. 새 브라우저에 초안이 없으면 프로젝트는 포함된 확정 snapshot임을 표시한다.

`HM_LOCAL_NO_DISK_CACHE`는 이 로컬 점검에서만 dev disk cache를 끄는 선택 옵션이다. 기본 설정·프로덕션 설정을 강제로 바꾸지 않는다. 실행했던 개발 서버는 마지막 검증 뒤 종료했다. 같은 노트북에서 무거운 검사와 브라우저를 동시에 과도하게 실행하지 않았다.

## 남은 제약과 별도 실패

- 자동 OMR 정확도를 개선하거나 재실행하지 않았다. JPEG의 전체 의미, C의 누락 슬래시·가사·성부, 미확정 곡선은 해결되지 않았다. 원시 자료 보존을 의미 복원으로 보고하지 않는다.
- 3/4·tuplet·임의 다성부 동시 편곡·복잡한 가사 편집·새 chord-gap 정책은 지원을 확대하지 않았다. 현재 투영은 전곡, 선택한 Lead와 같은 파트의 지원되는 리듬 입력/코드를 대상으로 한다. 별도 파트에만 코드 권위가 있는 경우는 보존·차단한다.
- 구형 이력의 교정 fifths와 불변 원본의 fifths가 다르면 두 값을 보존하고 경고·차단한다. 모순된 문맥을 임의로 유효 조성으로 승격하지 않는다.
- 시간축을 읽을 수 없는 표기는 원시 자료와 진단만 보관할 수 있다. 지원하지 않는 구조의 완전 편집 기능을 약속하지 않는다.
- 재사용한 Playwright 영속 프로필에서는 Chrome/Edge의 다운로드 중 native 종료를 관측했다. Chrome 종료는 작은 `about:blank` Blob 다운로드에서도 재현됐다(`browser-only-diagnostic.json`); HarmonyMaker나 악보 없이 발생한다. 원인/해결은 확정하지 않았다. 새 Chrome 세션의 실제 A 및 JPEG/B/C 다운로드와 재시작 시 저장본 읽기는 성공했다. 모든 브라우저/프로필에서 다운로드가 해결됐다고 보고하지 않는다.
- 중간에 C: 여유가 0바이트가 되어 검증이 중단됐고, 사용자가 공간을 확보한 후 재개했다. 재생성 가능한 Next 캐시만 지우려던 동작도 자동 승인 검토가 `blocked by policy`로 거절하여 실행하지 않았다. 다른 경로로 삭제를 우회하지 않았다.
- 신뢰 경계는 로컬 사용자 교정과 재현 가능한 무결성이다. 자체 해시는 사용자의 음악적 판단이나 권리 진술의 진실을 인증하지 않는다.
