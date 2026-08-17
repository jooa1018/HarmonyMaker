# HarmonyMaker v0 evidence report

## Automated implementation evidence

Code checkpoint: `713a5d02f1091df9d273ef16f4fb5eb7108561fc`; CI-stabilized verification checkpoint: `6834f1f2df7733785bd99724be5697244dd7d4b9`; exact base: `bfadfad1d4bc04e11d348c1270976802a1dc4acc`.

```text
typecheck                         PASS
lint                              PASS
full Vitest                       PASS — 59 files, 558 tests
Next.js production build         PASS
git diff --check                 PASS
npm audit --audit-level=high     PASS — 0 vulnerabilities
frozen/protected authority audit PASS — 0 changed paths
credential signature scan        PASS — 0 findings
```

The full suite covers classification/MIME/magic/limits, PDF raster policy, orientation and canonical image decode, quality heuristics, session ownership/CSRF, concurrent quotas/global credit, create and page crash windows, page replay/conflict/retry, needs-input, status sanitization, capability/evidence gates, cancel/delete/expiry/retention, accepted MusicXML import, semantic readiness, fixed-point evidence and transforms, mapping/archive, review resolution/correction/revision/remap/history, Product Core compatibility, Segment B 101-run, and OMR 101-run.

Remote code-checkpoint evidence:

- GitHub Actions: `https://github.com/jooa1018/HarmonyMaker/actions/runs/32000608829`, quality job `95300072553`, success.
- Vercel deployment `5939923221`, deployment status `16900977339`, success.
- Vercel Preview Comments check, success.
- Preview URL: `https://harmony-maker-6s87uzfp6-ecctom1.vercel.app`.

An intermediate documentation-only HEAD produced GitHub Actions failure `32001097255` in a cleanup fixture: asynchronous fixture hashing made record-array order nondeterministic. The subsequent local full run also exposed a random-handle test that could replace a terminal `0` with the same `0`. Neither observation was a production failure. Test-only checkpoint `6834f1f2df7733785bd99724be5697244dd7d4b9` makes allocation sequential in the ordering-sensitive fixture and guarantees the tampered handle differs. Focused tests, all 59 files/558 tests, typecheck, lint, and build then passed locally. GitHub Actions run `32001540954`/quality job `95302682451` and Vercel deployment `5940071810`/status `16901345450` passed for that exact checkpoint; Preview Comments also passed. Preview URL: `https://harmony-maker-bk5qn4xl9-ecctom1.vercel.app`.

The handoff-inclusive commit receives its own final run after this report is committed; that exact run and final remote SHA are reported in the Segment D completion response.

## Deterministic mock/reference lifecycle evidence

This category proves Core plumbing only and is not provider-accuracy evidence.

- Known PNG digest accepted; arbitrary pages rejected.
- Exactly-once Vendor job creation, idempotent page upload, queued/processing/needs-input/completed status, instrument input, MusicXML/evidence export, retention disclosure, and deletion passed in tests and browser.
- Browser reached accepted importer, evidence-aware OMR review, full Quick Review, schema-v9 workspace, unchanged frozen generation, score, and practice UI.
- Completed browser deletion reported local handle deletion `true` and Vendor status `deleted`.
- The OMR 101-run varies governance IDs/timestamps/nonces, Vendor job ordinal, arbitrary evidence/frame IDs, and array order while producing one semantic result set.
- The reference adapter is prohibited in production and makes no claim about recognition quality.

## Real-provider evidence

Status: **not available**.

No provider was selected, purchased, authorized, or credentialed. There is no claim for live recognition, live needs-input behavior, live retention policy, live delete success, latency, cost, granularity, or accuracy. Classification: `EXTERNAL_PROVIDER_SELECTION_OR_CREDENTIAL_REQUIRED`.

## Real-corpus calibration evidence

Status: **not available**.

The repository contains the versioned harness and manifest template, but no copyrighted material was created/downloaded and no synthetic fixture was counted toward the required rights-safe Dev `>=36` pages or sealed `>=24` pages. No threshold is frozen and no sealed PASS or accuracy number is claimed. Classification: `EXTERNAL_OMR_CALIBRATION_CORPUS_REQUIRED`.

## Live service evidence

Status: **not available for production credentials**.

PostgreSQL store/migration and private S3-compatible object-store code are implemented and unit-tested. No live database or bucket credentials were supplied, so live migration, true database concurrency, S3 deletion retry, and deployed production OMR E2E are not claimed. Classifications: `EXTERNAL_DATABASE_VERIFICATION_UNAVAILABLE` and `EXTERNAL_OBJECT_STORE_VERIFICATION_UNAVAILABLE`.

## Physical-device evidence

Status: **not available**.

Responsive browser automation passed at `390×844` without horizontal overflow. No physical iPhone Safari or Kakao in-app browser was available, so camera-picker, memory pressure, background/resume, download, audio unlock, and in-app-browser behavior are not claimed. Classification: `EXTERNAL_DEVICE_VERIFICATION_UNAVAILABLE`.
