"use client";
import { binaryDigest,canonicalJson } from "../../domain/digest/canonical";
import { exportScoreWorkspace, parseScoreWorkspace } from "./journal";
import { workspaceEvidenceDigest } from "./input";
import { exactJson } from "./encoding";
import type { ScoreWorkspace } from "./model";

export interface StoredScoreWorkspace {
  readonly workspace: ScoreWorkspace;
  readonly storageRevision: number;
  readonly updatedAt: string;
  readonly generation?: { readonly projectId: string; readonly workspaceRevision: number; readonly workspaceDigest: string };
}
interface Row {
  readonly id: string; readonly storageRevision: number; readonly updatedAt: string;
  readonly encoded: string; readonly encodedDigest: string; readonly evidenceDigest: string;
  readonly generation?: StoredScoreWorkspace["generation"];
}
const enc=new TextEncoder();
function validGeneration(workspace:ScoreWorkspace,g:StoredScoreWorkspace["generation"]):boolean {
  if(!g)return true;
  if(!Number.isSafeInteger(g.workspaceRevision)||g.workspaceRevision<0||g.workspaceRevision>workspace.revision||g.projectId!==`${workspace.id}:r${g.workspaceRevision}`)return false;
  const digest=g.workspaceRevision===workspace.revision?workspace.digest:g.workspaceRevision===0?workspace.operations[0]?.beforeDigest:workspace.operations[g.workspaceRevision-1]?.afterDigest;
  return g.workspaceDigest===digest;
}
const requestResult=<T>(r:IDBRequest<T>)=>new Promise<T>((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error??new Error("WORKSPACE_STORAGE_FAILED"));});
export class ScoreWorkspaceStore {
  constructor(private readonly factory:IDBFactory|undefined=globalThis.indexedDB) {}
  private async database() {
    if(!this.factory) throw new RangeError("WORKSPACE_STORAGE_UNAVAILABLE");
    const r=this.factory.open("harmonymaker-score-workspaces-v1",1);
    r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains("drafts"))r.result.createObjectStore("drafts",{keyPath:"id"});};
    return requestResult(r);
  }
  async save(value:StoredScoreWorkspace,expectedStorageRevision?:number):Promise<void> {
    if(!Number.isSafeInteger(value.storageRevision)||value.storageRevision<0||!Number.isFinite(Date.parse(value.updatedAt))||!validGeneration(value.workspace,value.generation)) throw new RangeError("WORKSPACE_STORAGE_INVALID");
    const encoded=await exportScoreWorkspace(value.workspace),evidenceDigest=await workspaceEvidenceDigest(value.workspace.origin);
    const row:Row={id:value.workspace.id,storageRevision:value.storageRevision,updatedAt:value.updatedAt,encoded,encodedDigest:await binaryDigest(enc.encode(encoded)),evidenceDigest,...(value.generation?{generation:value.generation}:{})};
    const db=await this.database();
    try {
      await new Promise<void>((resolve,reject)=>{
        const tx=db.transaction("drafts","readwrite"),store=tx.objectStore("drafts"),get=store.get(row.id);
        let failure:Error|undefined;
        get.onsuccess=()=>{
          const old=get.result as Row|undefined;
          if(old ? expectedStorageRevision!==old.storageRevision||row.storageRevision!==old.storageRevision+1||old.evidenceDigest!==evidenceDigest
            :expectedStorageRevision!==undefined||row.storageRevision!==0) {
            failure=new RangeError("WORKSPACE_CONCURRENT_EDIT_RELOAD_REQUIRED");tx.abort();return;
          }
          if(old){
            try {const previous=JSON.parse(old.encoded) as ScoreWorkspace;
              if(previous.revision>value.workspace.revision||canonicalJson(previous.algorithmVersions)!==canonicalJson(value.workspace.algorithmVersions)
                ||exactJson(previous.operations)!==exactJson(value.workspace.operations.slice(0,previous.revision)))throw Error("history");
            }catch{failure=new RangeError("WORKSPACE_HISTORY_ROLLBACK_REJECTED");tx.abort();return;}
          }
          try {store.put(row);}catch(err){failure=err instanceof Error?err:new Error("WORKSPACE_SAVE_FAILED");tx.abort();}
        };
        tx.oncomplete=()=>resolve();
        tx.onabort=()=>reject(failure??tx.error??new Error("WORKSPACE_SAVE_ABORTED"));
        tx.onerror=()=>reject(failure??tx.error??new Error("WORKSPACE_SAVE_FAILED"));
      });
    } finally {db.close();}
  }
  async load(id:string):Promise<StoredScoreWorkspace|undefined> {
    const db=await this.database();
    try {
      const row=await requestResult(db.transaction("drafts").objectStore("drafts").get(id)) as Row|undefined;
      if(!row)return undefined;
      if(await binaryDigest(enc.encode(row.encoded))!==row.encodedDigest)throw new RangeError("WORKSPACE_STORAGE_CORRUPT");
      const workspace=await parseScoreWorkspace(row.encoded);
      if(workspace.id!==id||await workspaceEvidenceDigest(workspace.origin)!==row.evidenceDigest||!Number.isSafeInteger(row.storageRevision)||row.storageRevision<0||!validGeneration(workspace,row.generation))throw new RangeError("WORKSPACE_STORAGE_CORRUPT");
      return {workspace,storageRevision:row.storageRevision,updatedAt:row.updatedAt,...(row.generation?{generation:row.generation}:{})};
    } finally {db.close();}
  }
  async list():Promise<readonly {id:string;updatedAt:string}[]> {
    const db=await this.database();
    try {const rows=await requestResult(db.transaction("drafts").objectStore("drafts").getAll()) as Row[];
      return rows.map(r=>({id:r.id,updatedAt:r.updatedAt})).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
    } finally {db.close();}
  }
}
export function generatedWorkspaceResultIsCurrent(value:StoredScoreWorkspace):boolean {
  return !!value.generation&&value.generation.workspaceRevision===value.workspace.revision&&value.generation.workspaceDigest===value.workspace.digest;
}
