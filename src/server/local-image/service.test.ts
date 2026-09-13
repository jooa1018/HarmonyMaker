import { beforeEach,afterEach,describe,it,expect,vi } from "vitest";
import { mkdtemp,readFile,writeFile,stat,rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { LocalImageService } from "./service";
import type { LocalImageConfig } from "./config";
// Isolated service contracts use a serial mutex substitute. Actual Windows
// kernel/process behavior is covered separately by the opt-in runtime test.
vi.mock("./disk-lock.mjs",()=>{let tail=Promise.resolve();return {withLocalImageMutex:(_config:unknown,action:()=>Promise<unknown>)=>{const next=tail.then(action,action);tail=next.then(()=>undefined,()=>undefined);return next;}};});
let root:string,config:LocalImageConfig,image:Uint8Array;
beforeEach(async()=>{
  root=await mkdtemp(path.join(os.tmpdir(),"hm-local-image-test-"));
  config={root,compare:root,repository:root,origin:"http://127.0.0.1:3197",python:"unused",node:process.execPath,worker:"unused",applicationRevision:"a".repeat(40),runnerSha256:"b".repeat(64),modelsSha256:"c".repeat(64),models:[],runnerFiles:[]};
  image=await sharp({create:{width:16,height:12,channels:3,background:"white"}}).png().toBuffer();
});
afterEach(async()=>{if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith("hm-local-image-test-"))throw Error("unsafe test cleanup");await rm(root,{recursive:true});});
const options=(id=randomUUID())=>({id,fileName:"score.png",mimeType:"image/png",language:"eng+kor",actor:"ui-test",rights:true});
const statePath=(id:string)=>path.join(root,"jobs",id,"state.json");
async function change(id:string,change:object){const file=statePath(id);await writeFile(file,JSON.stringify({...JSON.parse(await readFile(file,"utf8")),...change}));}
describe("isolated local image lifecycle (mock launcher)",()=>{
  it("preserves exact input and deduplicates same operation across service instances",async()=>{
    const launch=vi.fn(async()=>undefined),a=new LocalImageService(config,launch),b=new LocalImageService(config,launch),o=options();
    const [one,two]=await Promise.all([a.create("owner",o,image),b.create("owner",o,image)]);
    expect(one.id).toBe(two.id);expect(launch).toHaveBeenCalledTimes(1);expect((await a.input("owner",o.id)).bytes).toEqual(image);
    await expect(b.create("owner",{...o,language:"eng"},image)).rejects.toThrow("LOCAL_IMAGE_IDEMPOTENCY_CONFLICT");
  });
  it("admits one heavy job globally and rejects another owner without revealing the first",async()=>{
    const launch=vi.fn(async()=>undefined),service=new LocalImageService(config,launch),o=options();await service.create("A",o,image);
    await expect(service.create("B",options(),image)).rejects.toThrow("LOCAL_IMAGE_BUSY");
    for(const action of [()=>service.get("B",o.id),()=>service.input("B",o.id),()=>service.result("B",o.id),()=>service.cancel("B",o.id)])await expect(action()).rejects.toThrow("LOCAL_IMAGE_NOT_FOUND");
    expect(await service.list("B")).toEqual([]);await expect(stat(path.join(root,"jobs",o.id,"cancel.json"))).rejects.toMatchObject({code:"ENOENT"});expect(launch).toHaveBeenCalledTimes(1);
  });
  it("does not release a live worker based on an old heartbeat",async()=>{
    const service=new LocalImageService(config,async()=>undefined),o=options();await service.create("A",o,image);
    await change(o.id,{phase:"recognizing",workerPid:process.pid,updatedAt:"2000-01-01T00:00:00Z"});
    expect((await service.get("A",o.id)).phase).toBe("recognizing");await expect(service.create("A",options(),image)).rejects.toThrow("LOCAL_IMAGE_BUSY");
  });
  it("recovers a dead or never-claimed lease without restarting its recognition",async()=>{
    const launch=vi.fn(async()=>undefined),service=new LocalImageService(config,launch),o=options();await service.create("A",o,image);
    await change(o.id,{updatedAt:"2000-01-01T00:00:00Z"});
    const next=await service.create("A",options(),image);
    expect((await service.get("A",o.id)).phase).toBe("interrupted");expect(next.id).not.toBe(o.id);expect(launch).toHaveBeenCalledTimes(2);expect((await service.input("A",o.id)).bytes).toEqual(image);
  });
  it("reclaims a terminal worker lease left before final cleanup and scopes cancellation",async()=>{
    const service=new LocalImageService(config,async()=>undefined),o=options();await service.create("A",o,image);
    await service.cancel("A",o.id);expect(JSON.parse(await readFile(path.join(root,"jobs",o.id,"cancel.json"),"utf8")).requestedAt).toBeTruthy();
    await change(o.id,{phase:"cancelled"});const next=await service.create("A",options(),image);expect(next.phase).toBe("queued");
    await service.cancel("A",o.id);expect(JSON.parse(await readFile(path.join(root,"active.json"),"utf8")).jobId).toBe(next.id);
  });
  it("reports corrupt ready results as failed while preserving input and permitting explicit retry",async()=>{
    const service=new LocalImageService(config,async()=>undefined),o=options();await service.create("A",o,image);
    await writeFile(path.join(root,"jobs",o.id,"candidate.review.json"),"{}");await change(o.id,{phase:"candidate-ready",resultSha256:"d".repeat(64)});
    expect((await service.get("A",o.id)).errorCode).toBe("LOCAL_IMAGE_RESULT_MISMATCH");await expect(service.result("A",o.id)).rejects.toThrow("LOCAL_IMAGE_RESULT_NOT_READY");
    expect((await service.input("A",o.id)).bytes).toEqual(image);expect((await service.create("A",options(),image)).phase).toBe("queued");
  });
  it("preserves failed-start input and releases only its own admission",async()=>{
    const service=new LocalImageService(config,async()=>{throw Error("fixture spawn failure");}),o=options();
    await expect(service.create("A",o,image)).rejects.toThrow("fixture spawn failure");
    expect((await service.get("A",o.id)).phase).toBe("failed");expect((await service.input("A",o.id)).bytes).toEqual(image);await expect(stat(path.join(root,"active.json"))).rejects.toMatchObject({code:"ENOENT"});
  });
  it("rejects invalid images/metadata/rights before process creation",async()=>{
    const launch=vi.fn(async()=>undefined),service=new LocalImageService(config,launch);
    for(const [patch,bytes] of [[{rights:false},image],[{id:"../outside"},image],[{fileName:"bad.pdf"},image],[{mimeType:"image/jpeg"},image],[{},new TextEncoder().encode("not an image")],[{},new Uint8Array(12*1024*1024+1)]] as const)await expect(service.create("A",{...options(),...patch},bytes)).rejects.toThrow();
    expect(launch).not.toHaveBeenCalled();
    await expect(service.create("A",options(),new TextEncoder().encode("not an image"))).rejects.toThrow("LOCAL_IMAGE_DECODE_INVALID");
  });
});
