import { describe, expect, it, vi } from "vitest";
import { APPLICATION_ALGORITHM_VERSION_REGISTRY as V } from "../../app/algorithm-version-registry";
import * as input from "./input";
import { applyWorkspaceCommand, createScoreWorkspace, exportScoreWorkspace, parseScoreWorkspace, replayScoreWorkspace } from "./journal";
import type { ScoreWorkspace } from "./model";

// Small independently authored public input, never private music/proof.
const xml = '<score-partwise><work><work-title>Proof reuse fixture</work-title></work><part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note></measure></part></score-partwise>';
async function fixture(id: string, bpm = 60) {
  const initial = await createScoreWorkspace(await input.originFromMusicXml(new TextEncoder().encode(xml), "proof.musicxml"), V, id);
  return applyWorkspaceCommand(initial, initial, { kind: "tempo", tempo: { beatUnit: 4, dotted: false, bpm } }, {
    id: `op:${id}`, note: "Public proof reuse regression", actor: "ui-test", at: "2026-09-14T00:00:00Z",
  });
}
const changeNote = (w: ScoreWorkspace, note = "Tampered operation metadata") => Object.assign(w.operations[0], { note });

describe("bounded exact workspace proof reuse", () => {
  it("reuses an exported verified replay while every parse owns its workspace and command graph", async () => {
    const w = await fixture("proof:warm"), text = await exportScoreWorkspace(w), seed = vi.spyOn(input, "seedWorkspace");
    try {
      const first = await parseScoreWorkspace(text), second = await parseScoreWorkspace(text);
      expect(seed).not.toHaveBeenCalled();
      expect(first).toEqual(w); expect(second).toEqual(w);
      expect(first).not.toBe(w); expect(second).not.toBe(first);
      expect(first.origin).not.toBe(second.origin); expect(first.operations[0]).not.toBe(second.operations[0]);
      changeNote(first);
      await expect(replayScoreWorkspace(first)).rejects.toThrow("WORKSPACE_HISTORY_SEAL_INVALID");
      expect(await replayScoreWorkspace(second)).toEqual(await replayScoreWorkspace(w));
      expect(await parseScoreWorkspace(text)).toEqual(w);
    } finally { seed.mockRestore(); }
  });

  it("does not return a caller mutation made while a separate parse awaits its guard", async () => {
    const w = await fixture("proof:await"), text = await exportScoreWorkspace(w), first = await parseScoreWorkspace(text);
    const pending = parseScoreWorkspace(text);
    changeNote(first);
    Object.assign(first.origin, { xml: first.origin.xml.replace("<step>C</step>", "<step>D</step>") });
    const second = await pending;
    expect(second).toEqual(w);
    await expect(replayScoreWorkspace(second)).resolves.toEqual(await replayScoreWorkspace(w));
    await expect(replayScoreWorkspace(first)).rejects.toThrow();
  });

  it("rejects edited event/history/origin data while the original exact proof stays recoverable", async () => {
    const initial = await fixture("proof:event"), state = await replayScoreWorkspace(initial), event = state.music!.parts[0].measures[0].leadEvents[0];
    const w = await applyWorkspaceCommand(initial, initial, { kind: "note", eventId: event.workspaceEventId!, value: { kind: "note", pitch: { step: "D", alter: 0, octave: 4 }, onset: event.onset, duration: event.duration, tieStart: false, tieStop: false } }, {
      id: "op:event", note: "Public note edit for mutation isolation", actor: "ui-test", at: "2026-09-14T00:00:01Z",
    }), text = await exportScoreWorkspace(w);
    for (const mutate of [
      (value: ScoreWorkspace) => { const command = value.operations[1].command; if (command.kind !== "note") throw Error("fixture note missing"); Object.assign(command.value, { pitch: { step: "E", alter: 0, octave: 4 } }); },
      (value: ScoreWorkspace) => Object.assign(value, { historyDigest: "0".repeat(64) }),
      (value: ScoreWorkspace) => Object.assign(value.origin, { xml: "broken original" }),
    ]) {
      const changed = await parseScoreWorkspace(text); mutate(changed);
      await expect(replayScoreWorkspace(changed)).rejects.toThrow();
      await expect(parseScoreWorkspace(JSON.stringify(changed))).rejects.toThrow();
      expect(await replayScoreWorkspace(await parseScoreWorkspace(text))).toEqual(await replayScoreWorkspace(w));
    }
  });

  it("isolates Replay.origin and active commands used by edits and Undo/Redo", async () => {
    const w = await fixture("proof:undo"), text = await exportScoreWorkspace(w), first = await parseScoreWorkspace(text), second = await parseScoreWorkspace(text);
    Object.assign(first.origin, { xml: "not XML" });
    Object.assign(first.operations[0].command, { tempo: { beatUnit: 4, dotted: false, bpm: 199 } });
    const undo = await applyWorkspaceCommand(second, second, { kind: "undo" }, { id: "op:undo", note: "Undo on independent parsed copy", actor: "ui-test", at: "2026-09-14T00:00:01Z" });
    const redo = await applyWorkspaceCommand(undo, undo, { kind: "redo" }, { id: "op:redo", note: "Redo on independent parsed copy", actor: "ui-test", at: "2026-09-14T00:00:02Z" });
    expect((await replayScoreWorkspace(redo)).request.tempo?.bpm).toBe(60);
    expect((await replayScoreWorkspace(redo)).music).toEqual((await replayScoreWorkspace(w)).music);
  });

  it("does not register an unverified mutation made after export's awaited replay", async () => {
    const w = await fixture("proof:export-await"), pending = exportScoreWorkspace(w);
    changeNote(w);
    const unverifiedText = await pending;
    expect(JSON.parse(unverifiedText).operations[0].note).toBe("Tampered operation metadata");
    await expect(parseScoreWorkspace(unverifiedText)).rejects.toThrow("WORKSPACE_HISTORY_SEAL_INVALID");
  });

  it("requires exact text and retains a healthy cached proof after malformed or tampered input", async () => {
    const w = await fixture("proof:invalid"), text = await exportScoreWorkspace(w);
    await expect(parseScoreWorkspace("{" )).rejects.toThrow();
    const tampered = JSON.parse(text); tampered.operations[0].note = "Changed without history reseal";
    await expect(parseScoreWorkspace(JSON.stringify(tampered))).rejects.toThrow("WORKSPACE_HISTORY_SEAL_INVALID");
    const seed = vi.spyOn(input, "seedWorkspace");
    try {
      expect(await parseScoreWorkspace(text)).toEqual(w); expect(seed).not.toHaveBeenCalled();
      expect(await parseScoreWorkspace(" " + text)).toEqual(w); expect(seed).toHaveBeenCalledOnce();
    } finally { seed.mockRestore(); }
  });

  it("keeps different proofs independent and retains only the most recent reusable text", async () => {
    const a = await fixture("proof:a", 61), textA = await exportScoreWorkspace(a), b = await fixture("proof:b", 92), textB = await exportScoreWorkspace(b);
    const seed = vi.spyOn(input, "seedWorkspace");
    try {
      expect((await replayScoreWorkspace(await parseScoreWorkspace(textB))).request.tempo?.bpm).toBe(92);
      expect(seed).not.toHaveBeenCalled();
      expect((await replayScoreWorkspace(await parseScoreWorkspace(textA))).request.tempo?.bpm).toBe(61);
      expect(seed).toHaveBeenCalledTimes(1);
      expect((await replayScoreWorkspace(await parseScoreWorkspace(textB))).request.tempo?.bpm).toBe(92);
      expect(seed).toHaveBeenCalledTimes(2);
    } finally { seed.mockRestore(); }
  });

  it("reuses a verified proof just beyond 8 MB without sharing mutations or accepting changed bytes", async () => {
    const w = await fixture("proof:review-history"), text = " ".repeat(8_100_000) + await exportScoreWorkspace(w);
    const seed = vi.spyOn(input, "seedWorkspace");
    try {
      const first = await parseScoreWorkspace(text);
      expect(seed).toHaveBeenCalledOnce();
      const second = await parseScoreWorkspace(text);
      expect(seed).toHaveBeenCalledOnce();
      changeNote(first);
      await expect(replayScoreWorkspace(first)).rejects.toThrow("WORKSPACE_HISTORY_SEAL_INVALID");
      expect(second).toEqual(w);
      const changed = text.replace("Public proof reuse regression", "Changed proof reuse regression");
      await expect(parseScoreWorkspace(changed)).rejects.toThrow("WORKSPACE_HISTORY_SEAL_INVALID");
      expect(await parseScoreWorkspace(text)).toEqual(w);
    } finally { seed.mockRestore(); }
  });

  it("validates larger proofs normally without caching them or changing the existing limits", async () => {
    const w = await fixture("proof:large"), text = " ".repeat(16_000_001) + await exportScoreWorkspace(w), seed = vi.spyOn(input, "seedWorkspace");
    try {
      expect(await parseScoreWorkspace(text)).toEqual(w); expect(await parseScoreWorkspace(text)).toEqual(w);
      expect(seed).toHaveBeenCalledTimes(2);
      await expect(parseScoreWorkspace(" ".repeat(64_000_001))).rejects.toThrow("WORKSPACE_LIMIT");
      const tooLongHistory = { ...w, operations: Array(2049).fill(w.operations[0]), revision: 2049 };
      await expect(parseScoreWorkspace(JSON.stringify(tooLongHistory))).rejects.toThrow("WORKSPACE_HISTORY_INVALID");
    } finally { seed.mockRestore(); }
  });
});
