import { describe, expect, it } from "vitest";
import { APPLICATION_ALGORITHM_VERSION_REGISTRY as V } from "../../app/algorithm-version-registry";
import { canonicalJson } from "../../domain/digest/canonical";
import { deriveQuickReview } from "../review/quick-review";
import { originFromMusicXml, workspaceEvidenceDigest } from "./input";
import { applyWorkspaceCommand, createScoreWorkspace, exportScoreWorkspace, parseScoreWorkspace, replayScoreWorkspace } from "./journal";
import { projectScoreWorkspace, validateProjectedWorkspaceDraft } from "./projection";
import { deriveWorkspaceCapabilities } from "./review";
import { workspaceSourceChordPolicyMatches } from "./source-integrity";
import type { ScoreWorkspace, WorkspaceCommand } from "./model";

// Independently written public fixture; no user score or private proof.
const xml = '<score-partwise><work><work-title>Public pickup policy fixture</work-title></work><part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list><part id="P1"><measure number="1" implicit="yes"><attributes><divisions>4</divisions><key><fifths>-2</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><lyric><text>one</text></lyric></note><note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><lyric><text>two</text></lyric></note></measure><measure number="2"><harmony><root><root-step>B</root-step><root-alter>-1</root-alter></root><kind>major</kind></harmony><note><pitch><step>B</step><alter>-1</alter><octave>4</octave></pitch><duration>16</duration><voice>1</voice><lyric><text>three</text></lyric></note></measure></part></score-partwise>';
const act = (w: ScoreWorkspace, command: WorkspaceCommand) => applyWorkspaceCommand(w,w,command,{
  id:"op:"+w.revision, note:"공개 fixture: 원본과 별개의 편곡 정책을 명시적으로 시험",
  actor:"ui-test", at:"2026-09-14T00:00:00Z",
});
async function ready() {
  let w=await createScoreWorkspace(await originFromMusicXml(new TextEncoder().encode(xml),"pickup.musicxml"),V,"workspace:pickup-policy");
  let s=await replayScoreWorkspace(w);
  w=await act(w,{kind:"lead",lead:s.music!.leadCandidates[0].key,rhythmVoices:[]});
  w=await act(w,{kind:"tempo",tempo:{beatUnit:4,dotted:false,bpm:62}});
  const pitch=(octave:number)=>({step:"C" as const,alter:0 as const,octave});
  w=await act(w,{kind:"performers",count:2,slots:[0,1].map(i=>({id:"pf:"+i,displayName:"Public test "+i,profile:{id:"pf:"+i,displayName:"Public test "+i,hardRange:{low:pitch(3),high:pitch(6)},comfortableRange:{low:pitch(3),high:pitch(6)}}}))});
  w=await act(w,{kind:"rights",rights:{basis:"self-authored",allowedUses:["generation"]}});
  s=await replayScoreWorkspace(w);
  w=await act(w,{kind:"sections",sections:s.request.sections.map(section=>({...section,type:"verse",confirmation:"confirmed"})),lyricVerses:{}});
  s=await replayScoreWorkspace(w);
  for(const m of s.music!.parts[0].measures)w=await act(w,{kind:"attest",purpose:"music",scope:{kind:"measure",measureId:m.workspaceMeasureId!,voiceKey:s.request.lead!}});
  return w;
}

describe("workspace arrangement pickup request",()=>{
  it("keeps printed chords and original music unchanged through explicit policy/Undo/Redo/reload",async()=>{
    const base=await ready(),before=await replayScoreWorkspace(base);
    const defaultDraft=await projectScoreWorkspace(base);
    expect(defaultDraft.chordResolutionPolicy).toBeUndefined();
    expect((await deriveQuickReview(defaultDraft,V)).chordTimelineState.status).toBe("blocked");
    let w=await act(base,{kind:"pickup-policy",value:"anticipate-first-chord"});
    let s=await replayScoreWorkspace(w);
    expect(canonicalJson(s.music)).toBe(canonicalJson(before.music));
    expect(s.music!.parts[0].measures[0].chords).toEqual([]);
    expect((await deriveWorkspaceCapabilities(s,await workspaceEvidenceDigest(w.origin))).musicReviews.every(item=>item.current)).toBe(true);
    const selectedDraft=await projectScoreWorkspace(w),review=await deriveQuickReview(selectedDraft,V);
    expect(review.state.readyForPlanning,JSON.stringify(review.diagnostics)).toBe(true);
    expect(review.source!.sourceMeasures[0].chordEvents).toEqual([]);
    expect(review.chordTimelineState).toMatchObject({status:"resolved",timeline:{spans:expect.arrayContaining([expect.objectContaining({origin:expect.objectContaining({kind:"arrangement-policy"})})])}});
    expect(await workspaceSourceChordPolicyMatches(review.source!,{gapPolicy:"carry-until-next",initialPickup:"anticipate-first-chord"})).toBe(true);
    expect(await workspaceSourceChordPolicyMatches(review.source!,{gapPolicy:"carry-until-next"})).toBe(false);
    await expect(validateProjectedWorkspaceDraft({...selectedDraft,chordResolutionPolicy:undefined})).rejects.toThrow("WORKSPACE_PROJECTION_SUBSTITUTED");
    w=await act(w,{kind:"undo"});s=await replayScoreWorkspace(w);
    expect(s.request.initialPickup).toBeUndefined();expect(canonicalJson(s.music)).toBe(canonicalJson(before.music));
    w=await act(w,{kind:"redo"});w=await parseScoreWorkspace(await exportScoreWorkspace(w));
    expect((await replayScoreWorkspace(w)).request.initialPickup).toBe("anticipate-first-chord");
    expect((await deriveQuickReview(await projectScoreWorkspace(w),V)).state.readyForPlanning).toBe(true);
  });
  it("rejects an invented policy and preserves a missing policy in old proofs",async()=>{
    const w=await ready(),encoded=await exportScoreWorkspace(w);
    expect((await replayScoreWorkspace(await parseScoreWorkspace(encoded))).request.initialPickup).toBeUndefined();
    await expect(act(w,{kind:"pickup-policy",value:"make-up-chords"} as unknown as WorkspaceCommand)).rejects.toThrow("WORKSPACE_EDIT_INVALID");
  });
});
