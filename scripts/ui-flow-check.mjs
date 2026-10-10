import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const base = process.env.HM_UI_BASE_URL ?? "http://127.0.0.1:3133";
const evidence = process.env.HM_UI_EVIDENCE_DIR ?? "runtime-browser-evidence/h3-flow";
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ ...(process.env.HM_UI_BROWSER_CHANNEL ? { channel: process.env.HM_UI_BROWSER_CHANNEL } : {}) });
const results = [];
const fixture = name => readFile(new URL(`../src/product/fixtures/${name}`, import.meta.url), "utf8");
const widthFits = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
async function upload(page, xml, name = "exercise.musicxml") {
  await page.goto(base, { waitUntil: "networkidle" });
  await page.locator('input[type="file"]').setInputFiles({ name, mimeType: "application/vnd.recordare.musicxml+xml", buffer: Buffer.from(xml) });
  await expect(page.getByRole("heading", { name: "화음 파트를 고르세요" })).toBeVisible({ timeout: 90000 });
}
async function generate(page) {
  await page.locator(".hm-part").filter({ has: page.getByRole("radio", { name: /둘 다/ }) }).click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "알토·테너 화음 만들기" }).click();
  await page.waitForURL(/result\?project=quick-/, { timeout: 180000 });
  await expect(page.locator(".hm-score-notation svg").first()).toBeVisible({ timeout: 90000 });
}
async function share(page) {
  await page.getByRole("button", { name: "팀원과 공유", exact: true }).click();
  await expect(page.getByRole("button", { name: "공유 링크 만들기" })).toBeDisabled();
  await page.getByRole("dialog").getByRole("checkbox").check();
  await page.getByRole("button", { name: "공유 링크 만들기" }).click();
  await expect(page.getByText("공유 링크를 만들었어요")).toBeVisible({ timeout: 60000 });
  return page.locator(".hm-linkbox-text").innerText();
}
try {
  if (process.env.HM_UI_PERF_ONLY !== "1") {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    for (const [index, name] of ["4-4-1", "3-4-1", "12-8-1"].entries()) {
      const context = await browser.newContext({ viewport, colorScheme: index === 1 ? "dark" : "light", acceptDownloads: true, permissions: ["clipboard-read", "clipboard-write"] });
      const page = await context.newPage();
      const errors = [], apiRequests = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests.push(request.url()); });
      await upload(page, await fixture(`wag11/${name}.musicxml`));
      await generate(page);
      for (const label of ["멜로디", "알토", "테너"]) await expect(page.getByRole("button", { name: `${label}만 듣기` })).toBeVisible();
      expect(await page.locator(".hm-score-notation").evaluate(el => getComputedStyle(el).getPropertyValue("--hm-v1").trim() === getComputedStyle(el).getPropertyValue("--hm-alto").trim())).toBe(true);
      await page.getByRole("button", { name: "테너만 듣기" }).click();
      await expect(page.getByRole("button", { name: "테너만 듣기" })).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("button", { name: "재생", exact: true }).first().click();
      await expect(page.getByRole("button", { name: "일시정지", exact: true }).first()).toBeVisible({ timeout: 30000 });
      await page.getByRole("button", { name: "일시정지", exact: true }).first().click();
      const downloaded = page.waitForEvent("download");
      await page.getByRole("button", { name: "MusicXML 받기" }).click();
      const xml = await readFile(await (await downloaded).path(), "utf8");
      expect(xml).toContain("<clef-octave-change>-1</clef-octave-change>");
      expect(xml).toContain("알토"); expect(xml).toContain("테너");
      const violations = (await new AxeBuilder({ page }).include(".hm").analyze()).violations.filter(item => ["critical", "serious"].includes(item.impact));
      expect(violations).toEqual([]); expect(await widthFits(page)).toBe(true);
      if (viewport.width === 390) {
        await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
        await expect(page.locator(".hm-minibar")).toBeVisible();
        await page.setViewportSize({ width: 1280, height: 800 });
        await expect(page.locator(".hm-minibar")).toHaveCount(0);
        await page.setViewportSize(viewport);
        await page.evaluate(() => scrollTo(0, 0));
      }
      await page.screenshot({ path: `${evidence}/${viewport.width}-${name}.png`, fullPage: true, caret: "initial" });
      const link = await share(page);
      await page.getByRole("button", { name: "링크 복사" }).click();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
      await page.goto(link);
      await expect(page.getByRole("button", { name: "테너만 듣기" })).toBeVisible({ timeout: 60000 });
      await expect(page.locator(".hm-score-notation svg").first()).toBeVisible();
      expect(await widthFits(page)).toBe(true);
      if (index === 0) {
        await page.goto(`${base}/share?token=conflicting_token${new URL(link).hash}`);
        await expect(page.getByText("공유 악보를 열 수 없어요. 보낸 분에게 링크를 다시 확인해 주세요.")).toBeVisible();
      }
      expect(apiRequests).toEqual([]); expect(errors).toEqual([]);
      await page.goto(`${base}/library`);
      await expect(page.locator(".hm-lib-item")).toHaveCount(1);
      await page.locator(".hm-lib-item").getByRole("button", { name: /지우기/ }).click();
      await page.getByRole("button", { name: "취소", exact: true }).click();
      await expect(page.locator(".hm-lib-item")).toHaveCount(1);
      await page.locator(".hm-lib-item").getByRole("button", { name: /지우기/ }).click();
      await page.getByRole("button", { name: "지우기", exact: true }).click();
      await expect(page.getByText("아직 만든 화음이 없어요")).toBeVisible();
      results.push({ viewport: viewport.width, fixture: name, passed: true });
      console.log(`PASS ${viewport.width} ${name}: generate, audio, download, share, library, axe`);
      await context.close();
    }
  }
  const context = await browser.newContext({ viewport: { width: 360, height: 780 }, colorScheme: "dark" });
  const page = await context.newPage();
  await upload(page, (await fixture("wag11/4-4-1.musicxml")).replaceAll("<octave>4</octave>", "<octave>3</octave>"));
  await generate(page);
  await expect(page.locator(".hm-banner").first()).toBeVisible();
  await expect(page.getByRole("region", { name: "연습 플레이어" })).toBeVisible();
  expect(await widthFits(page)).toBe(true);
  await page.reload();
  await expect(page.locator(".hm-banner").first()).toBeVisible({ timeout: 60000 });
  await page.screenshot({ path: `${evidence}/360-partial-dark.png`, fullPage: true, caret: "initial" });
  const legacy = await fixture("auto-draft-v1-auto.json");
  await page.evaluate(async encoded => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open("harmonymaker-v0", 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    await new Promise((resolve, reject) => { const tx = db.transaction("projects", "readwrite"); tx.objectStore("projects").put({ projectId: "legacy-fixture", updatedAt: "2026-10-10T00:00:00.000Z", encoded }); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    db.close();
  }, legacy);
  await page.goto(`${base}/result?project=legacy-fixture`);
  await expect(page.locator(".hm-score-notation svg").first()).toBeVisible({ timeout: 60000 });
  await expect(page.locator(".hm-mix-name").filter({ hasText: /Upper|Lower/ })).toHaveCount(1);
  expect(await widthFits(page)).toBe(true);
  const unchanged = await page.evaluate(async () => {
    const db = await new Promise(resolve => { const request = indexedDB.open("harmonymaker-v0", 1); request.onsuccess = () => resolve(request.result); });
    const row = await new Promise(resolve => { const request = db.transaction("projects", "readonly").objectStore("projects").get("legacy-fixture"); request.onsuccess = () => resolve(request.result); });
    db.close(); return row.encoded;
  });
  expect(unchanged).toBe(legacy);
  results.push({ case: "partial-reload-and-legacy-360-dark", passed: true });
  console.log("PASS partial reload and legacy names at 360px");
  await context.close();

  const doctypeContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const doctypePage = await doctypeContext.newPage();
  const doctypeRequests = [], doctypeErrors = [];
  doctypePage.on("request", request => { if (request.url().includes("musicxml.org")) doctypeRequests.push(request.url()); });
  doctypePage.on("pageerror", error => doctypeErrors.push(error.message));
  const standardDoctype = '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">';
  await upload(doctypePage, (await fixture("wag11/4-4-1.musicxml")).replace("?>", `?>\n${standardDoctype}\n`), "standard-doctype.musicxml");
  await generate(doctypePage);
  for (const label of ["멜로디", "알토", "테너"]) await expect(doctypePage.getByRole("button", { name: `${label}만 듣기` })).toBeVisible();
  expect(doctypeRequests).toEqual([]); expect(doctypeErrors).toEqual([]);
  results.push({ case: "standard-musicxml-doctype-upload-and-generate", passed: true });
  console.log("PASS standard MusicXML DOCTYPE upload and generation without external DTD request");
  await doctypeContext.close();

  }
  if (process.env.HM_UI_SKIP_PERF !== "1") {
  // Warm routes before measuring. Test data repeats our own four-bar fixture.
  const perfContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const perfPage = await perfContext.newPage();
  const cdp = await perfContext.newCDPSession(perfPage);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const original = await fixture("wag11/4-4-1.musicxml");
  const bars = [...original.matchAll(/<measure\b[\s\S]*?<\/measure>/g)].map(match => match[0]);
  const longBars = Array.from({ length: 120 }, (_, index) => {
    let note = 0;
    const bar = bars[index % 4].replace(/number="\d+"/, `number="${index + 1}"`);
    if (process.env.HM_UI_PERF_NO_LYRICS === "1") return bar;
    return bar.replaceAll("</note>", () => `<lyric><syllabic>single</syllabic><text>${createHash("sha256").update(`${index}:${note++}`).digest("hex").slice(0, 16)}</text></lyric></note>`);
  }).join("");
  const longXml = original.replace(/<measure\b[\s\S]*<\/measure>/, longBars);
  await perfPage.goto(base, { waitUntil: "networkidle" });
  await perfPage.evaluate(() => {
    window.h3Perf = { stage: "prepare", tasks: [], start: performance.now() };
    new PerformanceObserver(list => { for (const entry of list.getEntries()) window.h3Perf.tasks.push({ stage: window.h3Perf.stage, duration: entry.duration }); }).observe({ type: "longtask", buffered: false });
  });
  await perfPage.locator('input[type="file"]').setInputFiles({ name: "120-bars.musicxml", mimeType: "application/xml", buffer: Buffer.from(longXml) });
  await expect(perfPage.getByRole("heading", { name: "화음 파트를 고르세요" })).toBeVisible({ timeout: 180000 });
  await perfPage.evaluate(() => { window.h3Perf.prepareMs = performance.now() - window.h3Perf.start; window.h3Perf.stage = "generate"; window.h3Perf.start = performance.now(); });
  await generate(perfPage);
  const performanceResult = await perfPage.evaluate(() => ({ prepareMs: window.h3Perf.prepareMs, generateAndRenderMs: performance.now() - window.h3Perf.start, longestTaskMs: Math.max(0, ...window.h3Perf.tasks.map(task => task.duration)), tasks: window.h3Perf.tasks }));
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  results.push({ case: "120-bars-cpu-4x", syntheticLyrics: process.env.HM_UI_PERF_NO_LYRICS !== "1", ...performanceResult });
  console.log(`PERF ${JSON.stringify(performanceResult)}`);
  if (process.env.HM_UI_SKIP_STORED !== "1") {
  const stored = await share(perfPage);
  expect(stored).toContain("/share?token=");
  await expect(perfPage.getByText(/이 링크는 .*까지 열려요/)).toBeVisible();
  await perfPage.goto(stored);
  await expect(perfPage.getByRole("button", { name: "테너만 듣기" })).toBeVisible({ timeout: 60000 });
  await expect(perfPage.getByRole("button", { name: "문제 신고", exact: true })).toBeVisible();
  await perfPage.getByRole("button", { name: "문제 신고", exact: true }).click();
  await expect(perfPage.getByRole("button", { name: "접수됨" })).toBeDisabled();
  results.push({ case: "stored-share-disposable-memory-server", passed: true });
  console.log("PASS stored share, server expiry, receiver, report (disposable memory)");
  }
  await perfContext.close();
  }
} finally {
  await writeFile(`${evidence}/flow-results.json`, JSON.stringify(results, null, 2));
  await browser.close();
}
