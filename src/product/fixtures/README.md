# Automatic draft v1 compatibility fixtures

The three JSON files are unmodified project exports produced at `cf97820`
(PR #14) before the v2 policy implementation. The four-bar C-major exercise
was independently authored for these tests; it contains no user score or private data.
Each export includes its original MusicXML bytes, workspace proof, v1 marker,
plans, generated events and integrity digests. Rights are generation-only,
confirmed at the fixed test time `2026-10-09T10:00:00.000Z`.

`auto`, `alto` and `tenor` capture the old default and explicit single-part paths.
Tests import and export these exact bytes, reopen them through IndexedDB,
and compare all newly generated v2 single-part variants with the original variants.
Do not regenerate these files using the current implementation: they are the
independent baseline for compatibility and musical regression checks.
