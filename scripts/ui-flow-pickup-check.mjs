import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { pickupRepeatExercise } from "../src/product/fixtures/pickup-repeat-exercise.ts";
const base = process.env.HM_UI_BASE_URL ?? "http://127.0.0.1:3133";
const evidence = process.env.HM_UI_EVIDENCE_DIR ?? "runtime-browser-evidence/h3-flow";
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ ...(process.env.HM_UI_BROWSER_CHANNEL ? { channel: process.env.HM_UI_BROWSER_CHANNEL } : {}) });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => {
    globalThis.pickupRequests = [];
    const NativeWorker = globalThis.Worker;
    globalThis.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        const post = this.postMessage.bind(this);
        this.postMessage = (message, ...rest) => {
          if (message.kind === "request" && ["answer", "generate"].includes(message.operation)) {
            globalThis.pickupRequests.push({ operation: message.operation, answers: message.input.answer?.answers ?? message.input.choice?.answers });
          }
          return post(message, ...rest);
        };
      }
    };
  });
  const page = await context.newPage(), errors = [], api = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", route => { api.push(route.request().url()); return route.abort(); });
  await page.goto(base, { waitUntil: "networkidle" });
  const upload = () => page.locator('input[type="file"]').setInputFiles({ name: "pickup.musicxml", mimeType: "application/xml", buffer: Buffer.from(pickupRepeatExercise()) });
  const radio = () => page.getByRole("radiogroup", { name: "악보 확인" }).getByRole("radio");
  const generate = () => page.getByRole("button", { name: "알토·테너 화음 만들기", exact: true });
  async function chooseParts() {
    await page.locator(".hm-part").filter({ has: page.getByRole("radio", { name: /둘 다/ }) }).click();
    await page.getByRole("checkbox").check();
  }
  await upload();
  await expect(radio()).toHaveCount(1, { timeout: 60000 });
  await expect(page.locator(".hm-notice.is-ask")).toContainText("직접 고치려면 MuseScore에서 못갖춘마디에 코드를 넣어 다시 올려 주세요.");
  await expect(radio()).not.toBeChecked();
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme });
    await page.locator(".hm-notice.is-ask").evaluate(element => element.scrollIntoView({ block: "start" }));
    await page.screenshot({ path: `${evidence}/pickup-question-${colorScheme}.png` });
  }
  await chooseParts(); await expect(generate()).toBeDisabled();
  await radio().check(); await expect(generate()).toBeEnabled({ timeout: 60000 });
  const firstAnswer = await page.evaluate(() => globalThis.pickupRequests.find(request => request.operation === "answer")?.answers);
  expect(firstAnswer).toEqual({ pickupChord: "use-following-first-chord" });
  await page.getByRole("button", { name: "다른 파일", exact: true }).click(); await upload();
  await expect(radio()).not.toBeChecked({ timeout: 60000 });
  await chooseParts(); await expect(generate()).toBeDisabled();
  await radio().check(); await expect(generate()).toBeEnabled({ timeout: 60000 });
  await generate().click();
  await expect(page.locator(".hm-score-notation svg").first()).toBeVisible({ timeout: 120000 });
  expect(await page.evaluate(() => globalThis.pickupRequests.find(request => request.operation === "generate")?.answers)).toEqual(firstAnswer);
  expect(errors).toEqual([]); expect(api).toEqual([]);
  console.log("PASS pickup engine question, answer preview, required answer, file reset and Worker generation");
  await context.close();
} finally { await browser.close(); }
