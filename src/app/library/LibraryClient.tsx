"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { IndexedDbProjectStore } from "../../product/local-project-store";
import { describeHarmonyProject, type HarmonyProjectDescription } from "../../product/project-view";
import { AppBar } from "../_ui/controls";
import { Icon } from "../_ui/Icon";
import { formatSavedDate } from "../_ui/format";

interface Row { projectId: string; updatedAt: string; description?: HarmonyProjectDescription; error?: string }
export function LibraryClient() {
  const [items, setItems] = useState<readonly Row[]>();
  const [confirming, setConfirming] = useState<string>();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const revision = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++revision.current;
    try {
      const store = new IndexedDbProjectStore();
      const rows: Row[] = [];
      // Release each full project before reading the next large workspace proof.
      for (const metadata of await store.list()) {
        if (current !== revision.current) return;
        try { const record = await store.load(metadata.projectId); if (record) rows.push({ ...metadata, updatedAt: record.updatedAt, description: describeHarmonyProject(record.project) }); }
        catch (reason) { rows.push({ ...metadata, error: reason instanceof Error ? reason.message : String(reason) }); }
      }
      if (current === revision.current) { setItems(rows); setError(""); }
    } catch (reason) { if (current === revision.current) setError(reason instanceof Error ? reason.message : String(reason)); }
  }, []);
  useEffect(() => {
    const reload = () => { void refresh(); };
    const invalidate = () => { revision.current++; };
    reload(); window.addEventListener("focus", reload);
    return () => { invalidate(); window.removeEventListener("focus", reload); };
  }, [refresh]);
  async function remove(item: Row) {
    if (deleting) return;
    setDeleting(true); setNotice("");
    try {
      const removed = await new IndexedDbProjectStore().deleteIfCurrent(item.projectId, item.updatedAt);
      setConfirming(undefined);
      if (!removed) setNotice("다른 창에서 바뀐 악보예요. 목록을 다시 확인해 주세요.");
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setDeleting(false); }
  }
  return <div className="hm"><div className="hm-page"><AppBar library /><h1 className="hm-title">내 악보</h1><p className="hm-lede">이 기기에 저장한 화음이에요. 다른 기기에서는 보이지 않아요.</p>
    {!items && !error && <p role="status">악보를 불러오는 중…</p>}
    {items?.length ? <ul className="hm-lib">{items.map(item => {
      const title = item.description?.title ?? (item.error ? "열지 못한 악보" : "제목 없는 악보");
      return <li className="hm-lib-item" key={item.projectId}><h2 className="hm-lib-title">{title}</h2>
        <div className="hm-lib-actions"><Link className="hm-btn hm-btn-secondary hm-btn-sm" href={`/result?project=${encodeURIComponent(item.projectId)}`} aria-label={`${title} 열기`}>열기</Link><button className="hm-iconbtn" type="button" aria-label={`${title} 지우기`} onClick={() => setConfirming(item.projectId)}><Icon name="trash" /></button></div>
        <div className="hm-lib-meta"><span className="hm-chips">{item.description?.parts.map((part, index) => <span className="hm-chip" key={index}><span className={`hm-dot ${part.role === "lower" ? "is-alto" : part.role === "upper" ? "is-tenor" : ""}`} />{part.label}</span>)}{item.description?.parts.some(part => part.status === "partial" || part.status === "missing") && <span className="hm-chip is-partial">일부</span>}</span><span>{[formatSavedDate(item.updatedAt, new Date()), item.description?.keyLabelKo, item.description?.meters.join(" · ")].filter(Boolean).join(" · ")}</span></div>
        {item.error && <details className="hm-fold"><summary>자세히</summary><div className="hm-prompt"><pre tabIndex={0}>{item.error}</pre></div></details>}
        {confirming === item.projectId && <div className="hm-lib-confirm" role="alert"><span>{`"${title}"를 지울까요? 되돌릴 수 없어요.`}</span><div><button className="hm-btn hm-btn-secondary hm-btn-sm" type="button" disabled={deleting} onClick={() => setConfirming(undefined)}>취소</button><button className="hm-btn hm-btn-danger hm-btn-sm" type="button" disabled={deleting} onClick={() => void remove(item)}>지우기</button></div></div>}
      </li>;
    })}</ul> : items && <div className="hm-empty"><span className="hm-empty-icon"><Icon name="music" /></span><b>아직 만든 화음이 없어요</b><p className="hm-small">악보를 올리면 만든 화음이 여기에 쌓여요.</p><Link className="hm-btn hm-btn-primary" href="/">악보 올리기</Link></div>}
    {notice && <p role="status">{notice}</p>}
    {error && <div className="hm-notice is-stop" role="alert"><p>악보를 불러오지 못했어요. 다시 시도해 주세요.</p><button className="hm-btn hm-btn-secondary" type="button" onClick={() => void refresh()}>다시 시도</button><details><summary>자세히</summary><div className="hm-prompt"><pre tabIndex={0}>{error}</pre></div></details></div>}
  </div></div>;
}
