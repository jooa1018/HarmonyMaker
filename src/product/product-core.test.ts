import { describe, expect, it } from "vitest";

import { generateDeterministicAccompaniment } from "../accompaniment/deterministic";
import type { ArrangementOutputEdit } from "../domain/edit/model";
import type { HarmonyProject } from "../domain/project";
import { validateHarmonyProject } from "../domain/project";
import { normalizeSongSourceDocument } from "../domain/source/normalize";
import { computeRevisionHistoryDigest } from "../domain/source/revision";
import { createWagFixtureInput, pitch } from "../grammar/fixtures";
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
import { generateProjectVariant, type ProductGenerationOutcome } from "./workspace";

async function generatedProject(): Promise<{ readonly project: HarmonyProject; readonly generated: Extract<ProductGenerationOutcome, { readonly status: "complete" | "partial" }> }> {
  const input = await createWagFixtureInput({ presetId: "standard", maxHarmonyTracks: 2 });
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
    const abc = arrangementRenderDocumentToAbc(materialized.document, { title: project.source.title, tempo: project.source.defaultTempo, key: project.source.defaultKey });
    expect(abc).toContain("%%score lead h1 h2");
    const accompaniment = await generateDeterministicAccompaniment(materialized.document.effectiveChordTimeline);
    const plan = buildPlaybackPlan(materialized.document, accompaniment);
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
    expect(() => replaceStageLocks(project, "standard", "intent", [lock])).toThrow("STAGE_LOCK_SCOPE_INVALID");
    expect(() => materializeActiveArrangement(stale, "standard")).toThrow("ACTIVE_ARRANGEMENT_UNAVAILABLE");
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
    const samePitch: ArrangementOutputEdit = { id: "edit:standard:0", kind: "replace-pitch", presetId: "standard", baseCandidateId: candidate.id, baseCandidateDigest: candidate.contentDigest, editOrdinal: 0, eventId: event.id, pitch: event.pitch };
    const lifecycleInput = await (await import("./workspace")).wagInputFromProject(project, "standard");
    const valid = await materializeEditedArrangement({ lifecycleInput, intentPlan: variant.intentPlan, activityPlan: variant.activityPlan, anchorPlan: variant.anchorPlan, candidate, edits: [samePitch] });
    expect(valid.status).toBe("complete");
    if (valid.status !== "complete") return;
    expect(valid.snapshot.status).toBe("valid");
    expect(JSON.stringify(candidate)).toBe(baseJson);
    const invalidEdit: ArrangementOutputEdit = { ...samePitch, id: "edit:standard:1", pitch: { step: "C", alter: 0, octave: 9 } };
    const invalid = await materializeEditedArrangement({ lifecycleInput, intentPlan: variant.intentPlan, activityPlan: variant.activityPlan, anchorPlan: variant.anchorPlan, candidate, edits: [invalidEdit] });
    expect(invalid.status).toBe("complete");
    if (invalid.status === "complete") expect(invalid.snapshot.status).toBe("invalid");
    const stale = await materializeEditedArrangement({ lifecycleInput, intentPlan: variant.intentPlan, activityPlan: variant.activityPlan, anchorPlan: variant.anchorPlan, candidate, edits: [{ ...samePitch, baseCandidateId: "cand:stale" }] });
    expect(stale.status).toBe("blocked");
    const duplicate = await materializeEditedArrangement({ lifecycleInput, intentPlan: variant.intentPlan, activityPlan: variant.activityPlan, anchorPlan: variant.anchorPlan, candidate, edits: [samePitch, { ...samePitch, id: "edit:standard:2" }] });
    expect(duplicate.status).toBe("blocked");
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
    const document = materializeActiveArrangement(project, "standard").document;
    const first = exportArrangementMusicXml(document, { title: project.source.title, composer: project.source.composer, key: project.source.defaultKey });
    const second = exportArrangementMusicXml(document, { title: project.source.title, composer: project.source.composer, key: project.source.defaultKey });
    expect(first).toBe(second);
    expect(first).not.toMatch(/session|csrf|database|share-token|objects\//iu);
    const imported = await importMusicXml(new TextEncoder().encode(first), { algorithmVersions: { performanceExpanderVersion: "repeat-v1", chordTimelineResolverVersion: "chord-timeline-v1", sourceLeadAtomizerVersion: "source-lead-atomizer-v1" } });
    expect(imported.status).toBe("review-required");
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
    expect(JSON.stringify(payload)).not.toMatch(/documentId|session|csrf|database|objectKey|lock/iu);
  });
});
