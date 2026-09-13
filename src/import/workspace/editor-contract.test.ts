import { describe, expect, it } from "vitest";
import { fraction } from "../../domain/fraction";
import { APPLICATION_ALGORITHM_VERSION_REGISTRY as V } from "../../app/algorithm-version-registry";
import { originFromMusicXml, workspaceEvidenceDigest } from "./input";
import { applyWorkspaceCommand, createScoreWorkspace, exportScoreWorkspace, parseScoreWorkspace, replayScoreWorkspace } from "./journal";
import { reduceWorkspaceEdit } from "./edit";
import { remainingWorkspaceNotation, workspaceNotationInventory } from "./notation";
import type { ScoreWorkspace, WorkspaceCommand } from "./model";
import { deriveQuickReview } from "..";
import { projectScoreWorkspace } from "./projection";
import { deriveWorkspaceCapabilities } from "./review";
import { validateWorkspaceSourceIntegrity } from "./source-integrity";
import { validateSongSourceDocumentIntegrity } from "../../domain/source/validation";
import { createProjectFromQuickReview } from "../../product/workspace";
import { exportHarmonyProject, importHarmonyProject } from "../../product/project-transfer";

// Newly authored fixtures only: no private scan, corrected score or answer array.
const note = (extra = "", step = "C", duration = 1) => `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>${duration}</duration><voice>1</voice>${extra}</note>`;
const chord = '<harmony><root><root-step>C</root-step></root><kind>major</kind></harmony>';
function score(first = note(), second = note("", "D"), otherPart = false) {
  const part = (id: string) => `<part id="${id}"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${chord}${first}</measure><measure number="2">${second}</measure></part>`;
  return `<score-partwise><part-list><score-part id="P1"><part-name>Fixture</part-name></score-part>${otherPart ? '<score-part id="P2"><part-name>Other part</part-name></score-part>' : ""}</part-list>${part("P1")}${otherPart ? part("P2") : ""}</score-partwise>`;
}
async function start(xml = score()) { return createScoreWorkspace(await originFromMusicXml(new TextEncoder().encode(xml), "editor-fixture.musicxml"), V, "workspace:editor-contract"); }
async function act(workspace: ScoreWorkspace, command: WorkspaceCommand) {
  return applyWorkspaceCommand(workspace, workspace, command, { id: `op:${workspace.revision}`, note: "직접 작성한 시험 원본 위치를 대조한 명시 편집", actor: "ui-test", at: "2026-09-13T00:00:00.000Z" });
}
const state = replayScoreWorkspace;
const events = async (workspace: ScoreWorkspace) => (await state(workspace)).music!.parts[0].measures.flatMap(measure => measure.leadEvents);
const unsupported = async (workspace: ScoreWorkspace) => (await state(workspace)).music!.diagnostics.filter(diagnostic => diagnostic.details?.issue === "unsupported-lead-note");
async function reviewMeasures(workspace: ScoreWorkspace) {
  const current = await state(workspace);
  for (const measure of current.music!.parts[0].measures) workspace = await act(workspace, { kind: "attest", purpose: "music", scope: { kind: "measure", measureId: measure.workspaceMeasureId!, voiceKey: current.request.lead! } });
  return workspace;
}
async function prepareSource(workspace: ScoreWorkspace, rhythmVoices: readonly string[] = []) {
  const current = await state(workspace);
  workspace = await act(workspace, { kind: "lead", lead: current.music!.leadCandidates.find(candidate => candidate.voiceKey === "1")!.key, rhythmVoices });
  workspace = await act(workspace, { kind: "tempo", tempo: { beatUnit: 4, dotted: true, bpm: 60 } });
  const pitch = (octave: number) => ({ step: "C" as const, alter: 0 as const, octave });
  workspace = await act(workspace, { kind: "performers", count: 1, slots: [{ id: "pf:0", displayName: "Explicit fixture singer", profile: { id: "pf:0", displayName: "Explicit fixture singer", hardRange: { low: pitch(3), high: pitch(6) }, comfortableRange: { low: pitch(3), high: pitch(6) } } }] });
  workspace = await act(workspace, { kind: "rights", rights: { basis: "self-authored", allowedUses: ["generation"] } });
  workspace = await act(workspace, { kind: "sections", sections: (await state(workspace)).request.sections.map(section => ({ ...section, type: "verse", confirmation: "confirmed" })), lyricVerses: {} });
  return reviewMeasures(workspace);
}
async function finalized(workspace: ScoreWorkspace) {
  const draft = await projectScoreWorkspace(workspace), review = await deriveQuickReview(draft, V);
  expect(review.state.readyForPlanning, JSON.stringify(review.diagnostics)).toBe(true);
  expect(review.source).toBeDefined();
  const source = review.source!;
  expect(await validateSongSourceDocumentIntegrity(source, { versions: V })).toBe(true);
  expect(await validateWorkspaceSourceIntegrity(source)).toBe(true);
  if (source.importInfo?.sourceKind !== "score-workspace") throw new Error("fixture Source must preserve workspace provenance");
  return { draft, review, source, metadata: source.importInfo.workspaceMetadata };
}

describe("explicit workspace editor contracts", () => {
  it("preserves old seed fields and old note command output without tracking flags", async () => {
    let workspace = await start(score(note('<notations><slur type="start" number="1"/></notations><lyric number="1"><text>old</text></lyric>')));
    const before = await state(workspace);
    expect(Object.keys(before).sort()).toEqual(["attestations", "issues", "music", "request"]);
    workspace = await act(workspace, { kind: "note", eventId: "p0m0n0", value: { kind: "note", pitch: { step: "E", alter: 0, octave: 4 }, onset: fraction(0), duration: fraction(2), tieStart: false, tieStop: false } });
    const after = await state(workspace);
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    expect((await events(workspace))[0]).toMatchObject({ workspaceEventId: "p0m0n0", pitch: { step: "E", alter: 0, octave: 4 }, duration: fraction(2), slurs: [{ number: 1, type: "start" }], lyrics: [{ text: "old" }] });
    expect(workspace.operations[0].affectedIds).toEqual(["p0m0"]);
    expect(await state(await parseScoreWorkspace(await exportScoreWorkspace(workspace)))).toEqual(after);
  });

  it("removes only the exact explicit ornament while sibling grace, tuplet and duplicate ornaments stay blocked", async () => {
    const xml = score(note('<grace/><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification><notations><ornaments><trill-mark/><trill-mark/><turn/></ornaments></notations>'));
    let workspace = await start(xml);
    const features = workspaceNotationInventory(workspace.origin);
    expect(features.map(feature => feature.feature)).toEqual(["grace:0", "time-modification:0", "ornament:trill-mark:0", "ornament:trill-mark:1", "ornament:turn:0"]);
    expect(features[2].xml).toBe("<trill-mark></trill-mark>");
    expect(await unsupported(workspace)).toHaveLength(1);
    workspace = await act(workspace, { kind: "remove-notation", eventId: "p0m0n0", feature: "ornament:trill-mark:0" });
    expect(remainingWorkspaceNotation(await state(workspace), workspace.origin).map(feature => feature.feature)).toEqual(["grace:0", "time-modification:0", "ornament:trill-mark:1", "ornament:turn:0"]);
    expect(await unsupported(workspace)).toHaveLength(1);
    expect(workspace.origin.xml).toBe(xml);
    await expect(act(workspace, { kind: "remove-notation", eventId: "p0m0n0", feature: "ornament:trill-mark:0" })).rejects.toThrow("WORKSPACE_NOTATION_TARGET_INVALID");
    for (const feature of features.filter(feature => feature.feature !== "ornament:trill-mark:0")) workspace = await act(workspace, { kind: "remove-notation", eventId: feature.eventId, feature: feature.feature });
    expect(await unsupported(workspace)).toHaveLength(0);
    expect(workspace.origin.xml).toBe(xml);
    const undone = await act(workspace, { kind: "undo" });
    expect(await unsupported(undone)).toHaveLength(1);
    expect(await state(await act(undone, { kind: "redo" }))).toEqual(await state(workspace));
  });

  it("does not remove a separate note's identical diagnosis or unusual ornament container", async () => {
    let workspace = await start(score(note('<notations><ornaments color="red"><trill-mark/></ornaments></notations>') + note('<notations><ornaments><trill-mark/></ornaments></notations>')));
    expect(await unsupported(workspace)).toHaveLength(2);
    workspace = await act(workspace, { kind: "remove-notation", eventId: "p0m0n0", feature: "ornament:trill-mark:0" });
    expect(await unsupported(workspace)).toHaveLength(2);
    workspace = await act(workspace, { kind: "remove-notation", eventId: "p0m0n0", feature: "ornament-container:0" });
    expect(await unsupported(workspace)).toHaveLength(1);
    expect(remainingWorkspaceNotation(await state(workspace), workspace.origin).map(feature => feature.eventId)).toEqual(["p0m0n1"]);
    expect((await state(workspace)).issues.filter(issue => issue.evidenceRef.startsWith("import-diagnostic/"))).toHaveLength(1);
  });

  it("rejects nonexistent immutable targets and an unprovable legacy raw mapping", async () => {
    const workspace = await start(score(note('<notations><ornaments><trill-mark/></ornaments></notations>')));
    await expect(act(workspace, { kind: "remove-notation", eventId: "p0m1n0", feature: "ornament:trill-mark:0" })).rejects.toThrow("WORKSPACE_NOTATION_TARGET_INVALID");
    await expect(act(workspace, { kind: "remove-notation", eventId: "p0m0n0", feature: "ornaments" })).rejects.toThrow("WORKSPACE_NOTATION_TARGET_INVALID");
    const current = await state(workspace);
    expect(() => reduceWorkspaceEdit(current, { kind: "remove-notation", eventId: "p0m0n0", feature: "ornament:trill-mark:0" }, "explicit", { ...workspace.origin, kind: "legacy-recovery" }, current)).toThrow("WORKSPACE_NOTATION_ORIGIN_UNMAPPABLE");
  });

  it("moves unsupported diagnoses with their stable event and restores exact original scopes when moved back", async () => {
    let workspace = await start(score(note('<notations><ornaments><trill-mark/></ornaments></notations>')));
    const originalIssue = (await state(workspace)).issues[0];
    workspace = await act(workspace, { kind: "move-event", eventId: "p0m0n0", measureId: "p0m1", onset: fraction(2) });
    workspace = await act(workspace, { kind: "event-voice", eventId: "p0m0n0", staffNumber: 2, voice: "alto" });
    const moved = await state(workspace), diagnostic = (await unsupported(workspace))[0];
    expect(diagnostic.details).toMatchObject({ workspaceEventId: "p0m0n0", workspaceMeasureId: "p0m1", measureOrdinal: 1, candidateKey: "lead:p:0:s:2:v:4:alto" });
    expect(moved.issues[0].scope).toEqual({ kind: "measure", measureId: "p0m1", voiceKey: "lead:p:0:s:2:v:4:alto" });
    expect((await events(workspace)).find(event => event.workspaceEventId === "p0m0n0")?.candidateKey).toBe("lead:p:0:s:2:v:4:alto");
    workspace = await act(workspace, { kind: "event-voice", eventId: "p0m0n0", staffNumber: 1, voice: "1" });
    workspace = await act(workspace, { kind: "move-event", eventId: "p0m0n0", measureId: "p0m0", onset: fraction(0) });
    expect((await state(workspace)).issues[0]).toEqual(originalIssue);
    workspace = await act(workspace, { kind: "remove-notation", eventId: "p0m0n0", feature: "ornament:trill-mark:0" });
    expect(await unsupported(workspace)).toHaveLength(0);
    expect(await state(await parseScoreWorkspace(await exportScoreWorkspace(workspace)))).toEqual(await state(workspace));
  });

  it("inserts note, pitch-free rhythm and rest with operation identities, preserving them on move/delete/undo", async () => {
    let workspace = await start();
    for (const eventKind of ["note", "rhythm", "rest"] as const) workspace = await act(workspace, { kind: "insert-event", eventKind, measureId: "p0m0", staffNumber: 1, voice: "2", onset: fraction(1), duration: fraction(1, 2), ...(eventKind === "note" ? { pitch: { step: "G" as const, alter: 0 as const, octave: 4 } } : {}) });
    const inserted = (await events(workspace)).filter(event => event.workspaceEventId?.startsWith("inserted:"));
    expect(inserted.map(event => event.workspaceEventId)).toEqual(["inserted:op:0", "inserted:op:1", "inserted:op:2"]);
    expect(inserted[1]).not.toHaveProperty("pitch"); expect(inserted[2]).not.toHaveProperty("pitch");
    workspace = await act(workspace, { kind: "move-event", eventId: "inserted:op:1", measureId: "p0m1", onset: fraction(3, 2) });
    expect((await events(workspace)).find(event => event.workspaceEventId === "inserted:op:1")).toMatchObject({ kind: "rhythm", onset: fraction(3, 2), duration: fraction(1, 2) });
    const moved = await state(workspace);
    workspace = await act(workspace, { kind: "remove-event", eventId: "inserted:op:1" });
    expect((await events(workspace)).some(event => event.workspaceEventId === "inserted:op:1")).toBe(false);
    expect(await state(await act(workspace, { kind: "undo" }))).toEqual(moved);
  });

  it("deletes only the selected original event and its own unsupported diagnosis, retaining the raw XML", async () => {
    let workspace = await start(score(note('<notations><ornaments><trill-mark/></ornaments></notations>') + note('<cue/>')));
    const xml = workspace.origin.xml;
    workspace = await act(workspace, { kind: "remove-event", eventId: "p0m0n0" });
    expect(await unsupported(workspace)).toHaveLength(1);
    expect((await state(workspace)).removedEventIds).toEqual(["p0m0n0"]);
    expect(workspace.origin.xml).toBe(xml);
    expect(await unsupported(await act(workspace, { kind: "undo" }))).toHaveLength(2);
  });

  it("rejects cross-part moves, invalid voices, noncanonical times and pitch invented on rhythm", async () => {
    const workspace = await start(score(undefined, undefined, true));
    await expect(act(workspace, { kind: "move-event", eventId: "p0m0n0", measureId: "p1m0", onset: fraction(0) })).rejects.toThrow("WORKSPACE_EDIT_INVALID");
    for (const voice of ["", "bad\nvoice"]) await expect(act(workspace, { kind: "event-voice", eventId: "p0m0n0", staffNumber: 1, voice })).rejects.toThrow("WORKSPACE_EDIT_INVALID");
    await expect(act(workspace, { kind: "insert-event", eventKind: "rhythm", measureId: "p0m0", staffNumber: 1, voice: "1", pitch: { step: "C", alter: 0, octave: 4 }, onset: fraction(0), duration: fraction(1) })).rejects.toThrow("WORKSPACE_EDIT_INVALID");
    await expect(act(workspace, { kind: "move-event", eventId: "p0m0n0", measureId: "p0m1", onset: { n: 2, d: 2 } })).rejects.toThrow("WORKSPACE_EDIT_INVALID");
  });

  it("changes printed short measure extent explicitly without adding notes or changing meter", async () => {
    let workspace = await start(); const before = await events(workspace);
    workspace = await act(workspace, { kind: "measure-extent", measureId: "p0m0", duration: fraction(1), implicit: true });
    expect((await state(workspace)).music!.parts[0].measures[0]).toMatchObject({ time: { numerator: 4, denominator: 4 }, duration: fraction(1), implicit: true });
    expect(await events(workspace)).toEqual(before);
    await expect(act(workspace, { kind: "measure-extent", measureId: "p0m0", duration: fraction(0), implicit: true })).rejects.toThrow("WORKSPACE_EDIT_INVALID");
  });

  it("explicitly replaces lyric syllable/verse/extend and slurs, preserving ties under versioned review", async () => {
    let workspace = await start(score(note('<tie type="start"/>')));
    workspace = await act(workspace, { kind: "event-lyrics", eventId: "p0m0n0", lyrics: [{ text: "가", verse: 2, syllabic: "begin", extend: true, musicXmlAccent: false }, { text: "", verse: 3, syllabic: "end", extend: true, musicXmlAccent: false }] });
    workspace = await act(workspace, { kind: "event-slurs", eventId: "p0m0n0", slurs: [{ number: 2, type: "start" }] });
    expect((await events(workspace))[0]).toMatchObject({ tieStart: true, slurs: [{ number: 2, type: "start" }], lyrics: [{ verse: 2, syllabic: "begin", extend: true }, { text: "", verse: 3 }] });
    expect(await state(workspace)).not.toHaveProperty("slurReviewTracking");
    expect(workspace.operations.at(-1)!.reviewDependencyVersion).toBe(2);
    expect(workspace.operations.at(-1)!.invalidatedLegacyReviewIds).toEqual([]);
    workspace = await act(workspace, { kind: "event-slurs", eventId: "p0m0n0", slurs: [] });
    expect((await events(workspace))[0]).not.toHaveProperty("slurs");
    await expect(act(workspace, { kind: "event-slurs", eventId: "p0m0n0", slurs: [{ number: 1, type: "start" }, { number: 1, type: "start" }] })).rejects.toThrow("WORKSPACE_EDIT_INVALID");
    expect(await state(await parseScoreWorkspace(await exportScoreWorkspace(workspace)))).toEqual(await state(workspace));
  });

  it("moves and removes a chord without rebasing its stable ID or silently changing its text", async () => {
    let workspace = await start(); const before = (await state(workspace)).music!.parts[0].measures[0].chords[0];
    workspace = await act(workspace, { kind: "move-chord", chordId: before.key, measureId: "p0m1", onset: fraction(2) });
    const after = (await state(workspace)).music!.parts[0].measures[1].chords[0];
    expect(after).toMatchObject({ key: before.key, sourceText: before.sourceText, measureOrdinal: 1, onset: fraction(2), confirmation: "unconfirmed", source: "manual" });
    workspace = await act(workspace, { kind: "remove-chord", chordId: before.key });
    expect((await state(workspace)).music!.parts[0].measures.flatMap(measure => measure.chords)).toEqual([]);
    expect((await state(await act(workspace, { kind: "undo" }))).music!.parts[0].measures[1].chords[0]).toEqual(after);
  });

  it("rejects stale revision and tampered command/proof after editor operations", async () => {
    const original = await start(), changed = await act(original, { kind: "measure-extent", measureId: "p0m0", duration: fraction(1), implicit: true });
    await expect(applyWorkspaceCommand(changed, original, { kind: "remove-event", eventId: "p0m0n0" }, { id: "next", actor: "ui-test", note: "explicit fixture comparison", at: "2026-09-13T00:00:00Z" })).rejects.toThrow("WORKSPACE_STALE_REVISION");
    const serialized = JSON.parse(await exportScoreWorkspace(changed)); serialized.operations[0].command.duration = fraction(2);
    await expect(parseScoreWorkspace(JSON.stringify(serialized))).rejects.toThrow("WORKSPACE_HISTORY_SEAL_INVALID");
  });

  it("replays the frozen public pre-editor proof produced by ba5a985 without changing its seed or operation digests", async () => {
    // Generated once with ba5a985's model/edit/journal/review code loaded from
    // git, using this public fixture. This is not a private A validation claim.
    let workspace = await start();
    expect(workspace.digest).toBe("60b9d9321a6f1ceac0e6fba0c067219574fe03da6934a28d8077a8eacbd4691c");
    expect(workspace.historyDigest).toBe("57d426d1d475c031fdb93010b6ec553949d2c4dee6fe50ecb804ea4f49fd585f");
    workspace = await act(workspace, { kind: "title", title: "Frozen public legacy proof" });
    workspace = await act(workspace, { kind: "note", eventId: "p0m0n0", value: { kind: "note", pitch: { step: "E", alter: 0, octave: 4 }, onset: fraction(0), duration: fraction(2), tieStart: false, tieStop: false } });
    workspace = await act(workspace, { kind: "tempo", tempo: { beatUnit: 4, dotted: true, bpm: 60 } });
    expect(workspace.digest).toBe("bb6fb089ed9d63feaacc95343543691012d33d222b0399760c3b042c09f1e6d9");
    const frozen = { ...workspace, historyDigest: "645b9da00ed97b9dc7335d8b50e0316fe1fe8b7f57349d739c82e7ce9bf4c06b", operations: workspace.operations.map(operation => {
      const { reviewDependencyVersion: omittedVersion, invalidatedLegacyReviewIds: omittedInvalidations, ...old } = operation;
      void omittedVersion; void omittedInvalidations; return old;
    }) };
    // New apply calls use v2 metadata. The fixed old seal must still validate
    // the original unmarked operations, rather than being silently resealed.
    expect(await parseScoreWorkspace(JSON.stringify(frozen))).toEqual(frozen);
    expect(await parseScoreWorkspace(await exportScoreWorkspace(workspace))).toEqual(workspace);
  });

  it("requires new comparison after exact notation removal and finalizes corrected lyric text with a matching Source proof", async () => {
    let workspace = await prepareSource(await start(score(note('<notations><ornaments><trill-mark/></ornaments></notations>'))));
    const evidence = await workspaceEvidenceDigest(workspace.origin);
    await expect(projectScoreWorkspace(workspace)).rejects.toThrow("WORKSPACE_NOT_READY");
    workspace = await act(workspace, { kind: "remove-notation", eventId: "p0m0n0", feature: "ornament:trill-mark:0" });
    const capabilities = await deriveWorkspaceCapabilities(await state(workspace), evidence);
    expect(capabilities.musicReviews.map(review => review.current)).toEqual([false, true]);
    await expect(projectScoreWorkspace(workspace)).rejects.toThrow("WORKSPACE_NOT_READY");
    workspace = await act(workspace, { kind: "event-lyrics", eventId: "p0m0n0", lyrics: [{ text: "독립", verse: 2, syllabic: "begin", extend: true, musicXmlAccent: false }] });
    workspace = await act(workspace, { kind: "event-lyrics", eventId: "p0m1n0", lyrics: [{ text: "가사", verse: 2, syllabic: "end", extend: false, musicXmlAccent: false }] });
    workspace = await reviewMeasures(workspace);
    const { draft, review, source, metadata } = await finalized(workspace);
    expect(source.sourceMeasures.flatMap(measure => measure.lyricTokens).map(token => ({ text: token.text, verse: token.verse, syllabic: token.syllabic, extend: token.extend }))).toEqual([
      { text: "독립", verse: 2, syllabic: "begin", extend: true }, { text: "가사", verse: 2, syllabic: "end", extend: false }]);
    expect(source.defaultTempo).toEqual({ beatUnit: 4, dotted: true, bpm: 60 });
    expect(metadata.targetMap.filter(target => target.kind === "event").map(target => target.workspaceId).sort()).toEqual(["p0m0n0", "p0m1n0"]);
    const proof = await parseScoreWorkspace(metadata.proof);
    expect(proof.origin.xml).toContain("<trill-mark/>");
    expect((await state(proof)).notationRemovals).toEqual([{ eventId: "p0m0n0", feature: "ornament:trill-mark:0" }]);
    const project = await createProjectFromQuickReview(draft, review), restored = await importHarmonyProject(await exportHarmonyProject(project));
    expect(restored.source).toEqual(project.source);
    const substitution = structuredClone(source);
    (substitution.sourceMeasures[0].lyricTokens[0] as { text: string }).text = "different unreviewed text";
    expect(substitution.revisionDigest).toBe(source.revisionDigest);
    expect(await validateWorkspaceSourceIntegrity(substitution)).toBe(false);
  });

  it("maps every inserted and moved Lead event once despite missing or duplicate legacy XML ordinals", async () => {
    let workspace = await start();
    workspace = await act(workspace, { kind: "insert-event", eventKind: "note", measureId: "p0m0", staffNumber: 1, voice: "1", pitch: { step: "G", alter: 0, octave: 4 }, onset: fraction(1), duration: fraction(1) });
    workspace = await act(workspace, { kind: "move-event", eventId: "p0m1n0", measureId: "p0m0", onset: fraction(2) });
    workspace = await act(workspace, { kind: "insert-event", eventKind: "note", measureId: "p0m1", staffNumber: 1, voice: "1", pitch: { step: "A", alter: 0, octave: 4 }, onset: fraction(0), duration: fraction(1) });
    const preserved = await state(workspace), first = preserved.music!.parts[0].measures[0].leadEvents;
    expect(first.filter(event => event.musicXmlEventOrdinal === 0)).toHaveLength(2);
    expect(first.find(event => event.workspaceEventId === "inserted:op:0")).not.toHaveProperty("musicXmlEventOrdinal");
    workspace = await prepareSource(workspace);
    const { source, metadata } = await finalized(workspace), map = metadata.targetMap.filter(target => target.kind === "event");
    expect(map.map(target => target.workspaceId).sort()).toEqual(["inserted:op:0", "inserted:op:2", "p0m0n0", "p0m1n0"].sort());
    expect(new Set(map.map(target => target.sourceId)).size).toBe(4);
    expect(source.sourceMeasures.map(measure => measure.leadEvents.length)).toEqual([3, 1]);
    const reloaded = await parseScoreWorkspace(metadata.proof);
    expect((await finalized(reloaded)).source).toEqual(source);
  });

  it("projects only the newly selected voice after explicit reassignment, retaining excluded original notes", async () => {
    const extra = '<backup><duration>1</duration></backup>' + note("", "E").replace("<voice>1</voice>", "<voice>2</voice>");
    let workspace = await start(score(note() + extra));
    workspace = await act(workspace, { kind: "move-event", eventId: "p0m0n1", measureId: "p0m0", onset: fraction(1) });
    workspace = await act(workspace, { kind: "event-voice", eventId: "p0m0n1", staffNumber: 1, voice: "1" });
    workspace = await act(workspace, { kind: "event-voice", eventId: "p0m0n0", staffNumber: 1, voice: "2" });
    workspace = await prepareSource(workspace);
    const { source, metadata } = await finalized(workspace);
    expect(metadata.targetMap.filter(target => target.kind === "event").map(target => target.workspaceId).sort()).toEqual(["p0m0n1", "p0m1n0"]);
    expect(source.sourceMeasures[0].leadEvents[0]).toMatchObject({ kind: "note", pitch: { step: "E", alter: 0, octave: 4 }, onset: fraction(1) });
    expect(metadata.excludedVoices).toEqual(["lead:p:0:s:1:v:1:2"]);
    const preserved = await state(await parseScoreWorkspace(metadata.proof));
    expect(preserved.music!.parts[0].measures[0].leadEvents.find(event => event.workspaceEventId === "p0m0n0")).toMatchObject({ kind: "note", pitch: { step: "C", alter: 0, octave: 4 }, candidateKey: "lead:p:0:s:1:v:1:2" });
  });

  it("maps newly inserted pitch-free rhythm separately from Lead without requiring an old XML ordinal", async () => {
    let workspace = await start();
    for (const measureId of ["p0m0", "p0m1"]) workspace = await act(workspace, { kind: "insert-event", eventKind: "rhythm", measureId, staffNumber: 1, voice: "2", onset: fraction(0), duration: fraction(4) });
    workspace = await prepareSource(workspace, ["lead:p:0:s:1:v:1:2"]);
    const { source, metadata } = await finalized(workspace);
    const rhythm = source.sourceMeasures.flatMap(measure => measure.rhythmVoices!.flatMap(voice => voice.events));
    expect(rhythm).toHaveLength(2);
    expect(rhythm.every(event => event.kind === "rhythm" && !("pitch" in event))).toBe(true);
    expect(metadata.targetMap.filter(target => target.kind === "event").map(target => target.workspaceId).sort()).toEqual(["inserted:op:0", "inserted:op:1", "p0m0n0", "p0m1n0"].sort());
  });
});
