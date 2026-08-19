# Production pretraffic migration runbook

HarmonyMaker의 frozen v0 배포 계약은 application traffic보다 먼저 schema migration을 완료하도록 요구한다. 일반 `next build`와 Vercel Preview build는 데이터베이스에 연결하거나 DDL을 실행하지 않는다.

배포 운영자는 traffic 전용 release 단계에서 다음을 실행한다.

```text
DATABASE_URL=<target PostgreSQL 17 URL> npm run migrate
```

명령은 migration 1부터 current latest까지 advisory-lock transaction으로 적용하고, version/name/checksum 전체를 verify한 뒤 JSON 결과를 출력한다. 성공하지 않으면 application deployment를 traffic에 연결하지 않는다.

Runtime composition은 migration을 적용하지 않는다. `getProductionServices()`는 `schema_migrations`를 read-only로 검사하고 latest exact version/checksum이 아니면 `MIGRATION_REQUIRED` 또는 `MIGRATION_HISTORY_DIVERGED`로 fail closed한다. 따라서 ordinary API traffic과 동시 cold start는 DDL lock을 기다리지 않는다.

운영 순서:

1. clean PostgreSQL 17 및 clean S3-compatible storage 준비
2. 대상 `DATABASE_URL`을 release job에만 주입
3. `npm ci`
4. `npm run migrate`
5. 출력의 `ok=true`, `latestVersion=12` 확인
6. application artifact 배포
7. runtime verify-only readiness 성공 후 traffic 연결

Rollback은 이미 적용된 migration을 되감지 않는다. 실패하면 traffic 연결을 중단하고 원인을 해결한 뒤 동일 명령을 재실행한다. migrations 1–11은 byte-unchanged이며 새 변경은 additive migration 12부터 시작한다.
