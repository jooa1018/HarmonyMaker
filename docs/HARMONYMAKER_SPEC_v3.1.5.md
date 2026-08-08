# HarmonyMaker — 개발 기획서 v3.1.5 통합 실행 명세
## Modern Worship Arrangement Engine + Evidence-Guided OMR
### Production Lyric Emphasis Semantic Projection Closure

> 문서 상태: **authoritative specification / Step 2 foundation accepted**
>
> 작성 기준일: 2026-08-08
>
> 저장소: `jooa1018/HarmonyMaker`
>
> 완료 기준선: PR #1이 `codex/bootstrap-step0-1`에 병합되어 Step 0–1이 완료됨
>
> 이 문서는 최종 P0 감사에서 `OPEN_P0_COUNT = 0`과 `STEP_2_READY_TO_START` 승인을 받은 authoritative specification이다.
>
> Worship Arrangement Grammar v1의 실제 결정표·가중치·texture 알고리즘은 이 문서와 분리된 별도 규범 문서로 작성한다. 그 문서가 승인되기 전에는 Step 4를 시작하지 않는다.

---

# 0. 문서 지위와 최상위 결정


## 0.1 이 문서의 지위

이 문서는 다음 문서를 대체하는 통합 실행 명세다.

- `HARMONYMAKER_SPEC_v3.0_DRAFT.md`
- `HARMONYMAKER_SPEC_v3.1_REVIEW_CANDIDATE.md`
- `HARMONYMAKER_SPEC_v3.1.1_REVIEW_CANDIDATE.md`
- `HARMONYMAKER_SPEC_v3.1.2_REVIEW_CANDIDATE.md`
- `HARMONYMAKER_SPEC_v3.1.3_REVIEW_CANDIDATE.md`
- `HARMONYMAKER_SPEC_v3.1.4_REVIEW_CANDIDATE.md`
- v3.0~v3.1.4에 대한 PATCH·검토 메모

Step 2 이후의 유일한 제품 규범 문서는 다음이다.

```text
docs/HARMONYMAKER_SPEC_v3.1.5.md
```

과거 문서는 설계 기록으로 보존한다. 구현 계약이 충돌하면 승인된 v3.1.5가 우선한다.

이번 PATCH의 목적은 새 제품 기능 추가가 아니다. v3.1.4 최종 Step 2 foundation 감사에서 확인된 단일 P0를 봉합한다.

- `LyricToken.emphasisSource`에 따라 달라지는 production lyric-emphasis eligibility를 하나의 canonical semantic 값으로 정규화한다.
- `musicalSourceDigest`와 `SourceLeadAtomization.digest`가 raw provenance가 아니라 실제 production 동작을 바꾸는 `ProductionLyricEmphasis`를 포함하도록 고정한다.
- 같은 production 의미의 provenance 차이는 generation digest를 불필요하게 바꾸지 않고, 서로 다른 production 의미는 반드시 source→atomization→Intent digest 전부를 바꾸도록 한다.
- Step 2 fixture에 lyric-emphasis semantic parity·difference 검사를 추가한다.

v3.1.4에서 봉합한 atomization·revision·staleness·candidate projection·preset/intensity authority 구조는 그대로 승계한다.

Worship Arrangement Grammar v1의 실제 음악적 점수표·가중치·texture 결정표는 계속 별도 문서가 권위다. 이번 PATCH는 그 Grammar가 사용할 interface와 persisted domain을 깨지 않게 만드는 데만 관여한다.

## 0.2 이미 승인된 기준선

다음은 Step 0–1에서 완료된 기술 기반으로 승계한다.

- Next.js App Router
- TypeScript strict
- Tailwind CSS
- ESLint
- Vitest
- GitHub Actions CI
- abcjs 기반 악보 렌더
- Play / Pause / Resume / Reset
- 파트별 Mute / Solo
- 50–150% 속도 재생
- 실제 playback event 기반 cursor
- iPhone Safari 실기기 smoke
- Vercel Preview 배포 경로

Step 1의 S/A/T 샘플은 기술 fixture일 뿐 production의 고정 성부 모델이 아니다.

## 0.3 제품 한 줄 정의

> 멜로디·확인된 코드·곡 구간·실제 가수 음역을 입력하면, 4/4·6/8 현대 워십 팝·발라드의 밴드 반주 문맥에 맞춰 구간별 보컬 참여와 리듬을 먼저 계획하고, 부르기 쉬운 1–3성부 보컬 편곡을 결정적으로 생성·수정·연습·공유할 수 있게 하는 웹 앱.

## 0.4 핵심 생성 원리

```text
원본 음악 정규화
→ 실제 연주 순서로 선형 전개
→ Section / Phrase 확인
→ Preset별 Arrangement Intent 생성
→ Activity / Rhythm 실현
→ Anchor / NCT 계획
→ 실제 음높이·옥타브 탐색
→ Phrase 후보
→ Section 조립
→ Song 전체 조립
→ 독립 Validator
→ Preset별 Generation Result
→ Simple / Standard / Full 비교
```

현대 찬양 편곡은 “모든 멜로디 음에 위·아래 코드톤을 하나씩 붙이는 것”으로 정의하지 않는다.

## 0.5 OMR 원리

```text
입력 종류 분류
→ 권리·외부 전송 동의 확인
→ 이미지 품질 검사
→ 사용자가 멜로디 보표 선택
→ OMR Application Service
→ Vendor Adapter
→ MusicXML 정규화
→ 음악 문법 Validator
→ 근거 수준에 맞는 Review Queue
→ typed correction + 이력 보존
→ 편곡 가능한 SongSourceDocument
```

OMR의 제품 목표는 무오류가 아니라 다음 두 가지다.

1. 편곡을 망칠 수 있는 오류를 놓치지 않는 것
2. 사용자가 의심 지점을 빠르게 고칠 수 있는 것

## 0.6 생산 엔진의 절대 원칙

### 생성형 AI 금지

- production 편곡에는 생성형 AI API를 사용하지 않는다.
- 음표·리듬·코드·섹션 결정을 LLM 응답으로 만들지 않는다.
- 개발용 fixture 초안 도구는 허용하되 production dependency graph에 들어가지 않는다.

### 결정성

같은 semantic canonical input과 같은 algorithm version은 항상 같은 결과를 반환한다.

금지:

- `Math.random()`
- 현재 시각에 따른 선택
- 파일명·표시 이름에 따른 선택
- 객체 순회 우연성
- 플랫폼별 float tie-break
- 원격 모델의 비결정적 응답
- 임의 UUID를 semantic digest의 권위 값으로 사용

### 실패 정직성

```ts
type GenerationStatus =
  | "complete"
  | "partial"
  | "blocked";
```

- `complete`: 지원 구간 전체 생성, `blocksComplete=true` 진단 0
- `partial`: 독립 구간 일부 생성, 실패 위치와 수정 경로 명시
- `blocked`: 유효한 결과 없음. 가짜 후보를 만들지 않음

### Source-first

```text
사용자가 확인한 코드
> MusicXML 코드
> OMR 결과를 사용자가 확인한 코드
> 앱의 보수적 제안
```

확인되지 않은 코드 제안은 production generation input이 아니다.

### Canonical domain과 adapter 분리

- canonical 저장 원본: TypeScript domain model
- MusicXML: import/export interchange
- ABC: 렌더·재생 adapter
- abcjs controller state: 저장 대상 아님
- Vendor raw OMR model: canonical source를 직접 덮어쓰지 않음


## 0.7 v3.1.5에서 확정하는 구조적 결정

1. `band-supported`와 `standalone-vocal`은 `ArrangementMode` discriminated union으로만 표현한다.
2. Core runtime schema는 `worship-band-v1 + band-supported`만 허용한다.
3. Source Lead와 Generated Harmony Track을 타입 수준에서 분리한다.
4. Performer, TrackPlan, PlacementRole, Behavior, Assignment를 분리한다.
5. Simple / Standard / Full은 각각 독립 `ArrangementVariant`와 독립 Plan 생명주기를 가진다.
6. Plan은 Intent → Activity → Anchor의 세 단계 타입으로 분리한다.
7. Lock은 Intent / Activity / Anchor / Solver 단계별 union으로 분리한다.
8. AnchorLock은 과거 Anchor ID를 참조하지 않는 자기완결 semantic payload다.
9. 각 단계는 별도의 input digest를 가지며 자기 단계보다 뒤의 Lock을 읽을 수 없다.
10. preferred tessitura와 performer-track mapping은 Intent 입력 digest의 정본 입력이다.
11. Source chord edit·gap policy·carry 해석은 단일 `EffectiveChordTimeline`으로 정규화한다.
12. Core gap policy는 `carry-until-next | block-gap`만 허용하며 자동 N.C. 생성은 하지 않는다.
13. 명시적 N.C.는 confirmed SourceChordEvent로만 들어간다.
14. chord resolver version은 `AlgorithmVersionRegistry`와 EffectiveChordTimeline의 단일 값이다.
15. Planner·Solver·Validator·Accompaniment·Render·Share는 같은 EffectiveChordTimeline만 사용한다.
16. Candidate에는 Source Lead를 복제하지 않고 generated harmony만 저장한다.
17. 렌더·재생·공유 시 Source Lead와 materialized generated harmony를 조립한다.
18. 코드 의미는 최종 구성음 의미를 보존하며 profile-independent semantic importance와 track별 realization ranking을 분리한다.
19. chord-tone ranking은 hard·comfortable·preferred range를 서로 다른 권한으로 사용한다.
20. `ChordParseResult`는 성공·N.C.·carry·실패를 구분한다.
21. chord alias는 root 뒤에서 longest-token-first lexer로 처리하며 문자열 전역 치환하지 않는다.
22. 모든 canonical 음악 시간은 quarter-note unit의 Fraction이다.
23. 모든 구간은 `[start, end)`이며 마디 경계 위치는 다음 occurrence의 offset 0으로 canonicalize한다.
24. KeySignature는 tonic+mode만 저장하고 fifths는 파생한다.
25. TimeSignature beatGroups는 양의 정수이며 합이 numerator와 같아야 한다.
26. 단일 event는 occurrence boundary를 넘지 않는다. 넘으면 분할하고 tie로 연결한다.
27. 반복 악보는 generation 전에 실제 연주 순서로 선형 전개한다.
28. PhraseRegion은 SongSourceDocument의 정본 필드다.
29. 비화성음·Lead-derived·코드톤 anchor는 discriminated union으로 분리한다.
30. N.C.에서는 독립 harmony·pad·suspension을 생성하지 않는다.
31. coverage는 `BasisPoints`, 100%를 넘을 수 있는 attack ratio는 비음수 safe-integer `ExtendedBasisPoints`로 표현한다.
32. 분모가 0일 수 있는 품질 비율은 numerator·denominator·nullable value를 가진 `CountRateMetric` 또는 `DurationRateMetric`으로 저장한다.
33. semantic digest는 versioned projection → RFC 8785 계열 canonical JSON → UTF-8 → SHA-256 → lowercase hex 64자로 고정한다.
34. PerformanceChordSpan·TimelineAtom·Generated Track ordinal의 ID·고유성·migration 규칙을 고정한다.
35. 내부 Plan 준수 지표와 음악 품질 지표를 분리한다.
36. Grammar는 `complete | blocked` union을 반환하며 가짜 Intent를 만들지 않는다.
37. Grammar candidate trace는 optional non-semantic artifact이며 Intent 의미·digest에 dangling ID를 남기지 않는다.
38. Candidate 원본과 사용자 출력 편집 결과를 `EditedArrangementSnapshot`으로 분리한다.
39. replacement event payload는 ID를 받지 않으며 1:1 교체 시 기존 event ID를 유지한다.
40. edit materialization은 `complete | blocked` union을 반환한다.
41. Edited snapshot은 timeline·validator·metric version/config digest를 보존한다.
42. Plan mutation은 stage Lock과 downstream regeneration으로 처리하며 Output edit와 섞지 않는다.
43. PracticeShare는 schemaVersion 3만 사용한다.
44. OMR Vendor Adapter와 HarmonyMaker Application Service를 분리한다.
45. OMR evidence는 coordinate frame·transform graph·vendor↔canonical target mapping을 함께 보존한다.
46. OMR evidence digest는 정해진 fixed-point projection을 사용한다.
47. unmapped vendor evidence는 `OmrEvidenceArchive`에 보존한다.
48. OMR review resolution은 선택한 alternative·correction record와 직접 연결한다.
49. 권리 확인은 generation·evaluation·share·provider-transfer별로 분리한다.
50. `SourceLeadAtomization`은 Source·Performance Timeline·EffectiveChordTimeline에서만 만들어지는 canonical artifact다.
51. Grammar split·Activity attack·NCT resolution·Lock boundary는 persistent atom ID를 만들지 않는 stage-local sub-atom이다.
52. Variant freshness는 lifecycle을 대체하지 않는 `VariantStaleness` flag이며 기존 Plan·OutputEdit·Snapshot을 보존한다.
53. `SongSourceDocument`는 stable document identity와 monotonic revision identity를 가진다.
54. OMR correction·evidence target은 적용 당시 source revision으로 scope되며 revision 간 ID remap을 보존한다.
55. Phrase semantic identity는 section occurrence와 canonical range로만 정해지며 revision counter는 ID·digest 권위가 아니다.
56. Candidate content digest는 generated musical content와 plan provenance만 포함하고 diagnostic message·metric·solver trace를 제외한다.
57. Candidate·Diagnostic·Activity span/attack·Performer 등 persistent reference ID는 Section 4.2의 deterministic rule을 따른다.
58. `PresetProfileRegistry`는 versioned config artifact이며 모든 stage input digest가 그 version·digest를 포함한다.
59. Section intensity의 canonical authority는 `SectionArrangementIntent`; Phrase Intent는 section intent를 참조한다.
60. Grammar는 `planSection()`과 `planPhrase()`를 분리한다. Phrase Grammar는 필요할 때 exact `splitDirective.position`을 반환하고, Activity 단계가 canonical atom을 ID 없는 sub-atom으로 세분해 attack·sustain·release를 실현한다.
61. Worship Arrangement Grammar v1의 실제 음악 결정표는 별도 문서가 권위다.
62. Step 2는 본 authoritative 명세를 기준으로 시작할 수 있다.
63. Step 4는 Grammar v1이 별도로 승인된 뒤에만 시작한다.
64. Lyric emphasis annotation은 `none | suggested | confirmed` 상태와 provenance의 유효 조합을 discriminated union으로 제한한다.
65. production 생성이 읽는 lyric emphasis 의미의 유일한 권위는 `resolveProductionLyricEmphasis()`의 `ProductionLyricEmphasis` 결과다.
66. `musicalSourceDigest`와 `SourceLeadAtomization.digest`는 raw `emphasisSource` 전체가 아니라 `ProductionLyricEmphasis`를 포함한다. production 동작이 같으면 provenance만 다른 상태는 같은 generation semantic digest를 갖고, production 동작이 다르면 반드시 다른 digest를 갖는다.

## 0.8 Core 비목표

- 모든 CCM 장르
- 4성부 이상
- 가스펠 런
- 자유 애드리브
- 멜리스마 자동 생성
- 카운터멜로디
- 가사 재작성
- 랩·spoken word
- 곡 중간 전조
- 곡 중간 tempo change event
- D.S./Coda 완전 자동 전개
- 손글씨 OMR
- 오케스트라 총보 완전 복원
- 자체 OMR Transformer
- 데이터형 phrase pattern retrieval
- 학습형 runtime reranker
- Grammar v1을 이 문서 안에서 임의 완성하는 것

---

# 1. 사용자·권리·제품 흐름

## 1.1 1차 사용자

- 전문 편곡자가 없는 한국 교회 소규모 찬양팀 리더
- 1–3명의 보컬을 실제 음역에 맞춰 배치해야 하는 찬양 인도자
- 멜로디와 코드 리드 시트는 있지만 보컬 화음을 직접 쓰기 어려운 사용자

## 1.2 2차 사용자

- 공유 링크로 자기 파트를 연습하는 팀원
- 느린 속도와 Solo가 필요한 보컬
- MusicXML로 내보내 다른 악보 도구에서 마무리하는 사용자

## 1.3 권리 정본

```ts
type RightsBasis =
  | "self-authored"
  | "public-domain"
  | "licensed"
  | "user-confirmed-rights";

type AllowedUse =
  | "generation"
  | "evaluation"
  | "share"
  | "provider-transfer";

interface RightsMetadata {
  readonly basis: RightsBasis;
  readonly allowedUses: readonly AllowedUse[];
  readonly sourceReference?: string;
  readonly licenseNote?: string;
  readonly confirmedAt?: string;
}
```

정책:

- 편곡 시작 전 `generation` 권한 필요
- 외부 OMR 전송 전 `provider-transfer` 권한·동의 필요
- PracticeShare 생성 전 `share` 권한 필요
- Dev·sealed·Grammar fixture는 `evaluation` 권한 필요
- 권리 미확인 상태를 자동 허용하지 않는다.
- `user-confirmed-rights`는 confirmedAt 필수
- licensed는 sourceReference 또는 licenseNote 중 하나 필수
- allowedUses가 바뀌면 해당 동작의 권한을 즉시 재평가
- ShareStore에는 신고·삭제 경로와 owner delete secret을 둔다.

## 1.4 리더의 기본 흐름

```text
MusicXML 열기 또는 직접 입력
→ Quick Review
→ 멜로디·코드·구간·권리 확인
→ 보컬 수와 음역 선택
→ 요청 preset 선택
→ Preset별 결과 생성
→ 악보·반주와 함께 비교
→ 필요한 음만 수정
→ 연습 링크 공유
```

기본 요청 preset은 Simple / Standard / Full 세 개다. 사용자가 하나만 요청할 수도 있다.


## 1.5 Quick Review

```ts
interface QuickReviewState {
  readonly selectedLeadStaffKey?: string;
  readonly unresolvedChordGapDiagnosticIds: readonly string[];
  readonly unconfirmedChordEventIds: readonly string[];
  readonly unconfirmedSectionDefinitionIds: readonly string[];
  readonly invalidPerformerIds: readonly string[];
  readonly unsupportedPerformanceFlowIds: readonly string[];
  readonly missingRightsUses: readonly AllowedUse[];
  readonly blockingDiagnosticIds: readonly string[];
  readonly readyForPlanning: boolean;
}
```

Section 확인의 권위는 `SectionDefinition.confirmation`이다. 하나의 definition을 참조하는 모든 occurrence는 같은 section type·label 확인 상태를 공유한다. occurrence별 `variant`는 별도 편곡 속성이며 section label confirmation으로 취급하지 않는다.

`readyForPlanning=true` 조건:

- Source Lead 선택 완료
- generation 구간의 confirmed source chord 또는 confirmed N.C. 입력 완료
- `EffectiveChordTimelineState.status="resolved"`
- section definition 확인 완료
- performer range 유효
- generation 권리 확인
- 지원되지 않는 performance flow 없음
- blocking diagnostic 0

미확인 chord가 gap을 모두 채우고 있어도 `unconfirmedChordEventIds`가 남아 있으면 ready가 아니다.

Plan-first는 내부 아키텍처다. 사용자가 phrase plan editor를 반드시 열어야 한다는 뜻이 아니다.

## 1.6 음역 Onboarding

초기 UI는 다음을 제공한다.

- 여성 높음 / 중간 / 낮음 preset
- 남성 높음 / 중간 / 낮음 preset
- 화면 건반으로 편한 최저·최고음 선택
- 절대 불가능 음역과 편한 음역의 분리 설명
- 마이크 자동 측정은 Post-Core

## 1.7 팀원 연습 흐름

```text
연습 링크 열기
→ 악보·가사·코드 보기
→ 자기 파트 Solo
→ 50 / 75 / 100 / 125 / 150% 속도
→ 반주 on/off
→ 구간 반복은 Post-Core 선택
```

---

# 2. 시스템 아키텍처와 모듈 경계

권장 구조:

```text
src/
  domain/
    fraction/
    pitch/
    time/
    chord/
    source/
    performer/
    project/
    plan/
    generation/
    diagnostic/
    rights/
  import/
    musicxml/
    mxl/
  arrangement/
    planner-contract/
    activity/
    anchor/
    solver/
    assembler/
    validator/
    baseline/
  grammar/
    adapter/
    config/
  playback/
    render-document/
    abcjs-adapter/
    accompaniment/
  share/
    payload/
    store/
  omr/
    application/
    vendor/
    evidence/
    correction/
    evaluation/
  evaluation/
    fixtures/
    metrics/
    reports/
```

의존 방향:

```text
domain
↑
import / arrangement / grammar-adapter / playback / share / omr
```

금지:

- `domain`이 React·abcjs·Vendor SDK를 import
- production arrangement가 evaluation fixture를 import
- baseline이 production solver 내부 구현을 import
- Vendor raw OMR model이 canonical source를 직접 덮어쓰기
- UI state가 semantic digest에 포함
- Grammar 구현이 Source·Project를 mutation

---

# 3. 정확한 시간·Fraction·구간 정본

## 3.1 Fraction 단위

모든 음악 시간값은 **quarter-note unit**이다.

```text
quarter note       = 1/1
eighth note        = 1/2
dotted quarter     = 3/2
sixteenth note     = 1/4
whole note         = 4/1
```

```ts
interface Fraction {
  readonly n: number;
  readonly d: number;
}
```

정본:

- `d > 0`
- `n`, `d`는 safe integer
- `gcd(abs(n), d) = 1`
- 0은 `{ n: 0, d: 1 }`
- 연산 후 즉시 약분
- timeline에 float 사용 금지

필수 함수:

```ts
declare function normalizeFraction(value: Fraction): Fraction;
declare function addFraction(a: Fraction, b: Fraction): Fraction;
declare function subtractFraction(a: Fraction, b: Fraction): Fraction;
declare function multiplyFraction(a: Fraction, b: Fraction): Fraction;
declare function divideFraction(a: Fraction, b: Fraction): Fraction;
declare function compareFraction(a: Fraction, b: Fraction): -1 | 0 | 1;
declare function equalsFraction(a: Fraction, b: Fraction): boolean;
declare function isPositiveFraction(value: Fraction): boolean;
declare function isNonNegativeFraction(value: Fraction): boolean;
```

초기 상한:

```ts
const FRACTION_LIMITS = {
  maxAbsNumerator: 10_000_000,
  maxDenominator: 16_384,
  maxOperationsPerRequest: 500_000,
} as const;
```

모든 곱셈은 cross-cancel 또는 overflow guard를 사용한다. `Number.isSafeInteger`를 통과하지 못하면 차단한다.

상한 초과 시 `INPUT_FRACTION_LIMIT_EXCEEDED`.

## 3.2 MusicalPosition

```ts
interface MusicalPosition {
  readonly performanceMeasureIndex: number;
  readonly offset: Fraction;
}
```

정본:

- `performanceMeasureIndex`는 0-based
- 일반 위치는 `0 <= index < occurrenceCount`
- 일반 위치의 offset은 `0 <= offset < occurrenceDuration`
- 곡 최종 end만 `index = occurrenceCount`, `offset = 0/1`
- 마디 끝은 이전 occurrence의 duration이 아니라 **다음 occurrence의 offset 0**으로 표현
- 같은 절대 시점은 오직 하나의 canonical position을 가진다.

필수 함수:

```ts
declare function compareMusicalPosition(
  a: MusicalPosition,
  b: MusicalPosition,
): -1 | 0 | 1;

declare function canonicalizeMusicalPosition(
  position: MusicalPosition,
  measures: readonly PerformanceMeasureOccurrence[],
): MusicalPosition;
```

## 3.3 구간 정본

모든 시간 구간은 `[start, end)`다.

```ts
interface MusicalRange {
  readonly start: MusicalPosition;
  readonly end: MusicalPosition;
}
```

- `start < end`
- 끝점 사건은 다음 구간에 속한다.
- 겹침 검사는 half-open interval 기준이다.
- 0길이 상태 span 금지
- attack·release는 별도 point event다.

## 3.4 Event boundary

단일 Source 또는 Generated event는 performance occurrence boundary를 넘지 않는다.

넘는 이벤트는:

1. occurrence boundary에서 분할
2. note이면 tie로 연결
3. lyric은 첫 segment만 소유
4. 뒤 segment는 extender
5. source provenance를 유지

## 3.5 Meter, key, tempo

```ts
interface TimeSignature {
  readonly numerator: number;
  readonly denominator: 4 | 8;
  readonly beatGroups: readonly number[];
}

interface KeySignature {
  readonly tonic: SpelledPitchClass;
  readonly mode: "major" | "minor";
}

interface TempoSpec {
  readonly beatUnit: 4 | 8;
  readonly dotted: boolean;
  readonly bpm: number; // integer 20..300
}

type KeyFifths = -7 | -6 | -5 | -4 | -3 | -2 | -1 | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

declare function deriveFifths(key: KeySignature): KeyFifths;
```

Key 정본:

- canonical KeySignature의 유일한 조성 권위는 `tonic + mode`다.
- `fifths`는 저장하지 않고 `deriveFifths()`로 파생한다.
- `SongSourceDocument.defaultKey`가 Core generation의 유일한 key authority다.
- `SourceMeasure.key`가 존재하고 defaultKey와 semantic equal하지 않으면 중간 전조로 간주해 `UNSUPPORTED_MODULATION` blocking이다.
- MusicXML 등 외부 입력의 fifths는 import evidence로만 취급한다.
- imported fifths가 `deriveFifths(tonic, mode)`와 다르면 `INPUT_KEY_SIGNATURE_INCONSISTENT` blocking.
- Core가 지원하지 않는 enharmonic spelling 또는 `-7..7` 밖의 key는 `UNSUPPORTED_KEY_SIGNATURE`.

필수 fixture:

```text
C major  → 0
G major  → 1
F major  → -1
A minor  → 0
E minor  → 1
D minor  → -1
```

TimeSignature 정본:

- numerator는 양의 safe integer.
- beatGroups는 비어 있지 않음.
- 모든 group은 양의 safe integer.
- `sum(beatGroups) = numerator`.
- Core 4/4 canonical group은 `[1,1,1,1]`.
- Core 6/8 canonical group은 `[3,3]`.
- 유효하지만 다른 grouping은 import·표시는 가능하나 Core generation에서 `UNSUPPORTED_BEAT_GROUPING`으로 차단.
- 위 불변식 위반은 `INPUT_BEAT_GROUPS_INVALID`.

Core generation 지원:

```text
4/4 + [1,1,1,1] → quarter-note primary pulse
6/8 + [3,3]     → dotted-quarter primary pulse
```

다른 meter 또는 grouping은 import·표시할 수 있어도 Core generation을 차단한다.


## 3.6 고정소수점

```ts
type BasisPoints = number & { readonly __brand: "BasisPoints" }; // 0..10000
type ExtendedBasisPoints = number & {
  readonly __brand: "ExtendedBasisPoints";
}; // non-negative safe integer; 100% 초과 가능
type CostUnit = number & { readonly __brand: "CostUnit" };
```

- `BasisPoints`는 duration coverage·정확도처럼 100%를 넘을 수 없는 값에만 사용한다.
- `ExtendedBasisPoints`는 `모든 harmony attack / Lead attack`처럼 100%를 넘을 수 있는 비율에 사용한다.
- `ExtendedBasisPoints`에는 음악적 임의 상한을 두지 않는다. 값은 비음수 safe integer여야 한다.
- preset의 허용 상한은 `PresetDifficultyProfile.maxHarmonyAttackRatioBp`가 별도로 제한한다.
- 10000 bp = 100%.
- `CostUnit`은 비음수 safe integer다.
- `1 CostUnit = 1/1000 relative cost point`로 고정한다.
- 모든 local·boundary·section·song cost는 정수 가중치와 정수 합으로만 계산한다.
- 평균이 필요하면 exact 분자·분모에서 decimal round-half-up으로 `CostUnit`을 만든다.
- float cost와 플랫폼별 epsilon tie-break는 금지한다.
- canonical 비교는 integer.
- UI에서만 `%` 또는 소수 cost로 표시한다.
- 비율 변환은 exact Fraction 또는 정수 count에서 decimal round-half-up으로 계산한다.

```ts
declare function ratioToBasisPoints(
  numerator: Fraction,
  denominator: Fraction,
): BasisPoints;

declare function ratioToExtendedBasisPoints(
  numerator: number,
  denominator: number,
): ExtendedBasisPoints;
```

분모가 0이면 임의 0을 반환하지 않는다. `CountRateMetric`, `DurationRateMetric` 또는 caller의 blocked contract를 사용한다.

# 4. Canonical ID와 semantic projection

## 4.1 ID와 digest의 역할 분리

Entity ID는 프로젝트 안의 참조 안정성을 위한 값이다. Semantic digest는 ID 문자열 자체가 아니라 canonical ordinal projection을 해시한다.

```text
Entity ID
→ 프로젝트 내 참조

Canonical ordinal key
→ digest·비교·결정성
```

## 4.2 기본 deterministic ID 규칙

정규화 직후 기본 ID:

```text
SourceDocument        doc:{nonSemanticDocumentId}
SourceRevision        rev:{revisionOrdinal}:{revisionDigest}
SourceMeasure         sm:{sourceMeasureIndex}
LeadEvent             le:{sourceMeasureIndex}:{eventOrdinalWithinMeasure}
SourceChordEvent      ch:{sourceMeasureIndex}:{chordOrdinalWithinMeasure}
LyricToken            ly:{sourceMeasureIndex}:{leadEventOrdinal}:{verse}:{ordinal}
SourceTextEvent       tx:{sourceMeasureIndex}:{onsetKey}:{kind}:{ordinal}
PerformanceOccurrence pm:{performanceIndex}:{sourceMeasureIndex}:{sourceOccurrenceIndex}
SectionDefinition     sd:{sourceStart}:{sourceEndExclusive}:{type}:{ordinal}
SectionOccurrence     so:{performanceStart}:{performanceEndExclusive}:{definitionOrdinal}
PhraseRegion          ph:{sectionOccurrenceOrdinal}:{startKey}:{endKey}
SourceLeadTrack       track:source-lead
HarmonyTrack          track:h{canonicalOrdinal}
PerformanceChordSpan  pcs:{startPositionKey}:{endPositionKey}
TimelineAtom          ta:{performanceMeasureIndex}:{sourceEventOrdinalWithinMeasure}:{startOffsetKey}:{endOffsetKey}
PhraseIntent          pi:{preset}:{phraseOrdinal}
SectionIntent         si:{preset}:{sectionOccurrenceOrdinal}
TrackRoleSegment      tr:{preset}:{phraseOrdinal}:{trackOrdinal}
PhraseActivityPlan    pa:{preset}:{phraseOrdinal}
VoiceActivitySpan     vas:{preset}:{phraseOrdinal}:{trackOrdinal}:{startKey}:{endKey}
VoiceAttackEvent      vae:{preset}:{phraseOrdinal}:{trackOrdinal}:{positionKey}:{kind}
PhraseAnchorPlan      pn:{preset}:{phraseOrdinal}
AnchorDirective       ad:{preset}:{phraseOrdinal}:{trackOrdinal}:{positionKey}:{ordinal}
NctPlan               nct:{preset}:{phraseOrdinal}:{trackOrdinal}:{positionKey}:{kind}
StageLock             lk:{preset}:{stage}:{targetKey}:{ordinal}
GrammarTraceCandidate gt:{preset}:{phraseOrdinal}:{textureId}:{candidateOrdinal}
PhraseCandidate       pc:{preset}:{phraseOrdinal}:{candidateOrdinal}
SectionCandidate      sc:{preset}:{sectionOccurrenceOrdinal}:{candidateOrdinal}
ArrangementCandidate  cand:{preset}:{fullCandidateContentDigest}
PerformerProfile      pf:{performerOrdinal}
Diagnostic            dg:{code}:{locationKey}:{ordinal}
OutputEdit            oe:{preset}:{baseCandidateDigest}:{editOrdinal}
EditedSnapshot        es:{preset}:{fullEditedSnapshotContentDigest}
ImageCoordinateFrame  frm:{pageIndex}:{coordinateSpace}:{fullImageDigest}
ImageTransform        xf:{sourceFrameId}:{targetFrameId}:{matrixProjectionDigest}
Evidence              ev:{vendor}:{frameId}:{boxKey}:{evidenceOrdinalWithinBox}
OmrAutoRepairProposal oar:{revisionTargetKey}:{reason}:{proposalOrdinal}
OmrReviewItem         ori:{reviewOrdinal}
OmrReviewAlternative  ora:{reviewOrdinal}:{alternativeOrdinal}
OmrCorrectionRecord   ocr:{reviewOrManualKey}:{correctionOrdinal}
SourceRevisionRecord  ser:{fromRevisionOrdinal}:{toRevisionOrdinal}:{editOrdinal}
SourceIdRemap         srm:{fromRevisionOrdinal}:{toRevisionOrdinal}
```

`startPositionKey`, `endPositionKey`, `startOffsetKey`, `endOffsetKey`는 normalized Fraction을 사용한 canonical position 문자열이다.

ID 정본:

- `documentId`는 프로젝트 생성 시 CSPRNG로 한 번 만들고 모든 source revision에서 유지한다. semantic digest에서는 제외한다.
- `PerformerProfile.id`는 canonical performer ordinal로 만든다. 표시 이름은 ordinal 산정에 사용하지 않는다.
- `Diagnostic.locationKey`는 scope·preset·phrase/section/measure/position·track canonical ordinal을 canonical order로 직렬화한 문자열이다.
- 동일 code·location에서 여러 진단이 나오면 canonical details projection 순서로 ordinal을 배정한다.
- `PhraseCandidate`와 `SectionCandidate` ID는 trace·조립 artifact에만 사용하며 final Candidate semantic projection에서 제외한다.
- `ArrangementCandidate.id`는 content digest로부터 파생되며 임의 UUID를 사용하지 않는다.
- `ImageCoordinateFrame.id`의 image digest는 full `BinaryDigest`를 사용한다.
- `ImageTransform.matrixProjectionDigest`는 source/target frame ID와 fixed-point matrix payload를 `hm-image-transform-v1` projection으로 해시한 full digest다.
- Evidence `boxKey`는 frame ID + fixed-point x/y/width/height의 canonical key이며 같은 box 안의 ordinal은 vendor target ID·granularity·confidence canonical order로 부여한다.
- OMR auto-repair proposal ordinal은 같은 revision-scoped target·reason 안에서 patch semantic projection order의 0-based 연속 정수다.
- Risk waiver·UI session처럼 generation semantic graph 밖의 governance ID는 CSPRNG를 허용하되 어떤 음악 digest·tie-break에도 사용할 수 없다.

Structural source edit 후:

- 새 `SourceRevisionRef`를 생성한다.
- source graph를 canonical order로 다시 정규화한다.
- 새 semantic ID graph를 생성한다.
- `SourceIdRemap`으로 이전 revision target과 새 revision target의 관계를 기록한다.
- 기존 lock·edit를 provenance mapping으로 이전한다.
- 이전할 수 없는 참조는 stale diagnostic을 발행한다.

## 4.3 Generated Track ordinal 불변식

```ts
type GeneratedTrackOrdinal = 1 | 2;
```

- Source Lead ordinal은 항상 0
- 모든 generated track은 enabled 여부와 무관하게 프로젝트 안에서 고유한 ordinal을 가짐
- generated track ordinals는 `1..N`의 연속 정수이며 Core에서 `N<=2`
- track disable은 ordinal을 바꾸지 않음
- track 추가는 마지막 ordinal 뒤에 배정
- track 삭제·순서 변경으로 재번호가 필요하면 structural migration을 수행하고 lock·assignment·edit provenance를 함께 이전
- duplicate ordinal 또는 gap은 blocking diagnostic

## 4.4 Canonical order

- source measure: source index
- source event: measure 내부 onset → note/rest kind → pitch → duration → original ordinal
- chord event: measure 내부 onset → semantic chord projection → original ordinal
- source text: onset → kind → normalized text → original ordinal
- performance chord span: range start → range end → semantic chord projection
- timeline atom: performance measure index → source event ordinal within measure → range start → range end
- section occurrence: performance start → end → type
- phrase: start → end
- track: source lead 먼저, generated track의 canonicalOrdinal
- performer: assigned track canonical order → hard range → comfortable range → preferred tessitura 또는 null
- lock: preset → stage → target position → track order → lock ID
- output edit: base candidate digest → edit ordinal → edit ID
- diagnostic: code → canonical location → canonical details projection

표시 이름·UI output order는 semantic canonical order에 영향을 주지 않는다.

## 4.5 Semantic projection에서 제외

- 파일명
- import 시각
- 표시 이름
- UI 선택 상태
- random project ID
- Vendor raw job ID
- Provider raw metadata
- 원문 코드 alias 문자열
- trace·debug artifact
- OMR 이미지 transform처럼 generation 의미에 관여하지 않는 presentation evidence

원문 코드 표기는 SourceChordEvent에 보존하되 ParsedChord semantic projection에는 넣지 않는다.

## 4.6 Canonical JSON codec와 digest 정본

```ts
type SemanticDigest = string & { readonly __brand: "SemanticDigest" };
type BinaryDigest = string & { readonly __brand: "BinaryDigest" };

type CanonicalJsonPrimitive = null | boolean | string | number;
type CanonicalJsonValue =
  | CanonicalJsonPrimitive
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue };

interface SemanticDigestEnvelope<T extends CanonicalJsonValue> {
  readonly projectionSchema: string;
  readonly value: T;
}
```

정본 절차:

1. domain object를 versioned semantic projection으로 변환
2. 모든 ID reference를 canonical ordinal·position key로 치환
3. set-like array는 해당 domain comparator로 미리 정렬
4. 문자열은 Unicode NFC로 정규화
5. object key는 RFC 8785 JSON Canonicalization Scheme의 UTF-16 code-unit order로 정렬
6. `undefined`, sparse array, `NaN`, `Infinity`, `-Infinity`, `BigInt`, function, symbol 금지
7. 모든 canonical number는 `Number.isSafeInteger=true`인 정수만 허용
8. Fraction은 `{ "n": normalizedNumerator, "d": normalizedDenominator }`로 직렬화
9. UTF-8 bytes로 인코딩
10. SHA-256 해시
11. lowercase hexadecimal 64자로 표현

```ts
declare function encodeCanonicalJson(
  value: CanonicalJsonValue,
): Uint8Array;

declare function sha256LowerHex(
  bytes: Uint8Array,
): SemanticDigest;

declare function digestSemanticProjection<T extends CanonicalJsonValue>(
  envelope: SemanticDigestEnvelope<T>,
): SemanticDigest;
```

- `projectionSchema`는 예: `hm-musical-source-v1`, `hm-intent-input-v1`처럼 artifact마다 고정한다.
- codec 구현은 Node·browser에서 byte-for-byte parity fixture를 통과해야 한다.
- 다른 hash algorithm·base64 표현·일반 `JSON.stringify`를 임의 사용하지 않는다.
- codec version은 `AlgorithmVersionRegistry.digestCodecVersion`에 기록한다.
- output edit materialization과 OMR evidence mapping도 각각 `editMaterializerVersion`, `evidenceMappingVersion`으로 고정한다.

Binary digest 정본:

- 아래 byte digest는 `BinaryDigest` 타입을 사용한다.
- 업로드 원본, page raster, processed image, Vendor export처럼 byte sequence를 해시하는 모든 `rawDigest`, `pageDigest`, `imageDigest`, `vendorResultDigest`, `providerResultDigest`는 SHA-256 lowercase hexadecimal 64자다.
- binary digest에는 JSON codec을 적용하지 않고 원본 byte sequence를 직접 해시한다.
- MIME metadata·파일명·업로드 시각은 binary digest에 포함하지 않는다.

---

# 5. 현대 코드 dialect와 의미 모델

## 5.1 핵심 원칙

`C7`, `Cmaj7`, `Cm7`, `CmMaj7`은 서로 다른 구성음을 가져야 한다.

“7이라는 숫자가 있다”만 저장하지 않는다.

## 5.2 Spelled pitch class

```ts
type Step = "C" | "D" | "E" | "F" | "G" | "A" | "B";
type Alter = -2 | -1 | 0 | 1 | 2;

interface SpelledPitchClass {
  readonly step: Step;
  readonly alter: Alter;
}

interface SpelledPitch extends SpelledPitchClass {
  readonly octave: number;
}
```


## 5.3 Chord tone identity와 중요도 계층

```ts
type ChordDegree = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 9 | 11 | 13;

type ChordToneRole =
  | "root"
  | "third"
  | "fifth"
  | "seventh"
  | "color"
  | "suspension";

type ChordToneOrigin =
  | "root"
  | "quality"
  | "extension"
  | "addition"
  | "alteration"
  | "suspension";

interface ChordToneSpec {
  readonly degree: ChordDegree;
  readonly alteration: -2 | -1 | 0 | 1 | 2;
  readonly role: ChordToneRole;
  readonly origin: ChordToneOrigin;
}
```

`ChordToneSpec`는 chord identity만 표현한다. performer 음역·texture·preset에 따른 실현 가능성은 저장하지 않는다.

```ts
interface SemanticChordToneImportance {
  readonly tone: ChordToneSpec;
  readonly identityPriority: number;
  readonly chordIdentityCritical: boolean;
}

declare function resolveSemanticChordImportance(
  chord: ParsedChord,
): readonly SemanticChordToneImportance[];
```

- `resolveSemanticChordImportance()`는 코드 자체의 의미만 계산한다.
- Lead가 이미 어떤 tone을 담당하는지, 특정 가수가 부를 수 있는지, 색채음을 preset이 허용하는지는 Section 17.4의 track별 ranking에서 처리한다.
- profile·performer 문맥을 ParsedChord나 semantic importance에 영구 저장하지 않는다.

## 5.4 ParsedChord

```ts
interface ParsedChord {
  readonly root: SpelledPitchClass;
  readonly tones: readonly ChordToneSpec[];
  readonly bass?: SpelledPitchClass;
  readonly omissions: readonly ChordDegree[];
  readonly canonicalSymbol: string;
}
```

정본:

- 같은 degree는 최종 하나의 alteration만 가진다.
- `no3`은 third를 제거한다.
- `sus2`·`sus4`는 명시적 third가 없으면 third를 대체한다.
- `add9`는 7음을 암시하지 않는다.
- `9`는 7음을 포함한다.
- slash bass는 chord tone이 아니어도 보존한다.
- `canonicalSymbol`은 semantic chord에서 결정적으로 생성한다.
- 원문 alias는 ParsedChord에 저장하지 않는다.

예:

```text
C7       1, 3, 5, b7
Cmaj7    1, 3, 5, 7
Cm7      1, b3, 5, b7
CmMaj7   1, b3, 5, 7
Cdim7    1, b3, b5, bb7
Cm7b5    1, b3, b5, b7
Cadd9    1, 3, 5, 9
Csus4    1, 4, 5
```

### Tone derivation 정본

기본 triad:

```text
quality 없음  → 1, 3, 5
m               → 1, b3, 5
dim             → 1, b3, b5
aug             → 1, 3, #5
```

Primary extension:

```text
2       → add2와 동일; 2도 추가, 9도 표기로 확장하지 않음
6       → 6 추가
7       → b7 추가
maj7    → 7 추가
9       → b7 + 9 추가
maj9    → 7 + 9 추가
6/9     → 6 + 9 추가
```

예외:

- `dim7`은 `bb7`을 사용
- `m7b5`는 minor triad + b5 + b7
- `aug7`은 augmented triad + b7
- `augmaj7` alias는 Core에서 지원하지 않음
- `mMaj7`, `mMaj9`는 minor triad에 natural 7을 사용
- sus는 third를 제거하고 2 또는 4를 suspension tone으로 추가
- `7sus4`는 b7을 유지
- addition은 extension을 암시하지 않음
- `b5/#5`는 기존 fifth를 변경
- `b9/#9/#11/b13`은 해당 altered color degree를 추가하며 unaltered degree를 자동 추가하지 않음
- 지원하지 않는 alteration·quality 조합은 실패

Role derivation:

```text
degree 1                       → root
degree 3                       → third
degree 5                       → fifth
degree 7                       → seventh
sus origin의 degree 2 또는 4   → suspension
그 밖의 2/4/6/9/11/13         → color
```

Core 허용 조합 표는 parser registry의 versioned fixture로 고정한다. 허용되지 않은 quality·extension·sus 조합은 `TOKEN_CONFLICT`이며 임의 단순화하지 않는다.

Tone canonical order:

```text
root → third/suspension → fifth → sixth → seventh → 2/4 → 9 → 11 → 13
```

같은 order에서 degree·alteration·origin으로 tie-break한다.

## 5.5 Parse result

```ts
type ChordParseResult =
  | {
      readonly status: "ok";
      readonly chord: ParsedChord;
    }
  | {
      readonly status: "no-chord";
      readonly sourceText: string;
    }
  | {
      readonly status: "carry";
      readonly sourceText: string;
    }
  | {
      readonly status: "failed";
      readonly sourceText: string;
      readonly errorCode:
        | "UNKNOWN_ROOT"
        | "TOKEN_CONFLICT"
        | "UNSUPPORTED_TOKEN"
        | "AMBIGUOUS_SLASH"
        | "EMPTY_CHORD"
        | "INVALID_TOKEN_ORDER";
      readonly token?: string;
    };

type ResolvedChordParseResult =
  | {
      readonly status: "ok";
      readonly chord: ParsedChord;
    }
  | {
      readonly status: "no-chord";
      readonly sourceText: string;
    };
```


## 5.6 `worship-leadsheet-v1` lexical grammar

### 입력 정규화

1. 양끝 Unicode whitespace 제거
2. root·bass의 `♯ → #`, `♭ → b`
3. 문자열 전체에 `ø → m7b5`, `° → dim`, `Δ → maj` 같은 전역 치환을 하지 않음
4. `N.C.`, `N.C`, `NC`는 ASCII case-insensitive로 인식하고 canonical `N.C.`로 정규화
5. root를 먼저 lex한 뒤 root 이후 token stream을 **전체 token registry의 longest-token-first**로 lexing
6. slash와 괄호 내부 comma 주변 whitespace 제거
7. 그 외 토큰 사이 whitespace는 허용하지 않음
8. 대소문자는 token registry의 alias 규칙에 따라 normalize

EBNF 요약:

```text
ChordToken      := NoChord | Carry | Root ChordBody? SlashBass?
NoChord         := case-insensitive("N.C." | "N.C" | "NC")
Carry           := "%"
Root            := NoteLetter Accidental?
NoteLetter      := "A" | "B" | "C" | "D" | "E" | "F" | "G"
Accidental      := "#" | "b" | "##" | "bb"
ChordBody       := Quality? PrimaryExtension? SuspensionToken? Modifier*
Quality         := "m" | "min" | "-" | "dim" | "aug" | "+"
SuspensionToken := "sus" | "sus2" | "sus4"
PrimaryExtension:= "2" | "6" | "6/9" | "7" | "maj7"
                 | "9" | "maj9"
Modifier        := Addition | Alteration | Omission | ParenthesizedModifiers
Addition        := "add2" | "add4" | "add6" | "add9" | "add11" | "add13"
Alteration      := "b5" | "#5" | "b9" | "#9" | "#11" | "b13"
Omission        := "no3" | "no5"
ParenthesizedModifiers := "(" Modifier (","? Modifier)* ")"
SlashBass       := "/" Root
```

### 전체 token registry와 longest-token-first

root 뒤에서 alias와 canonical token을 하나의 registry로 처리한다. 아래 그룹은 그룹 안에서도 문자열 길이 내림차순, 그다음 표기된 canonical 우선순위로 매칭한다.

```text
1.  minMaj9, mMaj9
2.  minMaj7, mMaj7
3.  maj9, MAJ9, Maj9, M9, Δ9
4.  maj7, MAJ7, Maj7, M7, Δ7
5.  min7b5, m7b5, ø7, ø
6.  dim7, °7
7.  add13, add11, add9, add6, add4, add2
8.  sus4, sus2, sus
9.  no5, no3
10. 6/9
11. #11, b13, b9, #9, b5, #5
12. min, dim, aug
13. maj, m, -, +, °, Δ
14. 9, 7, 6, 2
```

- `ø7`을 `ø`보다 먼저, `°7`을 `°`보다 먼저, `Δ9`·`Δ7`을 `Δ`보다 먼저 lex한다.
- `6/9`는 slash bass보다 먼저 하나의 PrimaryExtension token으로 lex한다.
- alias token을 문자열 전역 치환으로 처리하지 않는다.
- tokenization 후 semantic token으로 normalize한다.
- `2`는 primary extension이지만 의미는 `add2`와 동일하다. `C2 → Cadd2`이며 dominant extension을 암시하지 않는다.
- `Cø7 → Cm7b5`, `C°7 → Cdim7`, `CΔ9 → Cmaj9`가 fixture로 고정된다.

특수 조합:

```text
C7sus4  = C + sus4 + b7
CmMaj7  = minor triad + major 7
CmMaj9  = minor triad + major 7 + 9
Cdim7   = diminished triad + diminished 7
C6/9    = 6 + 9; slash bass가 아님
C6/9/E  = C6/9 + E bass
Cadd9/E = add9 + E bass
C7(no3) = dominant 7에서 third 제거
C(no5)  = major triad에서 fifth 제거
```

Token precedence:

1. Root
2. `6/9` 특수 token
3. Quality
4. Primary extension
5. suspension replacement
6. additions
7. alterations
8. omissions
9. 마지막 slash bass

충돌:

- 동일 degree에 서로 다른 alteration 두 개 → 실패
- `sus2`와 `sus4` 동시 → 실패
- `dim`과 `aug` 동시 → 실패
- `m`과 `sus` 조합은 Core에서 실패
- PrimaryExtension 중복·충돌 → 실패
- 지원하지 않는 token을 몰래 삭제하지 않음

Canonical symbol 순서:

```text
Root
→ quality
→ primary extension
→ sus
→ additions degree 오름차순
→ alterations degree 오름차순, b before #
→ omissions no3 then no5
→ slash bass
```

`canonicalSymbol`은 `ParsedChord.tones`와 semantic fields에서 결정적으로 파생되는 표시 문자열이며 semantic digest projection에서는 제외한다.

Canonical fixture:

```text
CM7        → Cmaj7
CΔ7        → Cmaj7
CΔ9        → Cmaj9
C-7        → Cm7
Cø         → Cm7b5
Cø7        → Cm7b5
C°         → Cdim
C°7        → Cdim7
Csus       → Csus4
C2         → Cadd2
C7(add9)   → C7add9
Cadd9/E    → Cadd9/E
N.C.       → N.C.
n.c.       → N.C.
```


## 5.7 Source chord와 EffectiveChordTimeline

```ts
interface SourceChordEvent {
  readonly id: string;
  readonly sourceMeasureId: string;
  readonly onset: Fraction;
  readonly sourceText: string;
  readonly parseResult: ChordParseResult;
  readonly source: "manual" | "musicxml" | "omr" | "suggested";
  readonly confirmation: "confirmed" | "unconfirmed";
}

interface SourceChordEditCommand {
  readonly baseRevision: SourceRevisionRef;
  readonly sourceChordEventId: string;
  readonly replacementSourceText: string;
  readonly replacementParseResult: ChordParseResult;
  readonly confirmation: "confirmed";
}
```

코드 값을 바꾸는 행위는 Project Lock이 아니라 Source edit다. 적용 결과는 새 `SongSourceDocument` revision을 만들고 `SourceRevisionRecord`에 원래 값·수정값·ID remap을 보존한다.

```ts
type ChordGapPolicy =
  | "carry-until-next"
  | "block-gap";

interface ChordResolutionPolicy {
  readonly gapPolicy: ChordGapPolicy;
}

type PerformanceChordSpanOrigin =
  | {
      readonly kind: "source-event";
      readonly sourceChordEventId: string;
    }
  | {
      readonly kind: "carried";
      readonly carrySource: "explicit-carry-token" | "gap-policy";
      readonly originatingSourceChordEventId: string;
      readonly previousSpanId: string;
      readonly carryTokenSourceChordEventId?: string;
    };

interface PerformanceChordSpan {
  readonly id: string;
  readonly range: MusicalRange;
  readonly parseResult: ResolvedChordParseResult;
  readonly origin: PerformanceChordSpanOrigin;
}

interface EffectiveChordTimeline {
  readonly sourceChordProjectionDigest: SemanticDigest;
  readonly performanceSequenceDigest: SemanticDigest;
  readonly resolutionPolicy: ChordResolutionPolicy;
  readonly chordTimelineResolverVersion: string;
  readonly spans: readonly PerformanceChordSpan[];
  readonly digest: SemanticDigest;
}

type EffectiveChordTimelineState =
  | {
      readonly status: "unresolved";
      readonly resolutionPolicy: ChordResolutionPolicy;
      readonly diagnostics: readonly Diagnostic[];
    }
  | {
      readonly status: "resolved";
      readonly timeline: EffectiveChordTimeline;
      readonly diagnostics: readonly Diagnostic[];
    }
  | {
      readonly status: "stale";
      readonly previousTimeline: EffectiveChordTimeline;
      readonly resolutionPolicy: ChordResolutionPolicy;
      readonly diagnostics: readonly Diagnostic[];
    }
  | {
      readonly status: "blocked";
      readonly previousTimeline?: EffectiveChordTimeline;
      readonly resolutionPolicy: ChordResolutionPolicy;
      readonly diagnostics: readonly Diagnostic[];
    };
```

`chordTimelineResolverVersion`의 유일한 권위는 `AlgorithmVersionRegistry.chordTimelineResolverVersion`이다. Resolver 호출 시 같은 값을 EffectiveChordTimeline에 복사하며 별도 config에 중복 저장하지 않는다. 불일치는 `CHORD_RESOLVER_VERSION_MISMATCH` blocking이다.

단일 권위 흐름:

```text
confirmed SourceChordEvent
+ ChordResolutionPolicy
+ expanded performance order
+ AlgorithmVersionRegistry.chordTimelineResolverVersion
→ EffectiveChordTimeline
→ SourceLeadAtomization
→ Intent / Activity / Anchor / Solver / Validator
→ Accompaniment / Render / Export / PracticeShare
```

그 이후 모듈은 `SourceMeasure.chordEvents`를 직접 해석하지 않는다.

Span provenance:

- `source-event` span은 반드시 confirmed SourceChordEvent 하나를 참조한다.
- `carried` span은 원래 confirmed SourceChordEvent와 직전 effective span을 모두 참조한다.
- explicit `%`로 만든 carry는 `carrySource="explicit-carry-token"`이며 실제 `%` SourceChordEvent를 `carryTokenSourceChordEventId`로 보존한다.
- gap policy의 자동 확장은 `carrySource="gap-policy"`이며 carry token ID가 없어야 한다.
- span의 parseResult는 origin source event의 resolved semantic chord와 exact equal해야 한다.
- `suggested + unconfirmed` event는 EffectiveChordTimeline에 들어갈 수 없다.
- 자동으로 `N.C.` source event를 만들어내지 않는다.

Carry resolution:

- `%`는 expanded performance order에서 직전 effective harmonic state를 복사한다.
- 직전 상태가 `ok`이면 같은 chord를 carry한다.
- 직전 상태가 explicit `no-chord`이면 no-chord를 carry한다.
- 곡 첫 harmonic state에서 `%`이면 `SOURCE_CHORD_CARRY_WITHOUT_PREVIOUS` blocking.
- repeat second pass에서도 실제 performance order의 직전 상태를 사용한다.

Gap policy:

- `worship-band-v1` 기본값은 `carry-until-next`.
- 첫 confirmed chord 이전 gap은 자동 carry 불가.
- `carry-until-next`는 직전 confirmed source event에서 유래한 span만 확장한다.
- `block-gap`은 모든 uncovered melody-bearing range를 `SOURCE_CHORD_GAP`으로 차단한다.
- 명시적 N.C.가 필요하면 사용자가 `N.C.` SourceChordEvent를 확인해야 한다.
- 명시적 N.C. 이후는 다음 confirmed chord까지 no-chord.
- unconfirmed suggestion은 carry source가 될 수 없음.
- generation 시 모든 melody-bearing position은 confirmed chord 또는 confirmed no-chord에 덮여야 함.
- EffectiveChordTimeline이 덮지 않는 non-melody/instrumental 구간은 harmony 생성 대상이 아니며 accompaniment는 silence다.

Invalidation:

- Source chord edit → 새 source revision, musicalSourceDigest 변경, EffectiveChordTimeline stale
- gap policy 변경 → musicalSourceDigest는 유지, EffectiveChordTimeline stale
- repeat expansion 변경 → EffectiveChordTimeline stale
- resolver version 변경 → EffectiveChordTimeline stale
- 새 timeline이 resolved되기 전 SourceLeadAtomization과 모든 preset Intent Plan 실행 금지
- stale/blocked state는 마지막으로 성공한 timeline 전체를 보존하며, 새 해석이 실패했다고 과거 artifact를 삭제하지 않는다.

공통성:

- Solver가 사용한 chord와 화면·반주·PracticeShare의 chord는 같은 timeline span이어야 한다.
- `sourceChordRespect`의 기준은 EffectiveChordTimeline이다.
- `ArrangementRenderDocument`와 `PracticeSharePayload`는 EffectiveChordTimeline에서 chord를 투영한다.


# 6. Source·Notation Timeline·Performance Timeline

## 6.1 SourceMeasure

```ts
interface MeasureRepeatDirectives {
  readonly startRepeat: boolean;
  readonly endRepeat?: {
    readonly totalPasses: 2 | 3 | 4;
  };
  readonly endingNumbers?: readonly (1 | 2)[];
}

interface SourceTextEvent {
  readonly id: string;
  readonly sourceMeasureId: string;
  readonly onset: Fraction;
  readonly kind: "section-label" | "rehearsal-mark" | "other";
  readonly text: string;
}

interface SourceMeasure {
  readonly id: string;
  readonly number: number;
  readonly implicit: boolean;
  readonly time: TimeSignature;
  readonly duration: Fraction;
  readonly key?: KeySignature;
  readonly leadEvents: readonly LeadEvent[];
  readonly chordEvents: readonly SourceChordEvent[];
  readonly lyricTokens: readonly LyricToken[];
  readonly textEvents: readonly SourceTextEvent[];
  readonly repeat: MeasureRepeatDirectives;
}
```

`duration`은 pickup·불완전 마디를 표현한다. 일반 마디는 time signature의 정규 길이와 같다.

## 6.2 Repeat 정본

- `totalPasses=2`는 최초 연주를 포함해 총 2회
- backward repeat 앞에 matching forward가 없으면 곡 처음부터 반복
- unmatched forward repeat는 blocking
- nested repeat는 Core에서 blocking
- 1·2번 ending은 하나의 repeat region 안에서만 허용
- ending number overlap·누락·3번 이상 ending은 blocking
- repeat expansion은 항상 종료되어야 함
- `occurrenceIndexForSource`는 0-based

## 6.3 Performance occurrence

```ts
interface PerformanceMeasureOccurrence {
  readonly occurrenceId: string;
  readonly sourceMeasureId: string;
  readonly sourceMeasureNumber: number;
  readonly occurrenceIndexForSource: number;
  readonly performanceIndex: number;
  readonly time: TimeSignature;
  readonly duration: Fraction;
}

interface PerformanceSequence {
  readonly occurrences: readonly PerformanceMeasureOccurrence[];
  readonly expanderVersion: string;
}
```

불변식:

- `performanceIndex`는 0부터 연속.
- `PerformanceSequence.expanderVersion`은 실행 시 `AlgorithmVersionRegistry.performanceExpanderVersion`과 exact equal해야 한다.
- occurrence의 lyric verse는 자신을 덮는 `SectionOccurrence.lyricVerseIndex`에서 파생한다.
- 한 occurrence에서 선택된 Lead lyric은 그 section occurrence의 verse token으로 이미 해석된다.
- occurrence duration은 source measure duration과 동일.
- sequence length는 Core 상한 이하.
- source measure가 반복되면 occurrence ID가 다름.
- expanded performance order는 `musicalSourceDigest`에 포함하고 lyric verse는 `SectionOccurrence.lyricVerseIndex`에서 한 번만 포함한다.

## 6.4 SectionDefinition과 SectionOccurrence

```ts
type SectionType =
  | "intro"
  | "verse"
  | "pre-chorus"
  | "chorus"
  | "bridge"
  | "tag"
  | "ending"
  | "other";

type SectionVariant =
  | "base"
  | "reprise"
  | "final"
  | "drop";

interface SectionDefinition {
  readonly id: string;
  readonly type: SectionType;
  readonly label: string;
  readonly sourceMeasureIds: readonly string[];
  readonly confirmation: "confirmed" | "suggested";
}

interface SectionOccurrence {
  readonly id: string;
  readonly sectionDefinitionId: string;
  readonly occurrenceIndex: number;
  readonly variant: SectionVariant;
  readonly lyricVerseIndex: number;
  readonly startPerformanceMeasureIndex: number;
  readonly endPerformanceMeasureIndexExclusive: number;
}
```

Core 불변식:

- `SectionDefinition.sourceMeasureIds`는 source measure index 오름차순의 **연속 구간**이며 duplicate·gap을 허용하지 않는다.
- section occurrence는 measure boundary에서만 시작·종료한다.
- 모든 performance occurrence를 정확히 한 번 덮는다.
- overlap·gap 금지.
- instrumental intro도 `intro` 또는 `other`로 덮는다.
- `occurrenceIndex`는 같은 definition 안에서 0-based.
- `lyricVerseIndex`는 1-based 양의 safe integer이며 해당 occurrence에서 사용할 LyricToken.verse를 고정한다.
- `variant`는 곡의 performance structure 사실이며 preset별로 달라질 수 없다.
- suggested section은 Quick Review에서 확인 전 generation 금지.
- 각 `SectionOccurrence.sectionDefinitionId`는 실제 존재하는 definition을 참조해야 한다.
- occurrence가 덮는 performance measure의 `sourceMeasureId`는 해당 definition의 `sourceMeasureIds` 안에 있어야 하며, 실제 performance order와 모순되면 `SECTION_COVERAGE_INVALID`다.
- 같은 performance occurrence를 두 section occurrence가 공유하거나 어떤 section도 덮지 않는 상태를 허용하지 않는다.

## 6.5 PhraseRegion

```ts
interface PhraseRegion {
  readonly id: string;
  readonly sectionOccurrenceId: string;
  readonly range: MusicalRange;
  readonly boundarySource:
    | "manual"
    | "musicxml"
    | "lead-rest"
    | "long-note"
    | "section-boundary"
    | "automatic-split";
}
```

정본:

- `SongSourceDocument.phraseRegions`가 phrase authority다.
- phrase는 하나의 section occurrence 안에 완전히 포함.
- phrase는 overlap하지 않음.
- melody-bearing 구간을 순서대로 덮음.
- 사용자가 경계를 바꾸면 range 기반 ID가 자연스럽게 바뀐다.
- 같은 section occurrence에서 동일 range로 되돌아온 phrase는 동일 semantic phrase로 취급한다.
- source revision history가 편집 순서를 보존하므로 phrase ID 안에 별도 revision을 넣지 않는다.
- 이전 phrase ID를 참조한 lock은 `SourceIdRemap`으로 이전하거나 `STALE_REFERENCE`로 처리하며 자동 추측하지 않는다.

Phrase ID:

```text
ph:{sectionOccurrenceOrdinal}:{startPositionKey}:{endPositionKey}
```

## 6.6 Source revision·identity·SongSourceDocument

```ts
interface SourceRevisionRef {
  readonly documentId: string;
  readonly revisionOrdinal: number;
  readonly revisionDigest: SemanticDigest;
}

interface SourceIdRemapEntry {
  readonly entityKind:
    | "measure"
    | "lead-event"
    | "chord-event"
    | "lyric-token"
    | "source-text"
    | "section-definition"
    | "section-occurrence"
    | "phrase";
  readonly fromId: string;
  readonly toIds: readonly string[];
  readonly status: "mapped-one" | "mapped-many" | "deleted" | "unresolved";
}

interface SourceIdRemap {
  readonly id: string;
  readonly fromRevision: SourceRevisionRef;
  readonly toRevision: SourceRevisionRef;
  readonly entries: readonly SourceIdRemapEntry[];
  readonly remapDigest: SemanticDigest;
}

interface RevisionScopedTarget {
  readonly sourceRevision: SourceRevisionRef;
  readonly target: OmrCorrectionTarget;
}

interface SourceRevisionRecord {
  readonly id: string;
  readonly editOrdinal: number;
  readonly fromRevision: SourceRevisionRef;
  readonly toRevision: SourceRevisionRef;
  readonly commandKind:
    | "source-chord-edit"
    | "omr-correction"
    | "section-edit"
    | "phrase-edit"
    | "manual-source-edit"
    | "undo-redo";
  readonly beforeProjection: string;
  readonly afterProjection: string;
  readonly idRemap: SourceIdRemap;
}

interface ImportInfo {
  readonly sourceKind: "manual" | "musicxml" | "omr";
  readonly originalFileName?: string;
  readonly importedAt?: string;
  readonly rawDigest?: BinaryDigest;
  readonly importerVersion: string;
  readonly providerMetadata?: Readonly<Record<string, string>>;
  readonly omrReviewRecord?: OmrReviewRecord;
  readonly omrEvidenceArchive?: OmrEvidenceArchive;
}

interface SongSourceDocument {
  readonly schemaVersion: 9;
  readonly documentId: string;
  readonly revisionOrdinal: number;
  readonly revisionDigest: SemanticDigest;
  readonly previousRevision?: SourceRevisionRef;
  readonly revisionHistory: readonly SourceRevisionRecord[];
  readonly revisionHistoryDigest: SemanticDigest;
  readonly title: string;
  readonly composer?: string;
  readonly defaultKey: KeySignature;
  readonly defaultTempo: TempoSpec;
  readonly sourceMeasures: readonly SourceMeasure[];
  readonly performanceSequence: PerformanceSequence;
  readonly sectionDefinitions: readonly SectionDefinition[];
  readonly sectionOccurrences: readonly SectionOccurrence[];
  readonly phraseRegions: readonly PhraseRegion[];
  readonly rights: RightsMetadata;
  readonly importInfo?: ImportInfo;
  readonly sourceEvidence?: SourceEvidenceIndex;
}
```

Revision 정본:

- `documentId`는 한 logical project 안에서 안정적인 CSPRNG identity이며 musical semantic digest에서 제외한다.
- `revisionOrdinal`은 0-based 단조 증가하며 undo/redo도 새 ordinal을 만든다.
- `revisionDigest`는 해당 revision의 `musicalSourceDigest`와 exact equal하다.
- `previousRevision`은 직전 revision의 documentId·ordinal·digest를 보존한다.
- `revisionHistory`는 generation semantic digest에서 제외되지만 `revisionHistoryDigest`로 무결성을 검사한다.
- `revisionHistoryDigest` projection은 revision ordinal 순서의 `SourceRevisionRecord`에서 record ID를 제외하고 from/to revision ref, commandKind, before/after projection, `idRemap.remapDigest`를 해시한다.
- `revisionHistoryDigest` 자체와 표시 metadata는 그 projection에서 제외한다.
- `SourceRevisionRecord.editOrdinal`은 같은 from→to revision pair 안에서 0-based 연속 정수이며 ID의 ordinal 권위다.
- `SourceIdRemap.remapDigest`는 `hm-source-id-remap-v1` projection으로 계산한다: from/to revision ref + entityKind/fromId/toIds/status를 canonical order로 포함하고 remap/record ID는 제외한다.
- `beforeProjection`과 `afterProjection`은 commandKind별 versioned canonical JSON 문자열이며 자유 형식 로그 문자열이 아니다.
- revisionHistory는 `fromRevision → toRevision`이 끊기지 않는 단일 chain이며 마지막 `toRevision`이 현재 document revision과 exact equal해야 한다.
- source structural edit는 새 문서를 만들고 `SourceIdRemap`을 반드시 산출한다.
- old target을 current graph로 안전하게 1:1 또는 1:N 매핑할 수 없으면 `unresolved`이며 `STALE_REFERENCE`를 발행한다.
- OMR review/correction target은 항상 `RevisionScopedTarget`을 사용한다.
- `SourceEvidenceIndex`와 archive는 자신이 매핑된 source revision을 명시한다.

`ImportInfo`, revision history, 표시 metadata는 musical semantic digest에서 제외한다. OMR evidence archive와 review history는 generation 의미에는 직접 들어가지 않지만 별도 provenance digest로 무결성을 검증한다.


# 7. Lead·Lyric·Atomization

## 7.1 Lead event

```ts
interface LeadNoteEvent {
  readonly kind: "note";
  readonly id: string;
  readonly sourceMeasureId: string;
  readonly onset: Fraction;
  readonly duration: Fraction;
  readonly pitch: SpelledPitch;
  readonly tieStart: boolean;
  readonly tieStop: boolean;
  readonly lyricTokenIds: readonly string[];
}

interface LeadRestEvent {
  readonly kind: "rest";
  readonly id: string;
  readonly sourceMeasureId: string;
  readonly onset: Fraction;
  readonly duration: Fraction;
}

type LeadEvent = LeadNoteEvent | LeadRestEvent;
```

## 7.2 Lyric token

```ts
interface LyricTokenBase {
  readonly id: string;
  readonly text: string;
  readonly syllabic: "single" | "begin" | "middle" | "end";
  readonly leadEventId: string;
  readonly verse: number;
  readonly extend: boolean;
}

type LyricEmphasisAnnotation =
  | {
      readonly emphasis: "none";
      readonly emphasisSource?: never;
    }
  | {
      readonly emphasis: "suggested";
      readonly emphasisSource:
        | "musicxml-accent"
        | "metric-heuristic";
    }
  | {
      readonly emphasis: "confirmed";
      readonly emphasisSource:
        | "manual"
        | "musicxml-accent"
        | "metric-heuristic";
    };

type LyricToken = LyricTokenBase & LyricEmphasisAnnotation;

type ProductionLyricEmphasis =
  | "none"
  | "confirmed"
  | "musicxml-accent-suggested";

declare function resolveProductionLyricEmphasis(
  token: LyricToken,
): ProductionLyricEmphasis;
```

`resolveProductionLyricEmphasis()`는 production 편곡에서 lyric emphasis eligibility를 결정하는 유일한 권위다.

정본 mapping:

```text
emphasis = none
→ none

emphasis = confirmed
→ confirmed
  // emphasisSource는 provenance이며 production 동작을 더 세분하지 않음

emphasis = suggested + musicxml-accent
→ musicxml-accent-suggested

emphasis = suggested + metric-heuristic
→ none
```

Core에서 Grammar가 `LYRIC_EMPHASIS`를 사용할 수 있는 경우:

- `ProductionLyricEmphasis = confirmed`
- `ProductionLyricEmphasis = musicxml-accent-suggested`

`metric-heuristic`만으로 생성된 suggested emphasis는 production Grammar의 split·attack 근거가 아니다. 일반 자연어 의미 분석은 하지 않는다.

불변식:

- `emphasis=none`이면 `emphasisSource`를 저장하지 않는다.
- `emphasis=suggested`이면 `emphasisSource`가 필수이며 `musicxml-accent | metric-heuristic`만 허용한다.
- `emphasis=confirmed`이면 `emphasisSource`가 필수다. 수동 확인은 `manual`, imported accent를 그대로 확인한 경우에는 원 출처를 보존할 수 있다.
- production semantic projection은 raw provenance를 직접 해시하지 않고 `resolveProductionLyricEmphasis()` 결과를 해시한다.
- resolver 규칙을 바꾸면 `hm-musical-source-v1` projection schema를 새 버전으로 올리고 migration을 명시한다.

Performance occurrence의 lyric 선택:

- `SectionOccurrence.lyricVerseIndex`가 해당 section occurrence에 포함된 모든 performance measure에서 사용할 verse의 유일한 권위다.
- canonical `TimelineAtom.lyricTokenIds`는 이 verse로 이미 해석된 token만 포함한다.
- 같은 source measure가 반복돼도 occurrence별 verse가 다르면 atomization semantic projection이 달라진다.
- 선택된 verse에 해당하는 token이 없거나 한 Lead event에 상호 모순되는 syllabic alignment가 있으면 `LYRIC_POLICY_VIOLATION` blocking이다.
- `lyricVerseIndex`, 선택 token의 syllabic·extend·`ProductionLyricEmphasis`는 `musicalSourceDigest`와 `SourceLeadAtomization.digest`에 포함한다.
- raw `emphasisSource` provenance가 달라도 `ProductionLyricEmphasis`가 같으면 generation semantic digest는 같을 수 있다.
- `suggested + musicxml-accent`와 `suggested + metric-heuristic`은 `ProductionLyricEmphasis`가 다르므로 musical source·atomization·Intent input digest가 모두 달라야 한다.
- 가사 문자열 자체의 교정은 편곡 음높이·리듬을 바꾸지 않으면 기존 Plan을 stale로 만들지 않지만 PracticeShare payload에는 최신 text를 사용한다.

## 7.3 Canonical Source Lead Atomization

Canonical atom은 Source·Performance·EffectiveChordTimeline만으로 계산한다.

분할 경계:

- source Lead event start/end
- effective chord span onset/end
- performance measure boundary
- confirmed phrase boundary
- confirmed section boundary

다음은 canonical atom 경계가 아니다.

- Grammar가 선택한 split point
- Activity attack/release
- suspension resolution
- AnchorLock·PitchLock boundary

이 후자들은 각 stage가 canonical atom을 exact `MusicalPosition`에서 다시 나눈 **ID 없는 stage-local sub-atom**으로만 처리한다.

```ts
interface TimelineAtom {
  readonly id: string;
  readonly sourceEventId: string;
  readonly range: MusicalRange;
  readonly pitch: SpelledPitch | null;
  readonly tiedFromPrevious: boolean;
  readonly tiedToNext: boolean;
  readonly lyricTokenIds: readonly string[];
}

interface SourceLeadAtomization {
  readonly atomizerVersion: string;
  readonly musicalSourceDigest: SemanticDigest;
  readonly effectiveChordTimelineDigest: SemanticDigest;
  readonly atoms: readonly TimelineAtom[];
  readonly digest: SemanticDigest;
}

type SourceLeadAtomizationState =
  | { readonly status: "unresolved" }
  | {
      readonly status: "resolved";
      readonly atomization: SourceLeadAtomization;
      readonly diagnostics: readonly Diagnostic[];
    }
  | {
      readonly status: "stale";
      readonly previousAtomization: SourceLeadAtomization;
      readonly diagnostics: readonly Diagnostic[];
    }
  | {
      readonly status: "blocked";
      readonly previousAtomization?: SourceLeadAtomization;
      readonly diagnostics: readonly Diagnostic[];
    };

interface StageLocalLeadSubAtom {
  readonly sourceAtomId: string;
  readonly range: MusicalRange;
  readonly pitch: SpelledPitch | null;
  readonly lyricTokenIds: readonly string[];
}

interface LeadAtomReference {
  readonly sourceLeadAtomizationDigest: SemanticDigest;
  readonly leadAtomId: string;
}

interface SourceLeadAtomizationLookup {
  readonly atomizationDigest: SemanticDigest;
  readonly atomById: Readonly<Record<string, TimelineAtom>>;
}
```

정책:

- 긴 Lead 음 중간에 effective chord가 바뀌면 같은 pitch로 canonical atom을 분할하고 tie.
- 가사는 occurrence verse에 맞는 첫 sounding atom만 소유하고 뒤 atom은 extender.
- source event로 역추적 가능.
- generated sustain은 stage-local event boundary에서 tie split.
- 새 attack은 Activity Plan이 명시할 때만 생성.
- `TimelineAtom.id`는 같은 semantic source/chord/phrase/section/verse 상태가 동일하면 source revision ordinal과 무관하게 동일하다.
- `SourceLeadAtomization.atomizerVersion`은 실행 시 `AlgorithmVersionRegistry.sourceLeadAtomizerVersion`과 exact equal해야 한다.
- atomization digest의 projection schema는 `hm-source-lead-atomization-v1`이다.
- 포함: `atomizerVersion`, `musicalSourceDigest`, `effectiveChordTimelineDigest`, performance order의 atom payload(`sourceEvent` canonical ordinal, canonical range, pitch, tie flags, lyric token canonical ordinals와 선택 token의 syllabic·extend·ProductionLyricEmphasis).
- 제외: `TimelineAtom.id`, 표시 가사 문자열, Source entity ID 문자열, diagnostics, UI 상태.
- atomization digest는 위 projection을 Section 4.6 codec으로 해시한다.
- source/effective chord/phrase/section/verse 변경은 atomization을 stale로 만든다.
- Grammar·Activity·Anchor·Lock 변경은 canonical atomization을 stale로 만들지 않는다.
- stale/blocked state는 마지막으로 성공한 atomization 전체를 보존해 Lock·revision remap과 사용자 복구에 사용한다.
- 모든 `LeadAtomReference`는 `HarmonyProject.sourceLeadAtomizationState.status="resolved"`의 digest exact match와 `atomById` 존재를 검증한다.
- atomization은 `HarmonyProject`가 소유하는 persisted canonical artifact이며 RenderDocument는 이를 복사·참조하는 adapter 결과다.
- 불일치는 `SOURCE_LEAD_ATOMIZATION_STALE` 또는 `ANCHOR_LOCK_INVALID` blocking이다.


# 8. Performer–Track–Role 권한

## 8.1 Performer

```ts
interface PitchRange {
  readonly low: SpelledPitch;
  readonly high: SpelledPitch;
}

interface PerformerProfile {
  readonly id: string;
  readonly displayName: string;
  readonly hardRange: PitchRange;
  readonly comfortableRange: PitchRange;
  readonly preferredTessitura?: PitchRange;
}
```

정본 검증:

```text
preferredTessitura 없음:
hardLow <= comfortableLow <= comfortableHigh <= hardHigh

preferredTessitura 있음:
hardLow
<= comfortableLow
<= preferredLow
<= preferredHigh
<= comfortableHigh
<= hardHigh
```

- preferredTessitura는 comfortableRange 안의 더 좁은 선호 구간이다.
- 위 순서를 위반하면 `PERFORMER_RANGE_INVALID` blocking.
- preferredTessitura의 존재 여부와 경계값은 Intent 입력의 semantic digest에 포함한다.

## 8.2 TrackPlan union

```ts
interface SourceLeadTrackPlan {
  readonly kind: "source-lead";
  readonly id: "track:source-lead";
  readonly displayLabel: string;
  readonly canonicalOrdinal: 0;
  readonly enabled: true;
}

type VocalPlacementRole = "upper" | "lower";

interface GeneratedHarmonyTrackPlan {
  readonly kind: "generated-harmony";
  readonly id: string;
  readonly displayLabel: string;
  readonly canonicalOrdinal: GeneratedTrackOrdinal;
  readonly enabled: boolean;
}

interface TrackRoleSegment {
  readonly id: string;
  readonly phraseId: string;
  readonly trackPlanId: string;
  readonly placementRole: VocalPlacementRole;
}

type VocalTrackPlan = SourceLeadTrackPlan | GeneratedHarmonyTrackPlan;
```

정본:

- Source Lead Track은 정확히 하나.
- Source Lead는 role segment를 가지지 않음.
- Generated TrackPlan은 파트 정체성·표시·canonical order만 보존.
- 실제 upper/lower 역할은 preset별 `PhraseArrangementIntent.trackRoles`가 정본.
- 같은 phrase에서 동일 track의 role segment 중복 금지.
- active track에는 정확히 하나의 role segment가 필요.
- 역할 변경은 phrase 또는 section boundary에서만 발생.
- Core에서 duplicate upper 또는 duplicate lower는 Grammar의 명시적 rule 없이는 금지.
- 서로 다른 preset의 role segment는 공유하지 않음.
- generated canonicalOrdinal은 Section 4.3의 고유·연속 불변식을 따름.

## 8.3 Behavior

```ts
type VocalBehavior =
  | "independent-harmony"
  | "unison-double"
  | "octave-double"
  | "sustained-pad";
```

Behavior는 TrackPlan의 영구 역할이 아니다. Activity Plan의 `VoiceActivityDirective`가 구간별로 결정한다.

## 8.4 Performer assignment

```ts
interface PerformerTrackAssignment {
  readonly trackPlanId: string;
  readonly performerId: string;
}
```

불변식:

- 참조 TrackPlan 존재
- 참조 Performer 존재
- Source Lead와 enabled generated track은 performer 정확히 1명
- disabled generated track은 assignment가 없어도 됨
- 동일 performer가 겹치는 시간에 두 track을 부르지 않음
- Source Lead에는 항상 performer assignment가 필요

## 8.5 ArrangementMode와 Settings

```ts
type ArrangementPresetId = "simple" | "standard" | "full";

type ArrangementMode =
  | {
      readonly profileId: "worship-band-v1";
      readonly harmonicContext: "band-supported";
    }
  | {
      readonly profileId: "standalone-vocal-reserved";
      readonly harmonicContext: "standalone-vocal";
    };

type CoreArrangementMode = Extract<
  ArrangementMode,
  { readonly profileId: "worship-band-v1" }
>;

interface UserArrangementCaps {
  readonly maxHarmonyTracks: 0 | 1 | 2;
  readonly allowOctaveDouble: boolean;
}

interface ArrangementSettings {
  readonly mode: CoreArrangementMode;
  readonly requestedPresetIds: readonly ArrangementPresetId[];
  readonly userCaps: UserArrangementCaps;
}
```

- Core runtime schema는 `mode.profileId="worship-band-v1"`만 허용한다.
- `worship-band-v1 + standalone-vocal` 같은 불가능 조합은 타입으로 표현할 수 없다.
- chord gap policy는 ArrangementSettings가 아니라 `ChordResolutionPolicy`의 권위다.
- section suggestion 사용 여부는 import UI의 비영속 상태이며 generation setting이 아니다.

`requestedPresetIds` canonical order:

```text
simple → standard → full
```

중복·빈 배열 금지.

## 8.6 Preset difficulty와 Effective config

```ts
interface PresetDifficultyProfile {
  readonly presetId: ArrangementPresetId;
  readonly maxActiveVoiceCount: 1 | 2 | 3;
  readonly maxHarmonyAttackRatioBp: ExtendedBasisPoints;
  readonly preferredMaxLeapSemitones: number;
  readonly hardMaxLeapSemitones: number;
  readonly allowSuspension: boolean;
  readonly allowColorTones: boolean;
  readonly allowOctaveDouble: boolean;
  readonly rhythmicComplexity: 0 | 1 | 2;
  readonly maxRoleChangesPerSection: 0 | 1 | 2;
  readonly maxSustainPrimaryPulses: number;
}

interface PresetProfileRegistry {
  readonly presetProfileVersion: string;
  readonly profiles: Readonly<
    Record<ArrangementPresetId, PresetDifficultyProfile>
  >;
  readonly presetProfileDigest: SemanticDigest;
}

interface EffectiveArrangementConfig {
  readonly mode: CoreArrangementMode;
  readonly presetId: ArrangementPresetId;
  readonly presetProfileVersion: string;
  readonly presetProfileDigest: SemanticDigest;
  readonly maxHarmonyTracks: 0 | 1 | 2;
  readonly maxActiveVoiceCount: 1 | 2 | 3;
  readonly allowOctaveDouble: boolean;
  readonly allowSuspension: boolean;
  readonly allowColorTones: boolean;
  readonly maxHarmonyAttackRatioBp: ExtendedBasisPoints;
  readonly preferredMaxLeapSemitones: number;
  readonly hardMaxLeapSemitones: number;
  readonly rhythmicComplexity: 0 | 1 | 2;
  readonly maxRoleChangesPerSection: 0 | 1 | 2;
  readonly maxSustainPrimaryPulses: number;
  readonly digest: SemanticDigest;
}
```

초기 Registry 값:

| preset | max active voices | attack cap | preferred leap | hard leap | suspension | color | octave | rhythm | role changes/section | sustain pulses |
|---|---:|---:|---:|---:|---|---|---|---:|---:|---:|
| simple | 2 | 3500 | 4 | 7 | 아니오 | 아니오 | 아니오 | 0 | 0 | 2 |
| standard | 3 | 6000 | 5 | 9 | 예 | 예 | 아니오 | 1 | 1 | 4 |
| full | 3 | 9000 | 7 | 12 | 예 | 예 | 예 | 2 | 2 | 8 |

표의 숫자는 `PresetProfileRegistry`의 semantic payload다. 값이 바뀌면 `presetProfileVersion`과 `presetProfileDigest`가 반드시 바뀐다.
`PresetProfileRegistry.presetProfileVersion`은 실행 시 `AlgorithmVersionRegistry.presetProfileVersion`과 exact equal해야 하며 불일치는 `PRESET_PROFILE_VERSION_MISMATCH` blocking이다.

Registry digest 정본:

```text
projectionSchema = hm-preset-profile-registry-v1
포함 = presetProfileVersion + simple/standard/full canonical order의 모든 difficulty field
제외 = presetProfileDigest 자체 + 표시 문구 + calibration report
```

`PresetProfileRegistry.presetProfileVersion`은 `AlgorithmVersionRegistry.presetProfileVersion`과 exact equal해야 한다. 불일치는 `PRESET_PROFILE_VERSION_MISMATCH` blocking이다.

Effective config 정본:

```text
effective max harmony tracks
= min(user maxHarmonyTracks, assigned enabled harmony tracks, preset maxActiveVoiceCount - 1)

effective allow octave
= user allowOctaveDouble AND preset allowOctaveDouble
```

그 밖의 difficulty field는 preset profile을 그대로 사용한다. `EffectiveArrangementConfig.digest`의 projection schema는 `hm-effective-arrangement-config-v1`이며 mode·preset ID·registry version/digest·user caps·assigned enabled track count·모든 resolved difficulty field를 해시한다. `digest` 자체와 표시 metadata는 제외한다.

동일 preset ID라도 profile digest가 다르면 같은 config가 아니다. 모든 Plan·Candidate provenance는 이 digest를 보존한다.


# 9. Project Variant·Plan 생명주기·Stage Lock

## 9.1 Project는 preset별 variant·preserved artifact·single chord/atom authority를 가진다

```ts
type ActiveArrangementRef =
  | { readonly kind: "candidate"; readonly candidateId: string }
  | { readonly kind: "edited-snapshot"; readonly snapshotId: string };

interface VariantStaleness {
  readonly staleFrom: "intent" | "activity" | "anchor" | "generation";
  readonly staleDiagnosticIds: readonly string[];
  readonly previousArtifactDigests: readonly SemanticDigest[];
}

interface VariantBlockedAttempt {
  readonly stage: "intent" | "activity" | "anchor" | "generation";
  readonly inputDigest: SemanticDigest;
  readonly diagnostics: readonly Diagnostic[];
}

interface ArrangementVariantBase {
  readonly presetId: ArrangementPresetId;
  readonly diagnostics: readonly Diagnostic[];
  readonly lastBlockedAttempt?: VariantBlockedAttempt;
}

type VariantStalenessAt<
  TStage extends VariantStaleness["staleFrom"],
> = Omit<VariantStaleness, "staleFrom"> & {
  readonly staleFrom: TStage;
};

type ArrangementVariant =
  | (ArrangementVariantBase & {
      readonly lifecycle: "empty";
      readonly staleness?: never;
    })
  | (ArrangementVariantBase & {
      readonly lifecycle: "intent-ready";
      readonly intentPlan: ArrangementIntentPlan;
      readonly staleness?: VariantStalenessAt<"intent">;
    })
  | (ArrangementVariantBase & {
      readonly lifecycle: "activity-ready";
      readonly intentPlan: ArrangementIntentPlan;
      readonly activityPlan: ArrangementActivityPlan;
      readonly staleness?: VariantStalenessAt<"intent" | "activity">;
    })
  | (ArrangementVariantBase & {
      readonly lifecycle: "anchor-ready";
      readonly intentPlan: ArrangementIntentPlan;
      readonly activityPlan: ArrangementActivityPlan;
      readonly anchorPlan: ArrangementAnchorPlan;
      readonly staleness?: VariantStalenessAt<
        "intent" | "activity" | "anchor"
      >;
    })
  | (ArrangementVariantBase & {
      readonly lifecycle: "generation-attempted";
      readonly intentPlan: ArrangementIntentPlan;
      readonly activityPlan: ArrangementActivityPlan;
      readonly anchorPlan: ArrangementAnchorPlan;
      readonly generationResult: ArrangementGenerationResult;
      readonly outputEdits: readonly ArrangementOutputEdit[];
      readonly editedSnapshots: readonly EditedArrangementSnapshot[];
      readonly activeArrangement?: ActiveArrangementRef;
      readonly staleness?: VariantStaleness;
    });

interface VariantStageLocks {
  readonly intent: readonly IntentLock[];
  readonly activity: readonly ActivityLock[];
  readonly anchor: readonly AnchorLock[];
  readonly solver: readonly SolverLock[];
}

interface HarmonyProject {
  readonly schemaVersion: 9;
  readonly source: SongSourceDocument;
  readonly chordTimelineState: EffectiveChordTimelineState;
  readonly sourceLeadAtomizationState: SourceLeadAtomizationState;
  readonly presetProfiles: PresetProfileRegistry;
  readonly performers: readonly PerformerProfile[];
  readonly trackPlans: readonly VocalTrackPlan[];
  readonly assignments: readonly PerformerTrackAssignment[];
  readonly settings: ArrangementSettings;
  readonly locksByPreset: Readonly<
    Partial<Record<ArrangementPresetId, VariantStageLocks>>
  >;
  readonly variants: Readonly<
    Partial<Record<ArrangementPresetId, ArrangementVariant>>
  >;
  readonly selectedPresetId?: ArrangementPresetId;
}
```

Variant 불변식:

- lifecycle은 프로젝트에 보존된 **가장 높은 realized stage**를 뜻한다.
- `staleness`가 없으면 lifecycle이 보유한 모든 artifact가 fresh다.
- `staleness.staleFrom` 이전 단계 artifact는 fresh하며, 해당 단계와 downstream artifact는 역사적 보존본이지만 실행·재생·편집·공유에 사용할 수 없다.
- stale artifact를 타입에서 삭제하지 않는다. Plan·OutputEdit·EditedSnapshot은 provenance migration과 사용자 복구를 위해 보존한다.
- upstream 변경 후 새 stage attempt가 blocked되어도 이전 artifact는 보존하고 `staleness`와 새 diagnostics를 갱신한다.
- `empty` lifecycle에는 보존할 stage artifact가 없으므로 `staleness`를 둘 수 없다.
- `intent-ready`는 `staleFrom="intent"`만 허용한다.
- `activity-ready`는 `staleFrom="intent" | "activity"`만 허용한다.
- `anchor-ready`는 `staleFrom="intent" | "activity" | "anchor"`만 허용한다.
- `generation-attempted`는 네 stale stage를 모두 표현할 수 있다.
- lifecycle보다 뒤의 stage를 `staleFrom`으로 지정하면 `GENERATION_RESULT_STATE_INVALID` blocking이다.
- `activeArrangement.kind="candidate"`이면 generationResult candidate를 참조한다.
- `activeArrangement.kind="edited-snapshot"`이면 editedSnapshots를 참조한다.
- blocked generation result이면 새 candidate·snapshot·activeArrangement를 만들지 않으며 이전 보존본은 stale 상태로 남고 `lastBlockedAttempt`에 실패 입력 digest와 diagnostics를 기록한다.
- 최초 stage attempt가 blocked이면 lifecycle은 마지막 성공 stage(없으면 empty)를 유지하고 `lastBlockedAttempt`만 추가한다.
- complete/partial generation result만 `generationResult`를 교체한다.
- complete·partial result이면 candidate 1개 이상.
- `staleness`가 있는 variant는 activeArrangement를 실행 대상으로 해석하지 않는다.
- `staleDiagnosticIds`는 같은 variant의 `diagnostics`에 존재하는 ID만 참조한다.
- `previousArtifactDigests`는 보존된 Intent/Activity/Anchor/Generation/Snapshot artifact digest 중 실제 존재하는 값만 canonical stage order로 기록한다.
- stale stage 재실행이 성공하면 해당 stage와 downstream artifact를 새 digest로 교체하고, 보존된 OutputEdit·Snapshot은 base candidate remap 성공 여부를 검사한다.
- 필요한 모든 stage input digest가 현재 입력과 exact equal하고 stale stage부터의 재실행이 성공했을 때만 `staleness`를 제거한다.
- edit remap이 불가능하면 기존 edit/snapshot을 삭제하지 않고 `EDIT_BASE_CANDIDATE_STALE` 상태로 보존한다.
- stale stage 재실행 후 `activeArrangement`는 새 generation result의 candidate 또는 새 base에 대해 fresh하게 materialize된 snapshot만 참조할 수 있다.
- 이전 active artifact를 exact remap할 수 없으면 artifact·edit 이력은 보존하되 `activeArrangement`를 비우고 사용자가 새 대상을 선택하게 한다.
- EffectiveChordTimelineState와 SourceLeadAtomizationState가 둘 다 resolved가 아니면 모든 variant planning/generation을 차단한다.

## 9.2 Stage 1 — Section / Phrase Intent Plan

```ts
interface GrammarCandidateTrace {
  readonly id: string;
  readonly phraseId: string;
  readonly presetId: ArrangementPresetId;
  readonly textureId: TexturePatternId;
  readonly eligible: boolean;
  readonly score: CostUnit;
  readonly reasonCodes: readonly string[];
}

interface GrammarPlanningTraceRepository {
  readonly grammarVersion: string;
  readonly candidatesByPhraseId: Readonly<
    Record<string, readonly GrammarCandidateTrace[]>
  >;
}

interface SectionArrangementIntent {
  readonly id: string;
  readonly sectionOccurrenceId: string;
  readonly presetId: ArrangementPresetId;
  readonly intensityTarget: SectionIntensityTarget;
  readonly grammarRuleIds: readonly string[];
}

interface TextureSplitDirective {
  readonly position: MusicalPosition;
  readonly reasonCode:
    | "LATE_LONG_NOTE"
    | "LATE_CHORD_CHANGE"
    | "CONFIRMED_LYRIC_EMPHASIS"
    | "PHRASE_MIDPOINT";
}

interface PhraseArrangementIntent {
  readonly id: string;
  readonly phraseId: string;
  readonly presetId: ArrangementPresetId;
  readonly sectionIntentId: string;
  readonly textureId: TexturePatternId;
  readonly trackRoles: readonly TrackRoleSegment[];
  readonly lyricPolicy: LyricPolicy;
  readonly cadencePolicy: CadencePolicy;
  readonly splitDirective?: TextureSplitDirective;
  readonly grammarRuleIds: readonly string[];
}

interface ArrangementIntentPlan {
  readonly stage: "intent";
  readonly presetId: ArrangementPresetId;
  readonly intentInputDigest: SemanticDigest;
  readonly effectiveChordTimelineDigest: SemanticDigest;
  readonly sourceLeadAtomizationDigest: SemanticDigest;
  readonly effectiveConfigDigest: SemanticDigest;
  readonly presetProfileVersion: string;
  readonly presetProfileDigest: SemanticDigest;
  readonly grammarId: "worship-arrangement-grammar-v1";
  readonly grammarVersion: string;
  readonly plannerVersion: string;
  readonly grammarConfigDigest: SemanticDigest;
  readonly plannerConfigDigest: SemanticDigest;
  readonly diagnosticRegistryVersion: string;
  readonly diagnosticRegistryDigest: SemanticDigest;
  readonly sectionIntents: readonly SectionArrangementIntent[];
  readonly phraseIntents: readonly PhraseArrangementIntent[];
  readonly grammarTrace?: GrammarPlanningTraceRepository;
  readonly intentPlanDigest: SemanticDigest;
}
```

Intent Plan에는 아직 Activity span·Attack event·Anchor가 없다.

Intensity 정본:

- `SectionArrangementIntent.intensityTarget`이 section intensity의 유일한 canonical authority다.
- Phrase Intent는 `sectionIntentId`로 자신이 따르는 section target을 참조한다.
- Phrase에 같은 intensity target의 사본을 저장하지 않는다.
- `splitDirective`는 Phrase Intent의 semantic 결과이며 `intentPlanDigest`에 포함된다.
- `splitDirective`는 persistent atom을 변경하지 않는 stage-local Activity boundary 요청이다.
- `splitDirective.position`은 phrase range 안에 있어야 하고 Grammar v1의 deterministic rule로만 생성한다. 사용자의 exact boundary 고정은 ActivityLock으로 표현한다.
- section intent는 Grammar의 `planSection()` 결과로만 생성한다.
- phrase intent는 확정 section intent를 입력받은 `planPhrase()` 결과로만 생성한다.
- Activity Planner는 section target을 전체 section constraint로 사용하고 phrase별 texture·role·lyric/cadence policy로 구체화한다.

Trace 정본:

- `grammarRuleIds`와 `grammarTrace`는 설명·디버그용 non-semantic artifact다.
- 이 값들이 없어도 Intent Plan의 음악적 의미는 완전해야 한다.
- `grammarRuleIds`, `grammarTrace`, trace ID는 `intentPlanDigest`에서 제외한다.
- Grammar의 음악적 결과인 section/phrase intent가 digest 권위이며 rule ID 문자열은 설명 provenance일 뿐이다.
- 저장할 경우 trace ID는 Section 4.2의 deterministic rule을 따른다.

Role 정본:

- `PhraseArrangementIntent.trackRoles`가 해당 preset·phrase의 유일한 역할 권위다.
- active harmony track 수는 `trackRoles.length`.
- 같은 track의 placementRole이 인접 phrase에서 바뀌면 role change 1회로 계산.
- `maxRoleChangesPerSection`은 preset별 Intent Plan에 적용.
- TrackPlan은 이 값을 복제하지 않는다.

## 9.3 Stage 2 — Activity Plan

```ts
interface PhraseActivityPlan {
  readonly id: string;
  readonly phraseId: string;
  readonly intentId: string;
  readonly activitySpans: readonly VoiceActivitySpan[];
  readonly attackEvents: readonly VoiceAttackEvent[];
  readonly realizedMetrics: ActivityDensityMetrics;
}

interface ArrangementActivityPlan {
  readonly stage: "activity-realized";
  readonly presetId: ArrangementPresetId;
  readonly intentPlanDigest: SemanticDigest;
  readonly activityInputDigest: SemanticDigest;
  readonly activityPlannerVersion: string;
  readonly activityPlannerConfigDigest: SemanticDigest;
  readonly diagnosticRegistryVersion: string;
  readonly diagnosticRegistryDigest: SemanticDigest;
  readonly sourceLeadAtomizationDigest: SemanticDigest;
  readonly effectiveConfigDigest: SemanticDigest;
  readonly presetProfileDigest: SemanticDigest;
  readonly phraseActivityPlans: readonly PhraseActivityPlan[];
  readonly activityPlanDigest: SemanticDigest;
}
```

## 9.4 Stage 3 — Anchor Plan

```ts
interface PhraseAnchorPlan {
  readonly id: string;
  readonly phraseId: string;
  readonly activityPlanId: string;
  readonly anchorDirectives: readonly HarmonyAnchorDirective[];
  readonly nctPlans: readonly NonChordTonePlan[];
}

interface ArrangementAnchorPlan {
  readonly stage: "anchor-realized";
  readonly presetId: ArrangementPresetId;
  readonly activityPlanDigest: SemanticDigest;
  readonly anchorInputDigest: SemanticDigest;
  readonly anchorPlannerVersion: string;
  readonly anchorPlannerConfigDigest: SemanticDigest;
  readonly diagnosticRegistryVersion: string;
  readonly diagnosticRegistryDigest: SemanticDigest;
  readonly sourceLeadAtomizationDigest: SemanticDigest;
  readonly effectiveConfigDigest: SemanticDigest;
  readonly presetProfileDigest: SemanticDigest;
  readonly phraseAnchorPlans: readonly PhraseAnchorPlan[];
  readonly anchorPlanDigest: SemanticDigest;
}
```

빈 배열은 “미계산”을 뜻하지 않는다. Stage object의 부재가 미계산 상태를 뜻한다.

## 9.5 단계별 Lock union

```ts
interface LockBase {
  readonly id: string;
  readonly presetId: ArrangementPresetId;
}

interface TextureLock extends LockBase {
  readonly kind: "texture";
  readonly phraseId: string;
  readonly textureId: TexturePatternId;
}

interface PlacementRoleLock extends LockBase {
  readonly kind: "placement-role";
  readonly phraseId: string;
  readonly trackPlanId: string;
  readonly placementRole: VocalPlacementRole;
}

type IntentLock = TextureLock | PlacementRoleLock;

interface ExactActivityLock extends LockBase {
  readonly kind: "activity";
  readonly phraseId: string;
  readonly trackPlanId: string;
  readonly range: MusicalRange;
  readonly activity: VoiceActivityDirective;
}

type ActivityLock = ExactActivityLock;

type LockedAnchorEndpointSpec =
  | {
      readonly kind: "chord-tone";
      readonly position: MusicalPosition;
      readonly chordSpanId: string;
      readonly selectedTone: ChordToneSpec;
    }
  | {
      readonly kind: "lead-derived";
      readonly position: MusicalPosition;
      readonly leadAtom: LeadAtomReference;
      readonly relation: "unison" | "octave";
    };

interface LockedNonChordToneSpecBase {
  readonly kind: NonChordToneKind;
  readonly contextChordSpanId: string;
  readonly targetChordSpanId: string;
  readonly resolution: LockedAnchorEndpointSpec;
  readonly resolutionDeadline: MusicalPosition;
}

type LockedNonChordToneSpec =
  | (LockedNonChordToneSpecBase & {
      readonly kind: "passing" | "neighbor";
      readonly preparation: LockedAnchorEndpointSpec;
      readonly direction: "up" | "down";
    })
  | (LockedNonChordToneSpecBase & {
      readonly kind: "anticipation";
      readonly preparation: LockedAnchorEndpointSpec;
    })
  | (LockedNonChordToneSpecBase & {
      readonly kind: "suspension";
      readonly preparation: LockedAnchorEndpointSpec;
      readonly resolutionDirection: "down" | "up";
    });

type AnchorLock =
  | (LockBase & {
      readonly kind: "anchor-chord-tone";
      readonly phraseId: string;
      readonly trackPlanId: string;
      readonly position: MusicalPosition;
      readonly chordSpanId: string;
      readonly selectedTone: ChordToneSpec;
    })
  | (LockBase & {
      readonly kind: "anchor-lead-derived";
      readonly phraseId: string;
      readonly trackPlanId: string;
      readonly position: MusicalPosition;
      readonly leadAtom: LeadAtomReference;
      readonly relation: "unison" | "octave";
    })
  | (LockBase & {
      readonly kind: "anchor-planned-nct";
      readonly phraseId: string;
      readonly trackPlanId: string;
      readonly position: MusicalPosition;
      readonly nctSpec: LockedNonChordToneSpec;
    });

interface PitchLock extends LockBase {
  readonly kind: "pitch";
  readonly phraseId: string;
  readonly trackPlanId: string;
  readonly position: MusicalPosition;
  readonly pitch: SpelledPitch;
}

type SolverLock = PitchLock;
```

AnchorLock 정본:

- Lock 바깥의 phrase·track·position이 target의 유일한 권위다.
- Lock payload에는 directive ID·NCT plan ID를 저장하지 않는다.
- lead-derived endpoint는 `SourceLeadAtomization.digest`와 atom ID를 함께 저장한다.
- chord-tone·lead-derived lock은 payload로 새 directive를 완전히 재생성할 수 있어야 한다.
- planned-NCT lock은 preparation·resolution의 안정적인 semantic endpoint, NCT 종류, 방향, context/target chord span, deadline을 보존한다.
- 이전 Anchor Plan이 삭제돼도 planned-NCT lock만으로 동일 의미의 NCT plan과 endpoint directive를 재생성할 수 있어야 한다.
- Anchor Planner는 endpoint semantic equality로 기존 directive를 재사용하거나 deterministic ID로 새 directive를 만든다.
- Lock의 chord span·source atom·range 참조가 stale이면 `ANCHOR_LOCK_INVALID` blocking이며 가짜 directive를 만들지 않는다.

권한:

- Grammar는 `IntentLock[]`만 입력받음.
- Activity Planner는 확정 Intent Plan과 `ActivityLock[]`만 입력받음.
- Anchor Planner는 확정 Activity Plan과 `AnchorLock[]`만 입력받음.
- Solver는 확정 Anchor Plan과 `SolverLock[]`만 입력받음.
- 앞 단계는 자기보다 뒤 단계 Lock을 import하거나 읽지 않음.
- chord 값 변경은 Lock이 아니라 Source chord edit + EffectiveChordTimeline 재해결.
- ActivityLock이 Intent의 active track role에 없는 track을 non-rest로 만들면 Activity stage는 `STAGE_LOCK_SCOPE_INVALID`로 blocked.
- Intent에서 비활성인 track에 대해서는 `rest` ActivityLock만 허용한다.
- Intent가 활성화한 track 안에서는 Intent의 texture contract를 깨지 않는 세부 ActivityLock을 허용한다.
- AnchorLock과 PitchLock이 같은 phrase·track·position에서 서로 양립할 수 없는 의미를 요구하면 Generation은 `STAGE_LOCK_SCOPE_INVALID`로 blocked된다.
- PitchLock은 phrase scope를 반드시 보존한다.

## 9.6 StageInputDigests와 invalidation

```ts
interface StageInputDigests {
  readonly intentInputDigest: SemanticDigest;
  readonly activityInputDigest: SemanticDigest;
  readonly anchorInputDigest: SemanticDigest;
  readonly generationInputDigest: SemanticDigest;
}
```

포함 관계:

```text
intentInputDigest
- musicalSourceDigest
- EffectiveChordTimeline.digest
- SourceLeadAtomization.digest
- performer hard·comfortable·preferred range
- TrackPlan semantic projection
- performer-track mapping
- ArrangementMode·user caps·preset
- EffectiveArrangementConfig.digest
- PresetProfileRegistry.presetProfileDigest/version
- IntentLock
- planner·Grammar config/version

activityInputDigest
- intentPlanDigest
- SourceLeadAtomization.digest + atomizerVersion
- EffectiveArrangementConfig.digest
- PresetProfileRegistry.presetProfileDigest/version
- ActivityLock
- Activity Planner config/version

anchorInputDigest
- activityPlanDigest
- SourceLeadAtomization.digest
- EffectiveArrangementConfig.digest
- PresetProfileRegistry.presetProfileDigest/version
- 자기완결 semantic AnchorLock
- Anchor Planner config/version

generationInputDigest
- anchorPlanDigest
- EffectiveArrangementConfig.digest
- PresetProfileRegistry.presetProfileDigest/version
- SolverLock
- Solver·Validator·Metric config/version
```

무효화:

- musical source semantic projection·effective chord timeline·source atomization·performer·track·assignment·mode·IntentLock·effective config 변경 → Intent부터 stale.
- Intent Plan 변경·ActivityLock·Activity Planner config 변경 → Activity부터 stale.
- Activity Plan 변경·AnchorLock·Anchor Planner config 변경 → Anchor부터 stale.
- Anchor Plan 변경·SolverLock·Solver/Validator/Metric config 변경 → Generation stale.
- stale 전환은 기존 artifact를 삭제하지 않고 `VariantStaleness`만 추가·갱신한다.
- 표시 이름 변경은 stale 아님.
- AnchorLock 변경은 Anchor Plan을 다시 만들며 Generation에만 overlay하지 않음.

## 9.7 단계 실행 결과

Plan 단계는 실패 시 빈 Plan을 만들지 않는다.

```ts
type StageExecutionResult<T> =
  | {
      readonly status: "complete";
      readonly value: T;
      readonly diagnostics: readonly Diagnostic[];
    }
  | {
      readonly status: "blocked";
      readonly diagnostics: readonly Diagnostic[];
    };
```

- Planner: `StageExecutionResult<ArrangementIntentPlan>`
- Activity Planner: `StageExecutionResult<ArrangementActivityPlan>`
- Anchor Planner: `StageExecutionResult<ArrangementAnchorPlan>`
- blocked에서 가짜 빈 Plan을 만들지 않음.
- blocked attempt가 기존 non-empty variant를 지우지 않으며 `lastBlockedAttempt`, staleness, diagnostics만 갱신한다.


# 10. Texture Density·Intensity 계산 정본

## 10.1 Metric 타입

```ts
interface CountRateMetric {
  readonly numerator: number;
  readonly denominator: number;
  readonly valueBp: BasisPoints | null;
  readonly unavailableReason?: "NO_EVALUABLE_ITEMS";
}

interface ExtendedCountRateMetric {
  readonly numerator: number;
  readonly denominator: number;
  readonly valueBp: ExtendedBasisPoints | null;
  readonly unavailableReason?: "NO_EVALUABLE_ITEMS";
}

interface DurationRateMetric {
  readonly numerator: Fraction;
  readonly denominator: Fraction;
  readonly valueBp: BasisPoints | null;
  readonly unavailableReason?: "NO_EVALUABLE_ITEMS";
}

interface ActivityDensityMetrics {
  readonly participationCoverage: DurationRateMetric;
  readonly harmonyAttackRatio: ExtendedCountRateMetric;
  readonly harmonyOverLeadRestCoverage: DurationRateMetric;
  readonly maxSimultaneousHarmonyTracks: 0 | 1 | 2;
}

interface TextureDensityMetrics extends ActivityDensityMetrics {
  readonly harmonicDivergenceCoverage: DurationRateMetric;
  readonly exactlyTwoPitchCoverage: DurationRateMetric;
  readonly exactlyThreePitchCoverage: DurationRateMetric;
  readonly medianRegisterSpreadSemitones: number;
}

interface SectionIntensityTarget {
  readonly participationCoverageBp: BasisPoints;
  readonly harmonicDivergenceCoverageBp: BasisPoints;
  readonly exactlyTwoPitchCoverageBp: BasisPoints;
  readonly exactlyThreePitchCoverageBp: BasisPoints;
  readonly maxHarmonyAttackRatioBp: ExtendedBasisPoints;
  readonly registerSpreadRange: readonly [min: number, max: number];
  readonly maxActiveVoiceCount: 1 | 2 | 3;
}
```

RateMetric 정본:

- count numerator·denominator는 비음수 safe integer.
- duration numerator·denominator는 non-negative normalized Fraction.
- denominator > 0이면 `valueBp = roundHalfUp(numerator / denominator * 10000)`.
- denominator = 0이면 `valueBp=null`, `unavailableReason="NO_EVALUABLE_ITEMS"`.
- denominator = 0인 metric을 0% 또는 100%로 꾸미지 않는다.
- macro 집계에서는 denominator=0인 곡을 해당 metric에서 제외하고 포함·제외 곡 수를 함께 보고한다.
- micro 집계는 evaluable item의 count 또는 exact Fraction numerator·denominator를 합산한다.

## 10.2 단계별 계산 가능 지표

Activity Plan 단계:

- participation coverage
- harmony attack ratio
- harmony-over-lead-rest coverage
- max simultaneous harmony tracks

Pitch Solver 이후 Candidate:

- harmonic divergence
- exactly two/three distinct pitch coverage
- register spread

Activity 단계의 값만으로 현대적 화성 품질을 통과시켰다고 주장하지 않는다.

## 10.3 분모

- participation·harmonic divergence·two/three pitch coverage의 분모는 phrase의 **source lead note sounding duration**.
- Lead rest와 instrumental duration은 위 coverage 분모에서 제외.
- `harmonyOverLeadRestCoverage`의 분모는 같은 phrase 안의 **source lead rest duration**.
- Lead rest duration이 0이면 `harmonyOverLeadRestCoverage.valueBp=null`.
- melody-bearing duration이 0이면 기본 coverage 계산을 차단하고 `METRIC_NO_MELODY_DURATION`.
- attack ratio 분모는 Lead note attack 수이며, 분자는 모든 generated harmony track의 attack 수 합계.
- Lead attack 수가 0이면 attack ratio를 계산하지 않고 phrase generation 대상에서 제외.

## 10.4 Atomic interval 적분

1. Lead와 모든 generated event의 start/end 경계를 합침.
2. 정렬된 인접 경계 사이를 atomic interval로 생성.
3. 각 interval에서 sounding pitch·track·state 계산.
4. exact Fraction duration을 누적.
5. 마지막에 basis points 변환.

공식 정의:

- participation: generated track 1개 이상 sounding.
- harmonic divergence: Lead와 다른 pitch가 1개 이상 sounding.
- exactly two pitch: distinct vocal pitch 수가 정확히 2.
- exactly three pitch: distinct vocal pitch 수가 정확히 3.
- attack ratio: harmony attack event 총수 / Lead note attack 총수.
- register spread: distinct vocal pitch가 2개 이상인 interval에서 최고–최저 semitone.

## 10.5 Median

register spread는 duration-weighted lower median을 사용한다.

- atomic interval duration을 weight로 사용.
- 누적 weight가 전체의 절반 이상이 되는 첫 spread.
- 짝수 평균을 사용하지 않음.
- harmony가 없는 interval은 제외.

## 10.6 Lead-derived behavior

`unison-double`:

- participation 증가.
- harmonic divergence 증가 안 함.
- two/three pitch coverage 증가 안 함.
- 실제 attack이 있으면 attack ratio 증가.

`octave-double`:

- participation 증가.
- 실제 pitch가 다르므로 harmonic divergence 증가.
- distinct vocal pitch 수 계산에 포함.
- 독립 harmony와 별도 behavior 통계도 보고.


# 11. Worship Arrangement Grammar v1 경계

## 11.1 별도 권위 문서

이 문서는 Grammar의 domain interface만 정의한다.

실제 다음 내용은 별도 문서가 유일한 권위다.

```text
docs/WORSHIP_ARRANGEMENT_GRAMMAR_v1.md
```

별도 문서가 정의해야 하는 것:

- Section × Preset texture prior
- 4/4·6/8 PhraseFeatures
- Texture eligibility
- 6개 texture 알고리즘
- split·attack·sustain·release 위치
- assigned performer range를 고려한 upper/lower 배치
- role change 규칙
- repeated occurrence variation
- N.C. 처리
- fallback
- reason code
- canonical tie-break
- dev fixture와 acceptance

## 11.2 Grammar adapter

```ts
type TexturePatternId =
  | "UNISON"
  | "UNISON_TO_SPLIT"
  | "TWO_PART_PARALLEL"
  | "ACCENT_BLOCK"
  | "SUSTAINED_PAD"
  | "SUSPENSION_RELEASE";

interface PhraseFeatures {
  readonly phraseId: string;
  readonly sectionType: SectionType;
  readonly sectionVariant: SectionVariant;
  readonly meterFamily: "simple-quadruple" | "compound-duple";
  readonly primaryPulseCount: number;
  readonly leadAttackCount: number;
  readonly leadRangeSemitones: number;
  readonly productionLyricEmphasisCount: number;
  readonly lateLongNote: boolean;
  readonly lateChordChange: boolean;
  readonly commonToneSpanPrimaryPulses: number;
  readonly suspensionOpportunityCount: number;
  readonly noChordCoverageBp: BasisPoints;
  readonly repeatedSourcePhrase: boolean;
  readonly previousTextureIds: readonly TexturePatternId[];
}

interface AssignedHarmonyTrackContext {
  readonly trackPlanId: string;
  readonly trackOrdinal: GeneratedTrackOrdinal;
  readonly performerOrdinal: number;
  readonly hardRange: PitchRange;
  readonly comfortableRange: PitchRange;
  readonly preferredTessitura?: PitchRange;
  readonly previousPlacementRole?: VocalPlacementRole;
}

interface WorshipSectionGrammarInput {
  readonly mode: CoreArrangementMode;
  readonly presetId: ArrangementPresetId;
  readonly effectiveConfig: EffectiveArrangementConfig;
  readonly effectiveChordTimeline: EffectiveChordTimeline;
  readonly sectionOccurrence: SectionOccurrence;
  readonly phrases: readonly PhraseRegion[];
  readonly phraseFeatures: readonly PhraseFeatures[];
  readonly assignedTracks: readonly AssignedHarmonyTrackContext[];
}

type WorshipSectionGrammarResult =
  | {
      readonly status: "complete";
      readonly sectionIntent: SectionArrangementIntent;
      readonly diagnostics: readonly Diagnostic[];
    }
  | {
      readonly status: "blocked";
      readonly diagnostics: readonly Diagnostic[];
    };

interface WorshipPhraseGrammarInput {
  readonly mode: CoreArrangementMode;
  readonly presetId: ArrangementPresetId;
  readonly effectiveConfig: EffectiveArrangementConfig;
  readonly effectiveChordTimeline: EffectiveChordTimeline;
  readonly sourceLeadAtomization: SourceLeadAtomization;
  readonly sectionOccurrence: SectionOccurrence;
  readonly sectionIntent: SectionArrangementIntent;
  readonly phrase: PhraseRegion;
  readonly features: PhraseFeatures;
  readonly assignedTracks: readonly AssignedHarmonyTrackContext[];
  readonly intentLocks: readonly IntentLock[];
}

type WorshipPhraseGrammarResult =
  | {
      readonly status: "complete";
      readonly phraseIntent: PhraseArrangementIntent;
      readonly candidateTrace: readonly GrammarCandidateTrace[];
      readonly diagnostics: readonly Diagnostic[];
    }
  | {
      readonly status: "blocked";
      readonly candidateTrace: readonly GrammarCandidateTrace[];
      readonly diagnostics: readonly Diagnostic[];
    };

interface WorshipArrangementGrammar {
  readonly grammarId: "worship-arrangement-grammar-v1";
  readonly grammarVersion: string;
  readonly grammarConfigDigest: SemanticDigest;
  planSection(input: WorshipSectionGrammarInput): WorshipSectionGrammarResult;
  planPhrase(input: WorshipPhraseGrammarInput): WorshipPhraseGrammarResult;
}
```

불변식:

- Intent assembler는 모든 section에 대해 `planSection()`을 먼저 실행한다.
- Section result가 blocked이면 해당 preset의 Intent stage를 blocked 처리하며 가짜 section/phrase intent를 만들지 않는다.
- `planPhrase()`는 확정된 같은 section의 `SectionArrangementIntent`를 입력받는다.
- Grammar는 `IntentLock[]` 외의 Activity·Anchor·Solver Lock을 볼 수 없음.
- `WorshipArrangementGrammar.grammarVersion`과 `grammarConfigDigest`는 실행 시 `AlgorithmExecutionRegistry`의 값과 exact equal해야 하며 Intent Plan에 그대로 보존한다.
- Track role은 assigned performer hard·comfortable·preferred range와 이전 phrase role을 고려해 결정.
- hardRange 때문에 모든 texture·placement가 불가능하면 `status="blocked"`와 blocking diagnostic을 반환한다.
- blocked 결과에는 가짜 PhraseArrangementIntent가 없다.
- Solver가 나중에 upper/lower 역할을 임의 교체하지 않음.
- candidateTrace는 결과 설명용이며 Intent 의미의 참조 대상이 아니다.
- Grammar는 필요한 texture에서 optional `splitDirective.position`을 canonical `MusicalPosition`으로 반환할 수 있다.
- Activity Planner는 확정 `splitDirective`, canonical SourceLeadAtomization, texture algorithm을 사용해 attack·sustain·release를 ID 없는 stage-local sub-atom으로 실현한다.
- Grammar와 Activity Planner는 persistent TimelineAtom을 추가·삭제·재번호화하지 않는다.
- Intent Plan assembler는 한 section/phrase라도 blocked이면 빈 가짜 Plan을 만들지 않고 `StageExecutionResult<ArrangementIntentPlan>` blocked를 반환한다.

## 11.3 Grammar gate

Step 4 시작 조건:

```text
WORSHIP_ARRANGEMENT_GRAMMAR_V1_ACCEPTED
```

이 선언 전에는:

- 임의 prior 작성 금지
- Codex가 texture 선택 규칙 추측 금지
- main spec 안의 예시를 production weight로 사용 금지

---

# 12. Activity·Rhythm Domain

## 12.1 상태와 사건 분리

```ts
type VoiceActivityDirective =
  | { readonly state: "rest" }
  | {
      readonly state: "lead-derived";
      readonly behavior: "unison-double" | "octave-double";
    }
  | {
      readonly state: "independent-note";
      readonly behavior: "independent-harmony";
    }
  | {
      readonly state: "sustain";
      readonly behavior: "sustained-pad" | "independent-harmony";
    };

type VoiceActivityState = VoiceActivityDirective["state"];

interface VoiceActivitySpan {
  readonly id: string;
  readonly trackPlanId: string;
  readonly range: MusicalRange;
  readonly activity: VoiceActivityDirective;
}

interface VoiceAttackEvent {
  readonly id: string;
  readonly trackPlanId: string;
  readonly position: MusicalPosition;
  readonly kind: "attack" | "release" | "reentry";
}
```

- span은 양의 duration
- attack event는 0길이 사건
- release를 span으로 표현하지 않음
- span은 phrase range 밖으로 나가지 않음
- 같은 track span overlap 금지
- `rest`에는 behavior가 없음
- `lead-derived`는 unison 또는 octave double만 허용
- `independent-note`는 independent harmony만 허용
- `sustain`은 sustained pad 또는 독립 harmony sustain만 허용
- Activity Plan은 phrase intent의 trackRoles와 일치
- trackRoles에 없는 track은 해당 phrase에서 rest만 가능
- role은 ActivitySpan에 복제하지 않고 phrase intent에서 조회

## 12.2 Lyric policy

```ts
type LyricPolicy =
  | "same-lyrics"
  | "hold-current-vowel"
  | "no-new-lyric";

type CadencePolicy =
  | "open"
  | "closed"
  | "looping";
```

- `same-lyrics`: Lead attack과 동일 lyric token
- `hold-current-vowel`: 새 단어 생성 금지, extender만
- `no-new-lyric`: 무가사 sustain 또는 humming 표시

## 12.3 Activity lock

Activity lock은 exact range와 state를 강제한다.

- ActivityLock 대상 track이 Phrase Intent의 `trackRoles`에 없는데 non-rest를 요구하면 Activity stage blocked
- Intent가 허용한 track 안에서의 세부 Activity 차이는 lock 우선
- hard rule과 충돌하면 generation blocked
- Activity lock이 바뀌면 Activity·Anchor·Generation stale


---

# 13. Anchor·비화성음·N.C. 정본

## 13.1 NonChordTonePlan

```ts
type NonChordToneKind =
  | "passing"
  | "neighbor"
  | "anticipation"
  | "suspension";

interface NonChordTonePlanBase {
  readonly id: string;
  readonly trackPlanId: string;
  readonly position: MusicalPosition;
  readonly contextChordSpanId: string;
  readonly targetChordSpanId: string;
  readonly resolutionDirectiveId: string;
  readonly resolutionDeadline: MusicalPosition;
}

type NonChordTonePlan =
  | (NonChordTonePlanBase & {
      readonly kind: "passing";
      readonly preparationDirectiveId: string;
      readonly direction: "up" | "down";
    })
  | (NonChordTonePlanBase & {
      readonly kind: "neighbor";
      readonly preparationDirectiveId: string;
      readonly direction: "up" | "down";
    })
  | (NonChordTonePlanBase & {
      readonly kind: "anticipation";
      readonly preparationDirectiveId: string;
    })
  | (NonChordTonePlanBase & {
      readonly kind: "suspension";
      readonly preparationDirectiveId: string;
      readonly resolutionDirection: "down" | "up";
    });
```

## 13.2 Anchor directive union

```ts
type HarmonyAnchorDirective =
  | {
      readonly kind: "chord-tone";
      readonly id: string;
      readonly trackPlanId: string;
      readonly position: MusicalPosition;
      readonly chordSpanId: string;
      readonly selectedTone: ChordToneSpec;
    }
  | {
      readonly kind: "planned-nct";
      readonly id: string;
      readonly trackPlanId: string;
      readonly position: MusicalPosition;
      readonly contextChordSpanId: string;
      readonly nctPlanId: string;
    }
  | {
      readonly kind: "lead-derived";
      readonly id: string;
      readonly trackPlanId: string;
      readonly position: MusicalPosition;
      readonly leadAtom: LeadAtomReference;
      readonly relation: "unison" | "octave";
    };
```

`role`은 `selectedTone.role`에서 파생한다. 이중 저장하지 않는다.

## 13.3 Realized anchor

```ts
interface RealizedHarmonyAnchor {
  readonly directiveId: string;
  readonly trackPlanId: string;
  readonly position: MusicalPosition;
  readonly pitch: SpelledPitch;
}
```

Candidate가 실제 pitch를 저장한다. Anchor Plan의 directive는 semantic 선택을 저장한다.

## 13.4 NCT·Lead atom 참조 불변식

- 모든 `lead-derived` directive와 Lock endpoint의 `LeadAtomReference.sourceLeadAtomizationDigest`는 같은 Anchor Plan이 기록한 `sourceLeadAtomizationDigest`와 exact equal해야 한다.
- `leadAtomId`는 그 canonical atomization의 `atomById`에 존재해야 한다.
- stage-local sub-atom에는 persistent ID를 부여하지 않으며 AnchorLock·HarmonyAnchorDirective가 참조할 수 없다.
- `preparationDirectiveId`와 `resolutionDirectiveId`는 같은 track의 directive를 참조한다.
- preparation·resolution directive는 planned NCT가 아닌 chord-tone 또는 lead-derived directive다.
- NCT plan과 planned-nct directive는 1:1이며 서로의 ID를 candidate digest의 순환 입력으로 사용하지 않는다.
- planned-nct directive의 contextChordSpanId는 NCT plan과 동일하다.
- `contextChordSpanId`는 NCT가 실제로 울리는 effective chord span을 참조한다.
- `targetChordSpanId`는 resolution이 소속되는 effective chord span을 참조한다.
- anticipation은 preparation directive가 context chord 안에 있고 resolution directive가 target chord 안에 있어야 한다.
- suspension은 preparation directive가 context chord 직전의 consonant endpoint이며 target chord에서 resolution해야 한다.
- preparation position < NCT position < resolution position.
- resolution position <= resolution deadline.
- NCT Plan에는 실제 octave pitch를 미리 저장하지 않는다.
- 실제 pitch는 Phrase Solver가 preparation·resolution anchor의 realized pitch와 diatonic motion을 이용해 결정한다.
- realized NCT pitch와 resolution은 Candidate의 `realizedAnchors` 및 non-semantic trace에서 보존한다.

## 13.5 Source lead와 generated harmony NCT

- confirmed Source Lead NCT는 입력 오류로 막지 않음
- Source Lead가 chord tone이 아니면 분류 시도
- 분류 불가 Source tone은 warning
- generated harmony는 명시적 NonChordTonePlan 없이는 비화성음 금지

## 13.6 Passing

- weak position
- preparation에서 diatonic step으로 진입
- 같은 방향 step으로 resolution directive에 도달
- duration ≤ primary pulse 절반
- preparation·resolution은 chord-tone 또는 lead-derived anchor

## 13.7 Neighbor

- weak position
- preparation pitch에서 step으로 이탈
- resolution directive의 realized pitch는 preparation pitch와 동일
- duration ≤ primary pulse 절반

## 13.8 Anticipation

- chord change 전 weak position
- targetChordSpanId는 다음 effective chord span
- NCT realized pitch는 resolution directive의 realized pitch와 동일
- chord change 후 같은 pitch가 유지 또는 재공격
- duration ≤ primary pulse 절반

## 13.9 Suspension

- preparation: 이전 chord의 consonant realized pitch
- suspension: context chord에서 planned NCT
- NCT realized pitch는 preparation pitch와 동일
- resolution: 아래 방향 diatonic step 기본
- Grammar가 명시적으로 허용한 경우만 위 방향
- resolution deadline 안에 chord-tone으로 해결
- phrase boundary를 unresolved 상태로 넘지 않음

## 13.10 Explicit N.C. generation policy

명시적 `no-chord` span에서는:

- Source Lead 유지
- generated harmony 기본 rest
- Grammar가 명시한 UNISON이면 lead-derived unison 허용
- Grammar와 preset이 명시한 octave-double이면 lead-derived octave 허용
- independent-harmony 금지
- sustained-pad 금지
- suspension·passing·neighbor·anticipation 생성 금지
- 직전 chord를 암묵적으로 carry하지 않음
- N.C.에서 chord-tone anchor 금지

Validator와 Grammar 양쪽이 동일한 정책을 사용한다.

## 13.11 Anchor overflow

Preset preferred cap:

| Preset | preferred cap / subphrase |
|---|---:|
| Simple | 6 |
| Standard | 9 |
| Full | 12 |

Solver absolute cap은 subphrase당 12.

Mandatory anchor가 12를 넘으면:

1. Lead rest
2. measure boundary
3. chord boundary
4. primary pulse boundary

순서로 결정적 subphrase 분할.

분할 후에도 12 초과면 `GEN_ANCHOR_LIMIT_EXCEEDED` blocking.

Mandatory anchor를 임의 삭제하지 않는다.

---


# 14. Generation·Solver·Global Assembler

## 14.1 Generated event payload와 final persistent event

```ts
interface GeneratedNoteEventPayload {
  readonly kind: "note";
  readonly range: MusicalRange;
  readonly pitch: SpelledPitch;
  readonly tieStart: boolean;
  readonly tieStop: boolean;
  readonly lyricTokenIds: readonly string[];
  readonly source:
    | "unison"
    | "octave-double"
    | "anchor"
    | "connection"
    | "planned-nct"
    | "user-edit";
  readonly originDirectiveId?: string;
}

interface GeneratedRestEventPayload {
  readonly kind: "rest";
  readonly range: MusicalRange;
}

type GeneratedVoiceEventPayload =
  | GeneratedNoteEventPayload
  | GeneratedRestEventPayload;

interface GeneratedNoteEvent extends GeneratedNoteEventPayload {
  readonly id: string;
}

interface GeneratedRestEvent extends GeneratedRestEventPayload {
  readonly id: string;
}

type GeneratedVoiceEvent = GeneratedNoteEvent | GeneratedRestEvent;

interface GeneratedHarmonyTrack {
  readonly trackPlanId: string;
  readonly events: readonly GeneratedVoiceEvent[];
}
```

- Phrase·Section 조립 단계는 ID 없는 `GeneratedVoiceEventPayload`를 사용한다.
- Song Assembler가 final musical payload를 완성한 뒤 candidate content digest를 계산한다.
- final digest가 나온 다음 한 번만 `gen:{digest}:...` event ID를 부여한다.
- Candidate는 generated harmony만 저장한다.
- `originDirectiveId`는 anchor·planned-NCT·lead-derived 실현 provenance를 보존하며 Output edit 후에도 원래 directive reference로 남길 수 있다.

## 14.2 Render / Playback composition

```ts
interface ArrangementRenderDocument {
  readonly measures: readonly PerformanceMeasureOccurrence[];
  readonly sourceLeadTrack: {
    readonly trackPlanId: "track:source-lead";
    readonly atomizationDigest: SemanticDigest;
    readonly atoms: readonly TimelineAtom[];
  };
  readonly generatedHarmonyTracks: readonly GeneratedHarmonyTrack[];
  readonly effectiveChordTimeline: EffectiveChordTimeline;
  readonly lyricTokens: readonly LyricToken[];
}
```

조립:

```text
SongSourceDocument Source Lead
+ active Candidate 또는 EditedArrangementSnapshot
+ 같은 EffectiveChordTimeline
→ ArrangementRenderDocument
→ MusicXML / ABC / Playback / PracticeShare adapter
```

Source Lead를 GeneratedVoiceEvent로 복제하지 않는다.

## 14.3 Phrase boundary state

```ts
interface PhraseBoundaryState {
  readonly firstPitchByTrack: Readonly<Record<string, SpelledPitch | null>>;
  readonly lastPitchByTrack: Readonly<Record<string, SpelledPitch | null>>;
  readonly endingActivityByTrack: Readonly<
    Record<string, VoiceActivityDirective>
  >;
  readonly placementRoleByTrack: Readonly<Record<string, VocalPlacementRole>>;
  readonly unresolvedNctPlanIds: readonly string[];
  readonly recentTextureIds: readonly TexturePatternId[];
}
```

## 14.4 PhraseCandidate

```ts
interface PhraseCandidate {
  readonly id: string;
  readonly phraseId: string;
  readonly presetId: ArrangementPresetId;
  readonly anchorPlanDigest: SemanticDigest;
  readonly textureId: TexturePatternId;
  readonly generatedEventPayloadsByTrack: Readonly<
    Record<string, readonly GeneratedVoiceEventPayload[]>
  >;
  readonly realizedAnchors: readonly RealizedHarmonyAnchor[];
  readonly density: TextureDensityMetrics;
  readonly boundary: PhraseBoundaryState;
  readonly localCost: CostUnit;
  readonly diagnostics: readonly Diagnostic[];
  readonly canonicalPathKey: string;
}
```

Phrase end에서 unresolved NCT는 0이어야 한다.

## 14.5 Phrase Solver

```text
PhraseActivityPlan
+ PhraseAnchorPlan
+ SourceLeadAtomization
+ EffectiveChordTimeline
+ SolverLock
→ chord / NCT / lead-derived pitch candidates
→ octave candidates
→ hard pruning
→ beam DP
→ K-best PhraseCandidate
```

```ts
interface PhraseSolverLimits {
  readonly maxPitchCandidatesPerAnchorPerTrack: number;
  readonly beamWidth: number;
  readonly kBestPerTexture: number;
  readonly maxSubphraseAnchors: number;
}

const CORE_PHRASE_SOLVER_LIMITS = {
  maxPitchCandidatesPerAnchorPerTrack: 24,
  beamWidth: 64,
  kBestPerTexture: 4,
  maxSubphraseAnchors: 12,
} as const satisfies PhraseSolverLimits;
```

- limits 값은 versioned solver config에 속하고 `generationInputDigest`에 config digest로 포함한다.
- `canonicalPathKey`는 texture ID → track ordinal → directive ordinal → pitch key → activity transition key를 ASCII separator로 연결한 versioned 문자열이다.
- source entity ID·표시 이름·객체 iteration order를 canonicalPathKey에 넣지 않는다.
- 같은 CostUnit에서는 canonicalPathKey의 Unicode code-unit order로 tie-break한다.
- subphrase는 stage-local range이며 persistent semantic ID를 만들지 않는다. 진단에는 원본 phrase ID와 subrange를 기록한다.

## 14.6 Boundary cost

- 마지막→첫 pitch leap
- rest 후 reentry
- placement role continuity
- 동일 texture 반복
- section intensity target 편차
- looping cadence와 다음 시작 pitch
- register jump
- 갑작스러운 3-track→1-track 변화
- role segment boundary 불일치

## 14.7 Section Assembler

```ts
interface SectionCandidate {
  readonly id: string;
  readonly sectionOccurrenceId: string;
  readonly presetId: ArrangementPresetId;
  readonly density: TextureDensityMetrics;
  readonly boundary: PhraseBoundaryState;
  readonly cost: CostUnit;
  readonly canonicalPathKey: string;
}
```

- phrase 후보를 performance order로 DP 조립한다.
- beam width 24는 versioned assembler config의 초기값이다.
- section intensity의 유일한 기준은 `SectionArrangementIntent.intensityTarget`이다.
- 동일 texture 3회 연속에는 큰 정수 비용을 부여한다.
- `drop` variant는 낮은 density를 허용한다.
- monotonic energy는 hard rule이 아니다.

## 14.8 Song Assembler와 final Candidate

```ts
interface FullSongMetrics {
  readonly densityBySectionOccurrence: Readonly<
    Record<string, TextureDensityMetrics>
  >;
  readonly maxLeapSemitonesByTrack: Readonly<Record<string, number>>;
  readonly hardDiagnosticCount: number;
  readonly plannedNctResolution: CountRateMetric;
  readonly sourceChordRespect: CountRateMetric;
}

interface ArrangementCandidate {
  readonly id: string;
  readonly presetId: ArrangementPresetId;
  readonly candidateStatus: "complete" | "partial";
  readonly anchorPlanDigest: SemanticDigest;
  readonly effectiveConfigDigest: SemanticDigest;
  readonly presetProfileDigest: SemanticDigest;
  readonly effectiveChordTimelineDigest: SemanticDigest;
  readonly sourceLeadAtomizationDigest: SemanticDigest;
  readonly generatedEventsByTrack: Readonly<
    Record<string, readonly GeneratedVoiceEvent[]>
  >;
  readonly realizedAnchors: readonly RealizedHarmonyAnchor[];
  readonly metrics: FullSongMetrics;
  readonly diagnostics: readonly Diagnostic[];
  readonly canonicalPathKey: string;
  readonly contentDigest: SemanticDigest;
}
```

Candidate 정본:

- `anchorPlanDigest`는 해당 variant의 `ArrangementAnchorPlan.anchorPlanDigest`와 exact equal하다.
- `candidateStatus`는 validator version에 따라 바뀌는 등급이 아니라, Anchor Plan의 required phrase coverage를 generated payload가 구조적으로 모두 실현했는지를 나타낸다.
- hard validation 통과 여부는 `ArrangementGenerationResult.status`, Candidate diagnostics, Validator 결과가 별도로 표현한다.
- `realizedAnchors`는 directive→track→position→pitch의 canonical mapping이며 final Candidate와 Edited Snapshot에서 보존한다.
- sourceChordRespect는 `realizedAnchors`를 기준으로 계산하며 event의 표시용 `source` 문자열만으로 역추론하지 않는다.

CountRateMetric 정의:

- `plannedNctResolution.numerator` = deadline 안에 합법적으로 해결된 planned NCT 수.
- `plannedNctResolution.denominator` = 전체 planned NCT 수.
- `sourceChordRespect.numerator` = EffectiveChordTimeline의 explicit chord span에서 chord-tone 또는 합법 planned-NCT 정책을 지킨 evaluable realized anchor 수.
- `sourceChordRespect.denominator` = 위 조건에서 평가 가능한 realized anchor 수.
- explicit N.C.·lead-derived unison/옥타브·anchor가 없는 구간은 sourceChordRespect 분모에서 제외한다.

Song Assembler:

- Section 후보를 전체 performance order로 조립한다.
- beam width 12는 versioned assembler config의 초기값이다.
- preset당 내부 top 3을 유지한다.
- 사용자에게 각 preset 1위 후보를 기본 비교 제시한다.
- Final Chorus 확장은 target이지 보편 hard law가 아니다.
- looping section은 다음 occurrence 시작 pitch를 본다.
- unresolved NCT 전달을 금지한다.

## 14.9 Trace repository

Phrase·Section 후보 ID는 final Candidate의 canonical payload에 직접 저장하지 않는다.

```ts
interface SectionAssemblyTrace {
  readonly sectionCandidateId: string;
  readonly phraseCandidateIds: readonly string[];
}

interface SongAssemblyTrace {
  readonly finalCandidateId: string;
  readonly sectionCandidateIds: readonly string[];
}

interface GenerationTraceRepository {
  readonly phraseCandidates: readonly PhraseCandidate[];
  readonly sectionCandidates: readonly SectionCandidate[];
  readonly sectionAssemblies: readonly SectionAssemblyTrace[];
  readonly songAssemblies: readonly SongAssemblyTrace[];
}
```

- trace는 설명·디버그·평가 artifact이며 candidate content digest와 PracticeShare에서 제외한다.
- trace가 생략돼도 final Candidate에 dangling section/phrase candidate ID가 남지 않는다.

## 14.10 Version registry와 Generation Result

```ts
interface AlgorithmVersionRegistry {
  readonly domainSchemaVersion: string;
  readonly digestCodecVersion: string;
  readonly chordParserVersion: string;
  readonly chordTimelineResolverVersion: string;
  readonly performanceExpanderVersion: string;
  readonly sourceLeadAtomizerVersion: string;
  readonly presetProfileVersion: string;
  readonly candidateProjectionVersion: string;
  readonly plannerVersion: string;
  readonly grammarVersion: string;
  readonly activityPlannerVersion: string;
  readonly anchorPlannerVersion: string;
  readonly solverVersion: string;
  readonly assemblerVersion: string;
  readonly validatorVersion: string;
  readonly metricsVersion: string;
  readonly diagnosticRegistryVersion: string;
  readonly accompanimentVersion: string;
  readonly editMaterializerVersion: string;
  readonly practiceShareCodecVersion: string;
  readonly omrNormalizerVersion: string;
  readonly evidenceMappingVersion: string;
}

interface AlgorithmConfigDigestRegistry {
  readonly plannerConfigDigest: SemanticDigest;
  readonly grammarConfigDigest: SemanticDigest;
  readonly activityPlannerConfigDigest: SemanticDigest;
  readonly anchorPlannerConfigDigest: SemanticDigest;
  readonly solverConfigDigest: SemanticDigest;
  readonly assemblerConfigDigest: SemanticDigest;
  readonly validatorConfigDigest: SemanticDigest;
  readonly metricConfigDigest: SemanticDigest;
  readonly accompanimentConfigDigest: SemanticDigest;
  readonly diagnosticRegistryDigest: SemanticDigest;
}

interface AlgorithmExecutionRegistry {
  readonly versions: AlgorithmVersionRegistry;
  readonly configDigests: AlgorithmConfigDigestRegistry;
}

interface GenerationDigests extends StageInputDigests {
  readonly musicalSourceDigest: SemanticDigest;
  readonly effectiveChordTimelineDigest: SemanticDigest;
  readonly sourceLeadAtomizationDigest: SemanticDigest;
  readonly presetProfileDigest: SemanticDigest;
  readonly effectiveConfigDigest: SemanticDigest;
  readonly intentPlanDigest: SemanticDigest;
  readonly activityPlanDigest: SemanticDigest;
  readonly anchorPlanDigest: SemanticDigest;
}

interface ArrangementGenerationResult {
  readonly presetId: ArrangementPresetId;
  readonly status: GenerationStatus;
  readonly candidates: readonly ArrangementCandidate[];
  readonly diagnostics: readonly Diagnostic[];
  readonly digests: GenerationDigests;
  readonly configDigests: Pick<
    AlgorithmConfigDigestRegistry,
    | "solverConfigDigest"
    | "assemblerConfigDigest"
    | "validatorConfigDigest"
    | "metricConfigDigest"
    | "diagnosticRegistryDigest"
  >;
  readonly versions: Pick<
    AlgorithmVersionRegistry,
    | "domainSchemaVersion"
    | "digestCodecVersion"
    | "chordParserVersion"
    | "chordTimelineResolverVersion"
    | "performanceExpanderVersion"
    | "sourceLeadAtomizerVersion"
    | "presetProfileVersion"
    | "candidateProjectionVersion"
    | "plannerVersion"
    | "grammarVersion"
    | "activityPlannerVersion"
    | "anchorPlannerVersion"
    | "solverVersion"
    | "assemblerVersion"
    | "validatorVersion"
    | "metricsVersion"
    | "diagnosticRegistryVersion"
  >;
  readonly trace?: GenerationTraceRepository;
}
```

GenerationStatus truth table:

- `blocked`: candidates가 0개이고 `blocksGeneration=true` diagnostic이 1개 이상.
- `complete`: hard validation을 통과한 complete candidate가 1개 이상.
- `partial`: candidates가 1개 이상이지만 complete candidate는 없고 partial candidate만 존재.
- blocked result에 가짜 candidate를 넣지 않는다.
- complete·partial result는 candidate 1개 이상이어야 한다.
- candidateStatus는 `complete | partial`만 허용한다.
- 위 조합을 위반하면 `GENERATION_RESULT_STATE_INVALID` blocking.

정본:

- ArrangementGenerationResult는 Anchor Plan이 존재한 뒤의 generation attempt에만 반환한다.
- Intent·Activity·Anchor 단계의 조기 차단은 `StageExecutionResult`로 반환한다.
- blocked이면 candidates는 빈 배열 가능하다.
- trace가 없어도 candidate·snapshot·export 의미는 완전해야 한다.

## 14.11 Candidate diversity

동일 preset의 top 3는 다음 중 하나 이상 달라야 한다.

- texture sequence
- upper/lower placement
- anchor selection
- `exactlyThreePitchCoverage.valueBp`가 양쪽 모두 non-null이고 800 bp 이상 차이

단순 enharmonic spelling 차이는 다양성으로 인정하지 않는다.

---

# 15. Diagnostic 정본

## 15.1 Definition

```ts
type DiagnosticSeverity =
  | "info"
  | "warning"
  | "error"
  | "blocking";

type DiagnosticScope =
  | "input"
  | "chord"
  | "performance"
  | "planner"
  | "activity"
  | "anchor"
  | "solver"
  | "validation"
  | "import"
  | "omr"
  | "share"
  | "evaluation"
  | "rights";

interface DiagnosticDefinition {
  readonly code: DiagnosticCode;
  readonly defaultSeverity: DiagnosticSeverity;
  readonly blocksGeneration: boolean;
  readonly blocksComplete: boolean;
  readonly scope: DiagnosticScope;
}

interface DiagnosticRegistry {
  readonly registryVersion: string;
  readonly definitions: Readonly<Record<DiagnosticCode, DiagnosticDefinition>>;
  readonly registryDigest: SemanticDigest;
}

interface DiagnosticLocation {
  readonly range?: MusicalRange;
  readonly phraseId?: string;
  readonly sectionOccurrenceId?: string;
  readonly sourceEventIds?: readonly string[];
  readonly trackPlanIds?: readonly string[];
}

interface Diagnostic {
  readonly id: string;
  readonly code: DiagnosticCode;
  readonly severity: DiagnosticSeverity;
  readonly messageKo: string;
  readonly location?: DiagnosticLocation;
  readonly details?: Readonly<Record<string, string | number | boolean>>;
}
```

Severity만 보고 차단 여부를 추측하지 않는다.

Diagnostic registry 정본:

- 모든 `DiagnosticCode`는 registry에 정확히 한 번 존재해야 한다.
- Record key와 `DiagnosticDefinition.code`는 exact equal해야 한다.
- `registryVersion`은 `AlgorithmVersionRegistry.diagnosticRegistryVersion`과 exact equal해야 한다.
- `registryDigest`는 version + code별 defaultSeverity·blocksGeneration·blocksComplete·scope를 code lexical order로 해시한다.
- Generation input과 Edited Snapshot validation provenance는 같은 registry version/digest를 사용한다.
- registry 값이 달라지면 validator config가 같아도 Generation과 Snapshot validation 결과를 재평가한다.

Diagnostic ID·projection 정본:

- ID는 `dg:{code}:{locationKey}:{ordinal}`이다.
- `locationKey`는 scope·preset·phrase/section/measure/position·track ordinal을 canonical order로 직렬화한다.
- 같은 code·location의 복수 진단은 canonical semantic details projection으로 정렬해 ordinal을 부여한다.
- digest용 diagnostic projection은 `code`, `severity`, registry의 `blocksGeneration`·`blocksComplete`, canonical location, semantic details만 포함한다.
- `Diagnostic.id`, `messageKo`, 사용자용 서술 순서, locale은 semantic digest에서 제외한다.
- semantic details의 string은 안정된 code/value만 허용하며 자유로운 UI 문장은 넣지 않는다.

## 15.2 필수 DiagnosticCode

```ts
type DiagnosticCode =
  | "INPUT_INVALID_FRACTION"
  | "INPUT_FRACTION_LIMIT_EXCEEDED"
  | "INPUT_EVENT_OVERLAP"
  | "INPUT_INVALID_TIE"
  | "INPUT_LIMIT_EXCEEDED"
  | "INPUT_KEY_SIGNATURE_INCONSISTENT"
  | "INPUT_BEAT_GROUPS_INVALID"
  | "UNSUPPORTED_KEY_SIGNATURE"
  | "UNSUPPORTED_BEAT_GROUPING"
  | "UNSUPPORTED_METER"
  | "UNSUPPORTED_MODULATION"
  | "UNSUPPORTED_PERFORMANCE_FLOW"
  | "PERFORMANCE_EXPANSION_FAILED"
  | "PERFORMANCE_REPEAT_UNMATCHED"
  | "PERFORMANCE_REPEAT_NESTED"
  | "SECTION_COVERAGE_INVALID"
  | "PHRASE_COVERAGE_INVALID"

  | "SOURCE_CHORD_PARSE_FAILED"
  | "SOURCE_CHORD_UNCONFIRMED"
  | "SOURCE_CHORD_GAP"
  | "SOURCE_CHORD_CARRY_WITHOUT_PREVIOUS"
  | "EFFECTIVE_CHORD_TIMELINE_STALE"
  | "CHORD_RESOLVER_VERSION_MISMATCH"
  | "SOURCE_NO_CHORD_REGION"
  | "SOURCE_LEAD_UNCLASSIFIED_NCT"

  | "TRACK_PLAN_MISSING"
  | "TRACK_ASSIGNMENT_INVALID"
  | "TRACK_ROLE_CONFLICT"
  | "TRACK_ORDINAL_INVALID"
  | "PERFORMER_RANGE_INVALID"
  | "PERFORMER_DOUBLE_BOOKED"
  | "STALE_REFERENCE"
  | "STAGE_LOCK_SCOPE_INVALID"
  | "ANCHOR_LOCK_INVALID"
  | "CANONICAL_DIGEST_CODEC_FAILED"

  | "SECTION_UNCONFIRMED"
  | "PHRASE_SPLIT_APPLIED"
  | "NO_ELIGIBLE_TEXTURE"
  | "SECTION_INTENSITY_INFEASIBLE"
  | "GRAMMAR_NOT_ACCEPTED"
  | "GRAMMAR_BLOCKED"

  | "ACTIVITY_SPAN_INVALID"
  | "HARMONY_ATTACK_RATIO_EXCEEDED"
  | "LYRIC_POLICY_VIOLATION"
  | "METRIC_NO_MELODY_DURATION"

  | "GEN_ANCHOR_LIMIT_EXCEEDED"
  | "GEN_NO_PITCH_CANDIDATE"
  | "GEN_SEARCH_BUDGET_EXHAUSTED"
  | "GEN_TIMEOUT"
  | "GEN_CANCELLED"
  | "GENERATED_OUT_OF_RANGE"
  | "GENERATED_VOICE_CROSSING"
  | "GENERATED_ILLEGAL_NCT"
  | "GENERATED_UNRESOLVED_SUSPENSION"
  | "GENERATED_CHORD_ROLE_CONFLICT"
  | "GENERATED_NO_CHORD_POLICY_VIOLATION"

  | "IMPORT_CORRUPT_XML"
  | "IMPORT_UNSUPPORTED_ELEMENT"
  | "IMPORT_ARCHIVE_UNSAFE"

  | "OMR_INPUT_QUALITY_LOW"
  | "OMR_PROVIDER_CAPABILITY_MISSING"
  | "OMR_PROVIDER_FAILED"
  | "OMR_PROVIDER_NEEDS_INPUT"
  | "OMR_EVIDENCE_GRANULARITY_LOW"
  | "OMR_MEASURE_DURATION_INVALID"
  | "OMR_TIE_INVALID"
  | "OMR_CHORD_UNPARSEABLE"
  | "OMR_REVIEW_REQUIRED"
  | "OMR_DELETE_FAILED"
  | "OMR_QUOTA_EXCEEDED"

  | "RIGHTS_GENERATION_NOT_CONFIRMED"
  | "RIGHTS_PROVIDER_TRANSFER_NOT_CONFIRMED"
  | "RIGHTS_SHARE_NOT_CONFIRMED"
  | "RIGHTS_EVALUATION_NOT_CONFIRMED"

  | "SHARE_PAYLOAD_TOO_LARGE"
  | "SHARE_PAYLOAD_INVALID"
  | "EDIT_BASE_CANDIDATE_STALE"
  | "EDIT_SNAPSHOT_INVALID"
  | "EDIT_MATERIALIZATION_BLOCKED"
  | "GENERATION_RESULT_STATE_INVALID"
  | "OMR_EVIDENCE_TRANSFORM_MISSING"
  | "OMR_EVIDENCE_CODEC_FAILED"
  | "OMR_REVIEW_RESOLUTION_INVALID"
  | "OMR_EVIDENCE_TARGET_UNMAPPED"
  | "SHARE_STORE_REQUIRED"
  | "SOURCE_REVISION_INVALID"
  | "SOURCE_REVISION_MISMATCH"
  | "SOURCE_ID_REMAP_REQUIRED"
  | "SOURCE_ID_REMAP_FAILED"
  | "SOURCE_LEAD_ATOMIZATION_STALE"
  | "SECTION_INTENSITY_AUTHORITY_INVALID"
  | "PRESET_PROFILE_VERSION_MISMATCH"
  | "ALGORITHM_CONFIG_MISMATCH"
  | "CANDIDATE_PROJECTION_INVALID";
```

새 코드를 추가할 때:

1. union
2. registry
3. 한국어 문구
4. 최소 1개 테스트

을 함께 수정한다.

---


# 16. Deterministic Digest·Stage Authority·Generated ID

## 16.1 Digest 계층

```text
musicalSourceDigest
sourceLeadAtomizationDigest
effectiveChordTimelineDigest
intentInputDigest
intentPlanDigest
activityInputDigest
activityPlanDigest
anchorInputDigest
anchorPlanDigest
generationInputDigest
candidateContentDigest
editedSnapshotContentDigest
```

## 16.2 musicalSourceDigest

```text
projectionSchema = hm-musical-source-v1
```

포함:

- KeySignature의 tonic·mode
- meter·beatGroups·measure duration
- expanded performance sequence와 SectionOccurrence별 `lyricVerseIndex`
- Source Lead semantic events
- confirmed SourceChordEvent semantic content
- `SectionDefinition.type`·연속 source range·confirmation
- `SectionOccurrence.definition` 연결·variant·lyric verse·performance range
- PhraseRegion canonical range와 section-occurrence 연결
- occurrence에서 선택된 LyricToken의 verse·lead-event canonical ordinal·syllabic·extend·`resolveProductionLyricEmphasis()` 결과
- `LyricToken.text`와 raw `emphasisSource`는 표시·provenance로 보존하되 generation semantic projection에서는 제외한다. 단, raw annotation이 달라도 resolver 결과가 다르면 projection은 반드시 달라진다.

제외:

- `documentId`, `revisionOrdinal`, `previousRevision`
- revision history와 SourceIdRemap
- Source ID 문자열
- 코드 원문 alias와 `ParsedChord.canonicalSymbol`
- 파일명·import 시각·provider metadata
- 표시 이름·UI 상태·project random ID

Lyric emphasis projection 정본:

- `confirmed + manual`, `confirmed + musicxml-accent`, `confirmed + metric-heuristic`는 모두 production 의미 `confirmed`로 투영한다.
- `suggested + musicxml-accent`는 `musicxml-accent-suggested`로 투영한다.
- `suggested + metric-heuristic`는 production에서 사용할 수 없으므로 `none`으로 투영한다.
- 따라서 같은 production 의미의 provenance 차이는 musical source digest를 불필요하게 바꾸지 않지만, Grammar eligibility가 달라지는 annotation은 반드시 digest를 바꾼다.

`musicalSourceDigest`는 음표·코드·구간의 음악 의미뿐 아니라 production generation eligibility를 결정하는 authority state를 포함한다. `SongSourceDocument.revisionDigest`는 이 digest와 exact equal한다. 같은 음악 내용과 confirmation 상태로 되돌아오면 revisionOrdinal은 새 값이지만 musicalSourceDigest는 이전과 같을 수 있다. Phrase identity도 range 기반이므로 같은 range로 되돌아오면 같은 semantic phrase로 취급한다.

## 16.3 SourceLeadAtomization digest

```text
projectionSchema = hm-source-lead-atomization-v1

atomizerVersion
+ musicalSourceDigest
+ EffectiveChordTimeline.digest
+ canonical atom payload
  - source event canonical ordinal
  - canonical MusicalRange
  - pitch 또는 rest
  - tie flags
  - occurrence-resolved lyric token ordinals
  - 각 선택 token의 syllabic·extend·ProductionLyricEmphasis
→ SourceLeadAtomization.digest
```

- TimelineAtom ID 문자열은 projection에서 제외하고 canonical atom ordinal로 치환한다.
- Grammar·Activity·Anchor·Lock에서 생기는 stage-local sub-atom은 이 digest에 들어가지 않는다.
- atomizerVersion 또는 canonical source/chord/phrase/section/verse/ProductionLyricEmphasis 의미가 바뀌면 digest가 바뀐다.

## 16.4 EffectiveChordTimeline digest

```text
source chord semantic projection
+ expanded performance sequence digest
+ ChordResolutionPolicy
+ AlgorithmVersionRegistry.chordTimelineResolverVersion
→ EffectiveChordTimeline.digest
```

모든 downstream module은 이 digest와 같은 timeline을 사용한다.

## 16.5 단계별 input digest

```text
intentInputDigest
- musicalSourceDigest
- EffectiveChordTimeline.digest
- SourceLeadAtomization.digest + atomizerVersion
- performer hardRange / comfortableRange / preferredTessitura 또는 null
- TrackPlan semantic projection과 canonical ordinal
- performer-track mapping by canonical ordinal
- ArrangementMode
- user caps
- preset ID
- EffectiveArrangementConfig semantic projection + digest
- PresetProfileRegistry.presetProfileVersion + presetProfileDigest
- IntentLock semantic projection
- plannerVersion
- grammarVersion
- Grammar config digest
- Diagnostic registry version/digest

activityInputDigest
- intentPlanDigest
- SourceLeadAtomization.digest + atomizerVersion
- EffectiveArrangementConfig.digest
- presetProfileVersion + presetProfileDigest
- ActivityLock semantic projection
- activityPlannerVersion
- Activity Planner config digest
- Diagnostic registry version/digest

anchorInputDigest
- activityPlanDigest
- SourceLeadAtomization.digest + atomizerVersion
- EffectiveArrangementConfig.digest
- presetProfileVersion + presetProfileDigest
- 자기완결 semantic AnchorLock projection
- anchorPlannerVersion
- Anchor Planner config digest
- Diagnostic registry version/digest

generationInputDigest
- anchorPlanDigest
- EffectiveArrangementConfig.digest
- presetProfileVersion + presetProfileDigest
- SolverLock semantic projection
- solverVersion
- assemblerVersion
- validatorVersion
- metricsVersion
- candidateProjectionVersion
- Solver config digest
- Section/Song Assembler config digest
- Validator config digest
- Metric config digest
- Diagnostic registry version/digest
```

하나의 `planningInputDigest`에 여러 단계 권한을 섞지 않는다. 알고리즘이 실제로 읽는 값은 해당 단계 digest에서 빠질 수 없다.

각 Intent·Activity·Anchor Plan은 자신이 사용한 `effectiveConfigDigest`, `presetProfileVersion`, `presetProfileDigest`, `diagnosticRegistryVersion`, `diagnosticRegistryDigest`를 저장한다.

## 16.6 Plan invalidation

- intentInputDigest 변화 → Intent부터 stale
- intentPlanDigest 또는 activityInputDigest 변화 → Activity부터 stale
- activityPlanDigest 또는 anchorInputDigest 변화 → Anchor부터 stale
- anchorPlanDigest 또는 generationInputDigest 변화 → Generation stale
- 표시 이름 변경은 stale 아님
- AnchorLock 변경은 Anchor Plan을 다시 만들며 Generation에만 overlay하지 않음
- stale 전환은 Section 9.1의 `VariantStaleness`만 갱신하고 기존 artifact·edit·snapshot을 삭제하지 않음

## 16.7 Canonical projection과 codec

Section 4.6의 codec만 사용한다.

- projection schema version은 artifact별로 고정
- set-like array 정렬 comparator를 명시
- safe integer 외 number 금지
- UTF-8 + SHA-256 + lowercase hex 64자
- Node·browser parity fixture 필수

## 16.8 Plan output projection·digest

세 Plan digest는 입력 digest만 해시하지 않고 실제 realized Plan의 음악 의미를 함께 해시한다.

### Intent Plan

```text
projectionSchema = hm-arrangement-intent-plan-v1

포함:
- presetId
- intentInputDigest
- effectiveChordTimelineDigest
- sourceLeadAtomizationDigest
- effectiveConfigDigest
- preset profile version/digest
- grammar/planner version
- grammarConfigDigest + plannerConfigDigest
- diagnosticRegistryVersion + diagnosticRegistryDigest
- section intent: section occurrence canonical ordinal + SectionIntensityTarget
- phrase intent: phrase canonical ordinal + section intent ordinal + texture + track role canonical payload + lyric policy + cadence policy + optional split position

제외:
- 모든 entity ID 문자열
- grammarRuleIds
- GrammarPlanningTraceRepository
- TextureSplitDirective.reasonCode
- diagnostics·표시 metadata
```

### Activity Plan

```text
projectionSchema = hm-arrangement-activity-plan-v1

포함:
- presetId
- intentPlanDigest
- activityInputDigest
- activityPlannerVersion + activityPlannerConfigDigest
- diagnosticRegistryVersion + diagnosticRegistryDigest
- sourceLeadAtomizationDigest
- effectiveConfigDigest
- preset profile digest
- phrase canonical ordinal별 activity span canonical range·track ordinal·directive
- attack event position·track ordinal·kind

제외:
- Plan·Span·Attack ID 문자열
- realizedMetrics
- diagnostics·display order
```

### Anchor Plan

```text
projectionSchema = hm-arrangement-anchor-plan-v1

포함:
- presetId
- activityPlanDigest
- anchorInputDigest
- anchorPlannerVersion + anchorPlannerConfigDigest
- diagnosticRegistryVersion + diagnosticRegistryDigest
- sourceLeadAtomizationDigest
- effectiveConfigDigest
- preset profile digest
- phrase canonical ordinal별 Anchor directive semantic payload
- NCT graph를 directive canonical ordinal로 치환한 semantic payload

제외:
- Plan·Directive·NCT ID 문자열
- diagnostics·trace·display metadata
```

- optional explanation reason code는 실제 music/plan 동작을 바꾸지 않으면 digest에서 제외한다.
- split position·track placement·activity range·anchor semantic payload는 실제 downstream 동작을 바꾸므로 반드시 포함한다.
- Plan projection schema 변경은 persisted Plan migration을 요구한다.

## 16.9 Candidate content projection·digest·Generated ID

Candidate content digest는 다음 정본 projection만 포함한다.

```text
projectionSchema = hm-arrangement-candidate-content-v1

포함:
- presetId
- candidateStatus
- anchorPlanDigest
- effectiveConfigDigest
- presetProfileDigest
- effectiveChordTimelineDigest
- sourceLeadAtomizationDigest
- generated tracks in canonical track ordinal order
  - track canonical ordinal
  - event kind
  - canonical MusicalRange
  - pitch spelling for note
  - tieStart / tieStop
  - lyric token canonical ordinals
  - source behavior
  - origin anchor directive canonical ordinal 또는 null
- realized anchor projection
  - anchor directive canonical ordinal
  - track ordinal
  - position key
  - realized pitch

제외:
- ArrangementCandidate.id
- GeneratedVoiceEvent.id
- Diagnostic 전체
- FullSongMetrics
- canonicalPathKey
- Phrase/Section/Song assembly trace
- UI order와 표시 metadata
```

`candidateStatus`는 Section 14.8의 구조적 phrase-coverage 상태이며 validator·metric version에 따라 바뀌지 않는다.

순환 금지:

```text
final ID 없는 generated payload
→ candidate content projection
→ candidateContentDigest
→ ArrangementCandidate.id
→ generated event ID
```

Candidate ID:

```text
cand:{preset}:{fullCandidateContentDigest}
```

Generated event ID:

```text
gen:{fullCandidateContentDigest}:{trackOrdinal}:{positionKey}:{eventOrdinal}
```

- digest prefix를 사용하지 않는다.
- event ordinal은 같은 track·position·event kind 안의 canonical order다.
- Phrase/Section 단계 payload에는 final generated event ID를 부여하지 않는다.
- `candidateProjectionVersion` 또는 projection schema 변경은 Candidate·Generated ID 의미 변경이므로 explicit schema migration을 요구한다.

## 16.10 Edited snapshot digest

```text
baseCandidateDigest
+ effectiveChordTimelineDigest
+ canonical ordered OutputEdit projection
+ appliedEditSetDigest
+ editMaterializerVersion
+ validatorVersion + validatorConfigDigest
+ metricsVersion + metricConfigDigest
+ diagnosticRegistryVersion + diagnosticRegistryDigest
+ materialized generated tracks
+ realized anchor projection after edits
+ canonical validation projection
+ FullSongMetrics
→ editedSnapshotContentDigest
```

Materialized-track projection은 event ID를 제외하고 track ordinal·event kind·range·pitch·tie·lyric ordinal·source lineage를 포함한다.

Canonical validation projection 포함:

- diagnostic code
- severity
- registry의 blocksGeneration / blocksComplete
- canonical location projection
- semantic detail key/value 중 safe-integer·canonical string 값

제외:

- Diagnostic.id
- messageKo
- locale·표시 순서
- 자유로운 UI 문장

Snapshot ID:

```text
es:{preset}:{fullEditedSnapshotContentDigest}
```

`contentDigest`는 materialized content의 무결성 값이며 validator·metric provenance를 포함한다.

- Base Candidate에서 계승된 1:1 event는 base event ID를 lineage identity로 유지한다.
- Core Output edit는 event split·merge·삽입을 만들지 않으므로 별도 synthetic event ID를 생성하지 않는다.
- edited snapshot digest projection은 모든 event ID를 제외한다.
- OutputEdit payload나 materializer 중간 객체가 임의 ID를 공급하지 않는다.

# 17. Validator·Cost·Accompaniment

## 17.1 모든 프로필 Hard

- hard range
- event overlap
- tie mismatch
- unconfirmed chord
- plan rest 위치의 note
- planned NCT 미해결
- unsupported modulation
- unresolved performance flow
- assignment authority 충돌
- stale plan·lock reference
- N.C. policy 위반

## 17.2 band-supported Hard

- 명시 코드 tone semantics 위반
- `no3`에서 third 생성
- sus chord에 unplanned third
- 지속적 placement crossing
- 같은 performer 동시 두 track
- illegal generated NCT
- 가사 새 단어 생성

## 17.3 band-supported Soft

- comfortable range 이탈
- preferred tessitura 이탈
- 큰 도약
- Lead 근접
- 모든 Lead attack 복제
- 같은 texture 반복
- 역할 교대 과다
- register spread target 편차
- section intensity 편차
- 불필요한 root 중복
- source color tone 미활용


## 17.4 Chord tone 의미와 track별 실현 순위

ParsedChord는 profile-independent다.

```ts
interface ChordToneTrackRankingInput {
  readonly chord: ParsedChord;
  readonly mode: CoreArrangementMode;
  readonly presetId: ArrangementPresetId;
  readonly effectiveConfig: EffectiveArrangementConfig;
  readonly textureId: TexturePatternId;
  readonly leadPitch: SpelledPitch | null;
  readonly placementRole: VocalPlacementRole;
  readonly hardRange: PitchRange;
  readonly comfortableRange: PitchRange;
  readonly preferredTessitura?: PitchRange;
  readonly previousPitch?: SpelledPitch;
  readonly position: MusicalPosition;
}

interface RankedChordToneForTrack {
  readonly tone: ChordToneSpec;
  readonly feasiblePitches: readonly SpelledPitch[];
  readonly localCost: CostUnit;
  readonly reasonCodes: readonly string[];
}

declare function rankChordToneForTrack(
  input: ChordToneTrackRankingInput,
): readonly RankedChordToneForTrack[];
```

계층:

```text
resolveSemanticChordImportance(chord)
→ 코드 identity의 중요도

rankChordToneForTrack(input.chord, context)
→ 함수 내부에서 semantic importance를 계산
→ Lead·texture·role·range·preset에서 실제 후보 순위
```

정본:

- caller는 `semanticImportance` 파생 배열을 별도 입력할 수 없다.
- hardRange 밖 pitch는 후보 목록에 들어가지 않는다.
- comfortableRange 밖이지만 hardRange 안인 pitch는 strong soft cost.
- preferredTessitura 밖이지만 comfortableRange 안인 pitch는 additional preference cost.
- preferredTessitura가 없으면 해당 비용은 0.
- performer range는 코드 의미를 바꾸지 않고 후보 실현 가능성·cost를 바꾼다.
- `no3`, sus, omission은 ParsedChord tone set에서 이미 반영된다.
- Lead가 identity-critical tone을 이미 담당하면 harmony track의 중복 우선순위를 낮출 수 있다.
- `allowColorTones=false`이면 identity-critical하지 않은 color tone 후보에 큰 cost 또는 금지 정책을 적용한다.

## 17.5 Accompaniment

Accompaniment는 같은 `EffectiveChordTimeline`과 `ParsedChord.tones`에서 생성한다.

금지:

- `Csus4`를 C major로 재생
- `Cno3`에 third 추가
- `C7sus4`의 b7 누락
- slash bass 무시
- Solver와 다른 chord timeline 사용

```ts
interface AccompanimentConfig {
  readonly version: string;
  readonly configDigest: SemanticDigest;
  readonly padMaxTones: number;
  readonly bassOctave: number;
  readonly padRegisterLow: SpelledPitch;
  readonly padRegisterHigh: SpelledPitch;
  readonly velocity: number;
}
```

정책:

- N.C. = silence
- EffectiveChordTimeline이 덮지 않는 instrumental/non-melody 구간도 silence이며 harmony generation 대상이 아니다.
- slash bass가 있으면 bass에 사용, 없으면 root
- semantic chord tone만 사용
- omission 존중
- 모든 비교 후보에 동일 accompaniment
- 음량 normalization
- voicing·sound asset version 고정
- `AccompanimentConfig.configDigest`는 전체 voicing·register·velocity·asset configuration을 해시하고 `AlgorithmConfigDigestRegistry.accompanimentConfigDigest`와 exact equal해야 한다.

---

# 18. 공정한 평가·Holdout·Field Pilot

## 18.1 평가 분류

### Engineering conformance

- hard error count
- deterministic parity
- Activity Plan agreement
- intensity deviation
- source chord respect
- planned NCT resolution
- performance timeline parity

### Musical quality

- singability
- Lead clarity
- phrase boundary smoothness
- texture variety
- contemporary worship fit
- expert pairwise preference

### Product outcome

- usable as-is
- light-edit usable
- correction time
- edits per 100 generated notes
- share completion
- reuse intention

내부 Plan 준수율을 제품 품질로 표현하지 않는다.

## 18.2 B0

Lead only. 재생 하한선이며 Pitch Solver 우월성 gate의 주 상대가 아니다.

## 18.3 B1a — Matched Activity Baseline

조건:

- 동일 Source Lead
- 동일 confirmed source chord
- 동일 performer hard/comfortable range
- 동일 track plan·placement role
- 동일 Activity span·Attack event
- 동일 Anchor position
- 동일 planned NCT 종류·resolution deadline
- 가장 가까운 합법 chord tone / 가장 단순한 합법 NCT pitch
- production hard range·crossing rule 적용
- production solver 내부 함수 import 금지

실패·위반은 숨기지 않고 다음을 보고한다.

```text
baselineHardViolationCount
baselineUnsolvedPhraseCount
```

## 18.4 B1b — Matched Intensity Heuristic

조건:

- 동일 Source·performer·track 수
- 동일 SectionIntensityTarget
- 동일 effective max active voices
- source chord color semantics 존중
- deterministic 3도·6도·common-tone heuristic
- production hard range 적용
- 실제 realized density 차이를 함께 보고

## 18.5 B2 — Traditional Baseline

동음 리듬·root support 중심. 설명용이며 현대 품질 gate의 주 상대가 아니다.

## 18.6 B3 — Human Quick Arrangement

모든 비교에서 동일 조건:

- 같은 Source Lead
- 같은 confirmed source chord
- 같은 performer ranges
- 같은 preset 정의
- 같은 보컬 수
- 같은 time limit
- 같은 accompaniment
- 같은 excerpt 길이

권리 확인된 편곡자 자료만 사용한다.

## 18.7 사람 평가 규모

- 평가자 5명 이상
- 현대 찬양 보컬 편곡 경험자 3명 이상
- sealed song 12곡 이상
- 익명 excerpt 20–24개
- 4/4와 6/8 포함
- 장조와 단조 포함
- 2명·3명 보컬 포함
- 순서 무작위
- 동일 음색
- 동일 accompaniment
- 음량 normalization

## 18.8 집계

Primary:

- 곡별 동일 가중 macro

Secondary:

- event·phrase micro

보고:

- evaluator pairwise agreement
- 다평가자 일치도
- 곡별 결과
- 전체 평균
- baseline hard violations
- 실패 사례

단일 총점 하나로 압축하지 않는다.

## 18.9 Threshold calibration

```text
1. Grammar fixture 준비
2. Dev corpus 준비
3. metric 구현
4. Dev report 생성
5. threshold calibration
6. threshold freeze commit
7. sealed holdout 공식 실행
8. 결과 이후 threshold 변경 금지
```

## 18.10 Holdout 사용 프로토콜

- 공식 실행 전 change proposal ID 필수
- proposal에는 변경 파일·예상 영향·보려는 metric group 기록
- 최초 실패 후 기본 공개는 metric-group aggregate만
- 곡별·phrase별 결과를 열면 해당 holdout 즉시 전량 퇴역
- item-level 결과를 보지 않은 aggregate-only 실패에 한해 governance가 1회 재사용 승인 가능
- 재사용 승인도 새 preregistered proposal 필요
- 고정된 “최대 3회” 정책은 사용하지 않음

## 18.11 Review gate

```text
openBlockingReviewFindingCount = 0
```

Accepted risk waiver는 다음을 기록한다.

```ts
interface RiskWaiver {
  readonly id: string;
  readonly findingId: string;
  readonly rationale: string;
  readonly owner: string;
  readonly expiresAt: string;
}
```

만료 waiver는 open finding으로 되돌린다.

## 18.12 Exploratory pilot

### Step 4

- 리더 3명 이상
- Quick Review와 Intent Plan 이해 여부
- 설정 중앙값 3분 이하 목표

### Step 5

- Activity/Rhythm preview
- 동음 리듬 인상 개선
- Simple의 쉬움 확인

### Step 6

- 6곡 이상
- 리더 3명 이상
- usable / light edit / unusable

탐색 pilot 결과는 sealed field gate가 아니다.

## 18.13 Product Core sealed field gate

최소 표본:

- 찬양 리더 5명 이상
- 서로 다른 팀 5개 이상
- 실제 곡 20곡 이상
- 리더 한 명의 동일 곡 과다 반복 금지
- 4/4·6/8 포함
- 장조·단조 포함

Gate:

- `usableAsIsOrLightEditRate >= 70%`
- `medianArrangementCorrectionTime <= 10분`
- `shareCompletionRate >= 70%`
- `reuseIntentRate >= 60%`
- `userEditsPer100GeneratedNotes`는 exploratory pilot 뒤 freeze한 기준 이하

보고서만 만들었다고 통과하지 않는다.


---


# 19. 편집·Materialization·저장·PracticeShare

## 19.1 Plan mutation과 Output edit 분리

Plan mutation은 다음 stage lock을 만들거나 변경한다.

```text
texture / placement role 변경
→ IntentLock
→ Intent부터 downstream regeneration

activity 변경
→ ActivityLock
→ Activity부터 downstream regeneration

anchor directive 변경
→ AnchorLock
→ Anchor부터 downstream regeneration

재생성 후 특정 pitch 고정
→ SolverLock
→ Generation regeneration
```

`replace-texture`를 Output edit로 저장하지 않는다. `lock-event`라는 모호한 edit도 Core에서 사용하지 않는다.

## 19.2 Output edit

```ts
interface ArrangementOutputEditBase {
  readonly id: string;
  readonly presetId: ArrangementPresetId;
  readonly baseCandidateId: string;
  readonly baseCandidateDigest: SemanticDigest;
  readonly editOrdinal: number;
}

type ReplacementGeneratedEventPayload =
  | {
      readonly kind: "note";
      readonly pitch: SpelledPitch;
      readonly tieStart: boolean;
      readonly tieStop: boolean;
    }
  | {
      readonly kind: "rest";
    };

type ArrangementOutputEdit =
  | (ArrangementOutputEditBase & {
      readonly kind: "replace-pitch";
      readonly eventId: string;
      readonly pitch: SpelledPitch;
    })
  | (ArrangementOutputEditBase & {
      readonly kind: "replace-event";
      readonly oldEventId: string;
      readonly replacement: ReplacementGeneratedEventPayload;
    })
  | (ArrangementOutputEditBase & {
      readonly kind: "set-tie";
      readonly eventId: string;
      readonly tieStart: boolean;
      readonly tieStop: boolean;
    });
```

- edit는 정확한 base candidate와 digest에 묶인다.
- 다른 candidate로 자동 이식하지 않는다.
- target event가 없거나 digest가 다르면 `EDIT_BASE_CANDIDATE_STALE`.
- edit 적용 순서는 `editOrdinal → id`.
- replacement payload에는 ID·trackPlanId·source를 받지 않는다.
- Core의 `replace-event`는 old event와 같은 MusicalRange의 note/rest 1:1 교체만 허용하고 기존 event ID·track authority·range를 유지한다.
- note→note는 기존 lyric token association을 유지한다. rest→note의 lyric은 같은 range의 Lead/phrase lyric policy에서 materializer가 결정하며 edit payload가 임의 lyric ID를 공급하지 않는다.
- materializer가 생성한 replacement note의 source는 `user-edit`이며 원래 `originDirectiveId`는 provenance로 유지할 수 있다.
- `replace-pitch`는 range·duration을 바꾸지 않는다.
- `set-tie`는 인접 note range·pitch·occurrence 경계를 검증한다. 불일치하면 materialization blocked.
- duration·attack·release·event split/merge/insert/delete 변경은 Output edit가 아니라 ActivityLock/AnchorLock을 통한 Plan mutation과 downstream regeneration이다.

## 19.3 EditedArrangementSnapshot

```ts
interface EditedArrangementSnapshot {
  readonly id: string;
  readonly materializerVersion: string;
  readonly validatorVersion: string;
  readonly validatorConfigDigest: SemanticDigest;
  readonly metricsVersion: string;
  readonly metricConfigDigest: SemanticDigest;
  readonly diagnosticRegistryVersion: string;
  readonly diagnosticRegistryDigest: SemanticDigest;
  readonly effectiveChordTimelineDigest: SemanticDigest;
  readonly sourceLeadAtomizationDigest: SemanticDigest;
  readonly presetId: ArrangementPresetId;
  readonly baseCandidateId: string;
  readonly baseCandidateDigest: SemanticDigest;
  readonly appliedEditIds: readonly string[];
  readonly appliedEditSetDigest: SemanticDigest;
  readonly generatedHarmonyTracks: readonly GeneratedHarmonyTrack[];
  readonly realizedAnchors: readonly RealizedHarmonyAnchor[];
  readonly metrics: FullSongMetrics;
  readonly validationDiagnostics: readonly Diagnostic[];
  readonly status: "valid" | "invalid";
  readonly contentDigest: SemanticDigest;
}

type EditMaterializationResult =
  | {
      readonly status: "complete";
      readonly snapshot: EditedArrangementSnapshot;
    }
  | {
      readonly status: "blocked";
      readonly diagnostics: readonly Diagnostic[];
    };

interface EditMaterializationInput {
  readonly materializerVersion: string;
  readonly validatorVersion: string;
  readonly validatorConfigDigest: SemanticDigest;
  readonly metricsVersion: string;
  readonly metricConfigDigest: SemanticDigest;
  readonly diagnosticRegistryVersion: string;
  readonly diagnosticRegistryDigest: SemanticDigest;
  readonly source: SongSourceDocument;
  readonly sourceLeadAtomization: SourceLeadAtomization;
  readonly effectiveChordTimeline: EffectiveChordTimeline;
  readonly candidate: ArrangementCandidate;
  readonly edits: readonly ArrangementOutputEdit[];
}

declare function materializeEditedArrangement(
  input: EditMaterializationInput,
): EditMaterializationResult;
```

- base candidate digest mismatch, missing target, duplicate edit ordinal, stale source/timeline/atomization, 잘못된 track이면 `blocked`이며 snapshot을 만들지 않는다.
- 모든 edit가 구조적으로 적용된 뒤 independent Validator와 metrics를 다시 실행한다.
- 적용은 성공했지만 음악 hard validation이 실패하면 `complete` + `snapshot.status="invalid"`다.
- invalid snapshot은 저장·비교는 가능하지만 share·export 기본 대상이 될 수 없다.
- Candidate의 원래 contentDigest·metrics는 변경하지 않는다.
- realized anchor는 output edit가 pitch를 바꾼 anchor-origin event이면 같은 directiveId로 새 pitch를 반영하고, anchor provenance를 잃을 수 있는 edit는 materialization을 차단한다.
- Snapshot content digest는 Section 16.10의 versioned semantic projection을 사용한다.
- PracticeShare·MusicXML export는 `ActiveArrangementRef`가 가리키는 Candidate 또는 valid snapshot을 materialize한 결과를 사용한다.

## 19.4 Compact performance measure

```ts
type CompactFraction = readonly [n: number, d: number];
type CompactPitch = readonly [step: Step, alter: Alter, octave: number];

interface CompactMeasureOccurrence {
  readonly index: number;
  readonly sourceMeasureNumber?: number;
  readonly lyricVerseIndex: number;
  readonly timeSignature: readonly [numerator: number, denominator: 4 | 8];
  readonly duration: CompactFraction;
}
```

`index`는 payload-local 0-based canonical occurrence identity이며 events·chords가 참조한다. source의 임의 occurrence ID를 payload에 복제하지 않는다. decode 시 Core meter의 beatGroups는 `4/4 → [1,1,1,1]`, `6/8 → [3,3]`으로 결정적으로 파생한다.

## 19.5 Compact event

```ts
interface CompactNoteEvent {
  readonly kind: "note";
  readonly occurrenceIndex: number;
  readonly offset: CompactFraction;
  readonly duration: CompactFraction;
  readonly pitch: CompactPitch;
  readonly tieStart?: true;
  readonly tieStop?: true;
  readonly lyricTokenIds?: readonly string[];
}

interface CompactRestEvent {
  readonly kind: "rest";
  readonly occurrenceIndex: number;
  readonly offset: CompactFraction;
  readonly duration: CompactFraction;
}

type CompactVocalEvent = CompactNoteEvent | CompactRestEvent;

interface CompactTrack {
  readonly kind: "source-lead" | "generated-harmony";
  readonly label: string;
  readonly events: readonly CompactVocalEvent[];
}
```

Source Lead는 PracticeShare에 반드시 포함한다.

## 19.6 Compact chord·lyric

```ts
type CompactChord =
  | {
      readonly kind: "chord";
      readonly startOccurrenceIndex: number;
      readonly startOffset: CompactFraction;
      readonly endOccurrenceIndex: number;
      readonly endOffset: CompactFraction;
      readonly symbol: string;
    }
  | {
      readonly kind: "no-chord";
      readonly startOccurrenceIndex: number;
      readonly startOffset: CompactFraction;
      readonly endOccurrenceIndex: number;
      readonly endOffset: CompactFraction;
    };

interface CompactLyricToken {
  readonly id: string;
  readonly text: string;
  readonly verse: number;
  readonly syllabic: LyricToken["syllabic"];
  readonly extend: boolean;
}
```

- `CompactChord`는 EffectiveChordTimeline의 명시적인 `[start,end)` span을 그대로 투영한다.
- `CompactLyricToken.id`는 payload-local canonical lyric ordinal에서 생성하며 source entity ID 문자열을 그대로 복제하지 않는다.
- timeline이 덮지 않는 구간은 chord entry 자체가 없으며 `no-chord`와 구분된다.
- 명시적 N.C.만 `kind="no-chord"`로 encode한다.
- decode는 다음 chord까지 암묵 연장하지 않는다.

## 19.7 PracticeSharePayload

```ts
interface CompactArrangement {
  readonly measures: readonly CompactMeasureOccurrence[];
  readonly tracks: readonly CompactTrack[];
}

interface PracticeSettings {
  readonly selectedTrackIndex?: number;
  readonly speedPercent?: 50 | 75 | 100 | 125 | 150;
  readonly accompanimentEnabled?: boolean;
}

interface PracticeSharePayload {
  readonly schemaVersion: 3;
  readonly title: string;
  readonly tempo: TempoSpec;
  readonly key: KeySignature;
  readonly presetId: ArrangementPresetId;
  readonly arrangementArtifactDigest: SemanticDigest;
  readonly effectiveChordTimelineDigest: SemanticDigest;
  readonly arrangement: CompactArrangement;
  readonly lyrics: readonly CompactLyricToken[];
  readonly chords?: readonly CompactChord[];
  readonly playbackDefaults?: PracticeSettings;
  readonly rightsShareConfirmed: true;
}
```

제외:

- import history
- 다른 variants·candidates
- planner trace
- detailed diagnostics
- OMR evidence
- locks
- evaluator metadata
- 필요 없는 performer display name

## 19.8 Round-trip gate

다음이 완전히 복원되어야 한다.

- measure count·duration
- 4/4·6/8
- source lead
- materialized generated tracks
- chord occurrence
- barline 위치
- lyric ID·verse·syllabic 연결
- repeat-expanded occurrence identity

```text
canonicalPracticePayload(decode(encode(payload)))
===
canonicalPracticePayload(payload)
```

URL 길이 probe는 round-trip이 통과한 payload에만 수행한다.

## 19.9 URL hash policy

- canonical compact JSON 또는 versioned binary
- compression
- base64url
- runtime schema validation
- 최대 encoded payload 6000 bytes

필수 fixture:

```text
8마디 / 3트랙 / 가사
32마디 / 3트랙 / 가사
64마디 / 3트랙 / 가사
```

대상:

- iPhone Safari
- Kakao in-app
- Chrome desktop

하나라도 6000 bytes 초과 또는 open·round-trip 실패면 ShareStore 사용.

## 19.10 Read-only ShareStore

```ts
interface ShareStoreRecord {
  readonly opaqueTokenHash: string;
  readonly payloadDigest: SemanticDigest;
  readonly encryptedPayload: Uint8Array;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly rightsBasis: RightsBasis;
}
```

정책:

- 128-bit 이상 opaque token
- read-only
- 검색·목록화 없음
- 기본 만료 180일
- owner delete secret
- abuse report·takedown 경로
- rate limit
- payload size 상한
- OMR 원본 저장 금지

---

# 20. OMR Application Service와 Vendor Adapter

## 20.1 책임 분리

```text
OmrApplicationService
- public signed handle
- ownership
- CSRF
- quota
- idempotency
- retention orchestration
- rights / consent

OmrVendorAdapter
- Vendor raw job ID
- Vendor API 호출
- Vendor status 변환
- Vendor evidence / export / delete
```

Vendor raw job ID는 클라이언트에 노출하지 않는다.

## 20.2 Input source

```ts
type InputSourceKind =
  | "musicxml"
  | "mxl"
  | "digital-pdf"
  | "scanned-pdf"
  | "camera-photo";
```

MusicXML/MXL은 OMR Provider를 거치지 않는다.

## 20.3 Image quality

```ts
interface ImageQualityReport {
  readonly blurBp: BasisPoints;
  readonly perspectiveBp: BasisPoints;
  readonly glareBp: BasisPoints;
  readonly cropRiskBp: BasisPoints;
  readonly estimatedStaffSpacePixels?: number;
  readonly status: "pass" | "warn" | "retake";
  readonly reasons: readonly string[];
}
```

초기 heuristic:

- `<12px`: retake
- `12–17px`: warn
- `>=18px`: pass 후보

Dev corpus 뒤 calibration한다.

## 20.4 Vendor capability

```ts
type EvidenceGranularity =
  | "none"
  | "page"
  | "staff"
  | "measure"
  | "symbol";

interface OmrVendorCapabilities {
  readonly vendorId: string;
  readonly supportedMimeTypes: readonly string[];
  readonly maxPages: number;
  readonly evidenceGranularity: EvidenceGranularity;
  readonly supportsDeletion: boolean;
  readonly retentionDisclosure: boolean;
  readonly supportsIdempotency: boolean;
  readonly supportsInteractiveInput: boolean;
  readonly estimatedCreditPerPage?: number;
}
```

Core Vendor 채택 조건:

- MusicXML export
- job status
- retention disclosure
- delete 또는 허용 가능한 자동 만료
- page 순서 보존
- 최소 page evidence

## 20.5 Vendor status·interactive input

```ts
type VendorInputRequest =
  | {
      readonly kind: "select-instrument";
      readonly requestId: string;
      readonly choices: readonly string[];
    }
  | {
      readonly kind: "confirm-page-order";
      readonly requestId: string;
      readonly pageIndices: readonly number[];
    }
  | {
      readonly kind: "vendor-specific";
      readonly requestId: string;
      readonly schemaId: string;
      readonly payload: Readonly<Record<string, string | number | boolean>>;
    };

type VendorInputResponse =
  | {
      readonly kind: "select-instrument";
      readonly requestId: string;
      readonly choice: string;
    }
  | {
      readonly kind: "confirm-page-order";
      readonly requestId: string;
      readonly pageIndices: readonly number[];
    }
  | {
      readonly kind: "vendor-specific";
      readonly requestId: string;
      readonly schemaId: string;
      readonly payload: Readonly<Record<string, string | number | boolean>>;
    };

type VendorOmrStatus =
  | { readonly kind: "created" }
  | { readonly kind: "queued" }
  | { readonly kind: "processing"; readonly progressBp?: BasisPoints }
  | { readonly kind: "needs-input"; readonly request: VendorInputRequest }
  | { readonly kind: "completed" }
  | { readonly kind: "failed"; readonly code: string; readonly message: string }
  | { readonly kind: "cancelled" }
  | { readonly kind: "unknown"; readonly rawStatus: string };
```

## 20.6 Vendor Adapter

```ts
type VendorJobId = string & { readonly __brand: "VendorJobId" };

interface OmrPageUpload {
  readonly pageIndex: number;
  readonly pageDigest: BinaryDigest;
  readonly mimeType: string;
  readonly idempotencyKey: string;
  readonly bytes: Blob;
}

interface RetentionInfo {
  readonly vendorDeletesAt?: string;
  readonly canDeleteImmediately: boolean;
  readonly policyReference?: string;
}

type VendorDeleteResult =
  | { readonly status: "deleted" }
  | { readonly status: "not-supported"; readonly retentionInfo: RetentionInfo }
  | { readonly status: "failed"; readonly code: string; readonly message: string };

type OmrDeleteResult = {
  readonly localHandleDeleted: boolean;
  readonly vendor: VendorDeleteResult;
};

interface OmrVendorAdapter {
  getCapabilities(): Promise<OmrVendorCapabilities>;

  createVendorJob(request: {
    readonly pageCount: number;
    readonly idempotencyKey: string;
  }): Promise<VendorJobId>;

  uploadPage(
    vendorJobId: VendorJobId,
    page: OmrPageUpload,
  ): Promise<void>;

  startVendorJob(vendorJobId: VendorJobId): Promise<void>;

  getVendorStatus(vendorJobId: VendorJobId): Promise<VendorOmrStatus>;

  submitVendorInput?(
    vendorJobId: VendorJobId,
    input: VendorInputResponse,
  ): Promise<void>;

  exportMusicXml(vendorJobId: VendorJobId): Promise<string>;

  getEvidence(
    vendorJobId: VendorJobId,
  ): Promise<VendorEvidenceBundle>;

  cancelVendorJob(vendorJobId: VendorJobId): Promise<void>;

  deleteVendorJob(vendorJobId: VendorJobId): Promise<VendorDeleteResult>;

  getRetentionInfo(vendorJobId: VendorJobId): Promise<RetentionInfo>;
}
```

`supportsInteractiveInput=true`이면 `submitVendorInput` 구현 필수.
`evidenceGranularity != "none"`이면 `getEvidence`는 capability와 일치하는 bundle을 반환해야 한다.
`supportsDeletion=false`이면 `deleteVendorJob`은 `not-supported`와 retention info를 정직하게 반환한다.

## 20.7 Application Service

```ts
type OmrJobHandle = string & { readonly __brand: "OmrJobHandle" };

interface OmrProviderResult {
  readonly vendorId: string;
  readonly vendorResultDigest: BinaryDigest;
  readonly rawMusicXml: string;
  readonly evidence: VendorEvidenceBundle;
  readonly retentionInfo: RetentionInfo;
}

type OmrPublicStatus =
  | { readonly kind: "created" }
  | {
      readonly kind: "uploading";
      readonly uploadedPages: number;
      readonly totalPages: number;
    }
  | { readonly kind: "queued" }
  | { readonly kind: "processing"; readonly progressBp?: BasisPoints }
  | { readonly kind: "needs-input"; readonly inputRequest: VendorInputRequest }
  | { readonly kind: "completed" }
  | { readonly kind: "failed"; readonly code: string; readonly messageKo: string }
  | { readonly kind: "cancelled" };

interface OmrApplicationService {
  createJob(request: {
    readonly sessionId: string;
    readonly pageCount: number;
    readonly rights: RightsMetadata;
    readonly providerTransferConsent: true;
    readonly idempotencyKey: string;
  }): Promise<OmrJobHandle>;

  uploadPage(
    handle: OmrJobHandle,
    page: OmrPageUpload,
  ): Promise<void>;

  start(handle: OmrJobHandle): Promise<void>;

  getStatus(handle: OmrJobHandle): Promise<OmrPublicStatus>;

  submitInput(
    handle: OmrJobHandle,
    input: VendorInputResponse,
  ): Promise<void>;

  exportResult(handle: OmrJobHandle): Promise<OmrProviderResult>;

  cancel(handle: OmrJobHandle): Promise<void>;

  delete(handle: OmrJobHandle): Promise<OmrDeleteResult>;
}
```

Core completed result 불변식:

- Core Vendor는 최소 page evidence capability를 가져야 한다.
- `exportResult()`가 성공하면 evidence는 필수다.
- evidence granularity는 job 시작 시 확인한 capability보다 낮을 수 없다.
- evidence가 누락되면 completed를 성공 반환하지 않고 `OMR_PROVIDER_CAPABILITY_MISSING`으로 실패한다.

Application Service 책임:

- signed opaque handle
- session ownership
- expiry·nonce
- CSRF
- quota
- idempotency mapping
- VendorJobId 보호
- retention orchestration
- audit log

## 20.8 Quota와 비용 방어

```ts
interface OmrQuotaConfig {
  readonly maxPagesPerJob: number;
  readonly maxConcurrentJobsPerSession: number;
  readonly maxConcurrentJobsPerIp: number;
  readonly maxJobsPerSessionPerHour: number;
  readonly maxJobsPerIpPerHour: number;
  readonly maxRetriesPerPage: number;
  readonly dailyGlobalCreditCeiling: number;
}

const CORE_OMR_QUOTA_DEFAULTS = {
  maxPagesPerJob: 12,
  maxConcurrentJobsPerSession: 1,
  maxConcurrentJobsPerIp: 2,
  maxJobsPerSessionPerHour: 3,
  maxJobsPerIpPerHour: 5,
  maxRetriesPerPage: 2,
} as const;
```

- 실제 job page cap은 `min(vendorCapabilities.maxPages, quota.maxPagesPerJob)`이다.
- `dailyGlobalCreditCeiling`은 배포 환경에서 양의 값 필수
- 초과 시 Vendor 호출 금지
- duplicate page digest + idempotency key는 재과금 방지
- abuse event 기록

---

# 21. OMR Evidence·좌표·Correction·Review History


## 21.1 Evidence frame·transform·target mapping

Evidence graph는 generation semantic digest와 분리되지만 자기 bundle/archive digest를 만들기 위해 동일한 integer-only canonical codec을 사용한다.

```ts
type CoordinateSpace =
  | "original-pixels"
  | "normalized-original"
  | "processed-pixels";

type CoordinateMicrounit = number & {
  readonly __brand: "CoordinateMicrounit";
};

type MatrixCoefficientNanounit = number & {
  readonly __brand: "MatrixCoefficientNanounit";
};

const EVIDENCE_COORDINATE_SCALE = 1_000_000 as const;
const EVIDENCE_MATRIX_SCALE = 1_000_000_000 as const;

interface ImageCoordinateFrame {
  readonly id: string;
  readonly pageIndex: number;
  readonly coordinateSpace: CoordinateSpace;
  readonly widthPixels: number;
  readonly heightPixels: number;
  readonly imageDigest: BinaryDigest;
}

interface BoundingBox {
  readonly frameId: string;
  readonly xMu: CoordinateMicrounit;
  readonly yMu: CoordinateMicrounit;
  readonly widthMu: CoordinateMicrounit;
  readonly heightMu: CoordinateMicrounit;
}

interface ImageTransform {
  readonly id: string;
  readonly pageIndex: number;
  readonly sourceFrameId: string;
  readonly targetFrameId: string;
  readonly matrix3x3Nano: readonly MatrixCoefficientNanounit[];
  readonly inverseMatrix3x3Nano?: readonly MatrixCoefficientNanounit[];
}

interface OmrEvidence {
  readonly id: string;
  readonly vendorTargetId?: string;
  readonly granularity: EvidenceGranularity;
  readonly box: BoundingBox;
  readonly transformId?: string;
  readonly confidenceBp?: BasisPoints;
  readonly vendorId: string;
}

interface EvidenceTargetMapping {
  readonly vendorTargetId: string;
  readonly target: RevisionScopedTarget;
}

interface VendorEvidenceBundle {
  readonly granularity: EvidenceGranularity;
  readonly frames: readonly ImageCoordinateFrame[];
  readonly transforms: readonly ImageTransform[];
  readonly evidence: readonly OmrEvidence[];
  readonly providerBundleDigest: SemanticDigest;
}

interface OmrEvidenceArchive {
  readonly sourceRevision: SourceRevisionRef;
  readonly providerBundleDigest: SemanticDigest;
  readonly frames: readonly ImageCoordinateFrame[];
  readonly transforms: readonly ImageTransform[];
  readonly unmappedEvidence: readonly OmrEvidence[];
  readonly archiveDigest: SemanticDigest;
}

interface EvidenceMappingInput {
  readonly sourceRevision: SourceRevisionRef;
  readonly mappingVersion: string;
  readonly vendorBundle: VendorEvidenceBundle;
  readonly targetMappings: readonly EvidenceTargetMapping[];
}

interface EvidenceMappingResult {
  readonly index: SourceEvidenceIndex;
  readonly archive: OmrEvidenceArchive;
  readonly diagnostics: readonly Diagnostic[];
}

interface SourceEvidenceIndex {
  readonly sourceRevision: SourceRevisionRef;
  readonly mappingVersion: string;
  readonly providerBundleDigest: SemanticDigest;
  readonly frames: readonly ImageCoordinateFrame[];
  readonly transforms: readonly ImageTransform[];
  readonly evidence: readonly OmrEvidence[];
  readonly targetMappings: readonly EvidenceTargetMapping[];
  readonly bundleDigest: SemanticDigest;
}


declare function mapVendorEvidenceToSource(
  input: EvidenceMappingInput,
): EvidenceMappingResult;

declare function indexEvidenceByRevisionScopedTarget(
  index: SourceEvidenceIndex,
): Readonly<Record<string, readonly OmrEvidence[]>>;
```

Evidence digest projection 정본:

```text
VendorEvidenceBundle.providerBundleDigest
projectionSchema = hm-vendor-evidence-bundle-v1
포함:
- granularity
- frame payload(page, coordinate space, dimensions, full image BinaryDigest)
- transform payload(source/target frame canonical ordinal, fixed-point matrix/inverse)
- evidence payload(vendor ID, vendor target ID 또는 null, granularity, frame/box, transform ordinal 또는 null, confidence)
제외:
- frame/transform/evidence ID 문자열
- providerBundleDigest 자체

SourceEvidenceIndex.bundleDigest
projectionSchema = hm-source-evidence-index-v1
포함:
- sourceRevision
- mappingVersion
- providerBundleDigest
- mapped evidence canonical payload
- vendor target → revision-scoped canonical target mapping
제외:
- bundleDigest 자체
- 파생 `indexEvidenceByRevisionScopedTarget()` cache

OmrEvidenceArchive.archiveDigest
projectionSchema = hm-omr-evidence-archive-v1
포함:
- sourceRevision
- providerBundleDigest
- frames/transforms
- unmapped evidence canonical payload
제외:
- archiveDigest 자체
```

- 모든 set-like 배열은 page → frame → transform/evidence canonical order로 정렬한다.
- Vendor가 부여한 임의 배열 순서는 digest에 영향을 주지 않는다.
- mapping 결과의 `SourceEvidenceIndex.providerBundleDigest`는 입력 bundle과 exact equal해야 한다.

Fixed-point 정본:

- original-pixels·processed-pixels 좌표에서 `1 pixel = 1_000_000 CoordinateMicrounit`.
- normalized-original 좌표에서 전체 축의 `1.0 = 1_000_000 CoordinateMicrounit`.
- vendor finite number를 저장할 때 absolute value에 decimal round-half-up을 적용한 뒤 부호를 복원한다.
- matrix coefficient는 `1.0 = 1_000_000_000 MatrixCoefficientNanounit`.
- homography는 quantize 전에 `m[8] = 1`이 되도록 normalize한다. `m[8]`이 0 또는 안전 임계값 미만이면 evidence를 차단한다.
- 모든 저장값은 safe integer여야 한다.
- Node·browser가 같은 fixture를 같은 integer projection·SHA-256 digest로 만들어야 한다.
- 일반 float matrix·normalized float box를 canonical codec에 직접 넣지 않는다.

불변식:

- `BoundingBox.frameId`는 bundle의 frame을 참조한다.
- pixel-space box는 frame의 pixel bounds×coordinate scale 안에 있어야 한다.
- normalized-original box는 각 축에서 0..1_000_000 범위다.
- processed-pixels frame의 evidence는 original-pixels 또는 normalized-original frame까지 이어지는 transform path가 필요하다.
- `transformId`가 있으면 evidence frame을 sourceFrame으로 갖는 transform을 참조한다.
- inverse matrix가 없으면 역변환을 수치적으로 안전하게 만들 수 있는 별도 verified path가 필요하다.
- `EvidenceTargetMapping`이 vendor target→revision-scoped canonical target의 유일한 권위다. `OmrEvidence`는 canonical target을 중복 저장하지 않는다.
- `SourceEvidenceIndex.sourceRevision`은 모든 mapping target의 source revision과 exact equal해야 한다.
- `SourceEvidenceIndex.evidence`에는 targetMappings로 canonical target에 연결된 evidence만 들어간다. 나머지는 archive로 간다.
- 모든 mapping.vendorTargetId는 Vendor bundle에 존재하고 고유해야 한다.
- `indexEvidenceByRevisionScopedTarget()`은 파생 cache/view이며 canonical 저장 권위가 아니다.
- mappingVersion과 bundleDigest는 동일 evidence graph의 재개·감사를 고정한다.
- mapping되지 않은 vendor evidence는 `ImportInfo.omrEvidenceArchive`에 보존한다.
- source structural edit 후 mapping을 안전하게 remap할 수 없는 evidence와 기존 mapping은 evidence ID를 유지한 채 archive로 이동하며 Review history에서 계속 해석 가능해야 한다.
- review item의 evidence ID는 SourceEvidenceIndex 또는 OmrEvidenceArchive 중 정확히 한 곳에 존재해야 한다.
- processed evidence의 원본 overlay path가 없으면 `OMR_EVIDENCE_TRANSFORM_MISSING`.
- fixed-point projection·digest 실패는 `OMR_EVIDENCE_CODEC_FAILED`.

Fallback:

- measure 이상 → 원본 measure와 digital measure 연결
- staff → 원본 staff crop까지만 보장
- page → page preview까지만 보장
- 존재하지 않는 measure box를 만들어내지 않음
- 자체 measure alignment는 OMR Advanced

## 21.2 Coordinate 변환 정본

- pageIndex는 0-based.
- original-pixels frame은 업로드 원본 page raster 기준.
- normalized-original은 microunit 0..1_000_000 범위.
- processed-pixels frame은 deskew·perspective·crop·resize 후 image 기준.
- rotation·perspective·crop·resize transform을 frame graph로 순서대로 보존.
- overlay 시 fixed-point coefficient를 deterministic decimal로 복원하고 transform graph를 따라 original frame으로 역변환.
- 여러 경로가 존재하면 edge 수가 가장 적은 verified path, 그다음 transform ID canonical order로 tie-break.
- transform graph는 musical semantic digest에서 제외하지만 evidence bundle/archive digest에는 포함한다.

## 21.3 Runtime semantic validation

검사:

- measure duration
- pickup
- voice timeline
- tuplet
- tie
- clef
- key signature
- accidental scope
- octave jump
- chord parse
- selected melody staff
- performance order

이 검사는 “말이 되는지”만 검사하며 원본과 동일함을 증명하지 않는다.

```ts
type RuntimeOmrReadiness =
  | "validator-ready"
  | "review-required"
  | "blocked";
```

## 21.4 Revision-scoped Correction target

```ts
type OmrCorrectionTarget =
  | { readonly kind: "voice-event"; readonly eventId: string }
  | { readonly kind: "chord-event"; readonly chordEventId: string }
  | { readonly kind: "measure"; readonly sourceMeasureId: string }
  | { readonly kind: "measure-start"; readonly sourceMeasureId: string }
  | { readonly kind: "measure-end"; readonly sourceMeasureId: string }
  | { readonly kind: "section-text"; readonly sourceTextId: string };

```

- Review·auto repair·correction record·evidence mapping은 bare target이 아니라 `RevisionScopedTarget`을 저장한다.
- target의 `documentId`, `revisionOrdinal`, `revisionDigest`가 현재 source revision과 exact equal할 때만 직접 적용한다.
- 다른 revision target은 `SourceIdRemap`을 통해서만 현재 target으로 이전할 수 있다.
- remap outcome이 `mapped-many`, `deleted` 또는 `unresolved`이면 자동 적용하지 않는다.

## 21.5 Typed correction patch

```ts
type ReplacementLeadEventPayload =
  | {
      readonly kind: "note";
      readonly onset: Fraction;
      readonly duration: Fraction;
      readonly pitch: SpelledPitch;
      readonly tieStart: boolean;
      readonly tieStop: boolean;
    }
  | {
      readonly kind: "rest";
      readonly onset: Fraction;
      readonly duration: Fraction;
    };

type OmrCorrectionPatch =
  | { readonly kind: "pitch"; readonly pitch: SpelledPitch }
  | { readonly kind: "duration"; readonly duration: Fraction }
  | { readonly kind: "accidental"; readonly alter: Alter }
  | { readonly kind: "chord"; readonly parseResult: ResolvedChordParseResult }
  | { readonly kind: "time-signature"; readonly value: TimeSignature }
  | { readonly kind: "key-signature"; readonly value: KeySignature }
  | {
      readonly kind: "tie";
      readonly tieStart: boolean;
      readonly tieStop: boolean;
    }
  | {
      readonly kind: "replace-event";
      readonly event: ReplacementLeadEventPayload;
    }
  | {
      readonly kind: "replace-source-text";
      readonly text: string;
    }
  | {
      readonly kind: "insert-barline" | "delete-barline";
    };
```

note/rest 전환은 `replace-event`로 전체 replacement한다.

Patch target compatibility:

- pitch/duration/accidental/tie/replace-event → voice-event
- chord → chord-event
- time/key signature → measure-start
- barline → measure-end
- replace-source-text → section-text
- 호환되지 않는 target·patch 조합은 reducer가 거부
- replacement event의 ID·sourceMeasureId는 target authority를 유지하며 patch 입력값을 그대로 신뢰하지 않음
- lyric association은 기존 target event와 source lyric alignment에서 보존·재계산하며 OMR replacement payload가 임의 lyric ID를 공급하지 않음

## 21.6 Review item

```ts
interface OmrReviewAlternative {
  readonly id: string;
  readonly labelKo: string;
  readonly patch: OmrCorrectionPatch;
  readonly confidenceBp?: BasisPoints;
}

type OmrReviewResolution =
  | { readonly status: "open" }
  | {
      readonly status: "accepted";
      readonly selectedAlternativeId: string;
      readonly correctionRecordId: string;
    }
  | {
      readonly status: "rejected";
      readonly rejectedAlternativeIds: readonly string[];
    }
  | {
      readonly status: "manually-corrected";
      readonly correctionRecordId: string;
    };

interface OmrReviewItem {
  readonly id: string;
  readonly target: RevisionScopedTarget;
  readonly reasonCode: DiagnosticCode;
  readonly alternatives: readonly OmrReviewAlternative[];
  readonly evidenceIds: readonly string[];
  readonly resolution: OmrReviewResolution;
}
```

불변식:

- alternative ID는 review item 안에서 고유하고 deterministic.
- accepted.selectedAlternativeId는 같은 item의 alternative를 참조.
- accepted.correctionRecordId는 같은 reviewItemId를 가진 correction record를 참조.
- accepted correction patch는 선택한 alternative patch와 semantic equal.
- manually-corrected correction record의 source는 `manual`.
- rejectedAlternativeIds는 같은 item의 alternative ID 집합이며 중복 금지.
- 위 참조가 깨지면 `OMR_REVIEW_RESOLUTION_INVALID`.

## 21.7 Repair history

```ts
type OmrAutoRepairResolution =
  | { readonly status: "pending" }
  | { readonly status: "accepted"; readonly correctionRecordId: string }
  | { readonly status: "rejected" };

interface OmrAutoRepairProposal {
  readonly id: string;
  readonly target: RevisionScopedTarget;
  readonly originalProjection: string;
  readonly patch: OmrCorrectionPatch;
  readonly reason:
    | "MEASURE_DURATION"
    | "TIE_PITCH"
    | "CHORD_GRAMMAR"
    | "ACCIDENTAL_CONTEXT"
    | "VOICE_TIMELINE";
  readonly confidence: "high" | "medium" | "low";
  readonly resolution: OmrAutoRepairResolution;
}

interface OmrCorrectionRecord {
  readonly id: string;
  readonly reviewItemId?: string;
  readonly autoRepairProposalId?: string;
  readonly target: RevisionScopedTarget;
  readonly beforeProjection: string;
  readonly patch: OmrCorrectionPatch;
  readonly source: "auto-accepted" | "review-alternative" | "manual";
  readonly appliedAt: string;
}

interface OmrReviewRecord {
  readonly vendorResultDigest: BinaryDigest;
  readonly vendorId: string;
  readonly autoRepairs: readonly OmrAutoRepairProposal[];
  readonly corrections: readonly OmrCorrectionRecord[];
  readonly reviewItems: readonly OmrReviewItem[];
}
```

`SongSourceDocument.importInfo.omrReviewRecord`에 저장한다.

정본:

- accepted auto repair는 `autoRepairProposalId`로 correction record와 연결.
- `OmrAutoRepairProposal.id`는 Section 4.2의 revision-target/reason/patch-order 정본을 따르며 임의 UUID를 사용하지 않는다.
- accepted review alternative는 `reviewItemId`와 resolution.correctionRecordId로 연결.
- 한 correction record는 최대 하나의 review item과 최대 하나의 auto repair proposal을 참조.
- 같은 target에 여러 correction이 있으면 canonical application order와 beforeProjection chain을 검증한다.
- correction 적용 후 새 Source revision과 `SourceIdRemap`을 생성한다.
- ReviewRecord의 target은 적용 당시 revision을 영구 보존하며, current source 위 overlay는 SourceIdRemap chain으로 파생한다.
- 저장·재열기 시 historical target은 revision scope로 해석하고, 현재 source 표시가 필요할 때만 remap을 따라간다.
- remap chain이 끊기면 `STALE_REFERENCE`를 발행하고 과거 기록 자체는 삭제하지 않는다.
- 저장·재열기 후 Vendor 원래 값, 자동 제안, 수락·거절, 선택한 대안, 수동 correction을 복원할 수 있어야 한다.
- evidenceIds는 SourceEvidenceIndex 또는 OmrEvidenceArchive에서 해석 가능해야 한다.


---

# 22. OMR 평가·보안·권리 Gate

## 22.1 Ground truth metric

```text
pitchExactRate
durationExactRate
accidentalExactRate
restExactRate
tieExactRate
keySignatureExactRate
timeSignatureExactRate
chordSymbolExactRate
measureExactMatchRate
```

## 22.2 구조 metric

```text
parseableMusicXmlRate
measureDurationValidRate
voiceTimelineValidRate
runtimeValidatorReadyRate
```

## 22.3 제품 metric

```text
harmonizationReadyRate
medianCorrectionTime
correctionsPer100Notes
retakeRate
abandonmentRate
```

`harmonizationReadyRate`:

> 사용자 수정 전 결과가 수기 ground truth와 비교해, 편곡에 영향을 줄 수 있는 오류가 하나도 없는 페이지 비율.

## 22.4 Corpus

Dev:

- 36페이지 이상

Sealed holdout:

- 24페이지 이상

각 세트:

- digital PDF
- clean scan
- phone photo
- 4/4·6/8
- 장조·단조
- 다양한 임시표·점음표·tie 밀도

분리:

- 같은 곡의 다른 사진이 양쪽에 있으면 안 됨
- 같은 출판 폰트·스캔 장비·촬영 기기·편집 프로그램 편중 방지

## 22.5 Threshold lifecycle

```text
1. Dev 결과
2. metric calibration
3. threshold freeze artifact
4. sealed OMR holdout
5. 이후 threshold 변경 금지
```

정확도·correction time 임계값은 Dev 뒤 freeze한다.

비협상 gate:

- blocking error가 있는 결과의 auto-ready = 0
- review 후 harmonizer input valid = 100%
- repair history preservation = 100%
- Vendor secret·raw job ID client exposure = 0
- ownership bypass = 0
- quota bypass = 0
- Application delete 요청 처리 = 100%
- Vendor delete 미지원·실패 시 truthful retention status 기록 = 100%

## 22.6 Rights·consent

OMR 시작 전에 사용자에게 표시:

- 외부 Vendor 전송 여부
- Vendor 이름
- 보존 기간 또는 정책 reference
- 삭제 가능 여부
- 업로드 권한 확인

`provider-transfer` allowed use와 explicit consent가 없으면 Application Service가 job을 만들지 않는다.

## 22.7 파일 방어

- MIME sniffing
- magic bytes
- 파일 크기
- 페이지 수
- PDF object count
- decompression ratio
- XML XXE
- MXL zip traversal
- SVG script
- image dimension bomb

## 22.8 수정 데이터 학습

기본값 off.

Opt-in일 때만:

- 필요한 crop
- Vendor 출력
- 사용자 correction
- 주변 최소 문맥

저장.

제거:

- 제목
- 작곡가
- 전체 가사
- 불필요한 페이지 영역

---

# 23. 입력·검색·Worker 성능 예산

## 23.1 Core 입력 상한

```ts
interface CoreInputLimits {
  readonly maxSourceMeasures: 160;
  readonly maxPerformanceMeasures: 160;
  readonly maxLeadAtoms: 600;
  readonly maxPhraseRegions: 80;
  readonly maxSectionOccurrences: 32;
  readonly maxResolvedChordSpans: 320;
  readonly maxGeneratedTrackPlans: 2;
  readonly maxLocks: 1_000;
}
```

초과 시 `INPUT_LIMIT_EXCEEDED`.

## 23.2 Generation 예산

versioned `evaluation/performance/reference-device.json`과 production build 기준:

- CPU·browser·OS·power mode 기록
- CI machine과 사용자 기기 수치는 분리 보고
- reference profile 변경 시 성능 threshold 재동결


```text
one preset typical p50 <= 1.5s
three presets typical p50 <= 4.0s
hard wall-clock ceiling <= 8.0s
worker cancel acknowledgement <= 250ms
main-thread blocking chunk <= 50ms
```

- hard ceiling 초과 시 `GEN_TIMEOUT`
- search node budget 초과 시 `GEN_SEARCH_BUDGET_EXHAUSTED`
- 사용자 cancel 시 partial result를 성공으로 위장하지 않음
- Worker는 progress와 cancellation checkpoint 제공

## 23.3 성능 보고

- fixture별 input size
- preset 수
- phrase count
- search node count
- elapsed time
- peak memory 추정
- timeout·cancel 결과

을 기록한다.

---

# 24. 구현 단계와 Gate

## Step 0–1 — 완료

```text
STEP_0_ACCEPTED
STEP_1_ACCEPTED_FOR_V3_FOUNDATION
```

## Step 2 — Canonical Domain Foundation

구현:

- Fraction quarter-note contract
- position canonicalization
- half-open range
- stable semantic ID / ordinal projection
- SpelledPitch
- chord lexical grammar·semantic parser
- SourceMeasure + SourceTextEvent
- Repeat expansion
- SectionOccurrence
- PhraseRegion range-based authority와 Source revision/remap
- Source Lead / Generated Track union
- canonical SourceLeadAtomization ownership·state·lookup
- Source revision identity·SourceIdRemap·revision-scoped target
- Performer assignment
- Project variants + artifact-preserving VariantStaleness
- Plan lifecycle 타입
- section-intensity single authority + section/phrase Grammar interface
- 단계별 Lock union
- EffectiveChordTimeline state·resolver contract
- ArrangementMode discriminated union
- ExtendedBasisPoints
- KeySignature derived fifths·TimeSignature beat-group invariant
- self-contained AnchorLock semantic payload
- Grammar complete/blocked result·non-semantic trace type
- CountRateMetric·DurationRateMetric denominator-zero contract
- canonical digest codec
- diagnostic registry·deterministic Diagnostic ID/projection
- exact candidate content projection·Candidate/Generated ID
- versioned PresetProfileRegistry·EffectiveConfig digest
- AlgorithmVersionRegistry·AlgorithmConfigDigestRegistry·AlgorithmExecutionRegistry
- stage별 planner/grammar/activity/anchor/solver/assembler/validator/metric/Diagnostic config provenance
- stage-specific semantic digests
- preferredTessitura·section semantics digest completeness
- ProductionLyricEmphasis resolver·source/atomization semantic projection completeness
- explicit N.C.-only gap provenance
- PerformanceChordSpan ID·canonical SourceLeadAtomization·TimelineAtom ID closure
- candidate/snapshot realized-anchor preservation
- GenerationResult envelope
- density integration 함수
- rights metadata

금지:

- Grammar 음악 결정표 구현
- Activity 알고리즘
- pitch generation
- OMR Vendor 연동

필수 테스트:

- C7 / Cmaj7 / Cm7 / CmMaj7 / Cdim7 / Cm7b5 tone derivation
- unsupported quality·extension·sus combination rejection
- C6/9 slash precedence
- CM7 / CΔ7 / C-7 / Cø7 / C°7 alias
- C2 / Csus / N.C. / %
- parse failure 원문 보존
- `%` performance-order carry
- quarter-note unit
- measure boundary canonicalization
- event boundary split/tie
- repeat total passes·ending
- section partition
- phraseRegions range-based identity·Source revision/remap stale reference
- Source Lead 복제 없음
- SectionOccurrence가 lyric verse의 유일한 권위이며 PerformanceOccurrence는 이를 중복 저장하지 않음
- preset별 variant provenance
- empty/intent/activity/anchor/generation lifecycle별 허용 staleFrom이 타입으로 제한됨
- blocked 재시도 뒤에도 이전 Plan·Edit·Snapshot·timeline·atomization 보존
- Stage object 부재와 빈 배열 구분
- Grammar blocked result에 fake intent 없음
- Intent Plan에 texture candidate trace ID 없음
- NCT anchor union
- planned-NCT AnchorLock semantic round-trip + LeadAtomReference atomization-digest binding
- Grammar splitDirective 변경에도 SourceLeadAtomization digest·TimelineAtom ID 불변
- Grammar/Activity/Lock 변화가 canonical SourceLeadAtomization을 바꾸지 않음
- Source atomization stale/blocked state와 lookup integrity
- N.C. policy validator와 `allow-no-chord` runtime schema rejection
- carried chord span origin provenance
- KeySignature deriveFifths·raw mismatch block
- beatGroups sum·canonical 4/4·6/8 fixture
- metadata·alias·non-semantic entity ID 변화에도 semantic digest invariance
- canonical JSON byte parity·SHA-256 fixture + BinaryDigest fixture
- Cø/Cø7/C°/C°7 longest-token lexer fixture
- stage lock별 정확한 invalidation + stale artifact/edit/snapshot 보존
- EffectiveChordTimeline single-authority parity
- range·preferredTessitura·section type/variant/confirmation·lyric alignment semantics·stage lock·algorithm version/config·Diagnostic registry·preset profile 변화 시 해당 stage digest 변화
- `suggested + musicxml-accent`와 `suggested + metric-heuristic`의 musicalSourceDigest·SourceLeadAtomization.digest·intentInputDigest 차이
- `confirmed + manual`과 `confirmed + musicxml-accent`가 같은 production 의미일 때 generation semantic digest parity
- `emphasis=none + emphasisSource`, `emphasis=suggested + missing source` runtime schema rejection
- AnchorLock planned-NCT standalone reconstruction: preparation·context·target·resolution·deadline 보존
- explicit N.C. provenance와 자동 N.C. 부재
- CountRateMetric·DurationRateMetric denominator=0
- SectionIntensityTarget이 Section Intent에만 존재하고 Grammar planSection()이 유일 생산자
- candidate projection에서 diagnostic/metrics/trace/ID 제외 및 Candidate/Generated ID parity
- stage artifact가 저장한 config digest와 AlgorithmExecutionRegistry exact-equality
- same version + different config digest와 same config digest + different version의 blocking fixture
- source structural edit 뒤 revision-scoped OMR target remap/history round-trip
- PracticeShare round-trip domain typecheck
- Output replacement payload가 range·lyric ID를 주입할 수 없음
- Vendor evidence bundle과 canonical target mapping 책임 분리

Gate:

```text
openBlockingReviewFindingCount = 0
STEP_2_ACCEPTED / STEP_3_READY
```

Step 3 자동 시작 금지.

## Step 3 — MusicXML Import & Quick Review

구현:

- MusicXML/MXL import
- source normalization
- melody staff/voice 선택
- chord import
- section suggestion
- repeat linearization
- unsupported jump 차단
- Quick Review
- range onboarding
- chord gap + unconfirmed chord review
- rights confirmation

Gate:

- 12개 이상 import fixture
- 4/4·6/8
- 장조·단조
- repeat occurrence
- first/second ending
- malformed XML
- unsafe MXL
- Quick Review blocking item 누락 0
- source semantic round-trip

```text
STEP_3_ACCEPTED
```

Step 4는 Grammar 승인 전까지 blocked.

## Grammar v1 별도 Gate

필요 artifact:

```text
docs/WORSHIP_ARRANGEMENT_GRAMMAR_v1.md
```

Gate:

```text
WORSHIP_ARRANGEMENT_GRAMMAR_V1_ACCEPTED
STEP_4_READY
```

## Step 4 — Arrangement Intent Planner

전제:

- Step 3 accepted
- Grammar v1 accepted

구현:

- PhraseFeatures
- SectionIntensityTarget
- EffectiveArrangementConfig
- AssignedHarmonyTrackContext
- Grammar adapter
- preset별 ArrangementIntentPlan
- plan editor 선택 UI
- Step 4 exploratory pilot

금지:

- Activity span 생성
- Anchor 생성
- pitch generation
- runtime data-pattern retrieval

Gate:

- 같은 입력의 intent plan digest parity
- 모든 reason code 설명 가능
- preset별 variant 독립 provenance
- no eligible result는 blocked union이며 가짜 Intent 없음
- PhraseIntent dangling trace ID 0
- optional grammar trace는 intent digest 비영향
- 리더 3명 plan review
- median Quick Review + plan confirmation <= 3분 목표

```text
STEP_4_ACCEPTED / STEP_5_READY
```

## Step 5 — Activity & Rhythm Planner

구현:

- ArrangementActivityPlan
- VoiceActivitySpan
- VoiceAttackEvent
- Grammar별 rhythm algorithm
- lyric policy
- exact density integration
- fixed-pitch / percussion preview
- Step 5 exploratory pilot

Gate:

- state/event overlap 0
- attack ratio 준수
- lead-derived unison이 Activity 단계의 harmonic divergence로 잘못 집계되지 않음
- pitch-dependent divergence·spread gate는 Step 6에서 수행
- activity lock 적용
- 리더 3명 중 2명 이상이 동음 리듬 인상 개선 확인

```text
STEP_5_ACCEPTED / STEP_6_READY
```

## Step 6 — Anchor·NCT·Pitch Solver·Global Assembler

구현:

- ArrangementAnchorPlan
- Anchor directive union
- NCT
- N.C. policy
- semantic chord importance + hard/comfortable/preferred range track별 chord-tone ranking
- octave candidate
- phrase beam DP
- boundary state
- Section Assembler
- Song Assembler
- ArrangementGenerationResult
- candidate diversity
- performance budget
- 6곡 exploratory pilot

Gate:

- hard error 0
- phrase boundary leap 검증
- looping 연결
- final occurrence 구분
- unresolved NCT 0
- anchor overflow 자동 분할
- timeout·cancel truthfulness
- CountRateMetric·DurationRateMetric numerator/denominator/null 집계
- 6곡 usability report

```text
STEP_6_ACCEPTED / STEP_7_READY
```

## Step 7 — Validator·Reranker·Fair Baselines

구현:

- independent validator
- cost breakdown
- B0 / B1a / B1b / B2 / B3 contract
- accompaniment
- engineering vs quality metrics 분리

Gate:

- B1a 동일 Activity·range·NCT schedule
- B1b 동일 intensity·performer·source chord
- B3 동일 조건
- baseline hard violation report
- accompaniment chord semantics parity
- deterministic rerank
- baseline이 production solver 내부를 import하지 않음

```text
STEP_7_ACCEPTED / STEP_8_READY
```

## Step 8 — Dev Calibration & Sealed Modern Evaluation

순서:

1. Grammar fixture
2. Dev song corpus
3. metric report
4. threshold calibration
5. freeze commit
6. preregistered sealed run
7. 5명 이상 평가
8. macro/micro report

Gate:

- Section 18의 frozen gate
- open blocking review finding 0
- unexpired waiver만 허용

```text
STEP_8_ACCEPTED / STEP_9_READY
```

## Step 9 — Product Core

구현:

- stage-scoped plan locks
- Candidate-bound output editing
- EditedArrangementSnapshot materialization complete|blocked union
- ID 없는 replacement payload + 기존 event ID 유지
- snapshot validator·metric·timeline provenance
- variant-scoped active artifact
- MusicXML export
- local save
- project import/export
- PracticeSharePayload v3
- round-trip + hash size test
- ShareStore fallback
- part practice
- same-origin playback asset
- sealed field pilot

Gate:

- Section 18.13 표본·수치
- PracticeShare 8/32/64마디 round-trip
- iPhone·Kakao link smoke
- rights share gate

```text
PRODUCT_CORE_ACCEPTED / OMR_CORE_READY
```

## Step 10 — OMR Core

구현:

- source classifier
- quality gate
- OmrApplicationService
- OmrVendorAdapter
- ownership·CSRF·quota
- upload idempotency
- needs-input submit
- delete/retention
- MusicXML normalize
- semantic validator
- evidence frame·transform·target mapping
- evidence fixed-point codec + Node/browser parity
- unmapped evidence archive
- evidence fallback
- correction target + typed patch
- review alternative ID·resolution→correction direct link
- repair history
- rights·provider consent
- OMR Dev calibration
- sealed OMR holdout

Gate:

- Section 22 non-negotiable gate
- frozen exact/product threshold 통과
- open blocking review finding 0

```text
OMR_CORE_ACCEPTED
```

## Step 11 — OMR Advanced

선택:

- 자체 measure alignment
- symbol evidence
- secondary recognizer
- candidate fusion
- Korean lyric OCR 및 lyric-token correction
- opt-in correction learning
- data형 phrase pattern retrieval 연구

Product Core를 막지 않는다.

---

# 25. 테스트 전략

## 25.1 Unit

- Fraction arithmetic·limits
- position canonicalization
- KeySignature deriveFifths·import inconsistency
- TimeSignature beatGroups validation
- chord lexer·parser·canonicalizer
- repeat expander
- section/phrase validator
- track authority
- variant discriminated lifecycle
- stage execution blocked/complete
- stage lock classification·authority isolation
- self-contained AnchorLock·planned-NCT reconstruction
- EffectiveChordTimeline resolver·single authority
- ArrangementMode impossible-combination rejection
- ExtendedBasisPoints attack ratio >100%
- canonical JSON codec byte parity
- chord alias longest-token lexer
- PerformanceChordSpan·TimelineAtom ID uniqueness
- generated track ordinal invariant
- activity directive invalid-combination 방지
- activity/full texture metric 단계 분리
- density integration
- CountRateMetric·DurationRateMetric denominator-zero macro/micro policy
- NCT union
- digest projection
- diagnostics
- Candidate-bound output edit materialization complete|blocked
- replacement payload event-ID preservation
- EditedArrangementSnapshot validator·metric·timeline provenance
- PracticeShare codec
- OMR public status union
- OMR evidence transform graph·target mapping
- OMR evidence fixed-point codec·digest parity
- unmapped evidence archive
- OMR target·patch compatibility reducer
- OMR review alternative resolution→correction linkage
- OMR review history save/reload
- Vendor deletion truthful result

## 25.2 Property

- Fraction normalization
- equivalent position canonicalization
- parser semantic round-trip
- alias digest invariance
- event timeline no overlap
- generated pitch hard range
- deterministic comparator
- repeat expansion termination
- Project variant isolation
- stage-specific invalidation
- EffectiveChordTimeline change invalidation
- output edit base-candidate isolation
- PracticeShare encode/decode round-trip

## 25.3 Integration

- MusicXML → Quick Review
- Quick Review → Source Document
- Source → Intent Plan
- Intent → Activity
- Activity → Anchor
- Anchor → Generation Result
- Phrase → Section → Song
- Candidate/EditedSnapshot + canonical SourceLeadAtomization + EffectiveChordTimeline → Render Document
- Project → PracticeShare
- OMR Job → Review → Source
- save → reload → OMR history preservation

## 25.4 Browser

- desktop Chromium
- iPhone Safari
- Kakao in-app
- mobile width
- audio gesture
- speed
- Solo
- PracticeShare URL
- ShareStore fallback

## 25.5 CI

```text
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

핵심 gate에 `continue-on-error` 금지.

---

# 26. 버전·변경 관리

Section 14.10의 `AlgorithmVersionRegistry`가 버전 정본이다.

모든 artifact에 복사된 `*Version` 값은 생성 시점 registry의 같은 필드와 exact equal해야 한다. 독립적으로 수정하지 않는다.

`AlgorithmExecutionRegistry`는 한 실행에서 사용하는 version과 config digest의 단일 runtime 권위다. 같은 실행 안에서 모듈이 별도 registry를 만들거나 값을 덮어쓰지 않는다.

`AlgorithmConfigDigestRegistry`는 실제 실행에 사용한 versioned config payload들의 semantic digest 권위다.

- Planner·Grammar·Activity·Anchor Plan은 자기 단계 config digest와 Diagnostic registry version/digest를 직접 보존한다.
- Generation Result는 Solver·Assembler·Validator·Metric·Diagnostic registry config digest를 보존한다.
- config payload를 바꾸면서 대응 version/digest를 바꾸지 않는 것을 금지한다.
- 같은 version 문자열이 서로 다른 config digest를 가리키면 `CANONICAL_DIGEST_CODEC_FAILED`가 아니라 별도 config mismatch blocking diagnostic을 발행한다.

Sealed 실행 뒤 결과에 영향을 주는 config를 바꾸면:

1. change proposal
2. 변경 이유
3. Dev report
4. 새 freeze
5. holdout retirement 여부

가 필요하다.

Schema migration:

- v3.1 draft object를 production migration 대상으로 간주하지 않음
- 최초 authoritative schema는 v3.1.5 승인본
- 이후 migration은 source·variant·plan stage·OMR history를 보존

---

# 27. 최종 승인 조건

이 문서를 authoritative로 채택하며 확인한 조건:

- Project가 preset별 variant를 보존
- Source Lead와 Generated Track 분리
- generated track ordinal 고유·연속
- Candidate가 Anchor Plan digest를 참조하고 exact candidate projection이 고정됨
- Plan mutation과 Output edit 분리
- Output edit가 base Candidate digest에 묶임
- EditedArrangementSnapshot materialization·재검증
- quarter-note time unit·`[start,end)`·measure boundary canonicalization
- PhraseRegion authority
- Intent / Activity / Anchor 생명주기 분리
- Intent / Activity / Anchor / Solver Lock 권한 분리
- StageInputDigests와 단계별 invalidation
- AnchorLock이 자기완결 semantic payload이며 planned-NCT를 과거 Plan 없이 복원
- EffectiveChordTimeline이 chord의 단일 downstream 권위이며 자동 N.C. gap을 만들지 않음
- Profile/Context 불가능 조합이 타입으로 차단
- Grammar complete/blocked result와 no-fake-intent 실패 계약
- Intent Plan에 dangling grammar trace ID 없음
- Activity metric과 pitch-dependent texture metric 분리
- attack ratio가 100% 초과 값을 표현 가능
- Anchor union과 semantic NCT graph 저장 위치
- N.C. generation 정책
- chord lexical grammar·longest-token-first alias lexer
- profile-independent chord importance와 hard/comfortable/preferred range track별 ranking 분리
- RFC 8785 계열 canonical JSON·UTF-8·SHA-256 lower hex codec
- PerformanceChordSpan ID·canonical SourceLeadAtomization 소유권·TimelineAtom ID 정본
- full candidate digest 기반 Generated ID
- dangling phrase/section candidate ID가 final Candidate에 없음
- reconstructable PracticeShare v3가 active materialized artifact 사용
- density integration·lead-rest denominator 정본
- repeat/section 불변식
- performance budget
- baseline 공정 조건
- pilot 최소 표본
- holdout protocol
- open blocking review finding gate
- Vendor/Application 분리
- needs-input submit
- Evidence coordinate frame·transform graph·target mapping·fixed-point digest
- typed correction target·target/patch compatibility
- OMR history에 selected alternative·correction record 직접 연결
- Vendor deletion 결과의 truthful contract
- OMR threshold lifecycle
- 권리·provider transfer·share 계약
- KeySignature tonic/mode 단일 권위와 beatGroups invariant
- preferredTessitura·section type/variant·preset registry·effective config·source atomization digest 완전성
- ProductionLyricEmphasis 정본과 source→atomization→Intent digest 완전성
- Grammar blocked union과 optional non-semantic trace
- CountRateMetric·DurationRateMetric denominator-zero 정직성
- replacement event ID·materialization failure contract
- snapshot validator·metric·timeline provenance
- source revision identity·SourceIdRemap·revision-scoped OMR target·repair history 복원
- stale variant가 Plan·OutputEdit·EditedSnapshot을 삭제하지 않음
- blocked stage attempt가 이전 성공 artifact를 대체하지 않고 lastBlockedAttempt로 보존됨
- stale/blocked chord timeline과 source atomization이 마지막 성공 artifact 전체를 보존함
- SectionIntensityTarget의 단일 section-level authority와 Grammar producer
- candidate/diagnostic/event persistent ID와 projection의 완전성
- unmapped OMR evidence archive와 fixed-point codec
- review resolution→correction record 참조 무결성

최종 P0 검수에서 `OPEN_P0_COUNT = 0`, `PAST_P0_REGRESSION_COUNT = 0`을 확인했으며 아래 상태로 authoritative specification을 확정한다.

최종 승인 선언:

```text
HARMONYMAKER_V3_1_5_SPEC_ACCEPTED
HARMONYMAKER_V3_1_5_STEP_2_FOUNDATION_ACCEPTED
STEP_2_READY_TO_START
```

Grammar는 별도 승인:

```text
WORSHIP_ARRANGEMENT_GRAMMAR_V1_ACCEPTED
STEP_4_READY
```

Step 2는 본 authoritative 명세를 기준으로 시작할 수 있다. Step 4는 Worship Arrangement Grammar v1 별도 승인 전까지 시작하지 않는다.
