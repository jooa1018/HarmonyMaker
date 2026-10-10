// Local browser verification; no application server, account, DB or storage service.
// Run: node src/product/render-practice-audio.browser-check.mjs
// Set AUDIO_BROWSER_CHANNEL=msedge for an installed Edge, AUDIO_BENCHMARK=1 for 4-minute timings.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "@playwright/test");

const server = await createServer({ server: { host: "127.0.0.1", port: 0 }, appType: "custom" });
server.middlewares.use("/audio-check", (_req, res) => { res.setHeader("Content-Type", "text/html"); res.end("<!doctype html><title>Practice audio verification</title>"); });
await server.listen();
const browser = await chromium.launch({ headless: true, ...(process.env.AUDIO_BROWSER_CHANNEL ? {channel:process.env.AUDIO_BROWSER_CHANNEL} : {}) });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/audio-check`);
  const xml = await readFile(new URL("./fixtures/wag11/4-4-1.musicxml", import.meta.url), "utf8");
  const metrics = await page.evaluate(async xml => {
    const {prepareQuickHarmony,generateQuickHarmony} = await import("/src/product/quick-harmony.ts");
    const {projectPracticeView} = await import("/src/product/project-view.ts");
    const {renderPracticeAudio} = await import("/src/product/render-practice-audio.ts");
    const prep = await prepareQuickHarmony({bytes:new TextEncoder().encode(xml),fileName:"audio-exercise.musicxml"});
    const generated = await generateQuickHarmony(prep,{parts:["alto","tenor"],rightsConfirmed:true,confirmedAt:"2026-10-10T00:00:00.000Z"});
    const view = await projectPracticeView(generated.project);
    if (view.status!=="available") throw Error(view.code);
    window.audioCheckInput={plan:view.plan,tempo:view.tempo,speed:100,mix:{kind:"full"},bandEnabled:true};
    const before=JSON.stringify(window.audioCheckInput), started=performance.now();
    const rendered=await renderPracticeAudio(window.audioCheckInput);
    const wav=new DataView(await rendered.blob.arrayBuffer());
    let peak=0, energy=0, clipped=0;
    for(let i=44;i<wav.byteLength;i+=2){const x=wav.getInt16(i,true)/32767;peak=Math.max(peak,Math.abs(x));energy+=x*x;if(Math.abs(x)>=1)clipped++;}
    return {seconds:rendered.seconds,bytes:rendered.bytes,elapsedMs:performance.now()-started,peakDb:20*Math.log10(peak),rmsDb:10*Math.log10(energy/((wav.byteLength-44)/2)),clipped,unchanged:before===JSON.stringify(window.audioCheckInput)};
  }, xml);
  assert.equal(metrics.seconds,12); assert.equal(metrics.bytes,44+12*22050*2);
  assert.ok(Math.abs(metrics.peakDb+1)<0.001); assert.ok(metrics.rmsDb>-40); assert.equal(metrics.clipped,0); assert.equal(metrics.unchanged,true);
  console.log(JSON.stringify({exercise:metrics}));
  const cancellation=await page.evaluate(async()=>{
    const {renderPracticeAudio}=await import("/src/product/render-practice-audio.ts");
    const controller=new AbortController();
    const pending=renderPracticeAudio({...window.audioCheckInput,signal:controller.signal});
    setTimeout(()=>controller.abort(),0);
    try {await pending;return "unexpected-success";}catch(error){return error.name;}
  });
  assert.equal(cancellation,"AbortError");
  console.log(JSON.stringify({cancellation}));
  if(process.env.AUDIO_BENCHMARK){
    const cdp=await page.context().newCDPSession(page);
    for(const rate of [1,4]){
      await cdp.send("Emulation.setCPUThrottlingRate",{rate});
      const measurements=[];
      for(let run=0;run<3;run++)measurements.push(await page.evaluate(async()=>{
        const {renderPracticeAudio}=await import("/src/product/render-practice-audio.ts");
        const source=window.audioCheckInput;
        const plan={...source.plan,totalQuarter:source.plan.totalQuarter*20,events:Array.from({length:20},(_,i)=>source.plan.events.map(e=>({...e,eventId:`${i}:${e.eventId}`,startQuarter:e.startQuarter+i*source.plan.totalQuarter}))).flat()};
        const started=performance.now();const rendered=await renderPracticeAudio({...source,plan});
        return {elapsedMs:performance.now()-started,seconds:rendered.seconds,bytes:rendered.bytes,events:plan.events.length};
      }));
      assert.ok(measurements.every(m=>m.seconds===240));
      console.log(JSON.stringify({cpuRate:rate,measurements}));
    }
  }
} finally { await browser.close(); await server.close(); }
