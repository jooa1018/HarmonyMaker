"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { CreateLinkOutcome, CreatedLink } from "../_result/create-share";
import { Icon } from "./Icon";

function failureMessage(code: string, fresh: boolean): string {
  if (code === "SHARE_RIGHTS_REQUIRED") return "공유 권리 확인에 다시 체크한 뒤 공유 링크를 만들어 주세요.";
  if (/^SHARE_[A-Z0-9_]+_UNSUPPORTED$/u.test(code)) return "이 악보는 아직 공유할 수 없어요. 곧 지원할 예정이에요.";
  if (fresh) return "이전 공유가 끝났어요. 새 링크를 만들 수 있어요.";
  return "공유 링크를 만들지 못했어요. 잠시 뒤 다시 시도해 주세요.";
}

export function ShareSheet({ initialCreated = false, standalone = false, onClose, createLink }: { createLink?: (fresh: boolean) => Promise<CreateLinkOutcome>; initialCreated?: boolean; standalone?: boolean; onClose: () => void }) {
  const [rights, setRights] = useState(initialCreated);
  const [created, setCreated] = useState(initialCreated);
  const [link, setLink] = useState<CreatedLink>();
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState(false);
  const [error, setError] = useState<{ code: string; fresh: boolean }>();
  const [attempt, setAttempt] = useState(0);
  const pending = useRef(false);
  const live = useRef(true);
  const [copyLabel, setCopyLabel] = useState("링크 복사");
  const title = useRef<HTMLHeadingElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const id = useId();
  useEffect(() => {
    live.current = true;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    title.current?.focus({ preventScroll: true });
    return () => { live.current = false; document.body.style.overflow = overflow; previous?.focus({ preventScroll: true }); clearTimeout(timer.current); };
  }, []);
  async function copy() {
    try { await navigator.clipboard.writeText(link?.url ?? `${location.origin}/ui-preview/12-shared`); setCopyLabel("복사했어요"); }
    catch { setCopyLabel("복사하지 못했어요"); }
    clearTimeout(timer.current); timer.current = setTimeout(() => setCopyLabel("링크 복사"), 2000);
  }
  async function create() {
    if (!rights || pending.current) return;
    if (!createLink) { setCreated(true); return; }
    pending.current = true; setBusy(true); setError(undefined); setAttempt(value => value + 1);
    const showFailure = (code: string, fresh = false) => {
      setError({ code, fresh });
      if (code === "SHARE_RIGHTS_REQUIRED") setRights(false);
    };
    try {
      const outcome = await createLink(fresh);
      if (!live.current) return;
      if (outcome.status === "created") { setLink(outcome); setCreated(true); setFresh(false); }
      else { setFresh(outcome.status === "fresh"); showFailure(outcome.code, outcome.status === "fresh"); }
    } catch (reason) { if (live.current) showFailure(reason instanceof Error ? reason.message : String(reason)); }
    finally { pending.current = false; if (live.current) setBusy(false); }
  }
  async function send() {
    if (!link?.url || !navigator.share) { await copy(); return; }
    try { await navigator.share({ title: "HarmonyMaker 연습 악보", url: link.url }); }
    catch (reason) { if (!(reason instanceof DOMException && reason.name === "AbortError")) await copy(); }
  }
  const content = <div ref={sheet} className="hm-sheet" role="dialog" aria-modal="true" aria-labelledby={id} style={standalone ? { borderRadius: "16px", boxShadow: "none", paddingBottom: "16px" } : undefined} onKeyDown={e => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    if (e.key !== "Tab") return;
    const elements = [...(sheet.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href], summary, [tabindex="0"]') ?? [])]
      .filter(el => !el.closest("details:not([open])") || el.matches("summary"));
    const first = elements[0], last = elements.at(-1);
    if (e.shiftKey && (document.activeElement === first || document.activeElement === title.current)) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  }}>
    {!standalone && <div className="hm-sheet-grabber" />}
    <div className="hm-sheet-top"><h2 ref={title} className="hm-sheet-title" id={id} tabIndex={-1}>팀원과 공유</h2><button className="hm-iconbtn" type="button" aria-label="닫기" onClick={onClose}><Icon name="x" /></button></div>
    <p className="hm-sheet-text">링크를 받은 팀원은 악보를 보고 자기 파트를 연습할 수 있어요. 고칠 수는 없어요.</p>
    <label className={`hm-check${rights ? " is-checked" : ""}`}><input type="checkbox" checked={rights} disabled={busy || created} onChange={e => setRights(e.target.checked)} /><span className="hm-check-text">이 편곡을 팀원과 공유할 권리가 있음을 확인합니다</span></label>
    {created ? <><p className="hm-ok" role="status"><Icon name="check" />공유 링크를 만들었어요</p><div className="hm-linkbox"><span className="hm-linkbox-text">{link?.url ?? "…/share?token=k3Jd9xQ2mVw7rT1pLa8sZ0"}</span><button className="hm-btn hm-btn-secondary hm-btn-sm" type="button" onClick={copy}><Icon name="copy" /><span aria-live="polite">{copyLabel}</span></button></div><button className="hm-btn hm-btn-primary hm-btn-block" type="button" onClick={() => void send()}><Icon name="chat" />카카오톡 등으로 보내기</button>{!createLink ? <p className="hm-small">이 링크는 2027년 4월 8일까지 열려요.</p> : link?.stored && <p className="hm-small">{link.expiresAt ? `이 링크는 ${new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric" }).format(new Date(link.expiresAt))}까지 열려요.` : "이 링크의 만료일을 확인할 수 없어요."}</p>}</> : <button className="hm-btn hm-btn-primary hm-btn-block" type="button" disabled={!rights || busy} onClick={() => void create()}>{busy ? "공유 링크 만드는 중…" : fresh ? "새 공유 링크 만들기" : "공유 링크 만들기"}</button>}
    {busy && <p className="hm-small" role="status">잠시만 기다려 주세요.</p>}
    {error && <div className="hm-notice is-warn" role="alert"><p>{failureMessage(error.code, error.fresh)}</p><details key={attempt}><summary>자세히</summary><div className="hm-prompt"><pre tabIndex={0}>{error.code}</pre></div></details></div>}
  </div>;
  if (standalone) return content;
  return <div className="hm-sheet-layer"><div className="hm-sheet-scrim" onClick={onClose} />{content}</div>;
}
