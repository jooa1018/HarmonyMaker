> **SUPERSEDED / HISTORICAL SPEC**
>
> Step 2 이후의 authoritative specification은
> [`docs/HARMONYMAKER_SPEC_v3.1.5.md`](HARMONYMAKER_SPEC_v3.1.5.md)이다.
> 이 v2.3.1 문서는 과거 설계 기록으로 보존하며,
> v3.1.5와 충돌할 경우 v3.1.5가 우선한다.

# 화음 생성기 (가칭) — 개발 기획서 v2.3.1 최종 통합본

> 결정적 규칙 기반 3성부 화음 엔진 + 공정한 Reference 평가 + 구현량 절감형 Core gate
>
> 이 문서는 다른 버전을 함께 읽지 않아도 구현할 수 있는 **독립 실행형 완전 명세**다.
> v2.3의 Core 우선·공정 baseline·경량 Reference 구조를 유지하면서, PATCH-2.3.1의 HarmonicFunctionFamily 정본, M1 슬롯 정렬, OOV 처리, matched baseline 해석 장치를 병합한다.
> 생산 앱의 화음 생성에는 Claude·OpenAI 등 생성형 AI를 사용하지 않는다.

---

## 0. 문서 상태와 절대 원칙

### 0.1 이 문서의 지위

- 이 문서는 v2.0·v2.1·v2.2·v2.3과 별도 PATCH-2.3.1 문서를 대체한다.
- 구현 시 이 문서만을 규범 문서로 사용한다.
- 과거 문서 또는 패치 원문과 충돌하면 v2.3.1 최종 통합본이 우선한다.
- 타입·음역·박 강약·화성 슬롯·하드 규칙·소프트 비용·진단 코드·평가 기준을 모두 이 문서 안에 정의한다.

### 0.2 생산 화음 생성은 완전한 규칙 기반이다

- production runtime에서 생성형 AI API를 화음 생성에 사용하지 않는다.
- 화음 생성은 순수 TypeScript 도메인 엔진이 수행한다.
- 직접 입력·MusicXML 입력·화음 생성·악보 표시·재생은 네트워크 없이 동작할 수 있어야 한다.
- 같은 음악 입력, 같은 엔진 버전, 같은 설정은 항상 같은 결과를 반환한다.
- `Math.random()`, 현재 시각, 객체 순회 우연성으로 결과를 선택하지 않는다.
- 동점은 명시된 canonical comparator로 결정한다.

```ts
const a = harmonize(canonicalMusicalInput(score), settings);
const b = harmonize(canonicalMusicalInput(score), settings);

canonicalJson(a) === canonicalJson(b); // 반드시 true
```

### 0.2.1 Reference fixture 작성 보조 도구의 예외

위 금지는 **production 화음 생성**에 대한 것이다.
개발 전용 Reference fixture를 만드는 과정에서는 다음 도구를 선택적으로 사용할 수 있다.

- 인쇄된 코드 심볼을 로마숫자로 변환하는 결정적 스크립트
- SATB 음을 분석해 가능한 코드 후보를 제안하는 독립 분석기
- 로컬 또는 외부 생성형 AI가 만드는 annotation 초안

단, 다음을 반드시 지킨다.

- 보조 도구의 출력은 언제나 `draft`다.
- 보조 도구가 자기 출력을 스스로 `verified`로 승격할 수 없다.
- Core gate용 화음 라벨은 인쇄 코드·출판 lead sheet 등 독립 출처와 대조한다.
- 재생 대조와 기계적 chord-tone 검사를 통과해야 한다.
- 보조 도구 코드는 production bundle과 harmonizer dependency graph에 들어가지 않는다.
- 외부 서비스에 악보를 보낼 때는 사용 권리와 개인정보를 먼저 확인한다.

### 0.3 생산 3성부와 Reference SATB는 다른 텍스처다

이 앱의 출력은 S/A/T 3성부이며 테너가 최저 성부다.
출판 SATB에서는 베이스가 최저 성부와 전위·근음 지지 역할을 맡고, 테너는 내성이다.

따라서 다음을 금지한다.

- 생성 테너를 출판 SATB 테너와 그대로 맞추는 수치를 핵심 품질 점수로 사용
- SATB 테너 exact match가 낮다는 이유로 3성부 테너의 근음 지지·종지 도약을 벌점 처리
- 출판 SATB의 음역·내성 예외를 생산 3성부 규칙에 그대로 적용

Reference 계층은 다음처럼 나눈다.

1. **Raw SATB audit — Core 필수**  
   원본 편곡의 음역·예외·성부 진행을 기록한다.
2. **Independent source-backed annotations — Core 필수**  
   인쇄 코드·출판 자료·표시된 프레이즈를 독립 라벨로 고정한다.
3. **Three-part reduction set — Core 이후 선택**  
   SATB를 S/A/T 목표 텍스처로 환원하는 고비용 평가 장치다. Core 승인에는 요구하지 않는다.

### 0.4 Reference는 유일한 정답이 아니다

Reference 비교는 엔진 튜닝과 회귀 탐지에 사용하지만, 출판 편곡과 음 하나까지 같아야 좋은 결과인 것은 아니다.

평가는 다음 순서로 해석한다.

1. **Hard correctness**: 금지 규칙 위반이 없는가
2. **Generalization**: 몇 곡에만 맞춘 예외가 아닌가
3. **Three-part structural fitness**: 3성부에서 화음과 종지가 제대로 지지되는가
4. **Reference affinity**: 기존 좋은 편곡의 진행 특성과 합리적으로 가까운가
5. **Exact imitation**: 특정 편곡과 같은 음인가 — 보조 지표일 뿐

### 0.5 Reference 데이터 누출 금지

- Reference A/T/B는 production generation input에 들어가지 않는다.
- 곡 제목·tune name·멜로디 digest를 키로 정답 성부를 반환하지 않는다.
- 특정 fixture ID에 대한 예외 코드를 금지한다.
- production bundle에 Reference 전체 악보를 넣지 않는다.
- 선택적 Reference reduction builder는 production harmonizer 모듈과 `engine-config.ts`를 import하지 않는다.
- 평가용 수기 라벨은 production phrase/chord detector의 입력이 아니다.

### 0.6 실패를 숨기지 않는다

```ts
type HarmonyStatus = "complete" | "partial" | "failed";
```

- `complete`: 지원 구간 전체 생성, production hard error 0
- `partial`: 독립 구간 일부만 생성, 실패 구간·이유 명시
- `failed`: 유효한 해 없음, 수정 경로 안내

규칙 위반을 알고도 `간이 화음`이라는 이름으로 성공 반환하지 않는다.

### 0.7 스타일 정직성

Reference SATB 코퍼스는 주로 전통적 호모리듬 찬송가식 성부 진행을 측정한다.
그 수치는 현대 CCM 찬양팀 만족도를 직접 의미하지 않는다.

평가 축을 분리한다.

- **Hymn Reference Track**: 전통 찬송가식 3성부 화성 품질
- **Target Scenario Track**: 저작권 문제 없는 독자·합성 CCM형 멜로디와 코드 루프의 실사용 견고성
- **Field Pilot Track**: 실제 팀의 수정량·완주율·공유 사용성

---

## 1. 제품 정의

### 1.1 한 줄 정의

멜로디 악보를 직접 입력하거나 MusicXML·사진·PDF로 가져오면, 앱 내부의 결정적 화성 규칙이 알토와 테너를 자동 생성하고, 사용자가 수정·이조한 뒤 파트별로 듣고 공유할 수 있는 웹 앱.

### 1.2 핵심 사용자

**1차 사용자**

- 전문 편곡자가 없는 소규모 교회 찬양팀의 찬양 인도자
- 간단한 3성부 화음이 필요한 성가대·보컬팀 리더

**2차 사용자**

- 공유 링크로 자신의 파트를 연습하는 소프라노·알토·테너 팀원

화성학 학습자는 v1의 공식 핵심 타겟이 아니다.

### 1.3 핵심 가치

1. 멜로디만으로 S/A/T 화음을 만든다.
2. 외부 생성형 AI 없이 항상 같은 결과를 만든다.
3. 결과를 즉시 악보로 보고 파트별로 들을 수 있다.
4. 한두 음이 어색하면 직접 수정할 수 있다.
5. 앱이 해결하지 못한 구간을 숨기지 않는다.
6. 팀원은 카카오톡 링크 또는 파일로 연습 자료를 받는다.

---

## 2. v1 범위와 릴리스 구조

### 2.1 자동 생성 공식 범위

- 입력 성부: 단선율 소프라노 1개
- 생성 성부: 알토 + 테너
- 출력: 3성부 S/A/T
- 기본 리듬: 소프라노 이벤트·화성 슬롯 경계에 맞춘 호모포닉 방식
- 조성: 장조 12개
- 단조: import·표시·재생 가능, 자동 생성은 v1에서 차단
- 길이: 4~200 melody events
- 권장 길이: 8~24마디
- 공식 테스트 박자: 2/4, 3/4, 4/4, 6/8, 9/8, 12/8
- 전조: 전역 조성 1개. 중간 조성 변경 감지 시 자동 생성 차단 또는 사용자 구간 분할

### 2.2 v1에서 지원한다고 말하지 않을 것

- 베이스까지 생성하는 4성부 SATB
- 독립 리듬의 대위법적 성부
- 재즈 텐션·대리화음 자동 추론
- 무조성 음악
- 손글씨 OMR
- 복잡한 반복·D.S./Coda의 완전 자동 전개
- 복잡한 중간 전조
- 단조 자동 화성
- 전문 출판 편곡을 대체하는 품질 보장

### 2.3 Release 1A — Core App

필수:

- 소리 먼저 검증하는 3성부 렌더·재생 skeleton
- Fraction 기반 음악 모델
- 결정적 규칙 기반 코드 진행·A/T 생성
- production 3성부 독립 Validator
- Raw SATB audit
- 인쇄 코드 기반 최소 annotation 체계
- 오라클용·동일 진행용으로 분리된 dual baseline
- 알토 feature·최저성부 기능·종지·non-trivial contour 평가
- 직접 입력
- MusicXML/MXL import·export
- 3단 악보
- S/A/T mute·solo
- 속도 50~150%
- 생성 A/T 직접 수정
- 이조
- IndexedDB 자동 저장
- URL hash 공유
- `.harmonyscore.json` export/import

Core gate에서 제외:

- SATB→3성부 reduction builder
- reduction exact-match 지표
- Cohen-style kappa
- 사람 편곡 간 변이대 계산
- 30곡 exact digest freeze

### 2.4 Release 1B — OMR

Core App 승인 뒤에만 시작한다.

- 사진 업로드
- PDF 페이지 렌더링
- 비동기 OMR job
- MusicXML 결과 가져오기
- part/staff/voice 선택
- 인식 결과 수정

### 2.5 Release 1C — 편의 기능

- A-B 반복
- 카운트인
- 파트별 볼륨
- 선택 마디 재생성
- 음·마디·코드 잠금
- A/B 편곡 비교
- PWA 고도화
- PNG/PDF 내보내기

### 2.6 Post-Core Advanced Evaluation — 선택

Core MVP가 실제 사용 가능한 뒤에만 진행한다.

- SATB→3성부 reduction builder
- reduction variant 기반 M2
- contour·pitch-class kappa
- 사람 편곡 간 변이대
- 24곡 이상 장기 regression corpus

이 단계는 엔진 연구 품질을 높이지만 사용자에게 보이는 Core App을 막아서는 안 된다.

## 3. 핵심 사용자 흐름

### 3.1 찬양 인도자

1. 새 멜로디 직접 입력 또는 MusicXML 열기
2. 조성·박자·가사·원본 코드를 확인
3. 코드 사용 모드와 성부 음역을 선택
4. `화음 생성`
5. 실패·경고 구간 확인
6. A/T의 필요한 음만 수정
7. 파트별 재생
8. 이조
9. 저장·공유

### 3.2 팀원

1. 공유 링크 또는 파일 열기
2. 악보·가사 보기
3. 자신의 파트 solo
4. 속도 낮추기
5. 반복 연습

### 3.3 생성 실패

유효한 해를 찾지 못하면:

- 성공한 독립 구간은 유지
- 실패 마디를 강조
- 구체적인 `Diagnostic.code`와 한국어 설명 표시
- 해결 버튼 제공
  - 음역 넓히기
  - 코드 변경
  - 원본 코드 strict 해제
  - 멜로디 옥타브 확인
  - unsupported 구간 수동 편집

---

## 4. 기술 스택과 아키텍처

### 4.1 기술 스택

| 영역 | 선택 | 원칙 |
|---|---|---|
| 웹 | Next.js App Router + TypeScript strict | 구현 시 안정 버전 고정 |
| UI | Tailwind CSS | 모바일 우선 |
| 상태 | React reducer 또는 Zustand | 도메인·UI 상태 분리 |
| 악보 | abcjs | ABC는 렌더 adapter일 뿐 |
| 재생 | abcjs synth + PlayerController | 성부별 트랙 제어 |
| 피치 보조 | tonal | 직접 상태 모델로 사용하지 않음 |
| MusicXML | fast-xml-parser + 자체 adapter | XML 객체 격리 |
| MXL | fflate | zip 보안 제한 적용 |
| PDF | pdfjs-dist | Release 1B |
| 로컬 저장 | IndexedDB | 자동 저장 |
| 공유 압축 | fflate 또는 lz-string | URL 안전 인코딩 |
| Unit | Vitest | 필수 |
| Property | fast-check | 초기부터 유지 |
| E2E | Playwright | Core smoke 중심 |
| OMR | `OmrProvider` interface | 엔진과 완전 분리 |

### 4.2 아키텍처

```text
[Browser]

Input
├─ Staff editor
├─ MusicXML/MXL
└─ Photo/PDF → OMR → MusicXML       [Release 1B]
          │
          ▼
     ScoreDocument
          │
    ┌─────┼──────────────┐
    ▼     ▼              ▼
 Editor  Harmony Worker  ABC Adapter
             │              │
             ▼              ▼
       Rule Harmonizer   render/play
             │
             ▼
       HarmonyResult
             │
       Production Validator
             │
     IndexedDB / URL Share
```

### 4.3 엔진 실행 위치

화음 엔진은 Web Worker에서 실행한다.

```ts
worker.postMessage({
  type: "HARMONIZE",
  score,
  settings,
});
```

도메인 엔진은 React, Next.js, abcjs, 네트워크 API를 import하지 않는다.

---

## 5. 완전한 도메인 데이터 모델

### 5.1 Fraction

```ts
interface Fraction {
  n: number; // 0 이상의 정수
  d: number; // 양의 정수
}
```

- 4분음표 = `{ n: 1, d: 1 }`
- 8분음표 = `{ n: 1, d: 2 }`
- 점4분음표 = `{ n: 3, d: 2 }`
- 셋잇단 8분음표 = `{ n: 1, d: 3 }`

필수 함수:

```ts
normalizeFraction(x: Fraction): Fraction;
addFraction(a: Fraction, b: Fraction): Fraction;
subFraction(a: Fraction, b: Fraction): Fraction;
compareFraction(a: Fraction, b: Fraction): -1 | 0 | 1;
mulFraction(a: Fraction, b: Fraction): Fraction;
divFraction(a: Fraction, b: Fraction): Fraction;
```

음악 판정에 JavaScript float를 사용하지 않는다.

### 5.2 피치와 음정

```ts
type Step = "C" | "D" | "E" | "F" | "G" | "A" | "B";

interface Pitch {
  step: Step;
  alter: -2 | -1 | 0 | 1 | 2;
  octave: number;
}

interface Interval {
  semitones: number;
  diatonicNumber: number;
  quality:
    | "perfect"
    | "major"
    | "minor"
    | "augmented"
    | "diminished";
  direction: -1 | 0 | 1;
}
```

MIDI 번호와 pitch class는 계산값으로만 사용한다.

### 5.3 조성·박자·템포

```ts
interface KeySignature {
  tonic: string;
  mode: "major" | "minor" | "unknown";
  fifths?: number;
}

interface TimeSignature {
  numerator: number;
  denominator: number;
  beatGroups?: number[];
}

interface TempoSpec {
  bpm: number;
  beatUnit: Fraction;
}
```

### 5.4 성부 이벤트

```ts
type VoiceId = "soprano" | "alto" | "tenor";
type ReferenceVoiceId = VoiceId | "bass";
type EventSource = "manual" | "musicxml" | "omr" | "generated";

interface DiagnosticRef {
  code: string;
  diagnosticId: string;
}

interface BaseVoiceEvent {
  id: string;
  onset: Fraction;
  duration: Fraction;
  source: EventSource;
  locked: boolean;
  warnings: DiagnosticRef[];
}

interface LyricSyllable {
  verse: number;
  text: string;
  syllabic?: "single" | "begin" | "middle" | "end";
  extend?: boolean;
}

interface NoteEvent extends BaseVoiceEvent {
  kind: "note";
  pitch: Pitch;
  tieStart: boolean;
  tieStop: boolean;
  lyrics: LyricSyllable[];
  phraseHint?: "breath" | "fermata";
}

interface RestEvent extends BaseVoiceEvent {
  kind: "rest";
}

type VoiceEvent = NoteEvent | RestEvent;
```

### 5.5 코드 모델

```ts
interface ChordTone {
  spelling: string;
  pitchClass: number;
  role:
    | "root"
    | "third"
    | "fifth"
    | "seventh"
    | "suspension"
    | "extension";
}

interface NormalizedChord {
  rootSpelling: string;
  rootPc: number;
  quality:
    | "major"
    | "minor"
    | "diminished"
    | "augmented"
    | "dominant7"
    | "major7"
    | "minor7"
    | "sus2"
    | "sus4"
    | "add9";
  bassPc?: number;
  tones: ChordTone[];
  romanNumeral?: string;
}

interface ChordEvent {
  id: string;
  onset: Fraction;
  duration?: Fraction;
  rawSymbol: string;
  normalized?: NormalizedChord;
  source: "musicxml" | "omr" | "manual" | "generated";
  locked: boolean;
  parseStatus: "ok" | "unsupported" | "ambiguous";
}
```

v1 parser 지원:

- `C`, `F#`, `Bb`
- `Cm`, `F#m`
- `Bdim`, `B°`
- `Caug`, `C+`
- `G7`, `Cmaj7`, `Am7`
- `Dsus2`, `Gsus4`
- `Cadd9`
- `G/B`, `D/F#`

지원하지 않는 심볼은 몰래 단순화하지 않는다.

### 5.6 ScoreDocument

```ts
interface SourceInfo {
  kind: "manual" | "musicxml" | "omr" | "shared";
  originalFileName?: string;
  importedAt?: string;
  omrProvider?: string;
  rightsConfirmed?: boolean;
}

interface ImportIssue {
  code: string;
  severity: "warning" | "error";
  location?: string;
  messageKo: string;
}

interface ImportReport {
  sourceKind: SourceInfo["kind"];
  selectedPartId?: string;
  selectedStaff?: number;
  selectedVoice?: string;
  issues: ImportIssue[];
}

interface Measure {
  id: string;
  number: number;
  implicit: boolean;
  time: TimeSignature;
  key?: KeySignature;
  voices: Record<VoiceId, VoiceEvent[]>;
  chords: ChordEvent[];
  phraseBoundaryAfter?: boolean;
  warnings: DiagnosticRef[];
}

interface ScoreDocument {
  schemaVersion: 3;
  documentId: string;
  title: string;
  composer?: string;
  tempo: TempoSpec;
  defaultKey: KeySignature;
  measures: Measure[];
  generation?: GenerationRecord;
  importReport?: ImportReport;
  sourceInfo?: SourceInfo;
  createdAt: string;
  updatedAt: string;
}
```

### 5.7 엔진 설정

```ts
interface VoiceRange {
  hardLow: Pitch;
  preferredLow: Pitch;
  preferredHigh: Pitch;
  hardHigh: Pitch;
}

interface HarmonySettings {
  key: KeySignature;
  chordMode: "source-strict" | "source-preferred" | "generate";
  altoRange: VoiceRange;
  tenorRange: VoiceRange;
  maxAdjacentSpacing: number;
  allowUnisonAtPhraseBoundary: boolean;
  harmonicRhythm: "auto" | "one-per-beat" | "one-per-measure";
  preserveLockedNotes: boolean;
  selectedMeasureIds?: string[];
}
```

기본 음역:

| 성부 | 절대 하한 | 선호 하한 | 선호 상한 | 절대 상한 |
|---|---:|---:|---:|---:|
| 알토 | G3 | A3 | B4 | D5 |
| 테너 | C3 | D3 | E4 | G4 |

절대 음역 밖 후보는 만들지 않는다.
선호 음역 밖은 soft cost다.

### 5.8 진단 코드 정본과 엔진 결과

모든 모듈은 자유 문자열이 아니라 아래 `DiagnosticCode` 정본을 사용한다.
새 코드를 추가할 때는 이 union, registry, 한국어 문구, 최소 한 개의 실패 테스트를 함께 수정한다.

```ts
type DiagnosticScope =
  | "input"
  | "generation"
  | "harmony"
  | "import"
  | "reference"
  | "sharing";

type DiagnosticCode =
  // 입력·정규화
  | "INPUT_MELODY_MISSING"
  | "INPUT_EVENT_LIMIT_EXCEEDED"
  | "INPUT_INVALID_FRACTION"
  | "INPUT_NON_POSITIVE_DURATION"
  | "INPUT_EVENT_OVERLAP"
  | "INPUT_INVALID_TIE"
  | "INPUT_INVALID_TIME_SIGNATURE"
  | "UNSUPPORTED_KEY_MODE"
  | "UNSUPPORTED_MODULATION"
  | "UNSUPPORTED_CHORD_SYMBOL"
  | "LOCK_CONFLICT"

  // 탐색·생성 실패
  | "HARMONY_SLOT_NO_CANDIDATE"
  | "CHORD_PROGRESSION_NO_SOLUTION"
  | "VOICING_NO_SOLUTION"
  | "SEARCH_BUDGET_EXHAUSTED"
  | "PARTIAL_GENERATION"

  // production 3성부 hard 진단
  | "ALTO_OUT_OF_RANGE"
  | "TENOR_OUT_OF_RANGE"
  | "VOICE_CROSSING"
  | "VOICE_OVERLAP"
  | "ADJACENT_SPACING_EXCEEDED"
  | "ILLEGAL_UNISON"
  | "PARALLEL_FIFTH"
  | "PARALLEL_OCTAVE"
  | "PARALLEL_UNISON"
  | "EXCESSIVE_MELODIC_LEAP"
  | "MELODIC_AUGMENTED_SECOND"
  | "MELODIC_TRITONE"
  | "UNRESOLVED_LEADING_TONE_SOPRANO"
  | "UNRESOLVED_LEADING_TONE_TENOR"
  | "UNRESOLVED_CHORDAL_SEVENTH"
  | "DOUBLED_UNSTABLE_LEADING_TONE"
  | "REQUIRED_CHORD_ROLE_MISSING"
  | "FINAL_TONIC_ROOT_MISSING"
  | "FINAL_TONIC_THIRD_MISSING"
  | "FINAL_LOWEST_ROOT_MISSING"
  | "REST_ALIGNMENT_MISMATCH"
  | "RHYTHM_BOUNDARY_MISMATCH"

  // production warning·info
  | "PREFERRED_RANGE_EXCEEDED"
  | "DIRECT_PERFECT_INTERVAL_RISK"
  | "FRUSTRATED_LEADING_TONE_INNER_VOICE"
  | "SOURCE_CHORD_SUBSTITUTED"
  | "SLASH_BASS_NOT_REALIZED"
  | "INCOMPLETE_NONFINAL_CHORD"
  | "AUTO_PHRASE_BOUNDARY_USED"

  // import·공유
  | "IMPORT_UNSUPPORTED_ELEMENT"
  | "IMPORT_CORRUPT_XML"
  | "IMPORT_ARCHIVE_UNSAFE"
  | "IMPORT_MULTIPLE_KEYS_UNSUPPORTED"
  | "SHARE_PAYLOAD_INVALID"
  | "SHARE_URL_TOO_LONG"

  // Reference 전용
  | "REFERENCE_EXPECTED_RANGE_EXCEPTION"
  | "REFERENCE_EXPECTED_OVERLAP"
  | "REFERENCE_EXPECTED_TENDENCY_EXCEPTION"
  | "REFERENCE_DIAGNOSTIC_MISMATCH"
  | "REFERENCE_ANNOTATION_UNVERIFIED"
  | "REFERENCE_LABEL_SOURCE_MISSING"
  | "REFERENCE_LABEL_OUT_OF_VOCABULARY"
  | "REFERENCE_REDUCTION_UNAVAILABLE";

interface DiagnosticDefinition {
  code: DiagnosticCode;
  scope: DiagnosticScope;
  defaultSeverity: "error" | "warning" | "info";
  blocksComplete: boolean;
}

interface Diagnostic {
  id: string;
  code: DiagnosticCode;
  severity: "error" | "warning" | "info";
  measureId: string;
  eventIds: string[];
  voices: VoiceId[];
  messageKo: string;
  details?: Record<string, string | number | boolean>;
}
```

정본 severity 원칙:

| 그룹 | 기본 severity | `complete` 차단 |
|---|---|---|
| 입력 오류 | error | 예 |
| 탐색 불능 | error | 해당 구간 예 |
| production hard 진단 | error | 예 |
| production warning | warning | 아니오 |
| import 복구 가능 | warning | 아니오 |
| Reference 예상 예외 | info 또는 warning | production과 무관 |

`REFERENCE_LABEL_OUT_OF_VOCABULARY`의 registry 정본:

```ts
{
  code: "REFERENCE_LABEL_OUT_OF_VOCABULARY",
  scope: "reference",
  defaultSeverity: "info",
  blocksComplete: false,
}
```

한국어 기본 문구는 `Reference 화음 라벨이 v1 자동 생성 어휘 밖이어서 기능 비교에서 제외되었습니다.`로 한다.
이 코드를 추가·변경할 때는 union·registry·한국어 문구·OOV 실패 테스트를 함께 수정한다.

```ts
interface HarmonyCostBreakdown {
  melodyFit: number;
  chordProgression: number;
  cadence: number;
  voiceMotion: number;
  rangeComfort: number;
  inversion: number;
  chordCompleteness: number;
  diagnosticPenalty: number;
  total: number;
}

interface HarmonyTrace {
  slotDecisions: Array<{
    slotId: string;
    selectedChord: string;
    rejectedCandidates: Array<{
      chord: string;
      cost: number;
      reasons: string[];
    }>;
  }>;
  melodyRoles: Array<{
    eventId: string;
    role: string;
    reason: string;
  }>;
  exploredProgressions: number;
  exploredVoicings: number;
  relaxationLevel: number;
  cost: HarmonyCostBreakdown;
}

interface HarmonyEngineResult {
  engineVersion: string;
  configVersion: string;
  settings: HarmonySettings;
  inputDigest: string;
  outputDigest: string;
  status: HarmonyStatus;
  diagnostics: Diagnostic[];
  generatedMeasures: Measure[];
  trace?: HarmonyTrace;
}

interface GenerationRecord extends HarmonyEngineResult {
  generatedAt: string; // 저장 계층이 실행 후 추가
}
```

`harmonize()` 반환값에는 현재 시각을 넣지 않는다.

### 5.9 공유 payload

편집 히스토리·OMR 원본·trace·내부 진단 상세는 공유하지 않는다.

```ts
type CompactFraction = [n: number, d: number];
type CompactPitch = [step: Step, alter: -2 | -1 | 0 | 1 | 2, octave: number];

interface CompactNoteEvent {
  k: "n";
  o: CompactFraction;
  d: CompactFraction;
  p: CompactPitch;
  ts?: 1;
  te?: 1;
  l?: string[];
}

interface CompactRestEvent {
  k: "r";
  o: CompactFraction;
  d: CompactFraction;
}

type CompactVoiceEvent = CompactNoteEvent | CompactRestEvent;

interface CompactChordEvent {
  o: CompactFraction;
  s: string;
}

interface CompactMeasure {
  n: number;
  i: 0 | 1;
  time: [numerator: number, denominator: number, beatGroups?: number[]];
  key?: KeySignature;
  s: CompactVoiceEvent[];
  a: CompactVoiceEvent[];
  t: CompactVoiceEvent[];
  c: CompactChordEvent[];
}

interface SharePayload {
  schemaVersion: 3;
  title: string;
  tempo: TempoSpec;
  defaultKey: KeySignature;
  measures: CompactMeasure[];
  engineVersion?: string;
}
```

encode·decode 경계에서 Zod 또는 동등한 runtime schema validation을 수행한다.

### 5.10 OMR 계약

```ts
type OmrStatus =
  | { kind: "created" }
  | { kind: "uploading"; uploadedPages: number; totalPages: number }
  | { kind: "queued" }
  | { kind: "processing"; progress?: number }
  | { kind: "needs-input"; message: string }
  | { kind: "completed" }
  | { kind: "failed"; code: string; message: string }
  | { kind: "cancelled" }
  | { kind: "unknown"; rawStatus: string };

interface OmrProvider {
  createJob(): Promise<string>;
  addPage(jobId: string, file: Blob): Promise<void>;
  start(jobId: string): Promise<void>;
  getStatus(jobId: string): Promise<OmrStatus>;
  getMusicXml(jobId: string): Promise<string>;
  cancel(jobId: string): Promise<void>;
  delete(jobId: string): Promise<void>;
}
```

---

## 6. 규칙 기반 화음 엔진 상세

### 6.1 엔진 중간 타입과 순수 함수 경계

```ts
interface InputValidationResult {
  ok: boolean;
  diagnostics: Diagnostic[];
  normalizedScore?: ScoreDocument;
}

interface MelodyTimeline {
  atoms: MelodyAtom[];
  totalDuration: Fraction;
}

interface PhraseRegion {
  id: string;
  startAtomIndex: number;
  endAtomIndex: number;
  boundarySource: "manual" | "musicxml" | "rest" | "long-note" | "final";
}

interface PhraseAnalysis {
  regions: PhraseRegion[];
  diagnostics: Diagnostic[];
}

interface ChordProgression {
  id: string;
  candidates: ExpandedChordCandidate[];
  cost: number;
}

interface VoiceLeadingResult {
  status: "complete" | "failed";
  alto: VoiceEvent[];
  tenor: VoiceEvent[];
  cost: number;
  diagnostics: Diagnostic[];
}

interface ThreePartStyleContract {
  altoRange: VoiceRange;
  tenorRange: VoiceRange;
  maxAdjacentSpacing: number;
  maxGeneratedLeapSemitones: number;
  finalTonicRequiresLowestRoot: boolean;
  allowFrustratedLeadingToneInAlto: boolean;
}

interface HarmonySearchContext {
  key: KeySignature;
  settings: HarmonySettings;
  previousCandidate?: ExpandedChordCandidate;
  nextPhraseBoundary?: Fraction;
}

validateInput(
  score: ScoreDocument,
  settings: HarmonySettings,
): InputValidationResult;

buildMelodyTimeline(score: ScoreDocument): MelodyTimeline;

analyzePhrases(
  timeline: MelodyTimeline,
  score: ScoreDocument,
): PhraseAnalysis;

buildHarmonySlots(
  timeline: MelodyTimeline,
  phraseAnalysis: PhraseAnalysis,
  sourceChords: ChordEvent[],
): HarmonySlot[];

generateBaseHarmonyCandidates(
  slot: HarmonySlot,
  context: HarmonySearchContext,
): BaseHarmonyCandidate[];

expandChordCandidates(
  base: BaseHarmonyCandidate[],
  context: HarmonySearchContext,
): ExpandedChordCandidate[];

searchChordProgressions(
  slots: HarmonySlot[],
  settings: HarmonySettings,
): ChordProgression[];

enumerateVoicings(
  atom: MelodyAtom,
  chord: ExpandedChordCandidate,
  settings: HarmonySettings,
): VoicingCandidate[];

searchVoiceLeading(
  timeline: MelodyTimeline,
  progression: ChordProgression,
  settings: HarmonySettings,
): VoiceLeadingResult;

validateProductionHarmony(
  score: ScoreDocument,
  settings: HarmonySettings,
): Diagnostic[];

harmonize(
  score: ScoreDocument,
  settings: HarmonySettings,
): HarmonyEngineResult;
```

### 6.2 전체 파이프라인

```text
입력 검증
→ melody timeline
→ beat strength
→ phrase 분석
→ harmony slot
→ base harmony 후보
→ chord quality·inversion 확장
→ K-best chord progression
→ 각 진행의 A/T 후보
→ hard pruning
→ voice-leading DP
→ progression + voicing 결합 평가
→ production validator
→ 최저 비용의 유효 결과
```

### 6.3 입력 검증

- 소프라노 이벤트 겹침 없음
- onset·duration 음수 없음
- tie 연결 유효
- 장조 여부
- 중간 전조 지원 여부
- strict 모드의 unsupported chord 없음
- 잠긴 A/T가 이미 절대 음역·성부 순서를 깨지 않음
- melody event 4~200
- Fraction denominator·노드 수 상한

입력 오류와 `유효한 해 없음`을 구분한다.

### 6.4 MelodyAtom

```ts
interface MelodyAtom {
  eventId: string;
  measureId: string;
  absoluteOnset: Fraction;
  localOnset: Fraction;
  duration: Fraction;
  pitch: Pitch | null;
  beatStrength: "strong" | "medium" | "weak";
  tiedFromPrevious: boolean;
  tiedToNext: boolean;
  phraseStart: boolean;
  phraseEnd: boolean;
}
```

### 6.5 박 강약

- 4/4: 1박 strong, 3박 medium, 2·4박 weak
- 3/4: 1박 strong, 2·3박 weak
- 2/4: 1박 strong, 2박 weak
- 6/8: 첫 점4분 strong, 둘째 점4분 medium
- 9/8: 첫 묶음 strong, 나머지 medium
- 12/8: 1번째 묶음 strong, 3번째 medium, 나머지 weak
- `beatGroups`가 있으면 각 그룹 시작을 strong/medium 후보로 사용

### 6.6 프레이즈 경계

우선순위:

1. 사용자 지정
2. MusicXML breath·fermata
3. 4분음표 이상 쉼표 뒤
4. 긴 음 뒤 마디 끝
5. 곡 마지막

자동 경계는 수정 가능해야 한다.

### 6.7 화성 리듬 슬롯

```ts
interface HarmonySlot {
  id: string;
  start: Fraction;
  end: Fraction;
  measureIds: string[];
  melodyAtoms: MelodyAtom[];
  sourceChord?: ChordEvent;
  phrasePosition: "start" | "middle" | "cadence";
}
```

기본 규칙:

- 마디 첫 강박은 슬롯 시작 후보
- 4/4의 3박, 6/8의 둘째 큰 박은 슬롯 후보
- 원본 코드 변화는 필수 경계
- 약박의 짧은 순차음은 같은 슬롯에 묶음
- 프레이즈 끝 긴 음은 별도 슬롯 가능
- 최소 슬롯 길이 = 기본 8분음표
- 슬롯 경계는 최종 성부 이벤트 경계와 일치
- 긴 소프라노 음 중간에 코드가 변하면 동일 피치 tie segment로 결정적 분할
- split ID = `split:{sourceEventId}:{offset}`
- 원본 음으로 되돌릴 mapping 보존

### 6.8 원본 코드 모드

- `source-strict`: 해당 슬롯 후보를 원본 코드로 제한
- `source-preferred`: 원본 코드 비용 0, 대체 후보에 큰 비용
- `generate`: 원본 코드는 표시만 하고 자동 진행 생성
- 일부 구간만 코드가 있으면 나머지는 생성

### 6.9 자동 생성 코드 어휘

장조 기본 기능:

- I
- ii
- iii
- IV
- V
- vi
- vii°

V7은 자동 생성 가능하지만 V family 확장 단계에서 다룬다.
복잡한 7화음·텐션은 원본 코드가 있을 때만 지원 범위 안에서 보이싱한다.

```ts
interface BaseHarmonyCandidate {
  functionId: "I" | "ii" | "iii" | "IV" | "V" | "vi" | "vii°";
  localCost: number;
  reasonCodes: string[];
}

interface ExpandedChordCandidate {
  chord: NormalizedChord;
  inversion: 0 | 1 | 2 | 3;
  preferredLowestPc: number;
  localCost: number;
  reasonCodes: string[];
}
```

후보 상한:

- Base harmony: 슬롯당 최대 7
- quality·inversion 확장 후: local pruning 최대 12
- K-best 진행: 16
- A/T voicing: 이벤트당 24
- recovery pass: 이벤트당 48, 진행 48

### 6.10 비화성음

지원:

- passing tone
- neighbor tone
- suspension
- anticipation

규칙:

- 강박의 설명되지 않는 비화성음: 후보 제거
- 약박의 설명되지 않는 비화성음: 큰 비용
- 장조 밖 반음계 음: 약박 경과·보조로 설명되면 허용
- 강박 반음계 음: 원본/사용자 코드가 없으면 자동 생성 실패

### 6.11 전위

- 3화음: root position·1st inversion 기본
- 2nd inversion: passing·neighbor·cadential 6/4로 설명될 때만
- vii°: 1st inversion 우선
- 7화음 3rd inversion: 원본 명시 때만
- 최저 성부는 테너이므로 `inversion`은 실제 3성부에서 들리는 전위
- slash bass는 테너가 가능하면 선호하지만 무조건 강제하지 않음

### 6.12 코드 진행

초기 전이표:

```text
I    → I, ii, iii, IV, V, vi
ii   → ii, V, vii°
iii  → iii, IV, vi
IV   → I, ii, IV, V
V    → I, V, vi
vi   → ii, IV, V, vi
vii° → I, iii
```

경로 비용:

```text
melody fit
+ chord transition
+ cadence
+ source chord mismatch
+ excessive repetition
+ rare chord
```

Viterbi 또는 k-best DP를 사용한다.

### 6.13 종지와 최저성부 지지

마지막 프레이즈 우선순위:

1. V → I authentic
2. IV → I plagal
3. vii° → I
4. 마지막 I만 확정

중간 프레이즈:

- half cadence on V
- authentic
- plagal
- deceptive V→vi
- 비종지형 연결 — Target Scenario mode에서 허용

3성부의 최종 완결 규칙:

- 최종 I에서 테너는 원칙적으로 tonic root pitch class를 담당
- source-strict 또는 사용자 잠금으로 다른 전위가 명시된 경우 warning과 함께 허용 가능
- 최종 I는 S/A/T 전체에서 root와 third를 반드시 포함
- 최종 authentic cadence에서 lowest-voice function이 무너지면 성공 처리하지 않음

특정 음정 도약 `5̂→1̂` 하나를 항상 강제하지 않는다.
핵심은 최저 성부가 최종 tonic root 기능을 지지하는지다.

### 6.14 보이싱 후보

```ts
interface VoicingCandidate {
  soprano: Pitch;
  alto: Pitch;
  tenor: Pitch;
  harmonicState: ExpandedChordCandidate;
  localCost: number;
  coveredRoles: ChordTone["role"][];
}
```

1. 코드 tone을 알토 음역의 모든 옥타브로 확장
2. 코드 tone을 테너 음역의 모든 옥타브로 확장
3. A/T 조합 생성
4. same-time hard rule 검사
5. completeness·range local cost
6. canonical sort
7. 상위 24개 보존

### 6.15 Production 3-part hard contract

#### 같은 시점

- 기본 `soprano > alto > tenor`
- phrase start/end에서 설정에 따라 인접 유니즌만 허용
- S-A ≤ 12 semitones
- A-T ≤ 12 semitones
- 절대 음역 준수
- voice crossing 금지
- unstable leading tone 중복 금지
- 사용자 잠금 불일치 금지
- 소프라노 쉼표이면 A/T도 쉼표
- 최종 tonic chord root·third 포함

#### 연속 진행

- 같은 방향 병행 완전5도 금지
- 같은 방향 병행 완전8도·유니즌 금지
- voice overlap 금지
- A/T 단일 도약 기본 P5 이내
- augmented 2nd·tritone melodic leap 금지
- chordal seventh의 필수 해결 규칙
- role-aware leading-tone 규칙
- locked boundary 위반 금지

병행 판정:

```ts
const dx = midi(currX) - midi(prevX);
const dy = midi(currY) - midi(prevY);
const sameDirection =
  Math.sign(dx) !== 0 &&
  Math.sign(dx) === Math.sign(dy);
const bothMoved = dx !== 0 && dy !== 0;

if (
  bothMoved &&
  sameDirection &&
  prevClass === 7 &&
  currClass === 7
) {
  // PARALLEL_FIFTH
}

if (
  bothMoved &&
  sameDirection &&
  prevClass === 0 &&
  currClass === 0
) {
  const currAbsoluteDistance = Math.abs(midi(currX) - midi(currY));
  const code: DiagnosticCode =
    currAbsoluteDistance === 0
      ? "PARALLEL_UNISON"
      : "PARALLEL_OCTAVE";
  // code를 진단에 기록
}
```

### 6.16 성부 역할별 tendency-tone 규칙

생산 3성부에서 soprano와 tenor는 외성이다.
alto만 내성이다.

Dominant → tonic에서:

- soprano의 leading tone: tonic으로 상행 해결 — hard
- tenor의 leading tone: tonic으로 상행 해결 — hard
- alto의 leading tone: tonic 상행이 기본
- alto의 frustrated 7→5는 다음 조건을 모두 만족할 때만 허용
  - 다음 tonic chord에 tonic root가 soprano 또는 tenor에 존재
  - root·third completeness를 개선
  - 병행5도·8도·교차를 만들지 않음
  - production phrase context상 inner-voice 예외가 허용되는 위치이며, Reference fixture annotation을 runtime 입력으로 사용하지 않음
  - warning `FRUSTRATED_LEADING_TONE_INNER_VOICE` 기록

Raw SATB의 tenor는 내성이므로 Reference audit에서는 다른 profile을 사용한다.
Raw SATB 예외를 이유로 production tenor 규칙을 약화하지 않는다.

V7 → I에서 chordal seventh:

- A/T의 7음은 원칙적으로 아래로 순차 해결
- suspension·common-tone reinterpretation이 명시된 경우만 예외
- v1 자동 생성에서는 설명되지 않은 예외를 만들지 않음

### 6.17 3성부 코드 완전성

- major/minor triad: root + third 우선, fifth 생략 가능
- dominant7: third + seventh 우선, root를 가능한 한 포함, fifth 생략 가능
- major7/minor7: root + third + seventh 우선
- sus: root + suspension tone 우선
- add9: root + third + melody의 9th 우선
- melody가 non-chord tone이면 A/T로 root + third 우선
- 최종 tonic은 root + third 필수
- root·third 모두 없는 결과는 hard failure

### 6.18 초기 soft cost

모든 값은 `engine-config.ts`에 둔다.

| 항목 | 초기 비용 |
|---|---:|
| 동일음 유지 | 0 |
| 반음·온음 진행 | 1 |
| 3도 도약 | 3 |
| P4 도약 | 5 |
| P5 도약 | 8 |
| 선호 음역 밖 1반음 | +2 |
| A와 T가 같은 방향 이동 | +2 |
| 외성 direct 5th/8ve 위험 | +12 |
| root 누락 | +16 |
| third 누락 | +24 |
| fifth 누락 | +2 |
| third 중복 | +4 |
| slash bass 불일치 | +3 |
| non-final root-position에서 T가 root | 0 |
| non-final에서 T가 third | +3 |
| non-final에서 T가 fifth | +5 |
| 4회 초과 연속 동일음, 초과 1회당 | +2 |
| contrary/oblique motion | -1 |
| common tone 유지 | -1 |

음수 reward를 적용한 뒤 path cost가 음수 무한대로 내려가지 않도록 반복 길이와 최솟값을 제한한다.

### 6.19 Voice-leading DP

```text
DP[i][candidate]
= localCost(candidate)
+ min(
    DP[i-1][prev]
    + transitionCost(prev, candidate)
  )
```

- 쉼표 뒤 motion cost 초기화
- phrase boundary 설정 적용
- locked notes를 경계 조건으로 사용
- 동점은 `altoMidi → tenorMidi → chordCanonicalKey` 순서

### 6.20 코드 진행과 보이싱 결합

상위 16개 코드 진행 각각에 대해 최적 A/T 경로를 계산한다.

```text
final cost
= progression cost
+ voicing cost
+ soft diagnostic cost
```

production hard error가 하나라도 남은 결과는 제외한다.

### 6.21 Recovery와 실패

순서:

1. 다음 K-best 진행
2. K = 16 → 48
3. voicing cap = 24 → 48
4. source-preferred에서 대체 코드 허용 범위 확대
5. 실패 구간 분리

하지 않을 것:

- hard rule 완화 후 성공 반환
- 임의 음역 확장
- invalid chord를 무시
- Reference 답안 조회

---

## 7. Validator 프로필

### 7.1 공통 인터페이스

```ts
type ValidationProfileId =
  | "production-three-part"
  | "reference-satb-audit"
  | "reference-reduction";

interface ValidationProfile {
  id: ValidationProfileId;
  voiceRoles: Record<string, "outer" | "inner" | "lowest">;
  ranges: Record<string, VoiceRange>;
  allowFrustratedLeadingToneInInnerVoice: boolean;
  allowExpectedOverlap: boolean;
  expectedDiagnosticCodes?: DiagnosticCode[];
}
```

### 7.2 Production three-part — Core 필수

- S: outer
- A: inner
- T: outer + lowest
- production 음역·spacing·최종 root support 적용
- `complete` 결과에 error 0

### 7.3 Raw SATB audit — Core 필수

- S·B: outer
- A·T: inner
- Reference용 별도 음역 사용
- 내성 frustrated leading tone 허용 가능
- 원본 편곡의 overlap·range·tendency 예외를 진단으로 기록
- fixture의 `expectedReferenceDiagnostics`와 실제 결과를 대조
- Raw SATB의 예외를 production 규칙 완화 근거로 자동 사용하지 않음

### 7.4 Reference reduction — Post-Core 선택

- production S/A/T 역할과 hard contract 사용
- reduction variant가 error 0일 때만 M2 비교 가능
- 모든 variant가 무효이면 `REFERENCE_REDUCTION_UNAVAILABLE`을 기록하고 해당 fixture를 M2 분모에서 제외
- 이 상태는 Core gate 실패가 아니며 annotation 기반 지표를 계속 사용

### 7.5 독립성

- generator와 validator는 후보 선택 결과·accepted flag를 공유하지 않는다.
- pitch·interval·공개된 style contract 상수는 공유 가능하다.
- Raw SATB audit의 예외 설정은 production profile로 전파하지 않는다.
- 선택적 reduction builder는 production search·soft weight를 import하지 않는다.

## 8. Reference SATB 평가 체계

### 8.1 Core 평가의 목적과 범위

Core 단계의 평가 장치는 제품보다 커지면 안 된다.
Core에서 반드시 구현하는 것은 다음뿐이다.

1. Raw SATB audit
2. 독립 출처가 있는 최소 annotation
3. 공정하게 분리된 dual baseline
4. production hard correctness
5. 알토 성부 진행 feature
6. 최저성부 기능·종지
7. non-trivial contour
8. completion·runtime·determinism

다음은 Post-Core로 미룬다.

- SATB→3성부 reduction builder
- reduction exact-match M2
- kappa
- 사람 편곡 간 변이대

### 8.2 Fixture 선정과 권리

Hymn Reference Track의 Core fixture 조건:

- 장조
- v1 공식 박자
- strictly 또는 거의 homorhythmic SATB
- 복잡한 전조·반복 없음
- S/A/T/B 정렬 가능
- 권리 상태·판본 확인 가능
- 가능하면 코드 심볼이 인쇄된 판본 또는 적법한 lead sheet가 존재
- 현대 저작권 편곡은 권리 확인 없이 포함하지 않음

```ts
interface ReferenceSourceMeta {
  title: string;
  tuneName?: string;
  composer?: string;
  arranger?: string;
  publicationTitle?: string;
  publicationYear?: number;
  sourceLocator: string;
  rightsBasis: string;
  verifiedBy: string;
  verifiedAt: string;
  sourceSha256?: string;
}
```

### 8.3 Raw SATB 모델

```ts
interface ReferenceSatbMeasure {
  id: string;
  number: number;
  time: TimeSignature;
  key?: KeySignature;
  voices: Record<ReferenceVoiceId, VoiceEvent[]>;
}

interface ReferenceSatbScore {
  title: string;
  tempo: TempoSpec;
  key: KeySignature;
  measures: ReferenceSatbMeasure[];
}
```

### 8.4 Annotation provenance와 검증 등급

```ts
type AnnotationSourceKind =
  | "printed-chords"
  | "published-lead-sheet"
  | "mechanical-from-source"
  | "manual-analysis"
  | "assisted-draft";

type AnnotationVerificationStatus =
  | "draft"
  | "source-verified"
  | "playback-verified"
  | "expert-reviewed";

interface AnnotationProvenance {
  sourceKind: AnnotationSourceKind;
  sourceLocator?: string;
  draftedBy: string;
  draftingTool?: string;
  verifiedBy?: string;
  status: AnnotationVerificationStatus;
  verificationMethods: Array<
    | "printed-symbol-match"
    | "roman-numeral-conversion"
    | "satb-chord-tone-coverage"
    | "bass-inversion-check"
    | "block-chord-playback"
    | "expert-review"
  >;
}
```

Core gate에서 화음·종지 라벨을 사용하려면 최소 `source-verified`여야 한다.
AI나 자동 분석기가 만든 초안만 있는 fixture는 해당 지표의 분모에서 제외한다.

### 8.5 Core annotation 구조

```ts
type HarmonicFunctionFamily =
  | "tonic"
  | "predominant"
  | "dominant"
  | "other";

interface CoreHarmonyLabel {
  slotId: string;
  start: Fraction;
  end: Fraction;
  printedSymbol?: string;
  parseStatus: "ok" | "unsupported" | "ambiguous";
  romanNumeral?: string;
  functionFamily?: HarmonicFunctionFamily; // OOV이면 undefined
  inversion?: 0 | 1 | 2 | 3;
  outOfVocabulary: boolean;
  provenance: AnnotationProvenance;
}

interface CorePhraseBoundary {
  position: Fraction;
  type: "phrase-end" | "breath" | "final";
  source:
    | "printed-fermata"
    | "printed-breath"
    | "section-boundary"
    | "lyric-punctuation"
    | "manual";
}

interface CoreCadenceLabel {
  position: Fraction;
  type:
    | "authentic"
    | "half"
    | "plagal"
    | "deceptive"
    | "non-cadential";
  finalLowestFunction?: "root" | "third" | "fifth";
  provenance: AnnotationProvenance;
}

interface CoreReferenceAnnotations {
  harmonyLabels: CoreHarmonyLabel[];
  phraseBoundaries: CorePhraseBoundary[];
  cadences: CoreCadenceLabel[];
  expectedReferenceDiagnostics: DiagnosticCode[];
  annotationVersion: string;
}
```

`acceptableLowestPitchClasses`를 사람이 매 슬롯 직접 쓰지 않는다.
다음 결정적 정책으로 파생한다.

- final authentic tonic: root만 허용
- printed slash chord: slash bass를 우선 허용
- 명시된 inversion: 해당 bass pitch class 허용
- 일반 non-final triad: root 우선, first inversion은 허용 집합에 포함 가능
- cadential 6/4: annotation에 명시된 경우만 fifth 허용

이 파생 정책은 `reference/lowest-function-policy.ts`에 있고 production harmonizer의 soft weight를 import하지 않는다.

#### 8.5.1 HarmonicFunctionFamily 매핑 정본

family 판정은 아래 표만을 사용한다.
이 표는 `reference/core/roman-conversion.ts`의 상수 `HARMONIC_FUNCTION_FAMILY_MAP`으로 두고 evaluator·report·annotation converter가 동일한 정본을 공유한다.

| 로마숫자 (v1 어휘) | family | 비고 |
|---|---|---|
| I, Imaj7 | tonic | |
| vi, vi7 | tonic | tonic 대리 |
| ii, ii7 | predominant | |
| IV, IVmaj7 | predominant | |
| V, V7 | dominant | |
| vii° | dominant | |
| iii, iii7 | other | 대리 기능이 논쟁적이므로 v1에서는 other로 고정. 양쪽 모두 iii일 때만 roman descriptive 일치 |

부가 규칙:

- **sus2·sus4·add9**: root가 해당 조성의 다이어토닉 음이면 그 급수의 family를 따른다. 예: C장조 `Gsus4` → V → dominant, `Dsus2` → ii → predominant.
- **슬래시 코드**: 상위 화음의 family를 따른다. 베이스 음은 family 판정에 사용하지 않는다. 예: `G/B` → V → dominant.
- **7화음**: root와 구성음이 모두 다이어토닉이면 해당 급수의 family를 따른다.
- family 비교는 문자열 동일성으로 판정한다. `other` family끼리는 family 일치로 센다.
- 단, 아래 §8.5.2의 OOV 판정이 먼저다. OOV 슬롯에는 family를 억지 배정하지 않는다.

#### 8.5.2 어휘 밖(out-of-vocabulary) 슬롯

annotation 슬롯의 화음이 다음 중 하나면 **OOV 슬롯**이다.

1. `parseStatus !== "ok"`인 경우. 예: 현재 parser가 지원하지 않는 `Bm7b5`.
2. symbol → roman numeral 기계 변환이 v1 다이어토닉 어휘와 **root와 quality 모두** 일치하는 결과를 내지 못한 경우.
   - C장조 `D7`: 2차 도미넌트 V/V이므로 OOV
   - C장조 `Fm`: 차용화음이므로 OOV
   - C장조 `D/F#`: 상위 화음 D major가 다이어토닉 ii의 minor quality와 불일치하므로 OOV
3. sus·add9인데 root가 비다이어토닉인 경우.

OOV 처리:

- `functionalFamilyAgreement`, `romanNumeralAgreementDescriptive`, `inversionAgreement`의 분모에서 제외한다.
- 진단 `REFERENCE_LABEL_OUT_OF_VOCABULARY`를 `info`로 기록한다.
- fixture·corpus 단위로 `outOfVocabularyRate = OOV 슬롯 수 / 전체 harmony label 슬롯 수`를 보고한다.
- 한 fixture의 `outOfVocabularyRate > 0.30`이면 그 fixture 전체를 M1 기능 비교 tune 분모에서 제외하고 `excludedComparisonReasons`에 사유를 기록한다.
- 해당 fixture는 Raw SATB audit, 알토 feature, contour, runtime·completion 평가에는 계속 사용할 수 있다.
- OOV 제외 후 M1 평가 가능 슬롯이 **8개 미만**이면 해당 fixture를 M1 tune 집계에서 제외하고 사유를 기록한다.

### 8.6 Annotation 작성 절차

Core용 라벨 작성은 화성학 실기 부담을 줄이기 위해 다음 순서를 따른다.

1. 코드 심볼이 인쇄된 판본 또는 출판 lead sheet를 우선 선택
2. 코드 symbol·onset을 그대로 전사
3. key를 이용해 symbol→roman numeral·function family를 기계 변환하고 §8.5.2에 따라 `parseStatus`와 `outOfVocabulary`를 확정
4. slash chord·SATB bass로 inversion을 기계 검사
5. 해당 슬롯 SATB 음의 chord-tone coverage를 검사
6. 라벨 코드의 block chord 재생과 원본 SATB를 번갈아 재생
7. 뚜렷한 불일치가 없으면 `source-verified` 또는 `playback-verified`

코드가 인쇄되지 않은 곡은:

- Raw SATB audit·알토 feature·contour fixture로는 사용 가능
- Core의 chord function·cadence gate 분모에서는 제외
- Post-Core에서 수동 또는 전문가 annotation을 추가 가능

오프라인 AI·자동 분석기는 2~4단계의 초안을 제안할 수 있지만, 독립 출처 확인과 재생 대조를 대신하지 않는다.

### 8.7 Reference fixture

```ts
interface ReferenceReductionVariant {
  id: string;
  method: "bass-support" | "smooth-three-part" | "reviewed";
  alto: VoiceEvent[];
  tenor: VoiceEvent[];
  diagnostics: Diagnostic[];
  reductionVersion: string;
}

interface ReferenceFixture {
  id: string;
  category:
    | "tuning"
    | "dev-check"
    | "sealed-acceptance"
    | "regression";
  source: ReferenceSourceMeta;
  input: ScoreDocument; // S + 실제 production metadata만
  rawSatb: ReferenceSatbScore;
  annotations: CoreReferenceAnnotations;
  reductions?: ReferenceReductionVariant[]; // Post-Core 선택
  comparableEventIds: string[];
  excludedComparisonReasons: Record<string, string>;
}
```

### 8.8 Raw SATB audit

fixture 추가 순서:

1. Raw SATB parse
2. `reference-satb-audit` 실행
3. 실제 diagnostic 검토
4. 예상 예외를 `expectedReferenceDiagnostics`에 기록
5. annotation source 연결
6. event alignment 검증

Raw SATB가 production 규칙을 위반해도 production 규칙을 즉시 낮추지 않는다.
성부 역할 차이인지 먼저 판정한다.

### 8.9 코퍼스 분할과 열람 예산

#### A. Tuning set — 6곡

- 매 변경에서 상세 결과 확인 가능
- 규칙·비용 조정용

#### B. Dev-check set — 6곡

- tuning cycle 종료 때 aggregate만 확인
- 상세 per-song 결과 기본 비공개
- 상세 열람 예산 최대 3회
- 3회 사용 후 regression으로 퇴역하고 새 set으로 교체

#### C. Sealed acceptance set — 최소 12곡

- Core candidate 전에는 엔진 결과를 실행하지 않음
- 모든 unit·property·tuning·dev-check·UX gate가 두 개 연속 candidate commit에서 통과한 뒤 한 번만 실행
- 기본 출력은 aggregate pass/fail
- 상세 unseal은 최후 수단
- unseal하면 해당 12곡은 즉시 regression으로 퇴역
- replacement 비용이 크므로 routine CI에 넣지 않음
- 가능하면 Core 준비 단계에 source-only reserve fixture 4곡을 별도로 확보

#### D. Regression set — Core 이후 24곡 이상

- digest·metric history
- 장기 회귀
- fixture 확대

### 8.10 Dual baseline — 오라클과 공정 비교를 분리

두 baseline 알고리즘을 두 가지 입력 모드로 각각 실행한다.

```ts
type BaselineAlgorithm =
  | "nearest-chord-tone"
  | "greedy-common-tone";

type BaselineInputMode =
  | "oracle-annotation"
  | "matched-engine-progression";

interface BaselineResult {
  generatedMeasures: Measure[];
  diagnostics: Diagnostic[];
  hardErrorCount: number;
}

interface BaselineRun {
  algorithm: BaselineAlgorithm;
  inputMode: BaselineInputMode;
  progressionId: string;
  result: BaselineResult;
}
```

#### B0. Nearest-Chord-Tone

- melody 아래 가장 가까운 합법 chord tone을 A로 선택
- 그 아래 가장 가까운 chord tone을 T로 선택
- 미래를 보지 않음
- backtracking 없음

#### B1. Greedy-Common-Tone

- 공통음 유지 우선
- 다음 가까운 chord tone 선택
- 한 step 앞만 봄
- 전곡 DP 없음

#### Oracle mode

- 인쇄 코드·수기 annotation 진행을 입력
- “정답 코드가 주어졌을 때 단순 보이싱이 어느 정도인가”를 설명
- production 전체 파이프라인과의 release gate 비교 금지

#### Matched-progression mode

- production 엔진이 선택한 **동일한 코드 진행**을 B0/B1에 입력
- 코드 진행 차이를 제거하고 A/T 보이싱·성부 진행만 비교
- Core gate의 baseline 비교는 이 모드만 사용

따라서 다음 비교를 금지한다.

```text
engine(melody → chord → voicing)
vs
baseline(annotation chord → voicing)
```

공정한 Core 비교:

```text
engine selected progression + engine voicing
vs
same engine progression + B0/B1 voicing
```

코드 진행 품질은 baseline이 아니라 독립 annotation의 function family·cadence 지표로 따로 평가한다.

#### Matched baseline의 하드 규칙 면제와 해석

B0/B1은 **production hard pruning을 적용하지 않고 알고리즘 정의 그대로 실행**한다.
따라서 baseline 출력에는 병행5도·병행8도·성부 교차·음역 이탈·과도한 도약 등이 포함될 수 있으며 이것은 의도된 동작이다.

baseline의 목적은 “동등한 합법성 제약을 지킨 경쟁자”를 만드는 것이 아니라, **같은 코드 진행에서 단순한 greedy 선택이 만들어 내는 성부 진행 바닥선**을 제공하는 것이다.
production 엔진은 hard contract까지 지켜야 하므로, 이 baseline과 비교하는 §8.17의 성부 진행 gate는 엔진에 보수적이고 상대적으로 불리하다.

모든 baseline run에는 `hardErrorCount`를 기록한다.

- sealed 실패 분석 시 `matchedBaselineHardErrors`를 보고 “규칙을 지키느라 baseline보다 feature가 나빠진 곡”과 “실제로 voice-leading이 나쁜 곡”을 구분한다.
- 이 hard error 수를 보고 sealed gate 수치를 사후 재해석하거나 완화하지 않는다.
- threshold 변경은 반드시 sealed 실행 전 사전 등록·freeze 규칙을 따른다.

### 8.11 Core 지표

#### M0. Hard correctness

- production hard error count
- invalid result rate
- completion status

#### M1. 코드 진행·종지

verified annotation만 사용한다.

- `functionalFamilyAgreement`
- `romanNumeralAgreementDescriptive`
- `inversionAgreement`
- `cadenceTypeAgreement`
- `cadenceLowestFunctionAgreement`

정확한 Roman numeral 일치는 대체 가능한 화음 때문에 설명용으로 둔다.
Core gate는 function family·cadence·lowest function을 우선한다.

`cadenceLowestFunctionAgreement`는 **각 cadence label 시점**에서 엔진 최저 성부의 화음 내 기능(root/third/fifth)이 annotation의 `finalLowestFunction`과 일치하는 비율이다. 이름의 `cadence`는 곡 마지막 한 지점만이 아니라 annotation에 기록된 모든 cadence를 집계한다는 뜻이다.

#### M1 슬롯 정렬 규칙

M1의 모든 코드 기능 비교는 **annotation 슬롯 단위**로 수행한다. 엔진이 내부적으로 만든 HarmonySlot 개수나 경계 자체를 분모로 사용하지 않는다.

1. 엔진 생성 `ChordEvent`의 유효 구간을 먼저 정규화한다.
   - `duration`이 있으면 `[onset, onset + duration)`.
   - `duration`이 없으면 다음 `ChordEvent.onset` 직전까지 유지.
   - 마지막 코드는 곡 끝까지 유지.
2. 각 annotation 슬롯 `[start, end)`에 대해 Fraction 연산으로 시간 중첩량을 계산하고, **중첩이 가장 큰 엔진 코드 하나**를 대응시킨다.
3. 최대 중첩량이 동률이면 annotation 슬롯의 `start` 시점에 울리고 있는 엔진 코드를 택한다.
4. 그래도 동률이면 onset이 더 빠른 코드를 택한다.
5. 대응된 쌍에서 family, roman numeral, inversion을 각각 독립 비교한다.
6. 가중치는 **슬롯 개수 기준**이다. 시간 길이로 가중하지 않는다.
7. annotation 슬롯이 `partial`의 미생성 구간 또는 `failed` 구간과 겹치면 M1 분모에서 제외한다. 생성 실패 벌점은 completion이 담당하므로 이중 벌점하지 않는다.
8. §8.5.2의 OOV 슬롯 역시 M1 기능 비교 분모에서 제외한다.

report에는 다음을 기록한다.

- `m1EvaluatedSlotCount`
- `m1ExcludedSlotCount`
- OOV 제외 수
- partial/failed 제외 수

이 정렬은 결정적이어야 하며, **최대 중첩 선택·start 시점 동률·onset 동률·duration 없는 코드·partial 제외·OOV 제외**를 단위 테스트한다.

#### M2. 알토 feature

Raw SATB 알토는 생산 알토와 역할이 비교적 유사하다.

```ts
interface VoiceLeadingFeatures {
  meanLeapSemitones: number;
  stepwiseRatio: number;
  repeatedRatio: number;
  largeLeapRatio: number;
  contraryMotionRatio: number;
  commonToneRatio: number;
  comfortableRangeRatio: number;
}
```

`altoFeatureDistance`는 feature별 정규화 절대차의 평균이다.

```text
meanLeapSemitones scale = 12
ratio 계열 scale = 1
각 항목은 0..1로 clip
최종 distance = 항목 평균, 낮을수록 좋음
```

#### M3. 최저성부 contract

생성 테너를 Raw SATB 테너와 직접 비교하지 않는다.

```ts
interface LowestVoiceFeatures {
  rootSupportRatio: number;
  cadenceRootSupportRatio: number;
  annotatedFunctionAgreement: number;
  meanLeapSemitones: number;
  stepwiseRatio: number;
}
```

`lowestVoiceContractDistance`:

- `1 - rootSupportRatio`
- `1 - cadenceRootSupportRatio`
- `1 - annotatedFunctionAgreement`
- P5를 넘는 평균·개별 도약의 정규화 초과분
- 지나친 반복 또는 불안정 inversion의 비율

을 0..1로 정규화한 평균이다.
Raw SATB tenor feature는 descriptive only다.

#### M4. Non-trivial contour

Core에서는 단순 일치율만 사용한다.

- `altoContourAgreementAll`
- 양쪽이 모두 hold인 전이를 제외한 `altoContourAgreementNonTrivial`
- up/hold/down confusion matrix
- category prevalence

Kappa는 Post-Core로 미룬다.

#### M5. Matched-baseline delta

- `altoFeatureDistance`: engine과 best matched B0/B1 비교
- `lowestVoiceContractDistance`: engine과 best matched B0/B1 비교
- `altoContourAgreementNonTrivial`: engine과 matched baseline 비교

Oracle baseline delta는 report에만 표시하고 gate에 사용하지 않는다.

#### M6. Runtime·completion

- p50/p95 runtime
- completion rate
- explored candidates
- recovery rate

### 8.12 단일 합성 점수 금지

`three-part structural distance`처럼 정의되지 않은 가중합을 만들지 않는다.
다음 지표는 각각 독립적으로 보고·승인한다.

- `altoFeatureDistance`
- `lowestVoiceContractDistance`
- `functionalFamilyAgreement`
- `cadenceTypeAgreement`
- `cadenceLowestFunctionAgreement`
- `altoContourAgreementNonTrivial`

```ts
interface CoreReferenceReport {
  hardErrorCount: number;
  completionRate: number;
  outOfVocabularyRate: number;
  m1EvaluatedSlotCount: number;
  m1ExcludedSlotCount: number;
  functionalFamilyAgreement?: number;
  romanNumeralAgreementDescriptive?: number;
  inversionAgreement?: number;
  cadenceTypeAgreement?: number;
  cadenceLowestFunctionAgreement?: number;
  altoFeatureDistance: number;
  lowestVoiceContractDistance: number;
  altoContourAgreementAll: number;
  altoContourAgreementNonTrivial: number;
  matchedBaselineDelta: {
    altoFeatureDistance: number;
    lowestVoiceContractDistance: number;
    altoContourAgreementNonTrivial: number;
  };
  oracleBaselineDescriptive: Record<string, number>;
  matchedBaselineHardErrors: {
    nearestChordTone: number;
    greedyCommonTone: number;
  };
  runtimeP50Ms: number;
  runtimeP95Ms: number;
  macro: Record<string, number>;
  micro: Record<string, number>;
}
```

### 8.13 Macro·micro

Primary:

1. phrase별 metric
2. phrase 평균으로 tune score
3. tune score의 동일 가중 평균으로 corpus macro

Secondary:

- 모든 comparable event를 합친 micro

release 판단은 tune-macro를 우선하고 둘 다 보고한다.

### 8.14 지표군별 tolerance

모든 수치를 0.01·0.02·0.08 하나로 처리하지 않는다.
`reference-gates.ts`에 지표별 방향·스케일·허용치를 둔다.

```ts
interface MetricGateSpec {
  direction: "higher" | "lower";
  scale: "proportion" | "normalized-distance" | "kappa" | "milliseconds" | "count";
  minImprovement: number;
  nonWorseTolerance: number;
  majorRegression: number;
}
```

Core 기본값:

| 지표 | 방향 | 최소 개선 | non-worse | major regression |
|---|---|---:|---:|---:|
| completionRate | 높음 | 0.02 | 0.02 | 0.10 |
| functionalFamilyAgreement | 높음 | 0.02 | 0.03 | 0.10 |
| cadenceTypeAgreement | 높음 | 0.02 | 0.04 | 0.12 |
| cadenceLowestFunctionAgreement | 높음 | 0.02 | 0.03 | 0.10 |
| altoContourAgreementNonTrivial | 높음 | 0.03 | 0.05 | 0.15 |
| altoFeatureDistance | 낮음 | 0.02 | 0.03 | 0.10 |
| lowestVoiceContractDistance | 낮음 | 0.02 | 0.03 | 0.10 |
| hardErrorCount | 낮음 | 0 | 0 | 1 |
| runtimeP95Ms | 낮음 | 100ms | max(250ms, 20%) | 5초 상한 초과 |

Post-Core kappa 기본값:

- 최소 개선 0.03
- non-worse 0.05
- major regression 0.15

이 표와 §8.17의 절대 임계값(예: 0.65/0.70/0.85)은 데이터 없이 정한 **추정 초기값**이다.

tuning 6곡의 첫 완전한 report가 나온 뒤, sealed 실행 전에 재보정 여부를 **반드시 검토**한다.

- 조정하든 유지하든 각 지표의 tuning 분포와 dev-check aggregate를 근거로 기록한다.
- 지표별 scale과 방향이 다르므로 동일한 tolerance를 일괄 적용하지 않는다.
- 검토 결과와 `reference-gates.ts`의 최종값을 commit에 남긴 뒤 threshold를 freeze한다.
- sealed 실행 뒤에는 결과를 보고 threshold를 바꾸지 않는다.

### 8.15 변경 제안 사전 등록

```ts
interface EngineChangeProposal {
  id: string;
  changeType:
    | "bugfix"
    | "hard-rule"
    | "soft-weight"
    | "search"
    | "performance";
  targetMetric:
    | "completionRate"
    | "functionalFamilyAgreement"
    | "cadenceTypeAgreement"
    | "cadenceLowestFunctionAgreement"
    | "altoFeatureDistance"
    | "lowestVoiceContractDistance"
    | "runtimeP95Ms";
  expectedDirection: "increase" | "decrease" | "unchanged";
  maxAllowedTradeoffs: Partial<Record<keyof CoreReferenceReport, number>>;
  rationale: string;
}
```

결과를 본 뒤 목표 metric이나 허용치를 바꾸지 않는다.

### 8.16 변경 승인

Soft-weight 변경:

- tuning 6곡 중 최소 4곡에서 target metric 개선
- tuning macro가 해당 지표의 `minImprovement` 이상 개선
- dev-check 6곡 중 최소 5곡이 지표별 `nonWorseTolerance` 안
- 어느 한 곡도 해당 지표의 `majorRegression` 초과 금지
- hard error 증가 0
- completion 하락은 completion tolerance 안
- p95 runtime 5초 상한 유지

Bugfix·hard-rule:

- targeted fixture 통과
- 새 hard error 0
- completion 하락 0.02 이내
- 각 구조 지표 major regression 없음

Performance:

- output digest 동일이 기본
- digest가 바뀌면 soft-weight gate 적용

### 8.17 Core sealed acceptance gate

최소 12곡에서 다음을 각각 검사한다.

- engine crash 0
- complete 결과 hard error 0
- completion ≥ 10/12
- `functionalFamilyAgreement` tune-macro ≥ 0.65
- `cadenceTypeAgreement` tune-macro ≥ 0.70
- `cadenceLowestFunctionAgreement` tune-macro ≥ 0.85
- `altoFeatureDistance`가 best matched baseline보다 낮은 곡 ≥ 8/12
- `lowestVoiceContractDistance`가 best matched baseline보다 낮은 곡 ≥ 9/12
- `altoContourAgreementNonTrivial`이 best matched baseline보다 non-worse인 곡 ≥ 8/12
- deterministic digest 100%
- 200 events 5초 이내

원칙:

- Oracle baseline은 위 gate에 사용하지 않는다.
- exact pitch 절대 threshold는 두지 않는다.
- `three-part structural distance` 같은 합성 지표를 만들지 않는다.
- `functionalFamilyAgreement` 계산에서 OOV 슬롯은 §8.5.2에 따라 이미 분모에서 제외된 상태여야 한다.
- OOV 제외 후 M1 잔여 슬롯이 8개 미만이거나 fixture OOV rate가 0.30을 초과하면 해당 tune을 기능 지표 macro에서 제외하고 사유를 기록한다.
- threshold는 sealed 실행 전에 freeze한다.

### 8.18 Target Scenario Track

저작권 있는 CCM 멜로디를 corpus에 복제하지 않는다.
독자·합성 시나리오 최소 12개:

- I–V–vi–IV
- vi–IV–I–V
- I–vi–IV–V
- V에서 끝나는 연결형 phrase
- non-cadential loop
- syncopated weak-beat non-chord tone
- 6/8 worship-ballad형 harmonic rhythm
- 좁은·높은 음역 melody

평가:

- hard correctness
- completion
- source chord 존중
- 비종지 phrase를 억지 authentic cadence로 닫지 않음
- 수정 가능한 failure

SATB exact 지표는 적용하지 않는다.

### 8.19 Field Pilot Track

Core 이후 권리 있는 실제 사용자 악보로 측정:

- 100 melody events당 A/T 수정 음 수
- 수정 없이 채택된 마디 비율
- import→공유 시간
- failure 복구율
- 링크→파트 재생 도달률
- `사용 가능 / 수정 후 사용 가능 / 사용 불가`

Reference 점수가 좋아도 Field Pilot이 나쁘면 제품 품질이 좋다고 선언하지 않는다.

### 8.20 Post-Core Advanced Evaluation

#### Reduction builder

```ts
interface ReferenceReductionResult {
  status: "available" | "unavailable";
  variants: ReferenceReductionVariant[];
  diagnostics: Diagnostic[];
}
```

- production hard contract를 통과하는 variant만 보존
- 모든 variant가 무효이면 `unavailable`
- 해당 fixture를 reduction M2 분모에서 제외
- 0점이나 Core failure로 처리하지 않음
- annotation M1·M3와 Raw Alto 지표는 계속 사용

M2는 **builder-policy 상대 지표**다.
Reference의 절대 진실이나 Core gate로 사용하지 않는다.

#### Kappa

- contour·pitch-class chance-adjusted agreement
- confusion matrix·prevalence와 함께 표시
- 단독 gate 금지

#### 사람 편곡 간 변이대

- 동일 tune의 독립 편곡이 2개 이상일 때만
- 실용적 변이 범위이며 이론적 ceiling이 아님

### 8.21 개발용 UI

`/dev/reference`

Core 화면:

```text
RAW SATB AUDIT
ANNOTATION SOURCE / VERIFICATION
M1 EVALUATED / EXCLUDED SLOTS
REFERENCE OOV RATE
ENGINE CHORD FUNCTION / CADENCE
ENGINE VS MATCHED BASELINES
MATCHED BASELINE HARD ERRORS
ORACLE BASELINE — DESCRIPTIVE ONLY
ALTO FEATURES
LOWEST-VOICE CONTRACT
CONTOUR ALL / NON-TRIVIAL
MACRO / MICRO
RUNTIME
```

재생:

- Raw SATB
- 라벨 block chord
- Generated
- Matched B0/B1
- 동일 음색·템포로 전환

Post-Core에서 reduction·kappa panel을 추가한다.

## 9. Golden·회귀 정책

### 9.1 Core 전

유지:

- unit
- property
- deterministic digest
- production validator
- Raw SATB expected diagnostic
- source-backed annotation validation
- dual baseline report
- tuning report
- 제한된 dev-check

고정하지 않음:

- 30곡 exact digest
- reduction variant
- kappa
- 단일 Reference 총점
- 사람 3인 평균 점수

### 9.2 Sealed 실행 절약

sealed set은 일상 CI가 아니다.
다음 조건이 두 개 연속 candidate commit에서 모두 통과한 뒤 한 번 실행한다.

- unit·property green
- tuning numeric gate green
- dev-check aggregate green
- Core 사용자 흐름 green
- iPhone·Kakao smoke green
- threshold freeze 완료

실패 시 aggregate만으로 수정 가능한 경우 상세 unseal을 하지 않는다.
상세 unseal은 정말 원인을 찾을 수 없을 때만 사용한다.

### 9.3 Digest freeze

다음 뒤에 regression digest를 고정한다.

- Core App 렌더·재생·입력·공유 완주
- sealed acceptance 통과
- 주요 weight가 두 tuning cycle 동안 안정

### 9.4 Digest 변경

의도적 개선이면 변경 가능하다.
필수 artifact:

- output digest diff
- DiagnosticCode delta
- metric별 macro·micro delta
- matched baseline delta
- oracle baseline descriptive delta
- Target Scenario delta
- EngineChangeProposal ID

Post-Core reduction·kappa 변화는 별도 artifact로 분리한다.

## 10. Release 1A 기능 명세

### F1. 시작

- 새 멜로디 직접 입력
- MusicXML/MXL 열기
- 최근 작업

Release 1B에서 사진/PDF 추가.

### F2. 직접 입력

- 온·2분·4분·8분·16분
- 점음표
- 쉼표
- ♯·♭·♮
- tie
- 선택·이동·삭제
- 키보드 A~G, R
- undo/redo 최소 20
- Fraction 마디 검증
- imported pickup·불완전 마디 경고 허용
- 8마디 3분 입력 목표

### F3. MusicXML/MXL

- `.musicxml`, `.xml`, `.mxl`
- part/staff/voice 목록
- 후보 1~2마디 미리 듣기
- 사용자 melody voice 선택
- 가사·코드·조성·박자·tie 보존
- triplet Fraction 보존
- unsupported 요소 import report
- XML 외부 엔티티 비활성화
- MXL traversal·zip bomb 방어

### F4. 화음 생성

- progress
- cancel
- status·diagnostic
- engine/config version
- trace는 개발 모드에서만
- complete 결과 hard error 0

### F5. 결과 수정

Release 1A:

- S/A/T 선택
- A/T 한 음 이동
- 삭제·복원
- 즉시 production validation
- 자동 생성 상태로 되돌리기

Release 1C:

- lock
- partial regeneration
- A/B snapshot

### F6. 악보

- 3단 S/A/T
- melody only
- 선택 파트 강조
- 코드·가사 토글
- diagnostic 표시
- abcjs SVG element와 내부 event ID mapping

### F7. 재생

Release 1A:

- play/pause/reset
- S/A/T mute·solo
- 50~150% speed
- cursor highlight

Release 1C:

- part volume
- A-B
- count-in
- measure loop

첫 iOS 재생은 사용자 tap 안에서 AudioContext 생성·resume·synth init.

### F8. 이조

- 반음 ±
- target key
- S/A/T·chord 함께 이조
- range warning
- 이조 후 재보이싱은 1C

### F9. 로컬 저장

- IndexedDB
- debounce autosave
- recent documents
- schema migration
- last valid snapshots 3개

### F10. 공유

기본:

```text
SharePayload
→ compression
→ URI-safe encoding
→ /#d=...
```

- 작업 저장은 IndexedDB
- URL hash를 autosave로 사용하지 않음
- `MAX_SHARE_URL_CHARS` 실기기 테스트 후 freeze
- 초과 시 `.harmonyscore.json` 공유 안내
- ShareStore는 실제 필요가 확인된 후 추가

### F11. Export

Release 1A:

- `.harmonyscore.json`
- MusicXML

MIDI는 구현 난도가 낮으면 1A, 아니면 1C.
PNG/PDF는 1C.

---

## 11. OMR — Release 1B

### 11.1 분리 원칙

OMR이 없어도 Core가 모두 동작한다.

### 11.2 업로드

- image/PDF
- EXIF 회전
- 긴 변 2200~2500px
- 페이지별 3.5MB 이하 목표
- PDF 최대 페이지 config
- 페이지 순차 업로드
- 암호화 PDF 오류

### 11.3 흐름

```text
file prepare
→ job create
→ page upload
→ start
→ poll status
→ MusicXML
→ inspect part/staff/voice
→ editor
→ 사용자 수정
→ harmonize
```

인식 직후 자동 생성하지 않는다.

### 11.4 보안·비용

- API key 서버 전용
- MIME + signature
- durable rate limit
- job cancel/delete
- 원본 로그 금지
- unknown status fallback
- timeout·402·403·409·corrupt result 처리

---

## 12. 성능·보안·접근성

### 12.1 성능

- melody hard limit 200
- 200 events generation 목표 2초, 상한 5초
- ABC render 목표 1초
- edit response 100ms
- worker cancel 200ms
- autosave가 입력 block 금지

### 12.2 탐색 상한

- base harmony 7
- expanded 12
- progression 16
- voicing 24
- recovery progression 48
- recovery voicing 48
- trace에 탐색 수 기록

### 12.3 보안

- XML external entity off
- XML 최대 깊이·노드
- zip path traversal 차단
- zip decompression ratio 상한
- share payload 크기·해제 상한
- 사용자 text HTML 직접 주입 금지
- OMR token 서버 전용

### 12.4 접근성

- aria-label
- keyboard navigation
- 재생 상태 screen reader
- warning을 색 외 문구로 표시
- 44px touch target
- SVG focus trap 방지

---

## 13. 테스트 전략

### 13.1 Unit — Core

- Fraction
- pitch·interval
- key scale
- chord parser
- beat strength
- phrase source conversion
- slot splitting
- non-chord tone classifier
- candidate expansion
- cadence
- parallel 5/8
- crossing·overlap·spacing
- role-aware leading tone
- chord completeness
- deterministic comparator
- DiagnosticCode registry completeness
- Raw SATB audit
- annotation provenance·verification
- printed chord→roman numeral conversion
- block-chord playback sequence generation
- Oracle baseline
- matched-progression baseline
- feature distance normalization
- macro·micro aggregation
- metric-specific gate logic

### 13.2 Property

유효한 장조 melody에 대해:

- complete면 hard error 0
- A/T 절대 음역
- rest alignment
- event ID 안정
- same input same digest
- failure structured
- canonical key order 변화 무관
- matched baseline이 engine progression을 바꾸지 않음
- oracle annotation이 production harmonizer input으로 누출되지 않음

### 13.3 Reference — Core

- expected Raw SATB diagnostics
- source-backed annotation fixture
- unverified label의 gate 분모 제외
- tuning report
- dev-check view budget
- sealed aggregate
- oracle vs matched baseline 분리
- functional family·roman numeral·inversion·cadence·lowest function
- Alto feature·lowest contract
- contour non-trivial
- `HARMONIC_FUNCTION_FAMILY_MAP` 표↔상수 1:1 일치
- OOV: `D7` in C, `Fm` in C, 비다이어토닉 sus, unsupported `Bm7b5`, 정상 `Am7` in C
- M1 정렬: 최대 중첩, start 동률, onset 동률, duration 없음, partial 제외, OOV 제외
- `CoreReferenceReport`의 OOV·M1 count·matched baseline hard-error 필드 노출
- `cadenceLowestFunctionAgreement` 개명 일관성

### 13.4 Reference — Post-Core

- reduction builder
- 전 variant 무효 처리
- M2 denominator 제외
- kappa·confusion matrix
- inter-arrangement band

Core acceptance 전에 실행할 필요가 없다.

### 13.5 MusicXML

- uncompressed
- MXL
- divisions 변화
- triplet
- tie
- pickup
- multiple voice/staff
- lyrics
- chord symbols
- corrupted/encrypted

### 13.6 Core E2E

1. hardcoded 3-part → iPhone play
2. direct input → generate → edit → solo
3. MusicXML → voice select → generate
4. transpose → warning
5. URL share → Kakao in-app open → alto solo
6. too-long share → file fallback

### 13.7 Target Scenario

- non-cadential loop를 강제로 V-I로 닫지 않음
- source chord strict 유지
- syncopated NCT
- 6/8 slot
- failure recovery

## 14. 구현 순서

### Step 0 — 저장소

- Next.js, TypeScript strict
- Vitest, ESLint
- 최소 CI
- build/deploy

### Step 1 — 소리 먼저

하드코딩 S/A/T 4~8마디:

- render
- play
- mute/solo
- speed
- cursor
- iPhone Safari
- 가능하면 Kakao smoke

이후 모든 엔진 결과를 화면에서 보고 들을 수 있어야 한다.

### Step 2 — 음악 코어

- Fraction
- Pitch·Interval
- Key·Time·Tempo
- Chord
- ScoreDocument
- canonical JSON·digest
- DiagnosticCode registry

### Step 3 — Production Validator

- range
- order
- spacing
- parallel
- overlap
- role-aware tendency
- final root support
- canonical diagnostics

### Step 4 — 최소 Reference Core infrastructure

최초 2~3곡으로만 검증한다.

- SATB loader
- Raw audit profile
- expected diagnostics
- printed chord source import
- symbol→roman/function conversion
- phrase·cadence source labels
- block-chord playback compare
- event alignment
- dual baseline skeleton
- feature/contour report
- HarmonicFunctionFamily 정본과 OOV 판정
- M1 annotation-slot aligner
- baseline hard-error reporting

reduction builder와 kappa는 만들지 않는다.

SATB loader는 Step 9의 MusicXML adapter 전체 완성을 기다리지 않는다. 다음 둘 중 하나로 진행한다.

- **권장 A:** MusicXML adapter의 읽기 경로 중 Reference fixture에 필요한 최소 subset을 Step 4에서 먼저 구현하고, Step 9에서 production import UI·보안·복구 흐름까지 확장한다.
- **대안 B:** `reference/core/` 아래 테스트 전용 간이 parser를 두고 공개 도메인 SATB MusicXML의 단순 케이스만 읽는다.

대안 B의 간이 parser는 production bundle에 포함하지 않는다.
production import의 XML/MXL 보안 요구와 전체 호환성은 Step 9에서 완성한다.

### Step 5 — 최소 Harmonizer

- I/IV/V/vi
- slots
- base candidates
- A/T enumeration
- hard pruning
- DP
- 결과 즉시 재생

### Step 6 — Tuning 6곡

- ii/iii/vii°
- V7
- inversion
- cadence
- NCT
- initial soft costs
- matched baseline comparison

루프:

```text
EngineChangeProposal
→ unit/property
→ tuning report
→ matched baseline
→ accept/rollback
```

### Step 7 — Dev-check 6곡

- aggregate only
- 상세 열람 budget 3
- metric-specific numeric gate

### Step 8 — 직접 입력·수정 UI

- staff
- keyboard
- undo 20+
- A/T edit
- validation feedback

### Step 9 — MusicXML/MXL

- inspect
- select
- import/export
- lyric/chord/tie

### Step 10 — 저장·이조·공유

- IndexedDB
- migration
- transpose
- URL share
- JSON fallback

### Step 11 — Core UX·브라우저 candidate

- 처음 사용자 흐름
- iPhone Safari
- Android Chrome
- Kakao in-app
- Target Scenario 12개
- 모든 non-sealed gate를 두 commit 연속 통과

### Step 12 — Sealed acceptance 12곡

- threshold freeze 확인
- aggregate 1회
- 상세 unseal은 최후 수단

통과 시:

```text
CORE_RULE_HARMONIZER_MVP_ACCEPTED
OMR_READY_TO_START
```

### Step 13 — OMR

- provider
- photo/PDF
- async job
- inspect/correct

### Step 14 — Regression 강화

- 24곡+
- digest freeze
- metric history
- broader E2E

### Step 15 — Advanced Evaluation — 선택

- reduction builder
- M2
- kappa
- inter-arrangement band

### Step 16 — 편의 기능

- A-B
- count-in
- volume
- partial regeneration
- PWA
- PNG/PDF

## 15. Core MVP 승인 기준

### 15.1 엔진

- crash 0
- complete 결과 production hard error 0
- 같은 입력 100회 same digest
- 200 events ≤ 5초
- invalid 결과의 success 위장 0
- DiagnosticCode 정본 밖 자유 문자열 0

### 15.2 Reference Core

- Raw SATB audit report 존재
- Core gate용 화음 라벨은 `source-verified` 이상
- Oracle baseline과 matched baseline이 별도 실행·표시됨
- gate에는 matched baseline만 사용
- matched B0/B1의 hard error 수가 report에 병기됨
- HarmonicFunctionFamily 정본·OOV 판정·M1 annotation-slot 정렬이 단위 테스트로 고정됨
- sealed 12곡에서:
  - completion ≥ 10/12
  - functional-family macro ≥ 0.65
  - cadence macro ≥ 0.70
  - cadence-lowest-function macro ≥ 0.85
  - Alto feature가 best matched baseline보다 좋은 곡 ≥ 8/12
  - lowest-voice contract가 best matched baseline보다 좋은 곡 ≥ 9/12
  - non-trivial contour가 matched baseline보다 non-worse인 곡 ≥ 8/12
- reduction builder·M2·kappa는 Core 필수가 아님
- undefined composite metric 없음
- dev-check·sealed 열람 예산 준수

### 15.3 Target Scenario

- 최소 12개
- complete 결과 hard error 0
- completion ≥ 80%
- non-cadential phrase 강제 종지 regression 없음
- source-strict chord 위반 0

### 15.4 사용자 흐름

```text
직접 입력 또는 MusicXML
→ 생성
→ 진단 확인
→ A/T 수정
→ solo 재생
→ 이조
→ 공유
```

처음 쓰는 사용자가 안내 없이 완주.

### 15.5 브라우저

- Desktop Chrome
- iPhone Safari
- Android Chrome
- Kakao in-app 공유·재생 smoke

### 15.6 승인 선언

모든 조건을 만족할 때만:

```text
CORE_RULE_HARMONIZER_MVP_ACCEPTED
OMR_READY_TO_START
```

## 16. 권장 폴더 구조

```text
src/
├─ app/
│  ├─ page.tsx
│  └─ dev/reference/page.tsx
├─ domain/
│  ├─ music/
│  │  ├─ fraction.ts
│  │  ├─ pitch.ts
│  │  ├─ interval.ts
│  │  ├─ key.ts
│  │  └─ chord.ts
│  ├─ score/
│  │  ├─ types.ts
│  │  ├─ validation.ts
│  │  └─ canonicalize.ts
│  └─ harmony-contract/
│     ├─ ranges.ts
│     ├─ hard-rules.ts
│     └─ validation-profiles.ts
├─ harmony/
│  ├─ settings.ts
│  ├─ timeline.ts
│  ├─ phrases.ts
│  ├─ slots.ts
│  ├─ chord-candidates.ts
│  ├─ progression-search.ts
│  ├─ voicing-candidates.ts
│  ├─ voice-leading-dp.ts
│  ├─ harmonize.ts
│  ├─ validator.ts
│  ├─ diagnostic-codes.ts
│  ├─ diagnostics.ts
│  └─ engine-config.ts
├─ reference/
│  ├─ core/
│  │  ├─ types.ts
│  │  ├─ satb-audit.ts
│  │  ├─ annotation-provenance.ts
│  │  ├─ printed-chord-import.ts
│  │  ├─ roman-conversion.ts
│  │  ├─ lowest-function-policy.ts
│  │  ├─ align.ts
│  │  ├─ baselines.ts
│  │  ├─ features.ts
│  │  ├─ aggregation.ts
│  │  ├─ gates.ts
│  │  └─ report.ts
│  └─ advanced/
│     ├─ reduction-builder.ts
│     ├─ kappa.ts
│     └─ inter-arrangement.ts
├─ tools/
│  └─ annotation/
│     ├─ draft-analyzer.ts
│     └─ block-chord-export.ts
├─ adapters/
│  ├─ abc/
│  ├─ musicxml/
│  └─ omr/
├─ player/
├─ storage/
├─ sharing/
└─ workers/

tests/
├─ unit/
├─ property/
├─ reference/
│  ├─ tuning/
│  ├─ dev-check/
│  ├─ sealed/
│  ├─ regression/
│  └─ advanced/
├─ target-scenarios/
└─ e2e/
```

규칙:

- `reference/advanced/reduction-builder.ts`는 `harmony/engine-config.ts`와 production search를 import하지 않는다.
- `tools/annotation`은 production build에서 제외한다.
- Reference 원본·정답 성부는 production asset graph에 포함하지 않는다.

## 17. 코딩 에이전트 규칙

1. production 화음 생성에 생성형 AI를 추가하지 않는다.
2. 개발 전용 annotation 초안 도구는 허용하지만 자동으로 `verified` 처리하지 않는다.
3. Reference A/T/B를 production input에 넣지 않는다.
4. 곡 제목·fixture ID 예외 금지.
5. production 3-part와 Raw SATB validation profile을 섞지 않는다.
6. Raw SATB tenor exact를 release 목표로 최적화하지 않는다.
7. Core에서는 reduction builder·M2·kappa를 선행 구현하지 않는다.
8. Reference 코드·프레이즈·종지는 source-backed annotation을 사용한다.
9. evaluator가 production detector를 호출해 정답 라벨을 만들지 않는다.
10. Oracle baseline과 matched baseline을 명확히 구분한다.
11. Core gate에는 matched baseline만 사용한다.
12. hard rule과 soft cost를 분리한다.
13. hard error 결과를 success로 반환하지 않는다.
14. 모든 정렬 comparator를 명시한다.
15. `Math.random()`·현재 시각을 결과 선택에 사용하지 않는다.
16. weight는 `engine-config.ts`에 모은다.
17. 변경 전에 `EngineChangeProposal`을 작성한다.
18. 지표별 tolerance table을 사용한다.
19. 단일 undefined 합성 점수를 만들지 않는다.
20. macro·micro 둘 다 보고 macro를 release 우선으로 사용한다.
21. contour hold-hold 제외 지표를 함께 보고한다.
22. baseline 없는 Reference 수치를 단독 해석하지 않는다.
23. dev-check 상세 열람 budget 3을 넘지 않는다.
24. sealed set은 모든 non-sealed gate가 두 commit 연속 통과한 뒤 한 번 실행한다.
25. sealed 상세를 열면 즉시 퇴역 처리한다.
26. melody event hard limit은 200이다.
27. Base 7·Expanded 12·K 16을 혼동하지 않는다.
28. `DiagnosticCode` 정본 밖 자유 문자열을 생성하지 않는다.
29. ABC를 저장 원본으로 사용하지 않는다.
30. 외부 입력은 runtime schema validation한다.
31. XML/MXL 보안 제한을 구현한다.
32. 소리를 Step 1부터 유지한다.
33. OMR은 Core acceptance 전에 시작하지 않는다.
34. property test는 초기부터 유지한다.
35. production bundle에 Reference 전체 데이터를 넣지 않는다.
36. 지원하지 않는 기능을 UI에서 지원한다고 표시하지 않는다.
37. HarmonicFunctionFamily는 §8.5.1 정본 외의 임의 매핑을 만들지 않는다.
38. OOV 슬롯을 v1 미지원 화음 불일치로 엔진에 벌점하지 않는다.
39. M1은 annotation 슬롯 기준 정렬 규칙을 그대로 사용한다.
40. matched baseline에는 production hard pruning을 적용하지 않고 hard error 수를 별도 보고한다.
41. baseline hard error를 근거로 sealed threshold를 사후 변경하지 않는다.
42. `cadenceLowestFunctionAgreement`의 옛 이름을 코드·문서에 남기지 않는다.

## 18. 평가 해석 예시

### 예시 1 — Oracle baseline이 더 높아도 Core 실패가 아님

```text
                               ENGINE   ORACLE B1   MATCHED B1
functional-family agreement      72%       100%         72%
alto feature distance           0.18      0.22        0.29
lowest contract distance        0.14      0.10        0.31
```

Oracle B1은 정답 코드를 받았으므로 코드 기능 100%가 당연하다.
Core에서는 동일한 engine progression을 받은 Matched B1과 보이싱을 비교한다.
ENGINE은 두 matched distance가 더 낮으므로 성부 진행 솔버가 단순 greedy보다 낫다.

### 예시 2 — 코드 진행은 나쁘고 보이싱만 좋은 경우

```text
functional-family agreement      38%
cadence agreement                42%
alto vs matched baseline         개선
lowest vs matched baseline       개선
```

보이싱 솔버는 baseline보다 좋아도 코드 진행 품질이 낮다.
지표를 합성하지 않고 chord progression 모듈을 따로 수정한다.

### 예시 3 — Reduction variant가 하나도 없음

```text
reduction status: unavailable
M2 denominator: excluded
annotation metrics: available
Raw Alto features: available
Core gate: unaffected
```

0점으로 기록하거나 production 규칙을 낮추지 않는다.

### 예시 4 — AI annotation 초안

```text
sourceKind: assisted-draft
status: draft
```

이 fixture는 chord·cadence gate에 들어가지 않는다.
인쇄 코드 대조, mechanical coverage, block-chord playback을 거쳐 `source-verified` 이상이 된 뒤 사용한다.

### 예시 5 — 서로 다른 스케일의 허용치

```text
cadence agreement -0.03        → tolerance 0.04 안, non-worse
alto distance +0.06            → tolerance 0.03 초과, regression
runtime +180ms, total 1.4s     → 250ms tolerance 안
hard error +1                  → 즉시 거부
```

모든 지표에 같은 0.02를 적용하지 않는다.

### 예시 6 — Matched baseline이 더 부드럽지만 불법 진행을 포함함

```text
                             ENGINE   MATCHED B1
altoFeatureDistance           0.24       0.18
hard errors                      0          7
```

Matched B1이 feature distance만 보면 더 낮아도, baseline은 hard pruning을 적용하지 않은 바닥선이다.
이 결과는 엔진을 즉시 실패시키는 근거가 아니라 “생산 hard rule을 지키는 비용이 어느 정도인가”를 설명한다.
다만 사전 freeze된 §8.17 gate 자체를 사후 완화하지는 않는다.

## 19. 최종 개발 철학

목표는 출판 SATB의 알토·테너를 복사하는 프로그램도, 평가 인프라 자체를 만드는 연구 프로젝트도 아니다.

목표:

> 3성부 S/A/T 텍스처에서 금지 규칙을 지키고,  
> 최저 성부가 화음과 종지를 지지하며,  
> 인쇄 코드와 독립 annotation에 비추어 기능적으로 납득 가능하고,  
> 동일한 코드 진행을 받은 단순 greedy baseline보다 성부 진행이 좋고,  
> 사용자가 수정·재생·이조·공유할 수 있는 결과를 만드는 것.

최종 우선순위:

```text
1. Production hard correctness
2. Three-part lowest-voice and cadence support
3. Fair matched-progression baseline improvement
4. Source-backed functional agreement
5. Generalization and sealed evaluation
6. Target-domain usability
7. Raw Reference affinity
8. Exact imitation
9. Post-Core advanced metrics
```

Core는 reduction builder나 kappa 없이도 승인할 수 있다.
고급 평가 도구는 제품이 실제로 동작한 뒤 필요성이 확인될 때 추가한다.

다음 조건이 모두 충족될 때만 선언한다.

```text
CORE_RULE_HARMONIZER_MVP_ACCEPTED
OMR_READY_TO_START
```
