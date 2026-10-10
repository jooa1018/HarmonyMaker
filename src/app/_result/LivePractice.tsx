"use client";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { PracticeSettings } from "../../domain/share";
import type { ProjectPracticeView } from "../../product/project-view";
import { usePracticePlayer } from "../../product/use-practice-player";
import { PracticePanel, MiniPlayerBar, type PlayerController } from "../_ui/practice";
import { stripAbcTitle, voiceColorVars } from "../_ui/score-colors";

export function LivePractice({ view, title, actions, initialSettings, voiceRoles }: {
  view: Extract<ProjectPracticeView, { status: "available" }>;
  title: string;
  actions?: ReactNode;
  initialSettings?: PracticeSettings;
  voiceRoles?: Readonly<Record<string, string>>;
}) {
  const [measures, setMeasures] = useState(2);
  const [mini, setMini] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const { scoreRef, ...player } = usePracticePlayer({ ...view, abc: stripAbcTitle(view.abc), preferredMeasuresPerLine: measures, initialSettings });
  useEffect(() => {
    const app = scoreRef.current?.closest(".hm");
    if (!app) return;
    const observer = new ResizeObserver(entries => setMeasures(entries[0].contentRect.width < 480 ? 2 : 4));
    observer.observe(app); return () => observer.disconnect();
  }, [scoreRef]);
  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => {
      const narrow = (el.closest(".hm")?.clientWidth ?? 1280) < 720;
      setMini(narrow && !entry.isIntersecting && entry.boundingClientRect.bottom < 0);
    });
    observer.observe(el); return () => observer.disconnect();
  }, []);
  const controls: PlayerController = {
    phase: player.phase, seconds: player.positionQuarter * player.secondsPerQuarter, totalSeconds: player.totalQuarter * player.secondsPerQuarter,
    speed: player.speed, solo: player.solo, muted: [...player.muted], bandEnabled: player.bandEnabled,
    hasBand: player.tracks.some(track => track.kind === "band"), tracks: player.tracks.filter(track => track.kind === "voice").map(track => ({ ...track, hint: track.role === "lead" ? "원래 악보" : track.role === "lower" ? "멜로디 아래" : track.role === "upper" ? (view.abc.includes("clef=treble-8") ? "멜로디 위 · 한 옥타브 낮게 들려요" : "멜로디 위") : "저장된 파트" })),
    togglePlay: () => player.phase === "playing" ? player.pause() : player.play(), restart: player.restart,
    setSpeed: value => { if (value === 50 || value === 75 || value === 100 || value === 125 || value === 150) player.setSpeed(value); },
    toggleSolo: player.toggleSolo, toggleMute: player.toggleMute, toggleBand: () => player.setBandEnabled(!player.bandEnabled),
  };
  return <>
    <div className="hm-result-side">{actions}<div ref={panel}><PracticePanel player={controls} /></div></div>
    <section className="hm-score" aria-label="악보"><div className="hm-score-head"><b>악보</b><span className="hm-small">한 줄에 {measures}마디</span></div>
      {!player.scoreReady && <p className="hm-score-fallback" role="status">악보를 그리는 중…</p>}
      <div ref={scoreRef} className="hm-score-notation" style={voiceColorVars(view.abc, voiceRoles) as CSSProperties} />
      {view.abc.includes("clef=treble-8") && <p className="hm-score-legend">테너 보표의 &apos;8&apos;은 적힌 음보다 한 옥타브 낮게 부른다는 뜻이에요.</p>}
    </section>
    {player.error && <div className="hm-notice is-stop" role="alert"><p>예상하지 못한 문제가 생겼어요. 다시 시도해 주세요.</p><details><summary>자세히</summary>{player.error}</details></div>}
    {mini && <MiniPlayerBar player={controls} title={title} />}
  </>;
}
