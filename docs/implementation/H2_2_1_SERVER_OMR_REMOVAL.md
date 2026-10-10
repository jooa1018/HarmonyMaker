# H2 2-1 서버 OMR·로컬 이미지 제거

[H2] 2-1 서버 OMR·로컬 이미지 제거 — 부분(A등급 승인, 최신 CI 후 병합)

- 변경: `hm/server-omr-removal` → `develop` PR. 서버 OMR·로컬 이미지 API/페이지, 제공자 서비스, 인식 실험과 전용 실행 도구를 제거했다. 서버 구성·환경 설정·예약 정리·홈 링크·관련 CI를 맞췄다.
- 검증: `npm run typecheck`, `npm run lint`, `npm test -- --reporter=dot`(108개 파일, 990개 시험), `npm run build` 통과. PostgreSQL 시험은 PR CI의 일회용 PostgreSQL 17에서 확인한다. 최종 CI 결과는 PR checks를 기준으로 한다.
- 사용자 영향: 외부에서 만든 MusicXML/MXL로 시작한다. 기존 로컬 후보 묶음, 작업 공간, 프로젝트, 공유 기능의 브라우저 코드와 저장 형식은 유지한다. 제거된 페이지/API는 404를 반환한다.
- 남은 것 / 필요한 판정: Orchestrator 승인에 따라 최신 develop 반영과 홈의 이미지 인식 안내 두 문장 삭제 후 CI 통과 시 병합한다. 이후 2-2부터 계속한다.

## 삭제 범위

`git diff --numstat` 기준 삭제 파일 132개, 삭제 파일의 텍스트 23,041줄. PNG 시험 fixture 2개는 파일 수에 포함하며 줄 수에서는 제외한다. 수정 파일에서 제거한 줄은 아래 숫자에 포함하지 않는다.

| 범위 | 삭제 파일 수 | 삭제 텍스트 줄 수 |
|---|---:|---:|
| `src/server/omr`, `src/server/local-image`, `src/server/http/omr-api*` | 34 | 11,363 |
| `src/app/omr`, `src/app/local-image`, 해당 API | 28 | 3,523 |
| `services/audiveris-provider` | 28 | 2,898 |
| `experiments/homr-integration` | 31 | 4,076 |
| OMR·로컬 이미지 전용 `scripts` | 8 | 932 |
| `Dockerfile`, `render.yaml`, 제공자 workflow | 3 | 249 |
| 합계 | 132 | 23,041 |

- 직접 의존성 제거: `sharp` 1개. Next.js의 선택적 전이 의존성으로는 lockfile에 남는다. 서버 진단의 이미지 정규화/PDF 탐색도 제거했다.
- `pdfjs-dist`: 보존한 `src/domain/omr/browser-raster.ts`에서 사용하므로 유지한다.
- `@aws-sdk/client-s3`: 기존 객체 저장소 정리가 아직 사용하므로 유지한다. 선택화는 2-2 범위다.
- `scripts/runtime-browser-smoke.py`: 제거된 OMR 흐름을 빼고 MXL 직접 가져오기로 교체했다. Python 구문 검사 통과. 이 전체 Playwright 시나리오는 로컬에서 실행하지 않았으며 이번 PR의 기본 CI에도 포함되지 않는다.

## 호환성과 검증 근거

- `src/domain`, `src/import`, `src/grammar`, `src/product`는 기준 커밋 대비 변경 없음.
- `src/server/persistence/migrations.ts`와 SQL 사본은 이번 PR에서 변경 없음. SQL 사본 삭제는 판정에 따라 2-10에서 한다.
- `src/domain/omr/local-candidate.test.ts` 6개 시험을 별도로 실행해 통과했다. 기존 후보의 이미지·XML·증거 묶음 보존, IndexedDB 저장·재열기, 수정 사항 보존, 잘못 바꾼 증거 거부를 확인했다.
- 프로덕션 빌드를 loopback에서 실행해 홈에 제거된 링크가 없음을 확인했다. `/omr`, `/local-image`, `/api/omr/jobs`, `/api/omr/provider-capabilities`, `/api/local-image`는 404, `/import`, `/score-workspace`, `/workspace`, `/share`는 200, 인증 없는 `/api/internal/cleanup`은 401이었다.
- 예약 정리 시험은 OMR 서비스 없이 성공(200), 개별 객체 삭제 실패(207), 예외 격리, 25초 실행 예산, 인증 거부를 확인한다.
- 실제 DB·S3 접속, production 배포, GitHub 설정 변경, 기존 사용자 파일 삭제는 하지 않았다.

## 후속 작업 경계

- OMR DB 테이블과 기존 제공자 작업/객체는 남는다. 제공자별 OMR 정리는 더 이상 예약 실행하지 않으며, 기존 잔여 데이터의 운영상 처리는 사용자 결정 대상이다.
- 공유·세션과 일반 객체 정리는 유지한다. S3 필수 설정 해제는 아직 적용하지 않았다.
- 홈의 OMR 링크와 이미지 인식 안내 두 문장은 제거했다. 나머지 문구와 화면 전체 개편은 H3 범위다.
- README에는 제거 사실을 먼저 고지했다. 기존 진행 기록의 이동과 운영 문서 전체 정리는 2-10에서 한다.
