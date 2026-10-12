# H1 1-11 악보 표시 분할 — 승인된 설계, 구현 보류

Worker API 구현 [PR #61](https://github.com/jooa1018/HarmonyMaker/pull/61)의
120마디 시험에서 엔진 처리 중 메인 스레드의 긴 정지는 사라졌지만,
390px·페이지 CPU 4배의 전체 SVG 표시에는 약 8초가 남았다.
이 문서는 표시 분할 설계만 제안하며 런타임 변경은 없다.

## 공개 API 확인 결과

설치된 abcjs 6.7과 [공식 옵션 문서](https://docs.abcjs.net/visual/render-abc-options.html)를
확인했다. oneSvgPerLine은 시스템별 SVG를 만드는 옵션이고, lineBreaks는 줄바꿈 위치,
startingTune는 곡집에서 곡을 고르는 옵션이다. 표시할 시스템 범위를 지정하는 공개
옵션은 확인하지 못했다. afterParsing 콜백의 내부 데이터는 공식 문서도 변경 가능성을
명시하므로 tune.lines 수정에 의존하는 방안은 제안하지 않는다.

실제 Edge, 자작 120마디(긴 가사 없는 별도 시험), 390px·페이지 CPU 4배:

| 옵션 | 표시 시간 | SVG 수 | 그리기 중 타이머 실행 |
|---|---:|---:|---:|
| 보통 renderAbc | 4.78초 | 1 | 0 |
| oneSvgPerLine | 4.94초 | 61 | 0 |

두 결과의 음높이·시작·길이는 같았다. SVG 개수만 바꾸어서는 이벤트 루프가 풀리지
않는다는 것을 확인했다. abcjs.test.EngraverController 같은 내부 API도 사용하지 않는다.

## 제안: 연결을 끊지 않는 표시 전용 구간

1. Worker 안의 검증된 전체 render document를 기준으로 **연주 순서의 마디 경계**를
   찾는다. 모든 성부에서 붙임줄·이음줄·셋잇단 묶음이 닫히고, 경계를 가로지르는
   음/쉼표가 없는 곳만 자를 수 있다. 원본 마디 번호와 연주 순서 인덱스는 별도로 둔다.
2. 화면 한 줄(휴대폰 2마디, 데스크톱 4마디)을 한 구간으로 하고, 안전한 경계가 없으면 다음 안전한 경계까지 확장한다.
   최대 길이 때문에 연결을 삭제하거나 자르지는 않는다. 긴 연결 때문에 곡 전체가
   한 구간이면 그 구간은 기존 전체 표시를 사용하며 긴 작업이 남는 제한을 알린다.
3. Worker가 표시 전용 ABC 조각을 도메인 이벤트에서 만든다. 기존 ABC 문자열을
   마디선으로 자르지 않는다. 실제 조·clef·가사 연결과 테너 treble-8을 보존한다.
   성부 이름·빠르기는 첫 구간에만, 박자표는 첫 구간과 바뀌는 곳에만 표시한다.
   이어지는 코드를 구간 첫머리에 새로 찍지 않고 실제 코드 위치만 표시한다.
   내부 구간 끝을 곡 끝 이중 마디선으로 바꾸지 않는다.
4. 이 조각은 검증·저장·공유·내보내기 권위가 아니다. 기존 전체 ABC/MusicXML/프로젝트
   바이트와 전체 PlaybackPlan을 유지한다. 부분 document에 가짜 digest를 붙여
   기존 무결성 경로에 넣지 않는다.
5. H3가 화면 근처 구간과 앞뒤 한 구간을 순서대로 공개 renderAbc로 그린다.
   구간마다 이벤트 루프에 제어를 돌려주고, 스크롤 위치와 총높이는 placeholder로
   유지한다. 한 번의 renderAbc 자체는 동기이므로 긴 연결 구간의 정지는 남을 수 있다.
6. 커서·탭 seek는 구간의 전역 시작 quarter를 기준으로 매핑한다. 반복 두 번째도
   표시 번호는 원래 번호이고, 내부 식별자는 서로 다른 연주 순서 인덱스다.
   재생은 기존 전체 plan을 사용하고 화면에 아직 그리지 않은 음도 빠지지 않는다.

## 제안 API (실기기 판정 전 구현 안 함)

```ts
type ScoreSection = {
  id: string;
  startPerformanceMeasure: number;
  endPerformanceMeasureExclusive: number;
  startQuarter: number;
  endQuarter: number;
  printedMeasureNumbers: readonly number[];
  longConnectedSpan: boolean;
};
// Worker의 project handle 또는 검증된 share handle을 입력으로 한다.
scoreSections(handle, options?): Promise<readonly ScoreSection[]>;
scoreSection(handle, sectionId, options?): Promise<{
  section: ScoreSection;
  abc: string;
}>;
```

sectionId는 같은 Worker의 해당 프로젝트·표시 버전에서만 유효하다. UI가 임의의
마디 배열·workspace·project를 넘겨 표시 권위를 만들지 못한다. 현재 Worker PR의
openShare는 practice DTO만 돌려주므로 공유용 불투명 handle 추가는 1-11b 뒤 이 후속 범위다.
전체 identity가 바뀌면 구간/커서 캐시를 버린다.

## 구현 후 필수 검증

- 모든 구간의 음과 쉼표를 전역 시각으로 합친 결과가 전체 표시/plan과 같다.
  구간 선택 때문에 추가 재타격·박 반올림·누락·중복이 없어야 한다.
- 조표, 마디 안 임시표, 박자 변경, pickup, 반복과 여러 절, 긴 음·가사 연장,
  붙임줄·이음줄·셋잇단과 테너 옥타브를 포함한다.
- 경계에서 닫히지 않은 연결은 항상 같은 구간에 남는지 검증한다. 긴 이음줄이
  곡 전체를 덮는 사례도 포함해 성능 제한을 숨기지 않는다.
- 120마디·390px·페이지 CPU 4배에서 첫 SVG까지 시간, 전체 시간, 가장 긴 작업,
  스크롤·seek·재생 중 커서 정확도를 여러 번 측정한다. 일반 2마디 구간의 목표는
  한 번의 표시 250ms 이하이며 달성 여부를 보고한다. 긴 연결 구간에는 이 수치를
  보장하지 않는다. 실제 iPhone 확인은 사용자가 한다.
- 전체 export/share 바이트와 모든 재생 이벤트는 변경 전과 같다.
- H3가 전체 표시와 구간 표시를 나란히 스크린숏으로 비교한다.

## 필요한 판정

1. 내부 abcjs 데이터 수정 없이 도메인에서 표시 조각을 만드는 경계/API를 승인할지.
2. 연결 보존을 우선해 긴 이음줄 등에서는 큰 구간 또는 전체 표시가 남는 제한을
   이번 단계에서 허용할지. 이 제한을 없애려면 연결선의 구간 경계 표기 규칙을
   별도로 설계해야 하며 현재 제안에는 포함하지 않는다.
3. H1의 표시 구간 API와 H3의 그리기·스크롤·커서 작업으로 나눌지.

## 2026-10-12 판정

위 1·2·3은 모두 승인됐다. 구현은 H3 3-8 병합 뒤 사용자 iPhone 결과로 결정한다.
60마디에서 1초 이상 또는 120마디에서 3초 이상 표시가 멈출 때 착수한다.
그 전에는 구간 serializer나 화면 분할을 구현하지 않는다.
저작권 없는 자작 연습곡을 반복한 실기기 시험 파일은 orchestrator의 samples에 둔다:
`h1-practice-60-measures.musicxml`, `h1-practice-120-measures.musicxml`.
