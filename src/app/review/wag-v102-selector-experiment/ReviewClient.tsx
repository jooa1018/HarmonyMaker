"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type ABCJS from "abcjs";

import { deterministicBlindSwap } from "@/experiments/wag-v102/experiment";
import type { ListeningItemArtifact, ListeningSideArtifact } from "@/experiments/wag-v102/playback";
import styles from "./review.module.css";

const SESSION_KEY = "hm-wag-v102-experiment-session-v1";
const RESPONSE_KEY = "hm-wag-v102-experiment-responses-v1";

export type Preference = "strongly-a" | "slightly-a" | "tie" | "slightly-b" | "strongly-b";
export type PrimaryReason =
  | "singability-tessitura"
  | "continuity-no-dropout"
  | "reentry-naturalness"
  | "harmonic-fit"
  | "line-naturalness"
  | "no-meaningful-difference"
  | "other";
export type Confidence = "low" | "medium" | "high";

interface LockedResponse {
  readonly preference: Preference;
  readonly primaryReason: PrimaryReason;
  readonly confidence: Confidence;
  readonly note: string;
  readonly lockedAtIso: string;
}

interface PlaybackState {
  readonly heardA: boolean;
  readonly heardB: boolean;
  readonly invalidA?: string;
  readonly invalidB?: string;
}

function loadStoredResponses(): Readonly<Record<string, LockedResponse>> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(RESPONSE_KEY) ?? "{}") as Readonly<Record<string, LockedResponse>>;
  } catch {
    return {};
  }
}

function BlindPlayer({
  label,
  side,
  heard,
  onHeard,
  onInvalid,
}: {
  readonly label: "A" | "B";
  readonly side: ListeningSideArtifact;
  readonly heard: boolean;
  readonly onHeard: () => void;
  readonly onInvalid: (reason: string) => void;
}) {
  const scoreRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLDivElement>(null);
  const abcRef = useRef<typeof ABCJS | null>(null);
  const tuneRef = useRef<ABCJS.TuneObject | null>(null);
  const controllerRef = useRef<ABCJS.SynthObjectController | null>(null);
  const onInvalidRef = useRef(onInvalid);
  useEffect(() => {
    onInvalidRef.current = onInvalid;
  }, [onInvalid]);
  const [renderedAbc, setRenderedAbc] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [transportComplete, setTransportComplete] = useState(false);
  const ready = renderedAbc === side.abc;

  useEffect(() => {
    let disposed = false;
    controllerRef.current?.pause();
    controllerRef.current = null;
    audioRef.current?.replaceChildren();
    const render = async () => {
      const imported = await import("abcjs");
      if (disposed || !scoreRef.current) return;
      abcRef.current = imported.default;
      scoreRef.current.replaceChildren();
      tuneRef.current = imported.default.renderAbc(scoreRef.current, side.abc, {
        staffwidth: 720,
        responsive: "resize",
      })[0] ?? null;
      setRenderedAbc(tuneRef.current ? side.abc : null);
    };
    void render().catch(() => onInvalidRef.current("INITIALIZATION_FAILURE"));
    return () => {
      disposed = true;
      controllerRef.current?.pause();
    };
  }, [side.abc]);

  const play = async () => {
    if (!ready || !tuneRef.current || !abcRef.current || !audioRef.current || busy) return;
    setBusy(true);
    setTransportComplete(false);
    try {
      controllerRef.current?.pause();
      const controller = new abcRef.current.synth.SynthController();
      controller.load(audioRef.current, {
        onStart: () => setPlaying(true),
        onFinished: () => {
          setPlaying(false);
          setTransportComplete(true);
        },
      }, {
        displayLoop: false,
        displayRestart: false,
        displayPlay: false,
        displayProgress: false,
        displayWarp: false,
      });
      const initialized = await controller.setTune(tuneRef.current, true, {});
      if (initialized.status === "no-audio-context") throw new Error("NO_AUDIO_OUTPUT");
      controllerRef.current = controller;
      await controller.play();
      setPlaying(true);
    } catch (error) {
      setPlaying(false);
      onInvalid(error instanceof Error && error.message === "NO_AUDIO_OUTPUT" ? "NO_AUDIO_OUTPUT" : "PLAYBACK_START_FAILURE");
    } finally {
      setBusy(false);
    }
  };

  const stopEarly = () => {
    controllerRef.current?.pause();
    setPlaying(false);
    setTransportComplete(false);
    onInvalid("STOPPED_EARLY");
  };

  return <section className={styles.player} aria-label={`Blind reference ${label}`}>
    <div className={styles.playerHeader}>
      <strong>{label}</strong>
      <span>{heard ? "heard complete" : transportComplete ? "confirm required" : playing ? "playing" : "not complete"}</span>
    </div>
    <div className={styles.transport}>
      <button type="button" onClick={() => void play()} disabled={!ready || busy || playing}>Play from start</button>
      <button type="button" onClick={stopEarly} disabled={!playing}>Stop early</button>
      <button type="button" onClick={onHeard} disabled={!transportComplete || heard}>Confirm heard complete</button>
    </div>
    <div className={styles.problemRow}>
      <span>Audible problem:</span>
      <button type="button" onClick={() => onInvalid("NO_AUDIO_OUTPUT")}>No audio</button>
      <button type="button" onClick={() => onInvalid("AUDIBLE_GLITCH")}>Glitch</button>
    </div>
    <div ref={scoreRef} className={styles.concealedScore} aria-hidden="true" />
    <div ref={audioRef} hidden />
  </section>;
}

export function ExperimentReviewClient({
  items,
  branchSha,
}: {
  readonly items: readonly ListeningItemArtifact[];
  readonly branchSha: string;
}) {
  const [seed, setSeed] = useState("");
  const [index, setIndex] = useState(0);
  const [responses, setResponses] = useState<Readonly<Record<string, LockedResponse>>>({});
  const [playback, setPlayback] = useState<Readonly<Record<string, PlaybackState>>>({});
  const [preference, setPreference] = useState<Preference | "">("");
  const [primaryReason, setPrimaryReason] = useState<PrimaryReason | "">("");
  const [confidence, setConfidence] = useState<Confidence | "">("");
  const [note, setNote] = useState("");

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      let current = window.localStorage.getItem(SESSION_KEY);
      if (!current) {
        current = window.crypto.randomUUID();
        window.localStorage.setItem(SESSION_KEY, current);
      }
      const stored = loadStoredResponses();
      const firstUnanswered = items.findIndex((item) => !stored[item.id]);
      setSeed(current);
      setResponses(stored);
      setIndex(firstUnanswered < 0 ? Math.max(0, items.length - 1) : firstUnanswered);
    });
    return () => {
      cancelled = true;
    };
  }, [items]);

  const item = items[index];
  const swap = seed ? deterministicBlindSwap(seed, item.id) : false;
  const sideA = swap ? item.challenger : item.baseline;
  const sideB = swap ? item.baseline : item.challenger;
  const locked = responses[item.id];
  const itemPlayback = playback[item.id] ?? { heardA: false, heardB: false };
  const voteEnabled = itemPlayback.heardA && itemPlayback.heardB && !locked;
  const completedCount = Object.keys(responses).length;

  const updatePlayback = useCallback((update: Partial<PlaybackState>) => {
    setPlayback((previous) => ({
      ...previous,
      [item.id]: {
        ...(previous[item.id] ?? { heardA: false, heardB: false }),
        ...update,
      },
    }));
  }, [item.id]);

  const lockResponse = () => {
    if (!voteEnabled || !preference || !primaryReason || !confidence) return;
    const response: LockedResponse = {
      preference,
      primaryReason,
      confidence,
      note: note.trim().slice(0, 240),
      lockedAtIso: new Date().toISOString(),
    };
    setResponses((previous) => {
      const next = { ...previous, [item.id]: response };
      window.localStorage.setItem(RESPONSE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const goTo = (nextIndex: number) => {
    setIndex(Math.max(0, Math.min(items.length - 1, nextIndex)));
    setPreference("");
    setPrimaryReason("");
    setConfidence("");
    setNote("");
  };

  const exportBundle = useMemo(() => JSON.stringify({
    schema: "hm-wag-v102-listening-export-v1",
    branchSha,
    sessionSeed: seed,
    exportedAtIso: new Date().toISOString(),
    itemCount: items.length,
    completedCount,
    items: items.map((entry) => {
      const entrySwap = seed ? deterministicBlindSwap(seed, entry.id) : false;
      return {
        id: entry.id,
        feature: entry.feature,
        fixtureId: entry.fixtureId,
        reverseDuplicateOf: entry.reverseDuplicateOf ?? null,
        mapping: {
          A: entrySwap ? entry.challenger.variant : entry.baseline.variant,
          B: entrySwap ? entry.baseline.variant : entry.challenger.variant,
        },
        playback: playback[entry.id] ?? null,
        response: responses[entry.id] ?? null,
        baseline: entry.baseline,
        challenger: entry.challenger,
      };
    }),
  }, null, 2), [branchSha, completedCount, items, playback, responses, seed]);

  const download = () => {
    const url = URL.createObjectURL(new Blob([exportBundle], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `HarmonyMaker-WAG-v102-listening-${branchSha.slice(0, 8)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return <main className={styles.shell}>
    <header className={styles.hero}>
      <p className={styles.eyebrow}>ISOLATED SELECTOR EXPERIMENT · NOT PRODUCTION</p>
      <h1>WAG v1.0.2 blind listening</h1>
      <p>Listen only to the fixed Band + Lead + Harmony mix. Variant names, pitches, and metrics remain concealed until the response is locked.</p>
      <div className={styles.progress}>{completedCount} / {items.length} responses locked</div>
    </header>

    <section className={styles.card}>
      <div className={styles.itemHeader}>
        <div><span>Comparison {index + 1} of {items.length}</span><h2>{item.feature} comparison</h2></div>
        <code>{item.id}</code>
      </div>
      <div className={styles.playerGrid}>
        <BlindPlayer
          key={`${item.id}:A:${sideA.variant}`}
          label="A"
          side={sideA}
          heard={itemPlayback.heardA}
          onHeard={() => updatePlayback({ heardA: true, invalidA: undefined })}
          onInvalid={(reason) => updatePlayback({ heardA: false, invalidA: reason })}
        />
        <BlindPlayer
          key={`${item.id}:B:${sideB.variant}`}
          label="B"
          side={sideB}
          heard={itemPlayback.heardB}
          onHeard={() => updatePlayback({ heardB: true, invalidB: undefined })}
          onInvalid={(reason) => updatePlayback({ heardB: false, invalidB: reason })}
        />
      </div>

      {!locked ? <div className={styles.votePanel}>
        <label>Preference
          <select value={preference} onChange={(event) => setPreference(event.target.value as Preference | "")} disabled={!voteEnabled}>
            <option value="">Choose after hearing A and B</option>
            <option value="strongly-a">Strongly A</option>
            <option value="slightly-a">Slightly A</option>
            <option value="tie">Tie</option>
            <option value="slightly-b">Slightly B</option>
            <option value="strongly-b">Strongly B</option>
          </select>
        </label>
        <label>Primary reason
          <select value={primaryReason} onChange={(event) => setPrimaryReason(event.target.value as PrimaryReason | "")} disabled={!voteEnabled}>
            <option value="">Choose</option>
            <option value="singability-tessitura">Singability / tessitura</option>
            <option value="continuity-no-dropout">Continuity / no dropout</option>
            <option value="reentry-naturalness">Re-entry naturalness</option>
            <option value="harmonic-fit">Harmonic fit</option>
            <option value="line-naturalness">Line naturalness</option>
            <option value="no-meaningful-difference">No meaningful difference</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label>Confidence
          <select value={confidence} onChange={(event) => setConfidence(event.target.value as Confidence | "")} disabled={!voteEnabled}>
            <option value="">Choose</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
        <label className={styles.noteLabel}>Optional note
          <input value={note} maxLength={240} onChange={(event) => setNote(event.target.value)} disabled={!voteEnabled} />
        </label>
        <button type="button" className={styles.primary} disabled={!voteEnabled || !preference || !primaryReason || !confidence} onClick={lockResponse}>Lock response and reveal</button>
      </div> : <div className={styles.reveal}>
        <h3>Response locked</h3>
        <p>A = <strong>{sideA.variant}</strong> · B = <strong>{sideB.variant}</strong></p>
        <div className={styles.revealGrid}>
          <article><h4>A pitches</h4><code>{sideA.pitchLabels.join(" · ")}</code><pre>{JSON.stringify(sideA.metrics, null, 2)}</pre></article>
          <article><h4>B pitches</h4><code>{sideB.pitchLabels.join(" · ")}</code><pre>{JSON.stringify(sideB.metrics, null, 2)}</pre></article>
        </div>
      </div>}

      <div className={styles.navigation}>
        <button type="button" onClick={() => goTo(index - 1)} disabled={index === 0}>Previous</button>
        <button type="button" onClick={() => goTo(index + 1)} disabled={index === items.length - 1 || !locked}>Next</button>
        <button type="button" onClick={download}>Download evidence JSON</button>
      </div>
    </section>

    <footer className={styles.footer}>
      <p>Directional development evidence only. This is not a population-level preference study and does not automatically issue WAG v1.0.2.</p>
      <code>{branchSha}</code>
    </footer>
  </main>;
}
