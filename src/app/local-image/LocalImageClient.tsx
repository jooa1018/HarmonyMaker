"use client";
import Link from "next/link";
import Image from "next/image";
import { useRouter,useSearchParams } from "next/navigation";
import { useCallback,useEffect,useRef,useState } from "react";
import { LOCAL_IMAGE_MAX_BYTES,LOCAL_IMAGE_MAX_PIXELS,LOCAL_IMAGE_PHASE_LABELS,localImageRunning,validLocalImageId,type LocalImageJob } from "../../domain/omr/local-image";
import { acceptLocalImageWorkspace } from "../../import/workspace/local-image-handoff";
import { APPLICATION_ALGORITHM_VERSION_REGISTRY as V } from "../algorithm-version-registry";
import styles from "./local-image.module.css";

const PENDING="hm-local-image-pending-v1";
// Only an explicit pre-admission rejection proves a new operation may be used.
const rejectedBeforeAdmission=new Set(["LOCAL_IMAGE_DISABLED","LOCAL_IMAGE_ORIGIN_REJECTED","LOCAL_IMAGE_CSRF_REJECTED","LOCAL_IMAGE_SESSION_INVALID","LOCAL_IMAGE_REQUEST_INVALID","LOCAL_IMAGE_FILE_INVALID","LOCAL_IMAGE_FILE_LIMIT","LOCAL_IMAGE_DECODE_INVALID","LOCAL_IMAGE_ORIENTATION_UNSUPPORTED","LOCAL_IMAGE_DISK_LOW","LOCAL_IMAGE_BUSY"]);
const explains:Record<string,string>={
  LOCAL_IMAGE_DISABLED:"로컬 인식 모드가 꺼져 있습니다. 로컬 이미지 실행 안내의 서버 명령으로 시작하세요.",
  LOCAL_IMAGE_UNAVAILABLE:"로컬 인식 환경을 준비하지 못했습니다. 기존 homr·모델·OCR 파일과 실행 서버 상태를 확인하세요.",
  LOCAL_IMAGE_BUSY:"다른 이미지 작업이 실행 중입니다. 기존 작업을 확인하거나 취소한 뒤 시작하세요.",
  LOCAL_IMAGE_DISK_LOW:"로컬 디스크 여유가 부족해 새 인식을 시작하지 않았습니다.",
  LOCAL_IMAGE_DECODE_INVALID:"이미지를 읽을 수 없습니다. 손상되지 않은 단일 PNG/JPEG인지 확인하세요. 인식을 시작하지 않았습니다.",
  LOCAL_IMAGE_IDEMPOTENCY_CONFLICT:"이 작업 ID에 저장된 입력과 다릅니다. 응답이 끊긴 요청은 같은 원본·설정으로만 다시 보낼 수 있습니다.",
  LOCAL_IMAGE_ORIENTATION_UNSUPPORTED:"자동 회전(EXIF) 정보가 있는 사진은 이 로컬 경로에서 아직 지원하지 않습니다. 원본은 변경하지 않았습니다.",
  LOCAL_IMAGE_RESOURCE_STOPPED:"시간 또는 메모리 제한으로 실행을 중단했습니다. 원본과 부분 출력은 남아 있습니다.",
  LOCAL_IMAGE_PROCESS_FAILED:"인식 또는 보완 프로세스가 실패했습니다. 원본과 생성된 원시 자료는 보존했습니다.",
  LOCAL_IMAGE_PREPARATION_FAILED:"로컬 프로세스 보호·실행 준비에 실패했습니다. 다른 프로세스를 종료하지 않았습니다.",
  LOCAL_IMAGE_WORKER_INTERRUPTED:"실행 프로세스의 중단을 확인했습니다. 자동 재인식하지 않습니다.",
  LOCAL_IMAGE_NOT_FOUND:"이 브라우저 세션에서 해당 인식 작업을 찾을 수 없습니다. 저장한 초안·프로젝트는 별도로 열 수 있습니다.",
};
const describe=(error:unknown)=>{const code=error instanceof Error?error.message:String(error);return `${explains[code]??"입력·실행·저장 검증을 완료하지 못했습니다. 성공으로 처리하지 않았습니다."} (${code})`;};
const baseHeaders={"X-HM-Local-Image":"1"};
async function jsonResponse(response:Response){const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error??`HTTP_${response.status}`);return data;}
export function LocalImageClient(){
  const router=useRouter(),search=useSearchParams(),initialJob=useRef(search.get("job"));
  const [ready,setReady]=useState(false),[csrf,setCsrf]=useState(""),[jobs,setJobs]=useState<LocalImageJob[]>([]),[job,setJob]=useState<LocalImageJob>();
  const [file,setFile]=useState<File>(),[preview,setPreview]=useState(""),[dimensions,setDimensions]=useState<{width:number;height:number}>(),[language,setLanguage]=useState("eng+kor"),[rights,setRights]=useState(false);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState("실행 환경과 저장한 인식 작업을 확인하는 중…"),[now,setNow]=useState(0);
  const [unresolved,setUnresolved]=useState<string>();
  const lock=useRef(false),selected=useRef<string|undefined>(undefined),connecting=useRef<string|undefined>(undefined),fileSequence=useRef(0),objectUrl=useRef(""),autoOpen=useRef(false),pendingRequest=useRef<{id:string;inputSha256:string;fileName:string;mimeType:string;language:string;actor:string;retryId?:string}|undefined>(undefined);
  const clearFile=useCallback(()=>{fileSequence.current++;if(objectUrl.current)URL.revokeObjectURL(objectUrl.current);objectUrl.current="";setFile(undefined);setPreview("");setDimensions(undefined);setRights(false);},[]);
  const chooseJob=useCallback((value:LocalImageJob,automatic=false)=>{clearFile();selected.current=value.id;autoOpen.current=automatic;setJob(value);setUnresolved(undefined);pendingRequest.current=undefined;localStorage.removeItem(PENDING);router.replace(`/local-image?job=${value.id}`);},[clearFile,router]);
  useEffect(()=>()=>{if(objectUrl.current)URL.revokeObjectURL(objectUrl.current);},[]);
  const openCandidate=useCallback(async(value:LocalImageJob)=>{
    if(connecting.current===value.id)return;connecting.current=value.id;setBusy(true);setMessage("원본·후보·근거를 검증하고 브라우저 초안에 저장하는 중…");
    try{const response=await fetch(`/api/local-image/jobs/${value.id}/result`,{headers:baseHeaders,cache:"no-store"});if(!response.ok){await jsonResponse(response);return;}
      const record=await acceptLocalImageWorkspace(value,await response.text(),V);
      if(selected.current===value.id){setMessage("원본·후보·근거 저장 완료. 교정 작업 공간을 엽니다.");router.push(`/score-workspace?id=${encodeURIComponent(record.workspace.id)}`);}
    }catch(error){setMessage(describe(error));}finally{connecting.current=undefined;setBusy(false);}
  },[router]);
  useEffect(()=>{let active=true;const generation=fileSequence.current;void(async()=>{try{
    const result=await jsonResponse(await fetch("/api/local-image",{headers:baseHeaders,cache:"no-store"}));if(!active)return;
    setReady(true);setCsrf(result.csrf);setJobs(result.jobs);if(generation!==fileSequence.current)return;setMessage("단일 PNG/JPEG를 선택하세요.");
    try{pendingRequest.current=JSON.parse(localStorage.getItem(PENDING)??"null")??undefined;}catch{}
    const pending=pendingRequest.current?.id??initialJob.current;if(pending&&validLocalImageId(pending)){const found=(result.jobs as LocalImageJob[]).find(j=>j.id===pending);if(found){const resumePending=!!pendingRequest.current;chooseJob(found,localImageRunning(found.phase));if(resumePending&&found.phase==="candidate-ready")await openCandidate(found);}else if(pendingRequest.current){selected.current=pending;setUnresolved(pending);setLanguage(pendingRequest.current.language);setMessage("이전 요청을 확인 중입니다. 같은 파일을 선택하면 동일 작업 ID로 다시 보낼 수 있습니다.");}}
  }catch(error){if(active)setMessage(describe(error));}})();return()=>{active=false;};},[chooseJob,openCandidate]);
  const pollId=unresolved??job?.id,pollRunning=!!unresolved||!!job&&localImageRunning(job.phase);
  useEffect(()=>{if(!pollId||!pollRunning)return;let stopped=false,inFlight=false;
    const timer=setInterval(()=>{setNow(Date.now());if(inFlight)return;inFlight=true;void(async()=>{try{const result=await jsonResponse(await fetch(`/api/local-image/jobs/${pollId}`,{headers:baseHeaders,cache:"no-store"}));if(stopped||selected.current!==pollId)return;
      if(pendingRequest.current)chooseJob(result.job,true);else setJob(result.job);
      setJobs(current=>[result.job,...current.filter(j=>j.id!==result.job.id)]);
      if(result.job.phase==="candidate-ready"&&autoOpen.current){autoOpen.current=false;await openCandidate(result.job);}
    }catch(error){if(!stopped&&(error as Error).message!=="LOCAL_IMAGE_NOT_FOUND")setMessage(describe(error));}finally{inFlight=false;}})();},1000);
    return()=>{stopped=true;clearInterval(timer);};},[pollId,pollRunning,chooseJob,openCandidate]);
  const digest=async(next:File)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",await next.arrayBuffer())),b=>b.toString(16).padStart(2,"0")).join("");
  const selectFile=async(next:File|undefined)=>{
    if(!next)return;clearFile();const sequence=fileSequence.current;if(!unresolved){setJob(undefined);selected.current=undefined;autoOpen.current=false;localStorage.removeItem(PENDING);router.replace("/local-image");}
    try{if(!/\.(png|jpe?g)$/iu.test(next.name)||!["image/png","image/jpeg"].includes(next.type)||next.size>LOCAL_IMAGE_MAX_BYTES||next.size===0)throw Error("LOCAL_IMAGE_FILE_INVALID");
      if(pendingRequest.current&&(next.name!==pendingRequest.current.fileName||next.type!==pendingRequest.current.mimeType||await digest(next)!==pendingRequest.current.inputSha256))throw Error("LOCAL_IMAGE_IDEMPOTENCY_CONFLICT");
      const bitmap=await createImageBitmap(next);const size={width:bitmap.width,height:bitmap.height};bitmap.close();
      if(size.width*size.height>LOCAL_IMAGE_MAX_PIXELS)throw Error("LOCAL_IMAGE_FILE_LIMIT");
      if(sequence===fileSequence.current){objectUrl.current=URL.createObjectURL(next);setPreview(objectUrl.current);setFile(next);setDimensions(size);setMessage("원본 미리보기를 확인하고 로컬 인식 사용 권리를 확인하세요.");}
    }catch(error){if(sequence===fileSequence.current)setMessage(describe(error));}
  };
  const start=async(retry?:LocalImageJob)=>{
    if(lock.current||!rights||(!file&&!retry))return;lock.current=true;setBusy(true);let operation=pendingRequest.current;
    setMessage("입력을 저장하고 로컬 실행을 준비하는 중…");
    try{operation??={id:crypto.randomUUID(),inputSha256:retry?.execution.inputSha256??await digest(file!),fileName:retry?.fileName??file!.name,mimeType:retry?.mimeType??file!.type,language:retry?.language??language,actor:navigator.webdriver?"ui-test":"user",...(retry?{retryId:retry.id}:{})};pendingRequest.current=operation;selected.current=operation.id;autoOpen.current=true;localStorage.setItem(PENDING,JSON.stringify(operation));setUnresolved(operation.id);router.replace(`/local-image?job=${operation.id}`);
      const headers={...baseHeaders,"X-HM-CSRF":csrf,"X-HM-Operation":operation.id,"X-HM-Rights":"confirmed","X-HM-Actor":operation.actor};
      const response=await fetch(operation.retryId?`/api/local-image/jobs/${operation.retryId}/retry`:"/api/local-image/jobs",{method:"POST",headers:operation.retryId?headers:{...headers,"Content-Type":operation.mimeType,"X-HM-File-Name":encodeURIComponent(operation.fileName),"X-HM-Language":operation.language},...(operation.retryId?{}:{body:file})});
      const result=await jsonResponse(response);chooseJob(result.job,true);setJobs(current=>[result.job,...current.filter(j=>j.id!==result.job.id)]);setMessage("로컬 작업이 접수됐습니다. 새로고침해도 같은 작업을 조회합니다.");if(result.job.phase==="candidate-ready")await openCandidate(result.job);
    }catch(error){
      // Lost create response: look up the same operation, never silently rerun.
      if(!operation){setMessage(describe(error));return;}
      try{const recovered=await jsonResponse(await fetch(`/api/local-image/jobs/${operation.id}`,{headers:baseHeaders,cache:"no-store"}));chooseJob(recovered.job,true);setMessage("응답이 끊겼지만 같은 인식 작업을 복구했습니다.");if(recovered.job.phase==="candidate-ready")await openCandidate(recovered.job);}
      catch{if(rejectedBeforeAdmission.has((error as Error).message)){pendingRequest.current=undefined;setUnresolved(undefined);localStorage.removeItem(PENDING);setMessage(describe(error));}else setMessage("응답을 확인하지 못했습니다. 자동 재인식하지 않습니다. 같은 요청 다시 보내기는 동일 작업 ID와 입력을 사용합니다.");}
    }finally{lock.current=false;setBusy(false);}
  };
  const cancel=async()=>{if(!job)return;try{await jsonResponse(await fetch(`/api/local-image/jobs/${job.id}/cancel`,{method:"POST",headers:{...baseHeaders,"X-HM-CSRF":csrf}}));setMessage("취소 요청을 보냈습니다. 해당 작업 프로세스의 종료 확인을 기다립니다.");}catch(error){setMessage(describe(error));}};
  return <>
    <section className="panel"><label>악보 PNG/JPEG 선택<input aria-label="악보 이미지 선택" type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" disabled={busy||!!job&&localImageRunning(job.phase)} onChange={event=>{const next=event.target.files?.[0];event.target.value="";void selectFile(next);}}/></label>
      <p>단일 PNG/JPG/JPEG · 최대 12 MiB, 2천만 픽셀. PDF·다중 페이지와 EXIF 자동 회전 사진은 이 로컬 경로에서 지원하지 않습니다.</p>
      {file&&dimensions&&<><p>{file.name} · {file.size.toLocaleString()} bytes · {dimensions.width} × {dimensions.height}</p><Image unoptimized width={dimensions.width} height={dimensions.height} className={styles.preview} src={preview} alt="선택한 악보 원본 미리보기"/></>}
      <p>설치된 homr와 로컬 OCR을 사용합니다. 원본을 외부 인식 서비스에 전송하지 않습니다. 인식 완료는 음악 정확성이나 Source 승인이 아닙니다. 모델이 빠진 환경에서는 예제 결과로 대체하지 않습니다.</p>
      <label>가사 OCR 언어<select aria-label="가사 OCR 언어" value={language} disabled={busy||!!unresolved} onChange={e=>setLanguage(e.target.value)}><option value="eng+kor">한국어 + 영어</option><option value="eng">영어</option></select></label>
      <label><input type="checkbox" aria-label="로컬 인식 권리 확인" checked={rights} onChange={e=>setRights(e.target.checked)}/>이 악보를 로컬 인식에 사용할 권리가 있습니다. 편곡·공유 권리는 다음 작업 공간에서 별도로 확인합니다.</label>
      <button className="primary" disabled={!ready||!file||!rights||busy||!!job&&localImageRunning(job.phase)} onClick={()=>void start()}>{unresolved?"같은 요청 다시 보내기":"로컬 인식 시작"}</button>
    </section>
    <p role="status" data-testid="local-image-status">{message}</p>
    {job&&<section className="panel"><h2>{LOCAL_IMAGE_PHASE_LABELS[job.phase]}</h2><p>{job.fileName} · 작업 {job.id}</p><p>관측 경과 {Math.max(0,Math.round(((localImageRunning(job.phase)&&now?now:Date.parse(job.updatedAt))-Date.parse(job.createdAt))/1000))}초 · 마지막 상태 {job.updatedAt}</p>
      <p>실제 단계만 표시하며 예상 진행률은 만들지 않습니다. 원본 실패·미확정 기록과 이후 교정 상태는 별도로 보존합니다.</p>
      {job.errorCode&&<p role="alert">{describe(Error(job.errorCode))}</p>}
      {localImageRunning(job.phase)&&<button onClick={()=>void cancel()}>이 인식 취소</button>}
      {job.phase==="candidate-ready"&&<button disabled={busy} onClick={()=>void openCandidate(job)}>교정 작업 공간 열기</button>}
      {!localImageRunning(job.phase)&&job.phase!=="candidate-ready"&&<button disabled={!ready||!rights||busy} onClick={()=>void start(job)}>이 원본으로 새 인식 실행</button>}
      <details><summary>입력과 실행 연결 정보</summary><p>입력 SHA-256 {job.execution.inputSha256}</p><p>새 실제 인식 · 앱 {job.execution.applicationRevision} · runner {job.execution.runnerSha256} · 모델 {job.execution.modelsSha256}</p><p>권리 확인 actor: {job.execution.actor}</p></details>
    </section>}
    <section className="panel"><h2>이 브라우저의 인식 작업</h2>{jobs.map(item=><p key={item.id}><button disabled={busy||!!unresolved} onClick={()=>chooseJob(item)}>{item.fileName} · {LOCAL_IMAGE_PHASE_LABELS[item.id===job?.id?job.phase:item.phase]}</button></p>)}<p><Link href="/score-workspace">저장한 작업 공간 열기</Link> · <Link href="/workspace">저장한 프로젝트 열기</Link></p></section>
  </>;
}
