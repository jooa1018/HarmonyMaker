# HarmonyMaker

HarmonyMaker는 멜로디·확인된 코드·곡 구간·실제 가수 음역을 바탕으로 현대 워십 band-supported 문맥에 맞는 결정적 1–3성부 보컬 편곡을 생성·수정·연습·공유하는 웹 앱을 목표로 합니다.

- 유일한 authoritative specification: [`docs/HARMONYMAKER_SPEC_v3.1.5.md`](docs/HARMONYMAKER_SPEC_v3.1.5.md)
- Step 0: **accepted**
- Step 1: **accepted for v3 foundation**
- Step 2: **canonical domain implementation complete / external review pending**
- Worship Arrangement Grammar v1: **별도 승인 후 Step 4 시작 가능**

## 실행 및 검증

Node.js 22와 npm을 권장합니다.

```bash
npm ci
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
```

개발 서버를 실행한 뒤 `http://localhost:3000`을 엽니다.

## 현재 구현된 기능

- Next.js App Router, strict TypeScript, Tailwind CSS, ESLint, Vitest 및 GitHub Actions CI
- 별도 기술 fixture의 저작권 없는 6마디 Soprano/Alto/Tenor ABC 악보와 abcjs 반응형 렌더링
- Play, Pause, Reset 및 실제 abcjs playback callback과 연결된 악보 highlight
- 성부별 Mute, single-Solo, 50–150% 속도
- Play 사용자 동작 안에서 수행되는 Web Audio/synth 활성화와 사용자 오류 안내
- v3.1.5 Step 2 canonical domain foundation: exact Fraction/time, spelled pitch/key/meter, worship-leadsheet-v1 chord semantics, source revision/performance/section/phrase authorities, EffectiveChordTimeline, SourceLeadAtomization, performer/track/config, variant/plan/lock lifecycle, canonical digest/ID/diagnostic registries, candidate/generation provenance, density metrics, edit/share 및 revision-scoped OMR foundation contracts

Step 1의 S/A/T ABC demo는 렌더·재생·모바일 audio path 검증용 기술 fixture로 그대로 보존되며, production의 고정 성부 모델이나 authoritative product definition이 아닙니다.

Solo는 Mute보다 우선합니다. 즉 mute된 성부도 해당 성부를 solo하면 들리며, 다른 성부 solo를 선택하면 기존 solo가 교체됩니다. 파트 설정 변경은 재생을 처음으로 되돌립니다.

## 아직 구현하지 않은 기능

Step 2 구현은 외부 acceptance review 전이며 `STEP_2_ACCEPTED` 상태로 선언하지 않습니다. Worship Arrangement Grammar의 음악 결정표, Activity/rhythm planning algorithm, Anchor selection, pitch generation, automatic harmony, MusicXML import, OMR Vendor 연동, 실제 편집·PracticeShare 서비스, 저장·인증·데이터베이스와 Step 3 이상은 구현하지 않았습니다. ABC는 demo fixture와 abcjs adapter 입력일 뿐 원본 데이터 모델이나 저장 형식이 아닙니다. Worship Arrangement Grammar v1은 별도 승인이 필요한 Step 4 blocker입니다.

## 실기기 확인 필요

자동 테스트는 실제 모바일 오디오를 보장하지 않습니다. iPhone Safari에서 첫 Play, Pause/Reset, 각 성부 Solo, 70–75% 속도와 cursor를 smoke test해야 합니다. Kakao 인앱 브라우저에서도 링크 열기, 첫 Play와 Alto Solo를 실제 기기로 확인해야 합니다.
