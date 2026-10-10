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

마디 범위가 있으면 내부 마디 ID를 **인쇄 마디 번호**로 바꿔 `12마디: …`처럼 표시한다.
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

H3 참고: 화면에서 같은 생성을 재시도해도 라이브러리에 중복 항목이 생기지 않도록 저장 id를 정하는 방법은 H3에서 정한다.
