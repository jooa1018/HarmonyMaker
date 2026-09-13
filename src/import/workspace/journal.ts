import { semanticDigest, canonicalJson, binaryDigest } from "../../domain/digest/canonical";
import { exactJson,asciiProofJson } from "./encoding";
import { isCanonicalId, isSemanticDigest } from "../../domain/validation";
import type { Step3ImportVersions } from "../musicxml/types";
import { seedWorkspace, workspaceEvidenceDigest } from "./input";
import { changedWorkspaceTargets, clean, reduceWorkspaceEdit, requireMeasure } from "./edit";
import { workspaceReviewFingerprint } from "./review";
import { SCORE_WORKSPACE_VERSION, type ScoreWorkspace, type WorkspaceState, type WorkspaceCommand, type WorkspaceOperation, type WorkspaceAttestation, type WorkspaceOrigin, type WorkspaceEdit } from "./model";

type StepOperation = Omit<WorkspaceOperation,"beforeDigest"|"afterDigest"|"affectedIds">;
interface Replay {
  readonly seed: WorkspaceState; readonly state: WorkspaceState;
  readonly active: readonly WorkspaceOperation[]; readonly redo: readonly WorkspaceOperation[];
  readonly evidenceDigest: string; readonly origin: WorkspaceOrigin;
  /** Captured at the original chronological attestation, never during Undo. */
  readonly legacyReviewAnchors: ReadonlyMap<string,string>;
  readonly migratedLegacyReviews: ReadonlySet<string>;
  readonly dependencyV2Started?: true;
  readonly lastOperation?: StepOperation;
}
const cache = new WeakMap<ScoreWorkspace,{serialized:string;value:Replay}>();
const MAX_REUSED_PROOF_CHARS = 8_000_000;
interface ProofReplayEntry {
  readonly text: string; readonly serialized: string;
  readonly bundle: { readonly workspace: ScoreWorkspace; readonly replay: Replay };
}
let proofReplay: ProofReplayEntry | undefined;
function rememberVerifiedProof(text: string, workspace: ScoreWorkspace, value: Replay): void {
  if (text.length > MAX_REUSED_PROOF_CHARS) { proofReplay = undefined; return; }
  const serialized = JSON.stringify(workspace), verified = cache.get(workspace);
  // replay can yield. Never register a caller mutation made after its check,
  // or a serialization that differs from the exact bytes being returned/read.
  if (verified?.serialized !== serialized || verified.value !== value
    || exactJson(JSON.parse(text)) !== exactJson(workspace)) return;
  // Keep origin, active commands, maps and states private too. A readonly type
  // alone would not prevent one parsed workspace from poisoning another call.
  const bundle = structuredClone({ workspace, replay: value });
  cache.set(bundle.workspace, { serialized, value: bundle.replay });
  proofReplay = { text, serialized, bundle };
}
export const workspaceStateDigest = (state: WorkspaceState) => semanticDigest({schema:SCORE_WORKSPACE_VERSION,state:clean(state)});
async function historyDigest(value:Pick<ScoreWorkspace,"id"|"origin"|"algorithmVersions"|"operations">) {
  return binaryDigest(new TextEncoder().encode(exactJson({schema:"hm-workspace-history-seal-v1",id:value.id,
    evidenceDigest:await workspaceEvidenceDigest(value.origin),algorithmVersions:value.algorithmVersions,operations:value.operations})));
}
function checkMeta(op: Pick<WorkspaceOperation,"id"|"note"|"actor"|"at">) {
  if(!isCanonicalId(op.id)||op.id.length>128||typeof op.note!=="string"||op.note.trim().length<3||op.note.length>2048
    ||!["user","ui-test"].includes(op.actor)||!Number.isFinite(Date.parse(op.at))) throw new RangeError("WORKSPACE_OPERATION_INVALID");
}
async function migrateLegacyReviews(current: Replay, state: WorkspaceState): Promise<Pick<Replay,"state"|"migratedLegacyReviews">> {
  const migrated = new Set(current.migratedLegacyReviews);
  const fingerprints = new Map<string,Promise<readonly [string|undefined,string|undefined]>>();
  const values = (scope: WorkspaceAttestation["scope"]) => {
    const key = canonicalJson(scope); const found = fingerprints.get(key); if(found)return found;
    // Missing scopes become invalid. They never acquire a new user approval.
    const calculate = (value:WorkspaceState) => workspaceReviewFingerprint(value,scope,current.evidenceDigest,2).catch(()=>undefined);
    const result = Promise.all([calculate(current.state),calculate(state)]); fingerprints.set(key,result); return result;
  };
  const invalidated:string[]=[];
  for(const attestation of current.state.attestations) {
    if(attestation.dependencyVersion!==undefined)continue;
    const [before,after] = await values(attestation.scope);
    if(before!==after)migrated.add(attestation.id);
    if(!migrated.has(attestation.id))continue;
    const anchor = current.legacyReviewAnchors.get(attestation.id);
    if(!anchor)throw new RangeError("WORKSPACE_LEGACY_REVIEW_ANCHOR_MISSING");
    if(after!==anchor)invalidated.push(attestation.id);
  }
  const next = { ...state };
  if(invalidated.length)next.invalidatedLegacyReviewIds=[...new Set(invalidated)].sort();
  else delete next.invalidatedLegacyReviewIds;
  return {state:next,migratedLegacyReviews:migrated};
}
async function step(current: Replay, op: StepOperation, record = false): Promise<Replay> {
  const command=op.command;
  if(!command||typeof command!=="object") throw new RangeError("WORKSPACE_COMMAND_INVALID");
  if(op.reviewDependencyVersion!==undefined&&op.reviewDependencyVersion!==2
    ||op.reviewDependencyVersion===undefined&&op.invalidatedLegacyReviewIds!==undefined)throw new RangeError("WORKSPACE_REVIEW_VERSION_INVALID");
  if(current.dependencyV2Started&&op.reviewDependencyVersion!==2)throw new RangeError("WORKSPACE_REVIEW_VERSION_DOWNGRADE");
  const isEdit = !["attest","undo","redo"].includes(command.kind);
  const finish = async (next:Replay):Promise<Replay> => {
    let recorded = op;
    if(op.reviewDependencyVersion===2) {
      next={...next,...await migrateLegacyReviews(current,next.state),dependencyV2Started:true};
      const ids=next.state.invalidatedLegacyReviewIds??[];
      if(!record&&(!Array.isArray(op.invalidatedLegacyReviewIds)||canonicalJson(op.invalidatedLegacyReviewIds)!==canonicalJson(ids)))throw new RangeError("WORKSPACE_REVIEW_MIGRATION_SUBSTITUTED");
      recorded={...op,invalidatedLegacyReviewIds:ids};
    }
    return {...next,lastOperation:recorded,...(isEdit?{active:[...next.active.slice(0,-1),recorded as WorkspaceOperation]}:{})};
  };
  if(command.kind==="attest") {
    if(!["music","issue"].includes(command.purpose)||!["measure","document","metadata"].includes(command.scope.kind)) throw new RangeError("WORKSPACE_REVIEW_INVALID");
    if(command.scope.kind==="measure") requireMeasure(current.state,command.scope.measureId);
    if(command.purpose==="music"&&(command.scope.kind!=="measure"||!command.scope.voiceKey||!current.state.music?.leadCandidates.map(c=>c.key).includes(command.scope.voiceKey))) throw new RangeError("WORKSPACE_REVIEW_SCOPE_REQUIRED");
    const issue=command.issueId?current.state.issues.find(i=>i.id===command.issueId):undefined;
    if(command.purpose==="issue"&&(!issue||issue.requiredAction!=="compare"||canonicalJson(issue.scope)!==canonicalJson(command.scope))) throw new RangeError("WORKSPACE_ISSUE_NOT_RESOLVABLE_BY_ATTESTATION");
    const targets=command.scope.kind==="measure"?[command.scope.measureId]:[];
    const records: WorkspaceAttestation[]=[{id:`review:${op.id}`,scope:clean(command.scope),purpose:command.purpose,...(issue?{issueId:issue.id}:{}),
      dependencyFingerprint:await workspaceReviewFingerprint(current.state,command.scope,current.evidenceDigest,op.reviewDependencyVersion??1),
      ...(op.reviewDependencyVersion===2?{dependencyVersion:2 as const}:{}),targetIds:targets,evidenceDigest:current.evidenceDigest,note:op.note,actor:op.actor,at:op.at}];
    // This explicitly labeled UI action covers this measure's correspondence
    // items too. Unknown curves and document-wide uncertainties are never swept in.
    if(command.purpose==="music"&&command.scope.kind==="measure") for(const local of current.state.issues) {
      if(local.kind!=="correspondence"||local.requiredAction!=="compare"||local.scope.kind!=="measure"||local.scope.measureId!==command.scope.measureId
        ||local.scope.voiceKey&&local.scope.voiceKey!==command.scope.voiceKey) continue;
      records.push({...records[0],id:`review:${op.id}:${local.id}`,purpose:"issue",issueId:local.id,scope:local.scope,
        dependencyFingerprint:await workspaceReviewFingerprint(current.state,local.scope,current.evidenceDigest,op.reviewDependencyVersion??1)});
    }
    const legacyReviewAnchors=new Map(current.legacyReviewAnchors);
    if(op.reviewDependencyVersion===undefined)for(const record of records)legacyReviewAnchors.set(record.id,await workspaceReviewFingerprint(current.state,record.scope,current.evidenceDigest,2));
    return finish({...current,legacyReviewAnchors,state:{...current.state,attestations:[...current.state.attestations,...records]}});
  }
  if(command.kind==="undo"||command.kind==="redo") {
    const from=command.kind==="undo"?current.active:current.redo, last=from.at(-1);
    if(!last) throw new RangeError("WORKSPACE_NOTHING_TO_UNDO_OR_REDO");
    const active=command.kind==="undo"?current.active.slice(0,-1):[...current.active,last];
    const redo=command.kind==="undo"?[...current.redo,last]:current.redo.slice(0,-1);
    let state={...structuredClone(current.seed),attestations:current.state.attestations};
    for(const edit of active) state=reduceWorkspaceEdit(state,edit.command as WorkspaceEdit,edit.id,current.origin,current.seed,edit.reviewDependencyVersion??1);
    return finish({...current,state:clean(state),active,redo});
  }
  const state=clean(reduceWorkspaceEdit(current.state,command,op.id,current.origin,current.seed,op.reviewDependencyVersion??1));
  // History metadata is filled by the caller; reducers only need ID and command.
  const history=op as WorkspaceOperation;
  return finish({...current,state,active:[...current.active,history],redo:[]});
}
async function replay(value: ScoreWorkspace): Promise<Replay> {
  const serialized=JSON.stringify(value);
  if(serialized.length>64_000_000||value.version!==SCORE_WORKSPACE_VERSION||!isCanonicalId(value.id)||value.id.length>128
    ||!Array.isArray(value.operations)||value.operations.length>2048||value.revision!==value.operations.length||!isSemanticDigest(value.digest)||!isSemanticDigest(value.historyDigest)) throw new RangeError("WORKSPACE_HISTORY_INVALID");
  const hit=cache.get(value); if(hit?.serialized===serialized) return hit.value;
  if(value.historyDigest!==await historyDigest(value))throw new RangeError("WORKSPACE_HISTORY_SEAL_INVALID");
  const seed=await seedWorkspace(value.origin,value.algorithmVersions,value.id);
  let current:Replay={seed,state:seed,active:[],redo:[],evidenceDigest:await workspaceEvidenceDigest(value.origin),origin:value.origin,legacyReviewAnchors:new Map(),migratedLegacyReviews:new Set()};
  const ids=new Set<string>();
  for(const op of value.operations) {
    checkMeta(op);
    if(ids.has(op.id)||op.beforeDigest!==await workspaceStateDigest(current.state)) throw new RangeError("WORKSPACE_HISTORY_INVALID");
    ids.add(op.id);const next=await step(current,op);
    if(op.afterDigest!==await workspaceStateDigest(next.state)||canonicalJson(op.affectedIds)!==canonicalJson(changedWorkspaceTargets(current.state,next.state))) throw new RangeError("WORKSPACE_HISTORY_INVALID");
    current=next;
  }
  if(value.digest!==await workspaceStateDigest(current.state)) throw new RangeError("WORKSPACE_SNAPSHOT_SUBSTITUTED");
  cache.set(value,{serialized,value:current});return current;
}
export async function createScoreWorkspace(origin: WorkspaceOrigin, versions: Step3ImportVersions, id: string): Promise<ScoreWorkspace> {
  if(!isCanonicalId(id)||id.length>128) throw new RangeError("WORKSPACE_ID_INVALID");
  const seed=await seedWorkspace(origin,versions,id);
  const value:ScoreWorkspace={version:SCORE_WORKSPACE_VERSION,id,origin:structuredClone(origin),algorithmVersions:structuredClone(versions),operations:[],revision:0,digest:await workspaceStateDigest(seed),historyDigest:await historyDigest({id,origin,algorithmVersions:versions,operations:[]})};
  cache.set(value,{serialized:JSON.stringify(value),value:{seed,state:seed,active:[],redo:[],evidenceDigest:await workspaceEvidenceDigest(origin),origin:value.origin,legacyReviewAnchors:new Map(),migratedLegacyReviews:new Set()}});return value;
}
export async function replayScoreWorkspace(value: ScoreWorkspace): Promise<WorkspaceState> { return structuredClone((await replay(value)).state); }
export async function applyWorkspaceCommand(value: ScoreWorkspace, expected: {revision:number;digest:string}, command: WorkspaceCommand,
  meta: Pick<WorkspaceOperation,"id"|"note"|"actor"|"at">): Promise<ScoreWorkspace> {
  if(expected.revision!==value.revision||expected.digest!==value.digest) throw new RangeError("WORKSPACE_STALE_REVISION");
  checkMeta(meta);
  if(value.operations.length>=2048||value.operations.some(o=>o.id===meta.id)) throw new RangeError("WORKSPACE_OPERATION_INVALID");
  const current=await replay(value), next=await step(current,{...meta,command:clean(command),reviewDependencyVersion:2},true);
  const afterDigest=await workspaceStateDigest(next.state);
  const op:WorkspaceOperation={...next.lastOperation!,beforeDigest:value.digest,afterDigest,affectedIds:changedWorkspaceTargets(current.state,next.state)};
  const changed={...value,operations:[...value.operations,op],revision:value.revision+1,digest:afterDigest};
  const result={...changed,historyDigest:await historyDigest(changed)};
  if(JSON.stringify(result).length>64_000_000) throw new RangeError("WORKSPACE_LIMIT");
  cache.set(result,{serialized:JSON.stringify(result),value:next});return result;
}
export async function parseScoreWorkspace(text: string): Promise<ScoreWorkspace> {
  if(text.length>64_000_000) throw new RangeError("WORKSPACE_LIMIT");
  const hit = proofReplay;
  if (hit?.text === text && JSON.stringify(hit.bundle.workspace) === hit.serialized) {
    await replay(hit.bundle.workspace); // Preserve the ordinary mutation/limit guard.
    const bundle = structuredClone(hit.bundle);
    cache.set(bundle.workspace, { serialized: JSON.stringify(bundle.workspace), value: bundle.replay });
    return bundle.workspace;
  }
  const value=JSON.parse(text) as ScoreWorkspace,verified=await replay(value);
  rememberVerifiedProof(text,value,verified);return value;
}
export async function exportScoreWorkspace(value: ScoreWorkspace): Promise<string> {
  const verified=await replay(value),text=asciiProofJson(value);
  rememberVerifiedProof(text,value,verified);return text;
}
