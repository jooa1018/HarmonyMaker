import { describe, expect, it } from "vitest";
import { APPLICATION_ALGORITHM_VERSION_REGISTRY as V } from "../../app/algorithm-version-registry";
import { binaryDigest } from "../../domain/digest/canonical";
import { exactJson } from "./encoding";
import { originFromMusicXml, workspaceEvidenceDigest } from "./input";
import { applyWorkspaceCommand, captureWorkspace, exportScoreWorkspace, parseImmutableScoreWorkspace, parseScoreWorkspace, replayScoreWorkspace, createScoreWorkspace } from "./journal";
import type { ScoreWorkspace } from "./model";

const xml = '<score-partwise><part-list><score-part id="P1"><part-name>Independent</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note></measure></part></score-partwise>';
async function fixture(id:string) {
  const initial=await createScoreWorkspace(await originFromMusicXml(new TextEncoder().encode(xml),"independent.xml"),V,id);
  return applyWorkspaceCommand(initial,initial,{kind:"title",title:id},{id:"edit:1",actor:"ui-test",note:"Independent immutable proof regression",at:"2026-09-22T00:00:00Z"});
}
describe("read-only verified proof ownership",()=>{
  it("shares a deeply frozen proof while preserving the mutable parser and detached readers",async()=>{
    const original=await fixture("proof:ownership"),text=await exportScoreWorkspace(original);
    const first=await parseImmutableScoreWorkspace(text);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.origin)).toBe(true);
    expect(Object.isFrozen(first.operations[0].command)).toBe(true);
    expect(await parseImmutableScoreWorkspace(text)).toBe(first);
    expect(await exportScoreWorkspace(first)).toBe(text);
    expect(await parseImmutableScoreWorkspace(text)).toBe(first);
    const mutable=await parseScoreWorkspace(text);
    expect(Object.isFrozen(mutable)).toBe(false);
    Object.assign(mutable.operations[0].command,{title:"unverified edit"});
    await expect(replayScoreWorkspace(mutable)).rejects.toThrow();
    const state=await replayScoreWorkspace(first);
    Object.assign(state.music!,{title:"changed reader copy"});
    expect((await replayScoreWorkspace(first)).music!.title).toBe("proof:ownership");
    expect(await exportScoreWorkspace(first)).toBe(text);
  });
  it("keeps concurrent and evicted documents separate without trusting a caller freeze",async()=>{
    const a=await fixture("proof:a"),b=await fixture("proof:b");
    const ta=await exportScoreWorkspace(a),tb=await exportScoreWorkspace(b);
    const results=await Promise.all([parseImmutableScoreWorkspace(ta),parseImmutableScoreWorkspace(tb),parseImmutableScoreWorkspace(" "+ta)]);
    expect(results.map(w=>w.id)).toEqual([a.id,b.id,a.id]);
    for(let i=0;i<results.length;i++)expect((await replayScoreWorkspace(results[i])).music!.title).toBe(i===1?b.id:a.id);
    const caller=Object.freeze(structuredClone(a));
    const before=captureWorkspace(caller);
    Object.assign(caller.operations[0].command,{title:"caller is still mutable inside"});
    expect(captureWorkspace(caller)).not.toBe(before);
    await expect(replayScoreWorkspace(caller)).rejects.toThrow();
    expect(await exportScoreWorkspace(await parseImmutableScoreWorkspace(ta))).toBe(ta);
  });
  it("rejects resealed intermediate tampering and recovers after a failed cold parse",async()=>{
    const original=await fixture("proof:tamper"),text=await exportScoreWorkspace(original);
    await parseImmutableScoreWorkspace(text);
    const changed=structuredClone(original);
    Object.assign(changed.operations[0],{afterDigest:"0".repeat(64)});
    const forged:ScoreWorkspace={...changed,historyDigest:await binaryDigest(new TextEncoder().encode(exactJson({schema:"hm-workspace-history-seal-v1",id:changed.id,evidenceDigest:await workspaceEvidenceDigest(changed.origin),algorithmVersions:changed.algorithmVersions,operations:changed.operations})))};
    await expect(parseImmutableScoreWorkspace(JSON.stringify(forged))).rejects.toThrow();
    await expect(parseImmutableScoreWorkspace("broken")).rejects.toThrow();
    expect(await exportScoreWorkspace(await parseImmutableScoreWorkspace(text))).toBe(text);
  });
  it("does not retain oversized proofs in the single-entry reuse slot",async()=>{
    const original=await fixture("proof:oversized");
    // Unknown imported fields remain opaque original bytes; they grant no approval.
    const text=JSON.stringify({...original,padding:"x".repeat(16_000_001)});
    const first=await parseImmutableScoreWorkspace(text),second=await parseImmutableScoreWorkspace(text);
    expect(second).not.toBe(first);
    expect(await replayScoreWorkspace(second)).toEqual(await replayScoreWorkspace(first));
  });
});
