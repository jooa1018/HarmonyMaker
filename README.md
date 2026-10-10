# HarmonyMaker

앱 밖에서 만든 MusicXML/MXL을 올리고, 알토·테너·둘 다 중 필요한 화음 파트를 골라 생성·연습하는 앱입니다. MusicXML 읽기와 화음 생성, 악보 표시·재생, 프로젝트 저장은 브라우저에서 수행합니다. 서버는 공유 링크·익명 세션·신고·정리 작업을 담당합니다.

지원 박자는 2/4·3/4·4/4·6/8·12/8입니다. 사진·PDF를 MusicXML로 바꾸는 OMR과 로컬 이미지 인식 서버는 제거했습니다. 외부 도구에서 변환한 악보를 확인한 뒤 가져오세요. 기존 IndexedDB 프로젝트와 보존된 로컬 후보 묶음 읽기는 유지합니다.

## 로컬 실행

Node.js 22와 저장소의 package-lock.json을 사용합니다.

```sh
npm ci
npm run dev
```

브라우저에서 기본 개발 주소 `http://localhost:3000`을 엽니다. 가져오기·생성·로컬 저장에는 DB나 S3가 필요하지 않습니다. 로컬 프로젝트는 해당 브라우저의 IndexedDB에 저장되므로 프로젝트 내보내기로 별도 보관하세요.

공유까지 DB 없이 시험하려면 `.env.example`을 `.env.local`로 복사하고 `HM_DEV_MEMORY_PERSISTENCE=1` 및 아래 독립 키 7개를 설정합니다. DATABASE_URL은 생략할 수 있습니다. 메모리 모드는 `NODE_ENV=development`에서만 허용되며 서버 재시작 시 공유 데이터가 사라집니다. production·Preview·next start에서는 거부합니다. DB 연결 실패 시 메모리로 우회하지 않습니다.

키마다 다음 명령을 따로 실행해 서로 다른 값을 사용합니다. 생성한 값은 저장소에 넣지 않습니다.

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

## 환경 변수

`.env.example`의 키 값은 설명용이므로 실제 유효한 값으로 교체합니다. 서버 키에 NEXT_PUBLIC_ 접두어를 붙이지 않습니다.

| 변수 | 용도·조건 |
|---|---|
| DATABASE_URL | PostgreSQL 공유 저장. 개발 메모리 모드 외 필수 |
| SESSION_TOKEN_HMAC_KEY | 세션 서명, base64url 최소 32바이트 |
| CSRF_HMAC_KEY | CSRF, base64url 최소 32바이트 |
| SHARE_ENCRYPTION_KEY | 공유 암호화, base64url 정확히 32바이트 |
| SHARE_TOKEN_HMAC_KEY | 공유 토큰 해시, base64url 최소 32바이트 |
| OWNER_DELETE_HMAC_KEY | 소유자 삭제 증거, base64url 최소 32바이트 |
| QUOTA_IP_HMAC_KEY | IP 한도 식별자 해시, base64url 최소 32바이트 |
| INTERNAL_OPERATIONS_KEY | 내부 작업 인증, base64url 최소 32바이트 |
| CRON_SECRET | 예약 정리 Bearer 인증, 추측 불가능한 32자 이상 |
| HM_DEV_MEMORY_PERSISTENCE | 기본 0. 개발 서버에서만 1 허용 |
| TRUSTED_CLIENT_IP_HEADER | 프록시가 덮어쓰는 단일 IP 헤더. Vercel 기본 x-real-ip |
| TRUST_FORWARDED_HOST | 1이면 전달 Host 신뢰, 0이면 해제. 미설정 시 Vercel만 기본 신뢰 |
| HM_LOCAL_DIST_DIR | 선택적 검증 빌드 폴더. `.next-local-` 뒤 소문자·숫자·하이픈만 허용 |
| HM_LOCAL_NO_DISK_CACHE | 선택적 로컬 개발 캐시 비활성화, 1일 때 적용 |
| TEST_DATABASE_URL | PostgreSQL 시험에만 사용. 반드시 일회용 시험 DB |

`NODE_ENV`는 Next 실행 모드가 관리하며 `VERCEL=1`은 Vercel 배포에서 제공하는 환경 표시입니다. S3_*와 OMR_*는 앱 런타임에서 읽지 않습니다. PostgreSQL 공유 저장에는 S3가 필요하지 않습니다.

## 출처 검사와 보안 헤더

기본 출처 검사는 Host를 사용합니다. `TRUST_FORWARDED_HOST=1`이거나 해당 변수가 없는 `VERCEL=1` 환경에서만 X-Forwarded-Host를 사용합니다. 명시값 0은 Vercel에서도 신뢰를 해제합니다. 신뢰한 헤더가 없으면 Host로 돌아가고, 목록·경로·사용자 정보·잘못된 포트는 거부합니다. 앞단 프록시가 외부 입력을 덮어쓰는 환경에서만 신뢰를 켜세요.

모든 경로에 HSTS(max-age=31536000), nosniff, strict-origin-when-cross-origin Referrer-Policy, X-Frame-Options DENY, camera/microphone/geolocation 제한, CSP Report-Only를 설정합니다. CSP는 차단하지 않으며 별도 보고 수집 endpoint는 없습니다. iframe 삽입은 DENY로 거부합니다. [검증 기록](docs/implementation/H2_2_9_SECURITY_HEADERS.md)을 참고하세요.

## 사용자 IP와 한도 정책

세션 발급·공유 읽기·신고는 공통 함수로 IP를 판별합니다. `TRUSTED_CLIENT_IP_HEADER`에는 배포 프록시가 클라이언트 값을 덮어쓰는 단일 IP 헤더만 지정하세요. `VERCEL=1`에서 기본값은 `x-real-ip`이며 다른 환경에서는 기본으로 아무 헤더도 신뢰하지 않습니다. `X-Forwarded-For`와 `Forwarded`는 설정하더라도 거부합니다. 쉼표 목록·포트·유효하지 않은 IP 값은 사용하지 않습니다. IPv6는 표준화한 /64 접두어 단위로 한도를 공유합니다. 같은 /64 안에서 주소를 바꾸어도 새 한도가 생기지 않습니다. IPv4와 IPv4-mapped IPv6는 같은 IPv4 주소 단위로 계산합니다.

IP를 확인하지 못하면 원문 IP/헤더를 포함하지 않는 경고 로그를 남기고 작업별 별도 전역 한도를 사용합니다. 한도는 시간당 새 세션 1,200건, 공유 읽기 12,000건, 신고 600건(기존 개별 IP 한도의 100배)입니다. IP가 있는 요청의 기존 12/120/6 한도와 별도 버킷으로 관리하며, 미확인 요청도 무제한 허용하지 않습니다. 정상 세션 쿠키 복구는 새 세션 한도를 소비하지 않습니다.

이 전역 한도는 IP 미확인 사용자가 공유합니다. 실제 운영에서는 신뢰 헤더 설정과 프록시 덮어쓰기를 검증해 개별 IP 한도를 사용하세요.

## 오류 문의와 DB 운영

API 응답의 `x-request-id`를 오류 문의에 포함하세요. 예상하지 못한 오류는 서버에서 시각·요청 ID·정적 경로 템플릿·종류·메시지·스택을 JSON 한 줄로 기록합니다. 등록된 내부 오류 코드 외 메시지는 가리고, 스택은 프레임 순서와 숫자 위치만 보존합니다. 요청 헤더·본문·공유 토큰·쿠키·IP 원문·절대 파일 경로는 기록하지 않습니다. 알려지지 않은 RangeError는 500 `SERVER_OPERATION_FAILED`로 응답합니다.

공개 `/api/substrate-compatibility` 진단 API는 제거했습니다.

`DATABASE_URL`에는 풀링 주소(예: PgBouncer·Neon pooled URL)를 쓰세요. 앱 인스턴스당 최대 연결은 3개, 연결 대기 5초, 유휴 연결 10초, DB statement_timeout 5초, 클라이언트 query_timeout 6초입니다. 인스턴스 수가 늘면 총 연결 수도 늘어납니다. 명시적으로 실행하는 마이그레이션 작업은 별도 연결 설정을 유지합니다.

## 삭제와 정리 보관 정책

소유자 삭제는 공유의 암호화된 내용을 즉시 비웁니다. 추가 마이그레이션 016은 삭제 상태에 대한 트리거를 두므로 구버전 앱의 삭제 SQL도 암호문을 남기지 않습니다. 차단·만료 상태에서 소유자가 삭제해도 그 상태를 유지하면서 암호문만 비웁니다. 기존 1–15 SQL은 수정하지 않습니다.

보관 상수는 `src/server/cleanup/retention.ts`에 있습니다. 만료된 공유는 만료일로부터 30일, 차단된 공유는 차단일로부터 30일 뒤 행을 삭제합니다. 소유자 삭제 증거는 기존 복구 흐름을 위해 원래 만료일 후 30일까지 유지하되 암호문은 즉시 지웁니다. 신고·감사는 생성일로부터 365일 뒤 삭제합니다. 진행 중인 유효한 신고 처리 lease는 만료될 때까지 보존합니다. 세션은 만료되었고 공유·객체·OMR·멱등·quota lease·신고 참조가 모두 없을 때만 삭제합니다.

예약 정리는 50건 묶음을 최대 100회 반복하고 25초 기한을 공유합니다. SQL에도 남은 기한과 최대 5초 statement timeout을 적용합니다. 진행 중 SQL의 종료·rollback은 서버 응답 종료와 약간 차이 날 수 있지만 기한 뒤 새 묶음을 시작하지 않습니다. S3 미연결 객체는 보존하며 반복 처리의 이유로 삼지 않습니다.

하루 한 번 실행 기준 종류별 최대 5,000건을 처리할 수 있습니다(기한에 먼저 도달하면 더 적음). 예를 들어 만료 quota 5,000행과 멱등 5,000행을 동시에 한 번에 처리하는 CI 시험을 둡니다. 일일 유입이 이 처리량을 넘으면 backlog가 증가하므로 `generic.batches`, `removedQuota`, `removedIdempotency`, `removedShares`, `removedSessions`, `removedReports`, `removedAudits`를 확인해야 합니다. 이 수치는 실제 운영 부하에서 무제한 처리를 보장하지 않습니다.

## 마이그레이션과 배포 순서

실행 SQL의 유일한 기준은 `src/server/persistence/migrations.ts`입니다. SQL 사본 15개는 제거했으며, `migrations.test.ts`가 1–16의 버전·이름·체크섬을 고정합니다. 기존 항목을 수정하지 말고 새 마이그레이션만 추가하세요.

배포는 **추가형 마이그레이션 적용 → 새 앱 배포** 순서입니다. 배포할 코드의 `npm run migrate`를 별도 운영 작업으로 먼저 실행하고 성공을 확인한 뒤 앱을 배포하세요. 앱 요청 처리 중에는 마이그레이션을 적용하지 않습니다.

실행 중 확인은 DB가 코드보다 최신이어도 코드가 아는 앞부분의 버전·이름·체크섬이 모두 일치하고 버전 이력이 연속이면 허용하며, `migration-schema-ahead` 경고에 시각과 코드/DB 버전만 기록합니다. DB가 뒤처지면 `MIGRATION_REQUIRED`, 알려진 이력이 다르거나 최신 이력에 누락이 있으면 `MIGRATION_HISTORY_DIVERGED`로 거부합니다. 마이그레이션 적용 명령은 기존처럼 더 최신인 DB를 거부하므로 최신 배포 코드로 실행해야 합니다.

이 검사는 실제 스키마의 하위 호환성을 보증하지 않습니다. 추가형 변경은 기존 앱과 새 앱이 함께 동작하도록 설계해야 하며, 기존 SQL·체크섬을 수정하지 않습니다.

## 예약 작업과 검증

`vercel.json`은 `/api/internal/cleanup`을 매일 00:00 UTC에 호출하도록 선언합니다. CRON_SECRET이 맞아야 실행됩니다. S3 없이도 DB 정리는 수행하지만 과거 객체 참조는 보존하고 `skippedItems`로 보고합니다. 실제 객체 삭제가 완료됐다고 기록하지 않습니다. 기존 OMR 테이블·외래키도 보존합니다.

```sh
node --test scripts/check-private-paths.test.mjs
node scripts/check-private-paths.mjs
npm run typecheck
npm run lint
npm test
npm run test:postgres
npm run build
```

PostgreSQL 시험은 TEST_DATABASE_URL로 지정한 일회용 PostgreSQL 17 DB에서만 실행합니다. 운영 DB를 지정하지 마세요. CI는 자체 PostgreSQL 컨테이너를 사용합니다. 개인정보 검사는 추적 파일의 사용자 프로필 경로와 호스트 식별 필드를 검사하며 실제 값을 로그에 출력하지 않습니다.

저장된 공유는 기본 180일 만료이며, 소유자 확인을 통과한 복구 API의 active 응답은 ISO UTC `expiresAt`을 제공합니다. 배포 검증용 Preview와 CI 통과는 운영 DB에 마이그레이션을 적용했다는 뜻이 아닙니다. **운영 DB의 016 적용과 production 배포는 사용자가 배포 시 결정합니다.**

## 관련 문서

- [제품 명세](docs/HARMONYMAKER_SPEC_v3.1.5.md)
- [Quick Harmony API와 호환성](docs/QUICK_HARMONY_API.md)
- [서버 정리 전 진행 기록](docs/implementation/README_PRE_SERVER_CLEANUP.md)
- [서버 정리 완료 보고](docs/implementation/H2_FINAL_REPORT.md)
