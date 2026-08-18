import { describe, expect, it } from "vitest";

import { generateDeterministicAccompaniment } from "../accompaniment/deterministic";
import { parseChord } from "../domain/chord/parser";
import type { ParsedChord } from "../domain/chord/model";
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
import { canonicalLockScopeKey, canonicalLockTargets, lockFromCanonicalTarget, outputEditTargetId, staleBoundaryPresentation, upsertCanonicalStageLock, type UiStageLock } from "./workspace-controls";
import type { WagLifecycleInput } from "../grammar/lifecycle";

function chordToneSet(chord: ParsedChord) {
  return {
    root: chord.root,
    tones: chord.tones.map((tone) => ({ degree: tone.degree, alteration: tone.alteration })),
    bass: chord.bass ?? null,
  };
}

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
  it("rejects an unresolved or incomplete persisted OMR context at the generation boundary", async () => {
    const { project } = await generatedProject();
    const unresolved = {
      ...project,
      source: {
        ...project.source,
        importInfo: {
          sourceKind: "omr" as const,
          importerVersion: "omr-normalizer-v1",
          omrReviewRecord: {
            vendorId: "provider:test", vendorResultDigest: "a".repeat(64) as never, autoRepairs: [], corrections: [],
            reviewItems: [{
              id: "review:open", target: { sourceRevision: { documentId: project.source.documentId, revisionOrdinal: project.source.revisionOrdinal, revisionDigest: project.source.revisionDigest }, target: { kind: "measure" as const, sourceMeasureId: project.source.sourceMeasures[0].id } },
              reasonCode: "OMR_REVIEW_REQUIRED" as const, alternatives: [{ id: "alternative:open", labelKo: "검토", patch: { kind: "insert-barline" as const } }], evidenceIds: [], resolution: { status: "open" as const },
            }],
          },
        },
      },
    } as HarmonyProject;
    await expect(generateProjectVariant(unresolved, "standard")).rejects.toThrow("PROJECT_INTEGRITY_INVALID");
  });

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
    expect(abc).toContain("%%score lead h2 h1");
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

  it("derives operational H1/H2 from the frozen marginal selection key when canonical ordinal 2 is H1", async () => {
    const baseInput = await createWagFixtureInput({ presetId: "standard", maxHarmonyTracks: 2 });
    const input = {
      ...baseInput,
      performers: baseInput.performers.map((performer, index) => index === 1 ? {
        ...performer,
        comfortableRange: { low: pitch("E", 4), high: pitch("E", 4) },
        preferredTessitura: { low: pitch("E", 4), high: pitch("E", 4) },
      } : performer),
    };
    const { project, generated } = await generatedProject(input);
    const materialized = materializeActiveArrangement(project, "standard");
    const variant = project.variants.standard;
    if (!variant || variant.lifecycle !== "generation-attempted") throw new Error("missing generated variant");
    expect(generated.execution.generation.marginals.map((marginal) => marginal.track.trackPlanId)).toEqual(["track:h2", "track:h1"]);
    expect(variant.candidateHarmonyRoles).toEqual([
      expect.objectContaining({ trackPlanId: "track:h2", harmonyRole: "H1" }),
      expect.objectContaining({ trackPlanId: "track:h1", harmonyRole: "H2" }),
    ]);
    expect((await validateHarmonyProject(project, await loadProductExecutionRegistry())).status).toBe("complete");
    await expect(exportHarmonyProject(project)).resolves.toContain('"harmonyRole":"H1"');
    expect(materialized.trackRoles.byTrackPlanId["track:h1"]).toMatchObject({ harmonyRole: "H2", label: "Upper / H2" });
    expect(materialized.trackRoles.byTrackPlanId["track:h2"]).toMatchObject({ harmonyRole: "H1", label: "Lower / H1" });
    const abc = arrangementRenderDocumentToAbc(materialized.document, materialized.trackRoles, { title: project.source.title, tempo: project.source.defaultTempo, key: project.source.defaultKey });
    expect(abc).toContain('V:h2 name="Upper / H2"');
    expect(abc).toContain('V:h1 name="Lower / H1"');
    const plan = buildPlaybackPlan(materialized.document, materialized.trackRoles);
    expect(plan.trackLabels).toMatchObject({ "track:h1": "Upper / H2", "track:h2": "Lower / H1" });
    const payload = materializePracticeShare({ project: confirmShareRights(project), presetId: "standard", materialized });
    expect(payload.arrangement.tracks.filter((track) => track.kind === "generated-harmony").map((track) => track.label)).toEqual(["Upper / H2", "Lower / H1"]);
    const shared = (await import("./shared-practice")).materializeSharedPractice(payload);
    expect(shared.trackRoles.byTrackPlanId["share:track:h1"]).toMatchObject({ harmonyRole: "H1", label: "Lower / H1" });
    expect(buildPlaybackPlan(shared.document, shared.trackRoles).trackLabels["share:track:h1"]).toBe("Lower / H1");
    const musicXml = exportArrangementMusicXml(materialized.document, materialized.trackRoles, { title: project.source.title, key: project.source.defaultKey });
    expect(musicXml).toContain('<score-part id="P-H1"><part-name>Lower / H1</part-name>');
    expect(musicXml).toContain('<score-part id="P-H2"><part-name>Upper / H2</part-name>');
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

  it("exposes canonical targets for every lock stage and preserves the earliest stale boundary", async () => {
    const { project } = await generatedProject();
    const variant = project.variants.standard;
    if (!variant || variant.lifecycle !== "generation-attempted") return;
    const candidate = variant.generationResult.candidates.find((item) => Object.keys(item.generatedEventsByTrack).length > 0)!;
    const targets = canonicalLockTargets({ project, intentPlan: variant.intentPlan, activityPlan: variant.activityPlan, anchorPlan: variant.anchorPlan, candidate });
    expect(new Set(targets.map((target) => target.stage))).toEqual(new Set(["intent", "activity", "anchor", "solver"]));
    expect(targets.map((target) => target.key)).toEqual([...new Set(targets.map((target) => target.key))]);
    const locks = Object.fromEntries(["intent", "activity", "anchor", "solver"].map((stage) => {
      const target = targets.find((candidateTarget) => candidateTarget.stage === stage)!;
      return [stage, lockFromCanonicalTarget({ presetId: "standard", target, ordinal: targets.indexOf(target) })];
    })) as Record<"intent" | "activity" | "anchor" | "solver", UiStageLock>;
    for (const [stage, lock] of Object.entries(locks)) expect(lock.kind === "pitch" ? "solver" : lock.kind === "activity" ? "activity" : lock.kind.startsWith("anchor-") ? "anchor" : "intent").toBe(stage);
    const replaced = { ...locks.solver, id: "lk:standard:ui:solver:99" } as UiStageLock;
    expect(upsertCanonicalStageLock([locks.solver], replaced)).toHaveLength(1);
    expect(canonicalLockScopeKey(replaced)).toBe(canonicalLockScopeKey(locks.solver));

    const solverStale = replaceStageLocks(project, "standard", "solver", [locks.solver]);
    expect(solverStale.variants.standard?.staleness?.staleFrom).toBe("generation");
    const intentStale = replaceStageLocks(solverStale, "standard", "intent", [locks.intent]);
    expect(intentStale.variants.standard?.staleness?.staleFrom).toBe("intent");
    const stillIntent = replaceStageLocks(intentStale, "standard", "solver", [locks.solver]);
    expect(stillIntent.variants.standard?.staleness?.staleFrom).toBe("intent");
    expect(staleBoundaryPresentation("intent")).toBe("staleFrom=intent · regenerate Intent → Activity → Anchor → Solver → assembly → Validator");
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
    expect(outputEditTargetId(samePitch)).toBe(event.id);
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
    expect(result.snapshot.metrics.sourceChordRespect.denominator).toBe(candidate.metrics.sourceChordRespect.denominator + 1);
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
    const withoutKindText = encoded.replace(/ text="[^"]*"/gu, "");
    const imported = await importMusicXml(new TextEncoder().encode(withoutKindText), { algorithmVersions: { performanceExpanderVersion: "repeat-v1", chordTimelineResolverVersion: "chord-timeline-v1", sourceLeadAtomizerVersion: "source-lead-atomizer-v1" } });
    expect(imported.status).toBe("review-required");
    if (imported.status === "review-required") {
      const reparsed = imported.draft.parts[0].measures[0].chords[0].parseResult;
      expect(reparsed.status).toBe("ok");
      if (reparsed.status === "ok") {
        expect(chordToneSet(reparsed.chord)).toEqual(chordToneSet(chord.chord));
        expect(reparsed.chord.omissions).toEqual(chord.chord.omissions);
      }
    }
  });

  it.each([
    ["mMaj9", "CmMaj9"],
    ["augMaj7", "Cmaj7#5"],
    ["m7b5", "Cm7b5"],
    ["dim7", "Cdim7"],
    ["addition", "Cadd9add13"],
    ["omission", "Cno5"],
    ["alterations", "C7b9#11"],
    ["suspension", "Csus4"],
    ["slash bass", "EbmMaj9add13#11no5/Gb"],
  ])("reconstructs %s chord tones from structured MusicXML without kind text", async (_caseName, symbol) => {
    const parsed = parseChord(symbol);
    expect(parsed.status).toBe("ok");
    if (parsed.status !== "ok") return;
    const { project } = await generatedProject();
    const base = materializeActiveArrangement(project, "standard");
    const document: ArrangementRenderDocument = {
      ...base.document,
      effectiveChordTimeline: {
        ...base.document.effectiveChordTimeline,
        spans: base.document.effectiveChordTimeline.spans.map((span, index) => index === 0 ? { ...span, parseResult: parsed } : span),
      },
    };
    const encoded = exportArrangementMusicXml(document, base.trackRoles, { title: `Structured ${_caseName}`, key: project.source.defaultKey })
      .replace(/ text="[^"]*"/gu, "");
    const imported = await importMusicXml(new TextEncoder().encode(encoded), { algorithmVersions: { performanceExpanderVersion: "repeat-v1", chordTimelineResolverVersion: "chord-timeline-v1", sourceLeadAtomizerVersion: "source-lead-atomizer-v1" } });
    expect(imported.status).toBe("review-required");
    if (imported.status !== "review-required") return;
    const reconstructed = imported.draft.parts[0].measures[0].chords[0].parseResult;
    expect(reconstructed.status).toBe("ok");
    if (reconstructed.status !== "ok") return;
    expect(chordToneSet(reconstructed.chord)).toEqual(chordToneSet(parsed.chord));
    expect(reconstructed.chord.omissions).toEqual(parsed.chord.omissions);
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

  it("migrates a schema-v9 project without candidate roles to explicit generation staleness", async () => {
    const baseInput = await createWagFixtureInput({ presetId: "standard", maxHarmonyTracks: 2 });
    const input = {
      ...baseInput,
      performers: baseInput.performers.map((performer, index) => index === 1 ? {
        ...performer,
        comfortableRange: { low: pitch("E", 4), high: pitch("E", 4) },
        preferredTessitura: { low: pitch("E", 4), high: pitch("E", 4) },
      } : performer),
    };
    const { project } = await generatedProject(input);
    const original = project.variants.standard;
    if (!original || original.lifecycle !== "generation-attempted") throw new Error("missing generated variant");
    expect(original.candidateHarmonyRoles[0]).toMatchObject({ trackPlanId: "track:h2", harmonyRole: "H1" });
    const legacy = JSON.parse(await exportHarmonyProject(project)) as { variants: { standard: Record<string, unknown> } };
    delete legacy.variants.standard.candidateHarmonyRoles;
    expect((await validateHarmonyProject(legacy, await loadProductExecutionRegistry())).status).toBe("blocked");

    const migrated = await importHarmonyProject(JSON.stringify(legacy));
    const stale = migrated.variants.standard;
    if (!stale || stale.lifecycle !== "generation-attempted") throw new Error("missing migrated variant");
    expect(stale.candidateHarmonyRoles).toEqual([]);
    expect(stale.staleness?.staleFrom).toBe("generation");
    expect(stale.activeArrangement).toBeUndefined();
    expect(() => materializeActiveArrangement(migrated, "standard")).toThrow("ACTIVE_ARRANGEMENT_UNAVAILABLE");
    await expect(exportHarmonyProject(migrated)).resolves.toContain('"staleFrom":"generation"');

    const regenerated = await generateProjectVariant(migrated, "standard");
    expect(regenerated.status).not.toBe("blocked");
    if (regenerated.status === "blocked") return;
    const regeneratedVariant = regenerated.project.variants.standard;
    if (!regeneratedVariant || regeneratedVariant.lifecycle !== "generation-attempted") throw new Error("missing regenerated variant");
    expect(regeneratedVariant.staleness).toBeUndefined();
    expect(regeneratedVariant.candidateHarmonyRoles).toEqual(original.candidateHarmonyRoles);
    expect(regeneratedVariant.candidateHarmonyRoles[0]).toMatchObject({ trackPlanId: "track:h2", harmonyRole: "H1" });
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
