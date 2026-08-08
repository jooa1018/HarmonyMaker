"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type ABCJS from "abcjs";
import { demoAbc, voiceLabels } from "./sample";
import { initialMixerState, normalizeSpeed, toggleMute, toggleSolo, voicesOff, type MixerState } from "./mixer";

type PlaybackStatus = "준비" | "재생 중" | "일시 정지" | "처음으로 돌아감" | "재생 완료";

export function ScorePlayer() {
  const scoreRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLDivElement>(null);
  const abcRef = useRef<typeof ABCJS | null>(null);
  const tuneRef = useRef<ABCJS.TuneObject | null>(null);
  const controllerRef = useRef<ABCJS.SynthObjectController | null>(null);
  const highlightedRef = useRef<HTMLElement[]>([]);
  const [mixer, setMixer] = useState<MixerState>(initialMixerState);
  const [speed, setSpeed] = useState(100);
  const [status, setStatus] = useState<PlaybackStatus>("준비");
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const clearHighlight = useCallback(() => {
    highlightedRef.current.forEach(element => element.classList.remove("abcjs-highlight"));
    highlightedRef.current = [];
  }, []);

  useEffect(() => {
    let disposed = false;

    const render = async () => {
      const abc = await import("abcjs");
      if (disposed || !scoreRef.current) return;
      abcRef.current = abc.default;
      const width = Math.max(320, scoreRef.current.clientWidth);
      tuneRef.current = abcRef.current.renderAbc(scoreRef.current, demoAbc, {
        responsive: "resize",
        staffwidth: Math.max(680, width - 24),
        add_classes: true,
      })[0] ?? null;
      setReady(Boolean(tuneRef.current));
    };
    void render().catch(() => setError("악보를 표시하지 못했습니다. 페이지를 다시 불러와 주세요."));
    return () => { disposed = true; controllerRef.current?.pause(); };
  }, [clearHighlight]);

  const cursorControl: ABCJS.CursorControl = {
    onStart: () => setStatus("재생 중"),
    onFinished: () => { clearHighlight(); setStatus("재생 완료"); },
    onEvent: event => {
      clearHighlight();
      const elements = event.elements?.flat() ?? [];
      elements.forEach(element => element.classList.add("abcjs-highlight"));
      highlightedRef.current = elements;
    },
  };

  const configure = useCallback(async (nextMixer: MixerState, nextSpeed: number, userAction: boolean) => {
    const abc = abcRef.current;
    const tune = tuneRef.current;
    if (!abc || !tune || !audioRef.current) throw new Error("Score is not ready");
    if (!controllerRef.current) {
      controllerRef.current = new abc.synth.SynthController();
      controllerRef.current.load(audioRef.current, cursorControl, { displayLoop: false, displayRestart: false, displayPlay: false, displayProgress: false, displayWarp: false });
    }
    const result = await controllerRef.current.setTune(tune, userAction, { voicesOff: voicesOff(nextMixer) });
    if (result.status === "no-audio-context") throw new Error("AudioContext unavailable");
    await controllerRef.current.setWarp(nextSpeed);
  // cursorControl intentionally delegates only to stable state setters and refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearHighlight]);

  const play = async () => {
    setError(null);
    try {
      // This entire activation path starts in a direct Play click for iOS/Web Audio policy.
      await configure(mixer, speed, true);
      controllerRef.current?.play();
      setStatus("재생 중");
    } catch {
      setStatus("준비");
      setError("오디오를 시작하지 못했습니다. 재생 버튼을 다시 눌러 주세요.");
    }
  };

  const pause = () => { controllerRef.current?.pause(); setStatus("일시 정지"); };
  const reset = () => { controllerRef.current?.restart(); controllerRef.current?.pause(); clearHighlight(); setStatus("처음으로 돌아감"); };

  const updateMixer = async (next: MixerState) => {
    setMixer(next);
    if (!controllerRef.current) return;
    try { await configure(next, speed, false); setStatus("처음으로 돌아감"); clearHighlight(); }
    catch { setError("파트 설정을 적용하지 못했습니다. 재생 버튼을 다시 눌러 주세요."); }
  };

  const updateSpeed = async (value: number) => {
    const next = normalizeSpeed(value);
    setSpeed(next);
    if (!controllerRef.current) return;
    try { await controllerRef.current.setWarp(next); }
    catch { setError("재생 속도를 변경하지 못했습니다."); }
  };

  return <section className="panel" aria-label="S A T 악보 재생 데모">
    <div ref={scoreRef} className="score-wrap" aria-label="Soprano Alto Tenor 테스트 악보" />
    <div ref={audioRef} hidden />
    <div className="transport">
      <button className="primary" onClick={() => void play()} disabled={!ready}>Play</button>
      <button onClick={pause} disabled={!ready}>Pause</button>
      <button onClick={reset} disabled={!ready}>Reset</button>
    </div>
    <div className="voices">
      {voiceLabels.map((label, index) => <div className="voice" key={label}>
        <strong>{label}</strong>{" "}
        <button aria-label={`${label} mute`} aria-pressed={mixer.muted[index]} onClick={() => void updateMixer(toggleMute(mixer, index))}>Mute</button>{" "}
        <button aria-label={`${label} solo`} aria-pressed={mixer.solo === index} onClick={() => void updateMixer(toggleSolo(mixer, index))}>Solo</button>
      </div>)}
    </div>
    <label className="speed">Speed: <strong>{speed}%</strong>
      <input aria-label="Playback speed" type="range" min="50" max="150" step="25" value={speed} onChange={event => void updateSpeed(Number(event.target.value))} />
    </label>
    <p className="status" aria-live="polite">Playback status: {status}</p>
    {error && <p className="status error" role="alert">{error}</p>}
    <p><small>규칙: Solo가 Mute보다 우선하며, 한 번에 한 성부만 Solo됩니다. 파트 설정 변경 시 재생 위치는 처음으로 돌아갑니다.</small></p>
  </section>;
}
