import { IDBFactory } from "fake-indexeddb";
import { IndexedDbProjectStore } from "./local-project-store";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { prepareQuickHarmony, generateQuickHarmony } from "./quick-harmony";
import { readVerifiedWorkspace } from "../import/workspace/journal";
import { importHarmonyProject, exportHarmonyProject } from "./project-transfer";

const base=readFileSync(new URL("./fixtures/wag11/4-4-1.musicxml",import.meta.url),"utf8");
const prepare=(kind:string,tail="")=>prepareQuickHarmony({bytes:new TextEncoder().encode(base.replaceAll("<kind>major</kind>",kind+tail)),fileName:"kind-text.musicxml"});
it.each([['2','Cadd2'],['sus2','Csus2'],['m7','Cm7']])("reads other/%s with the existing chord parser and reports its source text",async(text,canonical)=>{
  const prep=await prepare(`<kind text="${text}">other</kind>`);
  expect(prep.status).toBe("ready");
  const {state}=await readVerifiedWorkspace(prep.workspace!);
  const chord=state.music!.parts[0].measures[0].chords[0];
  expect(chord.interpretation).toBe("kind-text");
  expect(chord.parseResult).toMatchObject({status:"ok",chord:{canonicalSymbol:canonical}});
  expect(prep.notes).toContainEqual(expect.objectContaining({messageKo:`1번째 마디: 코드 이름 C${text}를 글자대로 읽었어요.`}));
});
it.each([
  ['<kind text="">other</kind>', ''],
  ['<kind>other</kind>', ''],
  ['<kind text="unreadable">other</kind>', ''],
  ['<kind text="2">other</kind>', '<degree><degree-value>2</degree-value><degree-alter>0</degree-alter><degree-type>add</degree-type></degree>'],
  ['<kind text="2">other</kind>', '<bass><bass-step>Q</bass-step></bass>'],
  ['<kind text="2">other</kind>', '<bass/>'],
])("keeps ambiguous or structured other chords as questions",async(kind,tail)=>{
  const prep=await prepare(kind,tail);
  expect(prep.status).toBe("needs-input");
  expect(prep.questions.some(q=>q.messageKo.includes("해석할 수 없는 코드"))).toBe(true);
  expect(prep.notes.some(n=>n.id.startsWith("chord-kind-text:"))).toBe(false);
});
it.each([["C2",0,""],["G2",2,""],["C2/G",0,'<bass><bass-step>G</bass-step></bass>']] as const)("generates and persists %s with canonical add2 semantics",async(name,measure,bass)=>{
  const prep=await prepare('<kind text="2">other</kind>',bass);
  const structured=await prepare('<kind>major</kind>','<degree><degree-value>2</degree-value><degree-alter>0</degree-alter><degree-type>add</degree-type></degree>'+bass);
  const {state}=await readVerifiedWorkspace(prep.workspace!);
  const normal=(await readVerifiedWorkspace(structured.workspace!)).state;
  const chord=state.music!.parts[0].measures[measure].chords[0];
  expect(chord.sourceText).toBe(name);
  expect(chord.parseResult).toEqual(normal.music!.parts[0].measures[measure].chords[0].parseResult);
  const choice={parts:["alto","tenor"] as const,rightsConfirmed:true as const,confirmedAt:"2026-10-10T00:00:00.000Z"};
  const first=await generateQuickHarmony(prep,choice),second=await generateQuickHarmony(prep,choice);
  expect(["complete","partial"]).toContain(first.status);
  if(!("project" in first)||!first.project||!("project" in second)||!second.project)throw new Error(first.status);
  const bytes=await exportHarmonyProject(first.project);
  expect(await exportHarmonyProject(second.project)).toBe(bytes);
  expect(await exportHarmonyProject(await importHarmonyProject(bytes))).toBe(bytes);
  const store=new IndexedDbProjectStore(new IDBFactory());
  await store.saveNew({projectId:"kind-text",updatedAt:choice.confirmedAt,project:first.project});
  const saved=await store.load("kind-text");
  expect(await exportHarmonyProject(saved!.project)).toBe(bytes);
});
it("does not reinterpret standard kind text or rewrite saved legacy project bytes",async()=>{
  const prep=await prepare('<kind text="2">major</kind>');
  const {state}=await readVerifiedWorkspace(prep.workspace!);
  expect(state.music!.parts[0].measures[0].chords[0].parseResult).toMatchObject({status:"ok",chord:{canonicalSymbol:"C"}});
  expect(prep.notes.some(n=>n.id.startsWith("chord-kind-text:"))).toBe(false);
  for(const name of ['auto-draft-v1-auto.json','auto-draft-v1-edited.json']) {
    const bytes=readFileSync(new URL(`./fixtures/${name}`,import.meta.url),"utf8");
    expect(await exportHarmonyProject(await importHarmonyProject(bytes))).toBe(bytes);
  }
});
