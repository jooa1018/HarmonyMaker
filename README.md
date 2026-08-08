# HarmonyMaker

HarmonyMaker는 S/A/T 화음 악보의 생성·연습을 목표로 하는 웹 앱이며, 현재는 소리 우선 기술 경로만 검증합니다.

- 유일한 규범 문서: [`docs/HARMONYMAKER_SPEC_v2.3.1.md`](docs/HARMONYMAKER_SPEC_v2.3.1.md)
- 현재 구현 단계: **Step 0–1**

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
- 별도 demo fixture의 저작권 없는 6마디 Soprano/Alto/Tenor ABC 악보와 abcjs 반응형 렌더링
- Play, Pause, Reset 및 실제 abcjs playback callback과 연결된 악보 highlight
- 성부별 Mute, single-Solo, 50–150% 속도
- Play 사용자 동작 안에서 수행되는 Web Audio/synth 활성화와 사용자 오류 안내

Solo는 Mute보다 우선합니다. 즉 mute된 성부도 해당 성부를 solo하면 들리며, 다른 성부 solo를 선택하면 기존 solo가 교체됩니다. 파트 설정 변경은 재생을 처음으로 되돌립니다.

## 아직 구현하지 않은 기능

Step 2 이후의 정식 음악 도메인, 화음 생성·검증, 편집, MusicXML, OMR, 저장, 공유, 이조, 인증, 데이터베이스 및 AI API는 구현하지 않았습니다. ABC는 이 데모의 fixture와 abcjs adapter 입력일 뿐 원본 데이터 모델이나 저장 형식이 아닙니다.

## 실기기 확인 필요

자동 테스트는 실제 모바일 오디오를 보장하지 않습니다. iPhone Safari에서 첫 Play, Pause/Reset, 각 성부 Solo, 70–75% 속도와 cursor를 smoke test해야 합니다. Kakao 인앱 브라우저에서도 링크 열기, 첫 Play와 Alto Solo를 실제 기기로 확인해야 합니다.
