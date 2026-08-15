# Segment A handoff

## Checkpoint

- Accepted base SHA: `04bf71835daa712b077f245b4337a68e96f3d4ee`
- Branch: `codex/harmonymaker-v0-segment-a`
- Segment-A final implementation commit SHA: `fd4a39b3d29c152f84a92a0e74e045e9f22fb04f`
- Boundary commits: A1 `84cb8f7ad278fda4e499efb4d2cf3788a4db0c38`; A2 `8fa4d92b3a14d404331ef27e7ba60377c009e66d`; A3 `fd4a39b3d29c152f84a92a0e74e045e9f22fb04f`

## Frozen identities

- WAG ZIP SHA-256: `9b27e30c10315622022c7d459fac3515ddd0fe2168321cd74870d941c9bc5b4b`
- Contract SHA-256: `ee09ded709273cc6468f1fd3f1df319d04458716f6ad911a878bffdb9b4498d5`
- WAG config semantic digest: `5a71f18d5687c4884f8dad209c162f39b8152c1e3030fc4af4b429c7c41f4482`
- Preset profile semantic digest: `ae0fce2af71b10e7f387521b22fe737cb840f02881b95121761b2953154cd681`
- Diagnostic baseline semantic digest: `96e396a1fdb97a9cc9eba2b21a20c709cd5a96285126bfba1a406cba2f42ef70`
- Diagnostic extension semantic digest: `aee570a5fc6110107979c40708ebb0b48f645e23853a0e75084854c2cd6ce794`
- Full 99-code registry digest: `0bdb9f5067cba55dad165d3679460a04f21e98b450a4624fa21eca1ffa3dcc77`

All six installed frozen artifacts passed byte-level SHA-256 verification. Their Git blobs match the working bytes and `.gitattributes` marks them `-text`, preserving byte identity even with `core.autocrlf=true`. The WAG config, preset registry, baseline/extension diagnostics, merged registry, algorithm versions, and eight WAG-owned config bindings passed semantic verification through the production canonical codec.

## Frozen substrate decision

- Runtime: Next.js Node.js Route Handlers
- Metadata database: PostgreSQL (`pg`)
- Binary object store: S3-compatible (`@aws-sdk/client-s3`)
- Session: anonymous opaque server session
- CSRF: same-origin plus session-bound token/header
- PDF: `pdfjs-dist`
- Image normalization: `sharp`
- Production memory fallback: FORBIDDEN
- Production local-filesystem fallback: FORBIDDEN
- Browser automation: `BROWSER_AUTOMATION_AVAILABLE = YES`

The implemented compatibility route requires `DATABASE_URL`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY`; blank/missing values fail closed. Later environment categories are session/CSRF signing, share-payload encryption, share/delete token verification, and privacy-preserving quota/IP HMAC secrets. No secret is embedded in the repository.

Segment C should introduce versioned PostgreSQL migrations for governance/persistence metadata and S3 object references before Product Core persistence. Segment A intentionally creates no product schema or migration.

Governance/substrate identities (tokens, nonces, timestamps, row IDs, object keys, request IDs) must never enter musical semantic projections, digests, tie-breaks, candidate order, harmony selection, or `canonicalPathKey`. A future ShareStore `payloadDigest` is the canonical plaintext payload digest before encryption, never a ciphertext/nonce/database/timestamp digest.

## Implemented and verified

- `src/server/substrate/config.ts`, `runtime.ts`, and the Node-only compatibility Route Handler: fail-closed configuration plus no-network construction/loading proofs for PostgreSQL, S3, PDF, and image dependencies.
- `src/grammar/authority.ts`: frozen config/preset/diagnostic identity verification and WAG-owned binding authority.
- `src/grammar/local-selection.ts`: pure exact source-tone realization, finite octave enumeration, hard filters, Lead chord-tone/Source-NCT branches, integer rank tuples, total tie-break, and rest/blocked boundary.
- Authority tests: six file hashes, all semantic digests, exact 99-code merge, insertion-order invariance, exact version/config bindings, and drift rejection.
- Selector tests: accidental-root spelling (including unrepresentable spelling), sus/no3/extension/add/alter/slash/N.C., all frozen local families and preference/filter boundaries, direct Upper/Lower behavior, rest/blocked behavior, order/display-name/repeat determinism.

Verification at A3 boundary:

```text
npm run typecheck     PASS
npm test -- --run     PASS — 36 files, 307 tests
npm run lint          PASS
npm run build         PASS — Next.js 16.3.0 production build
git diff --check      PASS
```

Runtime proof: configured route returned HTTP 200 with all four checks true; unconfigured route returned HTTP 503 with the exact six missing variables. Server dependency identifiers and secret-variable names were absent from client static chunks.

## Continuation state

- Accepted P2 debt: none newly accepted; the frozen manifest records all audited P2 findings as closed.
- External credentials: live PostgreSQL and S3 credentials were not available or required for Segment A. They are required for live Segment C integration.
- Segment B starts from this verified checkpoint and implements only the canonical lifecycle/candidate integration defined by the v4 execution plan, reusing `loadFrozenWagAuthority` and `selectLocalHarmonyDecision` as the single authorities.
- Segment A did not implement Intent/Activity/Anchor/Solver lifecycle integration, marginal/pair assembly, LASC/LASI, Product Core, OMR Core, B3, generated NCT, phrase-final refinement, or learned selection.
