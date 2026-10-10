# Automatic draft v1 compatibility fixtures

The three JSON files are unmodified project exports produced at `cf97820`
(PR #14) before the v2 policy implementation. The four-bar C-major exercise
was independently authored for these tests; it contains no user score or private data.
Each export includes its original MusicXML bytes, workspace proof, v1 marker,
plans, generated events and integrity digests. Rights are generation-only,
confirmed at the fixed test time `2026-10-09T10:00:00.000Z`.

`auto`, `alto` and `tenor` capture the old default and explicit single-part paths.
Tests import and export these exact bytes, reopen them through IndexedDB,
and replay the v1 policy and compare its single-part variants with the original variants.
Do not regenerate these files using the current implementation: they are the
independent baseline for compatibility and musical regression checks.

`auto-draft-v1-edited.json` and `auto-draft-v1-edited-snapshot.json` were captured
with the unchanged code at `ee08a06`, in an isolated baseline worktree. The
fixture applies a `replace-pitch` edit to the first alto note using the same
pitch (the event becomes user-edit provenance), with the canonical output-edit
ID and ordinal 0. It passed project export validation before capture. Tests
reapply that exact edit and compare snapshot and full project bytes; editing
must retain the v1.0.1 validator, metrics and config digests.

`wag11/` contains nine original exercises: three each in 4/4, 3/4 and 12/8.
The third exercise in each meter has an explicitly marked pickup with a printed
chord. No private score or external composition was used.

`pre-triplet-bytes.json` records project/share/ABC/MusicXML digests from the
pre-triplet develop implementation (`911cacc`). The nine wag11 inputs use the
exact LF bytes stored in Git. The same inputs were run through the triplet
implementation and all four outputs matched. These are not hashes regenerated
from the new implementation alone.

`.gitattributes` marks fixture paths `-text`: raw source bytes, opaque workspace
proofs, frozen exports, and their hashes must not change with core.autocrlf.
The legacy project/snapshot JSON fixtures are single-line exports and are kept
byte-identical. Frozen WAG authority files already have their own `-text` rules.
