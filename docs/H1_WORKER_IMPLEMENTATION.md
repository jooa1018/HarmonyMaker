# H1 1-11 Worker 구현 — A등급 검토 요청

판정·검증·생성·프로젝트 IndexedDB·ABC·PlaybackPlan·MusicXML/공유 payload를 Worker로
옮기는 클라이언트 API를 추가했다. 기존 화면은 그대로이며 H3 3-8에서 연결한다.
화면에는 불투명 handle과 표시·재생 DTO만 반환한다. 함수·인자·반환 타입과 취소 계약은
[QUICK_HARMONY_API.md](QUICK_HARMONY_API.md)의 Worker 절에 있다.

## 경계와 저장

- Worker entry가 엔진을 로드하고 한 번에 한 명령을 처리한다. 클라이언트도 순차로
  보내며 요청 id·Worker 세대가 다른 응답을 무시한다.
- 준비 handle은 원래 workspace를 가리킨다. answer는 미리보기이며 최종 generate가
  answers·tempo·confirmedAt을 한 번 적용한다. 권리 확인 없는 미리보기는 권리를 부여하지 않는다.
- 프로젝트 객체·검증 증거는 Worker 안에 있다. import/open/save는 기존 검증과 버전
  registry를 사용한다. DTO를 검증·저장 입력으로 받는 경로는 없다.
- 기존 IndexedDbProjectStore의 saveNew/delete에 선택 beforeCommit 콜백만 추가했다.
  export 검증과 DB 열기 후, write transaction 생성 전에 Worker가 commit-ready를 보낸다.
  클라이언트가 취소 불가 상태로 전환하고 commit을 허용한 뒤에만 쓴다.
- commit 전 취소는 Worker 종료와 AbortError다. commit 후 cancel은 committing이며
  dispose도 실제 응답을 기다린다. 오류로 응답을 잃으면 결과 미확인 오류로 끝낸다.
  다른 탭이 같은 선택을 먼저 저장하면 기존 항목을 다시 검증해 반환한다.
- 생성 id는 현재 H3의 workspace digest·parts·confirmedAt·answers 정책을 사용한다.
  1-25의 명시 tempo만 추가하고, 생략한 경우 기존 id를 보존한다.
- WAV는 OfflineAudioContext가 있는 메인 스레드에 남고 DTO plan/tempo를 쓴다.
  음악 규칙·프로젝트/공유 형식·DB 버전·검증 캐시 범위는 변경하지 않았다.

## 실제 브라우저 검증

Next.js 16.3 Turbopack production 빌드의 임시 로컬 시험 화면에서 확인했다.
Worker URL은 같은 출처의 `/_next/static/chunks/turbopack-worker-….js`이며
`worker-src 'self'`를 강제해도 실제 생성·저장·export·share payload가 성공했다.
blob URL, 실제 DB/S3, 공유 API 요청은 사용하지 않았다. 임시 화면은 커밋에 포함하지 않는다.

실제 Worker에서 생성 중 취소하면 IndexedDB 항목이 0개였고, 재시작 후 이전 handle은
WORKER_HANDLE_EXPIRED였다. 저장 시작 콜백에서 signal.abort와 cancel을 함께 호출해도
saved와 항목 1개를 확인했다. 메인 스레드 대체 실행은 없다.

## 120마디 재측정

자작 wag11/4-4-1의 120마디 반복, 음마다 SHA-256 일부를 넣은 가사, 알토+테너,
390×844, 같은 abcjs wrap 옵션이다. 각 Worker 조건은 독립 브라우저 context에서
3회 실행했다. Worker 응답 structured clone, 화면 DTO 전달, 전체 SVG 생성까지 포함한다.
이 표는 production 시험 화면의 측정이며 H3 React 화면 통합 후의 E2E 수치는 아니다.
기존 설계 문서의 개발 서버 66.64초와 직접적인 속도 향상 비율로 비교하지 않는다.

| 구간 | CPU 1배 중앙값 | 페이지 CPU 4배 중앙값 |
|---|---:|---:|
| Worker 엔진 로드·시작 | 0.247초 | 0.257초 |
| 판정·DTO 반환 | 0.310초 | 0.267초 |
| 생성·검증·저장·view·DTO 반환 | 4.410초 | 6.001초 |
| 새 Worker에서 저장 항목 읽기·검증·view | 2.637초 | 2.346초 |
| abcjs 전체 표시 | 0.719초 | 8.131초 |
| 시작~SVG 완료 | 5.804초 | 17.057초 |
| 가장 긴 메인 스레드 long task | 0.718초 | 8.132초 |
| 엔진 처리 중 16ms 타이머 최대 간격 | 17.9ms | 114.5ms |

엔진 단계의 50ms 이상 long task는 6회 모두 관측되지 않았다. CPU 4배 전체 시간은
16.08–17.18초, 생성~DTO는 5.99–6.09초, SVG는 7.67–8.28초였다.
같은 현재 코드의 메인 스레드 production 비교 경로(각 1회)는 CPU 4배에서
판정 1.13초·생성 30.65초·저장 14.01초·view 0.89초·SVG 8.42초,
최장 long task 45.67초였다. CPU 1배의 합계는 약 4.62초로, Worker는
로드·통신 비용 때문에 감속 없는 총시간을 줄이지 않았다.

**측정 제한:** CDP의 페이지 CPU 감속은 실제 휴대폰을 재현하지 않는다. 동일 계산
보조 시험에서도 메인과 Worker의 감속 폭이 달랐다. Worker의 6초를 “모든 스레드가
4배 느린 휴대폰의 생성 시간”으로 해석하지 않는다. 확인한 개선은 생성·검증·저장
중 메인 스레드의 긴 정지를 없애고 취소를 처리한 것이다. SVG 동기 작업은 남아 있다.

원자료: [H1_WORKER_METRICS.json](H1_WORKER_METRICS.json). UI를 옮긴 뒤 H3 3-8에서
동일한 입력·390px로 전체 화면과 취소 버튼을 다시 확인해야 한다.

## 악보 표시 API 확인

설치된 abcjs 6.7의 공개 renderAbc, oneSvgPerLine, lineBreaks, startingTune를 조사했다.
startingTune는 곡 선택이고 시스템 범위 선택이 아니다. oneSvgPerLine은 그리기 완료 후
SVG를 나누며 중간에 제어를 돌려주지 않는다. 자작 120마디(긴 가사 없는 별도 시험)에서
CPU 4배, 보통 표시 4.78초/SVG 1개, oneSvgPerLine 4.94초/SVG 61개였고
양쪽 모두 그리기 중 타이머 실행 0회였다. 반환 음높이·시각은 같았다.

내부 EngraverController는 abcjs.test에 노출돼 있으나 범위 표시의 안정된 공개 계약이
아니다. 내부 tune.lines를 잘라 전달하거나 ABC를 마디선 문자로 나누는 변경은 구현하지
않았다. 별도의 표시 범위 API 제안과 보존 조건을 A등급으로 올릴 예정이다.

## 재현

임시 경로가 없음을 확인한 뒤 아래처럼 시험용 route를 만든다. 작업 디렉터리는 전용
worktree다. 실제 환경 파일을 로드하거나 서버 DB URL을 설정할 필요가 없다.

```powershell
New-Item -ItemType Directory src/app/h1-worker-probe
Copy-Item src/product/harmony-worker/browser-probe.txt src/app/h1-worker-probe/page.tsx
$env:HM_LOCAL_DIST_DIR = ".next-local-worker"
npm run build
npx next start --hostname 127.0.0.1 --port 3196
# 별도 터미널, Edge 설치 필요
node scripts/worker-browser-check.mjs
```

결과는 worker-browser-metrics.json이다. 시험이 끝나면 서버·브라우저를 닫고 자신이
만든 임시 route/빌드 출력만 제거한다. next-env.d.ts와 tsconfig.json의 자동 생성
include도 원래대로 복원한다. 공개 환경이나 제품 화면에 시험 route를 배포하지 않는다.

## 검증 및 남은 판정

구버전 v1.0.1·v1.1·v1.2 및 편집 snapshot, 프로젝트/ABC/XML/share 바이트와 plan 음
일치, 미등록 버전·변조 거부, 순차 처리, cold open, 중복 요청, 취소·세대 교체,
commit 전후·응답 유실 시험을 추가했다. 전체 검사와 CI 결과는 PR에 기록한다.
Orchestrator는 클라이언트 타입·H3 저장 id 연결·취소 계약을 검토한다(A).
화면 이전과 표시 분할은 이 PR에 포함하지 않는다.
