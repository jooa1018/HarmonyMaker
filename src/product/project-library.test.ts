import { describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { IndexedDbProjectStore, LOCAL_PROJECT_DATABASE_VERSION } from "./local-project-store";

describe("project library metadata on the existing database",()=>{
  it("keeps deterministic metadata order and original payloads, including unreadable recoverable files",async()=>{
    const factory=new IDBFactory(),store=new IndexedDbProjectStore(factory);
    expect(await store.list()).toEqual([]);
    const database=await new Promise<IDBDatabase>((resolve,reject)=>{
      const request=factory.open("harmonymaker-v0",LOCAL_PROJECT_DATABASE_VERSION);
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });
    const records=[
      {projectId:"older",updatedAt:"2026-01-01T00:00:00Z",encoded:"unreadable original "+"x".repeat(100_000)},
      {projectId:"z",updatedAt:"2026-02-01T00:00:00Z",encoded:"second preserved file"},
      {projectId:"a",updatedAt:"2026-02-01T00:00:00Z",encoded:"third preserved file"},
    ];
    const write=database.transaction("projects","readwrite");
    for(const record of records)write.objectStore("projects").add(record);
    await new Promise<void>((resolve,reject)=>{write.oncomplete=()=>resolve();write.onabort=()=>reject(write.error);});
    expect(await store.list()).toEqual([records[2],records[1],records[0]].map(({projectId,updatedAt})=>({projectId,updatedAt})));
    await expect(store.load("older")).rejects.toThrow("PROJECT_FILE_MALFORMED");
    const read=database.transaction("projects","readonly").objectStore("projects").getAll();
    const remaining=await new Promise<unknown[]>((resolve,reject)=>{read.onsuccess=()=>resolve(read.result);read.onerror=()=>reject(read.error);});
    expect(remaining).toEqual([records[2],records[0],records[1]]);
    database.close();
  });
});
