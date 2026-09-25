# Minimal-input backend v1 continuation

Starting revision: f28af05 (Opus handoff). No Source/consumer-UI redesign.

## Deterministic assessment reuse

`assessAutoDraft` retains one result per weak workspace identity and normalized option marker. Its capture includes the entire workspace graph (document identity, revision, history, original evidence, schema and algorithm versions). Only journal-owned immutable workspaces reuse captured bytes; mutable inputs are serialized each time. A changed capture or option replaces the entry. Failed or concurrently mutated computations are rejected and not retained. Results are detached clones, so caller changes cannot modify validation evidence.

Every first assessment still verifies/replays the workspace. Projection, Source integrity, project integrity and performer binding remain active. The policy and preset versions are included in the options marker. The optimization does not accept a UI assessment or bypass validators.

Private r542 profile (same PC, variable memory pressure): original seven assessments cost314–415ms each; after reuse the first cost1127ms and subsequent six cost0.5–3.7ms. Total generation was5.41s before and6.94s after under differing memory pressure. These observations prove removal of repeated computation, not a controlled total-wall-time speedup.

## Close-staff chord regions

`hm-chord-recovery-v1.1` adds a staff-relative band whose bottom is0.25 spaces above the staff. The prior1.05-space edge could intersect printed letters, causing boundary-connected-ink filtering to delete them. The new band retains the ink filter, independent OCR support, and strict physical attachment checks. A containing box may replace a clipped suffix; unrelated overlapping boxes are not merged. A synthetic scaled counterexample confirms close lettering survives while entering stems and below-staff text are excluded.

On development score1, preserved-raw replay increases supported text hypotheses from4 to39, but inserts0 chords: all6 systems lack physical barline detections, so23 measure mappings remain ambiguous. The existing attachment block is preserved. Original47 regions include title/lyrics and must not be called47 verified printed chords. First-result evidence is preserved.

The18 overfull diagnostics are events in2 raw XML measures, p0m10=8 quarters and p0m18=8.25 quarters. Both use voice1; exact token traces and raw/final clocks agree. Missing internal model barlines and rhythm errors are upstream of the workspace. No duration trimming, guessed split or auto-approval is introduced.

## Contract boundaries

- r542 is corrected development material for product E2E, never unseen acceptance.
- A/E timeline edge-ink and accidental guards and external runtime pins remain unchanged.
- Alto's preserved diagnostics are `WAG_V1_PARTIAL_REQUIRED_COVERAGE` (25 missing ranges /1 missing phrase). No preset widening or phrase-model redesign.
- Full completion requires an independently unseen, supported real score succeeding on its first run. Until that evidence exists, C remains NOT_VERIFIED and backend freeze is not justified.
- Browser automation uses ui-test, with automated file assignment identified separately from native user file selection. Playback verification is transport/audio-context operation, not a human listening judgment.
