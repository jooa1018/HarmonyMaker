import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, unlink, readdir, lstat, stat, realpath, statfs } from "node:fs/promises";
import { openSync, closeSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import sharp from "sharp";
import { LOCAL_IMAGE_MAX_BYTES, LOCAL_IMAGE_MAX_PIXELS, LOCAL_IMAGE_PIPELINE_VERSION, localImageRunning, validLocalImageId, validateLocalImageResult, type LocalImageJob, type LocalImagePhase } from "../../domain/omr/local-image";
import type { LocalImageConfig } from "./config";
import { withLocalImageMutex } from "./disk-lock.mjs";

interface RequestRecord extends Omit<LocalImageJob,"phase"|"updatedAt"|"sequence"> {
  readonly owner: string; readonly nonce: string; readonly config: LocalImageConfig; readonly rightsConfirmed: true;
}
interface State {phase: LocalImagePhase;updatedAt:string;sequence:number;nonce:string;errorCode?:string;resultSha256?:string;workerPid?:number;observerPid?:number}
interface Lease {jobId:string;nonce:string;createdAt:string}
const hash = (bytes: Uint8Array|string) => createHash("sha256").update(bytes).digest("hex");
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";
async function readJson<T>(file:string,limit=96_000):Promise<T>{if((await stat(file)).size>limit)throw new Error("LOCAL_IMAGE_RECORD_INVALID");return JSON.parse(await readFile(file,"utf8")) as T;}
async function atomic(file:string,value:unknown):Promise<void>{const temporary=`${file}.${randomUUID()}.tmp`;await writeFile(temporary,JSON.stringify(value),{flag:"wx",mode:0o600});await rename(temporary,file);}
function alive(pid:number|undefined):boolean {if(!pid)return false;try{process.kill(pid,0);return true;}catch(error){return (error as NodeJS.ErrnoException).code!=="ESRCH";}}

export class LocalImageService {
  private chain: Promise<unknown> = Promise.resolve();
  constructor(readonly config:LocalImageConfig, private readonly launch: (record:RequestRecord,directory:string)=>Promise<void> = async (record,directory) => {
    const stdout=openSync(path.join(directory,"worker.stdout.log"),"wx"),stderr=openSync(path.join(directory,"worker.stderr.log"),"wx");
    try {const child=spawn(config.node,[config.worker,config.root,record.id,record.nonce],{cwd:config.repository,detached:true,windowsHide:true,stdio:["ignore",stdout,stderr]});
      await new Promise<void>((resolve,reject)=>{child.once("spawn",resolve);child.once("error",reject);});child.unref();
    }finally{closeSync(stdout);closeSync(stderr);}
  }) {}
  exclusive<T>(fn:()=>Promise<T>):Promise<T>{const next=this.chain.then(fn,fn);this.chain=next.catch(()=>undefined);return next;}
  private async directory(id:string):Promise<string>{
    if(!validLocalImageId(id))throw new Error("LOCAL_IMAGE_NOT_FOUND");const directory=path.join(this.config.root,"jobs",id);
    const info=await lstat(directory);if(info.isSymbolicLink()||!info.isDirectory()||await realpath(directory)!==path.resolve(directory))throw new Error("LOCAL_IMAGE_PATH_REJECTED");return directory;
  }
  private async request(owner:string,id:string):Promise<{record:RequestRecord;directory:string}>{
    try{const directory=await this.directory(id),record=await readJson<RequestRecord>(path.join(directory,"request.json"));
      if(record.owner!==owner||record.id!==id)throw new Error("LOCAL_IMAGE_NOT_FOUND");return{record,directory};
    }catch(error){if(missing(error))throw new Error("LOCAL_IMAGE_NOT_FOUND");throw error;}
  }
  private public(record:RequestRecord,state:State):LocalImageJob {
    if(state.nonce!==record.nonce||!Number.isSafeInteger(state.sequence)||!Number.isFinite(Date.parse(state.updatedAt)))throw new Error("LOCAL_IMAGE_STATE_INVALID");
    const {id,fileName,mimeType,bytes,width,height,language,createdAt,execution}=record;
    return{id,fileName,mimeType,bytes,width,height,language,createdAt,execution,phase:state.phase,updatedAt:state.updatedAt,sequence:state.sequence,...(state.errorCode?{errorCode:state.errorCode}:{}),...(state.resultSha256?{resultSha256:state.resultSha256}:{})};
  }
  async get(owner:string,id:string):Promise<LocalImageJob>{
    return withLocalImageMutex(this.config,()=>this.getLocked(owner,id));
  }
  private async getLocked(owner:string,id:string):Promise<LocalImageJob>{
    const {record,directory}=await this.request(owner,id);let state=await readJson<State>(path.join(directory,"state.json"));
    // A detached worker survives an application-server restart. A timeout alone
    // is never permission to start a second recognition beside a living worker.
    if(localImageRunning(state.phase)&&Date.now()-Date.parse(state.updatedAt)>15_000&&!alive(state.workerPid)&&!alive(state.observerPid)){
      state={...state,phase:"interrupted",errorCode:"LOCAL_IMAGE_WORKER_INTERRUPTED",updatedAt:new Date().toISOString(),sequence:state.sequence+1};
      await atomic(path.join(directory,"state.json"),state);
      await this.release(record);
    }
    if(state.phase==="candidate-ready"){
      try{await this.readResult(this.public(record,state),directory);}
      catch{state={...state,phase:"failed",errorCode:"LOCAL_IMAGE_RESULT_MISMATCH",updatedAt:new Date().toISOString(),sequence:state.sequence+1};await atomic(path.join(directory,"state.json"),state);}
    }
    if(!localImageRunning(state.phase))await this.release(record);
    return this.public(record,state);
  }
  async list(owner:string):Promise<LocalImageJob[]>{
    await mkdir(path.join(this.config.root,"jobs"),{recursive:true});const result:LocalImageJob[]=[];
    for(const entry of await readdir(path.join(this.config.root,"jobs"),{withFileTypes:true})){if(!entry.isDirectory()||!validLocalImageId(entry.name))continue;
      try{result.push(await this.get(owner,entry.name));}catch(error){if((error as Error).message!=="LOCAL_IMAGE_NOT_FOUND")throw error;}}
    return result.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  }
  private async release(record:RequestRecord):Promise<void>{const file=path.join(this.config.root,"active.json");try{const lease=await readJson<Lease>(file);if(lease.jobId===record.id&&lease.nonce===record.nonce)await unlink(file);}catch(error){if(!missing(error))throw error;}}
  async create(owner:string,options:{id:string;fileName:string;mimeType:string;language:string;actor:string;rights:boolean},bytes:Uint8Array):Promise<LocalImageJob>{
    return withLocalImageMutex(this.config,()=>this.createLocked(owner,options,bytes));
  }
  private async createLocked(owner:string,options:{id:string;fileName:string;mimeType:string;language:string;actor:string;rights:boolean},bytes:Uint8Array):Promise<LocalImageJob>{
    if(!validLocalImageId(options.id)||!options.rights||!["eng","eng+kor"].includes(options.language)||!["user","ui-test"].includes(options.actor))throw new Error("LOCAL_IMAGE_REQUEST_INVALID");
    if(!["image/png","image/jpeg"].includes(options.mimeType)||!bytes.length||bytes.length>LOCAL_IMAGE_MAX_BYTES)throw new Error("LOCAL_IMAGE_FILE_INVALID");
    const fileName=options.fileName.split(/[\\/]/u).at(-1)?.trim()??"";
    if(!fileName||fileName.length>240||/[\u0000-\u001f]/u.test(fileName)||! /\.(png|jpe?g)$/iu.test(fileName))throw new Error("LOCAL_IMAGE_FILE_INVALID");
    const inputSha256=hash(bytes),requestSha256=hash(JSON.stringify({inputSha256,fileName,mimeType:options.mimeType,language:options.language,actor:options.actor,rights:true,pipeline:LOCAL_IMAGE_PIPELINE_VERSION,timeline:"hm-automatic-timeline-v1.1"}));
    try {const {record}=await this.request(owner,options.id);if(record.execution.requestSha256!==requestSha256)throw new Error("LOCAL_IMAGE_IDEMPOTENCY_CONFLICT");return this.getLocked(owner,options.id);}
    catch(error){if((error as Error).message!=="LOCAL_IMAGE_NOT_FOUND")throw error;}
    const disk=await statfs(this.config.root);if(disk.bavail*disk.bsize<512*1024*1024)throw new Error("LOCAL_IMAGE_DISK_LOW");
    let decoder:ReturnType<typeof sharp>,metadata:Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
    try{decoder=sharp(bytes,{limitInputPixels:LOCAL_IMAGE_MAX_PIXELS,failOn:"warning",sequentialRead:true});metadata=await decoder.metadata();}
    catch{throw new Error("LOCAL_IMAGE_DECODE_INVALID");}
    if(metadata.format!==(options.mimeType==="image/png"?"png":"jpeg")||!metadata.width||!metadata.height||metadata.width*metadata.height>LOCAL_IMAGE_MAX_PIXELS||(metadata.pages??1)!==1)throw new Error("LOCAL_IMAGE_DECODE_INVALID");
    if(metadata.orientation&&metadata.orientation!==1)throw new Error("LOCAL_IMAGE_ORIENTATION_UNSUPPORTED");
    try{await decoder.stats();}catch{throw new Error("LOCAL_IMAGE_DECODE_INVALID");} // Preserve the exact uploaded bytes.
    // Reconcile a terminal or dead worker's lease under the same cross-process
    // mutex used by the worker. A delayed old worker cannot claim a new lease.
    try{const lease=await readJson<Lease>(path.join(this.config.root,"active.json"));
      const active=await readJson<RequestRecord>(path.join(await this.directory(lease.jobId),"request.json"));
      await this.getLocked(active.owner,active.id);
      try{await stat(path.join(this.config.root,"active.json"));throw new Error("LOCAL_IMAGE_BUSY");}catch(error){if(!missing(error))throw error;}
    }catch(error){if(!missing(error))throw error;}
    const createdAt=new Date().toISOString(),nonce=randomUUID(),lease:Lease={jobId:options.id,nonce,createdAt};
    const record:RequestRecord={id:options.id,owner,nonce,fileName,mimeType:options.mimeType as RequestRecord["mimeType"],bytes:bytes.length,width:metadata.width,height:metadata.height,language:options.language as RequestRecord["language"],createdAt,rightsConfirmed:true,config:this.config,
      execution:{schema:LOCAL_IMAGE_PIPELINE_VERSION,jobId:options.id,inputSha256,requestSha256,applicationRevision:this.config.applicationRevision,runnerSha256:this.config.runnerSha256,modelsSha256:this.config.modelsSha256,homrRevision:"457e7c6518a10ba755db2e60883419e56c4d7369",cacheReused:false,actor:options.actor as "user"|"ui-test"}};
    const directory=path.join(this.config.root,"jobs",record.id);
    let admitted=false;
    try {
      await mkdir(path.join(this.config.root,"jobs"),{recursive:true});await mkdir(directory);admitted=true;
      await writeFile(path.join(directory,record.mimeType==="image/png"?"input.png":"input.jpeg"),bytes,{flag:"wx",mode:0o600});
      await writeFile(path.join(directory,"request.json"),JSON.stringify(record),{flag:"wx",mode:0o600});
      await atomic(path.join(directory,"state.json"),{phase:"queued",sequence:0,updatedAt:createdAt,nonce});
      // A lease is never published without its immutable input/request/state.
      await writeFile(path.join(this.config.root,"active.json"),JSON.stringify(lease),{flag:"wx",mode:0o600});
      await this.launch(record,directory);
    } catch(error) {
      if(admitted)await atomic(path.join(directory,"state.json"),{phase:"failed",sequence:1,updatedAt:new Date().toISOString(),nonce,errorCode:"LOCAL_IMAGE_START_FAILED"});
      await this.release(record);throw error;
    }
    return this.getLocked(owner,record.id);
  }
  async cancel(owner:string,id:string):Promise<LocalImageJob>{
    return withLocalImageMutex(this.config,async()=>{
    const {directory}=await this.request(owner,id),job=await this.getLocked(owner,id);
    if(localImageRunning(job.phase)){try{await writeFile(path.join(directory,"cancel.json"),JSON.stringify({requestedAt:new Date().toISOString()}),{flag:"wx"});}catch(error){if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;}}
    return this.getLocked(owner,id);});
  }
  async input(owner:string,id:string):Promise<{job:LocalImageJob;bytes:Uint8Array}>{const {record,directory}=await this.request(owner,id);const bytes=await readFile(path.join(directory,record.mimeType==="image/png"?"input.png":"input.jpeg"));if(hash(bytes)!==record.execution.inputSha256)throw new Error("LOCAL_IMAGE_INPUT_MISMATCH");return{job:await this.get(owner,id),bytes};}
  async result(owner:string,id:string):Promise<{job:LocalImageJob;text:string}>{const {directory}=await this.request(owner,id),job=await this.get(owner,id);
    if(job.phase!=="candidate-ready")throw new Error("LOCAL_IMAGE_RESULT_NOT_READY");return{job,text:await this.readResult(job,directory)};
  }
  private async readResult(job:LocalImageJob,directory:string):Promise<string>{
    const file=path.join(directory,"candidate.review.json");if((await stat(file)).size>64_000_000)throw new Error("LOCAL_IMAGE_RESULT_LIMIT");
    const text=await readFile(file,"utf8");await validateLocalImageResult(job,text);return text;
  }
}
