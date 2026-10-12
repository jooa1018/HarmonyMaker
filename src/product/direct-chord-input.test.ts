import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { APPLICATION_ALGORITHM_VERSION_REGISTRY as versions } from "../app/algorithm-version-registry";
import { isChordParseResult, parseChord } from "../domain/chord/parser";
import { fraction } from "../domain/fraction";
import { applyWorkspaceCommand, exportScoreWorkspace, parseScoreWorkspace, readVerifiedWorkspace } from "../import/workspace/journal";
import { replaceChord, addChord, confirmChord } from "../import/review/commands";
import { importMusicXml, deriveQuickReview } from "../import";
import { createProjectFromQuickReview } from "./workspace";
import { prepareQuickHarmony, prepareQuickHarmonyWorkspace, generateQuickHarmony } from "./quick-harmony";
import { exportHarmonyProject, importHarmonyProject } from "./project-transfer";
import { IndexedDbProjectStore } from "./local-project-store";

const bytes=new Uint8Array(readFileSync(new URL("./fixtures/wag11/4-4-1.musicxml",import.meta.url)));
const at="2026-10-12T00:00:00.000Z";
it.each(["C2","G2","C2/G"])("records original %s input and saves/reopens a canonical workspace project",async text=>{
  const prep=await prepareQuickHarmony({bytes,fileName:"chord-input.musicxml"}),w=prep.workspace!;
  const m=(await readVerifiedWorkspace(w)).state.music!.parts[0].measures[0];
  const changed=await applyWorkspaceCommand(w,w,{kind:"chord",measureId:m.workspaceMeasureId!,chordId:m.chords[0].key,text,onset:fraction(0)},
    {id:"input-chord",note:"사용자가 코드 입력",actor:"user",at});
  const encoded=await exportScoreWorkspace(changed),reopened=await parseScoreWorkspace(encoded);
  expect(await exportScoreWorkspace(reopened)).toBe(encoded);
  expect(reopened.operations.at(-1)?.note).toContain(`원래 코드 입력: ${text}`);
  const chord=(await readVerifiedWorkspace(reopened)).state.music!.parts[0].measures[0].chords[0];
  expect(chord.parseResult).toEqual(parseChord(text.replace("2","add2")));
  expect(chord.source).toBe("manual");
  const result=await generateQuickHarmony(await prepareQuickHarmonyWorkspace(reopened),{parts:["alto"],rightsConfirmed:true,confirmedAt:at});
  if(result.status!=="complete"&&result.status!=="partial")throw Error(result.status);
  const saved=await exportHarmonyProject(result.project),store=new IndexedDbProjectStore(new IDBFactory());
  await store.saveNew({projectId:"chord",updatedAt:at,project:result.project});
  expect(await exportHarmonyProject((await store.load("chord"))!.project)).toBe(saved);
  expect(await exportHarmonyProject(await importHarmonyProject(saved))).toBe(saved);
});

it.each(["C2","G2","C2/G"])("preserves original %s spelling in legacy review add/replace and saved source",async text=>{
  const imported=await importMusicXml(bytes,{algorithmVersions:versions,identityFactory:()=>"doc:direct-chord"});
  if(imported.status!=="review-required")throw Error(imported.status);
  const prep=await prepareQuickHarmony({bytes,fileName:"chord-input.musicxml"}),request=prep.details.assessment!.request!;
  let draft={...imported.draft,selectedLeadStaffKey:request.lead,defaultKey:{tonic:{step:"C" as const,alter:0 as const},mode:"major" as const},defaultTempo:request.tempo,
    singerCount:request.singerCount,performerSlots:request.performers,rights:{basis:"self-authored" as const,allowedUses:["generation" as const]},sections:request.sections};
  const chord=draft.parts[0].measures[0].chords[0];
  const added=addChord(draft,0,0,fraction(1),text).parts[0].measures[0].chords.at(-1)!;
  expect(added.sourceText).toBe(text);expect(added.parseResult).toEqual(parseChord(text.replace("2","add2")));
  draft=addChord(draft,0,0,fraction(1),text) as typeof draft;
  draft=replaceChord(draft,chord.key,text) as typeof draft;
  for(const p of draft.parts)for(const m of p.measures)for(const c of m.chords)draft=confirmChord(draft,c.key) as typeof draft;
  const review=await deriveQuickReview(draft,versions);
  expect(review.state.readyForPlanning,JSON.stringify(review.diagnostics)).toBe(true);
  const project=await createProjectFromQuickReview(draft,review),saved=await exportHarmonyProject(project);
  const restored=await importHarmonyProject(saved);
  expect(restored.source.sourceMeasures[0].chordEvents[0].sourceText).toBe(text);
  expect(restored.source.sourceMeasures[0].chordEvents[1].sourceText).toBe(text);
  expect(await exportHarmonyProject(restored)).toBe(saved);
});

it("replays a legacy C2 draft byte-for-byte and leaves the shared parser and old projects unchanged",async()=>{
  const before=readFileSync(new URL("./fixtures/legacy-c2-workspace.json",import.meta.url),"utf8");
  const legacy=await parseScoreWorkspace(before);
  expect(await exportScoreWorkspace(legacy)).toBe(before);
  expect(legacy.operations.at(-1)?.command).toMatchObject({text:"C2"});
  expect(isChordParseResult(parseChord("C2"))).toBe(false);
  for(const name of ["auto-draft-v1-auto.json","auto-draft-v1-edited.json"]){
    const saved=readFileSync(new URL(`./fixtures/${name}`,import.meta.url),"utf8");
    expect(await exportHarmonyProject(await importHarmonyProject(saved))).toBe(saved);
  }
});
