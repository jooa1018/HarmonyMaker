"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useReducer, useState } from "react";
import { generateDeterministicAccompaniment } from "../../accompaniment/deterministic";
import type { PracticeSharePayload } from "../../domain/share";
import { ProductPracticePlayer } from "../../product/ProductPracticePlayer";
import { buildPlaybackPlan } from "../../product/playback-plan";
import { arrangementRenderDocumentToAbc } from "../../product/score-adapter";
import { decodeProductUrlShare } from "../../product/share-url";
import { reduceShareLocatorLoad, resolveShareLocator } from "../../product/share-locator";
import { materializeSharedPracticeSafely } from "../../product/shared-practice";

export function SharedPracticeClient() {
  const search = useSearchParams();
  const token = search.get("token") ?? undefined;
  const [hashState, setHashState] = useState<{ readonly ready: boolean; readonly value: string }>({ ready: false, value: "" });
  const [loadState, dispatchLoad] = useReducer(reduceShareLocatorLoad, { status: "idle" });
  const payload: PracticeSharePayload | undefined = loadState.status === "loaded" ? loadState.payload : undefined;
  const [message, setMessage] = useState("공유 payload를 검증하는 중…");
  const materialization = useMemo(() => payload ? materializeSharedPracticeSafely(payload) : undefined, [payload]);
  const materialized = materialization?.status === "available" ? materialization.value : undefined;
  const document = materialized?.document;
  const [accompanimentState, setAccompanimentState] = useState<{ readonly digest: string; readonly value: Awaited<ReturnType<typeof generateDeterministicAccompaniment>> }>();

  useEffect(() => {
    const refresh = () => setHashState({ ready: true, value: window.location.hash });
    refresh();
    window.addEventListener("hashchange", refresh);
    window.addEventListener("popstate", refresh);
    return () => { window.removeEventListener("hashchange", refresh); window.removeEventListener("popstate", refresh); };
  }, []);

  const locatorResult = useMemo(() => hashState.ready ? resolveShareLocator(token, hashState.value) : undefined, [hashState, token]);

  useEffect(() => {
    if (!locatorResult) return;
    if (locatorResult.status === "invalid") {
      dispatchLoad({ type: "failure", code: locatorResult.code });
      setMessage(locatorResult.code === "SHARE_LOCATOR_CONFLICT" ? "저장형 token과 inline payload를 동시에 사용할 수 없습니다." : "공유 위치 정보가 올바르지 않습니다.");
      return;
    }
    let active = true;
    const { key, locator } = locatorResult;
    dispatchLoad({ type: "begin", key, locator });
    setMessage("공유 payload를 검증하는 중…");
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
    if (payload && materialization?.status === "unavailable") setMessage("이 공유의 연습 자료를 안전하게 구성할 수 없습니다.");
  }, [materialization, payload]);

  useEffect(() => {
    if (!document) return;
    let active = true;
    const digest = document.effectiveChordTimeline.digest;
    void generateDeterministicAccompaniment(document.effectiveChordTimeline).then((value) => { if (active) setAccompanimentState({ digest, value }); });
    return () => { active = false; };
  }, [document]);
  const accompaniment = document && accompanimentState?.digest === document.effectiveChordTimeline.digest ? accompanimentState.value : undefined;

  const abc = useMemo(() => payload && materialized ? arrangementRenderDocumentToAbc(materialized.document, materialized.trackRoles, { title: payload.title, tempo: payload.tempo, key: payload.key }) : undefined, [materialized, payload]);
  const plan = useMemo(() => materialized ? buildPlaybackPlan(materialized.document, materialized.trackRoles, accompaniment) : undefined, [accompaniment, materialized]);

  const report = async () => {
    if (loadState.status !== "loaded" || loadState.locator.kind !== "stored") return;
    const reportKey = loadState.key;
    const reportToken = loadState.locator.token;
    try {
      const bootstrap = await fetch("/api/session", { method: "POST" });
      const session = await bootstrap.json() as { csrfToken?: string };
      if (!bootstrap.ok || !session.csrfToken) throw new Error();
      const response = await fetch(`/api/shares/${encodeURIComponent(reportToken)}/report`, { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": session.csrfToken }, body: JSON.stringify({ category: "rights-or-abuse" }) });
      if (!response.ok) throw new Error();
      dispatchLoad({ type: "reported", key: reportKey }); setMessage("신고를 접수했습니다. 공유 존재 여부에 대한 추가 정보는 공개하지 않습니다.");
    } catch { setMessage("신고를 접수하지 못했습니다."); }
  };

  return <>
    <header><p className="eyebrow">PRACTICE SHARE · READ ONLY</p><h1>{payload?.title ?? "공유 연습 악보"}</h1><p>후보, 잠금, 진단, 원본 파일 없이 선택된 연습 artifact만 표시합니다.</p><p><Link href="/">HarmonyMaker 시작으로</Link></p></header>
    <p className={`status${payload ? "" : " error"}`} aria-live="polite">{message}</p>
    {payload && abc && plan && loadState.status === "loaded" ? <><section className="panel"><dl><div><dt>Preset</dt><dd>{payload.presetId}</dd></div><div><dt>Rights</dt><dd>{payload.rightsShareConfirmed ? "공유 확인됨" : "차단"}</dd></div><div><dt>Artifact</dt><dd><code>{payload.arrangementArtifactDigest}</code></dd></div></dl></section><ProductPracticePlayer key={loadState.key} abc={abc} plan={plan} tempo={payload.tempo} identity={loadState.key} initialSettings={payload.playbackDefaults} readOnly />{loadState.locator.kind === "stored" ? <section className="panel"><h2>공유 신고</h2><button type="button" disabled={loadState.reported} onClick={() => void report()}>{loadState.reported ? "접수됨" : "권리 또는 악용 신고"}</button></section> : null}</> : null}
  </>;
}
