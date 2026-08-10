# WAG v1 rc.7 isolated review harness

This harness executes the frozen Worship Arrangement Grammar v1 rc.7 through actual generated events and browser playback. It is deliberately isolated from the production `HarmonyProject` lifecycle.

## Authority boundary

- Grammar version: `1.0.0-rc.7`
- Immutable review package SHA-256: `98a218bbc35866eb3cd71428698f52f2a4012170b8404b7b85b576d0679aa999`
- Frozen grammar config digest: `a84e33b33785c4d2cd58ef7fcc8374f25f8e933806e0efaa95d350015c36a21a`
- Intent projector: `src/domain/digest/stages.ts:digestIntentInput()`
- Canonical codec: `src/domain/digest/canonical.ts`
- Developer surface: `/review/wag-rc7` (intentionally absent from production navigation)
- Controlled evaluator surface: `/review/wag-rc7/listening` (also intentionally absent from production navigation)

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

`src/review/wag-rc7/artifacts.ts` separates authoritative semantics, non-authoritative diagnostic trace, and playback files. Its original two-label ballot remains an internal developer artifact; it is not sent to the controlled evaluator surface because that structure contains hidden case/candidate metadata.

For a rights-confirmed imported score, `prepareRc7QuickReviewInput()` accepts only an analysis whose `QuickReviewState.readyForPlanning` is true and whose current timeline and atomization are resolved. Pass its result to `runPreparedRc7ReviewInput()`. This remains a non-persisting adapter and does not bypass Step 3 Quick Review authority.

## Controlled blinded listening

Open `/review/wag-rc7/listening` directly and choose **Start Listening Session**. This route is a simple evaluator workflow, not a developer-inspection variant. It provides repeatable A/B and Lead-reference playback, clean audio reset when switching stimuli, answer editing through Back/Next navigation, progress, section-level review, and evaluator-result download. Notation remains offscreen so visual note density does not bias listening.

The internal corpus contains 18 non-identical A/B comparisons. Every Grammar alternative is an actually eligible opportunity realized through the existing Intent → Activity → Anchor → Solver path, and all realized sides pass hard-range and vertical-legality checks. The corpus covers short Accent, selective third-voice entry, Pad register, bounded TPP, U2S timing, Suspension, and generated-versus-Lead controls. A review-only realization adapter can select an ordered legal opportunity for playback without modifying the automatically selected winner or any frozen rc.7 score/config value.

Three synthetic-original song-like sections provide 8–9 bars and two phrases each: sparse Verse-to-lift, medium-density Chorus, and 6/8 Bridge/Ending. They run the accepted per-phrase pipeline sequentially for Simple, Standard, and Full. The prior persisted `PhraseArrangementIntent.trackRoles` is passed to the next phrase and becomes its `previousPlacementRole`; there is no continuity cache. A separate single-stimulus final no-real-cue fixture is included because its legal arrangement is intentionally identical to Lead-only and therefore must not be presented as a false A/B difference.

### Blindness and result boundary

The start endpoint creates a random server session and stores its seed only in a signed, HttpOnly, SameSite=Strict cookie. A/B order is derived from that seed and comparison ID: one seed is reproducible while different sessions can reverse different comparisons. The evaluator JSON contains only session ID, ordinals, neutral Base64 playback, and counts. Before encoding, playback titles are replaced with neutral `Comparison N A/B`, `Lead reference`, or `Section review N` labels. It contains no case, fixture, preset, texture, winner/runner-up, candidate, digest, opportunity, score/cost, role, event metadata, risk tag, or A/B mapping fields.

The evaluator result contains only ordinals, choices, optional notes, and the session ID. `/review/wag-rc7/listening/reveal` returns HTTP 403 until the complete result has been validated and a second signed HttpOnly completion cookie exists. After completion, the UI can download the evaluator result and a separate administrator reveal artifact. All three endpoints use `Cache-Control: no-store`; no database, `HarmonyProject`, production Plan, or share lifecycle is read, persisted, or mutated.

## Verification

The RC7 tests cover the 51-case browser matrix, all six textures, preset limits, bounded TPP, selective third-voice win/loss/ineligible cases, final-cadence controls, cache-free reconstruction, stage locks, hard legality, and 101 complete runtime-ID renames plus input-order shuffles. Listening tests additionally cover corpus size and risk coverage, meaningful/non-identical sides, legality, three song-like sections across every preset, persisted role continuity, evaluator-payload leak checks, signed session tamper rejection, same-seed reproducibility, different-seed order changes, pre-completion reveal blocking, Route Handler cookie boundaries, response navigation/editing, completion, and JSON round trips.

WAG v1 is not final-accepted by this harness. Step 4 remains blocked and its production implementation is not started.
