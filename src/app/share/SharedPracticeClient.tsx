"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { generateDeterministicAccompaniment } from "../../accompaniment/deterministic";
import type { PracticeSharePayload } from "../../domain/share";
import { ProductPracticePlayer } from "../../product/ProductPracticePlayer";
import { buildPlaybackPlan } from "../../product/playback-plan";
import { arrangementRenderDocumentToAbc } from "../../product/score-adapter";
import { decodeProductUrlShare } from "../../product/share-url";
import { materializeSharedPractice } from "../../product/shared-practice";

export function SharedPracticeClient() {
  const search = useSearchParams();
  const token = search.get("token") ?? undefined;
  const [payload, setPayload] = useState<PracticeSharePayload>();
  const [message, setMessage] = useState("공유 payload를 검증하는 중…");
  const [reported, setReported] = useState(false);
  const materialized = useMemo(() => payload ? materializeSharedPractice(payload) : undefined, [payload]);
  const document = materialized?.document;
  const [accompanimentState, setAccompanimentState] = useState<{ readonly digest: string; readonly value: Awaited<ReturnType<typeof generateDeterministicAccompaniment>> }>();

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const encoded = new URLSearchParams(window.location.hash.slice(1)).get("p");
        if (encoded) {
          const next = decodeProductUrlShare(encoded);
          if (active) { setPayload(next); setMessage("URL PracticeShare v3 검증 완료 · 읽기 전용"); }
          return;
        }
        if (!token) throw new RangeError("SHARE_UNAVAILABLE");
        const response = await fetch(`/api/shares/${encodeURIComponent(token)}`, { method: "GET" });
        const body = await response.json() as { ok: boolean; payload?: PracticeSharePayload };
        if (!response.ok || !body.payload) throw new RangeError("SHARE_UNAVAILABLE");
        if (active) { setPayload(body.payload); setMessage("암호화 ShareStore payload 검증 완료 · 읽기 전용"); }
      } catch { if (active) setMessage("공유를 열 수 없습니다."); }
    };
    void load();
    return () => { active = false; };
  }, [token]);

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
    if (!token) return;
    try {
      const bootstrap = await fetch("/api/session", { method: "POST" });
      const session = await bootstrap.json() as { csrfToken?: string };
      if (!bootstrap.ok || !session.csrfToken) throw new Error();
      const response = await fetch(`/api/shares/${encodeURIComponent(token)}/report`, { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": session.csrfToken }, body: JSON.stringify({ category: "rights-or-abuse" }) });
      if (!response.ok) throw new Error();
      setReported(true); setMessage("신고를 접수했습니다. 공유 존재 여부에 대한 추가 정보는 공개하지 않습니다.");
    } catch { setMessage("신고를 접수하지 못했습니다."); }
  };

  return <>
    <header><p className="eyebrow">PRACTICE SHARE v3 · READ ONLY</p><h1>{payload?.title ?? "공유 연습 악보"}</h1><p>후보, 잠금, 진단, 원본 파일 없이 선택된 연습 artifact만 표시합니다.</p><p><Link href="/">HarmonyMaker 시작으로</Link></p></header>
    <p className={`status${payload ? "" : " error"}`} aria-live="polite">{message}</p>
    {payload && abc && plan ? <><section className="panel"><dl><div><dt>Preset</dt><dd>{payload.presetId}</dd></div><div><dt>Rights</dt><dd>{payload.rightsShareConfirmed ? "공유 확인됨" : "차단"}</dd></div><div><dt>Artifact</dt><dd><code>{payload.arrangementArtifactDigest}</code></dd></div></dl></section><ProductPracticePlayer key={payload.arrangementArtifactDigest} abc={abc} plan={plan} tempo={payload.tempo} identity={payload.arrangementArtifactDigest} readOnly />{token ? <section className="panel"><h2>공유 신고</h2><button type="button" disabled={reported} onClick={() => void report()}>{reported ? "접수됨" : "권리 또는 악용 신고"}</button></section> : null}</> : null}
  </>;
}
