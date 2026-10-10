import { IDBFactory } from "fake-indexeddb";
import { afterEach, expect, it, vi } from "vitest";
import { prepareQuickHarmony } from "../../product/quick-harmony";
import { ScoreWorkspaceStore } from "../../import/workspace/store";
import { saveEditableWorkspace } from "./edit-workspace";
afterEach(() => vi.unstubAllGlobals());
it("saves editable copies under distinct UUIDs without replacing the quick workspace", async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const xml = '<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>멜로디</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>3</duration><type>half</type></note></measure></part></score-partwise>';
  const prep = await prepareQuickHarmony({ bytes: new TextEncoder().encode(xml), fileName: "short.xml" });
  expect(prep.workspace).toBeDefined();
  const first = await saveEditableWorkspace(prep.workspace!);
  const second = await saveEditableWorkspace(prep.workspace!);
  expect(first).not.toBe(second); expect(first).not.toMatch(/^quick:/);
  const store = new ScoreWorkspaceStore();
  expect(await store.load(prep.workspace!.id)).toBeUndefined();
  expect((await store.load(first))?.workspace.origin).toEqual(prep.workspace!.origin);
  expect((await store.load(second))?.workspace.origin).toEqual(prep.workspace!.origin);
});
