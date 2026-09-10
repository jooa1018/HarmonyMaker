# Astra runtime closure — 2026-09-07 KST

## 2026-09-11 — 전곡 대응·명시적 구조 복구 (INCOMPLETE)

재개 및 push 직전 refs는 `b83f658e7925c39f69a66f85060688caafff9337`이었다. PR #13은 Draft/OPEN, base는 기존 `chatgpt/harmonymaker-audiveris-provider` / `82c01d28a8e862ed96b48da8ab405589329a8553`로 유지했다. 아래 과거 기록을 삭제하거나 최신 검증으로 재사용하지 않았다.

원본을 다시 세어 **8개 시스템, 못갖춘마디를 포함한 표기 순서 39마디**로 대조 기록을 정정했다. 첫 시스템은 못갖춘마디를 포함해 5마디이고 다음 시스템은 표기 6에서 시작한다. 엔진의 첫 `number="0"`은 별도의 원본 마디를 뜻하지 않는다. 아래 9월 10일의 “원본 40마디”는 당시 관찰의 오류다. 원본 표기 순서/반복 재생 순서를 분리했으며 이 입력에서 반복 재생 지시는 확인되지 않았다. 30개 인식 마디에 합쳐진 원본 경계 9곳을 확인했으며, 10개의 빈 마디를 추가하지 않았다. 원본 5·9·10·11·21·22·27의 이벤트는 해당 물리 구간에서 export된 음표가 없었다. 한 마디가 잘못 나뉜 사례는 이번 대응에서 확인하지 못했다.

### 구현과 실제 적용

- 기존 실패 결과/원본 이미지/기존 단일 이벤트 교정은 유지한다. 새 `structural-recovery` 후보는 원본 문서와 audit history를 별도로 저장한다. 원본 파일·마디 번호·정답 배열을 제품이나 회귀 fixture에 넣지 않았다.
- 고정 이벤트 ID를 대상으로 마디 경계 분리, 누락 note/rest/rhythm 삽입, 값·위치·성부 변경, 오인식 객체 제거, 코드 삽입/위치 이동, 마디별 박자·조표·음자리표·실제 길이 확인을 지원한다. 구조 변경은 모든 원본 확인을 무효화한다. 취소/재적용/새로고침은 동일 이력을 재생하며 concurrent save와 history 변조를 거절한다.
- 조각 연결은 파싱한 한 파트/한 staff의 시간축으로 처리한다. 원본 파트 역할·성부 대응·경계 문맥 확인을 요구하고 divisions를 정확한 단위로 변환한다. XML 문자열을 이어 붙이지 않는다. 마디 안의 divisions 변경, 다중 staff/part, 지원하지 않는 tuplet 등은 flatten하지 않는다. 경계를 넘는 tie/slur, 성부별 공백·겹침·실제 길이, 코드 위치·중복, 원본 전체 시스템 목록/대조 revision을 검사한다.
- 불완전 인식 결과의 기존 Source 차단은 유지한다. 모든 검증과 원본 대조를 통과한 별도 revision만 기존 importer/Quick Review로 전달한다. 실제 실패 기록은 원본에 남는다. 정상 Source 확정은 이후 코드·구간·음역·권리 검토를 계속 요구한다. 복구 후 voice 선택으로 다른 원본 이벤트를 버리는 경우에도 차단한다.
- 같은 staff의 별도 rhythm-only 성부를 `SourceMeasure.rhythmVoices`로 보존한다. 선택한 pitched melody와 합치지 않으며 pitch를 만들지 않는다. Source digest/프로젝트 검증/저장·내보내기, score/동일 MusicXML 파트의 별도 voice, 생성 Band의 리듬에 연결했다. 확인된 Source slur도 tie와 별도로 보존한다. 2/4 계획 pulse를 지원하되 기존 단선율 Lead와 timing gate를 완화하지 않았다. 현재 V4 공유 포맷으로 이 별도 성부나 slur를 잃게 되는 공유는 명시적으로 차단한다.

실제 사용자 JPEG에서 얻은 보존 출력 3개를 일반 UI로 열어 다음을 **수동 교정**했다. 외부 OMR 재호출은 0회다. 개인 원본/출력/독립 원본 전사/대응표/UI 조작 기록/교정 bundle은 로컬 비공개 경로에 보존하며 공개 저장소와 CI artifact에는 포함하지 않는다.

| 교정 종류 | 실제 UI 적용량 |
| --- | ---: |
| 원본 경계 분리 / 출력 조각 연결 | 9 / 2 |
| 이벤트 삽입 | 151 (pitched 132, rest 7, rhythm slash 12) |
| 기존 이벤트 값·위치·표기 교정 | 120회, 서로 다른 119개 객체 |
| 오인식·중복 이벤트 제거 | 72 |
| 코드 삽입 / 코드 값·위치 교정 / 다른 마디로 이동 | 51 / 4 / 2 |
| 마디 문맥 확인 | 51회 (39마디 및 조각의 누락 clef 12개) |
| 원본 전체 시스템 목록 / 미완료 기록 | 1 / 2 |

원시 205개 이벤트 중 133개 객체를 유지했고 이 중 119개를 교정했다. 편집하지 않은 기존 객체는 14개이며, 이것을 전곡 자동 보존율로 과장하지 않는다. 후보의 284개 중 151개(약 53%)를 새로 입력했다. **실사용에서 가벼운 교정이라고 할 수 없는 수동 재구성 부담이다. 자동 OMR 성공으로 세지 않는다.**

원본에서 독립적으로 읽은 이벤트 투영과 UI에서 내려받은 후보를 대조했다: 39마디, 255 pitched + 17 rest + 12 rhythm, 63개 코드의 pitch(슬래시 제외)/duration/onset/tie/voice/마디·박자·조표/코드 위치에 차이 0개. 이는 가사/문자 및 미확정 곡선까지 포함한 전체 보존 PASS가 아니다. raw overfull은 6개이며 원시 출력의 문맥 없는 10마디는 그 수치만으로 충분히 평가할 수 없었다. **문맥 복원 및 교정 후 후보 overfull은 0개**다.

38의 상성부 슬래시 8개, 39의 상성부 슬래시 4개와 선행 쉼표, 39의 독립 하성부 6개 이벤트를 개별 복구했다. 슬래시에 pitch/rest를 대입하지 않았다. 36마디의 확인된 slur 양 끝은 보존했다. 38 첫 슬래시로 이어지는 곡선은 원본만으로 tie/slur를 확정하지 않고 미확정 차단 기록으로 남겼다. 원시 lyric 9개 중 교정 후보에 남은 7개 및 words 8개를 포함한 가사·문자 OCR은 전체 원문을 복원하지 못했으며 별도 미완료 기록이다. 현재 구조 UI에는 전체 가사·문자 복원 연산이 없다.

**최종 결과는 INCOMPLETE**다. 자동 인식 개선 패치를 새로 채택하지 않았으며 기각된 smallBeams/indentations/빔 경계 패치를 반복하지 않았다. 같은 JPEG로 구조·이벤트 교정, 원본 대응 기록, undo/redo, 저장·재로딩, 원본·이력·미확정 후보 MusicXML이 포함된 bundle 보존까지 실행했다. 미확정 곡선과 가사·문자 복원 문제 때문에 Source를 확정하지 않았다. 따라서 이 JPEG의 WAG/악보·오디오/완성 프로젝트 export 성공 증거는 아직 없다. 새 독립 회귀의 WAG/악보/오디오 계획/프로젝트·XML round trip은 일반 기능 검증이며 JPEG 성공을 대체하지 않는다.

최종 로컬 gate 및 정확한 commit의 CI/비운영 Preview 결과는 PR #13과 로컬 결과 보고서에 연결한다. main 병합·production 승격·새 provider·quota 변경은 수행하지 않는다. provider 구현/Docker/엔진 설정은 이번 변경에서 그대로다.

---

## 2026-09-10 — 교정 후보 보존·리듬 슬래시·native 메모리 예산 (INCOMPLETE)

이 항목은 아래 9월 7일 기록과 별개의 실행이다. 재개 시점과 재확인한 원격 HEAD는 `d341d21997b3748964b20c1b1317eb647b1cf865`, PR #13은 Draft/OPEN이며 base는 `chatgpt/harmonymaker-audiveris-provider` (`82c01d28a8e862ed96b48da8ab405589329a8553`)였다. 더 최신 변경을 되돌리지 않았다. 이 항목의 로컬 시험은 그 위의 이번 변경과 명시한 실행 설정으로 수행했다. 최종 commit/CI checkout/Preview/provider 배포 관찰은 [PR #13](https://github.com/jooa1018/HarmonyMaker/pull/13)의 최신 검증 기록과 연결한다.

**실제 사용자 JPEG의 전곡 복구는 여전히 INCOMPLETE다.** 보존된 인식 조각을 제품에서 열어 음높이·길이·점·붙임줄·박자·코드를 교정하고 취소/재편집/새로고침 복구할 수 있다. 원본의 첫 실패 마디에서 F4 4분→16분, D4 점4분→점8분의 명시적 교정 2건을 일반 UI로 적용하여 5.5박→4박을 확인했다. 그러나 나머지 과다 길이 마디, 누락된 마디선/음표, 잘못된 movement 분할을 복구하지 못했다. 이 JPEG의 Source 확정/WAG/재생/내보내기는 성공으로 세지 않는다. 전곡 재입력이나 정답 파일 주입도 하지 않았다.

### 구현한 경계

- `recovery_output.py`와 소유자 전용 `rejected-output` API가 알려진 불완전 출력 실패의 XML/MXL을 제한된 묶음으로 보존한다. 모든 조각을 유지하며 중복 내용도 임의로 버리거나 결합하지 않는다. 정상 result API는 계속 409다. 앱은 입력 페이지 digest와 각 문서 digest를 검증하고 기존 소유자 객체 저장소에 보존한다. 최초 회수의 일시적 실패는 같은 작업에서 읽기로 재개할 수 있다. 소유자 삭제 중에는 결과를 다시 게시하지 않는다.
- `src/import/review/recovery*`와 `RecoveryEditor.tsx`는 정상 Source와 분리된 후보를 보존한다. 원본 XML/이미지, 수정 출처, 수정 전후 값/digest, 순서 있는 교정 기록을 저장하고 재생 검증한다. 같은 실패 결과 재회수가 기존 교정을 덮어쓰지 않는다. 새로고침 직후 폼이 교정 전 길이를 표시하던 문제도 수정했다. 수정 때 기존 Review 승격을 무효화하고 전체 importer 검증을 다시 요구한다.
- 누락 음표/마디 추가와 movement 연결은 아직 지원하지 않는다. 회수한 불완전 조각은 이 제약을 표시하고 Source 승격을 차단한다. 복잡한 divisions 변경·tuplet 등의 의미를 이 작은 편집기로 안전하게 보존할 수 없으면 원본을 유지하고 해당 교정을 거절한다.
- Source에 명시적인 `kind: "rhythm"` 이벤트를 추가했다. pitch 필드가 없고 rest와 구별된다. onset/duration/붙임줄/가사/마디·코드 대응을 유지한다. MusicXML의 unpitched slash 및 `measure-style/slash use-stems="yes"`의 시작/끝/오선/제외 voice를 지원한다. 매 박 채우기 형태의 추상 슬래시는 별도 미지원 진단이며 숨은 pitch를 멜로디로 가져오지 않는다.
- 정본 digest/atomization/project/share/악보/MusicXML 내보내기까지 리듬 종류를 유지한다. 표시 위치용 좌표는 Source pitch가 아니다. Source Lead에서 음높이를 합성하지 않으며 생성된 Band 보이싱은 별도 트랙에서 슬래시 리듬과 붙임줄을 따른다. 일반 구간의 지속 반주를 불필요하게 마디마다 재발음하지 않는다.
- OMR 검토에는 슬래시의 리듬 확인 항목을 포함한다. Source의 정규 직렬화 순서를 시간 순서로 오인하던 readiness/자동 교정 제안도 실제 onset/end 기준으로 검사하도록 수정했다. 정상 리듬에 허위 겹침이나 음 길이 늘리기 제안을 만들지 않으며, 실제 초과·겹침·잘못된 붙임줄 검사는 유지한다.

### 실제 JPEG와 엔진 실험

원본 이미지를 직접 대조한 구조는 1페이지/8시스템/40개 표기 마디(못갖춘마디 0 포함)다. 시스템별 표기 범위는 0–5, 6–11, 12–16, 17–22, 23–27, 28–33, 34–37, 38–39다. 38–39의 리듬 슬래시는 사용자 확인에 따라 pitch 미지정 표기이며, pitch 없음 자체는 오류가 아니다. 슬래시 개수/리듬/onset/박자/코드 대응은 별도 검사 대상이다. 전곡 pitch·tie·voice의 독립 oracle은 완성되지 않았으며 정확도 PASS로 보고하지 않는다.

보존된 .omr/전체 3개 MXL에서 빔 후보의 위·아래 경계 분할 불일치를 확인했다. Audiveris 5.10.2의 고정 소스에서 실제 대응 경계만 채택하는 최소 실험 패치를 컴파일하여 BEAMS 이후를 재실행했으나, 출력은 3조각/30마디를 유지하면서 pitched note가 189→185로 줄고 overfull이 6→9로 늘었다. **실험을 기각했고 해당 엔진 패치는 제품이나 Docker 이미지에 넣지 않았다.** smallBeams/indentations의 기각된 설정을 다시 채택하지 않았다.

변경 전 wrapper의 256MiB Java heap으로 실제 JPEG를 0.1 CPU/512MiB에서 실행한 시험은 약 790초에 TEXTS 단계 OOM으로 실패했다(`oom_kill=1`). 관측된 정상 상태 조회 최대 지연은 7.375초였고 15초 client timeout도 발생했다. 같은 작업을 유지하며 조회를 재개했으며 새 작업으로 바꾸지 않았다.

Render 기존 인스턴스의 API 기록(9월 7일 11:50 UTC)은 CPU limit 0.15, memory limit 약 512MiB였다. 이 자원에 맞춘 별도 로컬 시험에서 native eng+kor OCR의 heap 밖 메모리 여유를 위해 heap을 192MiB로 제한했다. 동일 JPEG는 약 658초에 출력 단계까지 마쳤고 `oom=0, oom_kill=0`, 상태 조회 최대 3.797초였다. cgroup memory peak는 512MiB 한계에 닿았으므로 메모리 여유가 충분하다고 주장하지 않는다. 서로 다른 CPU 조건의 두 시험으로 heap 변경만의 인과 효과를 과장하지 않는다.

이 실행의 음악 결과는 이전 보존 결과와 전체 note/rest/pitch/onset/duration/dot/voice/meter/chord 투영이 동일했다: 3조각/30개 인식 마디/205 note 요소(189 pitched + 16 rest), overfull 6개. 원본 40마디와 일치하지 않으므로 인식 성공은 아니다. 정상 결과 409, 실패 출력 묶음 200/3조각 회수를 확인했다. 이 검증된 192MiB 예산을 wrapper 및 두 Dockerfile의 기본값으로 반영했고 실제 JVM MaxHeapSize 확인을 CI에 추가했다. timeout/메모리 사양/quota/언어 모델/음악 검증 gate는 늘리거나 완화하지 않았다.

### 이번 검증의 구분

| 입력/경로 | 환경·자동/수동 구분 | 결과 |
| --- | --- | --- |
| A. 실제 JPEG 전체, 현재 엔진/192MiB heap | LOCAL 실제 provider, 0.15 CPU/512MiB, 자동 | 출력 회수 가능, 음악 보존 FAIL, INCOMPLETE |
| A. 보존된 첫 조각의 일반 교정 UI | LOCAL production build, 인식 재호출 없는 replay, 수동 2건 | 첫 5.5박→4박 및 새로고침 복구 PASS; 전곡 재검증 계속 차단 |
| B. 기존 빔·점음표 4마디 이미지 standard/small | LOCAL 실제 provider, 0.15 CPU/512MiB/192MiB heap | 각각 32개 pitch/duration·4개 코드/위치·native title 일치, 291/254초. 두 크기는 동일 곡이며 독립 C로 세지 않음 |
| C. 별도 제작 8마디 6/8 D minor 악보 이미지 | LOCAL 실제 provider, 0.15 CPU/512MiB/192MiB heap, 수동 음표 교정 0건 | 8마디·30개 pitch/duration·박자·8개 코드 및 위치 일치, 약 254초, OOM 없음 |
| 손상된 자체 제작 MusicXML + 리듬 슬래시 | LOCAL production build, 명시적 길이 교정 1건 | 교정/취소/재편집/새로고침→Review→WAG→악보→PCM/Play/Pause/Resume→저장/복구→XML/project 내용 파싱 PASS; 8개 리듬 이벤트에 가짜 Source pitch 0개 |
| 기존 MusicXML/MXL/PNG/PDF 브라우저 회귀 | LOCAL production build, OMR API 부분은 모의 응답/의도적 미설정 | 기존 일반 UI·공유·긴 악보 모바일 reflow·오디오 해제·같은 작업 재개 검사 PASS. 실제 외부 OMR로 세지 않음 |

최종 코드의 로컬 gate는 typecheck/lint, 단위 테스트 939개(101파일), PostgreSQL 연동 39개(4파일), provider 테스트 91개, Next production build, Docker build 및 실제 JVM MaxHeapSize 201326592 확인, diff check가 모두 PASS다. 최종 production build에서 기존 브라우저 23개 검사, 위 실제 인식 조각의 명시적 교정 2건, 리듬 슬래시 fixture의 교정→WAG→오디오→저장/복구→내보내기를 다시 실행하여 PASS를 확인했다. PostgreSQL의 앞선 build 동시 실행에서 lock-waiter 타이밍 검사 1건이 실패한 적이 있으며, assertion 변경 없이 독립 실행 및 최종 재실행 모두 39개가 통과했다.

배포 전 읽기 재확인(2026-09-09 17:03 UTC)에서 프로젝트 당일 UTC 신규 작업/예약·소모 credit/미만료 진행 작업/미만료 결과 참조가 모두 0이었다. 원래 만료된 processing row나 사용자 결과를 삭제하지 않았다. 기존 테스트 provider의 autoDeploy=commit 설정을 확인했다. 외부 최종 실행과 최종 CI/배포 상태는 고정된 commit을 기준으로 PR 검증 기록에서 별도로 보고하며 위 로컬 결과로 대신하지 않는다. 비공개 JPEG/전체 XML/.omr/인증 정보/handle은 저장소와 CI artifact에 포함하지 않는다.

근거: [MusicXML slash의 use-stems/except-voice](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/slash/), [MusicXML duration/clock](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/duration/), [Audiveris 5.10.2 BeamsBuilder](https://github.com/Audiveris/audiveris/blob/5.10.2/app/src/main/java/org/audiveris/omr/sheet/beam/BeamsBuilder.java).

---

## Native OCR·인식 연동 개선 — INCOMPLETE (2026-09-07)

294ee2e의 기존 수정과 불완전 출력 차단을 보존했다. 문자 OCR 초기화와 일부 코드 보완 결함은 실제 엔진으로 개선을 확인했다. **사용자 JPEG의 전체 악보 보존·유효한 Review 입력은 아직 FAIL이며, 편곡 가능 상태로 보고하지 않는다.** 원래 서버 XML은 여전히 별도 BLOCKED_EXTERNAL이고 아래 로컬 결과와 동일하다고 주장하지 않는다.

### 실제 수정 및 검증

- Audiveris 5.10.2의 설치 소스 `TesseractOrder`는 JavaCPP Tesseract 5.5.1에 OEM_TESSERACT_ONLY로 Init 후 Recognize를 호출한다. Ubuntu CLI 5.3.4와 LSTM-only 데이터가 공존하던 불일치를 확인했다. 공식 tessdata 4.0.0 commit `590567f20dc044f6948a8e2c61afc714c360ad0e`의 eng/kor만 다운로드하고 SHA-256을 고정했다. 실제 네이티브 데이터 경로는 `/opt/audiveris-tessdata`이며 별도 chord OCR은 Ubuntu 데이터 경로와 OEM 1을 유지한다. 언어 목록만으로 PASS 처리하지 않았다.
- eng checksum: `daa0c97d651c19fba3b25e81317cd697e9908c8208090c94c3905381c23fc047`; kor checksum: `9520bfe9e3cfc38d4a808e036b0287c88a1d37fb80b9a0a23928ddccdd20595b`.
- 실제 native 인식은 자체 작성 이미지의 제목 `Harmony Beam Study`, 사용자 로컬 저장 .omr의 87개 단어(한글 포함 단어 18개)로 확인했다. 결과에 12개 native harmony와 첫 movement의 가사 9개가 생겼다. 단어/코드 개수는 정확도 보장이 아니며 사용자 전체 코드의 위치 대응 PASS가 아니다.
- 패키지의 숨은 Xms512m/Xmx8G가 JAVA_TOOL_OPTIONS를 덮어쓰는 사실도 실제 플래그로 확인했다. 패키지 강제값을 제거하고 native heap을 256MiB로 제한했다. 기존 general Xmx384m 환경에서도 실제 MaxHeapSize=268435456을 확인했다. 원격 요금제·자원·환경값은 바꾸지 않는다.
- native harmony가 한 곳이라도 있으면 나머지 보완을 모두 생략하던 동작을 수정했다. native harmony가 있는 마디는 보존하고 빈 마디만 기존 전체 페이지/시스템 gate 아래에서 보완한다. 코드 영역에 아래에서 들어오는 줄기·빔은 임시 분할 마스크에서만 제외하여 G/F 글자와 합쳐진 crop을 막는다. 원본이나 Audiveris 입력의 음악 픽셀은 수정하지 않는다.
- Free 사양 시험에서 synchronous 코드 OCR 후처리가 상태 조회를 막는 현상을 재현했다. 후처리를 worker thread로 옮기고 같은 job의 조회/취소를 유지한다. 소유자 삭제는 파일 생성 worker 종료 뒤 workspace를 지워 재생성을 막는다. 첫 Free 시험의 30초 상태 응답 timeout은 관찰 중단으로 기록하며 엔진 최종 실패로 판정하지 않았다. 소유 시험 job은 정리했고 자체 작성 입력으로 분리된 회귀를 수행했다. 처리 중 관찰 및 삭제 회귀는 수정 전 FAIL, 수정 후 PASS다. 요청/엔진 timeout을 늘리는 수정은 하지 않았다.

최종 실제 HTTP 회귀는 0.1 CPU/512MiB/swap 추가 없음에서 두 이미지 모두 PASS: standard 326.81초, small 314.84초. 각각 기존 900초 범위 안에서 같은 job의 상태 조회·결과 수신·소유자 삭제를 마쳤다. cgroup peak 536870912 bytes, memory.events oom=0/oom_kill=0이다. 메모리 압력은 있었으므로 여유가 크다고 주장하지 않는다. 이 결과는 소량 자체 작성 입력의 자원 검증이며 사용자 전체 JPEG의 0.1 CPU 검증은 NOT_RUN이다.

### 제한 실험: 사용자 전체 로컬 인식 3회 + 저장 .omr 재개 1회

이 세션의 전체 사용자 인식 예산 3회를 모두 사용했고 추가 전체 인식은 하지 않았다. 모두 동일한 보존 입력, 512MiB 제한, 로컬 1 CPU였으며 Render 0.1 CPU에서 실행했다고 주장하지 않는다. 이전 세션의 4회와 합쳐 전체 로컬 인식 누적 7회다. 외부 인식은 **0회**다.

| 시험 | 변경·자원 | 음악 결과 및 판정 |
| --- | --- | --- |
| 기존 기준선 | native OCR 초기화 실패 | 3 movement, 8 systems, 30 exported measures, note elements 206. 첫 실패 11/2 quarter, 첫 movement overfull 6개, 후속 10마디 박자 없음 |
| 1 native 호환 데이터 | 초기 heap384에서 39.62초/512MiB OOM137. TEXTS/CURVES를 저장한 .omr를 heap256으로 재개: 14.8초/218,558,464 bytes | 3 movement/8 systems/30마디/205 note elements. 첫 11/2 및 overfull 6개 그대로, underfull 4개(pickup 포함), 후속 missing meter 10개. 첫 movement pitched notes/durations는 기존과 동일하며 pickup rest 1개만 없어졌다. 빔 개선 아님 |
| 2 smallBeams=true | 설치 버전의 실제 ProcessingSwitches 설정 하나. heap256, 50.97초/517,947,392 bytes | 3 movement/8 systems/29마디/194 note elements. 첫 11/2 그대로, 첫 movement 20→19마디 및 103→89 note elements. **누락 악화로 기각** |
| 3 indentations=false | 하나의 곡이라는 명시적 실험, 기본 beam. heap256, 49.14초/506,679,296 bytes | 1 movement/8 systems/30마디이나 146 note elements, overfull 7개/underfull 6개(pickup 포함). 첫 11/2 그대로. 잘못된 3/4 상속으로 박자 누락 표시만 사라짐. **음악 보존 실패로 기각**, 제품 기본값에 넣지 않음 |

오선 간격13px/선3px/beam 추정9px, 이진화 beam 영역9~10px와 오선 중첩, 실패 두 음의 BeamStem 연결 누락을 기존 파일에서 관측했다. beam9가 잘못되었다고 단정하지 않았다. 시스템 left 53~54→92→154의 이동이 indentation 임계26px를 넘으며 잘못된 movement-start와 연결됐다. 그러나 분할을 끄는 것만으로 음악 연결은 해결되지 않았다. 이전 meanCoeff0.5 실험은 반복하지 않았다.

overfull 수 감소나 박자 합계만으로 정확도를 판정하지 않았다. 작은 빔 실험은 underfull 3개(pickup 포함)를 남기며 음표 누락을 늘리고 indentation 실험은 음표를 크게 잃었다. 입력 특화 상수·정답 음 배열·제목/파일명/digest 분기·XML 합치기·부분 출력 gate 제거는 없다.

### 실제 사용자 경로와 범용 회귀

- 자체 작성 두 시스템/4마디 이미지의 두 스케일·배치에서 실제 HTTP provider 결과를 검증했다. 각각 32개 pitch/duration, C/G/Am/F 네 코드 및 시작 위치, native 제목 인식 PASS. 첫 시험에서 G가 누락된 실패를 보존하고 crop 분할 수정 후 두 변형에서 PASS를 확인했다. 수작업 XML만 읽는 시험이 아니다.
- 실제 자체 작성 OCR 결과 → 일반 MusicXML 가져오기 → Review/Quick Review → WAG → 악보 및 nonzero PCM 재생 → 저장/reload → 3파트 MusicXML/프로젝트 내보내기 → 소유 프로젝트 삭제 PASS. 원본에 따라 **C major와 quarter 96 BPM을 명시적으로 입력**했다(native key/tempo 누락). 음표·리듬·코드 수동 교정 0개. 이를 key/tempo 자동 인식 PASS로 세지 않는다.
- 사용자 JPEG 실험 결과는 현재 importer에서 IMPORT_CORRUPT_XML로 막히며 그 단계에는 음표·리듬 편집기가 없다. 원본 다운로드/재입력 안내만으로 전체 복구 가능하다고 보고할 수 없다. 사용자 JPEG Review→프로젝트→WAG→재생→저장·복구·내보내기 **NOT_RUN / blocked**. Audiveris GUI에서 원본 대조하며 빔·박자·마디선·movement·코드 전체를 교정하는 경로는 이번에 완료 검증하지 못했다. 필요한 정확한 전체 교정 개수/작업시간도 미확정이다.
- 기존 전체 local unit 921개/99파일, PostgreSQL 39개/4파일, typecheck/lint/build PASS; provider 최종 87개 PASS. 기존 runtime 브라우저 23항목 PASS(직접 MusicXML/MXL·WAG·PCM·모바일·저장·복구·공유·삭제 포함). 비공개 사용자 이미지/전체 XML/.omr는 저장소와 공개 artifact에 넣지 않는다.

**남은 차단:** JPEG의 빔·박자·마디/음표 누락 및 전체 코드 대응. 다음 결정은 이 저해상도 JPEG에 상수 실험을 반복할지 여부가 아니라, 원본 대조를 포함한 Audiveris 명시적 편집·전체 재수출 경로를 별도 범위로 검증할지 여부다. 자동 복구나 현재 앱 내 전체 교정 성공을 약속하지 않는다.

물리 iPhone·전체 인식 품질·운영 배포 NOT_RUN. 이전 ddcea952 PNG 및 17dbdf7 PDF PASS는 각각의 환경/입력 증거로만 유지한다. 이번 변경의 최종 SHA/CI/Preview/provider LIVE와 자원 측정은 PR #13 및 로컬 최종 증거에 덧붙이며 문서 갱신만으로 재배포하지 않는다.

공식 근거: [Audiveris languages](https://audiveris.github.io/audiveris/_pages/guides/main/languages/), [Tesseract data families](https://tesseract-ocr.github.io/tessdoc/Data-Files.html).

---




## 시간축·전체 출력 조사 후속 — INCOMPLETE (2026-09-07)

이번 범위는 d0972aa의 안내·다운로드·재입력·확대 수정을 보존하고, 실제 로컬 인식의 시간축과 첫 출력 선택을 조사하는 것이다. **부분 결과를 전체 완료로 반환하는 provider 결함은 수정했다. 첨부 악보 전체의 자동 처리 성공은 아니다.** 원래 서버 XML 접근은 별도 BLOCKED_EXTERNAL이며, 로컬 재현 분석은 완료했다.

### 5.5박의 발생 단계와 원인

기존 JPEG/정규화 PNG/두 번의 로컬 인식 MXL 전체/.omr/로그를 보존·재사용했다. 정규화 입력 digest는 `8858cee03d279000325ea80c5173aa90c44c7cf9c4b833b8f2e243c111c52740`이다. 원래 서버 결과(39,797 bytes, `c96343d5e66f00d9e807e619aeaa8c317195398c8d72f8e2faa00b1db5758e45`)와 이전 로컬 provider 결과(39,987 bytes, `bd541bb36b73920ee47f34b1ce8e9cfc4ac34555d1f28dd363ee921932fbe918`)는 구분한다.

MusicXML 4.0의 문서 순서 clock 규칙을 사용하는 별도 Python Fraction 추적기로 모든 출력의 note/rest/chord/grace/backup/forward를 계산했다. 표시 type/dot는 비교 자료로만 읽고 duration을 덮어쓰지 않았다. 첫 실패는 part ordinal 0, measure ordinal 1/표기 번호 1, voice 1/단일 staff다. 이 마디는 implicit가 아니고 divisions=4, 4/4이며 chord/grace/rest/backup/forward/time-modification이 없다.

| 문서 내 note ordinal | 원본 이미지의 길이 | 엔진 duration / type | quarter-note cursor 전→후 |
| --- | --- | --- | --- |
| 0, 1, 2, 3 | 각각 8분음표 | 각각 2 / eighth | 0→1/2→1→3/2→2 |
| 4 | 16분음표 (짧은 두 번째 빔 포함) | 4 / quarter | 2→3 |
| 5 | 점8분음표 | 6 / quarter + dot | 3→9/2 (여기서 처음 4박 초과) |
| 6, 7 | 각각 8분음표 | 각각 2 / eighth | 9/2→5→11/2 |

원본의 다섯째·여섯째 음에 보이는 빔이 저장된 엔진 graph에서는 stem에 연결되지 않았다. `.omr` head-chord 13552/13553에는 beam-stem 관계가 없고 augmentation-dot은 여섯째 음에 연결되어 있다. 따라서 16분→4분, 점8분→점4분으로 각각 3/4박 증가했다. 마지막 onset은 5, 최대 end는 11/2다. 저장된 `.omr` stack 자체에 duration=11/8, expected=1, excess=3/8(온음표 단위)이 이미 있다. raw MXL → 기존 provider의 DOCTYPE 제거 후 결과는 정확히 동일해 provider 후처리에서 시간축이 바뀐 것도 아니다.

분류: **B, 엔진의 빔 인식 누락이 로컬 시간축 초과의 원인**이다. 이 최초 실패에 대해 A(importer 계산 오류), C(후처리 duration 변경), D(미지원 구조의 오분류) 근거는 없다. 빔 검출이 이미지의 오선과 겹친 부분에서 실패한 것은 관찰되지만, 특정 이진화 계수 하나로 일반 해결할 수 있다는 근거는 확보하지 못했다. 실제로 모순된 duration/type는 계속 차단한다.

첫 실패만 보지 않았다. 첫 출력의 20마디 중 **총 6마디**가 박자 길이를 초과했고, 뒤 두 출력의 10마디는 초기 박자표가 없다. 첫 부분의 박자도 뒤에서 3/4로 인식되어 원본과 다르며, 마디선/음표 인식의 추가 손실이 있다. 두 음을 단순 교정하거나 1.5박을 자르는 것으로 전체를 복구할 수 없다. 수동 음악 교정/새 Source 승격은 수행하지 않았다.

### 세 출력의 구간 보존과 일반 수정

`.omr` book의 score→sheet-page 매핑과 sheet의 system 순서로 확인했다. mvt1은 이미지 시스템 1~5(20개 인식 마디/104 note), mvt2는 시스템 6(4마디/54 note), mvt3은 시스템 7~8(6마디/48 note)이다. 세 파일은 XML/MXL 중복 직렬화가 아닌 서로 다른 구간이다. 시스템 6/7의 잘못 인식된 indentation으로 movement-start가 생겼고, 기존 find_result는 mvt1만 반환해 마지막 세 시스템을 제외했다. 이것은 **C, provider 선택에 의한 별도 누락 결함**이다. 이미지에서 첫 구간부터 마지막까지 공간 대응은 찾았지만, 인식 자체의 마디/음표/박자 손실 때문에 음악적 연결 의미가 확정되지 않았다.

기존 코드 OCR에는 부분 XML 5시스템 대 이미지 8staff의 불일치에서 삽입을 생략하는 gate가 있다. 이를 제거해 뒤 구간의 코드를 앞 구간에 붙이지 않았다. 모든 출력에 native harmony가 0개이며, 전체 코드 대응 성공은 아니다.

수정된 find_result는 후처리 전에 `.omr` book의 전체 score 목록을 검사한다. 여러 movement가 있으면 `AUDIVERIS_OUTPUT_INCOMPLETE`, 서로 다른 출력이면 `AUDIVERIS_OUTPUT_AMBIGUOUS`, 목록/출력 확인 실패면 `AUDIVERIS_OUTPUT_INVALID`로 종료한다. 파일명 순서/크기/음악 내용 추측으로 선택하거나 합치지 않는다. **같은 경로 stem의 XML/MXL이며 canonical XML까지 같은 경우만** 중복 직렬화로 인정한다. 서로 다른 movement는 내용이 같아도 버리지 않는다. book은 여러 score인데 출력 하나만 남은 경우도 차단한다. 원래 artifacts는 기존 보관 정책에 따라 남으며 partial result.musicxml은 게시하지 않는다. 이 guard가 하나의 score 내부의 모든 인식 누락을 검출한다는 뜻은 아니다.

앱 상태 동기화는 위 알려진 오류 코드만 자체 작성한 한국어 안내로 변환한다. vendor 원문/XML/경로는 공개하지 않으며 모르는 오류는 기존 generic 메시지를 유지한다. 새 인식을 반복하라고 안내하지 않는다. 유효한 교정 MusicXML을 기존 직접 가져오기 경로로 넣는 연결은 유지하지만, 대규모 편집기나 자동 음악 교정은 추가하지 않았다.

### 제한된 추가 실험과 환경 정정

기존 로컬 이미지에는 kor 데이터가 없었다. 따라서 이전 기록의 '같은 provider 설정'은 wrapper/소스 수준의 일치였으며 전체 실행 환경 동일성은 아니었다. 현재 Dockerfile로 새 이미지를 빌드하고 eng/kor/osd 설치, 실제 실행 로그를 확인했다. Windows checkout의 shell CRLF로 첫 launcher가 실행 전 실패한 것은 LF checkout으로 바로잡았다(인식 호출 0회). 제품 wrapper의 내용 변경은 없다.

이번 추가 로컬 인식은 네트워크 차단 **2회**다. (1) 기존 prepared TIFF에서 meanCoeff만 0.7→0.5로 바꾼 이진화 실험은 8개 시스템을 2개로 누락해 **기각**, 제품 미반영. (2) 현재 Dockerfile/기본 이진화/eng+kor 구성으로 원래 정규화 PNG에서 다시 인식했으며 같은 3구간, 같은 첫 11/2 초과와 총 6개 overfull/10개 초기 박자 누락이 재현됐다. 이전 2회와 합하면 실제 사용자 입력의 로컬 인식은 누적 4회, 이번 외부 인식은 0회다.

새 환경 로그에서는 Audiveris의 legacy OCR 모드와 설치된 LSTM 언어 데이터의 불일치로 native text OCR 초기화 실패도 확인했다. 5.10.2 TesseractOrder는 legacy 모드를 고정하며, 이는 BEAMS 이후 TEXTS 단계다. 이 문제를 최초 빔 누락의 원인으로 단정하거나 임의 엔진 모드/언어 모델 교체를 하지 않았다. 별도 chord OCR의 위치 gate도 완전한 결과에서 검증되기 전에는 완화하지 않는다.

### 검증과 남은 범위

- 실제 보존 출력 replay: 이전 find_result가 첫 20마디를 반환 → 수정본은 전체 inventory 불일치를 명시적으로 차단. 모든 artifact hash 유지, 새 인식 0회.
- 자체 작성 provider 회귀 17개: 파일명/출력 순서 변경, 서로 다른 음높이/divisions/마디 번호, 같은 내용을 가진 다른 movement, 동일 artifact의 XML/MXL 중복, 누락된 export, 손상된 목록, 실제 run_job 상태·result 409·artifact 보존. 기존 suite 포함 82개 PASS.
- 시간축 자체 작성 회귀: divisions 4/12/480, 음높이·voice·마디 번호를 바꾼 정상 구조는 Review, 대응하는 11/2 모순 구조는 차단. 기존 exact Fraction/backup/pickup/박자 변경 회귀 유지.
- 앱 경계 회귀: 알려진 출력 실패만 안전한 안내, 모르는 코드/민감한 vendor 메시지 비노출, 재조회 때 동일 terminal 상태/새 create 없음.
- 최종 gate/CI checkout, additive commit, 정확한 Preview와 provider LIVE는 PR #13과 기존 로컬 증거 사본에 갱신한다. 문서만으로 새 배포를 반복하지 않는다.

마지막 제품 코드 변경 후 npm ci, typecheck, lint, unit 99 files/921 tests, disposable PostgreSQL 4 files/39 tests, build, diff-check 모두 PASS. Provider suite 82개도 다시 PASS다. 로컬 production build 브라우저의 **모의 API** 시험은 일반 입력→전체 출력 차단→새로고침에도 같은 terminal 상태→새 create 없음→시험 소유 manifest 삭제→기존 MusicXML 가져오기 이동 PASS다. 실제 외부 OMR 성공으로 세지 않는다. Push 직전 읽기 조회(18:35 KST)에서 최근 1시간 생성 0건/미만료 진행 작업 0건을 확인했다. 과거 만료된 processing row와 원래 사용자 완료 작업은 변경하지 않았다.

전체 구간을 의미 보존한 정상 Source로 만들지 못했으므로 실제 JPEG Review→프로젝트→WAG→악보/재생→저장/복구/내보내기는 **NOT_RUN / blocked**다. 자동으로 고쳐졌다고 보고하지 않는다. 기존 정상 XML/MXL·PNG/PDF의 환경별 PASS는 유지하지만 이 JPEG를 대신하지 않는다. 원래 서버 사건의 정확한 원인은 원문 접근 전까지 미확정이다. 물리 iPhone·전체 인식 품질·운영 배포도 NOT_RUN.

필요한 다음 자료는 원래 서버 결과의 권한 있는 접근, 또는 이 실제 악보의 빔·마디선·박자·구간을 원본과 대조해 명시적으로 교정할 수 있는 입력이다. 정상 MusicXML 재시험이나 새 외부 JPEG 인식을 사용자에게 요구해 해결로 대체하지 않는다. 원본 악보/전체 XML/.omr/로그는 비공개 work에만 보존하며 사용자 원래 job이나 객체를 cleanup하지 않는다.

근거: [MusicXML duration/clock](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/duration/), [chord clock](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/chord/), [backup](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/backup/), [Audiveris Book/Score](https://audiveris.github.io/audiveris/_pages/tutorials/main_concepts/book_score/), [MXL exports](https://audiveris.github.io/audiveris/_pages/reference/outputs/mxl/), [pinned adaptive threshold](https://github.com/Audiveris/audiveris/blob/5.10.2/app/src/main/java/org/audiveris/omr/image/AdaptiveDescriptor.java), [pinned OCR legacy mode](https://github.com/Audiveris/audiveris/blob/5.10.2/app/src/main/java/org/audiveris/omr/text/tesseract/TesseractOrder.java).

---

## 2026-09-07 실사용 JPEG 후속 조사 — INCOMPLETE

이 항목은 아래 역사적 검증과 별개다. `17dbdf7`의 자체 작성 1쪽 PDF 전체 흐름 PASS / PREVIEW_VERIFIED(최신 PR 증거)는 유지하지만, 실제 사용자 JPEG의 성공을 뜻하지 않는다.

- 사용자 확인: 2026-09-07 약 15:12 KST, iPhone용 Google Chrome, 원래 오류 탭은 닫힘. 해당 기기의 IndexedDB·쿠키·handle을 가져오거나 위조하지 않았다.
- 고정 오류 Preview: `https://harmony-maker-4coo4cnmf-ecctom1.vercel.app`, `dpl_DZKuY7hFdWjUqAdcYd7b8EWmKNTK`, 실제 앱 SHA `17dbdf74692feb0aa21e2fb9a9a18fb30145be03`. 원격 HEAD도 동일했고 다른 작업자의 후속 변경은 없었다.
- Render My Workspace / `harmonymaker-audiveris-temp`의 LIVE는 `ddcea952a6c7b1b90250fa3646109b5b4b6d588d`. 작업 branch를 autoDeploy commit으로 추적한다. provider source는 17dbdf7과 동일하다. 이번 수정은 provider를 변경하지 않는다.
- 서버 읽기 조회: 15:03:06.979 KST 생성 → 15:12:00.533 완료된 camera-photo 1쪽 작업이 있으며, 39,797-byte MusicXML 객체가 active 상태다. digest `c96343d5e66f00d9e807e619aeaa8c317195398c8d72f8e2faa00b1db5758e45`, 객체 보관 만료는 2026-09-08 15:03:06.979 KST. 원문 객체 읽기 권한은 현재 도구에서 확보하지 못했다. 원래 사용자 결과를 확보했다고 보고하지 않는다.
- 첨부 JPEG의 서버 방식 정규화 PNG digest는 `8858cee03d279000325ea80c5173aa90c44c7cf9c4b833b8f2e243c111c52740`으로 위 작업의 페이지 digest와 정확히 일치한다. 원본 JPEG bytes와 정규화 PNG bytes는 구분한다. 원래 iPhone handoff bytes/binding은 NOT_RUN이다.
- 외부 재인식 호출 0건. 네트워크가 차단된 로컬 Audiveris 5.10.2 인식 2건: 먼저 JPEG를 직접 grayscale 변환한 재현, 이어서 서버와 일치하는 정규화 PNG를 사용한 재현. 후자는 현재 wrapper/preprocess/output/chord-OCR 코드를 사용했다. 원문 악보·전체 MusicXML·engine logs는 저장소 밖 비공개 디버깅 폴더에만 보존한다.
- 동일 정규화 입력의 로컬 결과는 39,987 bytes, digest `bd541bb36b73920ee47f34b1ce8e9cfc4ac34555d1f28dd363ee921932fbe918`이다. 원래 서버 결과 digest와 다르므로 **원래 결과 replay가 아니다**. 실행된 importer의 첫 실패는 `MusicXML cursor exceeds measure duration`, partOrdinal 0 / measureOrdinal 1 / 악보 번호 1 / element measure. exact Fraction 단위(quarter note) 최대 11/2, 박자 길이 4/1, 즉 4/4 마디에 온음표 기준 11/8이다. 성부 1의 시간축이 초과한다. 처음 로컬 재현에서도 같은 실패를 관측했다.
- 로컬 엔진이 여러 movement 파일을 만들고 provider가 첫 파일을 선택하는 것도 관측했다. 나머지 파일의 첫 박자표 누락과 전체 악보 보존 문제는 해결되지 않았다. 첫 마디를 강제로 잘라내거나, 박자를 고정하거나, 전체 악보를 인식한 것처럼 처리하지 않았다.

### 이번 최소 수정과 검증 범위

- 의도적인 구조 검사만 `IMPORT_CORRUPT_XML`로 분류하며, 안전한 한국어 원인과 part/measure 위치를 남긴다. 예기치 않은 runtime exception은 XML 손상으로 분류하거나 그 원문을 화면에 노출하지 않는다.
- OMR 결과 가져오기 맥락을 표시하고, 검증한 원본 bytes의 다운로드와 보존 파일 재입력 경로를 제공한다. 다운로드 사본은 IndexedDB Blob backing과 분리한다. 30분 TTL / 실패 3회 제한은 유지하며 새 인식 요청을 보내지 않는다. 직접 파일 선택 때 이전 OMR Review 상태도 해제한다. 불안정하게 관측된 같은 탭 재읽기 버튼은 최종 제품에 포함하지 않는다.
- 자체 작성 최소 XML 회귀: 구버전에서 6개 중 5개 실패, 수정본에서 모두 PASS. 정상 pickup / backup을 포함한 두 성부 / 박자 변경은 의미를 유지해 Review로 진입한다. overfull/음수 backup/0 duration/선행 음 없는 chord는 계속 차단한다.
- Chromium·Playwright WebKit: /import 초기·파일 focus·오류·390×844/844×390 전환·글자 크기 200% 검사. 기본 상태에서는 원래 화면 잘림을 재현하지 못했다. 글자 200%에서는 기존 scrollWidth 751 > clientWidth 390을 재현했으며, grid/file-input 최소 폭 수정 후 두 엔진 모두 390/390, scrollX 0. physical iPhone의 원래 잘림 원인으로 단정하지 않는다. 실제 pinch/page zoom 및 물리 iPhone은 별도 미검증이다.
- 정규화 입력의 로컬 엔진 XML에는 별도의 synthetic provider envelope를 붙여 OMR 맥락과 페이지/결과 digest 검사를 검사한다. 구체적 마디 오류 → 다운로드 bytes 일치 → 보존 파일 직접 재입력의 검증이며, 원래 사용자의 provider-result binding을 확보한 replay나 새 외부 OMR E2E가 아니다. 3회 실패 후 삭제·TTL·다른 handoff ID 보호는 별도 IndexedDB 회귀 테스트로 검증한다. WebKit의 임시 context Blob 저장 제한은 persistent disposable context로 분리했고, 다운로드 검사는 도구가 bytes를 미리 읽어 주는 관측 보조 없이 실행한다. 일반 MusicXML/MXL 전달에는 OMR 인식 맥락을 붙이지 않고 원래 파일 확장자를 보존한다.
- 이 악보의 수동 음악 교정은 수행하지 않았다. 실제 결과 → Review → 프로젝트 → WAG → 재생·저장·내보내기는 현재 구조 차단으로 NOT_RUN이다. 안내·보존 기능 개선을 이 악보의 처리 성공으로 보고하지 않는다. 전체 인식 정확도·물리 iPhone·운영 배포도 NOT_RUN.
- 이번 시험은 외부 OMR job이나 사용자 프로젝트를 생성하지 않았다. 브라우저 시험이 직접 만든 로컬 replay handoff만 정리하고 테스트 브라우저를 닫았다. 사용자의 원래 작업과 서버 객체는 삭제하지 않았다. quota·secret·요금·운영 DB·main은 변경하지 않았다.

최종 코드 변경 이후 `npm ci`(452 packages, 0 vulnerabilities), typecheck, lint, unit 99 files / 914 tests, disposable PostgreSQL 4 files / 39 tests, build, diff-check가 모두 PASS다. 별도 localhost production build 브라우저 회귀 23항목도 PASS: 정상 XML/MXL의 Review·complete 생성·실제 PCM·저장/복구·내보내기·소유 데이터 삭제, 96마디 표시와 모의 OMR 복구를 포함한다. 이 정상 fixture 성공은 실사용 악보의 성공으로 대체하지 않는다. 마지막 로컬 OMR synthetic-envelope replay는 Chromium/WebKit 모두 다운로드 원문 일치·직접 재입력·200% 글자 확대에서 390/390 폭·소유 local handoff cleanup PASS다.

additive commit SHA, CI의 branch checkout/PR merge-ref, 새 Preview와 provider LIVE revision은 PR #13의 후속 증거 및 이 문서의 로컬 증거 사본에 추가한다. 문서만 갱신하려고 다시 배포하지 않는다. 원래 서버 XML 접근과 이 악보의 유효한 Review 진입이 남으므로 판정은 **INCOMPLETE**다.

---

## 판정과 검증 SHA

**CODE_VERIFIED_EXTERNAL_BLOCKED.** 기존 `41c26ea`의 PASS를 새 HEAD의 PASS로 사용하지 않았다. 새 runtime SHA `ddcea952a6c7b1b90250fa3646109b5b4b6d588d`의 Preview에서 직접 MusicXML/MXL과 실제 PNG OMR부터 Review·프로젝트·화음 생성, 모바일 표시, 재생·저장·복구·내보내기·공유·소유자 삭제까지 통과했다. PDF는 실제 create 요청이 HTTP 429 / OMR_QUOTA_EXCEEDED로 거절되어 끝까지 검증하지 못했다. 앞선 검증 도구의 pause 처리 오류로 PNG 2건의 인식량을 이미 사용한 뒤, 정상 PNG 1건으로 세션의 최근 1시간 3건 한도에 도달했다. 이를 제품 인식 실패나 원인 불명의 테스트 실패로 숨기지 않는다. 확인된 제품 차단 P0/P1은 없지만 PDF 외부 흐름이 미완료이므로 PREVIEW_VERIFIED가 아니다. 물리 iPhone과 전체 인식 품질은 NOT_RUN이다.

이 문서는 검증 뒤 추가되는 **문서만 변경한 commit**이다. 자기 commit의 SHA/배포 ID를 본문에 소급하여 꾸미지 않는다. 문서 commit 이후 최종 push HEAD의 CI checkout, 정확한 새 Preview/provider revision 및 직접 입력 재실행 결과는 [Draft PR #13](https://github.com/jooa1018/HarmonyMaker/pull/13)의 최신 증거에 기록한다. 문서 commit에서 실제 OMR을 실행하지 않았다면 NOT_RUN으로 별도 표시하며, 이 표의 SHA 결과로 대체하지 않는다.

| 대상 | 직접 확인한 상태 |
| --- | --- |
| 저장소 / branch | `jooa1018/HarmonyMaker` / `codex/harmonymaker-astra-runtime-closure` |
| 재개 시작 원격 | `41c26ea97ab0bf057cb9febe245c422e7107ebd7` |
| 이번에 push·검증한 HEAD | `ddcea952a6c7b1b90250fa3646109b5b4b6d588d`; non-force push. 기존 base 이후 6개 commit과 추가 5개 commit 모두 보존 |
| base | `chatgpt/harmonymaker-audiveris-provider` / `82c01d28a8e862ed96b48da8ab405589329a8553` |
| 작업 보존 | 별도 linked worktree 사용. 다른 checkout의 미커밋 수정과 과거 final branch를 건드리지 않음. push 전 remote 재조회에서 다른 작업자의 후속 commit 없음 |
| PR | [#13](https://github.com/jooa1018/HarmonyMaker/pull/13), Open / Draft / Unmerged |
| 실제 검증 Preview | [고정 deployment URL](https://harmony-maker-1wvoc8fmd-ecctom1.vercel.app), `dpl_CKM6pEFfNbfYdbHYtJvxCV72XPcs`, READY / target null / git SHA `ddcea952a6c7b1b90250fa3646109b5b4b6d588d` |
| branch alias | `harmony-maker-git-codex-harmonymaker-astra-runti-bfd413-ecctom1.vercel.app` |
| 운영 앱 | `harmony-maker-opal.vercel.app`, production `main`, SHA `b4e14976ab65899cc86a65c20c99a7545f1a0d9e`. 변경·승격 없음 |
| 별도 provider | Render `harmonymaker-audiveris-temp`, `srv-da3f66qfngtc73d105qg`; 실제 LIVE commit `ddcea952a6c7b1b90250fa3646109b5b4b6d588d`, `dep-daepiv5bedkc73e790kg` |

Vercel의 승인된 임시 인증으로 실제 Playwright Chromium을 사용했다. 보호 설정을 변경하지 않았다. 접근 토큰·쿠키·OMR owner handle·공유 payload는 보고서와 저장소에 포함하지 않는다.

## 원인, 수정, 회귀

| ID | 사용자 영향 / 재현 | 확인한 원인과 변경 | 증거 / 현재 상태 |
| --- | --- | --- | --- |
| ASTRA-01 | 기존 browser run에서 OMR 오류 검사 AssertionError, 이후 MXL 미실행 | navigation 전에 전역 alert가 빈 Next route announcer를 선택. `scripts/runtime-browser-smoke.py`, `.gitignore`; `5b1f1a3` | PASS. URL/heading 대기와 Source region의 실제 오류 문구, 실행 가능한 시작 동작 없음, create 0건 유지. 빈 오류 허용·검사 삭제 없음 |
| ASTRA-02 | 기존 clearInterval receiver 수정의 실제 브라우저 해제 보장 부족 | 기존 wrapper를 보존하고 smoke에 PCM과 context/timer 소유권 검증 추가; `5b1f1a3` | PASS 새 Preview와 push browser CI. Play/Pause/Resume/Reset, 재생 중 편성 전환, unmount 후 context closed 및 timer baseline 복귀, live context 1개 |
| ASTRA-03 | 응답 유실 후 중복 생성 위험의 browser 회귀 부족 | manifest, 중복 클릭, 첫 응답 유실, reload와 같은 키 retry 관측 추가; `06ba31a` | PASS 격리 CI. 요청 2회/동일 키/논리적 simulated effect 1회/실제 외부 호출 0회. 실패 503과 명확한 오류 유지. 실제 provider 장애 주입이 아님 |
| ASTRA-04 | 390px 화면이 1,056px까지 넘침. 악보 한 줄 축소로 음표 머리 약 2.70px | `globals.css`, `workspace.module.css`의 select 폭·모바일 label 및 `ProductPracticePlayer.tsx`의 실제 폭 기반 abcjs wrap/ResizeObserver; `58bf767` | PASS 새 Preview. pageWidth 390, 96마디 desktop 24단/mobile 96단, 음표 머리 약 8px. 공유 화면과 실제 OMR 악보도 검사 |
| ASTRA-05 | 전체 test의 101회 OMR 결정성 검사가 간헐적으로 30초 timeout | worker 자원 경합. `vitest.config.mts` maxWorkers 2; `c80206d` | PASS 로컬 및 새 CI. 테스트·101회 순열·timeout·assertion·skip 조건은 변경하지 않음. 97 files/905 tests |
| ASTRA-06 | 이전에는 Render workspace 미승인으로 안전한 push/새 Preview 확인 불가 | 이번 사용자 승인으로 실제 비운영 연결 확인 후 non-force push 및 테스트 provider branch 정정 | RESOLVED. 앱과 Python provider의 deployment SHA를 각각 조회. 운영 앱/main은 그대로 |
| ASTRA-07 | Preview OMR 검증 도구가 상태 화면의 처리 중에서 진행하지 못함 | 임시 검증 스크립트가 60초 조회 budget의 두 pause 안내 중 재개 동작을 놓침. 제품 실패가 아님. Source 안내와 동일 handle의 ‘상태 확인 재개’를 처리하도록 검증 절차 수정 | PASS 수정 절차. 앞선 PNG 2건은 동일 handle sync로 completed/result 200 확인 후 각각 소유자 DELETE 200/404로 정리. 불확실한 기존 작업을 새 키로 재전송하지 않음 |
| ASTRA-08 | 새 Preview의 실제 PDF 인식부터 완료까지 검증하지 못함 | PNG 3건으로 최근 1시간 세션 한도 3건 소진. PDF create HTTP 429; provider 작업 생성 전에 quota gate 거절 | BLOCKED_EXTERNAL. 원인과 화면의 명확한 오류 확인. quota 변경·새 identity·DB 초기화로 우회하지 않음. 첫 한도 슬롯은 2026-09-07 02:51:18.755 KST 이후 자연 회복 예정이며, 다른 사용/전역 한도는 다시 확인해야 함 |

예외 기록은 단계·유형·traceback·비어 있지 않은 fallback과 안전한 경로/API 상태를 남긴다. 실패를 catch하여 PASS 처리하지 않는다. 별도 subagent/검토자는 사용하지 않았다.

## 새 Preview에서 실제 실행한 사용자 흐름

| 흐름 | 결과 | 직접 확인한 범위 |
| --- | --- | --- |
| MusicXML 직접 입력 | PASS | 잘못된 입력 거부 → 일반 화면 → Quick Review → 프로젝트 → simple/standard/full complete → 4편성 표시와 nonzero PCM → 저장/새로고침/재진입 → 프로젝트 JSON 재가져오기 → 3파트 MusicXML 내보내기·재가져오기·생성 |
| MXL 직접 입력 | PASS | `/omr` 로컬 handoff → Quick Review → generation/PCM/저장/새로고침/3파트 export → export 재가져오기·생성. OMR 외부 호출 0건 |
| 실제 PNG OMR | PASS | 자체 작성 8마디/32음/8코드 악보. 품질·권리·외부 전송 동의 → double-click create 1건 → upload/queued/processing → 필요한 경우 동일 handle 상태 확인 재개 → 실제 completed/MusicXML → 화면 handoff → Review → 프로젝트 → 생성/표시/PCM/저장·복구/내보내기·재가져오기/URL 공유/로컬 삭제 |
| 실제 PDF OMR | BLOCKED_EXTERNAL | 같은 권리 안전 악보 PDF. digital PDF 확인과 WARN 검토 및 동의 이후 create 429. 명확한 제품 오류 PASS, provider 인식/Review 이후는 NOT_RUN. 기존 41c26ea PDF 성공으로 대신하지 않음 |
| Source-first 검토 | PASS (PNG의 제한된 fixture) | 실제 PNG 결과 8마디/32음/8개 harmony. C/G/Am/F/C/G/F/C를 검토. 누락된 C major는 자체 작성 원본에 따라 명시적 사용자 교정. lead/tempo/곡 구조/3인 음역/권리를 확인한 뒤 generation |
| URL 공유 | PASS | 읽기 전용 실제 browser, 생성 동작 없음, nonzero PCM. 서버 저장형과 구분 |
| 서버 저장형 공유 | PASS | 자체 작성 96마디로 `kind:store` 201, 같은 키 replay 200/동일 응답, readonly desktop/mobile/PCM. 정상 소유자 UI 삭제 200 및 이후 조회 404 |
| 소유자 삭제 | PASS | 이번 테스트 로컬 프로젝트만 삭제. OMR 각 테스트 job은 애플리케이션 DELETE API로 localHandleDeleted true / vendor deleted / cleanupState resolved, 이후 404. 다른 데이터·직접 DELETE SQL·bulk 삭제 없음 |
| 모바일 표시 | PASS | 390×844 Chromium, 가로 넘침 없음·8px 음표 머리·실제 폭에 맞는 악보 줄바꿈. 물리 iPhone 결과가 아님 |

PNG 인식 관찰 154초, 상태 조회 재개 2회. 재개는 원래 handle을 확인하는 동작이며 새 외부 create가 아니다. 과거 ‘눌렀다가 무반응’은 PNG에서 재현되지 않았고 요청/상태 전이/결과/화면 handoff까지 확인했다. PDF는 quota 오류가 명확히 표시됐다. 이번 재개에서 외부 인식은 PNG 3건이며 PDF 429는 외부 인식 0건이다.

## Render와 DB/storage의 실제 확인 범위

- 사용자 승인 workspace: My Workspace, `tea-d90iarbsq97s739e0sbg`. 해당 저장소 서비스는 기존 임시 테스트 서비스 하나. Docker/free/Singapore/1 instance, PR preview off. 다른 repository 서비스는 변경하지 않았다.
- push 전에 실제 추적 branch가 base이고 LIVE `82c01d2`임을 확인해 앱 작업 branch push가 provider 운영 배포를 일으키지 않음을 확인했다. 이후 확인된 테스트 서비스의 branch를 `codex/harmonymaker-astra-runtime-closure`로 변경; autoDeploy yes/commit. 첫 새 LIVE `dep-daeph6mq1p3s73ac4mc0`.
- 공개 source 안내 `HM_AUDIVERIS_SOURCE_CODE_URL`만 위 runtime SHA의 immutable provider 소스로 갱신했다. 이 비secret 변경으로 `dep-daepiv5bedkc73e790kg`가 같은 SHA에 LIVE. API key/demo token 등 secret은 조회·변경하지 않았다. 새 유료 서비스/plan 변경/production 변경 없음.
- 실제 health: Audiveris 5.10.2, engine audiveris, durableStorage false. 환경: maxPages 12, retention 3600s, durable storage 0, `JAVA_TOOL_OPTIONS=-Xmx384m -Djava.awt.headless=true`. 실제 메모리 한도 약 512MiB/CPU 0.15. process timeout 환경 override 없음; 배포 소스 기본값 900초. 임의 timeout/retry 증가 없음.
- 데이터는 `/data`의 ephemeral provider SQLite/files, 1 worker. capability supportsIdempotency false. 재시작 이후 외부 생성 중복 방지나 보관 복구는 보장하지 않으며 restart 장애 주입은 NOT_RUN. 테스트 성공을 내구성 보장으로 확대하지 않는다.
- `render.yaml`의 base 추적은 템플릿이며 실제 서비스 설정 override와 구분한다. Render LIVE commit 및 실제 요청 로그로 배포를 확인했고, Vercel READY로 Python 코드 배포를 추정하지 않았다.
- 운영 Vercel alias는 main `b4e14976...` 유지. 운영 capabilities read-only 조회는 PERSISTENCE_UNAVAILABLE 503으로 OMR 구성이 없었다. 운영 앱 배포/승격/설정 변경 없음.
- Neon `harmonymaker-preview` / `red-sun-79451966`, primary `production` / `br-weathered-unit-aw8j57lo`는 비일회용 DB로 취급했다. registry 1~15 read-only 확인; migration/장애 주입/직접 데이터 삭제 없음.
- 자체 PNG page digest와 생성 시각으로 Preview job이 이 DB에 존재함을 좁게 확인했다. provider binding `omr-provider:audiveris:310b16b9aa8b6850b112c43702517b33`, adapter v1. 이 binding hash는 endpoint 주소의 증명이 아니다. 실제 Render 요청 로그와 시각을 함께 확인했다. 실제 upload/result read/소유자 cleanup으로 storage 흐름을 검증했으며 키/접속 문자열을 출력하지 않았다.
- 이번 PNG 3건(UTC 16:51:18.755, 17:02:23.572, 17:06:16.420)을 read-only로 다시 조회해 state/local_delete_state/vendor_delete_state 모두 deleted, handle_active false를 확인했다. 삭제해도 hourly 사용량이 감소하지 않는 안전 계약은 유지했다.
- 기존 chord OCR Source identity 수정(CΔ7/C°7/Cø7/unknown glyph/slash bass)은 보존. 실제 entrypoint에서 augment 호출되고 candidate는 unconfirmed. 65개 unit PASS는 glyph별 실제 영상 인식 품질 PASS가 아니다.

## 실행 gate와 checkout 구분

환경: Windows, Node 22.23.2, Next 16.3.0, Python 3.12.14, Playwright 1.57.0 Chromium. AGENTS에 따라 설치 Next CSS/client/navigation/testing 문서 확인. 로컬 Docker Desktop 초기화 오류는 reset하지 않았고, PG 17.11을 localhost 55439 disposable DB에 사용한 뒤 중지했다.

| 실행 | 결과 / 환경 |
| --- | --- |
| npm ci / typecheck / lint / build / git diff --check | PASS. lockfile 그대로 452 packages/0 vulnerabilities. 최종 제품 source `58bf767`, 문서만 추가한 `ddcea952`와 소스 동일 |
| npm test | PASS 로컬 97 files/905 tests. 새 push/PR CI도 PASS |
| npm run test:postgres | PASS disposable PG 4 files/39 tests |
| migrate fresh/repeat | PASS installed 1~15, 반복 installed [] |
| provider pytest | PASS 65 tests (deprecation warnings 3) |
| frozen / Segment B / OMR determinism | PASS 3 files/12 tests, frozen 6개 파일 hash와 두 101회 gate. KEEP_WAG_V1_0_1 유지 |
| production localhost browser | PASS 로컬 `58bf767`; 새 push CI browser는 `ddcea952`. Preview와 별도 증거 |
| 최초 실패 | [33950877356](https://github.com/jooa1018/HarmonyMaker/actions/runs/33950877356) / `41c26ea`: artifact 9964810711 직접 조사. 원인은 ASTRA-01 |

| CI run | event | GitHub headSha | 실제 checkout SHA | 결과 |
| --- | --- | --- | --- | --- |
| [34046159961 CI](https://github.com/jooa1018/HarmonyMaker/actions/runs/34046159961) | push | `ddcea952a6c7b1b90250fa3646109b5b4b6d588d` | `ddcea952a6c7b1b90250fa3646109b5b4b6d588d` | PASS |
| [34046159975 Runtime closure browser](https://github.com/jooa1018/HarmonyMaker/actions/runs/34046159975) | push | `ddcea952a6c7b1b90250fa3646109b5b4b6d588d` | `ddcea952a6c7b1b90250fa3646109b5b4b6d588d` | PASS, 해당 artifact results.json 확인 |
| [34046161799 CI](https://github.com/jooa1018/HarmonyMaker/actions/runs/34046161799) | pull_request | `ddcea952a6c7b1b90250fa3646109b5b4b6d588d` | `23491fdd975580ffd621040e52964454b4d5d92d` | PASS, checkout log 확인 |
| [34046161805 Audiveris provider](https://github.com/jooa1018/HarmonyMaker/actions/runs/34046161805) | pull_request | `ddcea952a6c7b1b90250fa3646109b5b4b6d588d` | `23491fdd975580ffd621040e52964454b4d5d92d` | PASS, 65 unit + 실제 pinned Docker/Audiveris HTTP MusicXML/hybrid OCR. fake HTTP 단계는 별도 |

## 남은 한계와 NOT_RUN

- 확인된 제품 차단 P0/P1 없음. 새 Preview PDF는 **BLOCKED_EXTERNAL**이며 인식 이후 단계는 **NOT_RUN**. 한도 자연 회복 뒤 동일 소유 세션/보존 manifest의 원래 키로 PDF 1건만 재개해야 한다. 권한/요금제/secret 변경은 필요하지 않다.
- 물리 iPhone Safari, JPEG 별도 인식, 특수 코드 glyph의 실제 영상 정확도, 광범위 인식/음악적 품질, provider restart 복구는 **NOT_RUN**.
- production 배포·승격, main 병합, 정식 릴리스는 **NOT_RUN**이며 승인 범위 밖이다.
- iPhone 후속 확인: PR의 최종 Preview를 Safari에서 열고 자체 MusicXML 입력 → Review·생성 → 세로/가로 악보 가독성 → Play/Pause/Resume/Reset → 저장/재진입과 공유 재생을 확인한다. 데스크톱 모바일 viewport의 PASS를 physical-device PASS로 계산하지 않는다.

원본/로그/스크린샷/정리된 JSON은 실행 환경의 `runtime-evidence.zip`과 `verification.json`에 모았다. 최종 push HEAD 증거는 PR #13 최신 본문과 함께 읽는다. 다른 사람의 데이터나 인증 정보를 evidence에 포함하지 않는다.

## 2026-09-11 후속: 자동 인식과 복원 후보 후단을 분리

`3964bc8`의 구조 복구 및 465건 이력을 그대로 보존하여 진단했다. 분수 onset 코드의 허위 겹침과 일반 콜론 문자의 허위 반복 지시 판정을 수정했다. 같은 JPEG의 보존 후보는 격리 테스트에서 WAG standard, 실제 악보/PCM 전곡 재생, 저장·새로고침, 프로젝트/MusicXML 내용 검사를 통과했다. 진단용 초기 반주 없음, 미확정 곡선 연결 미적용, 불완전 가사 유지 가정이 있으며 정상 UI Source 확정은 계속 차단된다. 원본의 음악적 연결이 모두 확인됐다는 뜻이 아니다.

자동 인식용 해상도·구간 후보는 별도 로컬 실제 엔진 시험에서 출력 이벤트가 205→156으로 줄고 마지막 시스템/가사 연결을 잃어 기각했다. 원시 overfull 6→8이며, 보존 교정 후보의 overfull 0과 구별한다. provider에 채택한 자동 인식 개선은 없다. 465건 이력과 53.2% 신규 이벤트 입력은 여전히 비실용적인 부담이다.

상세한 차단 조건/영향, 독립 악보 검사, 좌표·자원·보존량, 새 코드 회귀 및 세 가지 독립 판정은 [OMR 후속 실행 기록](OMR_FOCUS_2026_09_11.md)에 있다. 후단 진단의 PASS로 자동 OMR/원본 완전 복원 INCOMPLETE를 덮어쓰지 않는다. 최종 CI의 실제 checkout과 비운영 Preview SHA는 PR #13 최신 검증에 기록한다.
