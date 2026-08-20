"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { generateDeterministicAccompaniment } from "../../accompaniment/deterministic";
import type { PracticeSharePayload } from "../../domain/share";
import { ProductPracticePlayer } from "../../product/ProductPracticePlayer";
import { buildPlaybackPlanSafely } from "../../product/playback-plan";
import { arrangementRenderDocumentToAbcSafely } from "../../product/score-adapter";
import { decodeProductUrlShare } from "../../product/share-url";
import { displayedShareLocatorState, reduceShareLocatorLoad, resolveShareLocator } from "../../product/share-locator";
import { submitStoredShareReport, type DisplayedStoredShareAuthority } from "../../product/share-report";
import { materializeSharedPracticeSafely } from "../../product/shared-practice";

export function SharedPracticeClient() {
  const search = useSearchParams();
  const token = search.get("token") ?? undefined;
  const [hashState, setHashState] = useState<{ readonly ready: boolean; readonly value: string }>({ ready: false, value: "" });
  const [loadState, dispatchLoad] = useReducer(reduceShareLocatorLoad, { status: "idle" });
  const displayedStoredAuthorityRef = useRef<DisplayedStoredShareAuthority | undefined>(undefined);
  const reportAbortRef = useRef<AbortController | undefined>(undefined);
  const locatorResult = useMemo(() => hashState.ready ? resolveShareLocator(token, hashState.value) : undefined, [hashState, token]);
  const displayedLoadState = displayedShareLocatorState(loadState, locatorResult);
  const payload: PracticeSharePayload | undefined = displayedLoadState?.payload;
  const [message, setMessage] = useState("공유 payload를 검증하는 중…");
  const materialization = useMemo(() => payload ? materializeSharedPracticeSafely(payload) : undefined, [payload]);
  const materialized = materialization?.status === "available" ? materialization.value : undefined;
  const document = materialized?.document;
  const abcSerialization = useMemo(() => payload && materialized ? arrangementRenderDocumentToAbcSafely(materialized.document, materialized.trackRoles, { title: payload.title, tempo: payload.tempo, key: payload.key }) : undefined, [materialized, payload]);
  const abc = abcSerialization?.status === "available" ? abcSerialization.value : undefined;
  const [accompanimentState, setAccompanimentState] = useState<{ readonly digest: string; readonly value: Awaited<ReturnType<typeof generateDeterministicAccompaniment>> }>();

  useEffect(() => {
    const refresh = () => setHashState({ ready: true, value: window.location.hash });
    refresh();
    window.addEventListener("hashchange", refresh);
    window.addEventListener("popstate", refresh);
    return () => { window.removeEventListener("hashchange", refresh); window.removeEventListener("popstate", refresh); };
  }, []);

  const locatorLoading = locatorResult?.status === "valid"
    && (loadState.status !== "loaded" || loadState.key !== locatorResult.key);

  useLayoutEffect(() => {
    const next = displayedLoadState?.locator.kind === "stored"
      ? { key: displayedLoadState.key, token: displayedLoadState.locator.token }
      : undefined;
    const previous = displayedStoredAuthorityRef.current;
    if (previous && (previous.key !== next?.key || previous.token !== next?.token)) {
      reportAbortRef.current?.abort();
      reportAbortRef.current = undefined;
    }
    displayedStoredAuthorityRef.current = next;
  }, [displayedLoadState]);

  useEffect(() => () => reportAbortRef.current?.abort(), []);

  useEffect(() => {
    if (!locatorResult) return;
    if (locatorResult.status === "invalid") {
      dispatchLoad({ type: "failure", code: locatorResult.code });
      return;
    }
    let active = true;
    const { key, locator } = locatorResult;
    dispatchLoad({ type: "begin", key, locator });
    const load = async () => {
      try {
        if (locator.kind === "inline") {
          const next = decodeProductUrlShare(locator.encodedPayload);
          if (active) { dispatchLoad({ type: "success", key, payload: next }); setMessage(`URL PracticeShare v${next.schemaVersion} 검증 완료 · 읽기 전용`); }
          return;
        }
        const response = await fetch(`/api/shares/${encodeURIComponent(locator.token)}`, { method: "GET" });
        const body = await response.json() as { ok: boolean; payload?: PracticeSharePayload };
        if (!response.ok || !body.payload) throw new RangeError("SHARE_UNAVAILABLE");
        if (active) { dispatchLoad({ type: "success", key, payload: body.payload }); setMessage(`암호화 ShareStore PracticeShare v${body.payload.schemaVersion} 검증 완료 · 읽기 전용`); }
      } catch { if (active) { dispatchLoad({ type: "failure", key, code: "SHARE_UNAVAILABLE" }); setMessage("공유를 열 수 없습니다."); } }
    };
    void load();
    return () => { active = false; };
  }, [locatorResult]);

  useEffect(() => {
    if (!document) return;
    let active = true;
    const digest = document.effectiveChordTimeline.digest;
    void generateDeterministicAccompaniment(document.effectiveChordTimeline).then((value) => { if (active) setAccompanimentState({ digest, value }); });
    return () => { active = false; };
  }, [document]);
  const accompaniment = document && accompanimentState?.digest === document.effectiveChordTimeline.digest ? accompanimentState.value : undefined;

  const playbackConstruction = useMemo(() => materialized
    ? buildPlaybackPlanSafely(materialized.document, materialized.trackRoles, accompaniment)
    : undefined, [accompaniment, materialized]);
  const plan = playbackConstruction?.status === "available" ? playbackConstruction.value : undefined;
  const presentedMessage = locatorResult?.status === "invalid"
    ? locatorResult.code === "SHARE_LOCATOR_CONFLICT" ? "저장형 token과 inline payload를 동시에 사용할 수 없습니다." : "공유 위치 정보가 올바르지 않습니다."
    : locatorLoading
      ? "공유 payload를 검증하는 중…"
      : payload && materialization?.status === "unavailable"
      ? "이 공유의 연습 자료를 안전하게 구성할 수 없습니다."
      : payload && abcSerialization?.status === "unavailable"
      ? "이 공유의 ABC 악보를 안전하게 직렬화할 수 없습니다."
      : payload && playbackConstruction?.status === "unavailable"
      ? "이 공유의 재생 계획을 안전하게 구성할 수 없습니다."
      : message;

  const report = async () => {
    if (!displayedLoadState || displayedLoadState.locator.kind !== "stored") return;
    const authority = { key: displayedLoadState.key, token: displayedLoadState.locator.token };
    reportAbortRef.current?.abort();
    const controller = new AbortController();
    reportAbortRef.current = controller;
    const outcome = await submitStoredShareReport({ authority, currentAuthority: () => displayedStoredAuthorityRef.current, signal: controller.signal });
    if (reportAbortRef.current !== controller) return;
    reportAbortRef.current = undefined;
    if (outcome === "accepted") {
      dispatchLoad({ type: "reported", key: authority.key }); setMessage("신고를 접수했습니다. 공유 존재 여부에 대한 추가 정보는 공개하지 않습니다.");
    } else if (outcome === "failed") setMessage("신고를 접수하지 못했습니다.");
  };

  return <>
    <header><p className="eyebrow">PRACTICE SHARE · READ ONLY</p><h1>{payload?.title ?? "공유 연습 악보"}</h1><p>후보, 잠금, 진단, 원본 파일 없이 선택된 연습 artifact만 표시합니다.</p><p><Link href="/">HarmonyMaker 시작으로</Link></p></header>
    <p className={`status${payload ? "" : " error"}`} aria-live="polite">{presentedMessage}</p>
    {payload && abc && plan && displayedLoadState ? <><section className="panel"><dl><div><dt>Preset</dt><dd>{payload.presetId}</dd></div><div><dt>Rights</dt><dd>{payload.rightsShareConfirmed ? "공유 확인됨" : "차단"}</dd></div><div><dt>Artifact</dt><dd><code>{payload.arrangementArtifactDigest}</code></dd></div></dl></section><ProductPracticePlayer key={displayedLoadState.key} abc={abc} plan={plan} tempo={payload.tempo} identity={displayedLoadState.key} initialSettings={materialized.playbackDefaults} readOnly />{displayedLoadState.locator.kind === "stored" ? <section className="panel"><h2>공유 신고</h2><button type="button" disabled={displayedLoadState.reported} onClick={() => void report()}>{displayedLoadState.reported ? "접수됨" : "권리 또는 악용 신고"}</button></section> : null}</> : null}
  </>;
}
