# Segment C handoff

## Checkpoint

- Exact Segment B handoff-inclusive base SHA: `d6ff14ae8f605662d9ab75716640ae2cf3224639`
- Segment C branch: `codex/harmonymaker-v0-segment-c`
- Final Segment C code checkpoint SHA: `844f44290929c45c60b57205b86a3f0a56c9bbff`
- Final handoff-inclusive remote HEAD: the documentation-only commit containing this file on `origin/codex/harmonymaker-v0-segment-c`; its exact immutable SHA is recorded in the Segment C completion report after the commit is created and its final CI passes. A Git commit cannot contain its own SHA.
- Exact Segment D branch base: the same final handoff-inclusive remote HEAD above, not the code checkpoint.
- Fixed musical decision: `KEEP_WAG_V1_0_1`

Segment D must branch from the exact final remote branch HEAD reported with `SEGMENT_C_COMPLETE`. The code checkpoint is recorded separately because this handoff is a documentation-only descendant.

## Commit boundaries

- Governance identity isolation: `97fdada8a1f32cb469feca26dea325cdd16d52c1`
- Secure persistence/runtime substrate: `876cb41fe930a966d7c4e295d12740f334d00fc4`
- Canonical Product Core services: `5265729d1f69726bb4e26f1a304b6c46cca0c53c`
- Connected workspace and practice sharing: `55958afefe025b307765d245ab7c507c5fe22e0b`
- Browser integration closure: `844f44290929c45c60b57205b86a3f0a56c9bbff`

## Frozen authority

- WAG ZIP SHA-256: `9b27e30c10315622022c7d459fac3515ddd0fe2168321cd74870d941c9bc5b4b`
- Contract SHA-256: `ee09ded709273cc6468f1fd3f1df319d04458716f6ad911a878bffdb9b4498d5`
- WAG config semantic digest: `5a71f18d5687c4884f8dad209c162f39b8152c1e3030fc4af4b429c7c41f4482`
- Preset profile semantic digest: `ae0fce2af71b10e7f387521b22fe737cb840f02881b95121761b2953154cd681`
- Diagnostic baseline semantic digest: `96e396a1fdb97a9cc9eba2b21a20c709cd5a96285126bfba1a406cba2f42ef70`
- Diagnostic extension semantic digest: `aee570a5fc6110107979c40708ebb0b48f645e23853a0e75084854c2cd6ce794`
- Full 99-code registry digest: `0bdb9f5067cba55dad165d3679460a04f21e98b450a4624fa21eca1ffa3dcc77`

All six frozen artifacts are byte-identical to the accepted base. The production selector, lifecycle, Solver, marginal/pair assembly, Validator, diagnostic registry, frozen versions, and resolution are unchanged. The selector experiment was not inspected, merged, or cherry-picked. E1, E3, E4, V4, V5, and grammar-v1.0.2 were not adopted.

## Runtime and persistence substrate

- Schema version `1`; ordered migration `001_segment_c_foundation.sql` / `segment_c_foundation` creates the schema-version ledger plus anonymous session, quota window/lease, idempotency, ShareStore, abuse/audit, object-reference, and Segment-D-reusable OMR metadata tables. Application is transactional, advisory-locked, checksum-verified, repeat-safe, and rejects gaps/reordering/drift.
- `PostgresPersistenceStore` is the direct `pg` boundary. Ownership-sensitive queries receive trusted server session identity; raw SQL errors and private row IDs do not cross the API boundary.
- Anonymous sessions use an opaque CSPRNG token, stored HMAC-derived hash, independent session-bound CSRF derivation, `HttpOnly; SameSite=Lax; Path=/`, production `Secure`, and a bounded 30-day expiry. Mutation authorization requires a verified session, exact same-origin Origin/Host, and `x-csrf-token`.
- Quota/idempotency uses transactional durable claims, normalized-IP HMACs, bounded records, per-session isolation, and the fixed reusable OMR limits of one concurrent job and three jobs per session-hour. No OMR workflow behavior is implemented.
- Authenticated encryption is envelope v1, AES-256-GCM, a fresh 12-byte nonce, and a dedicated exact 32-byte key. Session, share-token, owner-delete, quota/IP, CSRF, and internal-operation HMAC keys are independent. Raw public/delete tokens are never persisted.
- ShareStore validates and canonicalizes PracticeShare v3 plaintext, digests plaintext rather than ciphertext, encrypts at rest, stores only token/delete verifiers, defaults to exactly 180 days, supports read, owner delete, abuse report, takedown/disabled/expired handling, and uses non-enumerating public errors.
- `S3OwnedObjectStore` uses opaque object keys and private metadata references, verifies digest/size/content type on reads, enforces server-side ownership, and implements repeat-safe delete. Production has no memory/filesystem fallback; memory adapters are test-only.
- Cleanup is bounded and repeat-safe for expired sessions, shares, objects, idempotency records, and quota windows.

Required deployment variables are documented in `.env.example`: `DATABASE_URL`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `SESSION_TOKEN_HMAC_KEY`, `CSRF_HMAC_KEY`, `SHARE_ENCRYPTION_KEY`, `SHARE_TOKEN_HMAC_KEY`, `OWNER_DELETE_HMAC_KEY`, `QUOTA_IP_HMAC_KEY`, and `INTERNAL_OPERATIONS_KEY`. Production services validate all values and fail closed; public local-only Product Core paths remain usable without them.

Governance isolation tests vary session/share/request/object/database identities and encryption nonces while proving invariant musical digests, candidate ordering, render/edit/export semantics, and canonical PracticeShare plaintext digest. They also prove ciphertext nonce variation and absence of server-only identifiers from exported project, render, and share payloads.

## Product Core

Connected routes:

- `/`: Product Core start and workflow entry.
- `/import`: MusicXML/MXL import and Quick Review, including source/track/lyrics/chords/sections/ranges/rights confirmation and schema-v9 IndexedDB handoff.
- `/workspace`: canonical generation, complete/partial/blocked results, candidate/projection selection, score/practice playback, plan locks, regeneration, edits/snapshots, MusicXML export, local save/reload/delete, project transfer, and share creation.
- `/share`: read-only PracticeShare v3 URL or ShareStore-token practice view.
- `/api/session`, `/api/shares`, `/api/shares/[token]`, and `/api/shares/[token]/report`: Node-runtime, runtime-validated session and ShareStore APIs.

Core module boundaries:

- `workspace.ts` consumes the accepted Segment B executor, resumes regeneration at the exact stale boundary, retains prior valid artifacts on blocked attempts, and never reimplements or retunes the selector.
- `render.ts` and `score-adapter.ts` materialize candidate or snapshot `ArrangementRenderDocument` projections for Lead/Upper/Lower/full score display.
- `playback-plan.ts`, `timing.ts`, and `ProductPracticePlayer.tsx` schedule canonical events/accompaniment with N.C. silence, lyrics/held syllables/ties, actual-event cursor, play/pause/resume/reset, mute/solo, speed, and part-practice projections.
- `locks.ts` implements stage-scoped locks, staleness propagation, exact regeneration boundaries, impossible-lock blocking, and PitchLock octave semantics.
- `edited-arrangement.ts` implements candidate-bound ID-free pitch/event/tie edits and complete valid/invalid snapshot materialization with independent metrics/Validator reruns. Invalid/stale snapshots remain inspectable but cannot be active export/share artifacts.
- `musicxml-export.ts`, `local-project-store.ts`, and `project-transfer.ts` provide deterministic MusicXML, IndexedDB lifecycle, canonical project file transfer, integrity validation, and active-artifact persistence.
- `practice-share.ts`, `share-url.ts`, and `shared-practice.ts` provide PracticeShare schema-v3 materialization, canonical round trips, the `<=6000` byte URL decision, ShareStore fallback, rights gate, read-only loading, and part practice. OMR binaries/evidence and governance identifiers are excluded.

## Verification

Clean final local verification at `844f44290929c45c60b57205b86a3f0a56c9bbff`:

```text
npm ci                    PASS — 452 packages audited, 0 vulnerabilities
npm run typecheck         PASS
npm run lint              PASS
npm test                  PASS — 50 files, 482 tests
npm run build             PASS — Next.js 16.3.0 production build
git diff --check          PASS
```

The full test run includes all accepted 43 files/435 tests, the 101-complete-execution Segment B determinism gate, and 7 files/47 Segment C tests covering governance isolation, migrations, security, direct-store semantics, ShareStore/object storage, generation/render/playback/lock/edit/export/save/transfer/share round trips, and deterministic repeats. Frozen authority audit: six artifact changes `0`; protected musical-authority changes `0`; grammar-v1.0.2 paths `0`.

Browser/playback automation was available and passed on the production build path: home hydration; four-measure MusicXML import; Quick Review and IndexedDB handoff; two-range setup; canonical complete generation with two independently validated candidates; projection/score switching; actual-event Web Audio cursor; pause/resume/reset; mute/solo; 150% speed; stage lock, stale boundary, and regeneration; invalid snapshot inspection/export-share rejection; valid artifact recovery; URL PracticeShare creation and read-only playback; IndexedDB save/reload; 390x844 responsive overflow/touch-target checks; clean final workspace/share console scans; and a safe `503 PERSISTENCE_UNAVAILABLE` response when ShareStore credentials were absent. Deterministic MusicXML/project downloads are covered by unit tests; browser automation did not receive a download event from its download observer.

First push-triggered remote verification for the code checkpoint:

- GitHub Actions workflow `CI`, run `31938270952`, quality job `95143522142`
- Commit `844f44290929c45c60b57205b86a3f0a56c9bbff`
- Conclusion: `success`
- Run: `https://github.com/jooa1018/HarmonyMaker/actions/runs/31938270952`
- Vercel status: `success`; Vercel Preview Comments check: `success`

The final handoff-commit CI run and its conclusion are recorded in the Segment C completion report because they occur after this file is committed.

## Continuation state

Available in this run: in-app desktop browser automation and Vercel build/status. External verification remaining: production/test PostgreSQL provisioning and credentials; production S3-compatible provisioning and credentials; deployed ShareStore create/read/delete smoke with those credentials; physical iPhone Safari; and Kakao in-app browser. These are external environment/device checks, not missing in-repository implementation.

Known non-blocking debt: GitHub Actions warns that Node.js 20 used internally by `actions/checkout@v4` and `actions/setup-node@v4` is deprecated and currently forced to Node.js 24. Browser automation did not observe the download event noted above; deterministic export bytes, semantic MusicXML re-import, project transfer, and enabled user download paths are covered by tests/build.

Segment D scope is strictly OMR Core: source classification; PDF rasterization/image-quality work; `OmrApplicationService`; `OmrVendorAdapter`; OMR upload/start/status/export/delete routes; vendor-job/evidence mapping; and OMR review/correction/history UI. Segment C did not begin any of that behavior, select a vendor, add accounts, or begin Step 11.
