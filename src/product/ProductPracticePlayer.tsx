"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TempoSpec } from "../domain/source/model";
import { audibleTrackIds, PRACTICE_SPEEDS, quarterSeconds, type PlaybackPlan, type PracticeSpeed } from "./playback-plan";

export interface OwnedAudioSession {
  readonly context: Pick<AudioContext, "close">;
  readonly nodes: readonly Pick<OscillatorNode, "stop">[];
  disposed: boolean;
}

interface ActiveAudio extends OwnedAudioSession {
  readonly context: AudioContext;
  readonly nodes: readonly OscillatorNode[];
  readonly startedAt: number;
  readonly positionQuarter: number;
}

export function disposeOwnedAudioSession(session: OwnedAudioSession | undefined): void {
  if (!session || session.disposed) return;
  session.disposed = true;
  for (const node of session.nodes) {
    try { node.stop(); } catch { /* already stopped */ }
  }
  void session.context.close().catch(() => undefined);
}

export function ProductPracticePlayer({ abc, plan, tempo, identity, readOnly = false }: {
  readonly abc: string;
  readonly plan: PlaybackPlan;
  readonly tempo: TempoSpec;
  readonly identity: string;
  readonly readOnly?: boolean;
}) {
  const scoreRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<ActiveAudio | undefined>(undefined);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const [scoreReadyIdentity, setScoreReadyIdentity] = useState<string>();
  const [phase, setPhase] = useState<"ready" | "playing" | "paused" | "finished">("ready");
  const [positionQuarter, setPositionQuarter] = useState(0);
  const [cursorEventId, setCursorEventId] = useState<string>();
  const [speed, setSpeed] = useState<PracticeSpeed>(100);
  const [muted, setMuted] = useState<ReadonlySet<string>>(new Set());
  const [solo, setSolo] = useState<string>();
  const [bandEnabled, setBandEnabled] = useState(true);
  const [error, setError] = useState<string>();

  const audible = useMemo(() => new Set(audibleTrackIds(plan, { muted, ...(solo ? { solo } : {}), bandEnabled })), [bandEnabled, muted, plan, solo]);

  const stopNodes = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = undefined;
    const active = activeRef.current;
    activeRef.current = undefined;
    disposeOwnedAudioSession(active);
  }, []);

  const reset = useCallback(() => {
    stopNodes();
    setPhase("ready");
    setPositionQuarter(0);
    setCursorEventId(undefined);
    setError(undefined);
  }, [stopNodes]);

  useEffect(() => {
    let disposed = false;
    void import("abcjs").then(({ default: abcjs }) => {
      if (disposed || !scoreRef.current) return;
      scoreRef.current.replaceChildren();
      abcjs.renderAbc(scoreRef.current, abc, { responsive: "resize", staffwidth: Math.max(680, scoreRef.current.clientWidth - 24), add_classes: true });
      setScoreReadyIdentity(identity);
    }).catch(() => setError("악보를 표시하지 못했습니다."));
    return () => { disposed = true; };
  }, [abc, identity]);

  useEffect(() => () => {
    stopNodes();
  }, [stopNodes]);

  const scoreReady = scoreReadyIdentity === identity;

  const begin = async (fromQuarter: number) => {
    stopNodes();
    setError(undefined);
    try {
      const AudioContextConstructor = window.AudioContext;
      const context = new AudioContextConstructor();
      const secondsPerQuarter = quarterSeconds(tempo, speed);
      const startedAt = context.currentTime + 0.05;
      const nodes: OscillatorNode[] = [];
      activeRef.current = { context, nodes, startedAt, positionQuarter: fromQuarter, disposed: false };
      await context.resume();
      for (const event of plan.events) {
        if (!audible.has(event.trackId) || event.startQuarter + event.durationQuarter <= fromQuarter) continue;
        const startQuarter = Math.max(event.startQuarter, fromQuarter);
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = event.kind === "band" ? "triangle" : "sine";
        oscillator.frequency.value = 440 * 2 ** ((event.midi - 69) / 12);
        gain.gain.value = event.kind === "band" ? 0.018 : 0.028;
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(startedAt + (startQuarter - fromQuarter) * secondsPerQuarter);
        oscillator.stop(startedAt + (event.startQuarter + event.durationQuarter - fromQuarter) * secondsPerQuarter);
        nodes.push(oscillator);
      }
      setPhase("playing");
      timerRef.current = setInterval(() => {
        const current = activeRef.current;
        if (!current) return;
        const nextPosition = current.positionQuarter + Math.max(0, current.context.currentTime - current.startedAt) / secondsPerQuarter;
        if (nextPosition >= plan.totalQuarter) {
          stopNodes();
          setPhase("finished");
          setPositionQuarter(0);
          setCursorEventId(undefined);
          return;
        }
        setPositionQuarter(nextPosition);
        const cursor = plan.events.findLast((event) => audible.has(event.trackId) && event.startQuarter <= nextPosition && event.startQuarter + event.durationQuarter > nextPosition);
        setCursorEventId(cursor?.eventId);
      }, 40);
    } catch {
      stopNodes();
      setError("오디오를 시작하지 못했습니다. 재생 버튼을 다시 눌러 주세요.");
      setPhase("ready");
    }
  };

  const pause = () => {
    const current = activeRef.current;
    if (!current) return;
    const next = current.positionQuarter + Math.max(0, current.context.currentTime - current.startedAt) / quarterSeconds(tempo, speed);
    stopNodes();
    setPositionQuarter(Math.min(next, plan.totalQuarter));
    setPhase("paused");
  };

  const changeMixer = (change: () => void) => { reset(); change(); };
  const labels = plan.trackLabels;

  return <section className="panel practice-player" aria-label={readOnly ? "공유 연습 플레이어" : "프로젝트 연습 플레이어"}>
    <div ref={scoreRef} className="score-wrap" aria-label="정본 ArrangementRenderDocument 악보" />
    <div className="transport">
      <button className="primary" type="button" disabled={!scoreReady || phase === "playing"} onClick={() => void begin(0)}>Play</button>
      <button type="button" disabled={phase !== "playing"} onClick={pause}>Pause</button>
      <button type="button" disabled={phase !== "paused"} onClick={() => void begin(positionQuarter)}>Resume</button>
      <button type="button" disabled={phase === "ready" && positionQuarter === 0} onClick={reset}>Reset</button>
    </div>
    <div className="voices">
      {plan.trackIds.map((trackId) => <div className="voice" key={trackId}>
        <strong>{labels[trackId]}</strong>{" "}
        {trackId === "track:band" ? <button type="button" aria-pressed={bandEnabled} onClick={() => changeMixer(() => setBandEnabled((value) => !value))}>Band {bandEnabled ? "On" : "Off"}</button> : <>
          <button type="button" aria-label={`${labels[trackId]} mute`} aria-pressed={muted.has(trackId)} onClick={() => changeMixer(() => setMuted((current) => { const next = new Set(current); if (next.has(trackId)) next.delete(trackId); else next.add(trackId); return next; }))}>Mute</button>{" "}
          <button type="button" aria-label={`${labels[trackId]} solo`} aria-pressed={solo === trackId} onClick={() => changeMixer(() => setSolo((current) => current === trackId ? undefined : trackId))}>Solo</button>
        </>}
      </div>)}
    </div>
    <label className="speed">Speed <select aria-label="Playback speed" value={speed} onChange={(event) => { reset(); setSpeed(Number(event.target.value) as PracticeSpeed); }}>{PRACTICE_SPEEDS.map((value) => <option key={value} value={value}>{value}%</option>)}</select></label>
    <p className="status" aria-live="polite">{phase === "ready" ? "준비" : phase === "playing" ? "재생 중" : phase === "paused" ? "일시 정지" : "재생 완료"} · {positionQuarter.toFixed(2)} / {plan.totalQuarter.toFixed(2)} quarter · event <code>{cursorEventId ?? "—"}</code></p>
    {error ? <p className="status error" role="alert">{error}</p> : null}
  </section>;
}
