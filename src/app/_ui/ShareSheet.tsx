"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "./Icon";

export function ShareSheet({ initialCreated = false, standalone = false, onClose }: { initialCreated?: boolean; standalone?: boolean; onClose: () => void }) {
  const [rights, setRights] = useState(initialCreated);
  const [created, setCreated] = useState(initialCreated);
  const [copyLabel, setCopyLabel] = useState("링크 복사");
  const title = useRef<HTMLHeadingElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const id = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    title.current?.focus({ preventScroll: true });
    return () => { document.body.style.overflow = overflow; previous?.focus({ preventScroll: true }); clearTimeout(timer.current); };
  }, []);
  async function copy() {
    try { await navigator.clipboard.writeText(`${location.origin}/ui-preview/12-shared`); setCopyLabel("복사했어요"); }
    catch { setCopyLabel("복사하지 못했어요"); }
    clearTimeout(timer.current); timer.current = setTimeout(() => setCopyLabel("링크 복사"), 2000);
  }
  const content = <div ref={sheet} className="hm-sheet" role="dialog" aria-modal="true" aria-labelledby={id} style={standalone ? { borderRadius: "16px", boxShadow: "none", paddingBottom: "16px" } : undefined} onKeyDown={e => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    if (e.key !== "Tab") return;
    const elements = [...(sheet.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href]') ?? [])];
    const first = elements[0], last = elements.at(-1);
    if (e.shiftKey && (document.activeElement === first || document.activeElement === title.current)) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  }}>
    {!standalone && <div className="hm-sheet-grabber" />}
    <div className="hm-sheet-top"><h2 ref={title} className="hm-sheet-title" id={id} tabIndex={-1}>팀원과 공유</h2><button className="hm-iconbtn" type="button" aria-label="닫기" onClick={onClose}><Icon name="x" /></button></div>
    <p className="hm-sheet-text">링크를 받은 팀원은 악보를 보고 자기 파트를 연습할 수 있어요. 고칠 수는 없어요.</p>
    <label className={`hm-check${rights ? " is-checked" : ""}`}><input type="checkbox" checked={rights} onChange={e => setRights(e.target.checked)} /><span className="hm-check-text">이 편곡을 팀원과 공유할 권리가 있음을 확인합니다</span></label>
    {created ? <><p className="hm-ok" role="status"><Icon name="check" />공유 링크를 만들었어요</p><div className="hm-linkbox"><span className="hm-linkbox-text">…/share?token=k3Jd9xQ2mVw7rT1pLa8sZ0</span><button className="hm-btn hm-btn-secondary hm-btn-sm" type="button" onClick={copy}><Icon name="copy" /><span aria-live="polite">{copyLabel}</span></button></div><button className="hm-btn hm-btn-primary hm-btn-block" type="button" onClick={copy}><Icon name="chat" />카카오톡 등으로 보내기</button><p className="hm-small">이 링크는 2027년 4월 8일까지 열려요.</p></> : <button className="hm-btn hm-btn-primary hm-btn-block" type="button" disabled={!rights} onClick={() => setCreated(true)}>공유 링크 만들기</button>}
  </div>;
  if (standalone) return content;
  return <div className="hm-sheet-layer"><div className="hm-sheet-scrim" onClick={onClose} />{content}</div>;
}
