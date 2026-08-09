# WAG v1 rc.7 isolated review harness

This harness executes the frozen Worship Arrangement Grammar v1 rc.7 through actual generated events and browser playback. It is deliberately isolated from the production `HarmonyProject` lifecycle.

## Authority boundary

- Grammar version: `1.0.0-rc.7`
- Immutable review package SHA-256: `98a218bbc35866eb3cd71428698f52f2a4012170b8404b7b85b576d0679aa999`
- Frozen grammar config digest: `a84e33b33785c4d2cd58ef7fcc8374f25f8e933806e0efaa95d350015c36a21a`
- Intent projector: `src/domain/digest/stages.ts:digestIntentInput()`
- Canonical codec: `src/domain/digest/canonical.ts`
- Surface: `/review/wag-rc7` (intentionally absent from production navigation)

The harness does not load, persist, or mutate a `HarmonyProject`. Review output is an in-memory result or an explicitly downloaded artifact. It is not a production Plan, generation result, snapshot, or share authority.

## Pipeline

`src/review/wag-rc7/authority.ts` calls the accepted `digestIntentInput()` projector with a canonical ordinal registry. Runtime track and performer IDs are joined only after the serialized Intent witness, digest, and ordinal graph have been reverified.

The review pipeline is:

1. Build current Source, chord timeline, atomization, performer, track, assignment, lock, and config authority.
2. Compute the actual `hm-intent-input-v1` digest.
3. Serialize only authoritative `ArrangementIntentPlan` semantics.
4. Remove candidate enumeration, opportunity cache, and diagnostic trace.
5. Reload the Intent and reconstruct candidates from current canonical authority.
6. Run Activity from persisted Intent, Anchor from persisted Activity, and Solver from persisted Anchor.
7. Build product `ArrangementCandidate` and Generated Event IDs with the accepted product candidate projector.
8. Convert the generated payload to review-only ABC playback and structured artifacts.

`src/app/review/wag-rc7/page.tsx` calculates all 17 A–O semantic fixtures across Simple, Standard, and Full. The client receives only compact render data. `abcjs` is loaded dynamically, and fixture, preset, score-mode, or speed changes discard the prior audio controller before rendering the newly selected semantics.

## P1 closure

- `RC7-P1-01 = CLOSED`: tests serialize cache-free Intent semantics and reconstruct exactly one matching opportunity key and role vector from raw canonical authority.
- `RC7-P1-02 = CLOSED`: option B is authoritative. Projector provenance is the out-of-band verifier dependency `RC7_ACCEPTED_PROJECTOR_PROVENANCE`; it is absent from the semantic witness and digest payload. The interface and contract test require that shape. The selector identity is `select-texture-activity-opportunity-v5`.
- `RC7-P1-03 = CLOSED`: SCN-009 is represented as bounded TPP reachable with automatic full-phrase selection count exactly zero.

## Review surfaces

Run `npm run dev`, then open `/review/wag-rc7` directly. The route supports fixture and preset selection, deterministic regeneration, full/Lead-only score modes, Play, Pause, Resume, Reset, per-voice Mute/Solo, speed control, generated-event inspection, legality counts, and full JSON download.

`src/review/wag-rc7/artifacts.ts` separates authoritative semantics, non-authoritative diagnostic trace, and playback files. It also creates a two-label blinded-listening ballot with hidden case/candidate metadata.

For a rights-confirmed imported score, `prepareRc7QuickReviewInput()` accepts only an analysis whose `QuickReviewState.readyForPlanning` is true and whose current timeline and atomization are resolved. Pass its result to `runPreparedRc7ReviewInput()`. This remains a non-persisting adapter and does not bypass Step 3 Quick Review authority.

## Verification

The RC7 tests cover the 51-case browser matrix, all six textures, preset limits, bounded TPP, selective third-voice win/loss/ineligible cases, final-cadence controls, cache-free reconstruction, stage locks, hard legality, and 101 complete runtime-ID renames plus input-order shuffles.

WAG v1 is not final-accepted by this harness. Step 4 remains blocked and its production implementation is not started.
