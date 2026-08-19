# HarmonyMaker

HarmonyMaker는 멜로디, 확인된 코드, 곡 구조, 실제 가수 음역을 바탕으로 현대 워십 band-supported 문맥의 결정적 1–3성부 보컬 편곡을 만들고, 편집·연습·공유하는 Next.js 애플리케이션입니다. 유일한 제품 명세 authority는 [`docs/HARMONYMAKER_SPEC_v3.1.5.md`](docs/HARMONYMAKER_SPEC_v3.1.5.md)입니다.

## 현재 repository 상태

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

최초 production은 clean PostgreSQL과 clean private S3-compatible storage에서 시작합니다. Application traffic 전에 migration `1 -> latest`를 순서대로 적용해야 하며, runtime은 current schema를 verify-only로 확인해야 합니다. 최초 live production migration/version이 이후 durable-data upgrade compatibility baseline입니다. Production 설정에서 Memory/test fallback은 허용되지 않습니다.

Vercel 배포는 preview verification일 뿐 production-live PostgreSQL/S3 검증을 대신하지 않습니다. 필수 session/encryption/internal scheduler/PostgreSQL/S3 환경 설정은 배포 전에 fail-closed로 검증해야 합니다.

## 외부 검증으로 남은 항목

다음 항목은 repository PASS로 주장하지 않습니다.

- 실제 OMR provider 선택·credentials·인식 정확도·가격·refund·retention·deletion·idempotency/reconciliation 계약
- rights-safe Dev corpus 36개 이상 및 sealed corpus 24개 이상 calibration
- production-live PostgreSQL 및 production-live S3-compatible storage
- physical iPhone Safari 및 Kakao in-app browser
- cybersecurity penetration audit (`CYBER_SECURITY_AUDIT=NOT_PERFORMED`)

실제 provider API 호출, corpus calibration, production-live infrastructure probing, Step 11은 현재 범위 밖입니다.
