import { describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { APPLICATION_ALGORITHM_VERSION_REGISTRY as V } from "../../app/algorithm-version-registry";
import { originFromMusicXml } from "./input";
import { applyWorkspaceCommand, applyWorkspaceCommands, createImmutableWorkspace, createScoreWorkspace, exportScoreWorkspace, parseScoreWorkspace, readVerifiedWorkspace, replayScoreWorkspace, workspaceStateDigest } from "./journal";
import type { ScoreWorkspace, WorkspaceCommand } from "./model";
import { ScoreWorkspaceStore } from "./store";

// Public synthetic notation, unrelated to the user's score or answer fixtures.
const xml='<score-partwise><part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note></measure></part></score-partwise>';
const meta=(id:string)=>({id,note:"Explicit public ownership regression",actor:"ui-test" as const,at:"2026-09-21T00:00:00Z"});
async function fixture(id="immutable:fixture") {
  const w=await createScoreWorkspace(await originFromMusicXml(new TextEncoder().encode(xml),"ownership.xml"),V,id);
  return applyWorkspaceCommand(w,w,{kind:"tempo",tempo:{beatUnit:4,dotted:false,bpm:60}},meta("op:tempo"));
}
const act=(w:ScoreWorkspace,command:WorkspaceCommand,id:string)=>applyWorkspaceCommand(w,w,command,meta(id));
function expectFrozenTree(value:unknown) {
  if(value===null||typeof value!=="object")return;
  expect(Object.isFrozen(value)).toBe(true);
  for(const child of Object.values(value))expectFrozenTree(child);
}

describe("verified immutable workspace ownership",()=>{
  it("keeps retained state fields isolated across edits, reviews, Undo, Redo and cold replay",async()=>{
    let current=await createImmutableWorkspace(await fixture("immutable:field-sharing"));
    const first=current,initial=await replayScoreWorkspace(first),firstBytes=await exportScoreWorkspace(first);
    const lead=initial.music!.leadCandidates[0].key;
    const commands:WorkspaceCommand[]=[
      {kind:"lead",lead,rhythmVoices:[]},
      {kind:"attest",purpose:"music",scope:{kind:"measure",measureId:"p0m0",voiceKey:lead}},
      {kind:"issue",scope:{kind:"metadata"},detail:"Independent new evidence must remain unresolved"},
      {kind:"event-lyrics",eventId:"p0m0n0",lyrics:[{text:"e\u0301 한",verse:1,syllabic:"single",extend:false,musicXmlAccent:false}]},
      {kind:"tempo",tempo:{beatUnit:4,dotted:false,bpm:91}},
      {kind:"undo"},{kind:"undo"},{kind:"redo"},{kind:"redo"},
      {kind:"title",title:"Different display title"},
    ];
    const retained:Array<{workspace:ScoreWorkspace;state:typeof initial;encoded:string}>=[];
    for(const [index,command] of commands.entries()) {
      const state=await replayScoreWorkspace(current),encoded=await exportScoreWorkspace(current);
      retained.push({workspace:current,state:structuredClone(state),encoded});
      // Returned fields must never become private replay or clean-cache keys.
      Object.assign(state.issues,{length:0});Object.assign(state.attestations,{length:0});
      Object.assign(state.request.tempo!,{bpm:199});
      Object.assign(state.music!,{title:"Mutated external view"});
      current=await act(current,command,`op:field-sharing:${index}`);
      const next=await replayScoreWorkspace(current);
      expect(await workspaceStateDigest(next)).toBe(current.digest);
      // Different text bypasses the one exact proof-string reuse entry.
      const cold=await parseScoreWorkspace(' '+await exportScoreWorkspace(current));
      expect(await replayScoreWorkspace(cold)).toEqual(next);
      expect(await exportScoreWorkspace(first)).toBe(firstBytes);
    }
    for(const previous of retained) {
      expect(await replayScoreWorkspace(previous.workspace)).toEqual(previous.state);
      expect(await exportScoreWorkspace(previous.workspace)).toBe(previous.encoded);
    }
    expect(await replayScoreWorkspace(first)).toEqual(initial);
    expect((await replayScoreWorkspace(current)).issues.some(i=>i.messageKo.includes("Independent new evidence"))).toBe(true);
  });
  it("copies and deeply freezes verified JSON without freezing or trusting the caller",async()=>{
    const mutable=await fixture(),text=await exportScoreWorkspace(mutable),owned=await createImmutableWorkspace(mutable);
    expect(owned).toEqual(mutable);expect(owned).not.toBe(mutable);expect(owned.origin).not.toBe(mutable.origin);
    expectFrozenTree(owned);expect(Object.isFrozen(mutable)).toBe(false);
    expect(await createImmutableWorkspace(owned)).toBe(owned);
    expect(Reflect.set(owned.operations[0].command,"kind","title")).toBe(false);
    Object.assign(mutable.origin,{xml:"changed external source"});
    Object.assign(mutable.operations[0],{note:"changed external history"});
    await expect(replayScoreWorkspace(mutable)).rejects.toThrow();
    expect(await exportScoreWorkspace(owned)).toBe(text);
    const exposed=await readVerifiedWorkspace(owned);Object.assign(exposed.state.request.tempo!,{bpm:199});
    expect((await replayScoreWorkspace(owned)).request.tempo!.bpm).toBe(60);
  });

  it("keeps mutable and immutable edit, review, Undo and Redo bytes identical",async()=>{
    let mutable=await fixture(),owned=await createImmutableWorkspace(mutable);
    const start=owned,initial=await replayScoreWorkspace(start),lead=initial.music!.leadCandidates[0].key;
    const commands:WorkspaceCommand[]=[
      {kind:"lead",lead,rhythmVoices:[]},
      {kind:"attest",purpose:"music",scope:{kind:"measure",measureId:"p0m0",voiceKey:lead}},
      {kind:"title",title:"Changed title"},
      {kind:"tempo",tempo:{beatUnit:4,dotted:true,bpm:72}},
      {kind:"undo"},{kind:"redo"},
      {kind:"attest",purpose:"music",scope:{kind:"measure",measureId:"p0m0",voiceKey:lead}},
    ];
    for(const [i,command]of commands.entries()) {
      const old=owned,oldState=await replayScoreWorkspace(old);
      [mutable,owned]=await Promise.all([act(mutable,command,`op:sequence:${i}`),act(owned,command,`op:sequence:${i}`)]);
      expect(await replayScoreWorkspace(owned)).toEqual(await replayScoreWorkspace(mutable));
      expect(await exportScoreWorkspace(owned)).toBe(await exportScoreWorkspace(mutable));
      expect(await replayScoreWorkspace(old)).toEqual(oldState);expectFrozenTree(owned);
    }
    expect(await replayScoreWorkspace(start)).toEqual(initial);
    await expect(applyWorkspaceCommand(owned,start,{kind:"title",title:"stale"},meta("op:stale"))).rejects.toThrow("STALE_REVISION");
  });

  it("captures command and nested metadata before await without freezing either caller object",async()=>{
    const owned=await createImmutableWorkspace(await fixture()),command={kind:"tempo" as const,tempo:{beatUnit:4 as const,dotted:false,bpm:73}},details={audit:{label:"captured"}},m={...meta("op:capture"),details};
    const pending=applyWorkspaceCommand(owned,owned,command,m);
    command.tempo.bpm=191;details.audit.label="outside mutation";
    const next=await pending;
    expect(Object.isFrozen(command)).toBe(false);expect(Object.isFrozen(details.audit)).toBe(false);
    expect((await replayScoreWorkspace(next)).request.tempo!.bpm).toBe(73);
    expect((next.operations.at(-1) as unknown as {details:typeof details}).details.audit.label).toBe("captured");
    expect((await replayScoreWorkspace(await parseScoreWorkspace(await exportScoreWorkspace(next)))).request.tempo!.bpm).toBe(73);
    const undone=await act(next,{kind:"undo"},"op:undo"),redone=await act(undone,{kind:"redo"},"op:redo");
    expect((await replayScoreWorkspace(redone)).request.tempo!.bpm).toBe(73);
  });

  it("rejects warm and cold caller mutations during immutable preparation",async()=>{
    for(const cold of [false,true]) {
      const original=await fixture(`immutable:await:${cold}`),value=cold?JSON.parse(JSON.stringify(original)) as ScoreWorkspace:original;
      const pending=createImmutableWorkspace(value);Object.assign(value.operations[0],{note:"Changed while validation awaits"});
      await expect(pending).rejects.toThrow(/WORKSPACE_MUTATED_DURING_(PREPARATION|VALIDATION)/);
    }
  });

  it("validates captured metadata instead of an earlier getter result",async()=>{
    const owned=await createImmutableWorkspace(await fixture());let reads=0;
    const changing={...meta("op:getter"),get actor(){reads++;return (reads===1?"ui-test":"forged") as "ui-test";}};
    const next=await applyWorkspaceCommand(owned,owned,{kind:"title",title:"Captured metadata"},changing);
    expect(reads).toBe(1);expect(next.operations.at(-1)!.actor).toBe("ui-test");
    expect(await replayScoreWorkspace(await parseScoreWorkspace(await exportScoreWorkspace(next)))).toEqual(await replayScoreWorkspace(next));
  });

  it("does not transfer ownership authority through freeze, object spread, parse or proof reuse",async()=>{
    const owned=await createImmutableWorkspace(await fixture()),text=await exportScoreWorkspace(owned);
    for(const value of [JSON.parse(text) as ScoreWorkspace,await parseScoreWorkspace(text),structuredClone(owned)]) {
      Object.freeze(value); // Only the outer object is frozen by an untrusted caller.
      Object.assign(value.operations[0],{note:"Tampered nested command metadata"});
      await expect(createImmutableWorkspace(value)).rejects.toThrow("HISTORY_SEAL_INVALID");
      await expect(replayScoreWorkspace(value)).rejects.toThrow("HISTORY_SEAL_INVALID");
    }
    const shallow={...owned,operations:owned.operations.slice(1),revision:0};
    await expect(createImmutableWorkspace(shallow)).rejects.toThrow();
    const version=structuredClone(owned);Object.assign(version.algorithmVersions,{musicxmlImport:"forged-version"});
    await expect(createImmutableWorkspace(version)).rejects.toThrow();
    expect(await exportScoreWorkspace(owned)).toBe(text);
    expect(Object.isFrozen(await parseScoreWorkspace(text))).toBe(false);
    await expect(createImmutableWorkspace({...owned,operations:Array(2049).fill(owned.operations[0]),revision:2049})).rejects.toThrow("HISTORY_INVALID");
  });

  it("isolates concurrent branches and another document while retaining atomic failed batches",async()=>{
    const root=await createImmutableWorkspace(await fixture()),other=await createImmutableWorkspace(await fixture("immutable:other")),before=await exportScoreWorkspace(root);
    const [a,b]=await Promise.all([act(root,{kind:"title",title:"Branch A"},"op:a"),act(root,{kind:"tempo",tempo:{beatUnit:4,dotted:false,bpm:88}},"op:b")]);
    expect((await replayScoreWorkspace(a)).request.tempo!.bpm).toBe(60);
    expect((await replayScoreWorkspace(b)).music!.title).not.toBe("Branch A");
    expect((await replayScoreWorkspace(other)).request.tempo!.bpm).toBe(60);
    await expect(applyWorkspaceCommands(root,root,[{command:{kind:"title",title:"Not committed"},meta:meta("op:batch:1")},{command:{kind:"redo"},meta:meta("op:batch:2")}])).rejects.toThrow("NOTHING_TO_UNDO_OR_REDO");
    expect(await exportScoreWorkspace(root)).toBe(before);
    const after=await act(root,{kind:"title",title:"Healthy after failure"},"op:healthy");
    expect((await replayScoreWorkspace(after)).music!.title).toBe("Healthy after failure");
  });

  it("retains transaction failure recovery, CAS and cold reload for immutable working copies",async()=>{
    const store=new ScoreWorkspaceStore(new IDBFactory()),root=await createImmutableWorkspace(await fixture()),at="2026-09-21T00:00:00Z";
    await store.save({workspace:root,storageRevision:0,updatedAt:at});
    const a=await act(root,{kind:"title",title:"Saved A"},"op:a"),b=await act(root,{kind:"title",title:"Conflicting B"},"op:b");
    const results=await Promise.allSettled([store.save({workspace:a,storageRevision:1,updatedAt:at},0),store.save({workspace:b,storageRevision:1,updatedAt:at},0)]);
    expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect(results.filter(r=>r.status==="rejected")).toHaveLength(1);
    const saved=(await store.load(root.id))!,owned=await createImmutableWorkspace(saved.workspace),next=await act(owned,{kind:"title",title:"After retry"},"op:retry");
    const failure=vi.spyOn(IDBObjectStore.prototype,"put").mockImplementationOnce(()=>{throw new DOMException("Synthetic quota failure","QuotaExceededError");});
    try{await expect(store.save({workspace:next,storageRevision:2,updatedAt:at},1)).rejects.toThrow("quota failure");}finally{failure.mockRestore();}
    expect((await store.load(root.id))!.workspace).toEqual(saved.workspace);
    await store.save({workspace:next,storageRevision:2,updatedAt:at},1);
    const loaded=(await store.load(root.id))!;
    expect(loaded.storageRevision).toBe(2);expect(await replayScoreWorkspace(loaded.workspace)).toEqual(await replayScoreWorkspace(next));
    await expect(store.save({workspace:root,storageRevision:3,updatedAt:at},2)).rejects.toThrow("ROLLBACK");
  });
});
