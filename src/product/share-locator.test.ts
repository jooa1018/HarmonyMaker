import { describe, expect, it } from "vitest";

import type { PracticeSharePayload } from "../domain/share";
import { displayedShareLocatorState, reduceShareLocatorLoad, resolveShareLocator } from "./share-locator";

const payload = { schemaVersion: 3 } as PracticeSharePayload;

describe("public share locator authority", () => {
  it("rejects dual/missing locators and resolves stored or inline identity exactly", () => {
    expect(resolveShareLocator("stored-token-123456", "#p=inline")).toMatchObject({ status: "invalid", code: "SHARE_LOCATOR_CONFLICT" });
    expect(resolveShareLocator(undefined, "")).toMatchObject({ status: "invalid", code: "SHARE_LOCATOR_MISSING" });
    expect(resolveShareLocator("stored-token-123456", "")).toEqual({ status: "valid", locator: { kind: "stored", token: "stored-token-123456" }, key: "stored:stored-token-123456" });
    expect(resolveShareLocator(undefined, "#p=inline-payload")).toEqual({ status: "valid", locator: { kind: "inline", encodedPayload: "inline-payload" }, key: "inline:inline-payload" });
  });

  it("clears A when B begins and ignores stale A success/failure after B", () => {
    const locatorA = { kind: "stored" as const, token: "stored-token-A1234" };
    const locatorB = { kind: "stored" as const, token: "stored-token-B1234" };
    let state = reduceShareLocatorLoad({ status: "idle" }, { type: "begin", key: "stored:A", locator: locatorA });
    state = reduceShareLocatorLoad(state, { type: "success", key: "stored:A", payload });
    expect(state.status).toBe("loaded");
    state = reduceShareLocatorLoad(state, { type: "begin", key: "stored:B", locator: locatorB });
    expect(state).toMatchObject({ status: "loading", key: "stored:B" });
    expect(reduceShareLocatorLoad(state, { type: "success", key: "stored:A", payload })).toBe(state);
    expect(reduceShareLocatorLoad(state, { type: "failure", key: "stored:A", code: "FAILED" })).toBe(state);
    state = reduceShareLocatorLoad(state, { type: "failure", key: "stored:B", code: "SHARE_UNAVAILABLE" });
    expect(state).toEqual({ status: "failed", key: "stored:B", code: "SHARE_UNAVAILABLE" });
  });

  it("binds reported state to the exact displayed locator", () => {
    const locatorA = { kind: "stored" as const, token: "stored-token-A1234" };
    let state = reduceShareLocatorLoad({ status: "idle" }, { type: "begin", key: "stored:A", locator: locatorA });
    state = reduceShareLocatorLoad(state, { type: "success", key: "stored:A", payload });
    expect(reduceShareLocatorLoad(state, { type: "reported", key: "stored:B" })).toBe(state);
    expect(reduceShareLocatorLoad(state, { type: "reported", key: "stored:A" })).toMatchObject({ status: "loaded", key: "stored:A", reported: true });
  });

  it("hides stale A synchronously on the first B render before a passive begin effect", () => {
    const resolvedA = resolveShareLocator("stored-token-A1234", "");
    if (resolvedA.status !== "valid") throw new Error("expected valid A locator");
    let state = reduceShareLocatorLoad({ status: "idle" }, { type: "begin", key: resolvedA.key, locator: resolvedA.locator });
    state = reduceShareLocatorLoad(state, { type: "success", key: resolvedA.key, payload });
    const locatorB = resolveShareLocator("stored-token-B1234", "");
    expect(displayedShareLocatorState(state, locatorB)).toBeUndefined();
    expect(displayedShareLocatorState(state, resolvedA)).toBe(state);
    expect(displayedShareLocatorState(state, resolveShareLocator("stored-token-A1234", "#p=inline"))).toBeUndefined();
  });
});
