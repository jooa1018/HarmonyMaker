import { describe, expect, it, vi } from "vitest";
import { binaryDigest } from "../../domain/digest/canonical";
import { fraction } from "../../domain/fraction";
import { APPLICATION_ALGORITHM_VERSION_REGISTRY as V } from "../../app/algorithm-version-registry";
import * as input from "./input";
import { exactJson } from "./encoding";
import { createReplayStateDigester } from "./replay-digest";
import { applyWorkspaceCommand, createScoreWorkspace, exportScoreWorkspace, parseScoreWorkspace, replayScoreWorkspace, workspaceStateDigest } from "./journal";
import type { ScoreWorkspace, WorkspaceCommand } from "./model";

const xml = '<score-partwise><part-list><score-part id="P1"><part-name>Independent</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note></measure></part></score-partwise>';
const meta = (id: string) => ({id,actor:"ui-test" as const,note:"Independent replay regression",at:"2026-09-21T00:00:00Z"});
const start = async () => createScoreWorkspace(await input.originFromMusicXml(new TextEncoder().encode(xml),"independent.xml"),V,"replay:fixture");
const act = (w: ScoreWorkspace, command: WorkspaceCommand) => applyWorkspaceCommand(w,w,command,meta(`op:${w.revision}`));
async function reseal(w: ScoreWorkspace) {
  return {...w,historyDigest:await binaryDigest(new TextEncoder().encode(exactJson({schema:"hm-workspace-history-seal-v1",id:w.id,evidenceDigest:await input.workspaceEvidenceDigest(w.origin),algorithmVersions:w.algorithmVersions,operations:w.operations})))};
}
describe("private replay encoding and boundary integrity",()=>{
  it("matches original canonical state hashes through reviews, lyric Unicode, edits and Undo/Redo",async()=>{
    let w=await start();const digest=createReplayStateDigester();
    const commands:WorkspaceCommand[]=[
      {kind:"lead",lead:"lead:p:0:s:1:v:1:1",rhythmVoices:[]},
      {kind:"attest",purpose:"music",scope:{kind:"measure",measureId:"p0m0",voiceKey:"lead:p:0:s:1:v:1:1"}},
      {kind:"event-lyrics",eventId:"p0m0n0",lyrics:[{text:"e\u0301 한",verse:1,syllabic:"single",extend:false,musicXmlAccent:false}]},
      {kind:"note",eventId:"p0m0n0",value:{kind:"note",pitch:{step:"D",alter:0,octave:4},onset:fraction(0),duration:fraction(4),tieStart:false,tieStop:false}},
      {kind:"undo"},{kind:"redo"},
    ];
    for(const command of commands){w=await act(w,command);const s=await replayScoreWorkspace(w);expect(await digest(s)).toBe(await workspaceStateDigest(s));}
    const text=await exportScoreWorkspace(w);expect(await parseScoreWorkspace(' '+text)).toEqual(w);
  });
  it("validates every intermediate digest and affected target even when an attacker reseals the history",async()=>{
    let w=await act(await start(),{kind:"title",title:"First"});w=await act(w,{kind:"title",title:"Second"});
    for(const mutate of [
      (v:ScoreWorkspace)=>Object.assign(v.operations[0],{afterDigest:'0'.repeat(64)}),
      (v:ScoreWorkspace)=>Object.assign(v.operations[1],{beforeDigest:'0'.repeat(64)}),
      (v:ScoreWorkspace)=>Object.assign(v.operations[0],{affectedIds:[]}),
      (v:ScoreWorkspace)=>Object.assign(v,{digest:'0'.repeat(64)}),
    ]){const copy=structuredClone(w);mutate(copy);await expect(parseScoreWorkspace(JSON.stringify(await reseal(copy)))).rejects.toThrow();}
  });
  it("does not cache externally mutated input across an asynchronous cold validation",async()=>{
    const original=await act(await start(),{kind:"title",title:"Preserved"});
    const caller=structuredClone(original),pending=replayScoreWorkspace(caller);
    Object.assign(caller.operations[0],{note:"changed during validation"});
    await expect(pending).rejects.toThrow("WORKSPACE_MUTATED_DURING_VALIDATION");
    await expect(parseScoreWorkspace(JSON.stringify(original))).resolves.toEqual(original);
    await expect(replayScoreWorkspace(caller)).rejects.toThrow("WORKSPACE_HISTORY_SEAL_INVALID");
  });
  it("owns edit input before awaits and rejects concurrent edits to the input workspace",async()=>{
    const w=await start(),command:WorkspaceCommand={kind:"title",title:"Captured"};
    const pending=act(w,command);Object.assign(command,{title:"Unvalidated replacement"});
    const result=await pending;expect((await replayScoreWorkspace(result)).music!.title).toBe("Captured");
    const pending2=act(result,{kind:"title",title:"Next"});Object.assign(result.origin,{fileName:"mutated.xml"});
    await expect(pending2).rejects.toThrow("WORKSPACE_MUTATED_DURING_EDIT");
  });
  it("does not use failed origin parsing as a reusable proof",async()=>{
    const w=await start(),text=await exportScoreWorkspace(w),bad=structuredClone(w);Object.assign(bad.origin,{xml:"broken"});
    const spy=vi.spyOn(input,"seedWorkspace");try{await expect(parseScoreWorkspace(JSON.stringify(await reseal(bad)))).rejects.toThrow();expect(await parseScoreWorkspace(text)).toEqual(w);}finally{spy.mockRestore();}
  });
  it("rejects a resealed dependency downgrade and ignores caller-supplied approval snapshots",async()=>{
    let w=await act(await start(),{kind:'lead',lead:'lead:p:0:s:1:v:1:1',rhythmVoices:[]});
    w=await act(w,{kind:'attest',purpose:'music',scope:{kind:'measure',measureId:'p0m0',voiceKey:'lead:p:0:s:1:v:1:1'}});
    const downgraded=structuredClone(w);Object.assign(downgraded.operations[1],{reviewDependencyVersion:2});
    await expect(parseScoreWorkspace(JSON.stringify(await reseal(downgraded)))).rejects.toThrow('WORKSPACE_REVIEW_VERSION_DOWNGRADE');
    const original=await replayScoreWorkspace(w),poisoned=structuredClone(original);
    Object.assign(poisoned,{reviewIssueDependencies:[{issueId:'forged',field:'lyrics',measureIds:[],eventIds:[],association:'event'}]});
    Object.assign(poisoned.attestations[0],{actor:'user',at:'2026-01-01T00:00:00Z',retainedReview:{previousVersion:2,previousFingerprint:'0'.repeat(64),transitionOperationId:'forged'}});
    const parsed=await parseScoreWorkspace(JSON.stringify({...w,snapshot:poisoned,sourceEligibility:{approved:true}}));
    expect(await replayScoreWorkspace(parsed)).toEqual(original);
    expect(await replayScoreWorkspace(w)).toEqual(original);
  });
});
