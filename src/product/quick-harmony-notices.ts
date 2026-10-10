import type { AutoDraftFinding } from "../import/workspace/auto-draft";

/** Shared presentation for fresh results and recoverable saved diagnostics. */
export function quickHarmonyPartReason(part: "alto" | "tenor", status: "complete" | "partial" | "missing", missingMeasures: readonly number[]): string {
  const name = part === "alto" ? "알토" : "테너";
  return status === "complete" ? `${name} 화음을 만들었어요.`
    : `${name} ${missingMeasures.length ? missingMeasures.join("·") + "번째 마디에서 " : ""}화음을 ${status === "missing" ? "만들지 못했어요" : "일부만 만들었어요"}. 음역과 기존 화음 규칙을 지키는 결과만 남겼어요.`;
}

export interface QuickHarmonyNotice {
  readonly id: string;
  readonly messageKo: string;
  readonly actionKo: string;
  readonly choices: readonly { readonly value: string; readonly labelKo: string }[];
}

interface NoticeCopy {
  readonly messageKo: string;
  readonly actionKo: string;
  readonly choices?: QuickHarmonyNotice["choices"];
}
const copy = (messageKo: string, actionKo: string, choices?: QuickHarmonyNotice["choices"]): NoticeCopy => ({messageKo, actionKo, ...(choices ? {choices} : {})});
const edit = {value:"edit-in-workspace",labelKo:"악보를 확인하고 고치기"} as const;
const rights = copy("이 악보로 화음을 만들 권리가 있는지 확인해 주세요.", "권리 확인란을 체크한 뒤 화음을 만들어 주세요.", [{value:"confirm-generation-rights",labelKo:"화음을 만들 권리 확인"}]);
const unreadable = copy("이 파일에서 악보를 안전하게 읽을 수 없어요.", "MuseScore에서 악보를 확인한 뒤 MusicXML(.musicxml, .xml, .mxl)로 다시 내보내 주세요.");

/** Presentation only: never rewrite the raw findings sealed into older projects. */
export const QUICK_HARMONY_NOTICE_CATALOG: Readonly<Record<string, NoticeCopy>> = {
  LEAD_SELECTION_REQUIRED: copy("화음의 기준이 될 멜로디를 골라 주세요.", "원래 노래 선율이 적힌 성부 하나를 선택해 주세요."),
  LEAD_WITHOUT_PITCHES: copy("선택한 멜로디에 음높이가 있는 음표가 없어요.", "음표가 있는 멜로디를 선택하거나 원본 악보를 확인해 주세요."),
  RIGHTS_CONFIRMATION_REQUIRED: rights,
  UNSUPPORTED_NOTATION: copy("아직 읽을 수 없는 악보 기호가 있어요.", "해당 기호를 MuseScore에서 확인하고, 지원되는 음표·쉼표로 정리한 뒤 다시 올려 주세요."),
  OMR_EVENT_SOURCE_LINK_UNCONFIRMED: copy("읽어 들인 음표가 원본과 같은지는 아직 확인하지 않았어요.", "생성은 가능하지만 음높이와 음표 길이를 원본과 비교해 주세요."),
  OMR_MEASURE_BOUNDARY_UNCONFIRMED: copy("읽어 들인 마디선이 원본과 같은지는 아직 확인하지 않았어요.", "생성 전에 원본의 마디선 위치와 비교해 주세요."),
  LYRIC_UNCERTAIN: copy("정확히 읽지 못한 가사가 있어요.", "가사와 음절이 시작되는 위치를 확인해 주세요. 화음 생성은 계속할 수 있어요."),
  PRINTED_CHORD_UNREAD_CARRIED: copy("읽지 못한 코드 구간에 앞의 코드를 이어 썼어요.", "사용자가 선택한 임시 처리예요. 원본 코드와 비교해 주세요."),
  PRINTED_CHORD_UNREAD: copy("악보에 적힌 코드를 읽지 못했어요.", "코드를 직접 고치거나, 읽지 못한 구간에서 앞의 코드를 이어 쓸지 선택해 주세요.", [
    {value:"carry-previous",labelKo:"읽지 못한 구간 모두 앞의 코드 이어 쓰기"},
    {value:"edit-in-workspace",labelKo:"악보에 적힌 코드 직접 입력하기"},
  ]),
  METER_TOKEN_UNCERTAIN: copy("박자표를 확실히 읽지 못해 음표 길이 검사 결과를 따랐어요.", "원본의 박자표와 비교해 주세요. 다른 문제가 없으면 화음을 만들 수 있어요."),
  METER_UNRESOLVED: copy("박자표를 읽지 못했고 음표 길이도 현재 박자와 맞지 않아요.", "박자표와 음표·쉼표 길이를 확인하고 고쳐 주세요."),
  TIMELINE_UNCERTAIN: copy("음표와 쉼표의 길이를 확인해야 해요.", "원본 악보에서 박자표와 각 마디의 음표·쉼표를 확인해 주세요."),
  TIMELINE_EVIDENCE_INCOMPLETE: copy("멜로디가 마디를 채우지만 원본과 길이가 같은지는 확인하지 않았어요.", "원본의 음표·쉼표 길이와 비교해 주세요. 화음 생성은 계속할 수 있어요."),
  TIMELINE_GAP: copy("멜로디의 음표·쉼표 길이가 마디 길이와 맞지 않아요.", "빠지거나 너무 긴 음표·쉼표가 있는지 확인해 주세요. 자동으로 채우거나 자르지 않아요."),
  RHYTHM_SLASH_UNCERTAIN: copy("확실히 읽지 못한 리듬 기호가 있어요.", "이 기호는 멜로디 음높이로 사용하지 않아요. 원본과 비교해 주세요."),
  LEGACY_UNCERTAINTY: copy("예전에 저장한 악보에 확인하지 않은 부분이 남아 있어요.", "해당 부분을 원본과 비교하고 고친 뒤 다시 판정해 주세요."),
  UNCLASSIFIED_UNCERTAINTY: copy("화음에 영향을 줄 수 있는 미확인 부분이 있어요.", "해당 부분을 원본과 비교하고 고친 뒤 다시 판정해 주세요."),
  INPUT_UNINTERPRETED: unreadable,
  FERMATA_AS_WRITTEN: copy("늘임표가 있지만 음표에 적힌 길이만큼만 재생해요.", "함께 연습할 때 늘이는 길이를 따로 맞춰 주세요."),
  UNSUPPORTED_METER: copy("이 악보에 아직 지원하지 않는 박자가 있어요.", "현재는 2/4·3/4·4/4·6/8·12/8 악보를 사용할 수 있어요."),
  UNSUPPORTED_MODULATION: copy("곡 중간에 조가 바뀌는 악보는 아직 지원하지 않아요.", "조가 바뀌기 전까지만 잘라서 올려 보세요."),
  UNSUPPORTED_RHYTHM_STAFF: copy("멜로디와 다른 보표의 리듬을 함께 선택했어요.", "멜로디와 같은 보표의 리듬을 선택하거나 추가 리듬 선택을 해제해 주세요."),
  UNSUPPORTED_SEPARATE_CHORD_PART: copy("코드가 멜로디와 다른 파트에 적혀 있어요.", "MuseScore에서 멜로디 파트에 코드를 옮겨 적은 뒤 다시 올려 주세요."),
  UNSUPPORTED_POLICY: copy("선택한 생성 방식이나 구간은 아직 지원하지 않아요.", "자동 화음의 전체 곡 생성으로 다시 시도해 주세요."),
  UNSUPPORTED_RHYTHM: copy("추가로 고른 리듬 성부에 음높이나 가사가 들어 있어요.", "리듬 기호와 쉼표만 있는 성부를 고르거나 추가 리듬 선택을 해제해 주세요."),
  UNSUPPORTED_UNINTERPRETED: unreadable,
  STRUCTURE_LEAD: copy("화음의 기준이 될 멜로디가 선택되지 않았어요.", "원래 노래 선율이 적힌 성부 하나를 선택해 주세요."),
  STRUCTURE_OVERFULL: copy("마디 끝을 넘어가는 음표나 쉼표가 있어요.", "해당 마디의 박자표와 음표·쉼표 길이를 확인해 주세요."),
  STRUCTURE_FERMATA: copy("늘임표가 원본과 같은지 확인해야 해요.", "원본의 늘임표를 확인해 주세요. 재생은 적힌 음표 길이를 사용해요."),
  STRUCTURE_OVERLAP: copy("같은 성부의 음표나 쉼표가 시간상 겹쳐 있어요.", "음표·쉼표의 시작 위치와 길이를 확인하고 고쳐 주세요."),
  STRUCTURE_PITCH: copy("음높이를 정하지 못한 음표가 있어요.", "원본에서 해당 음표의 높이와 임시표를 확인해 주세요."),
  STRUCTURE_KEY: copy("이 부분의 조성을 정하지 못했어요.", "원본의 조표와 장조·단조를 확인해 주세요."),
  STRUCTURE_FIFTHS: copy("선택한 조성과 악보의 조표가 서로 맞지 않아요.", "원본의 조표를 보고 선택한 조성을 고쳐 주세요."),
  STRUCTURE_REVIEW: copy("이 마디를 원본과 비교해야 해요.", "멜로디와 코드, 악보 기호를 원본과 확인해 주세요."),
  CHORD_KIND_TEXT: copy("코드 이름 {chordName}를 글자대로 읽었어요.", "원본 악보의 코드 이름과 비교해 주세요."),
  STRUCTURE_CHORD: copy("해석할 수 없는 코드가 있어요.", "원본의 코드 이름을 확인하고 고쳐 주세요."),
  STRUCTURE_TEMPO: copy("연습 속도가 정해지지 않았어요.", "박의 단위와 분당 박 수를 확인하고 입력해 주세요."),
  STRUCTURE_RIGHTS: rights,
  STRUCTURE_PERFORMERS: copy("가수 음역 설정이 없거나 멜로디가 설정한 음역을 벗어나요.", "가수별 음역을 확인해 주세요. 멜로디 음역 제한을 직접 설정했다면 조정하거나 해제해 주세요."),
  STRUCTURE_SECTIONS: copy("화음을 만들 구간이 정해지지 않았어요.", "악보의 시작과 끝, 생성할 구간을 확인해 주세요."),
  AUTOMATIC_VALUES: copy("악보에서 비어 있는 설정은 연습용으로 자동 선택했어요.", "자세히에서 어떤 값을 사용했는지 확인할 수 있어요."),
  FILE_UNREADABLE: unreadable,
};

/** Unknown future codes keep their category and get an actionable safe fallback. */
export function quickHarmonyNotice(finding: Pick<AutoDraftFinding,"id"|"code"|"category">, locationKo?: string, values?: { readonly chordName: string }): QuickHarmonyNotice {
  const entry = Object.hasOwn(QUICK_HARMONY_NOTICE_CATALOG, finding.code) ? QUICK_HARMONY_NOTICE_CATALOG[finding.code] : undefined;
  const fallback = finding.category === "unsupported"
    ? copy("이 악보에는 아직 지원하지 않는 내용이 있어요.", "자세히에서 위치를 확인하고 원본 악보를 고친 뒤 다시 올려 주세요.")
    : finding.category === "warning"
      ? copy("원본과 비교할 참고 사항이 있어요.", "자세히에서 해당 부분을 확인해 주세요.")
      : copy("화음을 만들기 전에 확인할 부분이 있어요.", "자세히에서 해당 부분을 확인하고 악보를 고쳐 주세요.");
  const value = entry ?? fallback;
  return {id:finding.id, messageKo: `${locationKo ? `${locationKo}: ` : ""}${value.messageKo.replace("{chordName}", () => values?.chordName ?? "")}`, actionKo:value.actionKo,
    choices: (value.choices ?? (finding.category === "question" ? [edit] : [])).map(choice=>({...choice}))};
}
