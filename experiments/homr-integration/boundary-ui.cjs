/* Local browser evidence only. No DB writes, injected Source, oracle input or OMR.
 * HM_BOUNDARY_PRIVATE names an existing private output directory; browser actions
 * are supplied as a JSON file after inspecting the real original. */
/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node CJS runner uses the installed Playwright runtime through NODE_PATH. */
const {chromium}=require('playwright');
const fs=require('node:fs');const path=require('node:path');
const root=process.env.HM_BOUNDARY_PRIVATE;
if(!root||!fs.existsSync(root))throw Error('Existing private evidence directory required');
const actions=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const name=path.basename(process.argv[2],'.json');
const allowed=new Set(['localhost','127.0.0.1']);
const locate=(page,spec)=>{let t=page;for(const s of Array.isArray(spec)?spec:[spec]){t=s.role?t.getByRole(s.role,{name:s.name,exact:s.exact!==false}):s.label?t.getByLabel(s.label,{exact:s.exact!==false}):s.testid?t.getByTestId(s.testid):s.text?t.getByText(s.text,{exact:s.exact!==false}):t.locator(s.css);if(s.nth!==undefined)t=t.nth(s.nth);}return t;};
(async()=>{
 const chrome=process.env.HM_BOUNDARY_BROWSER==='chrome';
 const profile=process.env.HM_BOUNDARY_PROFILE;
 if(profile&&!/^[a-z0-9-]+$/u.test(profile))throw Error('Profile must be a local directory name');
 const ephemeral=chrome&&!profile;
 const downloadsPath=path.join(root,'browser-download-staging');fs.mkdirSync(downloadsPath,{recursive:true});
 const options={channel:chrome?'chrome':'msedge',headless:true,downloadsPath,ignoreDefaultArgs:['--mute-audio'],args:['--disable-background-networking','--disable-component-update']};
 const browser=ephemeral?await chromium.launch(options):undefined;
 const context=browser?await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true}):await chromium.launchPersistentContext(path.join(root,profile??'browser-profile'),{...options,viewport:{width:1440,height:1000},acceptDownloads:true});
 const blocked=[],errors=[],records=[];
 await context.route('**/*',r=>{if(allowed.has(new URL(r.request().url()).hostname))return r.continue();blocked.push(r.request().url());return r.abort();});
 await context.addInitScript(()=>{
   // A passive analyser tap observes the real device-output graph. It neither
   // substitutes AudioContext nor changes the application's output connection.
   window.__boundaryAudio={connections:0,peak:0,samples:0,contexts:[]};
   const original=AudioNode.prototype.connect;
   AudioNode.prototype.connect=function(destination,...rest){
     const result=Reflect.apply(original,this,[destination,...rest]);
     if(destination instanceof AudioDestinationNode){
       const evidence=window.__boundaryAudio,ctx=this.context,analyser=ctx.createAnalyser();analyser.fftSize=2048;
       Reflect.apply(original,this,[analyser]);evidence.connections++;
       const data=new Float32Array(analyser.fftSize);
       const timer=setInterval(()=>{analyser.getFloatTimeDomainData(data);for(const x of data)evidence.peak=Math.max(evidence.peak,Math.abs(x));evidence.samples+=data.length;evidence.contexts=[{state:ctx.state,currentTime:ctx.currentTime,sampleRate:ctx.sampleRate}];if(ctx.state==='closed')clearInterval(timer);},30);
     }return result;
   };
 });
 const page=context.pages()[0]??await context.newPage();page.on('pageerror',e=>errors.push(String(e)));page.setDefaultTimeout(30000);
 try{
   for(const [i,a]of actions.entries()){
     const begin=Date.now();const rec={i,...a};
     try{
       const t=a.target?locate(page,a.target):null;
       if(a.op==='goto'){if(!allowed.has(new URL(a.url).hostname))throw Error('Local URL required');await page.goto(a.url,{waitUntil:'networkidle',timeout:120000});}
       else if(a.op==='upload')await t.setInputFiles(a.file);
       else if(a.op==='fill')await t.fill(a.value);
       else if(a.op==='select')await t.selectOption(a.value);
       else if(a.op==='click')await t.click();
       else if(a.op==='check')await t.check();
       else if(a.op==='reload')await page.reload({waitUntil:'networkidle',timeout:120000});
       else if(a.op==='download'){const promise=page.waitForEvent('download');await t.click();const d=await promise;const dest=path.join(root,a.name??d.suggestedFilename());await d.saveAs(dest);rec.download=dest;}
       else if(a.op==='openOriginal'){const pending=page.waitForEvent('popup');await t.click();const popup=await pending;await popup.waitForLoadState();rec.originalUrl=popup.url();await popup.screenshot({path:path.join(root,`${name}-${i}-original.png`),fullPage:true});await popup.close();}
       else if(a.op==='inspect'){rec.observed=await (t??page.locator('body')).innerText();}
       else if(a.op==='wait')await page.waitForTimeout(a.ms);
       else if(a.op==='audio'){await page.waitForTimeout(a.ms??2500);rec.audio=await page.evaluate(()=>window.__boundaryAudio);if(!rec.audio||rec.audio.peak<=0.00001)throw Error('No nonzero real WebAudio output observed');}
       else if(a.op==='assert'){if(a.enabled!==undefined&&await t.isEnabled()!==a.enabled)throw Error('enabled assertion failed');if(a.text!==undefined&&!await t.innerText().then(x=>x.includes(a.text)))throw Error('text assertion failed');if(a.count!==undefined&&await t.count()!==a.count)throw Error('count assertion failed');}
       else throw Error('Unknown UI action');
       if(a.waitText)await page.getByText(a.waitText,{exact:false}).first().waitFor({timeout:60000});
       if(a.waitUrl)await page.waitForURL(a.waitUrl,{timeout:120000});
       if(a.waitSave){await page.waitForFunction(()=>{const e=document.querySelector('[data-testid="workspace-status"]');return e&&/저장 완료|저장본 복구|원본·후보·근거 저장 완료/.test(e.textContent)&&!e.textContent.includes('중…');},{},{timeout:60000});}
       await page.waitForTimeout(160);rec.status='complete';
     }catch(e){rec.status='failed';rec.error=String(e);}
     rec.uiWallMilliseconds=Date.now()-begin;records.push(rec);
     if((a.screenshot||rec.status==='failed')&&!page.isClosed())await page.screenshot({path:path.join(root,`${name}-${i}.png`)}).catch(()=>{});
     if(rec.status==='failed')break;
   }
   fs.writeFileSync(path.join(root,name+'.ui.txt'),await page.locator('body').innerText());
   fs.writeFileSync(path.join(root,name+'.controls.json'),JSON.stringify(await page.locator('input,select,button').evaluateAll(es=>es.map(e=>({tag:e.tagName,id:e.id,label:e.getAttribute('aria-label')||Array.from(e.labels??[]).map(l=>l.textContent).join(' ')||e.textContent,value:e.value,disabled:e.disabled,options:e.options?Array.from(e.options).map(x=>({text:x.text,value:x.value})):undefined}))),null,2));
 }finally{
   const report={url:page.url(),actions:records,browserErrors:errors,blockedExternalRequests:blocked,interpretation:'Explicit automation decisions, not user approvals or measured human correction time.'};
   fs.writeFileSync(path.join(root,name+'.report.json'),JSON.stringify(report,null,2));
   const last=records.at(-1);console.log(JSON.stringify({url:report.url,complete:records.filter(x=>x.status==='complete').length,last:last?{i:last.i,op:last.op,status:last.status,error:last.error,audio:last.audio}:null,browserErrors:errors}));await context.close();if(browser)await browser.close();
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
