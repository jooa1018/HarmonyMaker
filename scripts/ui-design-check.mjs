/** H3 design review: node scripts/ui-design-check.mjs
 * Set HM_UI_BASE_URL, HM_UI_EVIDENCE_DIR, and (optionally) HM_UI_BROWSER_CHANNEL.
 * Uses fixture-only pages; never contacts a database, object store or share API.
 */
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const base = process.env.HM_UI_BASE_URL ?? "http://127.0.0.1:3133";
const out = process.env.HM_UI_EVIDENCE_DIR ?? "runtime-browser-evidence/h3";
const channel = process.env.HM_UI_BROWSER_CHANNEL;
const names = ["01-start", "02-parts", "03-lead", "04-fix", "05-unsupported", "06-making", "07-result", "08-partial", "09-share", "10-library", "11-guide", "12-shared", "A-reading", "B-dragover", "C-unreadable", "D-share-before", "E-library-empty", "F-minibar"];
const cases = [...names.map(name => ({ name, width: 390, height: 844 })), ...["07-result", "10-library"].map(name => ({ name, width: 360, height: 780 })), { name: "desktop-result", width: 1280, height: 800 }];
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ ...(channel ? { channel } : {}) });
const results = [];
const interactionResults = [];
try {
  for (const theme of (process.env.HM_UI_INTERACTIONS_ONLY === "1" ? [] : ["light", "dark"])) {
    await mkdir(join(out, theme), { recursive: true });
    const context = await browser.newContext({ colorScheme: theme, reducedMotion: "reduce", deviceScaleFactor: 2 });
    const page = await context.newPage();
    for (const target of cases) {
      await page.setViewportSize({ width: target.width, height: target.height });
      await page.goto(`${base}/ui-preview/${target.name}`, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      if (await page.locator(".hm-score-notation").count()) await expect(page.locator(".hm-score-notation svg").first()).toBeVisible();
      const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
      const smallTargets = await page.locator(".hm").evaluateAll(roots => roots.flatMap(root => [...root.querySelectorAll("button,a,input,summary")]).flatMap(el => {
        if (!el.getClientRects().length || el.closest("[hidden], [inert]")) return [];
        // Approved inline-text exception from the design review (screen 11 only).
        if (el.matches('.hm-gstep a[href="https://musescore.org"]')) return [];
        // Visually hidden file input is operated by the visible file picker button.
        if (el.matches('input[type="file"].hm-sr-only')) return [];
        const target = el.tagName === "INPUT" ? el.closest("label") ?? el : el;
        const rect = target.getBoundingClientRect();
        let width = rect.width, height = rect.height;
        // The approved switch/restart CSS expands hit areas using pseudo-elements.
        for (const pseudo of ["::before", "::after"]) {
          const style = getComputedStyle(target, pseudo);
          if (style.content === "none" || style.position !== "absolute") continue;
          const left = parseFloat(style.left), right = parseFloat(style.right), top = parseFloat(style.top), bottom = parseFloat(style.bottom);
          if (Number.isFinite(left) && Number.isFinite(right)) width = Math.max(width, rect.width - left - right);
          if (Number.isFinite(top) && Number.isFinite(bottom)) height = Math.max(height, rect.height - top - bottom);
        }
        return width < 43.9 || height < 43.9 ? [{ tag: el.tagName, label: el.getAttribute("aria-label") ?? el.textContent?.trim(), width, height }] : [];
      }));
      const axe = await new AxeBuilder({ page }).analyze();
      const violations = axe.violations.filter(v => v.impact === "serious" || v.impact === "critical").map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target) }));
      const fonts = await page.evaluate(() => [...document.fonts].filter(f => f.status === "loaded").map(f => ({ family: f.family, weight: f.weight })));
      const stem = `${target.name}-${target.width}`;
      await page.screenshot({ path: join(out, theme, `${stem}.png`), fullPage: true, animations: "disabled", caret: "initial" });
      await page.screenshot({ path: join(out, theme, `${stem}-viewport.png`), animations: "disabled", caret: "initial" });
      const result = { theme, ...target, ...dimensions, smallTargets, violations, fonts };
      results.push(result);
      console.log(`${theme} ${stem}: overflow=${dimensions.scrollWidth > dimensions.clientWidth}, small=${smallTargets.length}, axe=${violations.length}`);
    }
    await context.close();
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  async function check(name, run) {
    try { await run(); interactionResults.push({ name, passed: true }); }
    catch (error) { interactionResults.push({ name, passed: false, message: error instanceof Error ? error.message : String(error) }); }
  }
  await check("part arrows and rights gate", async () => {
    await page.goto(`${base}/ui-preview/02-parts`);
    await expect(page.getByRole("button", { name: "알토 화음 만들기", exact: true })).toBeDisabled();
    await expect(page.locator(".hm-notes summary")).toHaveText("참고 1개");
    await page.locator(".hm-notes summary").click();
    await expect(page.locator(".hm-notes li")).toHaveCount(1);
    const alto = page.getByRole("radio", { name: /알토 추천/ });
    await alto.focus(); await alto.press("ArrowDown");
    await expect(page.getByRole("radio", { name: /^테너/ })).toBeChecked();
    await page.getByRole("checkbox").check();
    await expect(page.getByRole("button", { name: "테너 화음 만들기", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "테너 화음 만들기", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("화음 만드는 중");
  });
  await check("solo is exclusive; mutes are independent; speed restarts", async () => {
    await page.goto(`${base}/ui-preview/07-result`);
    await page.getByRole("button", { name: "테너만 듣기" }).click();
    await expect(page.getByRole("button", { name: "알토만 듣기" })).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("button", { name: "알토 끄기", exact: true }).click();
    await page.getByRole("button", { name: "테너 끄기", exact: true }).click();
    await expect(page.getByRole("button", { name: "알토 끄기", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "테너 끄기", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.locator(".hm-seg label").filter({ has: page.getByRole("radio", { name: "75%", exact: true }) }).click();
    await expect(page.locator(".hm-time")).toContainText("0:00");
    await expect(page.getByRole("button", { name: "재생", exact: true })).toBeVisible();
  });
  await check("share focus trap, rights gate, Escape and return focus", async () => {
    await page.goto(`${base}/ui-preview/07-result`);
    const trigger = page.getByRole("button", { name: "팀원과 공유", exact: true });
    await trigger.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const layer = await page.locator(".hm-sheet-layer").boundingBox();
    expect(layer).toEqual({ x: 0, y: 0, ...page.viewportSize() });
    const sheet = await page.getByRole("dialog").boundingBox();
    expect(Math.round(sheet.y + sheet.height)).toBe(page.viewportSize().height);
    await expect(page.getByRole("heading", { name: "팀원과 공유" })).toBeFocused();
    await expect(page.getByRole("button", { name: "공유 링크 만들기" })).toBeDisabled();
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("checkbox")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "닫기" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
  await check("library cancellation preserves item, deletion is local fixture only", async () => {
    await page.goto(`${base}/ui-preview/10-library`);
    await page.getByRole("button", { name: "취소", exact: true }).click();
    await expect(page.getByRole("heading", { name: "아침 기도", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "아침 기도 지우기" }).click();
    await page.getByRole("button", { name: "지우기", exact: true }).click();
    await expect(page.getByRole("heading", { name: "아침 기도", exact: true })).toHaveCount(0);
  });
  await context.close();
} finally {
  await browser.close();
  await writeFile(join(out, "checks.json"), JSON.stringify({ results, interactionResults }, null, 2));
}
const failures = results.filter(r => r.scrollWidth > r.clientWidth || r.smallTargets.length || r.violations.length).length + interactionResults.filter(r => !r.passed).length;
console.log(JSON.stringify({ visualCases: results.length, interactionResults, failures }, null, 2));
if (failures) process.exitCode = 1;
