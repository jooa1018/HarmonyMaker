import { describe, expect, it } from "vitest";
import { APPLICATION_ALGORITHM_VERSION_REGISTRY as V } from "../../app/algorithm-version-registry";
import { originFromMusicXml, workspaceEvidenceDigest } from "./input";
import { createScoreWorkspace, applyWorkspaceCommand, replayScoreWorkspace, exportScoreWorkspace, parseScoreWorkspace } from "./journal";
import { attestWorkspaceIssues } from "./review-batch";
import { deriveWorkspaceCapabilities } from "./review";
import type { ScoreWorkspace, WorkspaceCommand } from "./model";
const xml='<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Fixture</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type></note></measure></part></score-partwise>';
const meta=(id:string)=>({id,note:"fixture source facts explicitly compared",actor:"ui-test" as const,at:"2026-09-20T00:00:00Z"});
const act=(w:ScoreWorkspace,c:WorkspaceCommand,id:string)=>applyWorkspaceCommand(w,w,c,meta(id));
async function seed(){let w=await createScoreWorkspace(await originFromMusicXml(new TextEncoder().encode(xml),"independent.xml"),V,"batch-fixture");for(const id of ["one","two","other"])w=await act(w,{kind:"issue",scope:{kind:"document"},detail:`Uncertain printed ${id} symbol`},id);return w;}
const caps=async(w:ScoreWorkspace)=>deriveWorkspaceCapabilities(await replayScoreWorkspace(w),await workspaceEvidenceDigest(w.origin));
describe("explicit grouped source comparison using existing journal commands",()=>{
  it("records each selected fact, keeps unselected issues and music reviews blocking, round trips exact history",async()=>{
    const w=await seed(),before=await replayScoreWorkspace(w),ids=before.issues.slice(0,2).map(i=>i.id);
    const next=await attestWorkspaceIssues(w,w,ids,meta("batch")),after=await replayScoreWorkspace(next);
    expect(next.revision).toBe(w.revision+2);expect(next.operations.slice(-2).map(o=>o.command.kind)).toEqual(["attest","attest"]);
    expect(after.music).toEqual(before.music);expect(after.issues).toEqual(before.issues);expect(next.origin).toEqual(w.origin);expect(after.request).toEqual(before.request);
    expect(after.attestations.map(a=>a.issueId)).toEqual(ids);expect(after.attestations.every(a=>a.actor==="ui-test"&&a.purpose==="issue")).toBe(true);
    expect((await caps(next)).pendingIssues.map(i=>i.id)).toEqual([before.issues[2].id]);expect((await caps(next)).arrange).toBe(false);
    expect(await parseScoreWorkspace(await exportScoreWorkspace(next))).toEqual(next);
  });
  it("rejects an invalid item atomically and does not change the original workspace",async()=>{
    const w=await seed(),encoded=await exportScoreWorkspace(w),id=(await replayScoreWorkspace(w)).issues[0].id;
    await expect(attestWorkspaceIssues(w,w,[id,"missing"],meta("batch"))).rejects.toThrow("SELECTION_INVALID");expect(await exportScoreWorkspace(w)).toBe(encoded);
  });
  it("rejects stale revisions, empty/duplicate/oversized selection and insufficient evidence",async()=>{
    const w=await seed(),id=(await replayScoreWorkspace(w)).issues[0].id;
    await expect(attestWorkspaceIssues(w,{...w,revision:0},[id],meta("batch"))).rejects.toThrow("STALE_REVISION");
    for(const ids of [[],[id,id],Array.from({length:129},(_,i)=>String(i))])await expect(attestWorkspaceIssues(w,w,ids,meta("batch"))).rejects.toThrow("SELECTION_INVALID");
    await expect(attestWorkspaceIssues(w,w,[id],{...meta("batch"),note:"yes"})).rejects.toThrow("SELECTION_INVALID");
  });
  it("retains conservative document dependency after edits, undo, redo and reload",async()=>{
    let w=await seed();const id=(await replayScoreWorkspace(w)).issues[0].id;w=await attestWorkspaceIssues(w,w,[id],meta("batch"));
    await expect(attestWorkspaceIssues(w,w,[id],meta("again"))).rejects.toThrow("SELECTION_INVALID");
    const e=(await replayScoreWorkspace(w)).music!.parts[0].measures[0].leadEvents[0];
    w=await act(w,{kind:"event-lyrics",eventId:e.workspaceEventId!,lyrics:[{text:"new",verse:1,syllabic:"single",extend:false,musicXmlAccent:false}]},"edit");
    expect((await caps(w)).pendingIssues.some(i=>i.id===id)).toBe(true);
    w=await act(w,{kind:"undo"},"undo");expect((await caps(w)).pendingIssues.some(i=>i.id===id)).toBe(false);
    w=await act(w,{kind:"redo"},"redo");w=await parseScoreWorkspace(await exportScoreWorkspace(w));expect((await caps(w)).pendingIssues.some(i=>i.id===id)).toBe(true);
  });
});
