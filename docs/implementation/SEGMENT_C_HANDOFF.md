# Segment C handoff

## Checkpoint

- Exact Segment B handoff-inclusive base SHA: `d6ff14ae8f605662d9ab75716640ae2cf3224639`
- Segment C branch: `codex/harmonymaker-v0-segment-c`
- Final Segment C code checkpoint SHA: `b8615c2a2864c809da04d2d790ed067f6aa00e5d`
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
- Explicit track-role and MusicXML semantic closure: `0e63de6a8fd2d8adfc65ec2b6b277bc3a40a1548`
- Independent edited-snapshot validation closure: `64d87c5fef7a0025952fcc089873517aec076d33`
- Retention and share-governance closure: `dfb6d9e842525a49cd81dcf0ce29a51c3e9427c2`
- Canonical lock/edit control closure: `aafbabe63918c063fd4c2c3bf8bde12f48681998`
- Frozen-key role, MusicXML, and edited-metric closure: `1b0c32a6768586e67815852a298680287e390e86`
- Atomic secret-safe ShareStore idempotency closure: `c552d915473626e77d38fe17c928fb264e8241cb`
- Frozen candidate-ordinal integrity alignment: `b8615c2a2864c809da04d2d790ed067f6aa00e5d`

The second verification closure commits are additive descendants of the accepted remote checkpoint `5f39d5027cce02266af51c4dc9fffe85fcc288a5`; the earlier closure remains an additive descendant of `30d5dc10b2fbfba7e5763ed6de662d2847682fdf`. No existing Segment C commit was amended, rebased, squashed, or replaced.

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

- Ordered migrations `001_segment_c_foundation.sql` / `segment_c_foundation`, `002_idempotency_recovery.sql` / `idempotency_recovery`, and `003_share_replay_envelope.sql` / `share_replay_envelope` create the foundation, add a bounded pending-claim lease, and require encrypted share-create replay envelopes while deleting legacy raw share-create replay rows. Application is transactional, advisory-locked, checksum-verified, repeat-safe, and rejects gaps/reordering/drift.
- `PostgresGovernanceStore` is the direct `pg` boundary. Ownership-sensitive queries receive trusted server session identity; raw SQL errors and private row IDs do not cross the API boundary.
- Anonymous sessions use an opaque CSPRNG token, stored HMAC-derived hash, independent session-bound CSRF derivation, `HttpOnly; SameSite=Lax; Path=/`, production `Secure`, and a bounded 30-day expiry. Mutation authorization requires a verified session, exact same-origin Origin/Host, and `x-csrf-token`.
- Quota/idempotency uses transactional durable claims, normalized-IP HMACs, bounded records, per-session isolation, and the fixed reusable OMR limits of one concurrent job and three jobs per session-hour. Share creation and idempotency completion commit atomically with a claim-fencing timestamp and encrypted AES-GCM replay envelope; completed replays bypass new quota consumption; crash recovery cannot duplicate the durable share; failed pre-effect claims are released; abandoned pending claims are reclaimable after the five-minute lease; ShareStore reads consume an IP-HMAC hourly quota. No OMR workflow behavior is implemented.
- Authenticated encryption is envelope v1, AES-256-GCM, a fresh 12-byte nonce, and a dedicated exact 32-byte key. Session, share-token, owner-delete, quota/IP, CSRF, and internal-operation HMAC keys are independent. Raw public/delete tokens are never persisted.
- ShareStore validates and canonicalizes PracticeShare v3 plaintext, digests plaintext rather than ciphertext, encrypts at rest, stores only token/delete verifiers, defaults to exactly 180 days, supports read, owner delete, abuse report, takedown/disabled/expired handling, and uses non-enumerating public errors.
- `S3OwnedObjectStore` uses opaque object keys and private metadata references, verifies digest/size/content type on reads, enforces server-side ownership, and implements repeat-safe delete. Production has no memory/filesystem fallback; memory adapters are test-only.
- Cleanup is bounded, idempotent, and failure-isolated. Expired active object references move to `delete-pending`; both new and previously pending records are passed to S3 `DeleteObject`; successful deletion moves to `deleted` and records an audit; a failed S3 deletion remains pending and retryable without blocking sibling records.

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
- `workspace.ts`, `track-roles.ts`, `render.ts`, and `score-adapter.ts` persist operational H1/H2 from the exact frozen §19.2 marginal selection order and carry explicit `trackPlanId → placementRole` independently. Score, playback, PracticeShare, shared-practice, and MusicXML never derive H1/H2 from `canonicalOrdinal` or generated-track array position; canonical ordinal 2 may be H1/Lower while ordinal 1 is H2/Upper.
- `playback-plan.ts`, `timing.ts`, and `ProductPracticePlayer.tsx` schedule canonical events/accompaniment with explicit role labels, N.C. silence, lyrics/held syllables/ties, actual-event cursor, play/pause/resume/reset, mute/solo, speed, and part-practice projections.
- `locks.ts`, `workspace-controls.ts`, and the connected workspace implement canonical Intent texture/placement, Activity, Anchor, and Solver targets; lock creation/replacement/removal; earliest-boundary staleness; and exact regeneration presentation.
- `edited-arrangement.ts` and `edited-validation.ts` implement candidate-bound replace-pitch, replace-event note/rest, and set-tie edits without rewriting `source="user-edit"`. Independent snapshot validation consumes actual edited events, protects required anchor provenance, recomputes every `FullSongMetrics` field, and derives source-chord respect from every actual sounding independent edited note, including rest-to-note user edits. Invalid snapshots remain inspectable but cannot be default export/share artifacts.
- `musicxml-export.ts`, `local-project-store.ts`, and `project-transfer.ts` provide deterministic MusicXML, IndexedDB lifecycle, canonical project file transfer, integrity validation, and active-artifact persistence. Structured MusicXML kind/degrees reconstruct the final ParsedChord tone set without `kind@text`, preserving accidental roots/bass, mMaj9, augMaj7, m7b5, dim7, extensions, alterations, omissions, additions, sus, and slash semantics, plus duration-appropriate type/dot/tuplet notation.
- `practice-share.ts`, `share-url.ts`, `shared-practice.ts`, and the share-governance coordinators provide PracticeShare schema-v3 materialization, canonical round trips, the `<=6000` byte URL decision, ShareStore fallback, rights gate, read-only loading/quota, idempotent create replay, and part practice. OMR binaries/evidence and governance identifiers are excluded.

## First verification closure

Clean final local verification at `aafbabe63918c063fd4c2c3bf8bde12f48681998`:

```text
npm ci                    PASS — lockfile-exact 452 packages audited, 0 vulnerabilities; the local Windows runner blocked npm's default cmd.exe postinstall spawn, so the exact graph was installed with scripts suppressed and its sole required postinstall was executed directly. Remote CI ran unmodified `npm ci` successfully.
npm run typecheck         PASS
npm run lint              PASS
npm test                  PASS — 50 files, 493 tests
npm run build             PASS — Next.js 16.3.0 production build
git diff --check          PASS
```

The full test run includes the 101-complete-execution Segment B determinism gate. The focused closure rerun passed 6 files/44 tests for Segment B execution, Product Core/export/edit/playback, ShareStore/idempotency/read quota, cleanup, and S3 deletion retry. The frozen authority/selector rerun passed 2 files/37 tests. Frozen audit: six artifact changes `0`; protected musical-authority changes `0`; grammar-v1.0.2 paths `0`; WAG ZIP SHA-256 remains `9b27e30c10315622022c7d459fac3515ddd0fe2168321cd74870d941c9bc5b4b`.

Closure browser/playback automation passed on the local Next runtime: four-measure MusicXML import; Quick Review and IndexedDB handoff; three vocal ranges; canonical complete generation with four candidates; explicit `Upper / H1` and `Lower / H2` score/playback labels; Upper-only projection excluding H2; actual-event Web Audio cursor; pause/resume/reset; mute/solo; 150% speed; canonical lock target presentation; Activity lock creation/replacement, Solver lock creation, earliest Activity stale boundary preservation, blocked Solver attempt retention, lock removal, and exact-boundary recovery; invalid edited-snapshot inspection/export-share rejection; valid candidate recovery; URL PracticeShare creation with both explicit roles and read-only playback; and clean workspace/share console scans.

Push-triggered remote verification for the closure code checkpoint:

- GitHub Actions workflow `CI`, run `31941421313`, quality job `95151078090`
- Commit `aafbabe63918c063fd4c2c3bf8bde12f48681998`
- Conclusion: `success`
- Run: `https://github.com/jooa1018/HarmonyMaker/actions/runs/31941421313`
- Vercel status: `success`, deployment `FGY2LwFstDcFnWcvnptDYcGJzFrA`; Vercel Preview Comments check: `success`

The final handoff-commit CI run and its conclusion are recorded in the Segment C completion report because they occur after this file is committed.

## Second verification closure

The second closure started exactly from remote HEAD `5f39d5027cce02266af51c4dc9fffe85fcc288a5` and ended at code checkpoint `b8615c2a2864c809da04d2d790ed067f6aa00e5d`. It preserves `KEEP_WAG_V1_0_1`, every frozen WAG artifact/digest, and the Segment B selector/lifecycle/Solver/marginal/pair/Validator behavior.

Corrected final local evidence:

```text
npm ci                    PASS — lockfile-exact 452 packages audited, 0 vulnerabilities; local Windows used the same documented scripts-suppressed recovery plus the sole required postinstall. Final remote CI runs unmodified npm ci.
npm run typecheck         PASS
npm run lint              PASS
npm test                  PASS — 50 files, 505 tests
npm run build             PASS — Next.js 16.3.0 production build
git diff --check          PASS
```

Focused evidence:

- Segment B determinism: the dedicated 101-complete-execution test passed (`1` passed, `5` skipped).
- Product/export/edit/share/security: `6` files and `89` focused tests passed, including ordinal-2-as-H1 labels in score, playback, PracticeShare, shared-practice, and MusicXML; text-independent structured chord reconstruction; edited-note chord respect; concurrent/crash ShareStore recovery; quota and migration checks.
- Product-integrity regression: the ordinal-2-as-H1 project validates and exports after multi-measure generation; the integrity gate now reproduces the already-frozen candidate anchor-directive ordinal projection rather than defining a new projection.
- Browser/playback: a four-measure MusicXML completed Quick Review, IndexedDB handoff, three-voice generation, and four-candidate assembly. The score and playback rendered ordinal 1 as `Upper / H2` and ordinal 2 as `Lower / H1`; play/pause/resume/reset, mute/solo, 150% speed, and an error/warning-free console all passed.
- Frozen audit against `5f39d5027cce02266af51c4dc9fffe85fcc288a5`: six frozen artifact paths changed `0`; protected production musical-authority paths changed `0`; v1.0.2 paths changed `0`; WAG ZIP SHA-256 remains `9b27e30c10315622022c7d459fac3515ddd0fe2168321cd74870d941c9bc5b4b`.

The GitHub Actions and Vercel results for the handoff-inclusive remote HEAD are recorded in the final `SEGMENT_C_COMPLETE` report after this documentation commit is pushed and both providers are green.

## Continuation state

Available in this run: in-app desktop browser automation and Vercel build/status. External verification remaining: production/test PostgreSQL provisioning and credentials; production S3-compatible provisioning and credentials; deployed ShareStore create/read/delete smoke with those credentials; physical iPhone Safari; and Kakao in-app browser. These are external environment/device checks, not missing in-repository implementation.

Known non-blocking debt: GitHub Actions warns that Node.js 20 used internally by `actions/checkout@v4` and `actions/setup-node@v4` is deprecated and currently forced to Node.js 24. Browser automation did not observe the download event noted above; deterministic export bytes, semantic MusicXML re-import, project transfer, and enabled user download paths are covered by tests/build.

Segment D scope is strictly OMR Core: source classification; PDF rasterization/image-quality work; `OmrApplicationService`; `OmrVendorAdapter`; OMR upload/start/status/export/delete routes; vendor-job/evidence mapping; and OMR review/correction/history UI. Segment C did not begin any of that behavior, select a vendor, add accounts, or begin Step 11.
