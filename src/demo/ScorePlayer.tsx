"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type ABCJS from "abcjs";
import { initialMixerState, normalizeSpeed, toggleMute, toggleSolo, voicesOff, type MixerState } from "./mixer";
import { initialPlaybackState, playbackStatusLabel, reducePlayback } from "./playback";
import { createDemoAbc, voiceLabels } from "./sample";

const AUDIO_START_ERROR = "오디오를 시작하지 못했습니다. 재생 버튼을 다시 눌러 주세요.";
const MIXER_ERROR = "파트 설정을 적용하지 못했습니다. 재생 버튼을 다시 눌러 주세요.";
const SPEED_ERROR = "재생 속도를 변경하지 못했습니다. 페이지를 다시 불러와 주세요.";
const DEFAULT_SPEED = 100;

export function ScorePlayer() {
  const scoreRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLDivElement>(null);
  const abcRef = useRef<typeof ABCJS | null>(null);
  const tuneRef = useRef<ABCJS.TuneObject | null>(null);
  const controllerRef = useRef<ABCJS.SynthObjectController | null>(null);
  const tuneInitializedRef = useRef(false);
  const playingRef = useRef(false);
  const audioBusyRef = useRef(false);
  const highlightedRef = useRef<HTMLElement[]>([]);
  const [mixer, setMixer] = useState<MixerState>(initialMixerState);
  const [speed, setSpeed] = useState(DEFAULT_SPEED);
  const [playback, dispatchPlayback] = useReducer(reducePlayback, initialPlaybackState);
  const [ready, setReady] = useState(false);
  const [audioBusy, setAudioBusy] = useState(false);
  const [audioInitialized, setAudioInitialized] = useState(false);

  const clearHighlight = useCallback(() => {
    highlightedRef.current.forEach(element => element.classList.remove("abcjs-highlight"));
    highlightedRef.current = [];
  }, []);

  const beginAudioOperation = useCallback(() => {
    if (audioBusyRef.current) return false;
    audioBusyRef.current = true;
    setAudioBusy(true);
    return true;
  }, []);

  const finishAudioOperation = useCallback(() => {
    audioBusyRef.current = false;
    setAudioBusy(false);
  }, []);

  const resetAudioEngine = useCallback(() => {
    controllerRef.current?.pause();
    controllerRef.current = null;
    tuneInitializedRef.current = false;
    playingRef.current = false;
    setAudioInitialized(false);
    audioRef.current?.replaceChildren();
    clearHighlight();
  }, [clearHighlight]);

  const cursorControl = useMemo<ABCJS.CursorControl>(() => ({
    onStart: () => {
      playingRef.current = true;
      dispatchPlayback({ type: "played" });
    },
    onFinished: () => {
      playingRef.current = false;
      clearHighlight();
      dispatchPlayback({ type: "finished" });
    },
    onEvent: event => {
      clearHighlight();
      const elements = event.elements?.flat() ?? [];
      elements.forEach(element => element.classList.add("abcjs-highlight"));
      highlightedRef.current = elements;
    },
  }), [clearHighlight]);

  const renderScore = useCallback((nextSpeed: number) => {
    const abc = abcRef.current;
    const score = scoreRef.current;
    if (!abc || !score) throw new Error("Score renderer is not ready");

    clearHighlight();
    score.replaceChildren();
    const width = Math.max(320, score.clientWidth);
    tuneRef.current = abc.renderAbc(score, createDemoAbc(nextSpeed), {
      responsive: "resize",
      staffwidth: Math.max(680, width - 24),
      add_classes: true,
    })[0] ?? null;

    const tuneReady = Boolean(tuneRef.current);
    setReady(tuneReady);
    if (!tuneReady) throw new Error("Score render failed");
  }, [clearHighlight]);

  useEffect(() => {
    let disposed = false;

    const render = async () => {
      const abc = await import("abcjs");
      if (disposed) return;
      abcRef.current = abc.default;
      renderScore(DEFAULT_SPEED);
    };

    void render().catch(() => dispatchPlayback({
      type: "operation-failed",
      message: "악보를 표시하지 못했습니다. 페이지를 다시 불러와 주세요.",
    }));

    return () => {
      disposed = true;
      controllerRef.current?.pause();
    };
  }, [renderScore]);

  const getController = useCallback(() => {
    const abc = abcRef.current;
    if (!abc || !audioRef.current) throw new Error("Score is not ready");
    if (!controllerRef.current) {
      controllerRef.current = new abc.synth.SynthController();
      controllerRef.current.load(audioRef.current, cursorControl, {
        displayLoop: false,
        displayRestart: false,
        displayPlay: false,
        displayProgress: false,
        displayWarp: false,
      });
    }
    return controllerRef.current;
  }, [cursorControl]);

  const initializeTune = useCallback(async (nextMixer: MixerState) => {
    const tune = tuneRef.current;
    if (!tune) throw new Error("Score is not ready");
    const controller = getController();

    // This path starts from a direct Play, Mute, or Solo gesture so iOS can
    // create/resume its AudioContext. Tempo is already encoded in the tune's
    // Q: header; setWarp is deliberately not used on iOS/Safari.
    const result = await controller.setTune(tune, true, { voicesOff: voicesOff(nextMixer) });
    if (result.status === "no-audio-context") throw new Error("AudioContext unavailable");

    tuneInitializedRef.current = true;
    playingRef.current = false;
    setAudioInitialized(true);
  }, [getController]);

  const play = async () => {
    if (!beginAudioOperation()) return;
    dispatchPlayback({ type: "clear-error" });
    try {
      if (!tuneInitializedRef.current) await initializeTune(mixer);
      if (!playingRef.current) {
        await getController().play();
        playingRef.current = true;
        dispatchPlayback({ type: "played" });
      }
    } catch {
      resetAudioEngine();
      dispatchPlayback({ type: "operation-failed", message: AUDIO_START_ERROR });
    } finally {
      finishAudioOperation();
    }
  };

  const pause = async () => {
    if (!tuneInitializedRef.current || !playingRef.current || !beginAudioOperation()) return;
    dispatchPlayback({ type: "clear-error" });
    try {
      // abcjs 6.7.0 play() is the stateful toggle. Calling pause() directly does
      // not clear its internal isStarted flag, so resume must toggle through play().
      await getController().play();
      playingRef.current = false;
      dispatchPlayback({ type: "paused" });
    } catch {
      resetAudioEngine();
      dispatchPlayback({ type: "operation-failed", message: AUDIO_START_ERROR });
    } finally {
      finishAudioOperation();
    }
  };

  const reset = async () => {
    if (!tuneInitializedRef.current || !beginAudioOperation()) return;
    dispatchPlayback({ type: "clear-error" });
    try {
      const controller = getController();
      if (playingRef.current) await controller.play();
      playingRef.current = false;
      controller.restart();
      clearHighlight();
      dispatchPlayback({ type: "reset" });
    } catch {
      resetAudioEngine();
      dispatchPlayback({ type: "operation-failed", message: AUDIO_START_ERROR });
    } finally {
      finishAudioOperation();
    }
  };

  const updateMixer = async (next: MixerState) => {
    if (!tuneInitializedRef.current) {
      setMixer(next);
      dispatchPlayback({ type: "clear-error" });
      return;
    }
    if (!beginAudioOperation()) return;
    dispatchPlayback({ type: "clear-error" });
    try {
      await initializeTune(next);
      setMixer(next);
      clearHighlight();
      dispatchPlayback({ type: "mixer-applied" });
    } catch {
      resetAudioEngine();
      dispatchPlayback({ type: "operation-failed", message: MIXER_ERROR });
    } finally {
      finishAudioOperation();
    }
  };

  const updateSpeed = (value: number) => {
    const next = normalizeSpeed(value);
    if (next === speed || !beginAudioOperation()) return;

    dispatchPlayback({ type: "clear-error" });
    try {
      // abcjs setWarp is unreliable in the tested iOS path. Re-render the same
      // fixture with an exact Q: tempo instead, discard the old synth, and let
      // the next Play gesture initialize audio from a clean state.
      resetAudioEngine();
      renderScore(next);
      setSpeed(next);
      dispatchPlayback({ type: "reset" });
    } catch {
      resetAudioEngine();
      dispatchPlayback({ type: "operation-failed", message: SPEED_ERROR });
    } finally {
      finishAudioOperation();
    }
  };

  const controlsDisabled = !ready || audioBusy;

  return <section className="panel" aria-label="S A T 악보 재생 데모">
    <div ref={scoreRef} className="score-wrap" aria-label="Soprano Alto Tenor 테스트 악보" />
    <div ref={audioRef} hidden />
    <div className="transport">
      <button className="primary" onClick={() => void play()} disabled={controlsDisabled || playback.phase === "playing"}>Play</button>
      <button onClick={() => void pause()} disabled={controlsDisabled || playback.phase !== "playing"}>Pause</button>
      <button onClick={() => void reset()} disabled={controlsDisabled || !audioInitialized}>Reset</button>
    </div>
    <div className="voices">
      {voiceLabels.map((label, index) => <div className="voice" key={label}>
        <strong>{label}</strong>{" "}
        <button disabled={controlsDisabled} aria-label={`${label} mute`} aria-pressed={mixer.muted[index]} onClick={() => void updateMixer(toggleMute(mixer, index))}>Mute</button>{" "}
        <button disabled={controlsDisabled} aria-label={`${label} solo`} aria-pressed={mixer.solo === index} onClick={() => void updateMixer(toggleSolo(mixer, index))}>Solo</button>
      </div>)}
    </div>
    <label className="speed">Speed: <strong>{speed}%</strong>
      <input disabled={controlsDisabled} aria-label="Playback speed" type="range" min="50" max="150" step="25" value={speed} onChange={event => updateSpeed(Number(event.target.value))} />
    </label>
    <p className="status" aria-live="polite">Playback status: {playbackStatusLabel[playback.phase]}{audioBusy ? " (오디오 준비 중)" : ""}</p>
    {playback.error && <p className="status error" role="alert">{playback.error}</p>}
    <p><small>규칙: Solo가 Mute보다 우선하며, 한 번에 한 성부만 Solo됩니다. 파트 또는 속도 설정 변경 시 재생 위치는 처음으로 돌아갑니다.</small></p>
  </section>;
}
