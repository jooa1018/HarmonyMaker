import { semanticDigest, canonicalJson, binaryDigest } from "../../domain/digest/canonical";
import { exactJson,asciiProofJson } from "./encoding";
import { isCanonicalId, isSemanticDigest } from "../../domain/validation";
import type { Step3ImportVersions } from "../musicxml/types";
import { seedWorkspace, workspaceEvidenceDigest } from "./input";
import { changedWorkspaceTargets, clean, reduceWorkspaceEdit, requireMeasure } from "./edit";
import { retainWorkspaceReviewsV3, workspaceReviewFingerprint } from "./review";
import { createReplayStateDigester } from "./replay-digest";
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
  readonly dependencyV3Started?: true;
  readonly lastOperation?: StepOperation;
  /** Private to this verified state lineage; edits always replace the map. */
  readonly reviewFingerprints: Map<string, string>;
}
interface VerifiedReplay {
  readonly serialized:string; readonly value:Replay; readonly encoded?:string;
  readonly digestState?:ReturnType<typeof createReplayStateDigester>;
}
const cache = new WeakMap<ScoreWorkspace,VerifiedReplay>();
// Membership is private and only granted to a newly parsed, deeply frozen
// copy after full replay. Object.freeze supplied by a caller is not authority.
const immutableWorkspaces = new WeakSet<ScoreWorkspace>();
function captureWorkspace(value:ScoreWorkspace):string {
  return immutableWorkspaces.has(value)?cache.get(value)!.serialized:JSON.stringify(value);
}
function immutableVerifiedWorkspace(verified:VerifiedReplay):ScoreWorkspace {
  const snapshot=JSON.parse(verified.serialized) as ScoreWorkspace;
  const pending:object[]=[snapshot];
  while(pending.length) {
    const node=pending.pop()!;
    for(const child of Object.values(node))if(child!==null&&typeof child==="object")pending.push(child);
    Object.freeze(node);
  }
  cache.set(snapshot,verified);immutableWorkspaces.add(snapshot);return snapshot;
}
/** A detached immutable working copy, not an assertion supplied by a reader.
 * Existing mutable APIs still check the caller's bytes on every use. */
export async function createImmutableWorkspace(value:ScoreWorkspace):Promise<ScoreWorkspace> {
  if(immutableWorkspaces.has(value))return value;
  const serialized=JSON.stringify(value),verified=await replay(value,serialized);
  if(JSON.stringify(value)!==serialized)throw new RangeError("WORKSPACE_MUTATED_DURING_PREPARATION");
  const hit=cache.get(value)!;
  return immutableVerifiedWorkspace(hit.serialized===serialized&&hit.value===verified?hit:{serialized,value:verified});
}
// One private entry only. Normal review history can take an image proof beyond
// 8 MB; retain that verified replay across Source/project validation instead of
// repeatedly replaying it. This is a cache bound, not the 64 MB input limit.
const MAX_REUSED_PROOF_CHARS = 16_000_000;
interface ProofReplayEntry {
  readonly text: string;
  readonly verified: VerifiedReplay;
}
let proofReplay: ProofReplayEntry | undefined;
function rememberVerifiedProof(text: string, verified: VerifiedReplay): void {
  if (text.length > MAX_REUSED_PROOF_CHARS) { proofReplay = undefined; return; }
  // Call sites establish the exact text/graph relationship: JSON.parse followed
  // by full replay, or synchronous encoding after replay's mutation guard.
  // Replay already owns its origin/commands/state. Keep that private graph and
  // immutable JSON bytes, never a caller-owned workspace or returned state.
  proofReplay = { text, verified };
}
export const workspaceStateDigest = (state: WorkspaceState) => semanticDigest({schema:SCORE_WORKSPACE_VERSION,state:clean(state)});
async function historyDigest(value:Pick<ScoreWorkspace,"id"|"origin"|"algorithmVersions"|"operations">, verifiedEvidence?:string) {
  return binaryDigest(new TextEncoder().encode(exactJson({schema:"hm-workspace-history-seal-v1",id:value.id,
    evidenceDigest:verifiedEvidence??await workspaceEvidenceDigest(value.origin),algorithmVersions:value.algorithmVersions,operations:value.operations})));
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
  if(op.reviewDependencyVersion!==undefined&&op.reviewDependencyVersion!==2&&op.reviewDependencyVersion!==3
    ||op.reviewDependencyVersion===undefined&&op.invalidatedLegacyReviewIds!==undefined)throw new RangeError("WORKSPACE_REVIEW_VERSION_INVALID");
  if(current.dependencyV2Started&&op.reviewDependencyVersion===undefined
    ||current.dependencyV3Started&&op.reviewDependencyVersion!==3)throw new RangeError("WORKSPACE_REVIEW_VERSION_DOWNGRADE");
  if(op.reviewDependencyVersion===3&&!current.dependencyV3Started) {
    current={...current,state:await retainWorkspaceReviewsV3(current.state,current.origin,current.evidenceDigest,op.id),reviewFingerprints:new Map()};
  }
  const isEdit = !["attest","undo","redo"].includes(command.kind);
  const fingerprint = async (scope: WorkspaceAttestation["scope"], version: 1 | 2 | 3, issueId?: string) => {
    const key = `${version}:${canonicalJson(scope)}:${version === 3 ? issueId ?? "" : ""}`;
    let value = current.reviewFingerprints.get(key);
    if (!value) {
      value = await workspaceReviewFingerprint(current.state, scope, current.evidenceDigest, version,issueId);
      current.reviewFingerprints.set(key, value);
    }
    return value;
  };
  const finish = async (next:Replay):Promise<Replay> => {
    let recorded = op;
    if(op.reviewDependencyVersion!==undefined) {
      next={...next,...await migrateLegacyReviews(current,next.state),dependencyV2Started:true,...(op.reviewDependencyVersion===3?{dependencyV3Started:true as const}:{})};
      const ids=next.state.invalidatedLegacyReviewIds??[];
      if(!record&&(!Array.isArray(op.invalidatedLegacyReviewIds)||canonicalJson(op.invalidatedLegacyReviewIds)!==canonicalJson(ids)))throw new RangeError("WORKSPACE_REVIEW_MIGRATION_SUBSTITUTED");
      recorded={...op,invalidatedLegacyReviewIds:ids};
    }
    return {...next,lastOperation:recorded,reviewFingerprints:command.kind === "attest" ? current.reviewFingerprints : new Map(),...(isEdit?{active:[...next.active.slice(0,-1),recorded as WorkspaceOperation]}:{})};
  };
  if(command.kind==="attest") {
    if(!["music","issue"].includes(command.purpose)||!["measure","document","metadata"].includes(command.scope.kind)) throw new RangeError("WORKSPACE_REVIEW_INVALID");
    if(command.scope.kind==="measure") requireMeasure(current.state,command.scope.measureId);
    if(command.purpose==="music"&&(command.scope.kind!=="measure"||!command.scope.voiceKey||!current.state.music?.leadCandidates.map(c=>c.key).includes(command.scope.voiceKey))) throw new RangeError("WORKSPACE_REVIEW_SCOPE_REQUIRED");
    const issue=command.issueId?current.state.issues.find(i=>i.id===command.issueId):undefined;
    if(command.purpose==="issue"&&(!issue||issue.requiredAction!=="compare"||canonicalJson(issue.scope)!==canonicalJson(command.scope))) throw new RangeError("WORKSPACE_ISSUE_NOT_RESOLVABLE_BY_ATTESTATION");
    const targets=command.scope.kind==="measure"?[command.scope.measureId]:[];
    const records: WorkspaceAttestation[]=[{id:`review:${op.id}`,scope:clean(command.scope),purpose:command.purpose,...(issue?{issueId:issue.id}:{}),
      dependencyFingerprint:await fingerprint(command.scope,op.reviewDependencyVersion??1,issue?.id),
      ...(op.reviewDependencyVersion!==undefined?{dependencyVersion:op.reviewDependencyVersion}:{}),targetIds:targets,evidenceDigest:current.evidenceDigest,note:op.note,actor:op.actor,at:op.at}];
    // This explicitly labeled UI action covers this measure's correspondence
    // items too. Unknown curves and document-wide uncertainties are never swept in.
    if(command.purpose==="music"&&command.scope.kind==="measure") for(const local of current.state.issues) {
      if(local.kind!=="correspondence"||local.requiredAction!=="compare"||local.scope.kind!=="measure"||local.scope.measureId!==command.scope.measureId
        ||local.scope.voiceKey&&local.scope.voiceKey!==command.scope.voiceKey) continue;
      records.push({...records[0],id:`review:${op.id}:${local.id}`,purpose:"issue",issueId:local.id,scope:local.scope,
        dependencyFingerprint:await fingerprint(local.scope,op.reviewDependencyVersion??1,local.id)});
    }
    const legacyReviewAnchors=new Map(current.legacyReviewAnchors);
    if(op.reviewDependencyVersion===undefined)for(const record of records)legacyReviewAnchors.set(record.id,await fingerprint(record.scope,2));
    return finish({...current,legacyReviewAnchors,state:{...current.state,attestations:[...current.state.attestations,...records]}});
  }
  if(command.kind==="undo"||command.kind==="redo") {
    const from=command.kind==="undo"?current.active:current.redo, last=from.at(-1);
    if(!last) throw new RangeError("WORKSPACE_NOTHING_TO_UNDO_OR_REDO");
    const active=command.kind==="undo"?current.active.slice(0,-1):[...current.active,last];
    const redo=command.kind==="undo"?[...current.redo,last]:current.redo.slice(0,-1);
    let state={...structuredClone(current.seed),attestations:current.state.attestations,...(current.state.reviewIssueDependencies?{reviewIssueDependencies:current.state.reviewIssueDependencies}:{})};
    for(const edit of active) state=reduceWorkspaceEdit(state,edit.command as WorkspaceEdit,edit.id,current.origin,current.seed,edit.reviewDependencyVersion??1);
    return finish({...current,state:clean(state),active,redo});
  }
  const state=clean(reduceWorkspaceEdit(current.state,command,op.id,current.origin,current.seed,op.reviewDependencyVersion??1));
  // History metadata is filled by the caller; reducers only need ID and command.
  const history=op as WorkspaceOperation;
  return finish({...current,state,active:[...current.active,history],redo:[]});
}
async function replay(value: ScoreWorkspace, serialized=captureWorkspace(value)): Promise<Replay> {
  if(serialized.length>64_000_000||value.version!==SCORE_WORKSPACE_VERSION||!isCanonicalId(value.id)||value.id.length>128
    ||!Array.isArray(value.operations)||value.operations.length>2048||value.revision!==value.operations.length||!isSemanticDigest(value.digest)||!isSemanticDigest(value.historyDigest)) throw new RangeError("WORKSPACE_HISTORY_INVALID");
  const hit=cache.get(value); if(hit?.serialized===serialized) return hit.value;
  // Snapshot before the first await: external mutation cannot poison the private
  // reducer graph or its identity-based, single-replay encoding reuse.
  const caller = value;
  value = JSON.parse(serialized) as ScoreWorkspace;
  if(value.historyDigest!==await historyDigest(value))throw new RangeError("WORKSPACE_HISTORY_SEAL_INVALID");
  const seed=await seedWorkspace(value.origin,value.algorithmVersions,value.id);
  let current:Replay={seed,state:seed,active:[],redo:[],evidenceDigest:await workspaceEvidenceDigest(value.origin),origin:value.origin,legacyReviewAnchors:new Map(),migratedLegacyReviews:new Set(),reviewFingerprints:new Map()};
  const digestState = createReplayStateDigester();
  let currentDigest = await digestState(current.state);
  const ids=new Set<string>();
  for(const op of value.operations) {
    checkMeta(op);
    if(ids.has(op.id)||op.beforeDigest!==currentDigest) throw new RangeError("WORKSPACE_HISTORY_INVALID");
    ids.add(op.id);const next=await step(current,op);
    const nextDigest = await digestState(next.state);
    if(op.afterDigest!==nextDigest||canonicalJson(op.affectedIds)!==canonicalJson(changedWorkspaceTargets(current.state,next.state))) throw new RangeError("WORKSPACE_HISTORY_INVALID");
    currentDigest = nextDigest;
    current=next;
  }
  if(value.digest!==currentDigest) throw new RangeError("WORKSPACE_SNAPSHOT_SUBSTITUTED");
  if(captureWorkspace(caller)!==serialized)throw new RangeError("WORKSPACE_MUTATED_DURING_VALIDATION");
  cache.set(caller,{serialized,value:current});return current;
}
export async function createScoreWorkspace(origin: WorkspaceOrigin, versions: Step3ImportVersions, id: string): Promise<ScoreWorkspace> {
  if(!isCanonicalId(id)||id.length>128) throw new RangeError("WORKSPACE_ID_INVALID");
  origin = structuredClone(origin); versions = structuredClone(versions);
  const seed=await seedWorkspace(origin,versions,id);
  const value:ScoreWorkspace={version:SCORE_WORKSPACE_VERSION,id,origin:structuredClone(origin),algorithmVersions:structuredClone(versions),operations:[],revision:0,digest:await workspaceStateDigest(seed),historyDigest:await historyDigest({id,origin,algorithmVersions:versions,operations:[]})};
  cache.set(value,{serialized:JSON.stringify(value),value:structuredClone({seed,state:seed,active:[],redo:[],evidenceDigest:await workspaceEvidenceDigest(origin),origin:value.origin,legacyReviewAnchors:new Map(),migratedLegacyReviews:new Set(),reviewFingerprints:new Map()})});return value;
}
export async function replayScoreWorkspace(value: ScoreWorkspace): Promise<WorkspaceState> { return structuredClone((await replay(value)).state); }
/** A coherent verified view; callers own the returned state, not the replay. */
export async function readVerifiedWorkspace(value: ScoreWorkspace): Promise<{state:WorkspaceState;evidenceDigest:string}> {
  const verified=await replay(value);
  return {state:structuredClone(verified.state),evidenceDigest:verified.evidenceDigest};
}
/** Still checks the caller's complete graph; never trusts a supplied digest. */
export async function verifiedWorkspaceEvidenceDigest(value: ScoreWorkspace): Promise<string> { return (await replay(value)).evidenceDigest; }
export async function applyWorkspaceCommand(value: ScoreWorkspace, expected: {revision:number;digest:string}, command: WorkspaceCommand,
  meta: Pick<WorkspaceOperation,"id"|"note"|"actor"|"at">): Promise<ScoreWorkspace> {
  return applyWorkspaceCommands(value,expected,[{command,meta}]);
}
/** One explicit UI transaction, preserving every individual operation and its
 * before/after seal. No intermediate workspace is exposed or persisted. */
export async function applyWorkspaceCommands(value: ScoreWorkspace, expected: {revision:number;digest:string}, entries: readonly {
  readonly command: WorkspaceCommand; readonly meta: Pick<WorkspaceOperation,"id"|"note"|"actor"|"at">;
}[]): Promise<ScoreWorkspace> {
  if(expected.revision!==value.revision||expected.digest!==value.digest) throw new RangeError("WORKSPACE_STALE_REVISION");
  if(!Array.isArray(entries)||!entries.length||entries.length>128||value.operations.length+entries.length>2048)throw new RangeError("WORKSPACE_OPERATION_INVALID");
  const ids=new Set(value.operations.map(o=>o.id));
  const operations=entries.map(({command,meta})=>{
    // Own metadata as well as the command before any await. Unknown nested
    // metadata must not retain a caller alias into a private replay lineage.
    const operation=clean({...meta,command,reviewDependencyVersion:3 as const});
    checkMeta(operation);if(ids.has(operation.id))throw new RangeError("WORKSPACE_OPERATION_INVALID");ids.add(operation.id);
    return operation;
  });
  const serialized = captureWorkspace(value), owned = immutableWorkspaces.has(value)?value:JSON.parse(serialized) as ScoreWorkspace;
  let current=await replay(value,serialized),digest=value.digest;
  const digestState=(immutableWorkspaces.has(value)?cache.get(value)?.digestState:undefined)??createReplayStateDigester(),recorded:WorkspaceOperation[]=[];
  for(const operation of operations) {
    const next=await step(current,operation,true),afterDigest=await digestState(next.state);
    recorded.push({...next.lastOperation!,beforeDigest:digest,afterDigest,affectedIds:changedWorkspaceTargets(current.state,next.state)});
    current=next;digest=afterDigest;
  }
  const changed={...owned,operations:[...owned.operations,...recorded],revision:owned.revision+recorded.length,digest};
  const result={...changed,historyDigest:await historyDigest(changed,current.evidenceDigest)};
  if(captureWorkspace(value)!==serialized)throw new RangeError("WORKSPACE_MUTATED_DURING_EDIT");
  const resultSerialized=JSON.stringify(result);
  if(resultSerialized.length>64_000_000) throw new RangeError("WORKSPACE_LIMIT");
  // The returned immutable workspace is separately parsed. Reducer inputs were
  // captured above, so its private replay and weak encoding segments can remain
  // owned by this lineage. Mutable callers retain the original detached cache.
  if(immutableWorkspaces.has(value))return immutableVerifiedWorkspace({serialized:resultSerialized,value:current,digestState});
  cache.set(result,{serialized:resultSerialized,value:structuredClone(current)});return result;
}
export async function parseScoreWorkspace(text: string): Promise<ScoreWorkspace> {
  if(text.length>64_000_000) throw new RangeError("WORKSPACE_LIMIT");
  const hit = proofReplay;
  if (hit?.text === text) {
    const workspace = JSON.parse(hit.verified.serialized) as ScoreWorkspace;
    cache.set(workspace, hit.verified);
    return workspace;
  }
  const value=JSON.parse(text) as ScoreWorkspace;
  await replay(value);
  rememberVerifiedProof(text,cache.get(value)!);return value;
}
/** Encoding and its origin binding from the same checked snapshot. */
export async function serializeScoreWorkspace(value: ScoreWorkspace): Promise<{encoded:string;evidenceDigest:string}> {
  const serialized = captureWorkspace(value);await replay(value,serialized);
  if(captureWorkspace(value)!==serialized)throw new RangeError("WORKSPACE_MUTATED_DURING_EXPORT");
  const verified=cache.get(value)!;
  const text=verified.encoded??asciiProofJson(value);
  // Raw imported JSON may contain whitespace, Unicode or another key order.
  // Only this encoder establishes a reusable canonical ASCII export.
  const entry=text.length<=MAX_REUSED_PROOF_CHARS?{...verified,encoded:text}:verified;
  cache.set(value,entry);rememberVerifiedProof(text,entry);
  return {encoded:text,evidenceDigest:verified.value.evidenceDigest};
}
export async function exportScoreWorkspace(value: ScoreWorkspace): Promise<string> { return (await serializeScoreWorkspace(value)).encoded; }
