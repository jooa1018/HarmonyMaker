# Quick Harmony API — H1 1-1 초안

상태: A등급 검토 대기. H3 구현 기준으로 확정하기 전 Orchestrator 판정이 필요하다.

## 이번 PR 범위

`src/product/quick-harmony.ts`는 기존 자동 초안 엔진을 브라우저에서 호출하는 진입점이다. 서버 요청, 자동 저장, 화면 변경은 없다. 엔진 규칙과 저장 형식도 그대로 사용한다.

1-1 API 초안과 1-4 권리 확인을 포함한다. 현재 성부 선택은 `auto`, `["alto"]`, `["tenor"]`다. 1-2에서 `["alto", "tenor"]`와 정규화·정책 버전 호환을 추가한다. 아직 두 파트를 전달하면 입력 오류다. 현재 지원 박자는 2/4·4/4·6/8이며 3/4·12/8은 1-3에서 추가한다. 전체 안내 코드 대응표와 위치 표현 통일은 1-5의 후속 작업이다.

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
    parts?: "auto" | readonly ["alto" | "tenor"];
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
| `questions`, `reasons`, `notes` | `id`, `messageKo`, `actionKo`, `choices: { value, labelKo }[]` 목록. `notes`는 접힌 참고로 표시한다. |
| `details.assessment` | 기존 내부 판정, 원시 finding 코드, provenance. 자세히에서만 표시한다. |
| `details.importError` | 파일 읽기에 실패한 내부 오류. 일반 안내 문구 대신 노출하지 않는다. |

prepare는 생성 권리를 부여하지 않는다. `RIGHTS_CONFIRMATION_REQUIRED`는 `details`에 보존하되 일반 질문에서 제외하여, 사용자에게 생성 버튼의 체크박스 한 번만 요구한다. `ready`는 권리가 이미 확인됐다는 의미가 아니다.

generate는 전달받은 판정·질문·자세히를 신뢰하지 않는다. 현재 workspace의 journal과 증거를 검증하고, 선택한 파트·사용자 답·권리 입력으로 기존 자동 초안을 다시 판정한다. 새로운 판정은 반환값의 `preparation`에 담긴다.

## 생성 결과와 실패

| `status` | 반환값과 화면 처리 |
|---|---|
| `complete` | `project`, `generation`, `preparation`. 지원 구간의 생성 완료. |
| `partial` | 같은 필드. 일부 구간만 생성됐으므로 완료로 표시하지 않고 기존 generation 진단을 안내한다. |
| `blocked` | `diagnostics`, `preparation`, 선택적 `project`. 생성 차단이며 재생 가능한 결과로 취급하지 않는다. |
| `needs-input` / `unsupported` | `preparation`. 프로젝트를 만들지 않았다. |

UI는 `complete`/`partial`을 명시적으로 분기한다. 기존 내부 `generated`는 엔진 시도가 차단된 경우도 포함하므로 이 API는 그 문자열을 성공으로 노출하지 않는다.

입력 오류는 한국어 `message`와 안정된 `code`를 가진 `QuickHarmonyInputError`로 reject한다.

| code | 조건 |
|---|---|
| `QUICK_HARMONY_RIGHTS_REQUIRED` | `rightsConfirmed`가 정확히 `true`가 아님 |
| `QUICK_HARMONY_CHOICE_INVALID` | 허용되지 않은 파트·답·필드, 누락되거나 잘못된 확인 시각 |
| `QUICK_HARMONY_LEAD_INVALID` | 존재하지 않거나 음표 없는 Lead 선택 |

workspace 위조·증거/이력 불일치 등 기존 무결성 오류는 reject를 유지한다. 일반적인 파일 형식·크기·안전 검사 실패는 `unsupported` 판정으로 반환한다. 예상하지 않은 내부 오류를 생성 성공으로 바꾸지 않는다.

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
