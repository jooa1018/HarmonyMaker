"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { generateDeterministicAccompaniment } from "../../accompaniment/deterministic";
import type { PracticeSharePayload } from "../../domain/share";
import { LivePractice } from "../_result/LivePractice";
import { AppBar } from "../_ui/controls";
import { scoreVoiceRoles } from "../_ui/score-colors";
import { Icon } from "../_ui/Icon";
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
    void generateDeterministicAccompaniment(document.effectiveChordTimeline).then((value) => { if (active) setAccompanimentState({ digest, value }); }).catch(() => { if (active) setMessage("반주를 만들지 못했어요."); });
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

  const ready = payload && abc && plan && accompaniment && displayedLoadState;
  const waiting = !locatorResult || locatorLoading || Boolean(payload && materialized && abc && !accompaniment && message !== "반주를 만들지 못했어요.");
  const failed = !waiting && !ready;
  return <div className="hm"><div className="hm-page">
    <AppBar shared />
    <section className="hm-result-head"><h1 className="hm-result-title">{payload?.title ?? "공유 연습 악보"}</h1>
      {ready && <><p className="hm-lede">팀원이 공유한 연습 악보예요. 내 파트를 &quot;솔로&quot;로 들으며 연습해 보세요.</p><div className="hm-chips">{plan.trackIds.filter(id => id !== "track:band").map(id => <span className="hm-chip" key={id}><span className={`hm-dot ${plan.trackRoles?.[id] === "lead" ? "is-melody" : plan.trackRoles?.[id] === "lower" ? "is-alto" : plan.trackRoles?.[id] === "upper" ? "is-tenor" : ""}`} />{plan.trackLabels[id]}</span>)}</div></>}
    </section>
    {waiting && <p role="status">악보를 그리는 중…</p>}
    {failed && <div className="hm-notice is-stop" role="alert"><p>공유 악보를 열 수 없어요. 보낸 분에게 링크를 다시 확인해 주세요.</p></div>}
    {ready && <LivePractice voiceRoles={materialized ? scoreVoiceRoles(materialized.trackRoles) : undefined} key={displayedLoadState.key} view={{ status: "available", abc, plan, tempo: payload.tempo, identity: displayedLoadState.key }} title={payload.title} initialSettings={payload.playbackDefaults} />}
    <Link className="hm-linkcard" href="/"><span className="hm-linkcard-icon"><Icon name="music" /></span><span className="hm-linkcard-text"><b>내 악보로도 화음을 만들어 보세요</b><span>MusicXML만 있으면 바로 만들어요</span></span><Icon name="right" /></Link>
    <div className="hm-footer"><span>HarmonyMaker로 만든 연습 악보</span>{ready && displayedLoadState.locator.kind === "stored" && <button className="hm-btn hm-btn-text hm-btn-sm" type="button" disabled={displayedLoadState.reported} onClick={() => void report()}><Icon name="flag" />{displayedLoadState.reported ? "접수됨" : "문제 신고"}</button>}</div>
    {displayedLoadState?.reported && <p role="status">신고를 접수했어요.</p>}
    {message === "신고를 접수하지 못했습니다." && <p role="alert">신고를 접수하지 못했어요. 다시 시도해 주세요.</p>}
    {failed && <details className="hm-fold"><summary>자세히</summary><div className="hm-prompt"><pre tabIndex={0}>{presentedMessage}</pre></div></details>}
  </div></div>;
}
