"use client";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { Icon } from "./Icon";
import { formatClock } from "./format";
import { stripAbcTitle, voiceColorVars } from "./score-colors";
import { SOURCES } from "./preview-scores";

export interface PlayerController {
  phase: "ready" | "starting" | "playing" | "paused" | "finished";
  seconds: number;
  totalSeconds: number;
  speed: number;
  solo?: string;
  muted: readonly string[];
  bandEnabled: boolean;
  hasBand?: boolean;
  tracks: readonly { id: string; label: string; role: "lead" | "lower" | "upper" | "other" | "band"; hint?: string }[];
  togglePlay: () => void;
  restart: () => void;
  setSpeed: (value: number) => void;
  toggleSolo: (id: string) => void;
  toggleMute: (id: string) => void;
  toggleBand: () => void;
}
export function usePreviewPlayer(screen: string): PlayerController {
  const shared = screen === "12-shared";
  const desktop = screen === "desktop-result";
  const [phase, setPhase] = useState<PlayerController["phase"]>(shared ? "ready" : desktop ? "paused" : "playing");
  const [seconds, setSeconds] = useState(shared ? 0 : desktop ? 42 : 23);
  const [speed, setSpeedValue] = useState(shared || desktop ? 75 : 100);
  const [solo, setSolo] = useState<string | undefined>(shared ? "upper" : desktop ? undefined : "lower");
  const [muted, setMuted] = useState<string[]>(desktop ? ["upper"] : []);
  const [bandEnabled, setBandEnabled] = useState(!shared);
  // Fixture time deliberately stays still for deterministic visual review. No audio is scheduled.
  return { phase, seconds, totalSeconds: 72, speed, solo, muted, bandEnabled,
    tracks: [{ id: "lead", label: "멜로디", role: "lead" }, { id: "lower", label: "알토", role: "lower" }, { id: "upper", label: "테너", role: "upper" }],
    togglePlay: () => setPhase(value => value === "playing" ? "paused" : "playing"),
    restart: () => { setSeconds(0); setPhase("ready"); },
    setSpeed: value => { setSpeedValue(value); setSeconds(0); setPhase("ready"); },
    toggleSolo: id => setSolo(value => value === id ? undefined : id),
    toggleMute: id => setMuted(value => value.includes(id) ? value.filter(v => v !== id) : [...value, id]),
    toggleBand: () => setBandEnabled(value => !value),
  };
}
function PlayButton({ player }: { player: PlayerController }) {
  return <button className="hm-play" type="button" aria-label={player.phase === "playing" ? "일시정지" : player.phase === "paused" ? "이어서 재생" : "재생"} disabled={player.phase === "starting"} onClick={player.togglePlay}>{player.phase === "starting" ? <span className="hm-spinner" aria-hidden="true" /> : <Icon name={player.phase === "playing" ? "pause" : "play"} className={player.phase === "playing" ? "" : "is-play"} />}</button>;
}
function Progress({ player }: { player: PlayerController }) { return <div className="hm-progress" aria-hidden="true"><i style={{ width: `${Math.min(100, Math.max(0, player.totalSeconds > 0 ? player.seconds / player.totalSeconds * 100 : 0))}%` }} /></div>; }
export function PracticePanel({ player }: { player: PlayerController }) {
  const id = useId();
  const [focused, setFocused] = useState<number>();
  return <section className="hm-player" aria-label="연습 플레이어">
    <div className="hm-transport"><PlayButton player={player} /><div className="hm-timeline"><Progress player={player} /><div className="hm-time" aria-live="off"><span>{formatClock(player.seconds)}{player.phase === "paused" && <> <button className="hm-restart" type="button" onClick={player.restart}>처음으로</button></>}</span><span>{formatClock(player.totalSeconds)}</span></div></div></div>
    <div className="hm-field"><div className="hm-field-label" id={id}>빠르기 <span className="hm-small">· 바꾸면 처음부터 다시 재생해요</span></div><div className="hm-seg" role="radiogroup" aria-labelledby={id}>{[50, 75, 100, 125, 150].map(speed => <label className={`${player.speed === speed ? "is-selected" : ""}${focused === speed ? " is-focused" : ""}`} key={speed}><input type="radio" name={id} value={speed} checked={player.speed === speed} onChange={() => player.setSpeed(speed)} onFocus={() => setFocused(speed)} onBlur={() => setFocused(undefined)} />{speed}%</label>)}</div></div>
    <div className="hm-mixer">{player.tracks.map(track => <div className="hm-mix-row" key={track.id}><div className="hm-mix-name"><span className={`hm-dot is-${track.role === "lead" ? "melody" : track.role === "lower" ? "alto" : track.role === "upper" ? "tenor" : ""}`} /><span><b>{track.label}</b><small>{track.hint ?? (track.role === "lead" ? "원래 악보" : track.role === "lower" ? "멜로디 아래" : "멜로디 위 · 한 옥타브 낮게 들려요")}</small></span></div><button className="hm-toggle is-solo" type="button" aria-pressed={player.solo === track.id} aria-label={`${track.label}만 듣기`} onClick={() => player.toggleSolo(track.id)}>솔로</button><button className="hm-toggle is-mute" type="button" aria-pressed={player.muted.includes(track.id)} aria-label={`${track.label} 끄기`} onClick={() => player.toggleMute(track.id)}>끄기</button></div>)}{player.hasBand !== false && <div className="hm-switch-row"><span><b>코드 반주</b><small>악보의 코드로 반주를 깔아요</small></span><button className="hm-switch" type="button" role="switch" aria-checked={player.bandEnabled} aria-label="코드 반주" onClick={player.toggleBand} /></div>}</div>
  </section>;
}
export function ScoreNotation({ source }: { source: keyof typeof SOURCES }) {
  const host = useRef<HTMLDivElement>(null);
  const abc = SOURCES[source];
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let stopped = false;
    let renderedWidth = 0;
    let observer: ResizeObserver | undefined;
    void import("abcjs").then(({ default: abcjs }) => {
      if (stopped) return;
      const render = () => {
        const width = Math.floor(el.clientWidth);
        if (!width || width === renderedWidth) return;
        const appWidth = el.closest(".hm")?.clientWidth ?? width;
        abcjs.renderAbc(el, stripAbcTitle(abc), { responsive: "resize", staffwidth: Math.max(240, width - 24), add_classes: true, wrap: { minSpacing: 1.8, maxSpacing: 2.7, preferredMeasuresPerLine: appWidth < 480 ? 2 : 4 } });
        renderedWidth = width;
      };
      render(); observer = new ResizeObserver(render); observer.observe(el);
    }).catch(() => { if (!stopped) el.textContent = "악보를 표시하지 못했어요."; });
    return () => { stopped = true; observer?.disconnect(); };
  }, [abc]);
  return <div ref={host} className="hm-score-notation" style={voiceColorVars(abc) as CSSProperties}><p className="hm-score-fallback" role="status">악보를 그리는 중…</p></div>;
}
export function MiniPlayerBar({ player, title = "시냇가에 심은 나무" }: { player: PlayerController; title?: string }) { return <div className="hm-minibar"><PlayButton player={player} /><div className="hm-timeline"><div className="hm-minibar-title">{title}</div><Progress player={player} /></div><span className="hm-time"><span>{formatClock(player.seconds)} / {formatClock(player.totalSeconds)}</span></span></div>; }
