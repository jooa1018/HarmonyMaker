# HarmonyMaker

> 2026-10-09 서버 정리: 앱 내부의 사진·PDF OMR과 로컬 이미지 인식 페이지/API 및 실행 도구를 제거했습니다. 앱 밖에서 만든 MusicXML/MXL을 올려 사용하세요. 기존 로컬 후보 묶음과 브라우저 저장 자료의 읽기 기능은 유지합니다. 기존 OMR DB 테이블과 적용 마이그레이션은 변경하지 않습니다. 아래의 Segment/OMR 진행 기록은 제거 전 기록이며, 전체 운영 문서는 후속 정리에서 갱신합니다.

HarmonyMaker는 멜로디, 확인된 코드, 곡 구조, 실제 가수 음역을 바탕으로 현대 워십 band-supported 문맥의 결정적 1–3성부 보컬 편곡을 만들고, 편집·연습·공유하는 Next.js 애플리케이션입니다. 유일한 제품 명세 authority는 [`docs/HARMONYMAKER_SPEC_v3.1.5.md`](docs/HARMONYMAKER_SPEC_v3.1.5.md)입니다.

## 현재 저장소 설정 (H2 2-2)

공유 저장은 PostgreSQL을 사용하며 S3 설정은 필요하지 않습니다. 운영 환경에는 `.env.example`의 `DATABASE_URL`, 일곱 개의 독립된 세션·암호화·내부 작업 키, 예약 정리용 `CRON_SECRET`을 설정하세요. 기존 `S3_*` 값은 런타임에서 읽지 않으며 S3 클라이언트를 만들지 않습니다.

로컬에서 DB·S3 없이 공유 기능을 시험하려면 `.env.local`에 `HM_DEV_MEMORY_PERSISTENCE=1`과 일곱 개의 유효한 키를 설정한 뒤 `npm run dev`를 실행하세요. 각 키는 서로 다르게 생성합니다. 예를 들어 `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`를 키마다 한 번씩 실행할 수 있습니다. `DATABASE_URL`은 생략 가능합니다. `NODE_ENV=development` 외 환경에서는 메모리 플래그를 거부합니다. `next start`/production/Preview에서는 사용하지 마세요.

개발 메모리 데이터와 공유 링크는 같은 서버 프로세스가 살아 있는 동안만 유효하고 재시작하면 사라집니다. 플래그를 끄면 PostgreSQL 구성이 필요하며, DB 연결 실패 시 메모리로 우회하지 않습니다. 브라우저의 IndexedDB 저장은 이 서버 플래그와 별개입니다.

예약 정리는 S3 없이 세션·공유·사용량·멱등 기록 정리를 수행합니다. 과거 객체 참조는 삭제 대기 상태로 남겨 두고 `generic.skippedItems`에 건너뛴 수를 표시하며, 실제 객체를 삭제한 것으로 기록하지 않습니다. 과거 S3 객체의 실제 삭제는 별도 운영 결정이 필요합니다. 기존 객체 저장소 어댑터와 시험은 보존합니다.

## 사용자 IP와 한도 정책

세션 발급·공유 읽기·신고는 공통 함수로 IP를 판별합니다. `TRUSTED_CLIENT_IP_HEADER`에는 배포 프록시가 클라이언트 값을 덮어쓰는 단일 IP 헤더만 지정하세요. `VERCEL=1`에서 기본값은 `x-real-ip`이며 다른 환경에서는 기본으로 아무 헤더도 신뢰하지 않습니다. `X-Forwarded-For`와 `Forwarded`는 설정하더라도 거부합니다. 쉼표 목록·포트·유효하지 않은 IP 값은 사용하지 않습니다. IPv6는 표준화한 /64 접두어 단위로 한도를 공유합니다. 같은 /64 안에서 주소를 바꾸어도 새 한도가 생기지 않습니다. IPv4와 IPv4-mapped IPv6는 같은 IPv4 주소 단위로 계산합니다.

IP를 확인하지 못하면 원문 IP/헤더를 포함하지 않는 경고 로그를 남기고 작업별 별도 전역 한도를 사용합니다. 한도는 시간당 새 세션 1,200건, 공유 읽기 12,000건, 신고 600건(기존 개별 IP 한도의 100배)입니다. IP가 있는 요청의 기존 12/120/6 한도와 별도 버킷으로 관리하며, 미확인 요청도 무제한 허용하지 않습니다. 정상 세션 쿠키 복구는 새 세션 한도를 소비하지 않습니다.

이 전역 한도는 IP 미확인 사용자가 공유합니다. 실제 운영에서는 신뢰 헤더 설정과 프록시 덮어쓰기를 검증해 개별 IP 한도를 사용하세요.

## 오류 문의와 DB 운영

API 응답의 `x-request-id`를 오류 문의에 포함하세요. 예상하지 못한 오류는 서버에서 시각·요청 ID·정적 경로 템플릿·종류·메시지·스택을 JSON 한 줄로 기록합니다. 등록된 내부 오류 코드 외 메시지는 가리고, 스택은 프레임 순서와 숫자 위치만 보존합니다. 요청 헤더·본문·공유 토큰·쿠키·IP 원문·절대 파일 경로는 기록하지 않습니다. 알려지지 않은 RangeError는 500 `SERVER_OPERATION_FAILED`로 응답합니다.

공개 `/api/substrate-compatibility` 진단 API는 제거했습니다.

`DATABASE_URL`에는 풀링 주소(예: PgBouncer·Neon pooled URL)를 쓰세요. 앱 인스턴스당 최대 연결은 3개, 연결 대기 5초, 유휴 연결 10초, DB statement_timeout 5초, 클라이언트 query_timeout 6초입니다. 인스턴스 수가 늘면 총 연결 수도 늘어납니다. 명시적으로 실행하는 마이그레이션 작업은 별도 연결 설정을 유지합니다.

## 현재 repository 상태 (제거 전 기록)

- Segment A — authority 및 persistence/object-store substrate 결정: 구현 완료
- Segment B — frozen WAG v1.0.1 결정적 편곡 lifecycle: 구현 완료
- Segment C — Product Core: 구현 완료
- Segment D — provider-neutral OMR Core 및 PostgreSQL/S3 substrate: 구현 완료
- Ultra whole-repository discovery: 완료 (`d81d7dfb3f749a78cb2ebac45b8319dd865598a8`)
- Ultra finding closure: 구현·repository validation 완료 (`10 P1 + 14 P2 + 7 TG`), 별도 Ultra re-audit 준비 완료; `ULTRA_ACCEPTED=NO`, `SEGMENT_D_ACCEPTED=NO`
- Step 11: 시작하지 않음

Ultra discovery의 historical evidence는 [`docs/implementation/ULTRA_AUDIT_DISCOVERY_REPORT.md`](docs/implementation/ULTRA_AUDIT_DISCOVERY_REPORT.md)에 있고, consolidated closure 결과는 [`docs/implementation/ULTRA_CLOSURE_REPORT.md`](docs/implementation/ULTRA_CLOSURE_REPORT.md)에 있습니다. Closure 결과가 green이어도 acceptance를 뜻하지 않으며, 별도 re-audit가 필요합니다.

## 구현 범위

Product Core는 다음 authority를 한 프로젝트 lifecycle로 연결합니다.

- MusicXML 및 안전한 MXL 가져오기, exact Fraction timing, pickup/incomplete measure, measure별 4/4·6/8 meter와 tempo 보존
- Quick Review의 Lead part/staff/voice 선택, key·tempo·chord·section·verse·performer range·rights 확인
- frozen WAG v1.0.1 Intent → Activity → Anchor → Solver → assembly → Validator pipeline과 결정적 Candidate 선택
- immutable OutputEdit revision 및 current materializer/Validator/metrics/diagnostic authority로 재검증되는 EditedArrangementSnapshot
- project-keyed IndexedDB 저장, project export/import, score projection, ABC/MusicXML export, deterministic playback/accompaniment
- rights-gated PracticeShare URL/서버 저장, anonymous session·CSRF·quota·idempotency·owner delete 기반
- PostgreSQL persistence와 private S3-compatible object substrate, cleanup/retry 및 provider-neutral OMR job/page/evidence/correction lifecycle
- MusicXML/OMR Quick Review가 프로젝트를 생성한 이후의 durable reload recovery

직접 MusicXML/MXL을 연 뒤 프로젝트를 만들기 전의 Quick Review draft는 의도적으로 non-durable입니다. 새로고침하면 draft가 사라지며, 프로젝트 생성 이후부터 IndexedDB 저장 authority가 시작됩니다.

OMR substrate에는 MIME/magic/size 검증, image/PDF normalization, durable job/page lifecycle, retry/reconciliation, evidence mapping, correction 및 Quick Review handoff가 구현되어 있습니다. 이는 provider-neutral software substrate입니다. 실제 외부 OMR provider는 연결되어 있지 않습니다.

## 실행 및 검증

Repository runtime contract는 Node.js 22와 lockfile의 npm 버전입니다.

```bash
npm ci
npm run dev
npm run typecheck
npm run lint
npm test
npm run test:postgres
npm run build
```

개발 서버는 기본적으로 `http://localhost:3000`에서 열립니다. PostgreSQL test suite는 별도의 disposable PostgreSQL 17 test database가 필요합니다.

## Migration 및 deployment contract

Production 공유 저장에는 PostgreSQL을 사용합니다. S3는 필수 구성이 아닙니다. Application traffic 전에 migration `1 -> latest`를 순서대로 적용해야 하며, runtime은 current schema를 verify-only로 확인해야 합니다. 최초 live production migration/version이 이후 durable-data upgrade compatibility baseline입니다. Production 설정에서 Memory/test fallback은 허용되지 않습니다.

Vercel 배포는 preview verification일 뿐 production-live PostgreSQL/S3 검증을 대신하지 않습니다. 필수 session/encryption/internal scheduler/PostgreSQL 환경 설정은 배포 전에 fail-closed로 검증해야 합니다.

## 외부 검증으로 남은 항목

다음 항목은 repository PASS로 주장하지 않습니다.

- 실제 OMR provider 선택·credentials·인식 정확도·가격·refund·retention·deletion·idempotency/reconciliation 계약
- rights-safe Dev corpus 36개 이상 및 sealed corpus 24개 이상 calibration
- production-live PostgreSQL 및 production-live S3-compatible storage
- physical iPhone Safari 및 Kakao in-app browser
- cybersecurity penetration audit (`CYBER_SECURITY_AUDIT=NOT_PERFORMED`)

실제 provider API 호출, corpus calibration, production-live infrastructure probing, Step 11은 현재 범위 밖입니다.
