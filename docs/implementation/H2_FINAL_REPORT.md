# H2 서버 정리 최종 보고

2026-10-12. 통합 대상은 develop이다. 기존 항목의 승인·병합 기록과 마지막 2-10 변경을 정리한다. 각 항목별 옛 보고서는 당시 검토 상태를 담은 역사 기록이며, 최종 상태는 아래 PR과 이 문서를 포함한 2-10 PR의 병합·CI 기록으로 확인한다.

## 구현 결과

| 항목 | 결과 | PR·근거 |
|---|---|---|
| 2-1 | 서버 OMR·로컬 이미지 API/페이지·제공자·전용 도구 제거 | [#15](https://github.com/jooa1018/HarmonyMaker/pull/15), [삭제 목록](H2_2_1_SERVER_OMR_REMOVAL.md) |
| 2-2 | S3 필수 설정 제거. 명시적 개발 메모리 저장소는 NODE_ENV=development에서만 허용 | [#17](https://github.com/jooa1018/HarmonyMaker/pull/17) |
| 2-3 | 요청 ID와 비밀값을 가린 구조화 오류 로그, 미등록 RangeError는 500 | [#18](https://github.com/jooa1018/HarmonyMaker/pull/18) |
| 2-4 | 단일 신뢰 IP 헤더, IPv6 /64, 미확인 IP 별도 전역 한도 | [#19](https://github.com/jooa1018/HarmonyMaker/pull/19) |
| 2-5 | 소유자 삭제 즉시 암호문 제거, 추가형 016, 보관 기간·정리 기한·묶음 처리 | [#52](https://github.com/jooa1018/HarmonyMaker/pull/52), [설계·시험 범위](H2_2_5_RETENTION_CLEANUP.md) |
| 2-6 | 인스턴스당 DB 연결 최대 3개와 연결·유휴·쿼리 시간 제한 | [#18](https://github.com/jooa1018/HarmonyMaker/pull/18) |
| 2-7 | 알려진 이력 전체가 일치하고 이후 버전이 연속이면 앞선 DB 허용. 적용 명령은 엄격하게 유지 | [#21](https://github.com/jooa1018/HarmonyMaker/pull/21) |
| 2-8 | 공개 substrate-compatibility 진단 API 제거 | [#18](https://github.com/jooa1018/HarmonyMaker/pull/18) |
| 2-9 | 보안 헤더 6종, CSP Report-Only, 명시적 전달 Host 신뢰 정책 | [#20](https://github.com/jooa1018/HarmonyMaker/pull/20), [빌드 앱 검증](H2_2_9_SECURITY_HEADERS.md) |
| 2-10 | 로컬 빌드 설정·SQL 사본·README 정리, 개인정보 CI 검사 | 이 문서를 포함한 hm/server-final-cleanup PR |
| 2-11 | 소유자 확인 후 reconcile active 응답에 ISO UTC expiresAt 추가 | [#50](https://github.com/jooa1018/HarmonyMaker/pull/50) |

2-1은 파일 132개·텍스트 23,041줄을 삭제하고 직접 의존성 sharp를 제거했다. 브라우저에서 쓰는 pdfjs-dist와 src/domain/omr는 보존했다. 객체 저장소 지원 코드는 남지만 S3 없는 앱 런타임의 객체 정리는 건너뛴다. 기존 OMR 테이블과 외래키도 보존한다.

## 2-10 변경과 검증

- 최신 develop d4a37e0(#72 포함)을 충돌 없이 반영했다. 이 PR은 src/import, src/grammar, src/domain, src/product를 변경하지 않는다.
- next.config.ts의 개별 distDir 분기는 실제 28개였다. 이를 제거하고 HM_LOCAL_DIST_DIR의 기존 허용 형식과 동작, HM_LOCAL_NO_DISK_CACHE, 보안 헤더를 유지했다. H1·H3 검증 빌드에서 같은 설정을 계속 쓸 수 있다.
- 실행 SQL의 기준은 src/server/persistence/migrations.ts 하나다. 이 PR에서 해당 파일을 바꾸지 않았다. 기존 체크섬을 그대로 고정한 1–16 버전·이름·체크섬 시험으로 사본 비교를 대체하고 SQL 사본 15개를 삭제했다. 역사 기록의 옛 파일명은 그대로다.
- README에 실행법, 실제 환경 변수, TRUSTED_CLIENT_IP_HEADER·TRUST_FORWARDED_HOST, 풀링 주소, 보관 기간, 마이그레이션 후 배포 순서를 모았다. 옛 진행 기록은 [보관 문서](README_PRE_SERVER_CLEANUP.md)로 옮겼다.
- 추적된 UTF-8 텍스트의 사용자 프로필 경로와 호스트 식별 필드를 CI에서 검사한다. 위반 시 파일·줄·규칙만 출력하고 원문 값은 출력하지 않는다. 바이너리는 검사 대상에서 제외한다. 기존 문서 3개의 사용자 프로필 경로 18곳을 대체 표기로 바꿨으며 과거 커밋은 재작성하지 않았다.
- develop 반영 후 개인정보 검사 자체 시험 4개, 실행 마이그레이션 시험 6개를 다시 통과했다. H1 영역·실행 SQL의 develop 대비 diff가 비어 있음을 확인했다.
- 전체 검증은 CI의 npm ci 후 typecheck, lint, test, test:postgres, build를 기준으로 한다. PostgreSQL 시험은 CI가 만든 일회용 PostgreSQL 17에서 실행한다. PR 병합은 전체 quality 체크 성공 후에만 한다. 개별 항목의 과거 시험 수와 최종 통합 시험 수는 다를 수 있으므로 최종 수치는 PR의 CI 로그를 기준으로 한다.

## 사용자 영향과 운영 결정

외부에서 만든 MusicXML/MXL을 사용하는 흐름이다. 기존 프로젝트·작업 공간·로컬 후보 묶음·유효 공유의 호환성을 유지하며, H1·H3의 최신 기능은 그대로 통합한다. DB·S3 없이 로컬 기본 기능을 쓰고 명시적 개발 메모리 모드로 공유를 시험할 수 있다.

016이 적용된 DB에서는 구버전 삭제 SQL도 BEFORE 트리거로 암호문을 비운다. 만료·차단 공유는 30일, 신고·감사는 365일 보관하며 세션은 참조가 없을 때만 지운다. 정리는 25초 기한 안에서 50건씩 최대 100회 반복한다. #52의 일회용 DB CI에서는 만료 quota 5,000행과 멱등 5,000행을 한 번에 정리하는 시험을 통과했다. 이는 실제 운영 부하의 처리 시간 보장은 아니다.

[로컬 빌드 폴더 목록](H2_LOCAL_BUILD_INVENTORY.md)은 2026-10-10 조사 기준 29개·3.46 GiB다. 재생성 가능한 산출물이나 실행 중 사용 여부와 보관 필요를 확인한 뒤 사용자가 삭제 여부를 결정한다. 이번 작업에서는 삭제하지 않았다.

**운영 DB의 016 적용과 production 배포는 사용자가 배포 시 결정한다.** H2는 실제 DB·S3에 접속하지 않았고 main 병합·운영 배포·GitHub 설정 변경을 수행하지 않았다. 기존 OMR 잔여 데이터의 운영 정리도 별도 사용자 결정 사항이다. 코드 작업의 추가 A등급 판정 대기는 없다.
