import { spawn } from 'node:child_process';
import path from 'node:path';

/** OS mutex is abandoned safely on process death; no stale-file unlink race. */
export async function withLocalImageMutex(config,action){
  const child=spawn(config.python,[path.join(config.repository,'scripts/local-image-lock.py'),config.root],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONUTF8:'1'}});
  let completed=false;
  const exited=new Promise(resolve=>child.once('close',code=>{completed=true;resolve(code);}));
  try{
    await new Promise((resolve,reject)=>{let output='';
      const timeout=setTimeout(()=>{child.kill();reject(Error('LOCAL_IMAGE_MUTEX_TIMEOUT'));},18000);
      const done=fn=>value=>{clearTimeout(timeout);fn(value);};
      child.once('error',done(reject));child.once('close',done(()=>reject(Error('LOCAL_IMAGE_MUTEX_UNAVAILABLE'))));
      child.stdout.on('data',chunk=>{output+=chunk.toString();if(output.includes('LOCKED'))done(resolve)();});
      child.stderr.resume();
    });
    return await action();
  }finally{
    child.stdin.end();
    if(!completed)await exited;
  }
}
