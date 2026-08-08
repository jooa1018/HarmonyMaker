import { describe, expect, it } from "vitest";
import { initialMixerState, normalizeSpeed, toggleMute, toggleSolo, voicesOff } from "./mixer";

describe("demo mixer", () => {
  it("toggles mute", () => expect(voicesOff(toggleMute(initialMixerState, 1))).toEqual([1]));
  it("uses a single solo and replaces it", () => expect(toggleSolo(toggleSolo(initialMixerState, 0), 2).solo).toBe(2));
  it("turns a selected solo off", () => expect(toggleSolo(toggleSolo(initialMixerState, 1), 1).solo).toBeNull());
  it("lets solo override an existing mute", () => expect(voicesOff(toggleSolo(toggleMute(initialMixerState, 1), 1))).toEqual([0, 2]));
  it("clamps and validates speed", () => { expect(normalizeSpeed(20)).toBe(50); expect(normalizeSpeed(171)).toBe(150); expect(normalizeSpeed(Number.NaN)).toBe(100); expect(normalizeSpeed(74)).toBe(75); });
});
