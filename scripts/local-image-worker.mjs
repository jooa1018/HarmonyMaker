// Detached local worker. All paths/configuration originate in the local server;
// uploaded filenames and client parameters never become executable arguments.
import fs from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { withLocalImageMutex } from '../src/server/local-image/disk-lock.mjs';

const [root,id,nonce]=process.argv.slice(2);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
if(!root||!path.isAbsolute(root)||!uuid.test(id??'')||!uuid.test(nonce??''))throw Error('LOCAL_IMAGE_WORKER_ARGUMENTS');
const directory=path.join(root,'jobs',id),leaseFile=path.join(root,'active.json');
const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const atomic=async(file,value)=>{const temporary=`${file}.${randomUUID()}.tmp`;await fs.writeFile(temporary,JSON.stringify(value),{flag:'wx',mode:0o600});await fs.rename(temporary,file);};
const exists=async file=>{try{await fs.access(file);return true;}catch{return false;}};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const request=await read(path.join(directory,'request.json'));
if(request.id!==id||request.nonce!==nonce||await fs.realpath(directory)!==path.resolve(directory))throw Error('LOCAL_IMAGE_WORKER_BINDING');
const config=request.config,input=path.join(directory,request.mimeType==='image/png'?'input.png':'input.jpeg');
if(hash(await fs.readFile(input))!==request.execution.inputSha256)throw Error('LOCAL_IMAGE_INPUT_MISMATCH');
let state={nonce,sequence:0,phase:'queued',updatedAt:new Date().toISOString(),workerPid:process.pid};
let writeChain=Promise.resolve(),timer;
async function owns(){try{const lease=await read(leaseFile);return lease.jobId===id&&lease.nonce===nonce;}catch{return false;}}
function publish(change={}) {writeChain=writeChain.then(()=>withLocalImageMutex(config,async()=>{
  if(!await owns())throw Error('LOCAL_IMAGE_LEASE_LOST');
  if(change.phase==='candidate-ready'&&await cancelled())throw Error('LOCAL_IMAGE_CANCELLED');
  state={...state,...(typeof change==='function'?change(state):change),sequence:state.sequence+1,updatedAt:new Date().toISOString()};await atomic(path.join(directory,'state.json'),state);
}));return writeChain;}
const cancelled=()=>exists(path.join(directory,'cancel.json'));
async function run(args,label,observe=false){
  const stdout=openSync(path.join(directory,`${label}.stdout.log`),'wx'),stderr=openSync(path.join(directory,`${label}.stderr.log`),'wx');
  try{
    const child=spawn(config.python,args,{cwd:config.repository,windowsHide:true,stdio:['ignore',stdout,stderr],env:{...process.env,PYTHONUTF8:'1',PYTHONUNBUFFERED:'1',HF_HUB_OFFLINE:'1',NO_PROXY:'*'}});
    const completion=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>resolve(code));});
    const [code]=await Promise.all([completion,observe?publish({observerPid:child.pid}):Promise.resolve()]);return code;
  }finally{closeSync(stdout);closeSync(stderr);}
}
async function filesManifest(){
  async function walk(dir){const files=[];for(const entry of await fs.readdir(dir,{withFileTypes:true})){if(entry.isSymbolicLink())throw Error('LOCAL_IMAGE_PATH_REJECTED');const file=path.join(dir,entry.name);if(entry.isDirectory())files.push(...await walk(file));else if(!['state.json','cancel.json','artifacts.json'].includes(entry.name)&&!entry.name.endsWith('.tmp'))files.push(file);}return files;}
  const files=[];for(const file of await walk(directory)){const bytes=await fs.readFile(file);files.push({path:path.relative(directory,file).replaceAll('\\','/'),bytes:bytes.length,sha256:hash(bytes)});}
  await atomic(path.join(directory,'artifacts.json'),{schema:'hm-local-image-artifacts-v1',jobId:id,inputSha256:request.execution.inputSha256,files});
}
try{
  await publish();
  timer=setInterval(()=>{void (async()=>{let stage;try{stage=(await read(path.join(directory,'stage.json'))).stage;}catch{}await publish(current=>({phase:['recognizing','supplementing'].includes(stage)&&['queued','recognizing','supplementing'].includes(current.phase)?stage:current.phase}));})().catch(()=>undefined);},1000);
  if(await cancelled())throw Error('LOCAL_IMAGE_CANCELLED');
  const hashFile=async file=>{const digest=createHash('sha256');for await(const chunk of createReadStream(file))digest.update(chunk);return digest.digest('hex');};
  for(const file of config.runnerFiles){if(await hashFile(path.join(config.repository,file.path))!==file.sha256)throw Error('LOCAL_IMAGE_RUNNER_CHANGED');}
  for(const file of config.models){if(await hashFile(path.resolve(config.compare,file.path))!==file.sha256)throw Error('LOCAL_IMAGE_MODEL_INTEGRITY');}
  if(await cancelled())throw Error('LOCAL_IMAGE_CANCELLED');
  const integration=path.join(config.repository,'experiments/homr-integration');
  const code=await run([path.join(integration,'run_local.py'),'--compare',config.compare,'--out',path.join(directory,'metrics'),'--seconds','600','--ram','2048','--owner-pid',String(process.pid),'--cancel-file',path.join(directory,'cancel.json'),'--',config.python,path.join(integration,'from_image.py'),'--compare',config.compare,'--image',input,'--out',path.join(directory,'run'),'--language',request.language,'--stage-file',path.join(directory,'stage.json')],'observer',true);
  if(await cancelled())throw Error('LOCAL_IMAGE_CANCELLED');
  const resources=await read(path.join(directory,'metrics/resources.json'));
  if(code!==0){if(resources.stopReason)throw Error(resources.stopReason.startsWith('observer preparation')?'LOCAL_IMAGE_PREPARATION_FAILED':'LOCAL_IMAGE_RESOURCE_STOPPED');throw Error('LOCAL_IMAGE_PROCESS_FAILED');}
  const execution=await read(path.join(directory,'run/execution.json'));
  if(execution.cacheReused!==false||execution.inputSha256!==request.execution.inputSha256||execution.homrRevision!==request.execution.homrRevision)throw Error('LOCAL_IMAGE_EXECUTION_MISMATCH');
  await publish({phase:'packaging'});
  const candidate=path.join(directory,'run/candidate'),evidenceFile=path.join(candidate,'evidence.json');
  const evidence=await read(evidenceFile);evidence.execution=request.execution;await atomic(evidenceFile,evidence);
  const result=path.join(directory,'candidate.review.json');
  if(await run([path.join(integration,'package_review.py'),'--candidate',candidate,'--image',input,'--output',result],'package')!==0)throw Error('LOCAL_IMAGE_PACKAGE_FAILED');
  const bytes=await fs.readFile(result);if(bytes.length>64_000_000)throw Error('LOCAL_IMAGE_RESULT_LIMIT');
  await filesManifest();
  clearInterval(timer);await writeChain;
  if(await cancelled())throw Error('LOCAL_IMAGE_CANCELLED');
  await publish({phase:'candidate-ready',resultSha256:hash(bytes)});
}catch(error){
  clearInterval(timer);await writeChain.catch(()=>undefined);
  const code=String(error.message??error);
  // Only stable codes reach UI. Detailed subprocess diagnostics stay in this job.
  const errorCode=/^LOCAL_IMAGE_[A-Z_]+$/.test(code)?code:'LOCAL_IMAGE_WORKER_FAILED';
  const phase=errorCode==='LOCAL_IMAGE_CANCELLED'?'cancelled':errorCode==='LOCAL_IMAGE_RESOURCE_STOPPED'?'resource-stopped':'failed';
  if(await owns()){writeChain=Promise.resolve();await filesManifest().catch(()=>undefined);await publish({phase,errorCode});}
}finally{
  clearInterval(timer);await writeChain.catch(()=>undefined);
  await withLocalImageMutex(config,async()=>{if(await owns())await fs.unlink(leaseFile);});
}
