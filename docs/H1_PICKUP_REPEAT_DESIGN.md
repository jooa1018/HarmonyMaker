# H1 1-26 — 코드 없는 못갖춘마디와 반복: 설계 판정 요청

2026-10-12, 기준 develop `de3a798`. 이 PR은 조사·설계 문서만 포함한다.
승인 전 resolver·공유 검증·화면 동작은 바꾸지 않는다.

권장 범위는 **반복 밖의 첫 못갖춘마디 한 번에만 다음 첫 코드를 적용**하는 것이다.
못갖춘마디 자체가 반복되는 경우는 별도 정책 판단으로 남긴다.
악보 높이·음역·리듬·탐색·attack cap 등 WAG의 다른 규칙은 유지한다.

## 1. 현재 사용자가 보는 것

자작 4/4 MusicXML에 코드 없는 짧은 0번째 마디를 붙이고,
1번째 마디 왼쪽에 forward repeat, 4번째 마디 오른쪽에 backward repeat를 넣었다.
원본 순서는 `pickup, |: 1 2 3 4 :|`이고 pickup은 반복 밖이다.
실제 prepare/generate 반환과 현재 PreparationScreen의 React 정적 렌더를 대조했다.
이 확인은 실기기 클릭 시험이 아니며, H3 3-8 전 현재 화면 코드 기준이다.

| 단계 | 관찰 |
|---|---|
| 업로드 직후 | preparation.status=ready, questions/reasons는 빈 배열 |
| 자동 선택 | initialPickup=anticipate-first-chord |
| 화음 만들기 | result.status=blocked, 프로젝트 없음·저장 없음 |
| 내부 진단 | SOURCE_CHORD_GAP / initial-pickup-policy-ineligible / repeated-pickup-or-anchor |
| 다시 표시한 준비 화면 | preparation.status는 여전히 ready |
| 눈에 보이는 오류 | “악보 판정에서 생성이 중단됐어요.” — 요청 파트마다 한 번, 둘 다면 두 번 |
| 가능한 조작 | 다른 파일, 빠르기 조절/박자 두드리기, 파트 변경, 활성화된 화음 만들기 버튼 |
| 보이지 않는 것 | 반복 제한의 구체 사유, 이 경로의 고급 편집 버튼 |

`QuickFlow`는 source-blocked의 parts를 보여 주지만 diagnostics는 화면에 전달하지 않는다.
`자세히`도 preparation.details만 보여 주므로 이 resolver 사유는 나타나지 않았다.
같은 악보에서 빠르기·파트를 바꾸거나 재시도해도 구조적 원인은 해결되지 않는다.
사용자가 원본에 근거해 pickup 코드를 명시하거나, MuseScore에서 반복을 풀어 편집한
MusicXML을 다시 올리는 우회는 가능하지만 현재 화면은 이를 안내하지 않는다.
코드를 모르는 사용자에게 임의 코드를 적으라고 안내해서는 안 된다.

근거 파일:
`src/product/quick-harmony.ts`, `src/product/auto-draft.ts`,
`src/app/_quick/QuickFlow.tsx`, `PreparationScreen.tsx`, `selection.ts`.
로컬 조사 기록은 outputs/pickup-repeat-ui-probe.json에 보관했다(자작 악보만 사용).
PR #63의 MusicXML·도메인 시험도 현재 거부 사유를 고정한다.

## 2. 따라오는 첫 온마디만 반복되는 경우

### 허용 조건

새 resolver에서 다음 조건을 모두 확인한다.

1. 기존처럼 Source 첫 마디가 implicit이고, 명목 마디 길이보다 짧고 양수다.
   Lead의 음 범위가 유효하며, 인쇄 코드가 하나도 없고 실제 노래하는 구간이 있다.
2. 그 Source 마디는 펼친 연주 순서의 0번에 **한 번만** 나온다.
3. 연주 순서 1번은 Source의 바로 다음 마디이고, 그 Source 마디의 첫 연주다.
   두 occurrence의 박자·길이·Source 연결도 기존처럼 일치해야 한다.
4. 따라오는 마디의 onset=0에 confirmed·status=ok인 코드가 정확히 하나 있다.
   %, N.C., 미해석·미확인 코드, 0보다 늦은 첫 코드는 이 정책의 근거가 아니다.
5. 기존 repeat expander가 지원하는 구조로 정확히 펼쳐져 있어야 한다.
   반복 횟수·volta 해석을 이번 resolver에서 새로 추측하지 않는다.

이 조건에서는 **따라오는 마디의 반복 기호·volta·여러 occurrence 자체**만으로
거부하지 않는다. pickup 자체에 반복/volta가 있는 경우는 이번 권장 범위에서 계속 막는다.
volta로 실제 바로 다음 마디가 달라지거나 Source 인접 관계가 깨지면 여전히 막는다.

### 만들어지는 timeline

`P, A, B, A, B`에서:

| 연주 위치 | 코드 출처 |
|---|---|
| 0: P의 실제 노래 구간 | arrangement-policy, followingSourceChordEventId=A의 첫 인쇄 코드 |
| 1: A의 첫 연주 | 기존 source-event |
| 2: B | 기존 source-event/carry 규칙 |
| 3: A의 다음 연주 | 같은 원본 코드의 일반 source-event |
| 4: B | 기존 규칙 |

선행 구간은 기존 soundingLeadSegments로 만들며 P의 쉼표에 임의 반주를 채우지 않는다.
정책 span으로 previousState를 만들지 않는다. A의 인쇄 코드가 자기 onset에서
처음 authoritative state가 된다. 뒤의 코드 공백과 repeat second pass는
기존 carry-until-next/block-gap 규칙을 따른다.
Source의 코드·음표·반복·가사는 수정하지 않는다.

단순히 모든 반복 거부 조건을 삭제하는 변경은 하지 않는다.
기존 검사를 “pickup 쪽 제한”과 “첫 anchor의 실제 occurrence 조건”으로 나눈다.

## 3. 못갖춘마디 자체가 반복 안에 있는 경우

예: `|: P A B :|` → `P A B P A B`.
현재 코드의 0번 occurrence에만 적용하는 예외를 넓혀야 하므로 2절과 다르다.

검토 가능한 안은 각 P occurrence에서 **바로 다음 연주 occurrence**의 onset=0
confirmed 코드를 찾아 그 P의 실제 노래 구간에 적용하는 것이다.
Source 배열의 다음 마디나 곡 첫 코드만 반복 재사용해서는 안 된다.
volta 때문에 다음 occurrence가 달라지면 각 회차가 다른 코드에 연결될 수 있다.

위험과 필요한 추가 판단:

- 두 번째 P 앞에는 B의 코드 상태가 있다. 다음 A 코드를 선행 적용하면
  기존 “연주 순서의 직전 confirmed source에서 carry”보다 우선하는 새 정책이 된다.
  경과음·종지·연결 구간에서 의도와 다른 화음이나 반주 변화를 만들 수 있다.
- 마지막 P 뒤에 다음 마디가 없거나 다음 마디가 쉼/코드 공백·%·N.C.이면
  자동으로 첫 코드나 직전 코드로 대체할 수 없다. 해당 구간을 막아야 한다.
- 회차마다 다른 가사·붙임줄·이음줄·셋잇단·ending을 가진 경우 정책 구간과
  음/가사 연결을 그대로 보존해야 한다. 짧은 마디라는 이유만으로 모든 내부 마디를
  pickup으로 취급하면 안 된다.
- 같은 Source 코드가 여러 번 나올 때 Source id만으로는 어느 occurrence를
  바라보는지 부족하다. 공유에는 정책 구간의 end/다음 occurrence와 anchor의 위치를
  대조하거나 명시적 anchor occurrence 연결이 필요하다.
- 현재 initialPickup이라는 정책 이름·저장 의미, 공유의 “정책은 occurrence 0에만”
  검증도 바뀐다. 단순 count 검사 완화로 이 범위를 허용하면 안 된다.

**권장:** 이번 1-26 구현은 2절만 허용하고, 반복 안의 P는 명확한 안내로 막는다.
위 안은 별도 정책 식별자·resolver·청취 검토를 거쳐 결정한다.

## 4. 결정성·이전 프로젝트·버전 처리

### 같은 버전의 동작을 바꿀 수 없는 이유

명세 0.6·0.7(14–15), 코드 해석 invalidation, 26절에 따라 resolver version은
registry와 timeline에 같은 값으로 기록되고 재검증도 같은 알고리즘을 사용해야 한다.
현재 `chord-timeline-v1`은 Source review, WAG lifecycle, 프로젝트 무결성 검증에서
다시 호출된다. v1 구현을 그대로 넓히면 같은 input/version의 blocked 결과가 달라진다.

또한 `timelineProjection`은 resolverVersion을 digest에 넣는다.
이 값만 바꿔도 timeline·atomization·generation digest가 바뀌므로
“음이 같으니 모든 기존 프로젝트를 새 버전으로 읽어도 된다”는 방식은 안 된다.
과거에 이 구조의 빠른 생성 산출물이 없었다는 사실만으로 기존 workspace,
blocked/empty/stale 프로젝트, 다른 경로에서 편집한 프로젝트가 없다고 가정하지 않는다.

### 권장 버전 안 — 판정 필요

- 새 `chord-timeline-v2`를 등록하고 v1 구현/결과를 보존한다.
  등록되지 않은 버전 또는 registry 불일치는 명확히 차단한다.
- 현재 호환 registry는 grammarVersion을 키로 묶는다. 같은 grammarVersion에
  다른 resolver를 끼워 넣지 않고 **WAG v1.3 실행 묶음**을 추가하는 안을 권장한다.
  v1.2의 음악 규칙을 승계하고 변경점은 승인된 초기 코드 정책뿐이다.
  번호는 이 설계의 승인 대상이지 구현 확정값이 아니다.
- 새 생성 중 이 확장이 필요한 2절 입력에만 새 묶음을 선택한다.
  기존 비반복 pickup, 명시 코드 pickup, 일반 곡·기존 셋잇단의 버전 선택과 출력 바이트는 유지한다.
- 새 registry 선택은 Core review 이전이어야 한다. 현재 generateAutoDraftProject는
  workspace.algorithmVersions로 review를 실행하므로 WAG 생성 시점만 바꾸면 여전히 막힌다.
  대상의 새 생성에는 원본 evidence와 journal 명령을 유지한 새 생성용 workspace를
  등록된 registry로 만들고 검증·재생성한다. 저장된 원래 proof를 덮어쓰거나 재서명하지 않는다.
  기존 workspace를 단순히 열거나 편집·저장한 것만으로 버전을 올리지 않는다.
- Source proof/새 생성 registry → Core review → timeline → WAG → 생성 artifact →
  import/export·편집 snapshot 검증까지 같은 묶음으로 연결한다.
  v1.3 선택 근거는 검증된 생성 요청/registry 기록으로 봉인한다.
  단순 화면 DTO나 파일명, 불검증 marker는 선택 권위가 아니다.
- 현재 프로젝트 상위 timeline 검사는 기본 registry의 resolver와 비교하고,
  variant 검사는 grammar별 compatible registry를 고른다. **상위 검사와 variant가
  동일한 등록 묶음을 고르게 하는 변경**도 필요하다. v2 문자열만 허용하는 우회는 하지 않는다.
- 새 resolver로 재생성한 프로젝트는 새 결과다. 기존 저장 항목은 자동 덮어쓰지 않는다.
  workspace digest가 바뀌면 공통 quickHarmonyProjectId에도 반영되지만 기존 id 계산은 바꾸지 않는다.

이전 v1.0.1/v1.1/v1.2의 frozen authority·preset·resolver·snapshot 경로를 유지한다.
새 묶음 추가 시 hard-coded WAG/tuplet 허용 목록, source 정규화와 proof 검증도 함께
검토해야 한다(`grammar/versions.ts`, `authority.ts`, `lifecycle.ts`,
`product/registry.ts`, `domain/project-integrity.ts`, `integrity/edited-snapshot-*.ts`).
이는 버전 처리가 필요한 범위를 적은 것으로 아직 코드를 수정하지 않았다.

## 5. 공유 V5

2절이 구현되면 같은 Source anchor가 첫 연주와 반복 뒤 번에 모두 나타나므로
`anchors.count !== 1`은 완화해야 한다.

- 그 출처의 **첫 source-event**가 occurrence 1, offset 0이어야 한다.
- 정책은 occurrence 0의 짧은 범위에만 있고 그 첫 anchor와 같은 canonical chord여야 한다.
- 뒤의 같은 출처는 일반 source-event이며 같은 코드 의미를 유지한다.
  순서·범위·origin 번호·carried 이전 연결 검증은 유지한다.
- 같은 출처가 앞에 더 있거나, 다른 코드로 재사용되거나, 첫 anchor가
  occurrence 2 이상/offset 0 이외이면 거부한다.

2절은 기존 V5 필드만으로 표현 가능해 새 필드는 필요 없다.
현재 승인된 배포 전 V5 확장 규칙을 따르되, **운영 배포 뒤에는 지원 계약/공유 형식을
넓힐 때 새 schemaVersion을 배정**한다. 기존 V4/V5 읽기와 정책 없는 출력 바이트는 유지한다.
공유는 기록된 span을 복원할 뿐 새 resolver를 실행하지 않는다.
3절의 반복 pickup까지 지원하려면 별도 위치 연결과 정책 검증 설계를 먼저 승인받는다.

## 6. 안내와 검증 계획

H3와 연결할 안내 제안: 여전히 막히는 반복 pickup에는
“못갖춘마디가 반복되는 악보는 아직 화음을 만들 수 없어요.”
및 “MuseScore에서 반복을 풀어 연주 순서대로 적은 뒤 다시 올려 주세요.”를 제공한다.
단순 anchor 반복은 새 지원 조건을 충족하면 정상 생성으로 간다.
불일치·다른 실패까지 같은 안내로 덮지 않는다.
엔진에서 reasonKo/notice로 안전하게 변환하고, H3는 중복 제거·복구 동작을 연결한다.
준비 ready와 생성 blocked의 불일치는 생성 전 eligibility 평가와 같은 규칙으로 정리하는
안을 함께 판정받는다. 현재 UI·Worker에서 diagnostics를 그대로 보이는 변경은 하지 않는다.

승인 뒤 필요한 시험:

1. 실제 MusicXML `P |: A B :|`: P는 한 번, A는 두 번 이상.
   첫 P만 정책, 모든 A는 source-event, 직접 연주 순서로 펼친 대응 악보와 코드 범위 대조.
2. 2·3·4회 반복과 지원되는 1/2번 ending, 가사 다른 절.
   P 앞/뒤 비인접·source 혼동·누락 anchor·모호한 repeat는 거부.
3. `|: P A B :|`는 계속 거부. 마지막 P, 다른 volta successor 사례도 거부를 고정.
4. 명시 코드 P, N.C./%/미확인 코드, 여러 onset=0, 늦은 첫 코드,
   음역/배치/attack cap/partial 판정은 기존 규칙 그대로.
5. v1.0.1/v1.1/v1.2의 일반·비반복 pickup·편집·셋잇단 fixture를
   생성/열기/편집/저장 후 변경 전 바이트와 대조. 새 실행을 선택하지 않은 입력은 동일.
   v1 거부 고정, v2 성공, 미등록 버전·섞인 registry/proof/digest는 차단.
6. V5 round-trip의 첫 anchor/뒤 번 출처, ABC·MusicXML “편곡 정책” 표시,
   PlaybackPlan, 반주 digest와 크기 한도. 기존 V4/V5 바이트 회귀.
7. 자작 반복곡 알토·테너·둘 다 청취 세트와 UI의 blocked/복구 안내 대조.
   새 지원은 코드 해석 허용이며 모든 악보의 complete를 보장하지 않는다.

## 요청하는 판정

1. 이번 구현은 2절의 반복 밖 pickup만 허용하고, 반복 안 pickup은 보류할지.
2. 새 resolver v2 + 대상 새 생성에만 WAG v1.3 실행 묶음을 추가하는 버전 안,
   기존 proof를 보존하는 새 생성용 workspace 경계와 상위 무결성 검증 범위를 승인할지.
3. V5의 anchor 첫 출현 검증으로 제한적으로 완화하는 안을 승인할지.
4. 거부 사유를 준비 단계/한국어 notice와 맞추고 H3가 복구 동작을 연결하는 범위를 승인할지.

판정 전 구현하지 않는다.
