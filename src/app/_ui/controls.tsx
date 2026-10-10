"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BrandMark } from "./BrandMark";
import { DropArtwork } from "./DropArtwork";
import { Icon } from "./Icon";
import { ctaLabel, type PartChoice } from "./format";
import { GUIDE_PROMPT } from "./guide-prompt";

export function AppBar({ shared = false, library = false, currentLibrary = false }: { shared?: boolean; library?: boolean; currentLibrary?: boolean }) {
  return <header className="hm-appbar"><Link className="hm-brand" href="/"><BrandMark />HarmonyMaker</Link>{shared ? <span className="hm-viewonly"><Icon name="eye" style={{ width: "15px", height: "15px" }} />보기 전용</span> : <nav className="hm-nav" aria-label="주 메뉴">{library ? <Link href="/">새 악보</Link> : <><Link className="hm-nav-wide" href="/">새 악보</Link><Link href="/library" aria-current={currentLibrary ? "page" : undefined}>내 악보</Link><Link className="hm-nav-wide" href="/guide">사용 안내</Link></>}</nav>}</header>;
}
const PARTS = [
  { value: "alto", label: "알토", description: "멜로디 아래에서 받쳐 주는 화음" },
  { value: "tenor", label: "테너", description: "멜로디 위에서 감싸는 화음 · 남성은 한 옥타브 낮게 불러요" },
  { value: "both", label: "둘 다", description: "멜로디 + 알토 + 테너 3성부" },
] as const;
export function PartPicker({ value, onChange, recommended }: { value?: PartChoice; onChange: (value: PartChoice) => void; recommended?: "alto" | "tenor" }) {
  const [focused, setFocused] = useState<PartChoice>();
  return <div className="hm-parts" role="radiogroup" aria-label="화음 파트">{PARTS.map(part => <label key={part.value} className={`hm-part${value === part.value ? " is-selected" : ""}${focused === part.value ? " is-focused" : ""}`}>
    <input type="radio" name="harmony-part" value={part.value} checked={value === part.value} onChange={() => onChange(part.value)} onFocus={() => setFocused(part.value)} onBlur={() => setFocused(undefined)} />
    <svg className="hm-part-diagram" viewBox="0 0 52 52" aria-hidden="true"><rect className={part.value === "alto" ? "off" : "t"} x="4" y="10" width="44" height="7" rx="3.5" /><rect className="m" x="4" y="22.5" width="44" height="7" rx="3.5" /><rect className={part.value === "tenor" ? "off" : "a"} x="4" y="35" width="44" height="7" rx="3.5" /></svg>
    <span className="hm-part-body"><span className="hm-part-name">{part.label}{recommended === part.value && <> <span className="hm-badge">추천</span></>}</span><span className="hm-part-desc">{part.description}</span></span>
    <span className="hm-part-tick"><Icon name="check" /></span>
  </label>)}</div>;
}
export function CtaBar({ choice, checked, onCheck, onGenerate, compact = false }: { choice?: PartChoice; checked: boolean; onCheck: (value: boolean) => void; onGenerate: () => void; compact?: boolean }) {
  return <div className="hm-cta"><label className={`hm-check${checked ? " is-checked" : ""}`}><input type="checkbox" checked={checked} onChange={e => onCheck(e.target.checked)} /><span className="hm-check-text">이 악보로 화음을 만들 권리가 있음을 확인합니다.{!compact && <small>직접 만든 곡, 저작권이 끝난 곡, 사용 허락을 받은 곡이면 괜찮아요.</small>}</span></label><button className="hm-btn hm-btn-primary hm-btn-block" type="button" disabled={!checked || !choice} onClick={onGenerate}>{ctaLabel(choice)}</button>{!checked && <p className="hm-cta-help">권리 확인에 체크하면 만들 수 있어요.</p>}</div>;
}
export function FileDrop({ state = "ready", fileName = "sinaetga.musicxml", onFile }: { state?: "ready" | "reading" | "dragover"; fileName?: string; onFile: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(false);
  const [wide, setWide] = useState(false);
  useEffect(() => { const el = host.current?.closest(".hm"); if (!el) return; const observer = new ResizeObserver(entries => setWide(entries[0].contentRect.width >= 720)); observer.observe(el); return () => observer.disconnect(); }, []);
  const dragging = state === "dragover" || drag;
  return <div ref={host} className={`hm-drop${dragging ? " is-dragover" : ""}`} role={state === "reading" ? "status" : undefined} aria-live="polite" onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrag(false); }} onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]); }}>
    {state === "reading" ? <div className="hm-reading"><span className="hm-spinner" aria-hidden="true" /><b>악보 읽는 중…</b><span className="hm-drop-formats">{fileName}</span></div> : <><DropArtwork /><p className="hm-drop-hint">{dragging ? "여기에 놓으세요" : wide ? "파일을 여기로 끌어다 놓거나" : "휴대폰에 저장된 악보 파일을 골라 주세요"}</p>{!dragging && <><input ref={input} className="hm-sr-only" type="file" aria-label="MusicXML 악보 파일" onChange={e => { const file = e.target.files?.[0]; if (file) onFile(file); e.target.value = ""; }} /><button className="hm-btn hm-btn-primary" type="button" onClick={() => input.current?.click()}>파일 고르기</button><p className="hm-drop-formats">.musicxml · .mxl · .xml</p></>}</>}
  </div>;
}
export function LeadQuestionChoices() {
  const [choice, setChoice] = useState(0);
  return <div className="hm-choices" role="radiogroup" aria-label="멜로디 성부">{["Voice · 보표 1 · 성부 1 · 음표 182개", "Voice · 보표 1 · 성부 2 · 음표 64개"].map((label, index) => <label className={`hm-choice${choice === index ? " is-selected" : ""}`} key={label}><input type="radio" name="melody-voice" checked={choice === index} onChange={() => setChoice(index)} />{label}</label>)}</div>;
}
export function CopyPromptButton() {
  const [message, setMessage] = useState("지침 복사");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    try { await navigator.clipboard.writeText(GUIDE_PROMPT); setMessage("복사했어요"); }
    catch { const el = document.getElementById("prompt-text"); if (el) { const range = document.createRange(); range.selectNodeContents(el); const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); setMessage("선택했어요"); } else setMessage("복사하지 못했어요"); }
    clearTimeout(timer.current); timer.current = setTimeout(() => setMessage("지침 복사"), 2000);
  }
  return <button className="hm-btn hm-btn-secondary hm-btn-sm" type="button" onClick={copy}><Icon name="copy" /><span aria-live="polite">{message}</span></button>;
}
const LIBRARY = [
  { title: "시냇가에 심은 나무", parts: ["alto", "tenor"], meta: "10월 10일 · G장조 · 4/4" },
  { title: "주의 길을 걸어요", parts: ["alto"], meta: "10월 8일 · D장조 · 3/4" },
  { title: "아침 기도", parts: ["tenor"], meta: "10월 2일 · E단조 · 12/8", partial: true },
];
export function LibraryList() {
  const [items, setItems] = useState(LIBRARY);
  const [confirming, setConfirming] = useState<string | undefined>("아침 기도");
  return items.length ? <ul className="hm-lib">{items.map(item => <li className="hm-lib-item" key={item.title}><h2 className="hm-lib-title">{item.title}</h2><div className="hm-lib-actions"><Link className="hm-btn hm-btn-secondary hm-btn-sm" href="/result">열기</Link><button className="hm-iconbtn" type="button" aria-label={`${item.title} 지우기`} onClick={() => setConfirming(item.title)}><Icon name="trash" /></button></div><div className="hm-lib-meta"><span className="hm-chips">{item.parts.map(part => <span className="hm-chip" key={part}><span className={`hm-dot is-${part}`} />{part === "alto" ? "알토" : "테너"}</span>)}{item.partial && <span className="hm-chip is-partial">일부</span>}</span><span>{item.meta}</span></div>{confirming === item.title && <div className="hm-lib-confirm" role="alert"><span>{`"${item.title}"를 지울까요? 되돌릴 수 없어요.`}</span><div><button className="hm-btn hm-btn-secondary hm-btn-sm" type="button" onClick={() => setConfirming(undefined)}>취소</button><button className="hm-btn hm-btn-danger hm-btn-sm" type="button" onClick={() => { setItems(items.filter(i => i.title !== item.title)); setConfirming(undefined); }}>지우기</button></div></div>}</li>)}</ul> : <div className="hm-empty"><span className="hm-empty-icon"><Icon name="music" /></span><b>아직 만든 화음이 없어요</b><p className="hm-small">악보를 올리면 만든 화음이 여기에 쌓여요.</p><Link className="hm-btn hm-btn-primary" href="/">악보 올리기</Link></div>;
}

export function NotesFold({ notes }: { notes: readonly { messageKo: string }[] }) {
  if (!notes.length) return null;
  return <details className="hm-notes"><summary><Icon name="right" />참고 {notes.length}개</summary><ul>{notes.map((note, index) => <li key={index}>{note.messageKo}</li>)}</ul></details>;
}
