import { validateLocalImageResult, type LocalImageJob } from "../../domain/omr/local-image";
import type { Step3ImportVersions } from "../musicxml/types";
import { originFromLocalCandidate } from "./input";
import { createScoreWorkspace } from "./journal";
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
  // The upload consent covers local recognition only ("편곡·공유 권리는 별도로
  //확인"). It is not re-used as generation rights; the draft asks for that once.
  const workspace=await createScoreWorkspace(await originFromLocalCandidate(bundle,job.fileName),versions,id);
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
