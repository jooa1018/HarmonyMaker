// H3 screen integration: self-authored score, disposable browser storage, no real DB/S3.
import { chromium, expect } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const base = process.env.HM_UI_BASE_URL ?? "http://127.0.0.1:3133";
const output = `${process.env.HM_UI_EVIDENCE_DIR ?? "runtime-browser-evidence/h3-flow"}/worker`;
await mkdir(output, { recursive: true });
const original = await readFile(new URL("../src/product/fixtures/wag11/4-4-1.musicxml", import.meta.url), "utf8");
const bars = [...original.matchAll(/<measure\b[\s\S]*?<\/measure>/gu)].map(m => m[0]);
const xml = original.replace(/<measure\b[\s\S]*<\/measure>/u, Array.from({ length: 120 }, (_, i) => {
  let n = 0;
  return bars[i % 4].replace(/number="\d+"/u, `number="${i + 1}"`).replaceAll("</note>", () => `<lyric><syllabic>single</syllabic><text>${createHash("sha256").update(`${i}:${n++}`).digest("hex").slice(0, 16)}</text></lyric></note>`);
}).join(""));
const browser = await chromium.launch({ ...(process.env.HM_UI_BROWSER_CHANNEL ? { channel: process.env.HM_UI_BROWSER_CHANNEL } : {}) });
const results = [];
async function setup(rate = 1) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => {
    const events = [], tasks = [], gaps = [], scores = [], ui = [];
    globalThis.hmWorkerEvidence = { events, tasks, gaps, scores, ui };
    let previous = performance.now();
    setInterval(() => { const now = performance.now(); gaps.push({ at: now, ms: now - previous }); previous = now; }, 16);
    new PerformanceObserver(list => tasks.push(...list.getEntries().map(e => ({ at: e.startTime, ms: e.duration })))).observe({ type: "longtask" });
    const NativeWorker = globalThis.Worker;
    globalThis.Worker = class extends NativeWorker {
      constructor(url, options) {
        super(url, options); const requests = new Map();
        events.push({ kind: "worker", url: String(url), at: performance.now() });
        const post = this.postMessage.bind(this);
        this.postMessage = (message, ...rest) => {
          if (message.kind === "request") {
            requests.set(message.id, message.operation);
            events.push({ kind: "request", operation: message.operation, id: message.id, at: performance.now() });
            if (globalThis.hmWorkerFault === message.operation) {
              globalThis.hmWorkerFault = undefined;
              queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: { kind: "error", generation: message.generation, id: message.id, code: "WORKER_HANDLE_EXPIRED", messageKo: "시험용 만료" } })));
              return;
            }
          }
          return post(message, ...rest);
        };
        this.addEventListener("message", ({ data }) => { events.push({ kind: data.kind, operation: requests.get(data.id), stage: data.stage, code: data.code, at: performance.now() }); });
      }
    };
    // Observe the existing hook's replaceChildren → completed SVG boundary, without modifying engine code.
    const replace = Element.prototype.replaceChildren;
    Element.prototype.replaceChildren = function (...nodes) {
      if (this.classList.contains("hm-score-notation")) scores.push({ start: performance.now() });
      return replace.apply(this, nodes);
    };
    new MutationObserver(() => {
      const last = scores.at(-1);
      if (last && !last.end && document.querySelector(".hm-score-notation svg")) last.end = performance.now();
      const heading = document.querySelector(".hm-making h2")?.textContent;
      const cancel = [...document.querySelectorAll(".hm-making button")].find(el => el.textContent === "취소");
      if (heading && ui.at(-1)?.heading !== heading) ui.push({ heading, cancelDisabled: cancel?.disabled, at: performance.now() });
    }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  });
  const page = await context.newPage(), errors = [], api = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", route => { api.push(route.request().url()); return route.abort(); });
  await page.route("**/*", async route => {
    if (route.request().resourceType() !== "document") return route.fallback();
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), "content-security-policy": "worker-src 'self'" } });
  });
  const cdp = await context.newCDPSession(page); await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  await page.goto(base, { timeout: 120000 }); await page.getByRole("button", { name: "파일 고르기" }).waitFor();
  return { page, context, errors, api };
}
async function upload(page, score = original) {
  await page.locator('input[type="file"]').setInputFiles({ name: "worker-test.musicxml", mimeType: "application/xml", buffer: Buffer.from(score) });
  await expect(page.getByRole("heading", { name: "화음 파트를 고르세요" })).toBeVisible({ timeout: 120000 });
}
async function begin(page) {
  await page.locator(".hm-part").filter({ has: page.getByRole("radio", { name: /둘 다/ }) }).click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "알토·테너 화음 만들기" }).click();
}
async function ready(page) { await expect(page.locator(".hm-score-notation svg").first()).toBeVisible({ timeout: 180000 }); }
try {
  {
    const { page, context, errors, api } = await setup(4);
    await upload(page, xml); await begin(page);
    await page.waitForFunction(() => globalThis.hmWorkerEvidence.events.some(e => e.operation === "generate" && e.stage === "generating"));
    await page.getByRole("button", { name: "취소", exact: true }).click();
    await expect(page.getByRole("button", { name: "파일 고르기" })).toBeVisible();
    await page.getByRole("link", { name: "내 악보", exact: true }).click();
    await expect(page.getByText("아직 만든 화음이 없어요")).toBeVisible({ timeout: 90000 });
    expect(errors).toEqual([]); expect(api).toEqual([]);
    results.push({ case: "cancel-generation", savedRows: 0 }); await context.close();
  }
  {
    const { page, context, errors, api } = await setup();
    await upload(page); await begin(page); await ready(page);
    const savedUrl = page.url();
    await page.getByRole("button", { name: "재생", exact: true }).first().click();
    await expect(page.getByRole("button", { name: "일시정지", exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "일시정지", exact: true }).first().click();
    await page.evaluate(() => { globalThis.hmWorkerFault = "exportMusicXml"; });
    await page.getByRole("button", { name: "MusicXML 받기" }).click();
    await page.waitForFunction(() => globalThis.hmWorkerEvidence.events.filter(e => e.kind === "request" && e.operation === "open").length >= 2);
    await ready(page); expect(page.url()).toBe(savedUrl);
    const events = await page.evaluate(() => globalThis.hmWorkerEvidence.events);
    expect(events.filter(e => e.kind === "request" && e.operation === "open").length).toBeGreaterThanOrEqual(2);
    await page.getByRole("button", { name: "다른 파트로 다시 만들기", exact: true }).click();
    await expect(page.getByRole("heading", { name: "화음 파트를 고르세요" })).toBeVisible();
    await begin(page); await ready(page);
    await page.getByRole("button", { name: "팀원과 공유", exact: true }).click();
    await page.getByRole("dialog").getByRole("checkbox").check();
    await page.getByRole("button", { name: "공유 링크 만들기", exact: true }).click();
    await expect(page.getByText("공유 링크를 만들었어요")).toBeVisible({ timeout: 90000 });
    const url = await page.locator(".hm-linkbox-text").innerText(); expect(url).toContain("/share#p=");
    await page.goto(url); await ready(page);
    expect(await page.evaluate(() => globalThis.hmWorkerEvidence.events.some(e => e.kind === "request" && e.operation === "openShare"))).toBe(true);
    expect(errors).toEqual([]); expect(api).toEqual([]);
    results.push({ case: "play-expired-reopen-reprepare-share", passed: true }); await context.close();
  }
  if (process.env.HM_UI_WORKER_MEASURE === "1") for (const rate of [1, 4]) for (let trial = 1; trial <= 3; trial++) {
    const { page, context, errors, api } = await setup(rate);
    await upload(page, xml); await begin(page); await ready(page); await page.waitForTimeout(100);
    const evidence = await page.evaluate(() => globalThis.hmWorkerEvidence);
    const range = operation => {
      const start = evidence.events.find(e => e.kind === "request" && e.operation === operation)?.at;
      const end = evidence.events.find(e => e.kind === "result" && e.operation === operation)?.at;
      return { start, end, ms: end - start };
    };
    const prepare = range("prepare"), generate = range("generate"), open = range("open"), score = evidence.scores.at(-1);
    const computing = e => [[prepare.start, prepare.end], [generate.start, generate.end], [open.start, open.end]].some(([start, end]) => e.at >= start && e.at < end);
    const workerStart = evidence.events.find(e => e.kind === "worker")?.at, workerReady = evidence.events.find(e => e.kind === "ready")?.at;
    const metric = { rate, trial, startupMs: workerReady - workerStart, prepareMs: prepare.ms, generateSaveViewMs: generate.ms, reopenViewMs: open.ms,
      svgObservedMs: score.end - score.start, generateToSvgMs: score.end - generate.start,
      engineLongestTaskMs: Math.max(0, ...evidence.tasks.filter(computing).map(e => e.ms)),
      engineMaxTimerGapMs: Math.max(0, ...evidence.gaps.filter(computing).map(e => e.ms)),
      longestTaskMs: Math.max(0, ...evidence.tasks.filter(e => e.at >= prepare.start).map(e => e.ms)),
      stages: evidence.ui, workersSameOrigin: evidence.events.filter(e => e.kind === "worker").every(e => new URL(e.url).origin === new URL(base).origin) };
    expect(metric.stages.some(s => s.heading === "저장 마무리" && s.cancelDisabled)).toBe(true);
    expect(metric.workersSameOrigin).toBe(true); expect(errors).toEqual([]); expect(api).toEqual([]);
    results.push(metric); console.log(JSON.stringify(metric));
    await writeFile(`${output}/metrics.json`, JSON.stringify(results, null, 2)); await context.close();
  }
  await writeFile(`${output}/metrics.json`, JSON.stringify(results, null, 2)); console.log(JSON.stringify(results));
} finally { await browser.close(); }
