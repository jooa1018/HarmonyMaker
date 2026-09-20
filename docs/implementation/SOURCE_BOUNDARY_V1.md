# 입력·교정·Source 경계 v1

## 2026-09-21 Review Usability & Persistence v1

**REVIEW_USABILITY_V1_PARTIAL.** 검증 제품 `4cda7f30bfd0a1944e913002c5952c6c5bc7dced`, 생성 타입만 후속 commit `67d14b20beb71d7696bab96fec60a9cfe9ad4982`, production build `.next-local-review-persistence-ui` / `mhlanvWsOaPHiccjrPJDP`다. 이 절의 후속 문서 commit은 검증 제품과 구분한다. 기존 r1019와 인계 manifest의 243개 파일을 보존했다. 새 OMR·음악 규칙·오디오/믹서 변경·외부 배포·삭제는 없다.

시작점 없는 slur stop을 앞 구간까지 확장한 의존 계산과, 원시 후보의 연결 근거 대신 document 음악 전체에 의존한 대조 fingerprint가 이전 36마디·439 전역 issue 재확인의 원인이었다. v3는 원본 provenance에서 필드·이벤트·대안 부착·구간 의존성을 재생성하고 실제 연결 범위만 무효화한다. 모호하거나 알 수 없는 대안은 보수적 범위를 유지한다. 유지한 검토의 actor·시점·원래 범위를 새 승인으로 바꾸지 않는다.

별도 일반 UI 늦은 slur 반례 r543→r544에서 stale 음악은 p0m35 한 마디, pending 원시 issue는 8개로 줄었다. 기존 대조 레코드 524개가 유효하게 유지됐고 관계없는 다른 마디의 대조 무효화는 0이었다. 8개 중 7개는 부착 위치가 모호해 같은 마디에 보수적으로 남긴 항목이므로 모두 반드시 필요한 새 판단이라고 주장하지 않는다. 실제 UI Undo/Redo에서 0/0과 1/8이 복구됐다. 한 마디와 8개 issue만 재확인한 r555를 저장·재시작 복구하고 Source로 확정했다.

새 A 경로는 보존된 r0부터 같은 52개 음악 편집과 원본 대조 fixture를 `ui-test`로 일반 UI에 적용했다. 마디 대조 39명령, issue 대조 441명령, 요청 9·제목 1로 r542가 됐다. 441개 원시 기록은 329개 음악 질문으로 표시됐고 8개 원본 구역에서 명시적으로 선택·저장했다. 이력/원시 기록 삭제나 자동 승인이 아니다. A에서 slur를 대조 전에 넣은 효과와 B의 실제 dependency 개선을 구분하며 사람 시간은 측정하지 않았다.

매 중간 상태의 전체 seal 검증을 유지하면서 불변 canonical/UTF-8 segment와 대조 projection을 재사용했다. 명시적 batch는 개별 operation과 revision을 남기고 저장을 원자적으로 수행한다. project transfer는 정확한 파일 내용과 execution registry가 같은 검증 결과만 제한적으로 재사용한다. caller graph는 공유하지 않고 변경을 다시 검증한다. 객체별 attestation이 필요한 edited snapshot은 이 cache에서 제외했다. 기존 proof cache/입력/이력 한도는 늘리지 않았다.

실제 UI에서 소수 sourceBox를 정수 전용 codec에 넘겨 질문 표시가 실패하는 결함을 발견했다. r544 저장을 보존한 채 식별키에서 원래 좌표를 문자열로 표현하도록 고쳤고, 같은 프로필의 실제 복구·다운로드·Undo/Redo·Source 경로로 재검증했다. 음악·proof 조건을 완화하지 않았다.

타입·전체 lint, 기본 122파일/1,175시험, 관련 workspace 87시험(중복 합산 안 함), production build 종료0을 확인했다. 기존 opt-in 3파일/5시험은 SKIPPED이고 이번 실제 private r1019/늦은 수정/다운로드 검증과 별도다. PostgreSQL·새 OMR·전체 PCM 재실험은 해당 경로 변경이 없어 NOT_RUN. 설치 Chrome의 정상 Source→WAG complete→악보→mixer/Play/Pause/Resume/Reset→저장→실제 다운로드/재입력, 동일 profile/origin 서버·브라우저 재시작이 통과했다. 음악·가사·Source 음악 digest·선택 WAG 후보·710개 재생 계획이 기존 r1019와 같았다. 사람 청감은 `HUMAN_RECHECK_PENDING`이다.

동일 PC 최종 3회에서 r1019 cold 복구 7.11–9.57초, 초안 저장 2.50–2.70초, 프로젝트 복구 7.59–9.10초, 프로젝트 저장 0.68–2.06초, 프로젝트 내보내기 0.66–0.96초였다. r1019 파일 가져오기 9.81–10.85초와 프로젝트 가져오기 12.46–15.04초, 국소 변경의 1초 목표는 미달이다. 최초 proof 검증·정규화·직렬화와 main-thread 점유가 남았다. 측정 3회로 p95를 계산하거나 기준을 낮추지 않았다.

비공개 결과 루트는 `C:\Users\eccto\Documents\Codex\2026-09-12\head-docs-implementation-source-boundary-v1\outputs\HarmonyMaker-review-persistence-v1`다. `시작안내.md`, `실행-ui.ps1`, `검증보고서.md`, `summary.json`, `artifact-manifest.json`과 새 r542 초안/프로젝트/XML을 분리해 보존했다. 음악·원본·private proof는 저장소에 추가하지 않았다. 서버 주소는 검증한 `http://127.0.0.1:3203`이며 세션 이후 상시 실행을 보장하지 않는다. UI 전면 개편·OMR 정확도 개선·소량 교정 실용성·출시 완료 판정이 아니다.

## 2026-09-20 최신 자동 후보 교정·실사용 경로

**LATEST_CANDIDATE_ASSISTED_E2E_VERIFIED.** 이전 Ending Structure 실제 fresh job의 revision 0에서 시작했고, 이번 신규 OMR은 0회다. r551의 음악·Source·proof·교정/대조 이력을 가져오지 않았다. 실제 원본을 대조한 agent의 일반 UI `actor=ui-test` 결정이며 사용자 본인의 독보·가창 능력 확인이 아니다. 최종 작업 공간은 revision 1019다.

음악 편집은 52명령(코드 추가 12, 가사 이벤트 교정 39, 빠진 slur 시작점 1)이다. 가사 순변화는 토큰 추가 31·제거 1·문자 5·extend 2다. 자동 후보와 기준본의 다섯 pitch 차이는 직접 원본 판독 후 자동값을 유지하고 별도 private 정오표로 남겼다. 285이벤트의 pitch/kind/onset/duration/voice/tie, 39구간의 박자/extent와 기존 51코드는 유지했다. 비선택 원본 성부도 보존했다. 초기 499항목은 음악 오류 수가 아니며 불변 관측과 중복 근거·요청을 포함한다. 원시 status/issue는 수정하지 않고 현재 대조와 연결했다.

실제 누적 대조 명령 957(마디 음악 75, issue 882), attestation 기록 1042, 요청 설정 9·제목 1, 관측된 세부 UI 명령 하한 546이다. slur 수정 뒤 무효화된 36마디와 문서 의존 439항목을 다시 확인했다. 여러 기록을 한 음악 사실로 합치거나 확인 부담을 1클릭으로 축소하지 않았다. 과거 551operations와 감소율을 비교하지 않는다. 사람 시간은 **HUMAN_TIME_NOT_MEASURED**, 청감은 **HUMAN_RECHECK_PENDING**이다.

최소 제품 변경은 두 가지다. `3034ec8`은 과도한 개별 입력을 실제 재현한 후 원본 구역·현재 음악·개별 대상/근거를 함께 보여주는 명시적 묶음 대조를 연결했다. 기존 개별 attest/revision과 원자적 저장을 사용하며 승인·무효화 규칙은 유지한다. `6acd763d7130b47cbfd300d7a7738261d488a30c`는 긴 대조 이력의 proof가 기존 재사용 한도를 넘어 반복 검증되는 실행 지연을 재현한 뒤 단일 private 검증 캐시 상한만 800만→1600만 문자로 조정했다. 정확한 텍스트 일치·변조 격리·64MB 입력/2048이력 한도는 유지했다. 최초 이력 재생과 보수적인 문서 범위 재대조 부담은 남는다. OMR/WAG/renderer/mixer와 Source 승인 조건은 바꾸지 않았다.

최종 제품에서 타입·전체 lint, 기본 120파일/1157시험, 관련 37시험(중복 합산 안 함), production build가 통과했다. 기본 실행의 선행 opt-in private 3파일/5시험은 SKIPPED이며 이번에 재실행하지 않았다. 대신 이번 실제 최신 후보의 원본 대조·production UI·파일 의미·native PCM 증거를 별도로 보존했다. PostgreSQL과 새 OMR은 미변경 경로로 NOT_RUN이다. build `.next-local-assisted-proof`, ID `C70EZEa3Fejj4USJ8Du10`; 생성 타입 HEAD `24c6cbf5d9c0cd566b8ac92c795434ea68074a58`과 이 문서의 후속 commit을 구분한다. 이전 build는 보존했다.

설치 Chrome 153.0.8010.48, `http://127.0.0.1:3203`에서 정상 Source, complete 1/partial 1 생성과 complete 선택, 악보, 실제 Lead/화음/Band 출력 및 제어, 전곡 재생, 저장/reload, 같은 profile/origin의 브라우저·서버 정상 재시작 복구, workspace/project/XML 실제 다운로드·일반 UI 재입력이 통과했다. 프로젝트 새 사본과 기존 프로젝트를 구분하며 파일 음악·요청·proof를 대조했다. XML은 Quick Review로 들어가고 새 권리/Source를 자동 승인하지 않는다. 실제 native PCM과 710개 발음 일정은 별도 프로젝트 유도 계획과 일치했다. 최초 오디오 관측은 favicon 404 때문에 전체 helper FAIL(PCM 항목은 PASS)이었고, 원인을 별도 기록한 동일 조건 재관측은 console/page 오류 없이 PASS였다. 사람 청감·물리 스피커 품질을 대신하지 않는다.

비공개 결과는 `C:\Users\eccto\Documents\Codex\2026-09-12\head-docs-implementation-source-boundary-v1\outputs\HarmonyMaker-latest-candidate-assisted-trial-v1`의 `시작안내.md`, `실행-최종.ps1`, `검증보고서.md`, `correction-ledger.json`, `burden-summary-final.json`, `Source-요청-provenance.json`, `artifact-manifest.json`에 있다. 음악/원본/private proof는 저장소에 추가하지 않았다. 서버는 재시작 가능한 명령을 제공하며 세션 이후 상시 실행을 약속하지 않는다. 초기 159개 인계 artifact 및 원본/r551 hash를 재확인했다. 소량 교정·짧은 사람 시간·OMR 무오류·모든 악보 지원·출시 판정이 아니다. 기존 데이터 삭제·push·PR·원격 CI·배포·병합은 하지 않았다.

## 2026-09-16 Ending Structure Recovery v1

**END_STRUCTURE_RECOVERY_V1_VERIFIED.** 제품 `15f74f59250b637c623db842b6203189a2d4ac09`, build 생성 타입 경로 보존 및 실제 UI HEAD `6e37273936e23248f95c19ba5b63b9df56a5d9b7`다. 이 절을 추가한 이후 문서 commit과 검증 제품을 구분한다. 전체 OMR 무오류나 새 Source/WAG 완료가 아니라 끝부분 역할·성부·시간·연결 복원의 검증이다.

원본 raster의 긴 slash edge, 독립 stem/beam/dot, hollow head, 두 성부의 정렬 column, raw token과 양쪽 곡선 endpoint를 결합했다. 흰 head 옆 다른 성부의 stem과 실제 아래 stem의 점2분음표를 구분한다. 기존 lyric 보완 뒤 `ending_structure.py`를 실행하고 기존 note ordinal/ID를 유지하며 새 glyph는 별도 계보로 append한다. 정확한 measure before/after·ID·삽입 근거를 검증한 후 그 변환을 역으로 벗겨 기존 raw→후보 검증도 실행한다. 코드·가사·박자·관련 없는 기호 변경은 허용하지 않는다. 후보를 사용자 대조 승인으로 바꾸지 않는다. 특정 입력 hash/파일명/마디 번호/목표 개수·길이 또는 교정본은 runtime 판단 입력이 아니다.

raw token 단계의 잘못된 pitch/trill, hollow head와 rhythm 역할 혼동, token→XML 단계의 상부 rest 소실 및 동시 성부 직렬 배치를 확인했다. 기존 이벤트 19개를 제한적으로 수정하고 원본에 있는 slash/rest 각 1개를 삽입했다. 삭제는 0이다. 원본의 점·beam 길이와 성부별 clock으로 overfull 5→0, fake pitched event 10→0, 끝부분 tie edge 5→6/6을 얻었다. 음표를 잘라 맞추지 않았다. 독립 A/B/C 검사에서 드러난 빈 점 탐색 영역의 OpenCV 오류도 보류 처리로 수정했다.

동결 `hm-omr-audit-v1.1`은 수정하지 않았다. 자동 출력 hash 고정 후 별도로 평가했으며, 새 ID의 대응은 기존 삽입 기록과 동일 원본 glyph 위치로 확인했다. 전곡 핵심 event 260→280/285, 끝부분 10→30/31, 전곡 onset 271→285/285, kind/duration/local onset/voice 각각 285/285다. FILE 총길이 124→122.5, APP 122.5 유지. FILE/APP의 구간 길이·시작·extent·박자는 각각 39/39. 기존 정답의 핵심 맞음→틀림 0, 코드값+위치 50/63, 가사 166/202·엄격 164/202와 CER 36/202를 유지했다. 기존 가사 배열/부착과 코드 record는 동일하다. 기준 pitch 차이 5개(끝부분 1개 포함)는 남기고 기준본을 고치지 않았다.

합성 픽셀 검출, 관찰값을 공급한 resolver, 실제 원본 근거 제거/충돌 반례를 구분했다. 실제 별도 A는 비회귀, B는 관련 구조의 안전한 보류, C는 점2분음표와 여섯 slash의 긍정 사례다. C의 누락 slash/동시 clock을 복원하고 나머지 음악·코드·가사를 보존했다. 개발 중 확인한 자료이며 unseen 성능으로 해석하지 않는다. 재적용 추가 변경 0, 표시번호/glyph ID/divisions 변화 불변을 확인했다. 기존 r551/A 프로젝트의 JSON·render·playback plan·MusicXML 해시는 이전 검증과 같다. WAG·재생·믹서·공통 parser·Source 승인 조건은 변경하지 않았다.

타입·전체 lint, 기본 119파일 1,152개, 별도 opt-in private 3파일 5개, Python 구조/가사/코드/시간축 61개, 프로젝트 보존 8검사와 production build(exit 0)가 통과했다. 기본 실행에서 건너뛴 5개는 opt-in 설정 후 별도로 통과했으며 재실행 수를 중복 합산하지 않는다. Build `.next-local-ending`, ID `smqdlSn4cdkyCPO_o4mP8`, Node 22.23.2, Chrome 153.0.8010.48, origin `http://127.0.0.1:3203`을 검증했다. 일반 이미지 UI에서 같은 JPEG의 새 homr 1회(cache false, actor ui-test)를 실행했고 약 193.532초, runner exit 0, job manifest 500파일 해시를 확인했다. offline hook가 socket 생성 1건을 차단했으며 외부 이미지 전송은 0회다.

원본/변경 근거와 끝부분 31개 event의 일반 편집 필드, 저장/reload, 실제 Chrome download/reimport, 같은 profile/origin의 Chrome와 서버 재시작 복구를 확인했다. 네 다운로드 SHA가 동일하고 revision/operations/attestations는 0이다. 505→499 진단을 음악 오류 수로 해석하지 않는다. 연결/후보 근거 대조와 사용자 요청 미설정, 남은 코드·가사·pitch 차이는 유지한다. 새 Source를 승인하거나 WAG를 실행하지 않았다.

시험 브라우저는 Browser.close, 서버는 원래 PTY Ctrl+C로 종료했고 소유 프로세스/3203 listener 부재를 확인했다. 최종 C: 16.25GiB, 가용 RAM 1,794MiB, commit 10.50/15.42GiB. 기존 데이터·모델·build·프로필은 삭제하지 않았다. PostgreSQL/원격 OMR은 미변경 경로로 NOT_RUN, 사람 평가는 HUMAN_RECHECK_PENDING이다. 과거 브라우저 프로필의 다운로드 장애가 해결됐다고 주장하지 않는다. push·배포·병합·원격 CI는 하지 않았다.

비공개 결과와 실행 안내는 `C:\Users\eccto\Documents\Codex\2026-09-12\head-docs-implementation-source-boundary-v1\outputs\HarmonyMaker-ending-structure-recovery-v1`의 `시작안내.md`, `실행.ps1`, `검증보고서.md`, `이벤트-대조표.md`, `artifact-manifest.json`에 있다. 실제 Chrome 다운로드 `ui-fresh-open/fresh-workspace.json`을 작업 공간 파일 열기로 가져온다. 원본·실제 음악·전체 proof는 저장소에 추가하지 않았다.

## 2026-09-16 Lyric Recovery v1.1 · 실제 신규 이미지 UI 검증 완료

**LYRIC_RECOVERY_V1_VERIFIED.** 제품 revision `10ae4a29035ff2f02635a7701bbf3184d4057cda`, 처리 `hm-lyric-recovery-v1.1`, 실제 실행 HEAD `6881882a5be6a48346ead9345a2eda0a67f4395f`다. 후속 승인 후 기존 build를 3202 production 모드로 실행하고 동일 JPEG의 일반 이미지 UI 신규 homr 1회(cache false)를 완료했다. 새 결과를 먼저 동결한 뒤 별도 평가기로 재계산했다. 가사/근거 표시, 저장/reload, 실제 Chrome 다운로드/재입력, 동일 profile/origin의 브라우저 프로세스 재시작 복구를 통과했다. 이 완료 단계에서 제품/알고리즘은 변경하지 않았으며 이후 문서 commit과 검증 제품을 구분한다. 자동 후보의 품질·보존·UI 경로에 한정한 판정이고 완성 Source나 가사 무오류를 뜻하지 않는다.

실제 raw word/symbol·후보 선출을 재구성하여 잔여 누락 64개를 좁혔다. 문자 후보가 선출됐지만 box/column 부착에서 소실 42개, 선출 confidence/좌표 경쟁 11개, 해당 위치의 원시 문자 판독 실패 5개, 원본 event column 미확정 6개다. 마지막 6개는 원본 글자가 없다는 판정이 아니다. 원본 잉크 간격으로 겹친 symbol box를 다듬고, 실제 음표 column 사이의 온전한 단일 글자 crop을 재판독한다. 새로운 셀 판독과 기존 row symbol 근거를 함께 요구하며 상관된 OCR 합의를 독립된 정확성 인증으로 취급하지 않는다.

기존 확실한 tie 경로를 유지하고 실제 가사 줄·시작/끝 glyph·동일 verse/staff/voice·시간 연속성·끝점의 문자 아닌 지속선 잉크에 근거한 별도 extend 경로를 추가했다. 다른 pitch에서도 처리한다. 기존 boolean 시작 표시와 endpoint 근거를 분리하며, 완전한 MusicXML start/stop span 지원을 주장하지 않는다. 공식 [extend 정의](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/extend/)와 [서로 다른 pitch 예제](https://www.w3.org/2021/06/musicxml40/musicxml-reference/examples/extend-element-lyric/)를 확인했다. 원시 자동 가사를 철회할 때는 해당 verse의 정확한 before 이력만 허용한다. 라틴 단어 box의 넓은 포함 관계는 새 부착 근거이며 기존 문자를 교체할 권위가 아니다. 실제 B 재적용에서 발견한 문자 교체 회귀를 이 구분으로 수정했다.

동결 `hm-omr-audit-v1.1`의 보존 raw 재처리 결과는 문자+부착+절+성부 **131→166/202**, precision **96.51%**, recall **82.18%**, F1 **88.77%**, 엄격 정확 **109→164/202**, 엄격 precision **95.35%**다. CER **68→36/202**(치환 5, 삭제 30, 삽입 1). 기존 정확 131개와 엄격 109개 손실 0, 중복 0. 기존 누락의 정확 복원 32개, 기존 문자 오류 수정 3개, 잘못된 지속선 판독의 안전한 보류 3개다. 새 오인식 1개가 있으며 최종 문자 오류 5개·기준 밖 출력 1개·누락 31개가 남는다. 기존 extend 불일치 23개 중 22개를 해결했고, 새로 복원한 가사의 잔존 불일치까지 포함하면 최종 extend 불일치는 2개다.

가사 제외 XML 전체, 283 event, 코드 51개와 근거, 시간축, APP 122.5/FILE 124 계약을 보존했다. 실제 APP 비가사 parts도 동일하고 재적용 음악·이력 추가 변경은 0이다. 별도 실제 A 0→0, B 15→15의 내용·연결을 보존했다. C는 기존 8개를 보존하며 11개로 늘었고 서로 다른 pitch의 인쇄 지속선 복원을 확인했다. 개발 중 확인한 입력이므로 미관측 holdout 성능으로 해석하지 않는다. r551/A 완성 프로젝트의 import/export·악보·재생 계획·MusicXML 보존을 확인했다. 공통 parser, WAG, 오디오, 믹서, Source 승인 조건은 변경하지 않았다.

최종 제품의 기존 typecheck·전체 lint, 기본 118파일 1,138개, opt-in private 3파일 5개, Python 가사/코드/시간축 49개와 build(exit 0)는 PASS다. 제품 무변경이므로 이번에 반복하지 않았다. Build `.next-local-lyrics-followup`, ID `2wpke1eMSWsmnz1xrGssm`의 HTTP와 설치 Chrome 153.0.8010.48 실행을 확인했다. 새 인식은 194.688초, runner exit 0, job manifest 499파일 검증이며 결과의 정확 166/엄격 164/출력 172/CER 36은 보존 raw 결과와 차이 0이다. 기존 131/109 손실 0, 중복 0, 비가사 전체·코드/시간축 근거도 동일하다. 실제 UI의 가사 172개와 원본 근거 4유형을 대조했고 네 실제 다운로드 파일은 바이트까지 같다. 제품 parser/replay로 음악·가사·origin/proof·revision·요청·확인 상태를 비교했다. revision 0, operations 0, attestations 0, 사용자 권리/음역 확인 없음, Source 차단을 유지한다. PostgreSQL·원격 OMR·Source/WAG는 이번 범위 밖으로 NOT_RUN, 사람 평가는 HUMAN_RECHECK_PENDING이다.

신규 XML은 보존 raw XML보다 선두 XML 선언/줄바꿈 41 bytes만 길며 이후 바이트는 완전히 동일하다. 음악/근거 차이를 임의 정규화하지 않았다. 누락 31개, 문자 오독 5개(신규 1 포함), 기준 밖 출력 1개와 extend 불일치 2개를 계속 남긴다. 시험 전 기존 두 PID는 이미 없었다. 이번 Chrome 세 실행은 정상 종료(exit 0), 서버는 최종 Ctrl+C 후 PID와 listener 부재를 확인했다. child exit 로그가 없어 Next 내부 graceful cleanup까지 단정하지 않는다. 최종 서버는 꺼져 있고 profile과 파일은 보존했다.

비공개 결과: `C:\Users\eccto\Documents\Codex\2026-09-12\head-docs-implementation-source-boundary-v1\outputs\HarmonyMaker-lyrics-recovery-v1-followup`. `final-audit/` 오류 원장, `fresh-automatic/` 신규 동결 결과, `fresh-evaluation/` 평가, `ui-fresh-open/` 실제 다운로드, `ui-state-verification.json` UI 왕복 비교, `verified-code/` 기존 검증 로그, `시작안내.md`와 manifest를 따른다. 실제 원본·전체 가사·proof·평가 정답은 repo에 추가하지 않았다. 기존 모델·교정본·프로젝트·build·프로필을 보존했고 삭제·push·배포·병합은 하지 않았다.

## 2026-09-16 Lyrics Recovery v1

**LYRIC_RECOVERY_V1_PARTIAL.** 제품 구현/최종 build revision은 `d0d6eb9b3f6c710348f1e60155e69fccb658ebcf`다. 이후 인계 commit은 build가 생성한 타입 경로와 문서만 보존한다. 가사 전용 보표 상대 row 검출, 온전한 획의 OCR와 실제 symbol box 역변환, 자동 물리 구간·token/glyph·경쟁 column·성부 시간 순서·중복 제약을 local-image pipeline에 연결했다. 내부 verse 순서는 인쇄 번호 판독과 구분한다. extend는 인쇄 지속 표시와 완전한 같은 pitch/voice의 연속 tie를 함께 요구한다. 명시적 사용자 가사는 보존하고, 정확한 자동 before 이력이 있는 경우에만 좁은 transition으로 교체한다. runner hash와 요청 cache 처리 버전을 갱신했다. 정답·수동 crop·특정 event/파일 예외는 runtime에 없다.

동결 `hm-omr-audit-v1.1`으로 baseline을 재현한 뒤 새 일반 UI 인식 결과를 평가했다. 기준 202개 중 문자+부착+절+성부 일치는 **90→131**, 출력은 **104→142**, precision **92.25%**, recall **64.85%**, F1 **76.16%**다. 엄격 extend/syllabic 일치는 **70→109**, precision **76.76%**다. CER은 **107/202→68/202**(치환 7, 삭제 60, 삽입 1)이다. 개발 목표 150개·95%·엄격 120개에는 미달했다. 기존 정확 90개와 엄격 70개 손실은 0, 누락에서 정확한 추가 37개, 기존 오류 수정 4개, 신규 잘못된 추가 1개, 기존 오류 6개·기준 밖 출력 4개·누락 64개는 남는다. 상관된 OCR 합의가 원본 진실을 인증하지 않는다.

별도 실제 A는 가사 없음 0→0, B는 15→15, C는 서로 다른 두 가사 row의 첫 token을 추가해 6→8이며 기존 가사와 비가사 XML을 보존했다. C는 개발 중 확인한 입력이고 미관측 holdout이 아니다. JPEG의 기존 283 event, 코드 51개, 시간축과 가사 제외 XML 전체가 동일하다. 반복 적용은 음악/이력 동일, 추가 변경 0이다. WAG·재생·믹서·공통 parser·Source 승인 조건·DB는 변경하지 않았다.

타입·전체 lint, 기본 118파일 1,137개, 별도 private 3파일 5개, Python 가사/코드/시간축 38개, 기존 프로젝트 보존 8검사와 production build가 통과했다. 관련 TS 34개는 기본 수에 중복 합산하지 않는다. Build ID `xF2Qp-4KY63W7VOELp06l`, `.next-local-lyrics`, origin `http://127.0.0.1:3201`에서 새 homr 1회를 일반 Chrome UI로 실행했다. cacheReused=false, actor=ui-test, source 미승인을 유지한다. UI 가사 142개를 text/verse/voice/syllabic/extend까지 대조하고 저장·reload·실제 download·재입력·같은 프로필의 브라우저 프로세스 재시작을 검증했다. 네 다운로드의 SHA가 같고 revision/operations/attestations는 모두 0이다. 기존 프로필의 다운로드 문제 해결을 주장하지 않는다.

PostgreSQL·원격 OMR은 미변경 경로라 NOT_RUN이며 사람 청감·교정 시간도 NOT_RUN이다. 비공개 결과는 `C:\Users\eccto\Documents\Codex\2026-09-12\head-docs-implementation-source-boundary-v1\outputs\HarmonyMaker-lyrics-recovery-v1`의 시작안내·검증보고서·상세 원장·원본 사례·manifest를 따른다. 원본과 전체 가사·proof를 repo에 추가하지 않았다. 설치 모델·기존 build·교정본·사용자 프로필을 삭제하거나 초기화하지 않았으며 push·원격 CI·배포·병합은 하지 않았다.

## 2026-09-15 Chord Recovery v1

**CHORD_RECOVERY_V1_VERIFIED — 자동 코드 복원과 제품 연결의 제한된 검증.** 구현은 `a0c89f1c3f281ec3c581d30c15ee493252cd4c04`, production build가 생성한 타입 경로 보존은 `a2610ce8a2181dcdd5dad4a5db8e97f927a025e3`다. 그 이후 이 절과 README 갱신은 문서 변경이다. 모든 코드의 원본 정확도나 Source 승인 완료를 의미하지 않는다.

코드 전용의 온전한 획 crop, 복수 OCR 계열의 전체 문자열 판독, 같은 원본의 직접 판독된 기호에 한정한 시각적 대조, slash 구성 요소 근거를 추가했다. 문자 일부의 판독이 전체 코드값을 덮지 못하며 minor/major·7/M7·accidental·bass 충돌은 보류한다. 시간축 v1.1의 물리 구간과 페이지의 인쇄 정렬 근거로 박 위치를 연결하고, 기존 rest token과 고립된 원본 잉크가 함께 있을 때만 쉼표 위치를 사용한다. 음표를 새로 만들지 않는다. 재처리 시 동일 onset의 기존 코드와 충돌하면 덮어쓰지 않는다. 새 모듈은 실제 local-image pipeline, runner hash, 요청 cache key에 연결했다. 평가 기준·수동 코드 배열·마디 번호 분기는 runtime 입력에 없다.

변경하지 않은 `hm-omr-audit-v1.1`을 새 자동 출력 hash 고정 뒤 실행했다. 기준 63개 중 코드값+위치 일치는 **22 → 50**, 출력은 **25 → 51**, 누락은 **38 → 12**다. 코드값은 51개 모두 r551과 일치하며 위치는 50개 일치한다. 동시 일치 precision 98.04%, recall 79.37%, F1 87.72%다. 기존 정답 22개 손실은 0, 기존 오류 3개 수정, 누락에서 정확한 복원 25개다. 추가 1개는 24구간 마지막 B♭의 위치로, 자동 3 quarter와 r551 11/4가 다르다. 원래 감사부터 원본 위치가 미확정인 필드이며 자동 geometry 근거가 생겼어도 원본 사실로 확정하지 않는다. 이 불일치를 신규 오류 0이라는 말로 숨기지 않는다. 인쇄 코드 12개와 비코드 잉크 후보 2개는 보류한다.

별도 실제 A는 7/8에서 8/8로 마지막 단일 음표 구간 Dm을 복원했고 30개 음표 및 나머지 XML이 같았다. 개발 중 A를 보고 crop 충돌과 중앙 정렬 처리를 조정했으므로 미관측 평가셋이 아니다. JPEG의 기존 283개 event 및 모든 비코드 XML, 시간축 판정·근거는 정확히 보존했다. APP 박자·길이·시작은 각각 39/39, event onset은 271/285, 총길이는 122.5 quarter로 유지한다. FILE 총길이 124와 마지막 overfull도 그대로다. 완성 r551/A 프로젝트의 음악·render·playback plan·내보내기 보존도 별도 검증했다.

타입·전체 lint, 기본 118파일 1,136개, opt-in private 3파일 5개, Python 코드/시간축 27개, 프로젝트 보존 8검사와 production build가 통과했다. 관련 33개 재실행은 기본 수에 중복 합산하지 않는다. Build ID `DT-4dszOxMLtXwIdWhyc6`, origin `http://127.0.0.1:3200`에서 설치 Chrome으로 정확한 JPEG의 새 homr 1회를 일반 UI에서 실행했다. `cacheReused=false`, 자동 chord 51개와 시간축 처리 호출을 확인했다. 39개 구간의 코드 값/위치를 DOM과 대조하고 저장·reload·실제 다운로드·재입력·같은 프로필의 브라우저 재시작을 검증했다. 네 다운로드의 SHA-256이 같으며 revision 0, 사용자 대조 승인 0건, Source 차단을 유지한다. 기존 브라우저 프로필의 과거 다운로드 문제를 해결했다고 주장하지 않는다.

PostgreSQL·원격 OMR은 미변경 경로라 NOT_RUN이다. 사람 평가도 NOT_RUN이다. WAG·재생·믹서·공통 음악 parser·Source 승인 조건·가사·슬래시·끝부분 다성부는 바꾸지 않았다. 모델·원본·r551·선행 감사 입력 506파일·시간축 인계 91파일·동결 평가기 48파일을 보존했다. 비공개 결과는 `C:\Users\eccto\Documents\Codex\2026-09-12\head-docs-implementation-source-boundary-v1\outputs\HarmonyMaker-chord-recovery-v1`의 검증보고서, 시작안내, 코드 원장, manifest를 따른다. 정답·음악·원본·proof는 저장소에 추가하지 않았고 외부 전송·push·배포·병합·기존 데이터 삭제를 하지 않았다.

## 2026-09-15 자동 시간축 v1.1 시스템 경계 완료

**TIMELINE_V1_VERIFIED.** 검증한 구현 commit은 `0c5fe4598d4b33095931fb03c9ad3474b85c65c5`다. 기존 명시적 tie 경로는 유지하고, tie/slur와 별개로 표시 구간의 시간 연속성을 판정하는 `independent-compressed-layout` 경로를 추가했다. 정답 r551, 목표 총길이, 특정 마디 번호는 runtime 입력에 사용하지 않는다.

새 경로는 인접 시스템의 마지막/첫 물리 구간, 같은 part·박자·단일 voice, 보통 barline, 반복·ending 충돌 없음, 원시 note/rest token과 원본 glyph 및 XML event의 정확한 대응을 모두 요구한다. 같은 시스템·박자의 완전한 마디를 최소 3개 학습해 물리 폭 기준을 만들고, 양쪽 구간이 그 기준과 각자의 event extent에 비례해 독립적으로 짧게 배치됐는지 확인한다. 두 extent가 박자를 완성하는 조건은 이 독립 근거 뒤에만 사용한다. 표시 구간 ID와 event·text·chord는 옮기거나 병합하지 않고 두 구간에 `implicit=yes`만 기록해 importer가 각 구간의 실제 extent를 사용하게 한다.

실제 JPEG의 여섯 쌍 `(5,6)`, `(11,12)`, `(16,17)`, `(22,23)`, `(27,28)`, `(33,34)`은 모두 **AUTO_APPLIED**다. extent는 각각 `7/2+1/2`, `2+2`, `7/2+1/2`, `2+2`, `2+2`, `7/2+1/2` quarter이고 모두 4/4다. 여섯 쌍 모두 cross-boundary tie/slur가 없지만, 위의 독립 구조 근거와 보통 join barline을 충족했다. 쌍별 staff geometry, token, chord·가사 문맥, 내부 tie/slur, 지지·반대 근거는 비공개 인계의 `six-pair-decisions.json`에 보존한다.

변경하지 않은 `hm-omr-audit-v1.1` 평가에서 이전 v1의 APP 구간 길이 `27/39`, 구간 시작 `5/39`, event absolute onset `34/285`, 총길이 `146.5` quarter가 새 APP에서 각각 `39/39`, `39/39`, `271/285`, `122.5`가 됐다. 총길이는 구조 판정 후의 평가 결과일 뿐 runtime 목표가 아니다. FILE은 마지막 overfull을 그대로 보존해 길이 `38/39`, 총길이 `124` quarter다. 기존에 맞던 항목의 회귀는 0이고, 기존 283개 event의 pitch/kind/duration/local onset/voice/tie/slur/chord/lyrics와 비시간 XML은 모두 보존됐다. 남은 event onset 14건 차이는 기존 local event 인식 차이이며 시스템 시간축 오프셋은 해소됐다.

독립 Python 반례 15개는 tie 없는 실제 형태의 연속 구간, 정상 폭 또는 token 누락 구간, 합이 맞지 않는 짧은 구간, 반복 기호로 분리된 tie 구간을 구분한다. 별도 실제 `independent-a.png`는 30 event·8구간·24 quarter와 전체 음악·시간을 그대로 유지하고 새 경계 변경 0건이다. 같은 JPEG v1.1 결과에 판정기를 재적용하면 XML이 byte-identical이고 추가 변경 0건이다.

타입, 전체 lint, 기본 118파일 1,136개, Python 15개, 관련 private 8검사, production build가 통과했다. Build ID는 `nX75eovUmqL8h11KPhMgX`다. `http://127.0.0.1:3199`의 production 모드에서 같은 원본 JPEG를 일반 UI로 새 homr 1회 실행했고 `cacheReused=false`, 외부 전송 0회였다. Chrome에서 새 후보를 저장·reload·실제 다운로드·작업 공간 파일 재입력했으며 세 파일 SHA-256과 제품 parser/replay 결과가 일치했다. revision 0과 사용자 확인 0건을 유지해 Source는 계속 차단한다.

이 변경은 박자·pickup·시스템 경계 시간축에만 한정한다. 마지막 불완전 glyph coverage 1건과 overfull 1건, 코드·가사·슬래시·끝부분 다성부 OMR은 남아 있다. WAG·재생·믹서·Source 승인 조건·DB/schema는 바꾸지 않았다. PostgreSQL과 원격 OMR은 변경 경로가 아니므로 다시 실행하지 않고 새 PASS로 세지 않는다. 보존 입력 506개와 동결 평가기 48개 해시는 모두 재확인했다. 비공개 인계 루트는 `C:\Users\eccto\Documents\Codex\2026-09-12\head-docs-implementation-source-boundary-v1\outputs\HarmonyMaker-timeline-v1-system-boundary-v2`다. private 음악·정답·proof는 저장소에 추가하지 않았고 push·배포·병합·기존 자료 삭제를 하지 않았다.

## 2026-09-15 자동 시간축 후보 v1

**TIMELINE_V1_PARTIAL.** 구현 commit은 `70f15c547df3b7d1260b5a89615e54df599b11f8`다. 기존 로컬 이미지 pipeline의 보완 뒤에 근거 제한형 시간축 단계를 연결했다. 원시 token/원본 glyph/자동 geometry로 박자표와 첫 pickup을 처리하고, 좁은 typed 자동 변경 이력·runner hash·요청 버전·미확정 UI를 유지한다. 정답 r551과 수동 좌표는 runtime 입력이 아니다. 기존 importer 길이 계약, Source 검증, WAG, 오디오, 믹서는 변경하지 않았다.

수정 전 B_FILE/B_APP_OLD를 먼저 동결하고 변경하지 않은 `hm-omr-audit-v1.1`로 평가했다. 같은 JPEG에서 인쇄 박자 1/7→7/7, 유효 박자 36/39→39/39, 구간 길이 FILE 22/39→26/39 및 APP 23/39→27/39, 구간 시작 1/39→5/39, 전곡 이벤트 onset 2/285→34/285다. 총길이는 FILE 157.5→148, APP 156→146.5 quarter로 기준 122.5와 여전히 다르다. 기존에 맞던 구조의 회귀는 0이다. 283개 이벤트와 국소 위치·음높이·음 길이·tie/slur·가사·코드는 그대로다.

박자 7건과 pickup 1건을 자동 후보로 적용하고 14건은 보류했다. 시스템 경계 6쌍은 합/배치만으로 연결하지 않았으며 실제 JPEG에 필요한 연결 증거가 없어 미완료다. 마지막 overfull로 FILE/APP 1.5 차이도 남는다. 합성 연결 반례의 성공을 실제 JPEG 경계 복원 성공으로 세지 않는다. 별도 실제 A는 30이벤트/8구간/24 quarter를 보존하며 초기 중복 3/4·6/8을 원본 6/8로 정리했다.

타입·전체 lint·기본 118파일 1,136개·Python 독립 11개·관련 private 8검사·production build가 통과했다. 기본 opt-in 3파일 5개와 PostgreSQL/원격 OMR은 NOT_RUN이며 구분 기록했다. Build ID `r2zOb90gPa3SDDLMyFvkO`, origin `http://127.0.0.1:3199`에서 정확한 JPEG로 새 homr 1회와 새 단계 연결을 일반 UI로 검증했다. Chrome 직접 기동·동일 프로필 서버/브라우저 재시작, Edge 새 프로필 가져오기, 실제 다운로드/재입력 파일과 앱 시간 의미가 같았다. 새 후보는 revision 0/사용자 대조 승인 0이며 Source 차단을 유지한다. 기존 r551/A 프로젝트 재생·저장·내보내기 비회귀도 확인했다.

비공개 인계 루트는 `C:\Users\eccto\Documents\Codex\2026-09-12\head-docs-implementation-source-boundary-v1\outputs\HarmonyMaker-timeline-v1`이다. `검증보고서.md`, `시작안내.md`, `실행.ps1`, `재현.ps1`, 최종 metrics/원장/manifest를 따른다. 이전 입력 506개·동결 평가기 48개 해시는 보존됐다. 이 절과 build 자동 생성 `next-env.d.ts` 타입 참조 갱신은 검증 구현 후 인계 변경이다. 사람 재확인은 `HUMAN_RECHECK_PENDING`이고 기존 문제 프로필까지 해결됐다고 주장하지 않는다. private 음악·정답·proof는 저장소에 추가하지 않았으며 push·배포·병합·삭제를 하지 않았다.

## 2026-09-14 JPEG 시험 음역 승인과 일반 UI 전곡 완료

**동일 JPEG를 대량 교정한 뒤, 지정된 시험 음역으로 일반 UI 전체 흐름을 검증했다.** 기존 r550은 보존하고 일반 UI에서 이 JPEG의 Lead hardRange 하한만 C4→F3으로 바꿔 r551로 저장했다. 실제 Lead F3–F5에 대해 기존 하한 위반 43개가 0개가 됐다. comfortableRange, 다른 가수, 기존 A 파일, 원본 음악과 비선택 성부, 코드 공백 및 별도 선행 화성 정책은 그대로다. 사용자 실제 가창 음역이 아닌 기술 시험 설정이며 사람 재확인은 `HUMAN_RECHECK_PENDING`이다.

일반 UI Source 확정 후 WAG는 전곡 complete 후보 1개와 partial 후보 1개를 냈고 complete 후보를 선택했다. 악보, Lead·생성 화음·Band의 실제 재생과 mute/solo, Play/Pause/Resume/Reset, 전곡 재생, 저장·reload, 실제 작업 공간·프로젝트·MusicXML 다운로드와 재입력을 확인했다. 최종 production 제품은 `03dd98e12b967800dc04faff47e519a23959bca4`, build ID `SfsLiNsahUUJPF9QtplBF`다. 같은 Chrome 프로필·`http://127.0.0.1:3198`에서 서버와 브라우저를 모두 재시작하고 파일 가져오기 전에 기존 초안·프로젝트를 복구했다. 재다운로드 파일도 동일했다.

실제 MusicXML 재입력에서 늦게 끝난 초기 저장본 복구가 사용자의 파일 선택을 덮어 Quick Review를 지우는 결함을 재현했다. 위 제품 commit은 `src/app/import/ImportReviewClient.tsx`와 새 startup-read helper/test에서 오래된 비동기 읽기의 UI 반영만 거절한다. Source 검증·parser·proof·WAG·오디오·DB·OMR은 바꾸지 않았다. 지연 promise 반례 7개를 포함한 117파일 1,133개 기본 테스트, 타입·전체 lint·production build가 통과했다. 관련 10개 재실행은 기본 수에 중복 합산하지 않는다. private 3파일 5개와 PostgreSQL/OMR은 변경 경로가 아니므로 반복하지 않았고 새 PASS로 세지 않는다.

최초 Source/WAG와 실제 PCM 측정은 선행 제품 `3ecdbc3`에서 수행했다. 최종 제품에서는 해당 음악 모듈 및 실제 출력 파일 바이트가 같음을 확인하고 production UI의 전체 재생·저장·다운로드·즉시 XML 재입력을 재검증했다. 공식 파일 의미 대조는 13개 PASS이며 별도 browser PlaybackPlan 객체 대조 1개는 NOT_RUN이다. 실제 native 오디오 710개 예약 event 대조 및 출력 12개 검사는 별도 PASS지만 그 원시 실행의 favicon 404 때문에 전체 로그는 FAIL로 보존하고 기능 결과와 구분했다. 자동 PCM 결과는 사람 청감을 대신하지 않는다.

최신 비공개 인계 루트 `HarmonyMaker-user-jpeg-assisted-v1`의 `시작안내.md`, `검증보고서.md`, `실행상태.json`, `f3-final/02-workspaces`, `f3-final/03-project`, `f3-final/04-musicxml`, `artifact-manifest-f3-final.json`을 따른다. 이전 r550 문서와 manifest는 baseline-r550에 보존했고 기존 manifest의 실제 366파일/248,003,945바이트를 재검증했다. 이 절은 제품 검증 뒤의 문서 전용 변경이다. 원본·전체 proof는 저장소에 추가하지 않았으며 자동 OMR 개선·소량 교정 실용성·모든 브라우저 프로필의 안정성을 주장하지 않는다. push·배포·병합·기존 데이터 삭제는 하지 않았다. 아래 r550 차단 기록은 당시 상태다.

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
