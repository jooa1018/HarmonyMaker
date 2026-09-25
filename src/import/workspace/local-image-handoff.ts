import { validateLocalImageResult, type LocalImageJob } from "../../domain/omr/local-image";
import type { Step3ImportVersions } from "../musicxml/types";
import { originFromLocalCandidate } from "./input";
import { applyWorkspaceCommand, createScoreWorkspace } from "./journal";
import { ScoreWorkspaceStore, type StoredScoreWorkspace } from "./store";

/** Stable per-job identity: reopening a completed job preserves manual revisions. */
export async function acceptLocalImageWorkspace(job:LocalImageJob,text:string,versions:Step3ImportVersions,store=new ScoreWorkspaceStore()):Promise<StoredScoreWorkspace>{
  const bundle=await validateLocalImageResult(job,text),id=`image:${job.id}`;
  const verify=(record:StoredScoreWorkspace)=>{
    const original=record.workspace.origin.localCandidate;
    if(!original||original.manifestSha256!==bundle.manifestSha256||original.image.sha256!==job.execution.inputSha256)throw new Error("LOCAL_IMAGE_WORKSPACE_MISMATCH");
    return record;
  };
  const previous=await store.load(id);if(previous)return verify(previous);
  const created=await createScoreWorkspace(await originFromLocalCandidate(bundle,job.fileName),versions,id);
  // The upload endpoint refuses jobs without the user's rights confirmation
  // (generation use). Record that same confirmation once, attributed to the
  // upload actor and time, so the draft path does not ask for it again.
  const workspace=await applyWorkspaceCommand(created,created,{kind:"rights",rights:{basis:"user-confirmed-rights",allowedUses:["generation"],confirmedAt:job.createdAt,
    sourceReference:`로컬 이미지 업로드 시 권리 확인 · job ${job.id}`}},
    {id:`upload-rights-${job.id}`,note:"업로드 단계에서 사용자가 확인한 생성 용도 권리를 기록(새 확인 아님)",actor:job.execution.actor,at:job.createdAt});
  const record:StoredScoreWorkspace={workspace,storageRevision:0,updatedAt:new Date().toISOString()};
  try{await store.save(record);return record;}
  catch(error){
    // Another tab may have saved or even corrected this exact job meanwhile.
    // Only a matching immutable origin can recover a first-save CAS race.
    if(error instanceof Error&&error.message==="WORKSPACE_CONCURRENT_EDIT_RELOAD_REQUIRED"){
      const winner=await store.load(id);if(winner)return verify(winner);
    }
    throw error;
  }
}
