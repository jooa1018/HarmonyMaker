import { chromium, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { zipSync, strToU8 } from "fflate";

const base = process.env.HM_UI_BASE_URL ?? "http://127.0.0.1:3133";
const xml = await readFile(new URL("../src/product/fixtures/wag11/4-4-1.musicxml", import.meta.url), "utf8");
const browser = await chromium.launch({ ...(process.env.HM_UI_BROWSER_CHANNEL ? { channel: process.env.HM_UI_BROWSER_CHANNEL } : {}) });
const hint = "소리가 안 나면 휴대폰 무음 모드를 꺼 주세요.";
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [], requests = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/")) requests.push(request.url()); });
  await page.goto(base, { waitUntil: "networkidle" });
  expect(await page.locator('input[type="file"]').getAttribute("accept")).toBeNull();
  // A supported score with an unsupported extension still goes through engine rejection.
  await page.locator('input[type="file"]').setInputFiles({ name: "exercise.txt", mimeType: "text/plain", buffer: Buffer.from(xml) });
  await expect(page.locator(".hm-notice.is-stop")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "다른 파일 올리기" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "화음 파트를 고르세요" })).toHaveCount(0);
  console.log("PASS unrestricted picker and unsupported .txt card");

  const mxl = zipSync({ "META-INF/container.xml": strToU8('<container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>'), "score.xml": strToU8(xml) });
  for (const [name, bytes] of [["exercise.musicxml", Buffer.from(xml)], ["exercise.xml", Buffer.from(xml)], ["exercise.mxl", Buffer.from(mxl)]]) {
    await page.goto(base, { waitUntil: "networkidle" });
    await page.locator('input[type="file"]').setInputFiles({ name, mimeType: "application/octet-stream", buffer: bytes });
    await expect(page.getByRole("heading", { name: "화음 파트를 고르세요" })).toBeVisible({ timeout: 60000 });
    console.log(`PASS ${name} with generic downloaded-file MIME`);
  }
  // Keep grouping coverage independent of the separately planned tuplet support.
  const repeated = xml.replace("</note>", `<notations><ornaments>${"<trill-mark/>".repeat(6)}</ornaments></notations></note>`);
  await page.goto(base, { waitUntil: "networkidle" });
  await page.locator('input[type="file"]').setInputFiles({ name: "repeated.musicxml", mimeType: "application/xml", buffer: Buffer.from(repeated) });
  await expect(page.getByRole("heading", { name: "이 악보는 아직 화음을 만들 수 없어요" })).toBeVisible({ timeout: 60000 });
  await expect(page.locator(".hm-notice.is-stop")).toHaveCount(1);
  console.log("PASS repeated engine notices grouped into one card");
  await page.goto(`${base}/guide`, { waitUntil: "networkidle" });
  await expect(page.locator("#prompt-text")).toContainText('<kind text="2">major</kind>');
  expect(errors).toEqual([]); expect(requests).toEqual([]);
  await page.close();

  for (const [name, userAgent, platform, maxTouchPoints, ios] of [
    ["iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", "iPhone", 5, true],
    ["iPad desktop", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)", "MacIntel", 5, true],
    ["Android", "Mozilla/5.0 (Linux; Android 15)", "Linux armv8l", 5, false],
    ["Mac", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)", "MacIntel", 0, false],
  ]) {
    for (const available of [false, true]) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent });
      await context.addInitScript(({ platform, maxTouchPoints, available }) => {
        Object.defineProperties(navigator, {
          platform: { value: platform, configurable: true },
          maxTouchPoints: { value: maxTouchPoints, configurable: true },
          audioSession: { value: available ? {} : undefined, configurable: true },
        });
      }, { platform, maxTouchPoints, available });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      for (const screen of ["07-result", "12-shared"]) {
        await page.goto(`${base}/ui-preview/${screen}`, { waitUntil: "networkidle" });
        await expect(page.locator(".hm-score-notation svg").first()).toBeVisible();
        await expect(page.getByText(hint, { exact: true })).toHaveCount(ios && !available ? 1 : 0);
        if (ios && !available) await expect(page.locator(".hm-transport + .hm-small")).toHaveText(hint);
      }
      expect(errors).toEqual([]);
      console.log(`PASS result/shared silent hint: ${name}, audioSession=${available}`);
      await context.close();
    }
  }
} finally { await browser.close(); }
