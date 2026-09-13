import "server-only";
import { loadLocalImageConfig, localImageEnabled } from "./config";
import { LocalImageService } from "./service";
import { authorizeLocalImage, localImageSecret, assertLocalImageOrigin } from "./security";
import { LOCAL_IMAGE_MAX_BYTES, LOCAL_IMAGE_MAX_PIXELS } from "../../domain/omr/local-image";
import { withLocalImageMutex } from "./disk-lock.mjs";

const headers={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Cross-Origin-Resource-Policy":"same-origin"};
const globals=globalThis as typeof globalThis & {hmLocalImage?:Promise<{service:LocalImageService;secret:string}>};
async function runtime(){
  globals.hmLocalImage??=(async()=>{const config=await loadLocalImageConfig();return{service:new LocalImageService(config),secret:await withLocalImageMutex(config,()=>localImageSecret(config.root))};})();
  try{return await globals.hmLocalImage;}catch(error){globals.hmLocalImage=undefined;throw error;}
}
async function binary(request:Request):Promise<Uint8Array>{
  const length=request.headers.get("content-length");if(length&&(!/^\d+$/u.test(length)||Number(length)>LOCAL_IMAGE_MAX_BYTES))throw new Error("LOCAL_IMAGE_FILE_LIMIT");
  if(!request.body)throw new Error("LOCAL_IMAGE_FILE_INVALID");const reader=request.body.getReader(),parts:Uint8Array[]=[];let size=0;
  try{for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>LOCAL_IMAGE_MAX_BYTES){await reader.cancel();throw new Error("LOCAL_IMAGE_FILE_LIMIT");}parts.push(chunk.value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let at=0;for(const part of parts){bytes.set(part,at);at+=part.length;}return bytes;
}
function fileName(request:Request):string{try{return decodeURIComponent(request.headers.get("x-hm-file-name")??"");}catch{throw new Error("LOCAL_IMAGE_REQUEST_INVALID");}}
export async function handleLocalImage(request:Request,segments:readonly string[]):Promise<Response>{
  try{
    if(!localImageEnabled())return Response.json({ok:false,error:"LOCAL_IMAGE_DISABLED"},{status:503,headers});
    // Reject hostile requests before reading models, session keys, or image bytes.
    assertLocalImageOrigin(request,process.env.HM_LOCAL_IMAGE_ORIGIN??"");
    const {service,secret}=await runtime(),session=authorizeLocalImage(request,service.config.origin,secret,segments.length===0);
    const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{...headers,...(session.cookie?{"Set-Cookie":session.cookie}:{})}});
    if(segments.length===0&&request.method==="GET")return json({ok:true,csrf:session.csrf,ready:true,maxBytes:LOCAL_IMAGE_MAX_BYTES,maxPixels:LOCAL_IMAGE_MAX_PIXELS,jobs:await service.list(session.owner)});
    if(segments[0]!=="jobs")throw new Error("LOCAL_IMAGE_NOT_FOUND");
    if(segments.length===1&&request.method==="POST")return await service.exclusive(async()=>json({ok:true,job:await service.create(session.owner,{id:request.headers.get("x-hm-operation")??"",fileName:fileName(request),mimeType:request.headers.get("content-type")??"",language:request.headers.get("x-hm-language")??"eng+kor",actor:request.headers.get("x-hm-actor")??"user",rights:request.headers.get("x-hm-rights")==="confirmed"},await binary(request))},202));
    const id=segments[1];if(!id)throw new Error("LOCAL_IMAGE_NOT_FOUND");
    if(segments.length===2&&request.method==="GET")return json({ok:true,job:await service.get(session.owner,id)});
    if(segments.length===3&&segments[2]==="cancel"&&request.method==="POST")return json({ok:true,job:await service.cancel(session.owner,id)});
    if(segments.length===3&&segments[2]==="input"&&request.method==="GET"){const result=await service.input(session.owner,id);return new Response(result.bytes as BodyInit,{headers:{...headers,"Content-Type":result.job.mimeType}});}
    if(segments.length===3&&segments[2]==="result"&&request.method==="GET"){const result=await service.result(session.owner,id);return new Response(result.text,{headers:{...headers,"Content-Type":"application/json; charset=utf-8","X-HM-Result-SHA256":result.job.resultSha256!}});}
    if(segments.length===3&&segments[2]==="retry"&&request.method==="POST")return await service.exclusive(async()=>{
      const old=await service.input(session.owner,id);return json({ok:true,job:await service.create(session.owner,{id:request.headers.get("x-hm-operation")??"",fileName:old.job.fileName,mimeType:old.job.mimeType,language:old.job.language,actor:request.headers.get("x-hm-actor")??"user",rights:request.headers.get("x-hm-rights")==="confirmed"},old.bytes)},202);
    });
    // Raw diagnostics remain private on disk; no arbitrary artifact/path endpoint.
    throw new Error("LOCAL_IMAGE_NOT_FOUND");
  }catch(error){
    const message=error instanceof Error?error.message:"";const code=/^LOCAL_IMAGE_[A-Z_]+$/u.test(message)?message:"LOCAL_IMAGE_UNAVAILABLE";
    const status=/ORIGIN|CSRF/u.test(code)?403:/SESSION/u.test(code)?401:/NOT_FOUND/u.test(code)?404:/BUSY|CONFLICT|NOT_READY/u.test(code)?409:/DISABLED|CONFIG|MODELS|MODEL_|UNAVAILABLE|DISK_LOW/u.test(code)?503:400;
    return Response.json({ok:false,error:code},{status,headers});
  }
}
