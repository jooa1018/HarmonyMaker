import { describe, expect, it } from "vitest";

import { generateDeterministicAccompaniment } from "../accompaniment/deterministic";
import { parseChord } from "../domain/chord/parser";
import type { ArrangementOutputEdit } from "../domain/edit/model";
import { fraction } from "../domain/fraction";
import type { ArrangementRenderDocument } from "../domain/generation/model";
import type { HarmonyProject } from "../domain/project";
import { outputEditId } from "../domain/ids";
import { validateHarmonyProject } from "../domain/project";
import { normalizeSongSourceDocument } from "../domain/source/normalize";
import { computeRevisionHistoryDigest } from "../domain/source/revision";
import { musicalRange } from "../domain/time";
import { createWagFixtureInput, materializeSegmentBFixture, pitch } from "../grammar/fixtures";
import { importMusicXml } from "../import/musicxml/parser";
import { replaceStageLocks } from "./locks";
import { materializeEditedArrangement } from "./edited-arrangement";
import { MemoryLocalProjectStore } from "./local-project-store";
import { exportArrangementMusicXml } from "./musicxml-export";
import { audibleTrackIds, buildPlaybackPlan, INITIAL_TRANSPORT, quarterSeconds, reduceTransport } from "./playback-plan";
import { exportHarmonyProject, importHarmonyProject } from "./project-transfer";
import { confirmShareRights, materializePracticeShare } from "./practice-share";
import { loadProductExecutionRegistry } from "./registry";
import { canDefaultExportOrShare, materializeActiveArrangement, projectRenderDocument, selectActiveCandidate, selectActiveSnapshot } from "./render";
import { arrangementRenderDocumentToAbc } from "./score-adapter";
import { decodeProductUrlShare, encodeProductUrlShare } from "./share-url";
import { practiceShareToRenderDocument } from "./shared-practice";
import { generateProjectVariant, type ProductGenerationOutcome } from "./workspace";
import type { WagLifecycleInput } from "../grammar/lifecycle";

async function generatedProject(inputOverride?: WagLifecycleInput): Promise<{ readonly project: HarmonyProject; readonly generated: Extract<ProductGenerationOutcome, { readonly status: "complete" | "partial" }> }> {
  const input = inputOverride ?? await createWagFixtureInput({ presetId: "standard", maxHarmonyTracks: 2 });
  const source = normalizeSongSourceDocument({ ...input.source, revisionHistoryDigest: await computeRevisionHistoryDigest([]) });
  const project: HarmonyProject = {
    schemaVersion: 9, source,
    chordTimelineState: { status: "resolved", timeline: input.effectiveChordTimeline, diagnostics: [] },
    sourceLeadAtomizationState: { status: "resolved", atomization: input.sourceLeadAtomization, diagnostics: [] },
    presetProfiles: await (await import("../grammar/authority")).loadFrozenWagAuthority().then((authority) => authority.presetProfiles),
    performers: input.performers, trackPlans: input.trackPlans, assignments: input.assignments,
    settings: { mode: input.effectiveConfig.mode, requestedPresetIds: ["standard"], userCaps: input.userCaps },
    locksByPreset: { standard: { intent: [], activity: [], anchor: [], solver: [] } },
    variants: { standard: { lifecycle: "empty", presetId: "standard", diagnostics: [] } }, selectedPresetId: "standard",
  };
  const generated = await generateProjectVariant(project, "standard");
  if (generated.status === "blocked") throw new Error("fixture blocked");
  return { project: generated.project, generated };
}

describe("Product Core workspace, render, playback, and state", () => {
  it("persists canonical generation and switches candidate/projection without state leakage", async () => {
    const { project, generated } = await generatedProject();
    const variant = project.variants.standard;
    expect(variant?.lifecycle).toBe("generation-attempted");
    if (!variant || variant.lifecycle !== "generation-attempted") return;
    expect(generated.execution.validation.valid).toBe(true);
    const full = materializeActiveArrangement(project, "standard");
    expect(full.document.effectiveChordTimeline.digest).toBe(project.chordTimelineState.status === "resolved" ? project.chordTimelineState.timeline.digest : "");
    expect(projectRenderDocument(project, "standard", "lead").document.generatedHarmonyTracks).toEqual([]);
    expect(projectRenderDocument(project, "standard", "upper").document.generatedHarmonyTracks.length).toBeLessThanOrEqual(1);
    expect(projectRenderDocument(project, "standard", "lower").document.generatedHarmonyTracks.length).toBeLessThanOrEqual(1);
    const other = variant.generationResult.candidates.at(-1)!;
    const switched = selectActiveCandidate(project, "standard", other.id);
    expect(materializeActiveArrangement(switched, "standard").artifactDigest).toBe(other.contentDigest);
    expect(materializeActiveArrangement(project, "standard").artifactDigest).not.toBe("");
  });

  it("builds score and playback from the same canonical events with exact transport/mixer semantics", async () => {
    const { project } = await generatedProject();
    const materialized = materializeActiveArrangement(project, "standard");
    const abc = arrangementRenderDocumentToAbc(materialized.document, materialized.trackRoles, { title: project.source.title, tempo: project.source.defaultTempo, key: project.source.defaultKey });
    expect(abc).toContain("%%score lead h1 h2");
    const accompaniment = await generateDeterministicAccompaniment(materialized.document.effectiveChordTimeline);
    const plan = buildPlaybackPlan(materialized.document, materialized.trackRoles, accompaniment);
    expect(plan.events.some((event) => event.kind === "voice")).toBe(true);
    expect(plan.effectiveChordTimelineDigest).toBe(accompaniment.effectiveChordTimelineDigest);
    expect(quarterSeconds(project.source.defaultTempo, 50)).toBeGreaterThan(quarterSeconds(project.source.defaultTempo, 150));
    let transport = reduceTransport(INITIAL_TRANSPORT, { type: "play" });
    transport = reduceTransport(transport, { type: "cursor", eventId: plan.events[0].eventId, positionQuarter: plan.events[0].startQuarter });
    transport = reduceTransport(transport, { type: "pause", positionQuarter: 1 });
    transport = reduceTransport(transport, { type: "resume" });
    expect(transport.phase).toBe("playing");
    expect(reduceTransport(transport, { type: "reset" })).toEqual(INITIAL_TRANSPORT);
    expect(audibleTrackIds(plan, { muted: new Set(["track:source-lead"]), bandEnabled: false })).not.toContain("track:band");
    expect(audibleTrackIds(plan, { muted: new Set(), solo: "track:source-lead", bandEnabled: true })).toEqual(["track:source-lead"]);
  });

  it("carries explicit H1/H2 and placement metadata without array-index inference", async () => {
    const input = await createWagFixtureInput({
      presetId: "standard",
      maxHarmonyTracks: 2,
      generatedRanges: [
        { low: pitch("C", 2), high: pitch("B", 3) },
        { low: pitch("D", 4), high: pitch("C", 6) },
      ],
    });
    const { project } = await generatedProject(input);
    const materialized = materializeActiveArrangement(project, "standard");
    expect(materialized.trackRoles.byTrackPlanId["track:h1"]).toMatchObject({ harmonyRole: "H1", label: "Lower / H1" });
    expect(materialized.trackRoles.byTrackPlanId["track:h2"]).toMatchObject({ harmonyRole: "H2", label: "Upper / H2" });
    const abc = arrangementRenderDocumentToAbc(materialized.document, materialized.trackRoles, { title: project.source.title, tempo: project.source.defaultTempo, key: project.source.defaultKey });
    expect(abc).toContain('V:h1 name="Lower / H1"');
    expect(abc).toContain('V:h2 name="Upper / H2"');
    const plan = buildPlaybackPlan(materialized.document, materialized.trackRoles);
    expect(plan.trackLabels).toMatchObject({ "track:h1": "Lower / H1", "track:h2": "Upper / H2" });
    const payload = materializePracticeShare({ project: confirmShareRights(project), presetId: "standard", materialized });
    expect(payload.arrangement.tracks.filter((track) => track.kind === "generated-harmony").map((track) => track.label)).toEqual(["Lower / H1", "Upper / H2"]);
  });

  it("stales the exact downstream boundary for stage-owned locks and rejects wrong-stage scope", async () => {
    const { project } = await generatedProject();
    const variant = project.variants.standard;
    if (!variant || variant.lifecycle !== "generation-attempted") return;
    const candidate = variant.generationResult.candidates.find((item) => Object.keys(item.generatedEventsByTrack).length > 0)!;
    const event = Object.values(candidate.generatedEventsByTrack).flat().find((item) => item.kind === "note")!;
    const lock = { id: "lk:standard:pitch:0", kind: "pitch", presetId: "standard", phraseId: project.source.phraseRegions[0].id, trackPlanId: Object.keys(candidate.generatedEventsByTrack)[0], position: event.range.start, pitch: event.kind === "note" ? event.pitch : pitch("C", 4) } as const;
    const stale = replaceStageLocks(project, "standard", "solver", [lock]);
    expect(stale.variants.standard?.staleness?.staleFrom).toBe("generation");
    expect(stale.variants.standard && "activeArrangement" in stale.variants.standard ? stale.variants.standard.activeArrangement : undefined).toBeUndefined();
    await expect(exportHarmonyProject(stale)).resolves.toContain('"staleFrom":"generation"');
    expect(() => replaceStageLocks(project, "standard", "intent", [lock])).toThrow("STAGE_LOCK_SCOPE_INVALID");
    expect(() => materializeActiveArrangement(stale, "standard")).toThrow("ACTIVE_ARRANGEMENT_UNAVAILABLE");
  });

  it("regenerates from the exact stale boundary and preserves a blocked attempt without replacing artifacts", async () => {
    const { project } = await generatedProject();
    const variant = project.variants.standard;
    if (!variant || variant.lifecycle !== "generation-attempted") return;
    const candidate = variant.generationResult.candidates.find((item) => Object.keys(item.generatedEventsByTrack).length > 0)!;
    const [trackPlanId, event] = Object.entries(candidate.generatedEventsByTrack).flatMap(([track, events]) => events.flatMap((item) => item.kind === "note" ? [[track, item] as const] : []))[0];
    const common = { id: "lk:regeneration:0", kind: "pitch" as const, presetId: "standard" as const, phraseId: project.source.phraseRegions[0].id, trackPlanId, position: event.range.start };
    const stale = replaceStageLocks(project, "standard", "solver", [{ ...common, pitch: event.pitch }]);
    const regenerated = await generateProjectVariant(stale, "standard");
    expect(regenerated.status).not.toBe("blocked");
    if (regenerated.status === "blocked") return;
    const next = regenerated.project.variants.standard;
    expect(next?.staleness).toBeUndefined();
    if (!next || next.lifecycle !== "generation-attempted") return;
    expect(next.intentPlan.intentPlanDigest).toBe(variant.intentPlan.intentPlanDigest);
    expect(next.activityPlan.activityPlanDigest).toBe(variant.activityPlan.activityPlanDigest);
    expect(next.anchorPlan.anchorPlanDigest).toBe(variant.anchorPlan.anchorPlanDigest);

    const impossible = replaceStageLocks(project, "standard", "solver", [{ ...common, id: "lk:regeneration:1", pitch: { step: "C", alter: 0, octave: 9 } }]);
    const blocked = await generateProjectVariant(impossible, "standard");
    expect(blocked.status).toBe("blocked");
    expect(blocked.project.variants.standard?.lastBlockedAttempt?.stage).toBe("generation");
    expect(blocked.project.variants.standard?.staleness?.staleFrom).toBe("generation");
  });
});

describe("candidate-bound edits and EditedArrangementSnapshot", () => {
  it("returns valid, invalid, and blocked outcomes without mutating the Candidate", async () => {
    const { project } = await generatedProject();
    const variant = project.variants.standard;
    if (!variant || variant.lifecycle !== "generation-attempted") return;
    const candidate = variant.generationResult.candidates.find((item) => Object.keys(item.generatedEventsByTrack).length > 0)!;
    const event = Object.values(candidate.generatedEventsByTrack).flat().find((item) => item.kind === "note")!;
    if (event.kind !== "note") return;
    const baseJson = JSON.stringify(candidate);
    const samePitch: ArrangementOutputEdit = { id: outputEditId("standard", candidate.contentDigest, 0), kind: "replace-pitch", presetId: "standard", baseCandidateId: candidate.id, baseCandidateDigest: candidate.contentDigest, editOrdinal: 0, eventId: event.id, pitch: event.pitch };
    const lifecycleInput = await (await import("./workspace")).wagInputFromProject(project, "standard");
    const valid = await materializeEditedArrangement({ lifecycleInput, intentPlan: variant.intentPlan, activityPlan: variant.activityPlan, anchorPlan: variant.anchorPlan, candidate, edits: [samePitch] });
    expect(valid.status).toBe("complete");
    if (valid.status !== "complete") return;
    expect(valid.snapshot.status).toBe("valid");
    expect(valid.snapshot.generatedHarmonyTracks.flatMap((track) => track.events).find((item) => item.id === event.id)).toMatchObject({ source: "user-edit" });
    expect(JSON.stringify(candidate)).toBe(baseJson);
    const integrated: HarmonyProject = { ...project, variants: { standard: { ...variant, outputEdits: [samePitch], editedSnapshots: [valid.snapshot], activeArrangement: { kind: "edited-snapshot", snapshotId: valid.snapshot.id } } } };
    const integratedIntegrity = await validateHarmonyProject(integrated, await loadProductExecutionRegistry());
    expect(integratedIntegrity.diagnostics).toEqual([]);
    expect(integratedIntegrity).toMatchObject({ status: "complete" });
    const invalidEdit: ArrangementOutputEdit = { ...samePitch, id: "edit:standard:1", pitch: { step: "C", alter: 0, octave: 9 } };
    const invalid = await materializeEditedArrangement({ lifecycleInput, intentPlan: variant.intentPlan, activityPlan: variant.activityPlan, anchorPlan: variant.anchorPlan, candidate, edits: [invalidEdit] });
    expect(invalid.status).toBe("complete");
    if (invalid.status === "complete") expect(invalid.snapshot.status).toBe("invalid");
    const stale = await materializeEditedArrangement({ lifecycleInput, intentPlan: variant.intentPlan, activityPlan: variant.activityPlan, anchorPlan: variant.anchorPlan, candidate, edits: [{ ...samePitch, baseCandidateId: "cand:stale" }] });
    expect(stale.status).toBe("blocked");
    const duplicate = await materializeEditedArrangement({ lifecycleInput, intentPlan: variant.intentPlan, activityPlan: variant.activityPlan, anchorPlan: variant.anchorPlan, candidate, edits: [samePitch, { ...samePitch, id: "edit:standard:2" }] });
    expect(duplicate.status).toBe("blocked");
  });

  it("blocks note-to-rest anchor destruction and an unpaired set-tie", async () => {
    const { project } = await generatedProject();
    const variant = project.variants.standard;
    if (!variant || variant.lifecycle !== "generation-attempted") return;
    const candidate = variant.generationResult.candidates.find((item) => Object.values(item.generatedEventsByTrack).flat().some((event) => event.kind === "note" && event.originDirectiveId))!;
    const event = Object.values(candidate.generatedEventsByTrack).flat().find((item) => item.kind === "note" && item.originDirectiveId)!;
    if (event.kind !== "note") return;
    const lifecycleInput = await (await import("./workspace")).wagInputFromProject(project, "standard");
    const noteToRest: ArrangementOutputEdit = {
      id: outputEditId("standard", candidate.contentDigest, 10), kind: "replace-event", presetId: "standard",
      baseCandidateId: candidate.id, baseCandidateDigest: candidate.contentDigest, editOrdinal: 10,
      oldEventId: event.id, replacement: { kind: "rest" },
    };
    const removed = await materializeEditedArrangement({ lifecycleInput, intentPlan: variant.intentPlan, activityPlan: variant.activityPlan, anchorPlan: variant.anchorPlan, candidate, edits: [noteToRest] });
    expect(removed.status).toBe("blocked");
    if (removed.status === "blocked") expect(removed.diagnostics[0]?.details).toMatchObject({ reason: "required-anchor-provenance" });

    const setTie: ArrangementOutputEdit = {
      id: outputEditId("standard", candidate.contentDigest, 11), kind: "set-tie", presetId: "standard",
      baseCandidateId: candidate.id, baseCandidateDigest: candidate.contentDigest, editOrdinal: 11,
      eventId: event.id, tieStart: true, tieStop: false,
    };
    const tied = await materializeEditedArrangement({ lifecycleInput, intentPlan: variant.intentPlan, activityPlan: variant.activityPlan, anchorPlan: variant.anchorPlan, candidate, edits: [setTie] });
    expect(tied.status).toBe("blocked");
    if (tied.status === "blocked") expect(tied.diagnostics[0]?.details).toMatchObject({ reason: "tie-structure" });
  });

  it("validates illegal edited chord tones from actual pitches and recomputes all metrics", async () => {
    const { project } = await generatedProject();
    const variant = project.variants.standard;
    if (!variant || variant.lifecycle !== "generation-attempted") return;
    const candidate = variant.generationResult.candidates.find((item) => Object.values(item.generatedEventsByTrack).flat().some((event) => event.kind === "note" && event.originDirectiveId))!;
    const event = Object.values(candidate.generatedEventsByTrack).flat().find((item) => item.kind === "note" && item.originDirectiveId)!;
    if (event.kind !== "note") return;
    const edit: ArrangementOutputEdit = {
      id: outputEditId("standard", candidate.contentDigest, 20), kind: "replace-pitch", presetId: "standard",
      baseCandidateId: candidate.id, baseCandidateDigest: candidate.contentDigest, editOrdinal: 20,
      eventId: event.id, pitch: pitch("C", 5, 1),
    };
    const result = await materializeEditedArrangement({
      lifecycleInput: await (await import("./workspace")).wagInputFromProject(project, "standard"),
      intentPlan: variant.intentPlan, activityPlan: variant.activityPlan, anchorPlan: variant.anchorPlan,
      candidate, edits: [edit],
    });
    expect(result.status).toBe("complete");
    if (result.status !== "complete") return;
    expect(result.snapshot.status).toBe("invalid");
    expect(result.snapshot.validationDiagnostics.map((diagnostic) => diagnostic.code)).toContain("GENERATED_CHORD_ROLE_CONFLICT");
    expect(result.snapshot.metrics.sourceChordRespect.denominator).toBeGreaterThan(0);
    expect(result.snapshot.metrics.sourceChordRespect.numerator).toBeLessThan(result.snapshot.metrics.sourceChordRespect.denominator);
    expect(Object.keys(result.snapshot.metrics.densityBySectionOccurrence)).toEqual(project.source.sectionOccurrences.map((section) => section.id));
    expect(Object.keys(result.snapshot.metrics.maxLeapSemitonesByTrack).sort()).toEqual(Object.keys(candidate.generatedEventsByTrack).sort());
    expect(result.snapshot.metrics.hardDiagnosticCount).toBeGreaterThan(0);
  });

  it("materializes rest-to-note edits and recomputes changed density from edited tracks", async () => {
    const { input } = await materializeSegmentBFixture("hm-original-activity-hard-leap-dead-end-v0");
    const { planWagActivity, planWagAnchor, planWagIntent } = await import("../grammar/lifecycle");
    const intent = await planWagIntent(input);
    if (intent.status === "blocked") throw new Error("intent blocked");
    const activity = await planWagActivity(input, intent.value);
    if (activity.status === "blocked") throw new Error("activity blocked");
    const anchor = await planWagAnchor(input, intent.value, activity.value);
    if (anchor.status === "blocked") throw new Error("anchor blocked");
    const solver = await (await import("../grammar/solver")).solveWagLocally(input, intent.value, activity.value, anchor.value);
    if (solver.status === "blocked") throw new Error("solver blocked");
    const generation = await (await import("../grammar/pipeline")).assembleWagGeneration(input, intent.value, activity.value, anchor.value, solver.value);
    const candidate = generation.result.candidates.find((item) => Object.values(item.generatedEventsByTrack).flat().some((event) => event.kind === "rest"))!;
    const rest = Object.values(candidate.generatedEventsByTrack).flat().find((item) => item.kind === "rest")!;
    const edit: ArrangementOutputEdit = {
      id: outputEditId("simple", candidate.contentDigest, 30), kind: "replace-event", presetId: "simple",
      baseCandidateId: candidate.id, baseCandidateDigest: candidate.contentDigest, editOrdinal: 30,
      oldEventId: rest.id, replacement: { kind: "note", pitch: pitch("G", 4), tieStart: false, tieStop: false },
    };
    const result = await materializeEditedArrangement({
      lifecycleInput: input, intentPlan: intent.value, activityPlan: activity.value, anchorPlan: anchor.value,
      candidate, edits: [edit],
    });
    expect(result.status).toBe("complete");
    if (result.status !== "complete") return;
    expect(result.snapshot.generatedHarmonyTracks.flatMap((track) => track.events).find((event) => event.id === rest.id)).toMatchObject({ kind: "note", source: "user-edit" });
    const sectionId = input.source.sectionOccurrences[0].id;
    expect(result.snapshot.metrics.densityBySectionOccurrence[sectionId].participationCoverage.valueBp)
      .toBeGreaterThan(candidate.metrics.densityBySectionOccurrence[sectionId].participationCoverage.valueBp ?? 0);
  });

  it("selects invalid snapshots for inspection but disables default export/share", async () => {
    const { project } = await generatedProject();
    const variant = project.variants.standard;
    if (!variant || variant.lifecycle !== "generation-attempted") return;
    const candidate = variant.generationResult.candidates.find((item) => Object.keys(item.generatedEventsByTrack).length > 0)!;
    const event = Object.values(candidate.generatedEventsByTrack).flat().find((item) => item.kind === "note")!;
    if (event.kind !== "note") return;
    const edit: ArrangementOutputEdit = { id: "edit:invalid:0", kind: "replace-pitch", presetId: "standard", baseCandidateId: candidate.id, baseCandidateDigest: candidate.contentDigest, editOrdinal: 0, eventId: event.id, pitch: { step: "C", alter: 0, octave: 9 } };
    const result = await materializeEditedArrangement({ lifecycleInput: await (await import("./workspace")).wagInputFromProject(project, "standard"), intentPlan: variant.intentPlan, activityPlan: variant.activityPlan, anchorPlan: variant.anchorPlan, candidate, edits: [edit] });
    if (result.status !== "complete") throw new Error("fixture blocked");
    const withSnapshot: HarmonyProject = { ...project, variants: { standard: { ...variant, outputEdits: [edit], editedSnapshots: [result.snapshot] } } };
    const selected = selectActiveSnapshot(withSnapshot, "standard", result.snapshot.id);
    const materialized = materializeActiveArrangement(selected, "standard");
    expect(materialized.validity).toBe("invalid");
    expect(canDefaultExportOrShare(materialized)).toBe(false);
  });
});

describe("deterministic export, local save, project transfer, and PracticeShare", () => {
  it("exports deterministic MusicXML that the accepted importer can parse", async () => {
    const { project } = await generatedProject();
    const materialized = materializeActiveArrangement(project, "standard");
    const document = materialized.document;
    const first = exportArrangementMusicXml(document, materialized.trackRoles, { title: project.source.title, composer: project.source.composer, key: project.source.defaultKey });
    const second = exportArrangementMusicXml(document, materialized.trackRoles, { title: project.source.title, composer: project.source.composer, key: project.source.defaultKey });
    expect(first).toBe(second);
    expect(first).not.toMatch(/session|csrf|database|share-token|objects\//iu);
    const imported = await importMusicXml(new TextEncoder().encode(first), { algorithmVersions: { performanceExpanderVersion: "repeat-v1", chordTimelineResolverVersion: "chord-timeline-v1", sourceLeadAtomizerVersion: "source-lead-atomizer-v1" } });
    expect(imported.status).toBe("review-required");
  });

  it("round-trips accidental, altered, omitted, extended slash chords and rhythmic notation", async () => {
    const { project } = await generatedProject();
    const base = materializeActiveArrangement(project, "standard");
    const durations = [fraction(4)];
    const chord = parseChord("EbmMaj9add13#11no5/Gb");
    expect(chord.status).toBe("ok");
    if (chord.status !== "ok") return;
    const firstAtom = base.document.sourceLeadTrack.atoms[0];
    const secondAtom = base.document.sourceLeadTrack.atoms[1] ?? firstAtom;
    const document: ArrangementRenderDocument = {
      ...base.document,
      sourceLeadTrack: {
        ...base.document.sourceLeadTrack,
        atoms: [
          { ...firstAtom, id: "ta:export:0", sourceEventId: "se:export:0", range: musicalRange({ performanceMeasureIndex: 0, offset: fraction(0) }, { performanceMeasureIndex: 0, offset: fraction(3, 2) }, durations), tiedFromPrevious: false, tiedToNext: false, lyricTokenIds: [] },
          { ...secondAtom, id: "ta:export:1", sourceEventId: "se:export:1", range: musicalRange({ performanceMeasureIndex: 0, offset: fraction(3, 2) }, { performanceMeasureIndex: 0, offset: fraction(11, 6) }, durations), tiedFromPrevious: false, tiedToNext: false, lyricTokenIds: [] },
        ],
      },
      generatedHarmonyTracks: [],
      lyricTokens: [],
      effectiveChordTimeline: {
        ...base.document.effectiveChordTimeline,
        spans: [{ ...base.document.effectiveChordTimeline.spans[0], id: "pcs:export:0", range: musicalRange({ performanceMeasureIndex: 0, offset: fraction(0) }, { performanceMeasureIndex: 1, offset: fraction(0) }, durations), parseResult: chord }],
      },
    };
    const roles = { generatedTracks: [], byTrackPlanId: {} } as const;
    const encoded = exportArrangementMusicXml(document, roles, { title: "Adversarial", key: { tonic: { step: "E", alter: -1 }, mode: "minor" } });
    expect(encoded).toContain("<root-step>E</root-step><root-alter>-1</root-alter>");
    expect(encoded).toContain(`<kind text="${chord.chord.canonicalSymbol.slice(2, -3)}">`);
    expect(encoded).toContain("<bass-step>G</bass-step><bass-alter>-1</bass-alter>");
    expect(encoded).toContain("<degree-type>add</degree-type>");
    expect(encoded).toContain("<degree-type>alter</degree-type>");
    expect(encoded).toContain("<degree-type>subtract</degree-type>");
    expect(encoded).toMatch(/<type>quarter<\/type><dot\/>/u);
    expect(encoded).toContain("<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>");
    const imported = await importMusicXml(new TextEncoder().encode(encoded), { algorithmVersions: { performanceExpanderVersion: "repeat-v1", chordTimelineResolverVersion: "chord-timeline-v1", sourceLeadAtomizerVersion: "source-lead-atomizer-v1" } });
    expect(imported.status).toBe("review-required");
    if (imported.status === "review-required") {
      const reparsed = imported.draft.parts[0].measures[0].chords[0].parseResult;
      expect(reparsed.status).toBe("ok");
      if (reparsed.status === "ok") expect(reparsed.chord.canonicalSymbol).toBe(chord.chord.canonicalSymbol);
    }
  });

  it("round-trips canonical project bytes through validation and local durable adapter", async () => {
    const { project } = await generatedProject();
    const integrity = await validateHarmonyProject(project, await loadProductExecutionRegistry());
    expect(integrity.diagnostics).toEqual([]);
    expect(integrity).toMatchObject({ status: "complete" });
    const encoded = await exportHarmonyProject(project);
    const reloaded = await importHarmonyProject(encoded);
    expect(await exportHarmonyProject(reloaded)).toBe(encoded);
    expect((await validateHarmonyProject(reloaded, await loadProductExecutionRegistry())).status).toBe("complete");
    const store = new MemoryLocalProjectStore();
    await store.save({ projectId: "local-project", updatedAt: "2026-01-01T00:00:00.000Z", project });
    expect((await store.load("local-project"))?.project).toEqual(project);
    expect(await store.list()).toEqual([{ projectId: "local-project", updatedAt: "2026-01-01T00:00:00.000Z" }]);
    await store.delete("local-project");
    expect(await store.load("local-project")).toBeUndefined();
    await expect(importHarmonyProject(encoded.replace(project.source.revisionDigest, "0".repeat(64)))).rejects.toThrow("PROJECT_INTEGRITY_INVALID");
  });

  it("materializes a compact rights-gated PracticeShare with local identities and URL round-trip", async () => {
    const { project } = await generatedProject();
    const materialized = materializeActiveArrangement(project, "standard");
    const withoutShareRights = { ...project, source: { ...project.source, rights: { ...project.source.rights, allowedUses: project.source.rights.allowedUses.filter((use) => use !== "share") } } };
    expect(() => materializePracticeShare({ project: withoutShareRights, presetId: "standard", materialized })).toThrow("SHARE_RIGHTS_REQUIRED");
    const shareProject = confirmShareRights(project, "2026-01-01T00:00:00.000Z");
    const payload = materializePracticeShare({ project: shareProject, presetId: "standard", materialized, playbackDefaults: { speedPercent: 75, selectedTrackIndex: 1, accompanimentEnabled: true } });
    expect(payload.rightsShareConfirmed).toBe(true);
    expect(payload.lyrics.every((token) => /^ly:\d+$/u.test(token.id))).toBe(true);
    const encoded = encodeProductUrlShare(payload);
    expect(decodeProductUrlShare(encoded)).toEqual(payload);
    const sharedDocument = practiceShareToRenderDocument(decodeProductUrlShare(encoded));
    const sharedRoles = (await import("./shared-practice")).materializeSharedPractice(decodeProductUrlShare(encoded)).trackRoles;
    expect(sharedDocument.sourceLeadTrack.atoms).toHaveLength(payload.arrangement.tracks.find((track) => track.kind === "source-lead")?.events.length ?? 0);
    expect(buildPlaybackPlan(sharedDocument, sharedRoles, await generateDeterministicAccompaniment(sharedDocument.effectiveChordTimeline)).events.length).toBeGreaterThan(0);
    expect(JSON.stringify(payload)).not.toMatch(/documentId|session|csrf|database|objectKey|lock/iu);
  });
});
