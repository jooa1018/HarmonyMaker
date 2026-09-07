const MESSAGES = {
  "invalid MusicXML duration/divisions": "음표·쉼표 또는 이동 요소의 길이와 divisions를 확인하세요.",
  "MusicXML backup moved before measure start": "backup 이동이 마디 시작보다 앞섭니다. 성부별 시간축을 확인하세요.",
  "MusicXML chord member has no preceding note": "동시음에 연결할 앞선 음표가 없습니다.",
  "MusicXML harmony offset precedes measure start": "코드 기호의 위치가 마디 시작보다 앞섭니다.",
  "MusicXML direction offset precedes measure start": "지시 기호의 위치가 마디 시작보다 앞섭니다.",
  "MusicXML has no initial time signature": "첫 박자표가 없습니다. 원본과 인식 결과의 박자표를 확인하세요.",
  "MusicXML cursor exceeds measure duration": "음표·쉼표 또는 이동 요소의 시간축이 박자 길이를 넘습니다. 원본과 마디 길이를 대조하세요.",
  "MusicXML part has no measures": "이 파트에 마디가 없습니다.",
} as const;

/** Only deliberate structural checks are classified as corrupt input. */
export class MusicXmlStructureError extends RangeError {
  readonly messageKo: string;
  readonly details: Record<string, string | number | boolean>;
  constructor(reason: keyof typeof MESSAGES, details: Record<string, string | number | boolean> = {}) {
    super(reason);
    this.messageKo = MESSAGES[reason];
    this.details = { reason, ...details };
  }
}
