import { describe,expect,it } from "vitest";
import { APPLICATION_ALGORITHM_VERSION_REGISTRY as V } from "../../app/algorithm-version-registry";
import { originFromMusicXml, workspaceEvidenceDigest } from "./input";
import { applyWorkspaceCommand,createScoreWorkspace,exportScoreWorkspace,parseScoreWorkspace,replayScoreWorkspace } from "./journal";
import { deriveWorkspaceCapabilities,workspaceReviewFingerprint } from "./review";
import { resolveWorkspaceIssueDependencies, workspaceReviewQuestionKey } from "./review-dependencies";
import type { ScoreWorkspace,WorkspaceCommand,WorkspaceOrigin,WorkspaceState } from "./model";
const voice="lead:p:0:s:1:v:1:1";
function xml() { return `<score-partwise><part-list><score-part id="P1"><part-name>Independent</part-name></score-part></part-list><part id="P1">${Array.from({length:5},(_,m)=>`<measure number="${m+1}">${m===0?'<attributes><divisions>1</divisions><key><fifths>0</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>':''}${[0,1].map(n=>`<note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice>${m===3&&n===1?'<notations><slur number="1" type="stop"/></notations>':''}<lyric number="1"><text>word-${m}-${n}</text></lyric></note>`).join('')}</measure>`).join('')}</part></score-partwise>`; }
const act=(w:ScoreWorkspace,c:WorkspaceCommand)=>applyWorkspaceCommand(w,w,c,{id:`dep:${w.revision}`,note:"Independent current fact comparison",actor:"ui-test",at:"2026-09-21T00:00:00Z"});
async function start(){let w=await createScoreWorkspace(await originFromMusicXml(new TextEncoder().encode(xml()),"independent.xml"),V,"dep:independent");w=await act(w,{kind:"lead",lead:voice,rhythmVoices:[]});return w;}
async function review(w:ScoreWorkspace){for(const m of (await replayScoreWorkspace(w)).music!.parts[0].measures)w=await act(w,{kind:"attest",purpose:"music",scope:{kind:"measure",measureId:m.workspaceMeasureId!,voiceKey:voice}});return w;}
const current=async(w:ScoreWorkspace)=>(await deriveWorkspaceCapabilities(await replayScoreWorkspace(w),await workspaceEvidenceDigest(w.origin))).musicReviews.map(m=>m.current);
describe("v3 dependencies without invented slur reach",()=>{
  it("uses all unresolved attachment alternatives and physical intervals without approving or choosing a lyric",async()=>{
    const state=await replayScoreWorkspace(await start());
    const candidates=[
      {feature:"lyric",attachmentOptions:[{eventId:"d0p0m0n0"},{eventId:"d0p0m1n0"}]},
      {feature:"lyric",association:{alternatives:[[2,"0"],[3,"1/2"]]}},
      {feature:"lyric",systemIndex:0,sourceBox:[12,60,18,70]},
      {feature:"lyric",systemIndex:0,sourceBox:[19,60,22,70]},
      {feature:"lyric",systemIndex:0,sourceBox:[-10,60,-1,70]},
      {feature:"lyric",association:{eventIds:["d0p0m0n0","unknown-target"]}},
      {feature:"lyric",association:{eventIds:["d0p0m0n0"],alternatives:[["unknown",0]]}},
    ];
    // Resolver-only metadata fixture; never passed as an approved/importable
    // candidate or used to bypass validateLocalCandidate in journal ingestion.
    const origin={localCandidate:{artifacts:{evidence:{text:JSON.stringify({candidates})},links:{text:JSON.stringify({measures:[0,1,2,3,4].map(i=>({measure:{id:`p0m${i}`,systemIndex:0},box:[i*10,10,i*10+10,50]}))})}}}} as WorkspaceOrigin;
    const s:WorkspaceState={...state,issues:candidates.map((_,i)=>({id:`candidate:${i}`,kind:"lyrics",scope:{kind:"document"},targetIds:[],messageKo:"Unresolved lyric",requiredAction:"compare",evidenceRef:`evidence/candidates/${i}`,impacts:["arrange"]}))};
    const deps=resolveWorkspaceIssueDependencies(s,origin);
    expect(deps[0]).toMatchObject({measureIds:["p0m0","p0m1"],eventIds:["p0m0n0","p0m1n0"],association:"event"});
    expect(deps[1].measureIds).toEqual(["p0m2","p0m3"]);
    expect(deps[2]).toMatchObject({measureIds:["p0m1"],eventIds:[],association:"region"});
    expect(deps[3].measureIds).toEqual(["p0m1","p0m2"]);
    expect(deps[4]).toMatchObject({association:"system",measureIds:["p0m0","p0m1","p0m2","p0m3","p0m4"]});
    expect(deps).toHaveLength(5);expect(deps.some(d=>['candidate:5','candidate:6'].includes(d.issueId))).toBe(false);
    expect(s.attestations).toEqual([]);expect(s.issues).toHaveLength(7);
  });
  it("a late repair of a same-measure orphan stop invalidates only that actual measure, including after restart and Undo/Redo",async()=>{
    let w=await review(await start());expect(await current(w)).toEqual([true,true,true,true,true]);
    const original=w;
    w=await act(w,{kind:"event-slurs",eventId:"p0m3n0",slurs:[{number:1,type:"start"}]});
    expect(await current(w)).toEqual([true,true,true,false,true]);
    w=await parseScoreWorkspace(' '+await exportScoreWorkspace(w));expect(await current(w)).toEqual([true,true,true,false,true]);
    w=await act(w,{kind:"undo"});expect(await current(w)).toEqual([true,true,true,true,true]);
    w=await act(w,{kind:"redo"});expect(await current(w)).toEqual([true,true,true,false,true]);
    expect((await replayScoreWorkspace(original)).attestations).toHaveLength(5);
  });
  it("does not turn an unqualified measure index into a first-part assertion",async()=>{
    const state=await replayScoreWorkspace(await start()),first=state.music!.parts[0];
    const second={...first,partOrdinal:1,measures:first.measures.map(m=>({...m,workspaceMeasureId:m.workspaceMeasureId!.replace('p0','p1')}))};
    const candidates=[{feature:'lyric',measureIndex:2},{feature:'lyric',measureIndex:2,partIndex:1},{feature:'lyric',measureIndex:9}];
    const origin={localCandidate:{artifacts:{evidence:{text:JSON.stringify({candidates})},links:{text:JSON.stringify({measures:[]})}}}} as WorkspaceOrigin;
    const s:WorkspaceState={...state,music:{...state.music!,parts:[first,second]},issues:candidates.map((_,i)=>({id:`candidate:${i}`,kind:'lyrics',scope:{kind:'document'},targetIds:[],messageKo:'Compare all possible parts',requiredAction:'compare',evidenceRef:`evidence/candidates/${i}`,impacts:['arrange']}))};
    const deps=resolveWorkspaceIssueDependencies(s,origin);
    expect(deps[0].measureIds).toEqual(['p0m2','p1m2']);
    expect(deps[1].measureIds).toEqual(['p1m2']);
    expect(deps.find(d=>d.issueId==='candidate:2')).toBeUndefined();
  });
  it("keeps title edits unrelated but invalidates changed evidence and lyric connection endpoints",async()=>{
    const state=await replayScoreWorkspace(await start());
    const dependency={issueId:'candidate:0',field:'lyrics' as const,measureIds:['p0m3'],eventIds:['p0m3n1'],association:'event' as const};
    const issue={id:dependency.issueId,kind:'lyrics' as const,scope:{kind:'document' as const},targetIds:[],messageKo:'Compare attachment',requiredAction:'compare' as const,evidenceRef:'evidence/candidates/0',impacts:['arrange' as const]};
    const s:WorkspaceState={...state,issues:[issue],reviewIssueDependencies:[dependency]};
    const fp=(value:WorkspaceState,evidence='original-evidence')=>workspaceReviewFingerprint(value,issue.scope,evidence,3,issue.id);
    const before=await fp(s),renamed={...s,music:{...s.music!,title:'Only display metadata'}};
    expect(await fp(renamed)).toBe(before);
    expect(await fp(s,'replacement-evidence')).not.toBe(before);
    const connected=structuredClone(s);
    Object.assign(connected.music!.parts[0].measures[1].leadEvents[0],{slurs:[{number:1,type:'start'}]});
    expect(await fp(connected)).not.toBe(before);
    const moved=structuredClone(connected);
    Object.assign(moved.music!.parts[0].measures[1].leadEvents[0],{slurs:[]});
    Object.assign(moved.music!.parts[0].measures[2].leadEvents[0],{slurs:[{number:1,type:'start'}]});
    expect(await fp(moved)).not.toBe(await fp(connected));
  });
  it("a new distant endpoint invalidates endpoints and the real interior, while measures outside the span retain reviews",async()=>{
    let w=await review(await start());
    w=await act(w,{kind:"event-slurs",eventId:"p0m1n0",slurs:[{number:1,type:"start"}]});
    expect(await current(w)).toEqual([true,false,false,false,true]);
  });
  it("lyrics depend on their actual attachment and competing voice, not unrelated pitch or chord fields",async()=>{
    const state=await replayScoreWorkspace(await start()),issue={id:"candidate:0",kind:"lyrics" as const,scope:{kind:"document" as const},targetIds:[],messageKo:"Compare lyric and attachment",requiredAction:"compare" as const,evidenceRef:"evidence/candidates/0",impacts:["arrange" as const]};
    const s:WorkspaceState={...state,issues:[issue],reviewIssueDependencies:[{issueId:issue.id,field:"lyrics",measureIds:["p0m0"],eventIds:["p0m0n0"],association:"event"}]};
    const fp=(v:WorkspaceState)=>workspaceReviewFingerprint(v,issue.scope,"independent-evidence",3,issue.id),original=await fp(s);
    const unrelated=structuredClone(s);const e=unrelated.music!.parts[0].measures[4].leadEvents[0];if(e.kind!=="rest")Object.assign(e,{lyrics:[{...e.lyrics[0],text:"unrelated"}]});expect(await fp(unrelated)).toBe(original);
    const changed=structuredClone(s),target=changed.music!.parts[0].measures[0].leadEvents[0];if(target.kind!=="rest")Object.assign(target,{lyrics:[{...target.lyrics[0],text:"changed"}]});expect(await fp(changed)).not.toBe(original);
    const moved=structuredClone(s);Object.assign(moved.music!.parts[0].measures[0].leadEvents[0],{candidateKey:"lead:p:0:s:1:v:1:2"});expect(await fp(moved)).not.toBe(original);
    const competing=structuredClone(s);Object.assign(competing.music!.parts[0].measures[0],{leadEvents:[...competing.music!.parts[0].measures[0].leadEvents,{...target,workspaceEventId:"extra",candidateKey:"lead:p:0:s:1:v:1:2"}]});expect(await fp(competing)).not.toBe(original);
  });
  it("groups only the same explicit field and attachment, leaving different musical questions separate",()=>{
    const issue={id:"one"} as Parameters<typeof workspaceReviewQuestionKey>[0];
    const dependency={issueId:"one",field:"lyrics" as const,measureIds:["p0m0"],eventIds:["p0m0n0"],association:"event" as const};
    expect(workspaceReviewQuestionKey(issue,dependency)).toBe(workspaceReviewQuestionKey({...issue,id:"two"},{...dependency,issueId:"two"}));
    expect(workspaceReviewQuestionKey(issue,dependency)).not.toBe(workspaceReviewQuestionKey(issue,{...dependency,eventIds:["p0m0n1"]}));
    expect(workspaceReviewQuestionKey(issue,dependency)).not.toBe(workspaceReviewQuestionKey(issue,{...dependency,field:"chord"}));
    expect(workspaceReviewQuestionKey(issue)).not.toBe(workspaceReviewQuestionKey({...issue,id:"two"}));
    const region={...dependency,eventIds:[],association:'region' as const};
    expect(workspaceReviewQuestionKey(issue,region,{sourceBox:[1,2,3,4]})).toBe(workspaceReviewQuestionKey({...issue,id:'two'},region,{sourceBox:[1,2,3,4]}));
    expect(workspaceReviewQuestionKey(issue,region,{sourceBox:[1,2,3,4]})).not.toBe(workspaceReviewQuestionKey({...issue,id:'two'},region,{sourceBox:[4,2,6,4]}));
    expect(workspaceReviewQuestionKey(issue,region)).not.toBe(workspaceReviewQuestionKey({...issue,id:'two'},region));
  });
});
