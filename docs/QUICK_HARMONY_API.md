# Quick Harmony API — WAG v1.1

`src/product/quick-harmony.ts`는 MusicXML 자동 판정과 로컬 화음 생성의 진입점이다.
1-1·1-4는 PR #14, 1-2 다중 파트와 1-3 박자는 승인된 PR #16으로 병합됐다.
화면용 요약(1-6)과 안내 코드 대응표(1-5)를 함께 제공한다.

`parts`는 `auto`, `["alto"]`, `["tenor"]`, 두 파트 배열을 받는다. 역순은 알토→테너로
정규화하고 빈 배열·중복·알 수 없는 파트는 거부한다. 지원 박자는 2/4·3/4·4/4·6/8·12/8이다.
3/4 주 박은 4분음표, 12/8은 점4분음표이며 자동 연습 템포는 점4분음표 60이다.
3/8·9/8과 전조는 지원하지 않는다.

알토는 항상 Lower, 테너는 항상 Upper다. auto로 선택된 기본 파트에도 같은 역할을 적용한다.
기존 WAG의 `Upper > Lead > Lower` 배치, 독립 marginal 검증과 pair gate를 그대로 사용한다.
테너 v2 프리셋은 **악보 높이** hard C4–A5, comfortable D4–G5이며,
`notationOctaveShift: -1`로 한 옥타브 낮게 재생한다(실제 소리 C3–A4 / D3–G4).
알토 음역은 기존 F3–D5 / A3–C5다. MusicXML은 G2 및 `clef-octave-change=-1`,
ABC·abcjs는 `clef=treble-8`을 사용한다. 엔진 배치·음역 검사는 악보 높이를 사용한다.
MusicXML의 테너 `<pitch>`는 소리 높이(내부 악보 높이에서 한 옥타브 아래)로 내보내며,
옥타브 clef가 악보상 위치를 표시한다. 별도 `<transpose>`를 더해 중복 이동하지 않는다.

정책 표식은 `hm-auto-draft-policy-v2`, 파트 프리셋은 `hm-harmony-part-presets-v2`,
생성 규칙은 `grammar-v1.1`이다. 기존 v1 표식과 v1.0.1 프로젝트는 해당 버전으로 재검증한다.
기존 프로젝트 편집은 저장된 intent 버전을 따르며 자동 업그레이드하지 않는다.
새 quick-harmony 생성은 v1.1을 사용한다. 미등록 버전은 `WAG_VERSION_UNSUPPORTED` 또는
프로젝트 경계의 `PROJECT_INTEGRITY_INVALID`로 거부한다. 선택 옥타브 필드가 없는 기존
프로젝트·공유 데이터는 0으로 처리한다.

## 함수와 입력

```ts
prepareQuickHarmony(file: {
  bytes: Uint8Array;
  fileName: string;
}): Promise<QuickHarmonyPreparation>

prepareQuickHarmonyWorkspace(workspace: ScoreWorkspace): Promise<QuickHarmonyPreparation>

generateQuickHarmony(
  preparation: QuickHarmonyPreparation,
  choice: {
    parts?: "auto" | readonly ["alto" | "tenor"]
      | readonly ["alto", "tenor"] | readonly ["tenor", "alto"];
    rightsConfirmed: true;
    confirmedAt: string;
    answers?: {
      lead?: string;
      unreadPrintedChords?: "carry-previous";
    };
  },
): Promise<QuickHarmonyResult>
```

- 파일 확장자는 `.musicxml`, `.xml`, `.mxl`이다. 기존 XML·MXL 보안 검사와 크기 제한을 재사용한다. 파일을 서버로 전송하지 않는다.
- `parts` 생략 또는 `auto`는 기존 Lead 중앙 음높이 기준 기본 파트를 사용한다.
- `confirmedAt`은 **선택 전체의 확정 시각**이다. 권리 확인 기록과 Lead 선택 journal 기록에 함께 쓰인다. `new Date(x).toISOString() === x`인 정규 ISO UTC 문자열만 받는다(예: `2026-10-09T10:00:00.000Z`). 날짜만 쓰거나 오프셋 등 다른 표기를 쓰면 `QUICK_HARMONY_CHOICE_INVALID`로 거부한다. 같은 선택을 재시도할 때는 같은 값을 유지한다. 엔진 내부에서 현재 시각을 생성하지 않는다.
- `lead`에는 판정 질문의 `choices[].value`를 전달한다. 존재하며 음표가 있는 성부인지 재검증하고, 명시적 사용자 선택으로 journal에 기록한다. 사람의 악보 대조 기록은 만들지 않는다.
- `unreadPrintedChords`는 기존 자동 초안의 판독 불가 코드 질문에 대한 답이다. 순수 MusicXML에는 보통 나타나지 않는다. 기본값으로 이전 코드를 유지하지 않는다.
- 마디 길이·음표 등의 교정은 기존 workspace 편집 API로 수행하고, `prepareQuickHarmonyWorkspace(editedWorkspace)`로 다시 판정한다. `edit-in-workspace` 선택지는 편집 화면으로 이동하는 행동이며 `answers` 값이 아니다.

## 판정 결과

| 필드 | 의미 |
|---|---|
| `status: ready` | 음악 입력이 자동 생성 가능한 상태. 생성 버튼에서는 여전히 권리 확인이 필요하다. |
| `status: needs-input` | `questions`의 사용자 선택이나 악보 교정이 필요하다. |
| `status: unsupported` | `reasons`의 지원 범위 또는 파일 읽기 문제로 생성할 수 없다. |
| `workspace` | 검증한 불변 작업 공간. 파일을 읽을 수 없으면 없다. |
| `summary` | 화면용 제목·조성·박자·마디·가사·추천 파트. 내부 `details`를 읽을 필요가 없다. 아래 형식 참고. |
| `questions`, `reasons`, `notes` | `id`, `messageKo`, `actionKo`, `choices: { value, labelKo }[]` 목록. `notes`는 접힌 참고로 표시한다. |
| `details.assessment` | 기존 내부 판정, 원시 finding 코드, provenance. 자세히에서만 표시한다. |
| `details.importError` | 파일 읽기에 실패한 내부 오류. 일반 안내 문구 대신 노출하지 않는다. |

prepare는 생성 권리를 부여하지 않는다. `RIGHTS_CONFIRMATION_REQUIRED`는 `details`에 보존하되 일반 질문에서 제외하여, 사용자에게 생성 버튼의 체크박스 한 번만 요구한다. `ready`는 권리가 이미 확인됐다는 의미가 아니다.

generate는 전달받은 판정·질문·자세히를 신뢰하지 않는다. 현재 workspace의 journal과 증거를 검증하고, 선택한 파트·사용자 답·권리 입력으로 기존 자동 초안을 다시 판정한다. 새로운 판정은 반환값의 `preparation`에 담긴다.

## 쉬운 안내 문구 대응표

`src/product/quick-harmony-notices.ts`의 `QUICK_HARMONY_NOTICE_CATALOG`가
질문·지원 안 함·경고 코드에 대한 한국어 문장, 행동 안내, 고정 선택지의 단일 대응표다.
화면은 `questions`·`reasons`·`notes`의 `messageKo`, `actionKo`, `choices`를 그대로 표시한다.
원시 finding의 문장을 기본 화면에 표시하지 않는다. 내부 코드와 원래 진단은 `details`에 남는다.

| 코드 계열 | 안내 내용 |
|---|---|
| `LEAD_*`, `RIGHTS_CONFIRMATION_REQUIRED` | 기준 멜로디 선택·음표 유무·권리 확인 |
| `PRINTED_CHORD_*`, `LYRIC_UNCERTAIN` | 코드·가사 판독, 명시적으로 선택한 앞 코드 이어 쓰기 |
| `METER_*`, `TIMELINE_*`, `RHYTHM_SLASH_UNCERTAIN` | 박자표·마디 길이·리듬 기호 확인 |
| `OMR_*`, `LEGACY_UNCERTAINTY`, `UNCLASSIFIED_UNCERTAINTY` | 기존 작업 공간의 원본 비교·미확인 부분 |
| `UNSUPPORTED_*`, `INPUT_UNINTERPRETED` | 지원 범위와 악보 수정·재업로드 방법 |
| `STRUCTURE_*` | 음표 겹침·길이·음높이·조성·코드·가수 음역 등 교정 |
| `FERMATA_AS_WRITTEN` | 늘임표의 추가 길이를 반영하지 않는 재생 |
| `AUTOMATIC_VALUES`, `FILE_UNREADABLE` | 자동 설정 참고·파일 읽기 실패 |

마디 범위가 있으면 내부 마디 ID를 **인쇄 마디 번호**로 바꿔 `12번째 마디: …`처럼 표시한다.
악보 설정 문제는 `악보 설정`, 곡 전체 문제는 `악보 전체`, 파일 문제는 `파일`로 위치를 표시한다.
마디 위치를 찾을 수 없으면 `위치를 확인할 수 없는 마디`라고 표시하고 번호를 만들어 내지 않는다.
멜로디 선택지는 실제 악보의 후보로 채우며, 코드 질문의 `carry-previous` 및
`edit-in-workspace` 값은 기존 계약을 유지한다. 권리 확인은 생성 시 한 번 받으므로
일반 preparation 질문에서는 계속 제외한다.

시험은 판정 코드 생성부와 구조 검사에서 나오는 코드들을 읽어 대응표의 누락을 검사한다.
미등록 코드가 런타임에 들어오면 현재 질문·지원 안 함·경고 분류를 유지한 채 일반 안내를 제공한다.
안내 문구는 화면 표시용이며, 저장된 원시 진단·생성 규칙·판정 등급을 바꾸지 않는다.

## 생성 결과와 실패

| `status` | 반환값과 화면 처리 |
|---|---|
| `complete` | `project`, `generation`, `preparation`, `parts`. 명시 요청한 모든 파트가 완성됨. |
| `partial` | 같은 필드. 일부 파트나 구간만 생성됐으므로 `parts`의 누락 위치와 안내를 표시한다. |
| `blocked` | `diagnostics`, `preparation`, `parts`, 선택적 `project`. 요청 파트가 모두 없거나 엔진이 차단됨. |
| `needs-input` / `unsupported` | `preparation`. 프로젝트를 만들지 않았다. |

각 파트는 `{ part, status: "complete" | "partial" | "missing", missingMeasures, reasonKo }`로 반환한다.
명시 요청은 알토→테너 순서로 모두 보고하며, 빠진 파트를 숨긴 채 complete로 처리하지 않는다.
`missingMeasures`는 선택된 결과에서 코드가 있는 Lead 음표 구간을 덮지 못한 **원본 마디 번호**다.
번호는 정렬·중복 제거하므로 반복 연주의 같은 원본 마디는 한 번만 나온다. 원본 쉼표·N.C.는
누락으로 세지 않는다. 생성 전 Source 차단으로 마디를 확정할 수 없으면 빈 목록과 차단 안내를 준다.
`reasonKo`는 UI에서 직접 표시할 수 있다. 원시 엔진 `generation.status`보다 바깥쪽 `status`가
사용자가 요청한 파트의 충족 여부를 나타낸다. auto의 전체 상태는 기존 WAG 18.5 optional 계약을 유지한다.
questions·reasons·notes 및 parts[].reasonKo의 위치 표기는 `N번째 마디`로 통일한다.
여러 누락 위치는 `1·2·4번째 마디에서 …`처럼 표시하며, 마디 개수를 나타내는 요약과 구분한다.

UI는 `complete`/`partial`을 명시적으로 분기한다. 기존 내부 `generated`는 엔진 시도가 차단된 경우도 포함하므로 이 API는 그 문자열을 성공으로 노출하지 않는다.

입력 오류는 한국어 `message`와 안정된 `code`를 가진 `QuickHarmonyInputError`로 reject한다.

| code | 조건 |
|---|---|
| `QUICK_HARMONY_RIGHTS_REQUIRED` | `rightsConfirmed`가 정확히 `true`가 아님 |
| `QUICK_HARMONY_CHOICE_INVALID` | 허용되지 않은 파트·답·필드, 누락되거나 잘못된 확인 시각 |
| `QUICK_HARMONY_LEAD_INVALID` | 존재하지 않거나 음표 없는 Lead 선택 |

workspace 위조·증거/이력 불일치 등 기존 무결성 오류는 reject를 유지한다. 일반적인 파일 형식·크기·안전 검사 실패는 `unsupported` 판정으로 반환한다. 예상하지 않은 내부 오류를 생성 성공으로 바꾸지 않는다.

## 화면용 판정 요약

```ts
summary?: {
  title: string | null;
  keyLabelKo: string; // "G장조", "E단조", 해석되지 않으면 "조성 확인 필요"
  meters: readonly string[]; // 인쇄 순서의 중복 없는 박자, 예: ["3/4", "4/4"]
  measureCount: number; // 선택된 멜로디 파트의 인쇄 마디 수, 반복 전
  hasLyrics: boolean;
  verseCount: number; // 선택된 멜로디에 실제 글자가 있는 서로 다른 절 번호 수
  recommendedPart: "alto" | "tenor"; // auto와 같은 중앙 음높이 규칙
}
```

파일을 읽지 못하거나, 멜로디가 아직 선택되지 않았거나, 멜로디 음표가 없으면 요약은 없다.
성부 선택 후 재판정한 `preparation.summary`를 사용한다. 제목은 현재 가져오기/편집 값을
쓰며, 가져오기의 기본 표기 `제목 없음`을 보존하고 빈 제목은 null이다. 조성은 선택된
멜로디의 첫 마디에서 판정한 값이다. 여러 조성이 있는 경우 지원 판정은 `reasons`를 따른다.
추천은 사용자의 명시적 파트 선택과 별개이며, 같은 악보·선택 상태에서 결정적이다.
화면이 바꾼 summary는 생성 입력으로 신뢰하지 않고 현재 작업 공간에서 다시 계산한다.

## 저장된 프로젝트 읽기 (1-8)

`src/product/project-view.ts`에서 다음 두 함수를 가져온다.

```ts
const song = describeHarmonyProject(project); // 동기, 예외를 던지지 않는 화면 요약
const view = await projectPracticeView(project); // 반주 포함, 비동기
```

`describeHarmonyProject`는 `{ title, keyLabelKo, meters, measureCount, parts }`를 반환한다.
제목·조성은 preparation.summary와 같은 규칙이며, 박자는 인쇄 순서에서 중복 제거하고
마디 수는 반복 전 인쇄 마디 수다. `parts`는 멜로디를 제외한 생성 화음 트랙의 정규 순서다.
각 항목은 `{ role: upper | lower | other, label, part?, status?, missingMeasures?, reasonKo? }`다.
`reasonKo`는 일부·누락 결과의 저장된 진단에서 복원 가능한 경우만 제공한다. 현재는 선택된 결과의 `WAG_V1_PARTIAL_REQUIRED_COVERAGE`, 또는 같은 생성에서 해당 트랙을 명시한 후보 진단을 생성 직후와 같은 문구 함수로 해석한다. 편집 결과는 해당 스냅샷의 검증 진단만 사용한다. 다른 후보의 위치 없는 진단, 다른 트랙·알 수 없는 코드·진단 없는 기록에서는 추측하지 않고 생략한다. 프로젝트 바이트와 내부 진단은 바꾸지 않는다.
quick-harmony v2에서는 알토·테너 이름과 part를 제공한다. 기존 프로젝트는 기존 역할
레지스트리의 이름을 유지하며 part를 추측하지 않는다. 역할이 혼합되거나 없으면 other다.
활성 결과를 읽을 수 있으면 quick-harmony와 같은 기준으로 complete·partial·missing 및
누락된 인쇄 마디 번호를 계산한다. 결과가 없으면 상태 필드를 생략하며 완료로 단정하지 않는다.
불완전한 옛 자료도 읽을 수 있는 요약을 반환한다. 이 요약 자체는 무결성 검증이 아니다.

`projectPracticeView`의 반환형은 다음과 같다.

```ts
Promise<
  | { status: "available"; abc: string; plan: PlaybackPlan; tempo: TempoSpec; identity: string }
  | { status: "unavailable"; code: string }
>
```

선택된 preset(없으면 standard)의 현재 전체 결과를 구체화하고 기존 ABC·반주·PlaybackPlan
경로를 재사용한다. identity는 `${artifactDigest}:full`이다. 반주 계산을 마친 뒤 available을
반환한다. H3는 available일 때만 플레이어 컴포넌트를 마운트하고 네 입력을 훅에 넘긴다.
미생성·오래된 결과는 `ACTIVE_ARRANGEMENT_UNAVAILABLE` 또는 `PROJECT_AUTHORITY_STALE`,
표기 제한은 `ABC_SERIALIZATION_UNAVAILABLE`로 unavailable을 반환한다. 검증되지 않은 편집
스냅샷·잘못된 렌더 자료 등 기존 무결성 오류는 reject하므로 호출부에서 처리해야 한다.
각 호출은 첫 await 전에 표시·반주 입력을 복사한다. 동시 호출이 서로의 결과를 수정하지 않으며,
저장 프로젝트·digest·공유 형식은 변경하지 않는다.

## 연습 재생 훅 (1-7)

`src/product/use-practice-player.ts`의 `usePracticePlayer`는 클라이언트 컴포넌트에서 호출한다.
화면의 `<div ref={player.scoreRef} />`에 abcjs 악보를 그리며 버튼·믹서는 화면이 그린다.

```ts
const player = usePracticePlayer({
  abc, plan, tempo, identity,
  initialSettings, // 공유 데이터의 PracticeSettings. 해당 identity의 처음 상태
  preferredMeasuresPerLine: narrow ? 2 : 4, // 기본 4
});
```

반환형 `PracticePlayerController`:

- `scoreRef`, `scoreReady`, `error`
- `phase: ready | starting | playing | paused | finished`, `positionQuarter`, `totalQuarter`
- `secondsPerQuarter`, `speed`, `tracks: { id, label, kind, role }[]`
- `muted`, `solo`, `bandEnabled`, `levels`, `masterLevel`
- `play()`, `pause()`, `restart()`, `setSpeed(speed)`
- `toggleMute(trackId)`, `toggleSolo(trackId)`, `setBandEnabled(on)`
- `setLevel(trackId, level)`, `setMasterLevel(level)`

`play()`는 ready·finished에서 처음부터, paused에서 이어서 재생한다. starting·playing에서는
중복 시작하지 않는다. `restart()`는 멈추고 처음으로, `setSpeed()`도 처음으로 돌아간다.
지원되는 브라우저에서는 재생 버튼으로 시작할 때만 `navigator.audioSession.type = "playback"`을 요청한다.
페이지를 열 때는 설정하지 않는다. 기존 suspend → 음 예약 → resume 순서를 유지한다.
resume 거부 또는 3초 시간 초과 시 ready로 돌아가고 “소리를 켜지 못했어요. 재생 버튼을 다시 눌러 주세요.”를 표시한다.

속도는 `PracticeSpeed`의 50·75·100·125·150이다. 파트 음량은 0–2, 전체 음량은 0–1로 제한한다.
솔로는 한 트랙만 켜지고 음소거는 여러 트랙에 적용할 수 있다. 믹서는 재생 중에도 적용된다.
identity가 바뀌거나 컴포넌트가 사라지면 이전 오디오와 타이머를 해제한다.
다른 identity는 새 초기 설정을 적용한다. 같은 identity에서 초기 설정 변경은 재생 상태를 덮어쓰지 않는다.

트랙 역할은 실행 중 `PlaybackPlan.trackRoles`에서 읽는다. `buildPlaybackPlan`이 역할
레지스트리에서 채우며 표시 이름으로 추측하지 않는다. `track:source-lead`는 lead,
`track:band`는 band, 하나의 역할만 있으면 upper/lower, 혼합·정보 없음은 other다.
이 선택 필드는 프로젝트·공유 데이터·digest에 저장하지 않는다. 반주가 없으면 tracks에도 없다.
H3는 `tracks.some(t => t.kind === "band")`로 반주 스위치 표시 여부를 정한다.
시간 표시는 `positionQuarter * secondsPerQuarter`, 전체 시간은 `totalQuarter * secondsPerQuarter`다.
기존 ProductPracticePlayer도 같은 훅을 쓰며 기존 Play(처음부터)·Resume(이어서) 버튼을 유지한다.

## 멜로디 가사 표시 (1-9)

`arrangementRenderDocumentToAbc`는 원본 가사를 멜로디 보이스의 `w:` 줄로 표시한다.
여러 절은 절 번호 오름차순으로 한 줄씩 넣는다. 쉼표·빈 구간·붙임줄에서도 다음 가사의
음표 위치를 유지하며, 화음 보이스에는 가사를 중복하지 않는다. 가사가 없으면 기존 ABC와 같다.
표시 중 원본 가사·생성 음·프로젝트 저장 바이트·결과물 digest·재생 음높이와 길이는 바뀌지 않는다.
ABC 제어 문자는 표시할 때만 이스케이프하고 줄바꿈은 공백으로, 주석 문자 `%`는 `％`로 표시한다.

새 공유는 기존 schemaVersion 4의 `lyricTokenIds`에 모든 절의 음표 연결을 담으므로 공유
악보에서도 같은 가사를 표시한다. 예전 공유는 남아 있는 연결만 표시한다. 가사 텍스트만 있고
음표 연결이 없는 옛 공유의 다른 절은 위치를 추측하지 않는다. 공유 형식의 버전은 유지한다.

## 화면 호출 예시

```ts
import { prepareQuickHarmony, generateQuickHarmony } from "../product/quick-harmony";
import { IndexedDbProjectStore } from "../product/local-project-store";

const prep = await prepareQuickHarmony({
  bytes: new Uint8Array(await file.arrayBuffer()),
  fileName: file.name,
});
// questions/reasons/notes를 표시한다. 아래 코드는 사용자가 권리를 확인한 뒤 실행한다.
const confirmedAt = new Date().toISOString(); // 선택 전체를 확정할 때 한 번 기록, 같은 선택 재시도에 재사용
const result = await generateQuickHarmony(prep, {
  parts: ["alto"],
  rightsConfirmed: true,
  confirmedAt,
});

if (result.status === "complete" || result.status === "partial") {
  // 저장 id는 라이브러리 항목의 식별자다. 음악 생성의 입력으로 사용하지 않는다.
  const projectId = crypto.randomUUID();
  await new IndexedDbProjectStore().saveNew({
    projectId, updatedAt: confirmedAt, project: result.project,
  });
}
```

권리에는 `basis: "user-confirmed-rights"`, `allowedUses: ["generation"]`, `confirmedAt`만 기록한다. 공유·평가·외부 전송 권한은 부여하지 않는다. 반환 프로젝트는 기존 자동 초안 표식과 provenance를 유지하며 기존 IndexedDB 저장소와 project export/import로 읽힌다. 생성 함수 자체는 기존 저장 항목을 덮어쓰지 않는다.

같은 파일·파일명, 같은 알고리즘 버전, 같은 선택·확인 시각·workspace 이력은 같은 export 바이트를 만든다. 파일명이나 권리 확인 시각을 바꾸면 보존 메타데이터는 달라질 수 있지만 이를 음악적 선택의 근거로 쓰지 않는다.


## 파일 파싱 상세 진단 (1-13)

표준 MusicXML DOCTYPE은 루트 앞에 하나만 있을 때 제거한 뒤 파싱한다. 외부 DTD는 읽지 않는다. 내부 서브셋·ENTITY·중복/루트 뒤 선언·다른 선언 루트·XInclude·NUL은 계속 차단한다. 원본 파일과 출처 digest는 선언을 포함한 원본을 보존한다.

파일 오류의 `details.importError`와 함께 선택 필드 `details.importDiagnostics`가 구체 사유를 제공한다. 각 항목은 기존 가져오기 진단의 code·messageKo·details를 보존하며, details.reason으로 forbidden-doctype·malformed-xml·invalid-utf8·xml-size-limit·unsupported-score-root 등을 구분한다. 사용자용 기본 문구는 유지한다. score-timewise 선언 자체는 안전 파서를 통과하지만 기존 엔진의 score-partwise 입력 지원 범위는 확장하지 않는다.

## MusicXML 코드 글자 해석 (1-15)

`kind="other"`이고 degree 요소가 없을 때만 근음 + kind의 text + 베이스를 기존 코드 파서로 읽는다.
완전히 해석되면 canonicalSymbol을 다시 파싱해 무결성이 확인된 결과를 사용한다.
C2·G2는 Cadd2·Gadd2로, C2/G는 Cadd2/G로 정규화되어 major + degree add2와 같은 의미를 갖는다.
이 처리는 새 other 가져오기 경로에 한정한다. 공통 코드 파서와 기존 프로젝트는 변경하지 않는다.
원래 코드 표기는 출처에 남기고 notes에 “N번째 마디: 코드 이름 C2를 글자대로 읽었어요.”처럼 표시한다.
빈 text·해석 실패·degree가 있는 other는 계속 질문으로 남긴다.

## 이음줄 공유 (1-17)

원본 멜로디에 이음줄이 있으면 `materializePracticeShare`는 V5를 반환한다. V5는 V4를 바탕으로 원본 note/rhythm 이벤트의 선택 필드 `slurs: { number, type: "start" | "stop" | "continue" }[]`를 보존한다. 번호·중복·시작/끝 연결을 검증하며, 공유 악보에도 같은 이음줄을 표시한다. 이음줄만으로 재생 음을 붙임줄처럼 합치지 않는다.

이음줄과 셋잇단이 모두 없는 출력은 기존 V4 바이트를 유지하고, V3·V4 읽기도 유지한다. 크기 제한은 그대로다. `tuplets`도 같은 V5의 선택 필드로 통합하며, 잘못된 비율·묶음·알 수 없는 필드와 V4의 새 필드는 거부한다. 첫 코드 선행 적용 정책과 별도 원본 리듬 성부는 아직 공유할 수 없다.

## 연습 음원 파일 (1-20)

`src/product/render-practice-audio.ts`의 `renderPracticeAudio({ plan, tempo, speed, mix, bandEnabled, signal? })`는 `{ blob, seconds, bytes }`를 비동기로 반환한다. `projectPracticeView`의 plan·tempo와 플레이어의 speed를 그대로 전달한다. mix는 `{ kind: "full" }` 또는 `{ kind: "emphasize", trackId }`이며, 강조할 성부는 기본 크기, 다른 성부는 0.35배다. 반주는 bandEnabled일 때만 기본 크기로 들어간다. 없는 트랙이나 반주를 강조 대상으로 주면 `PRACTICE_AUDIO_MIX_INVALID`로 거부한다.

실시간 재생과 같은 음색·엔벨로프·리미터를 OfflineAudioContext로 렌더한다. WAV는 PCM 16-bit 모노 22,050 Hz이고 최대값을 -1 dBFS로 맞춘다(전부 무음이면 무음 유지). 길이는 곡 끝까지이며 프레임 단위로 올림한다. Blob의 MIME은 audio/wav다. 서버 전송과 저장은 하지 않으며 파일 이름과 다운로드 UI는 호출자가 정한다.

signal 취소는 AbortError로 끝나고 파일을 반환하지 않는다. OfflineAudioContext에는 close API가 없으므로 렌더 중에는 1초 분량 간격의 오디오 시각 체크포인트에서 일시정지하고 다시 시작하지 않는다. PCM 변환 중에도 취소를 확인한다. 각 호출은 독립 컨텍스트를 사용한다. API 미지원·렌더 실패는 reject되므로 화면에서 오류를 처리한다.

## 셋잇단음표 (1-14, WAG v1.2)

멜로디 한 보이스의 4분·8분·16분 3:2 셋잇단(쉼표·붙임줄 포함)을 지원한다. `duration/divisions`와 적힌 음가, 3:2 비율, 연속 묶음의 정확한 합계를 검증한다. 명시적 start/stop이 없으면 같은 마디의 같은 음가 3개만 복원한다. 중첩·다른 비율·불일치·모호한 묶음·꾸밈음·cue·장식음은 지원 안 함이다.

검증된 셋잇단이 있는 **새 생성**만 WAG v1.2를 선택한다. 셋잇단 없는 요청은 v1.0.1/v1.1 선택과 결과 바이트를 유지한다. 기존 프로젝트를 열거나 편집·저장하는 것으로 버전이 바뀌지 않으며, 미등록 버전은 차단한다. 화음은 기존 Lead 결합 리듬·음역·배치·attack cap·탐색 범위를 사용한다. 부족한 파트는 partial/missing으로 보고한다.

원본 이벤트·atom·V5 원본 이벤트의 선택 필드 `tuplets`는 단일 묶음의 `{number, actualNotes:3, normalNotes:2, normalType:"quarter"|"eighth"|"16th", start?:true, stop?:true}[]`다. 전체 묶음과 분수 시간은 저장·MusicXML·PlaybackPlan에서 보존한다. ABC만 마디별 `(3:2:r` 구간으로 나누므로 마디를 넘는 묶음은 각 표시 구간마다 “3”이 붙는다. abcjs 6.7은 한 음짜리 `(3:2:1`의 종료를 처리하지 못하므로, 마디를 넘는 원본 묶음에서 한 마디에 음이 하나뿐인 경우는 가져오기에서 지원 안 함으로 판정한다. 정확히 나타낼 수 없는 표시를 근사하지 않는다. 생성된 이진 길이 유지음은 보통 음표로 표시하며 재타격을 추가하지 않는다.

`/score-workspace`는 분수 시간을 보존하고 음높이 편집이 가능하다. 묶음 시간을 깨뜨리는 편집은 `WORKSPACE_TUPLET_EDIT_UNSUPPORTED`로 거부한다. 가져오기 복구(`recovery.ts`)도 원래 셋잇단 음가를 유지하는 음높이·쉼표 수정을 지원한다. 고정 64 격자를 쓰는 예전 구조 복구 편집기는 “셋잇단음표가 있는 악보는 구조 복구 편집을 아직 지원하지 않아요.”로 명시적으로 거부한다. 그 편집기의 저장 형식은 확장하지 않는다.

H3 참고: 화면에서 같은 생성을 재시도해도 라이브러리에 중복 항목이 생기지 않도록 저장 id를 정하는 방법은 H3에서 정한다.
