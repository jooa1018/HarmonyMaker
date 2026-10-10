"use client";
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { PRACTICE_SPEEDS } from "../../product/playback-plan";
import { Icon } from "./Icon";
import { audioChoices, audioDuration, audioFileName, audioSize, canShareAudio, initialAudioSettings, renderSilentPreview, type AudioPlayer, type AudioRenderer, type AudioResult } from "./audio-export";

const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

export function AudioSheet({ title, player, onClose, renderAudio = renderSilentPreview, standalone = false, initialResult, previewMaking = false }: {
  title: string; player: AudioPlayer; onClose: () => void; renderAudio?: AudioRenderer;
  /** Deterministic review fixtures only. */
  standalone?: boolean; initialResult?: AudioResult; previewMaking?: boolean;
}) {
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady);
  const [snapshot] = useState(() => ({ choices: audioChoices(player.tracks), secondsAt100: player.totalSeconds * player.speed / 100, hasBand: player.hasBand !== false }));
  const [settings, setSettings] = useState(() => initialAudioSettings(player));
  const [phase, setPhase] = useState<"options" | "making" | "done">(initialResult ? "done" : previewMaking ? "making" : "options");
  const [result, setResult] = useState(initialResult);
  const [error, setError] = useState("");
  const [focused, setFocused] = useState<number>();
  const controller = useRef<AbortController | undefined>(undefined);
  const live = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null), sheet = useRef<HTMLDivElement>(null);
  const urls = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const id = useId(), mixId = `${id}-mix`, speedId = `${id}-speed`;
  const selected = settings.mix.kind === "emphasize" ? settings.mix.trackId : "";
  const label = snapshot.choices.find(choice => choice.id === selected)?.label ?? "전체";
  const file = useMemo(() => result ? new File([result.blob], audioFileName(title, label, settings.speed), { type: "audio/wav" }) : undefined, [result, title, label, settings.speed]);
  const shareAvailable = useSyncExternalStore(subscribe, () => canShareAudio(file), serverReady);
  useEffect(() => {
    if (!ready) return;
    live.current = true;
    const previous = document.activeElement as HTMLElement | null;
    const background = !standalone ? previous?.closest<HTMLElement>(".hm-page") : null;
    const wasInert = background?.inert, hidden = background?.getAttribute("aria-hidden");
    const overflow = document.body.style.overflow;
    if (!standalone) document.body.style.overflow = "hidden";
    if (background) { background.inert = true; background.setAttribute("aria-hidden", "true"); }
    heading.current?.focus({ preventScroll: true });
    const downloads = urls.current;
    return () => {
      live.current = false; controller.current?.abort();
      if (!standalone) document.body.style.overflow = overflow;
      if (background) { background.inert = wasInert ?? false; if (hidden == null) background.removeAttribute("aria-hidden"); else background.setAttribute("aria-hidden", hidden); }
      for (const [url, timer] of downloads) { clearTimeout(timer); URL.revokeObjectURL(url); } downloads.clear();
      previous?.focus({ preventScroll: true });
    };
  }, [ready, standalone]);
  useEffect(() => { if (ready) heading.current?.focus({ preventScroll: true }); }, [phase, ready]);
  function close() { controller.current?.abort(); onClose(); }
  function cancel() { controller.current?.abort(); controller.current = undefined; setPhase("options"); }
  async function make() {
    if (controller.current) return;
    const work = new AbortController(); controller.current = work; setError(""); setPhase("making");
    try {
      const rendered = await renderAudio({ ...settings, signal: work.signal });
      if (!live.current || controller.current !== work || work.signal.aborted) return;
      setResult(rendered); setPhase("done");
    } catch (reason) {
      if (!live.current || controller.current !== work || work.signal.aborted) return;
      setError(reason instanceof Error ? reason.message : String(reason)); setPhase("options");
    } finally { if (controller.current === work) controller.current = undefined; }
  }
  function save() {
    if (!file) return;
    const url = URL.createObjectURL(file), anchor = document.createElement("a");
    anchor.href = url; anchor.download = file.name; document.body.append(anchor); anchor.click(); anchor.remove();
    urls.current.set(url, setTimeout(() => { URL.revokeObjectURL(url); urls.current.delete(url); }, 60_000));
  }
  async function send() {
    if (!file || !canShareAudio(file)) return;
    try { await navigator.share({ files: [file], title }); }
    catch (reason) { if (live.current && !(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : String(reason)); }
  }
  const content = <div ref={sheet} className="hm-sheet" role="dialog" aria-modal="true" aria-labelledby={id} style={standalone ? { borderRadius: "16px", boxShadow: "none", paddingBottom: "16px" } : undefined} onKeyDown={event => {
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key !== "Tab") return;
    const elements = [...(sheet.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), summary, [tabindex="0"]') ?? [])].filter(el => !el.closest("details:not([open])") || el.matches("summary"));
    if (event.shiftKey && (document.activeElement === elements[0] || document.activeElement === heading.current)) { event.preventDefault(); elements.at(-1)?.focus(); }
    else if (!event.shiftKey && document.activeElement === elements.at(-1)) { event.preventDefault(); elements[0]?.focus(); }
  }}>
    {!standalone && <div className="hm-sheet-grabber" />}
    <div className="hm-sheet-top"><h2 ref={heading} className="hm-sheet-title" id={id} tabIndex={-1}>연습 음원 받기</h2><button className="hm-iconbtn" type="button" aria-label="닫기" onClick={close}><Icon name="x" /></button></div>
    {phase === "options" && <>
      <p className="hm-sheet-text">한 파트를 크게 들리게 만든 음원 파일이에요. 카카오톡으로 팀원에게 보낼 수 있어요.</p>
      <div className="hm-field"><div className="hm-field-label" id={mixId}>어떤 음원을 만들까요?</div><div className="hm-choices" role="radiogroup" aria-labelledby={mixId}>{snapshot.choices.map(choice => <label className={`hm-choice${selected === choice.id ? " is-selected" : ""}`} key={choice.id}>
        <input type="radio" name={mixId} checked={selected === choice.id} onChange={() => setSettings(value => ({ ...value, mix: choice.id ? { kind: "emphasize", trackId: choice.id } : { kind: "full" } }))} />
        <span><b>{choice.id && <span className={`hm-dot ${choice.role === "lower" ? "is-alto" : choice.role === "upper" ? "is-tenor" : choice.role === "lead" ? "is-melody" : ""}`} />}{choice.label}</b><small>{choice.description}</small></span>
      </label>)}</div></div>
      <div className="hm-field"><div className="hm-field-label" id={speedId}>빠르기</div><div className="hm-seg" role="radiogroup" aria-labelledby={speedId}>{PRACTICE_SPEEDS.map(speed => <label className={`${settings.speed === speed ? "is-selected" : ""}${focused === speed ? " is-focused" : ""}`} key={speed}><input type="radio" name={speedId} checked={settings.speed === speed} onChange={() => setSettings(value => ({ ...value, speed }))} onFocus={() => setFocused(speed)} onBlur={() => setFocused(undefined)} />{speed}%</label>)}</div></div>
      {snapshot.hasBand && <div className="hm-switch-row"><span><b>코드 반주 넣기</b><small>악보의 코드로 반주를 깔아요</small></span><button className="hm-switch" type="button" role="switch" aria-checked={settings.bandEnabled} aria-label="코드 반주 넣기" onClick={() => setSettings(value => ({ ...value, bandEnabled: !value.bandEnabled }))} /></div>}
      <button className="hm-btn hm-btn-primary hm-btn-block" type="button" onClick={() => void make()}><Icon name="headphones" />음원 만들기</button>
      <p className="hm-small">이 기기에서 만들어요. 서버로 보내지 않아요.</p>
    </>}
    {phase === "making" && <><div className="hm-reading" role="status" aria-live="polite"><span className="hm-spinner" aria-hidden="true" /><b>음원 만드는 중…</b><span className="hm-small">{label} · {settings.speed}% · {audioDuration(snapshot.secondsAt100 * 100 / settings.speed)} 분량</span></div><button className="hm-btn hm-btn-text" type="button" onClick={cancel}>취소</button></>}
    {phase === "done" && result && file && <>
      <p className="hm-ok" role="status"><Icon name="check" />음원을 만들었어요</p>
      <div className="hm-filecard"><span className="hm-linkcard-icon"><Icon name="headphones" /></span><span><b>{file.name}</b><small>{audioDuration(result.seconds)} · {audioSize(result.seconds)}</small></span></div>
      {shareAvailable && <button className="hm-btn hm-btn-primary hm-btn-block" type="button" onClick={() => void send()}><Icon name="chat" />카카오톡 등으로 보내기</button>}
      <button className="hm-btn hm-btn-secondary hm-btn-block" type="button" onClick={save}><Icon name="download" />파일로 저장</button>
      <p className="hm-small">카카오톡 안에서 저장이 안 되면 오른쪽 위 메뉴에서 다른 브라우저로 열어 받아 주세요.</p>
    </>}
    {error && <div className="hm-notice is-stop" role="alert"><p>예상하지 못한 문제가 생겼어요. 다시 시도해 주세요.</p><details><summary>자세히</summary><div className="hm-prompt"><pre tabIndex={0}>{error}</pre></div></details></div>}
  </div>;
  if (standalone) return content;
  return ready ? createPortal(<div className="hm"><div className="hm-sheet-layer"><div className="hm-sheet-scrim" onClick={close} />{content}</div></div>, document.body) : null;
}
