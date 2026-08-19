import type { PracticeSharePayload } from "../domain/share";

export type ShareLocator =
  | { readonly kind: "stored"; readonly token: string }
  | { readonly kind: "inline"; readonly encodedPayload: string };

export type ShareLocatorResult =
  | { readonly status: "valid"; readonly locator: ShareLocator; readonly key: string }
  | { readonly status: "invalid"; readonly code: "SHARE_LOCATOR_MISSING" | "SHARE_LOCATOR_CONFLICT" | "SHARE_LOCATOR_INVALID" };

export function resolveShareLocator(token: string | undefined, hash: string): ShareLocatorResult {
  let encodedPayload: string | undefined;
  try { encodedPayload = new URLSearchParams(hash.replace(/^#/u, "")).get("p") ?? undefined; }
  catch { return { status: "invalid", code: "SHARE_LOCATOR_INVALID" }; }
  if (token && encodedPayload) return { status: "invalid", code: "SHARE_LOCATOR_CONFLICT" };
  if (token) {
    if (!/^[A-Za-z0-9_-]{16,512}$/u.test(token)) return { status: "invalid", code: "SHARE_LOCATOR_INVALID" };
    return { status: "valid", locator: { kind: "stored", token }, key: `stored:${token}` };
  }
  if (encodedPayload) return { status: "valid", locator: { kind: "inline", encodedPayload }, key: `inline:${encodedPayload}` };
  return { status: "invalid", code: "SHARE_LOCATOR_MISSING" };
}

export type ShareLocatorLoadState =
  | { readonly status: "idle" }
  | { readonly status: "loading"; readonly key: string; readonly locator: ShareLocator }
  | { readonly status: "loaded"; readonly key: string; readonly locator: ShareLocator; readonly payload: PracticeSharePayload; readonly reported: boolean }
  | { readonly status: "failed"; readonly key?: string; readonly code: string };

export type ShareLocatorLoadAction =
  | { readonly type: "begin"; readonly key: string; readonly locator: ShareLocator }
  | { readonly type: "success"; readonly key: string; readonly payload: PracticeSharePayload }
  | { readonly type: "failure"; readonly key?: string; readonly code: string }
  | { readonly type: "reported"; readonly key: string };

export function reduceShareLocatorLoad(state: ShareLocatorLoadState, action: ShareLocatorLoadAction): ShareLocatorLoadState {
  if (action.type === "begin") return { status: "loading", key: action.key, locator: action.locator };
  if (action.type === "failure") {
    if (action.key && state.status !== "idle" && state.key !== action.key) return state;
    return { status: "failed", ...(action.key ? { key: action.key } : {}), code: action.code };
  }
  if (action.type === "success") {
    if (state.status !== "loading" || state.key !== action.key) return state;
    return { status: "loaded", key: state.key, locator: state.locator, payload: action.payload, reported: false };
  }
  if (state.status !== "loaded" || state.key !== action.key) return state;
  return { ...state, reported: true };
}
