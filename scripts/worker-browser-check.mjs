// Run against the temporary production route described in H1_WORKER_IMPLEMENTATION.md.
// Self-authored 120-bar fixture only. No share API, database server or object store.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const { chromium } = await import(process.env.HM_PLAYWRIGHT_MODULE ?? "@playwright/test");

const base = process.env.HM_WORKER_CHECK_URL ?? "http://127.0.0.1:3196";
const output = process.env.HM_WORKER_CHECK_OUTPUT ?? "worker-browser-metrics.json";
const original = readFileSync(new URL("../src/product/fixtures/wag11/4-4-1.musicxml", import.meta.url), "utf8");
const bars = [...original.matchAll(/<measure\b[\s\S]*?<\/measure>/gu)].map(m => m[0]);
const longBars = Array.from({ length: 120 }, (_, i) => {
  let n = 0;
  return bars[i % 4].replace(/number="\d+"/u, `number="${i + 1}"`).replaceAll("</note>", () =>
    `<lyric><syllabic>single</syllabic><text>${createHash("sha256").update(`${i}:${n++}`).digest("hex").slice(0, 16)}</text></lyric></note>`);
}).join("");
const xml = original.replace(/<measure\b[\s\S]*<\/measure>/u, longBars);
const browser = await chromium.launch({ channel: "msedge", headless: true });
const results = [];
async function pageAt(rate) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage(), cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  const workers = [], errors = [];
  page.on("worker", worker => { if (new URL(worker.url()).origin !== new URL(base).origin) errors.push("foreign-worker"); workers.push(worker); });
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/h1-worker-probe", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), "content-security-policy": "worker-src 'self'" } });
  });
  await page.goto(base + "/h1-worker-probe");
  await page.waitForFunction(() => !!globalThis.h1WorkerProbe);
  return { context, page, workers, errors };
}
try {
  // Real worker cancellation before commit and abort during the commit acknowledgment.
  {
    const { context, page, workers, errors } = await pageAt(4);
    const cancellation = await page.evaluate(async xml => {
      const c = globalThis.h1WorkerProbe.createClient(), choice = { parts: ["alto","tenor"], rightsConfirmed: true, confirmedAt: "2026-10-10T00:00:00.000Z" };
      const p = await c.prepare({ bytes: new TextEncoder().encode(xml), fileName: "120-bars.musicxml" });
      let cancelled = "";
      try { await c.generate(p.handle, choice, { onStage: s => { if (s === "generating") c.cancel(); } }); }
      catch (error) { cancelled = error.name; }
      const afterCancel = await c.list();
      let expired = "";
      try { await c.generate(p.handle, choice); } catch (error) { expired = error.code; }
      const q = await c.prepare({ bytes: new TextEncoder().encode(xml), fileName: "120-bars.musicxml" }), controller = new AbortController();
      let duringCommit = "";
      const saved = await c.generate(q.handle, choice, { signal: controller.signal, onStage: s => {
        if (s === "committing") { duringCommit = c.cancel(); controller.abort(); }
      } });
      const afterCommit = await c.list(); await c.dispose();
      return { cancelled, afterCancel: afterCancel.length, expired, duringCommit, saved: saved.status, afterCommit: afterCommit.length };
    }, xml);
    if (cancellation.cancelled !== "AbortError" || cancellation.afterCancel !== 0 || cancellation.expired !== "WORKER_HANDLE_EXPIRED"
      || cancellation.duringCommit !== "committing" || cancellation.saved !== "saved" || cancellation.afterCommit !== 1 || errors.length) throw Error(JSON.stringify({ cancellation, errors }));
    results.push({ cancellation, sameOriginFileWorkers: workers.length, errors }); console.log(JSON.stringify(results.at(-1)));
    await context.close();
  }
  for (const rate of [1,4]) for (let trial = 1; trial <= 3; trial++) {
    const { context, page, workers, errors } = await pageAt(rate);
    const measured = await page.evaluate(async xml => {
      const c = globalThis.h1WorkerProbe.createClient(), tasks = [], gaps = [], stages = [];
      const observer = new PerformanceObserver(list => tasks.push(...list.getEntries().map(e => ({ start: e.startTime, ms: e.duration }))));
      observer.observe({ type: "longtask" });
      let previous = performance.now();
      const interval = setInterval(() => { const now = performance.now(); gaps.push(now-previous); previous = now; }, 16);
      const start = performance.now(), startup = await c.start(), loaded = performance.now();
      const p = await c.prepare({ bytes: new TextEncoder().encode(xml), fileName: "120-bars.musicxml" }), prepared = performance.now();
      const result = await c.generate(p.handle, { parts: ["alto","tenor"], rightsConfirmed: true, confirmedAt: "2026-10-10T00:00:00.000Z" },
        { onStage: stage => stages.push({ stage, ms: performance.now()-prepared }) });
      const responded = performance.now();
      if (result.status !== "saved" || result.project.practice.status !== "available") throw Error(result.status);
      await new Promise(r => setTimeout(r, 50));
      const engineLongestTaskMs = Math.max(0,...tasks.filter(t => t.start < responded).map(t => t.ms));
      const engineMaxTimerGapMs = Math.max(0,...gaps); gaps.length = 0;
      const renderStart = performance.now();
      globalThis.h1WorkerProbe.render(result.project.practice.abc);
      const renderMs = performance.now()-renderStart;
      await new Promise(r => setTimeout(r, 50));
      clearInterval(interval); observer.disconnect();
      const projectId = result.project.projectId, events = result.project.practice.plan.events.length;
      globalThis.h1SavedId = projectId;
      await c.dispose();
      return { startupMs: startup.startupMs, prepareMs: prepared-loaded, generateSaveViewMs: responded-prepared, stages,
        engineLongestTaskMs, engineMaxTimerGapMs, renderMs, totalToSvgMs: performance.now()-start-100,
        longestTaskMs: Math.max(0,...tasks.map(t => t.ms)), events };
    }, xml);
    // Reopening uses a fresh worker realm and verifies the existing IndexedDB bytes.
    const reopened = await page.evaluate(async () => {
      const c = globalThis.h1WorkerProbe.createClient(), startup = await c.start(), started = performance.now();
      const view = await c.open(globalThis.h1SavedId), ms = performance.now()-started;
      await c.dispose(); return { startupMs: startup.startupMs, openViewMs: ms, status: view?.practice.status };
    });
    if (errors.length) throw Error(JSON.stringify(errors));
    results.push({ rate, trial, worker: measured, reopened, sameOriginFileWorkers: workers.length, errors });
    writeFileSync(output, JSON.stringify(results, null, 2)); console.log(JSON.stringify(results.at(-1)));
    await context.close();
  }
  // A matching current-code production baseline; module load is outside stage timing.
  for (const rate of [1,4]) {
    const { context, page } = await pageAt(rate);
    const baseline = await page.evaluate(async xml => {
      const tasks = [], observer = new PerformanceObserver(list => tasks.push(...list.getEntries().map(e => e.duration)));
      observer.observe({ type: "longtask" });
      const result = await globalThis.h1WorkerProbe.baseline({ bytes: new TextEncoder().encode(xml), fileName: "120-bars.musicxml" },
        { parts: ["alto","tenor"], rightsConfirmed: true, confirmedAt: "2026-10-10T00:00:00.000Z" });
      const start = performance.now(); globalThis.h1WorkerProbe.render(result.practice.abc); const renderMs = performance.now()-start;
      await new Promise(r => setTimeout(r, 50)); observer.disconnect();
      return { ...result.stages, renderMs, longestTaskMs: Math.max(0,...tasks) };
    }, xml);
    results.push({ rate, baseline }); writeFileSync(output, JSON.stringify(results, null, 2)); console.log(JSON.stringify(results.at(-1))); await context.close();
  }
} finally { await browser.close(); }
