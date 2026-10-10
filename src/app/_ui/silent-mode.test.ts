import { describe, expect, it } from "vitest";
import { needsSilentModeHint } from "./silent-mode";

describe("silent mode guidance", () => {
  for (const [name, device, ios] of [
    ["iPhone", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", platform: "iPhone", maxTouchPoints: 5 }, true],
    ["iPad mobile", { userAgent: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)", platform: "iPad", maxTouchPoints: 5 }, true],
    ["iPad desktop", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)", platform: "MacIntel", maxTouchPoints: 5 }, true],
    ["Mac", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)", platform: "MacIntel", maxTouchPoints: 0 }, false],
    ["Android", { userAgent: "Mozilla/5.0 (Linux; Android 15)", platform: "Linux armv8l", maxTouchPoints: 5 }, false],
    ["Windows touch", { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", platform: "Win32", maxTouchPoints: 10 }, false],
  ] as const) {
    it.each([false, true])(`${name}, audioSession=%s`, available => {
      expect(needsSilentModeHint({ ...device, ...(available ? { audioSession: {} } : {}) })).toBe(ios && !available);
    });
  }
});
