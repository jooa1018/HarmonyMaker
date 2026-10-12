"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectListEntry, WorkerStage } from "../../product/harmony-worker/client";
import { useScreenWorker } from "../_worker/useScreenWorker";
import { WorkerFailure, stageLabel } from "../_worker/presentation";
import { AppBar } from "../_ui/controls";
import { Icon } from "../_ui/Icon";
import { formatSavedDate } from "../_ui/format";

type Row = ProjectListEntry;
export function LibraryClient() {
  const session = useScreenWorker();
  const [stage, setStage] = useState<WorkerStage>("loading");
  const [items, setItems] = useState<readonly Row[]>();
  const [confirming, setConfirming] = useState<string>();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<unknown>();
  const revision = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++revision.current;
    try {
      const rows = await session.run(client => client.listSummaries({ onStage: setStage }));
      if (current === revision.current) { setItems(rows); setError(""); }
    } catch (reason) { if (current === revision.current) setError(reason); }
  }, [session]);
  useEffect(() => {
    const reload = () => { void refresh(); };
    const invalidate = () => { revision.current++; };
    reload(); window.addEventListener("focus", reload);
    return () => { invalidate(); window.removeEventListener("focus", reload); };
  }, [refresh]);
  async function remove(item: Row) {
    if (deleting) return;
    setDeleting(true); setError(undefined);
    try {
      await session.run(client => client.delete(item.projectId, { onStage: setStage }));
      setConfirming(undefined);
      await refresh();
    } catch (reason) { setError(reason); }
    finally { setDeleting(false); }
  }
  return <div className="hm"><div className="hm-page"><AppBar library /><h1 className="hm-title">내 악보</h1><p className="hm-lede">이 기기에 저장한 화음이에요. 다른 기기에서는 보이지 않아요.</p>
    {!items && !error && <p role="status">악보를 불러오는 중…</p>}
    {items?.length ? <ul className="hm-lib">{items.map(item => {
      const title = item.description?.title ?? (item.error ? "열지 못한 악보" : "제목 없는 악보");
      return <li className="hm-lib-item" key={item.projectId}><h2 className="hm-lib-title">{title}</h2>
        <div className="hm-lib-actions"><Link className="hm-btn hm-btn-secondary hm-btn-sm" href={`/result?project=${encodeURIComponent(item.projectId)}`} aria-label={`${title} 열기`}>열기</Link><button className="hm-iconbtn" type="button" aria-label={`${title} 지우기`} onClick={() => setConfirming(item.projectId)}><Icon name="trash" /></button></div>
        <div className="hm-lib-meta"><span className="hm-chips">{item.description?.parts.map((part, index) => <span className="hm-chip" key={index}><span className={`hm-dot ${part.role === "lower" ? "is-alto" : part.role === "upper" ? "is-tenor" : ""}`} />{part.label}</span>)}{item.description?.parts.some(part => part.status === "partial" || part.status === "missing") && <span className="hm-chip is-partial">일부</span>}</span><span>{[formatSavedDate(item.updatedAt, new Date()), item.description?.keyLabelKo, item.description?.meters.join(" · ")].filter(Boolean).join(" · ")}</span></div>
        {item.error && <details className="hm-fold"><summary>자세히</summary><div className="hm-prompt"><pre tabIndex={0}>{item.error.code + "\n" + item.error.messageKo}</pre></div></details>}
        {confirming === item.projectId && <div className="hm-lib-confirm" role="alert"><span>{`"${title}"를 지울까요? 되돌릴 수 없어요.`}</span><div><button className="hm-btn hm-btn-secondary hm-btn-sm" type="button" disabled={deleting} onClick={() => setConfirming(undefined)}>취소</button><button className="hm-btn hm-btn-danger hm-btn-sm" type="button" disabled={deleting} onClick={() => void remove(item)}>지우기</button></div></div>}
      </li>;
    })}</ul> : items && <div className="hm-empty"><span className="hm-empty-icon"><Icon name="music" /></span><b>아직 만든 화음이 없어요</b><p className="hm-small">악보를 올리면 만든 화음이 여기에 쌓여요.</p><Link className="hm-btn hm-btn-primary" href="/">악보 올리기</Link></div>}
    {deleting && <p role="status">{stageLabel(stage, true)}</p>}
    {Boolean(error) && <><WorkerFailure error={error} /><button className="hm-btn hm-btn-secondary" type="button" onClick={() => void refresh()}>다시 시도</button></>}
  </div></div>;
}
