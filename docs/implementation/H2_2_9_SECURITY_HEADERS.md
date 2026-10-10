# H2 2-9 — 보안 헤더와 출처 검사 (A등급)

[H2] 2-9 — 부분: 구현·로컬 검증 완료, PR 판정 대기

- 변경: `next.config.ts`, `src/server/http/{trusted-host,bounded-json,api}.ts`와 관련 시험.
- 검증: lint, typecheck, production build 통과. 전체 단위 시험 1,023개 통과 후 HTTP mutation 경계 시험 2개 추가. 최종 CI 결과는 PR checks 참조.
- 사용자 영향: 기존 데이터 형식은 그대로다. iframe 삽입은 거부한다. 출처 검사는 기본 Host 기준이며 신뢰 설정 없는 임의 전달 헤더를 무시한다.
- 필요한 판정: 아래 헤더와 전달 Host 신뢰 정책 승인. 승인 전 병합하지 않는다.

## 헤더 정책

모든 경로에 다음 응답 헤더를 적용한다.

| 헤더 | 값 / 목적 |
|---|---|
| Strict-Transport-Security | `max-age=31536000`; subdomain·preload는 요청하지 않음 |
| X-Content-Type-Options | `nosniff` |
| Referrer-Policy | `strict-origin-when-cross-origin` |
| X-Frame-Options | `DENY` |
| Permissions-Policy | `camera=(), microphone=(), geolocation=()`; 오디오 출력은 제한하지 않음 |
| Content-Security-Policy-Report-Only | self 기본, inline script/style, data/blob 이미지·미디어, blob worker 허용; object 차단, base self, frame-ancestors none |

CSP는 차단 정책이 아니며 강제 적용으로 전환하지 않았다. report endpoint는 설정하지 않으므로 위반은 브라우저 콘솔에서 확인하며 서버 수집은 하지 않는다. 현재 inline script/style 허용은 초기 관찰 정책이다. iframe 차단은 X-Frame-Options가 담당한다.

## 전달 Host 설정

`TRUST_FORWARDED_HOST=1`일 때만 `X-Forwarded-Host`를 사용한다. 변수가 없고 `VERCEL=1`이면 기본으로 신뢰한다. `TRUST_FORWARDED_HOST=0` 또는 다른 명시값은 Vercel에서도 신뢰를 해제한다. 이 설정은 앞단 프록시가 외부에서 온 헤더를 덮어쓰는 배포에서만 켠다.

신뢰한 헤더가 없으면 Host로 돌아간다. 헤더가 존재하지만 쉼표 목록·경로·사용자 정보·잘못된 포트 등이면 거부하며 첫 값을 고르지 않는다. 세션 입구와 일반 mutation HTTP 경계가 같은 선택 함수를 쓴다. 기존 host/port 기반 Origin 비교와 세션/CSRF 검증은 유지한다.

PR 2-4와 파일이 겹치지 않도록 README와 `.env.example`은 이 PR에서 수정하지 않았다. 2-10 통합 문서 정리 때 위 설정을 포함해야 한다.

## 빌드 앱 확인

외부 서비스 자격 증명 없이 loopback production 빌드에서 확인했다. 실제 DB·S3 접속은 하지 않았다.

- 홈 HTTP 200 응답에 위 6개 헤더 존재.
- 홈 → MusicXML 입력 → Quick Review → 프로젝트 이동: Next 클라이언트 스크립트와 화면 전환 정상.
- 직접 작성한 8마디 C major / 120 BPM 시험 악보를 입력하고 generation `complete`, validator `valid` 확인.
- abcjs가 제목·8마디·코드가 있는 SVG 악보를 표시.
- 오디오 준비 → 재생 중 17.78/32 quarter → 재생 완료 확인. 다시 재생한 뒤 11.42 quarter에서 일시정지 및 Reset 확인.
- 해당 탭의 수집된 error/warn 로그 0건. 오디오 상태와 시간 진행을 확인한 것이며 스피커 출력의 청취 품질을 판정하지는 않았다.
