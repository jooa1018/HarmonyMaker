"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type ABCJS from "abcjs";
import {
  initialMixerState,
  normalizeSpeed,
  toggleMute,
  toggleSolo,
  voicesOff,
  type MixerState,
} from "@/demo/mixer";
import {
  initialPlaybackState,
  playbackStatusLabel,
  reducePlayback,
} from "@/demo/playback";
import { scaleRc7AbcTempo } from "@/review/wag-rc7/playback-tempo";
import type { Rc7BrowserCase } from "./browser-types";
import styles from "./review.module.css";

const PRESETS = ["simple", "standard", "full"] as const;
const VOICE_LABELS = ["Lead", "Harmony 1", "Harmony 2"] as const;
const DEFAULT_SPEED = 100;
const AUDIO_ERROR = "오디오를 시작하지 못했습니다. Play 또는 Resume을 다시 눌러 주세요.";
const MIXER_ERROR = "파트 설정을 적용하지 못했습니다. 재생을 다시 시작해 주세요.";

type PlaybackMode = "full" | "lead";
type PresetId = Rc7BrowserCase["preset"];

interface GenerationStatus {
  readonly runs: number;
  readonly phase: "ready" | "running" | "matched" | "failed";
  readonly message: string;
}

interface GeneratedEnvelope {
  readonly generated?: {
    readonly candidate?: {
      readonly id?: unknown;
      readonly contentDigest?: unknown;
    };
  };
}

function voicesOffForMode(state: MixerState, mode: PlaybackMode): number[] {
  if (mode === "full") return voicesOff(state);
  if (state.solo !== null) return state.solo === 0 ? [] : [0];
  return state.muted[0] ? [0] : [];
}

function shortDigest(value: string): string {
  return `${value.slice(0, 12)}…${value.slice(-8)}`;
}

export function ReviewHarnessClient({ cases }: { readonly cases: readonly Rc7BrowserCase[] }) {
  const catalog = useMemo(() => {
    const seen = new Set<string>();
    return cases.filter((entry) => {
      if (seen.has(entry.caseId)) return false;
      seen.add(entry.caseId);
      return true;
    });
  }, [cases]);
  const first = catalog[0];
  const [caseId, setCaseId] = useState(first?.caseId ?? "");
  const [preset, setPreset] = useState<PresetId>(first?.defaultPreset ?? "simple");
  const [mode, setMode] = useState<PlaybackMode>("full");
  const [mixer, setMixer] = useState<MixerState>(initialMixerState);
  const [speed, setSpeed] = useState(DEFAULT_SPEED);
  const [playback, dispatchPlayback] = useReducer(reducePlayback, initialPlaybackState);
  const [ready, setReady] = useState(false);
  const [audioBusy, setAudioBusy] = useState(false);
  const [audioInitialized, setAudioInitialized] = useState(false);
  const [rendererVersion, setRendererVersion] = useState(0);
  const [generation, setGeneration] = useState<GenerationStatus>({
    runs: 0,
    phase: "ready",
    message: "Generate를 누르면 서버가 같은 정본 입력에서 결과를 다시 계산합니다.",
  });

  const scoreRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLDivElement>(null);
  const abcRef = useRef<typeof ABCJS | null>(null);
  const tuneRef = useRef<ABCJS.TuneObject | null>(null);
  const controllerRef = useRef<ABCJS.SynthObjectController | null>(null);
  const tuneInitializedRef = useRef(false);
  const playingRef = useRef(false);
  const audioBusyRef = useRef(false);
  const highlightedRef = useRef<HTMLElement[]>([]);

  const active = useMemo(() => cases.find((entry) => (
    entry.caseId === caseId && entry.preset === preset
  )) ?? cases[0], [caseId, cases, preset]);

  const clearHighlight = useCallback(() => {
    highlightedRef.current.forEach((element) => element.classList.remove("abcjs-highlight"));
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
    onEvent: (event) => {
      clearHighlight();
      const elements = event.elements?.flat() ?? [];
      elements.forEach((element) => element.classList.add("abcjs-highlight"));
      highlightedRef.current = elements;
    },
  }), [clearHighlight]);

  const renderScore = useCallback((entry: Rc7BrowserCase, nextMode: PlaybackMode, nextSpeed: number) => {
    const abc = abcRef.current;
    const score = scoreRef.current;
    if (!abc || !score) throw new Error("RC7_REVIEW_RENDERER_NOT_READY");
    const source = nextMode === "full"
      ? entry.playback.fullArrangementAbc
      : entry.playback.leadOnlyAbc;
    clearHighlight();
    score.replaceChildren();
    const width = Math.max(320, score.clientWidth);
    tuneRef.current = abc.renderAbc(score, scaleRc7AbcTempo(source, nextSpeed), {
      responsive: "resize",
      staffwidth: Math.max(680, width - 24),
      add_classes: true,
    })[0] ?? null;
    const tuneReady = Boolean(tuneRef.current);
    setReady(tuneReady);
    if (!tuneReady) throw new Error("RC7_REVIEW_SCORE_RENDER_FAILED");
  }, [clearHighlight]);

  useEffect(() => {
    let disposed = false;
    void import("abcjs").then((abc) => {
      if (disposed) return;
      abcRef.current = abc.default;
      setRendererVersion((value) => value + 1);
    }).catch(() => dispatchPlayback({
      type: "operation-failed",
      message: "악보 렌더러를 불러오지 못했습니다.",
    }));
    return () => {
      disposed = true;
      controllerRef.current?.pause();
    };
  }, []);

  useEffect(() => {
    if (!active || rendererVersion === 0) return;
    resetAudioEngine();
    try {
      renderScore(active, mode, speed);
      dispatchPlayback({ type: "reset" });
    } catch {
      setReady(false);
      dispatchPlayback({ type: "operation-failed", message: "악보를 표시하지 못했습니다." });
    }
  }, [active, mode, renderScore, rendererVersion, resetAudioEngine, speed]);

  const getController = useCallback(() => {
    const abc = abcRef.current;
    if (!abc || !audioRef.current) throw new Error("RC7_REVIEW_AUDIO_NOT_READY");
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
    if (!tune) throw new Error("RC7_REVIEW_TUNE_NOT_READY");
    const result = await getController().setTune(tune, true, {
      voicesOff: voicesOffForMode(nextMixer, mode),
    });
    if (result.status === "no-audio-context") throw new Error("RC7_REVIEW_AUDIO_CONTEXT_UNAVAILABLE");
    tuneInitializedRef.current = true;
    playingRef.current = false;
    setAudioInitialized(true);
  }, [getController, mode]);

  const startPlayback = async () => {
    if (!beginAudioOperation()) return;
    dispatchPlayback({ type: "clear-error" });
    try {
      if (!tuneInitializedRef.current) await initializeTune(mixer);
      if (playback.phase === "finished") getController().restart();
      if (!playingRef.current) {
        await getController().play();
        playingRef.current = true;
        dispatchPlayback({ type: "played" });
      }
    } catch {
      resetAudioEngine();
      dispatchPlayback({ type: "operation-failed", message: AUDIO_ERROR });
    } finally {
      finishAudioOperation();
    }
  };

  const pausePlayback = async () => {
    if (!tuneInitializedRef.current || !playingRef.current || !beginAudioOperation()) return;
    dispatchPlayback({ type: "clear-error" });
    try {
      await getController().play();
      playingRef.current = false;
      dispatchPlayback({ type: "paused" });
    } catch {
      resetAudioEngine();
      dispatchPlayback({ type: "operation-failed", message: AUDIO_ERROR });
    } finally {
      finishAudioOperation();
    }
  };

  const resetPlayback = async () => {
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
      dispatchPlayback({ type: "operation-failed", message: AUDIO_ERROR });
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

  const resetSelectionState = () => {
    resetAudioEngine();
    setMode("full");
    setMixer(initialMixerState);
    setSpeed(DEFAULT_SPEED);
    setGeneration({
      runs: 0,
      phase: "ready",
      message: "선택이 바뀌었습니다. Generate로 정본 결과를 다시 확인할 수 있습니다.",
    });
    dispatchPlayback({ type: "reset" });
  };

  const selectCase = (nextCaseId: string) => {
    const definition = catalog.find((entry) => entry.caseId === nextCaseId);
    if (!definition) return;
    resetSelectionState();
    setCaseId(nextCaseId);
    setPreset(definition.defaultPreset);
  };

  const selectPreset = (nextPreset: PresetId) => {
    resetSelectionState();
    setPreset(nextPreset);
  };

  const selectMode = (nextMode: PlaybackMode) => {
    if (nextMode === mode) return;
    resetAudioEngine();
    setMixer(initialMixerState);
    setMode(nextMode);
    dispatchPlayback({ type: "reset" });
  };

  const updateSpeed = (value: number) => {
    const next = normalizeSpeed(value);
    if (next === speed) return;
    resetAudioEngine();
    setSpeed(next);
    dispatchPlayback({ type: "reset" });
  };

  const generate = async () => {
    if (!active || generation.phase === "running") return;
    setGeneration((current) => ({ ...current, phase: "running", message: "정본 파이프라인 재계산 중…" }));
    try {
      const response = await fetch(
        `/review/wag-rc7/output/${encodeURIComponent(active.caseId)}?preset=${encodeURIComponent(active.preset)}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      const payload = await response.json() as GeneratedEnvelope;
      const id = payload.generated?.candidate?.id;
      const digest = payload.generated?.candidate?.contentDigest;
      if (typeof id !== "string" || typeof digest !== "string") throw new Error("RC7_REVIEW_RESPONSE_INVALID");
      if (id !== active.candidateId || digest !== active.candidateContentDigest) {
        throw new Error("RC7_DETERMINISM_MISMATCH");
      }
      setGeneration((current) => ({
        runs: current.runs + 1,
        phase: "matched",
        message: `Run ${current.runs + 1}: Candidate ID와 content digest가 정확히 일치합니다.`,
      }));
    } catch (error) {
      setGeneration((current) => ({
        ...current,
        phase: "failed",
        message: error instanceof Error ? error.message : "RC7_REVIEW_GENERATION_FAILED",
      }));
    }
  };

  if (!active || !first) {
    return <main className={styles.shell}><p role="alert">RC7 review fixture가 없습니다.</p></main>;
  }

  const controlsDisabled = !ready || audioBusy;
  const outputUrl = `/review/wag-rc7/output/${encodeURIComponent(active.caseId)}?preset=${encodeURIComponent(active.preset)}`;

  return <main className={styles.shell}>
    <header className={styles.header}>
      <p className={styles.eyebrow}>WORSHIP ARRANGEMENT GRAMMAR v1 · rc.7</p>
      <h1>Isolated Review Harness</h1>
      <p className={styles.lede}>A–O 정본 fixture를 Intent → Activity → Anchor → Generation까지 실제 실행하고, 생성 이벤트와 브라우저 합성음을 같은 화면에서 검토합니다.</p>
      <div className={styles.boundary} role="note">
        <strong>ISOLATED · NON-PRODUCTION · REVIEW ONLY · NON-PERSISTING</strong>
        <span>HarmonyProject를 읽거나 변경하지 않습니다. WAG는 아직 승인되지 않았고 Step 4는 차단된 상태입니다.</span>
      </div>
    </header>

    <section className={styles.selectorPanel} aria-label="RC7 review selection">
      <label>
        <span>Fixture</span>
        <select aria-label="Review fixture" value={caseId} onChange={(event) => selectCase(event.target.value)}>
          {catalog.map((entry) => <option key={entry.caseId} value={entry.caseId}>{entry.title}</option>)}
        </select>
      </label>
      <label>
        <span>Preset</span>
        <select aria-label="Arrangement preset" value={preset} onChange={(event) => selectPreset(event.target.value as PresetId)}>
          {PRESETS.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      <button className={styles.generate} type="button" onClick={() => void generate()} disabled={generation.phase === "running"}>
        {generation.phase === "running" ? "Generating…" : "Generate deterministic output"}
      </button>
      <a className={styles.download} href={outputUrl} download>Download full JSON</a>
      <p className={generation.phase === "failed" ? styles.errorStatus : styles.generateStatus} aria-live="polite" data-generation-runs={generation.runs}>
        {generation.message}
      </p>
    </section>

    <div className={styles.primaryGrid}>
      <section className={styles.card} aria-labelledby="result-heading" data-candidate-id={active.candidateId}>
        <div className={styles.cardHeading}>
          <div>
            <p className={styles.kicker}>{active.section} · {active.sectionVariant} · {active.meter}</p>
            <h2 id="result-heading">{active.title}</h2>
          </div>
          <span className={styles.texture}>{active.texture}</span>
        </div>
        <p>{active.description}</p>
        <dl className={styles.metrics}>
          <div><dt>Preset</dt><dd>{active.preset}</dd></div>
          <div><dt>Lead attacks</dt><dd>{active.leadAttackCount}</dd></div>
          <div><dt>Harmony attacks</dt><dd>{active.harmonyAttackCount}</dd></div>
          <div><dt>Active tracks</dt><dd>{active.activeTrackOrdinals.length}</dd></div>
          <div><dt>Anchors</dt><dd>{active.anchorCount}</dd></div>
          <div><dt>Winner cost</dt><dd>{active.winnerScore}</dd></div>
        </dl>
        <div className={styles.digestList}>
          <p><span>Candidate</span><code title={active.candidateId}>{active.candidateId}</code></p>
          <p><span>Content digest</span><code title={active.candidateContentDigest}>{shortDigest(active.candidateContentDigest)}</code></p>
          <p><span>Intent input</span><code title={active.intentInputDigest}>{shortDigest(active.intentInputDigest)}</code></p>
          <p><span>Config</span><code title={active.grammarConfigDigest}>{shortDigest(active.grammarConfigDigest)}</code></p>
        </div>
        <p className={styles.roles}><strong>Placement roles:</strong> {active.roleTuple.length > 0 ? active.roleTuple.join(" · ") : "lead-only"}</p>
      </section>

      <section className={styles.card} aria-labelledby="playback-heading">
        <div className={styles.cardHeading}>
          <div>
            <p className={styles.kicker}>ACTUAL GENERATED PLAYBACK</p>
            <h2 id="playback-heading">Score &amp; synth</h2>
          </div>
          <span className={styles.renderer}>{active.playback.renderer}</span>
        </div>
        <div className={styles.modeSwitch} aria-label="Playback score mode">
          <button type="button" aria-pressed={mode === "full"} onClick={() => selectMode("full")}>Full arrangement</button>
          <button type="button" aria-pressed={mode === "lead"} onClick={() => selectMode("lead")}>Lead-only</button>
        </div>
        <div ref={scoreRef} className={styles.score} aria-label={`${mode === "full" ? "Full arrangement" : "Lead-only"} score`} />
        <div ref={audioRef} hidden />
        <div className={styles.transport} aria-label="Playback transport">
          <button type="button" className={styles.play} onClick={() => void startPlayback()} disabled={controlsDisabled || playback.phase === "playing" || playback.phase === "paused"}>Play</button>
          <button type="button" onClick={() => void pausePlayback()} disabled={controlsDisabled || playback.phase !== "playing"}>Pause</button>
          <button type="button" onClick={() => void startPlayback()} disabled={controlsDisabled || playback.phase !== "paused"}>Resume</button>
          <button type="button" onClick={() => void resetPlayback()} disabled={controlsDisabled || !audioInitialized}>Reset</button>
        </div>
        <div className={styles.voices}>
          {VOICE_LABELS.map((label, index) => {
            const unavailable = mode === "lead" && index > 0;
            return <div className={styles.voice} key={label}>
              <strong>{label}</strong>
              <button type="button" disabled={controlsDisabled || unavailable} aria-label={`${label} mute`} aria-pressed={mixer.muted[index]} onClick={() => void updateMixer(toggleMute(mixer, index))}>Mute</button>
              <button type="button" disabled={controlsDisabled || unavailable} aria-label={`${label} solo`} aria-pressed={mixer.solo === index} onClick={() => void updateMixer(toggleSolo(mixer, index))}>Solo</button>
            </div>;
          })}
        </div>
        <div className={styles.speed}>
          <span>Speed <strong>{speed}%</strong></span>
          <div className={styles.speedControls}>
            <button type="button" aria-label="Decrease playback speed" disabled={controlsDisabled || speed <= 50} onClick={() => updateSpeed(speed - 5)}>−</button>
            <input disabled={controlsDisabled} aria-label="Playback speed" type="range" min="50" max="150" step="5" value={speed} onChange={(event) => updateSpeed(Number(event.target.value))} />
            <button type="button" aria-label="Increase playback speed" disabled={controlsDisabled || speed >= 150} onClick={() => updateSpeed(speed + 5)}>+</button>
          </div>
        </div>
        <p className={styles.playbackStatus} aria-live="polite">Playback: {playbackStatusLabel[playback.phase]}{audioBusy ? " · 오디오 준비 중" : ""}</p>
        {playback.error && <p className={styles.errorStatus} role="alert">{playback.error}</p>}
        <p className={styles.provenance}>{active.playback.soundSource} · {active.playback.licenseProvenance}</p>
      </section>
    </div>

    <div className={styles.secondaryGrid}>
      <section className={styles.card} aria-labelledby="events-heading">
        <div className={styles.cardHeading}>
          <div><p className={styles.kicker}>AUTHORITATIVE PAYLOAD</p><h2 id="events-heading">Generated events</h2></div>
          <span>{active.generatedEvents.length} events</span>
        </div>
        {active.generatedEvents.length === 0
          ? <p className={styles.empty}>이 fixture의 정본 결과는 lead-only입니다.</p>
          : <div className={styles.tableWrap}><table>
            <thead><tr><th>Voice</th><th>Range</th><th>Pitch</th><th>Source</th></tr></thead>
            <tbody>{active.generatedEvents.map((event, index) => <tr key={`${event.voice}-${event.range}-${index}`}>
              <td>{event.voice}</td><td>{event.range}</td><td>{event.pitch}</td><td>{event.source}</td>
            </tr>)}</tbody>
          </table></div>}
      </section>

      <section className={styles.card} aria-labelledby="checks-heading">
        <div className={styles.cardHeading}>
          <div><p className={styles.kicker}>HARD LEGALITY</p><h2 id="checks-heading">Checks &amp; score</h2></div>
          <span className={styles.pass}>PASS</span>
        </div>
        <ul className={styles.checks}>
          <li><strong>{active.rangeCheckCount}</strong> hard-range checks</li>
          <li><strong>{active.verticalCheckCount}</strong> vertical legality checks</li>
          <li><strong>{active.nctKinds.length > 0 ? active.nctKinds.join(", ") : "none"}</strong> legal NCT kinds</li>
          <li><strong>{active.opportunityKey}</strong> canonical opportunity</li>
        </ul>
        <details>
          <summary>Winner score breakdown</summary>
          <dl className={styles.breakdown}>{active.winnerScoreParts.map((part) => <div key={part.code}><dt>{part.code}</dt><dd>{part.cost}</dd></div>)}</dl>
        </details>
      </section>
    </div>
  </main>;
}
