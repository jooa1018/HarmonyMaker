"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type ABCJS from "abcjs";
import {
  closePlaybackForContextChange,
  type PlaybackInvalidReason,
  type PlaybackValidity,
} from "@/review/post-rc7/playback-validity";
import type {
  MicroAnalysisRow,
  MicroPlaybackArtifact,
  MicroPlaybackMix,
  MicroReferenceId,
} from "@/review/post-rc7/microcomparison";
import styles from "./microcomparison.module.css";

export interface MicroReferenceView {
  readonly id: MicroReferenceId;
  readonly fixtureId: string;
  readonly provenance: "HUMAN_SPECIFIED_MICROREFERENCE";
  readonly analysis: readonly MicroAnalysisRow[];
  readonly artifacts: Readonly<Record<MicroPlaybackMix, MicroPlaybackArtifact>>;
}

const MIXES: readonly MicroPlaybackMix[] = ["BAND_LEAD_AND_H1", "LEAD_AND_H1", "H1_ONLY", "BAND_ONLY"];
const MIX_LABEL: Readonly<Record<MicroPlaybackMix, string>> = {
  BAND_LEAD_AND_H1: "Band + Lead + H1",
  LEAD_AND_H1: "Lead + H1",
  H1_ONLY: "H1 only",
  BAND_ONLY: "Band only",
};
const NOT_STARTED: PlaybackValidity = { status: "not-started" };

const attemptId = (referenceId: MicroReferenceId, mix: MicroPlaybackMix): string =>
  `hm-micro-nct-v0:${referenceId}:${mix}:COMPETENT_PLAIN`;

const statusLabel = (validity: PlaybackValidity): string => validity.status === "invalid"
  ? `invalid · ${validity.reason.toLowerCase().replaceAll("_", " ")}`
  : validity.status.replaceAll("-", " ");

function ReferencePlayer({
  reference,
  revealed,
  validityByAttempt,
  transportCompleteByAttempt,
  onValidity,
  onTransportComplete,
}: {
  readonly reference: MicroReferenceView;
  readonly revealed: boolean;
  readonly validityByAttempt: Readonly<Record<string, PlaybackValidity>>;
  readonly transportCompleteByAttempt: Readonly<Record<string, boolean>>;
  readonly onValidity: (id: string, validity: PlaybackValidity) => void;
  readonly onTransportComplete: (id: string, complete: boolean) => void;
}) {
  const [mix, setMix] = useState<MicroPlaybackMix>("BAND_LEAD_AND_H1");
  const [renderedAbc, setRenderedAbc] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const scoreRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLDivElement>(null);
  const abcRef = useRef<typeof ABCJS | null>(null);
  const tuneRef = useRef<ABCJS.TuneObject | null>(null);
  const controllerRef = useRef<ABCJS.SynthObjectController | null>(null);
  const activeAttemptRef = useRef<string | null>(null);
  const validityByAttemptRef = useRef(validityByAttempt);
  const artifact = reference.artifacts[mix];
  const currentAttemptId = attemptId(reference.id, mix);
  const validity = validityByAttempt[currentAttemptId] ?? NOT_STARTED;
  const transportComplete = transportCompleteByAttempt[currentAttemptId] === true;
  const ready = renderedAbc === artifact.abc;

  useEffect(() => {
    validityByAttemptRef.current = validityByAttempt;
  }, [validityByAttempt]);

  useEffect(() => {
    let disposed = false;
    const staleAttemptId = activeAttemptRef.current;
    if (staleAttemptId && staleAttemptId !== currentAttemptId) {
      controllerRef.current?.pause();
      const staleValidity = validityByAttemptRef.current[staleAttemptId] ?? NOT_STARTED;
      onValidity(staleAttemptId, closePlaybackForContextChange(staleValidity));
      onTransportComplete(staleAttemptId, false);
      activeAttemptRef.current = null;
    }
    controllerRef.current?.pause();
    controllerRef.current = null;
    audioRef.current?.replaceChildren();
    const render = async () => {
      const imported = await import("abcjs");
      if (disposed || !scoreRef.current) return;
      abcRef.current = imported.default;
      scoreRef.current.replaceChildren();
      tuneRef.current = imported.default.renderAbc(scoreRef.current, artifact.abc, {
        responsive: "resize",
        staffwidth: 720,
        add_classes: true,
      })[0] ?? null;
      if (tuneRef.current) setRenderedAbc(artifact.abc);
    };
    void render().catch(() => onValidity(currentAttemptId, { status: "invalid", reason: "INITIALIZATION_FAILURE" }));
    return () => {
      disposed = true;
      controllerRef.current?.pause();
    };
  }, [artifact.abc, currentAttemptId, onTransportComplete, onValidity]);

  const play = async () => {
    if (!ready || !tuneRef.current || !abcRef.current || !audioRef.current || busy) return;
    setBusy(true);
    activeAttemptRef.current = currentAttemptId;
    onTransportComplete(currentAttemptId, false);
    onValidity(currentAttemptId, { status: "playing", startedAtIso: new Date().toISOString() });
    try {
      const controller = new abcRef.current.synth.SynthController();
      controller.load(audioRef.current, {
        onStart: () => onValidity(currentAttemptId, { status: "playing", startedAtIso: new Date().toISOString() }),
        onFinished: () => onTransportComplete(currentAttemptId, true),
      }, { displayLoop: false, displayRestart: false, displayPlay: false, displayProgress: false, displayWarp: false });
      const result = await controller.setTune(tuneRef.current, true, {});
      if (result.status === "no-audio-context") throw new Error("NO_AUDIO_OUTPUT");
      controllerRef.current = controller;
      await controller.play();
    } catch (error) {
      activeAttemptRef.current = null;
      onValidity(currentAttemptId, {
        status: "invalid",
        reason: error instanceof Error && error.message === "NO_AUDIO_OUTPUT" ? "NO_AUDIO_OUTPUT" : "PLAYBACK_START_FAILURE",
      });
    } finally {
      setBusy(false);
    }
  };

  const stopEarly = () => {
    controllerRef.current?.pause();
    activeAttemptRef.current = null;
    onTransportComplete(currentAttemptId, false);
    onValidity(currentAttemptId, { status: "invalid", reason: "STOPPED_EARLY" });
  };

  const confirmHeardComplete = () => {
    if (!transportComplete || validity.status !== "playing") return;
    activeAttemptRef.current = null;
    onValidity(currentAttemptId, { status: "heard-complete", completedAtIso: new Date().toISOString() });
  };

  const invalidate = (reason: PlaybackInvalidReason) => {
    controllerRef.current?.pause();
    activeAttemptRef.current = null;
    onTransportComplete(currentAttemptId, false);
    onValidity(currentAttemptId, { status: "invalid", reason });
  };

  return <article className={styles.referenceCard} aria-labelledby={`reference-${reference.id}`}>
    <div className={styles.cardHeading}>
      <div><p className={styles.cardIndex}>REFERENCE</p><h2 id={`reference-${reference.id}`}>{reference.id}</h2></div>
      <span className={validity.status === "heard-complete" ? styles.completeBadge : styles.statusBadge}>{statusLabel(validity)}</span>
    </div>
    <label className={styles.mixLabel}>Playback projection
      <select value={mix} onChange={(event) => setMix(event.target.value as MicroPlaybackMix)}>
        {MIXES.map((value) => <option key={value} value={value}>{MIX_LABEL[value]}</option>)}
      </select>
    </label>
    <div className={styles.transport}>
      <button type="button" className={styles.playButton} disabled={!ready || busy || validity.status === "playing"} onClick={() => void play()}>Play from start</button>
      <button type="button" disabled={validity.status !== "playing" || transportComplete} onClick={stopEarly}>Stop early</button>
      <button type="button" disabled={!transportComplete || validity.status !== "playing"} onClick={confirmHeardComplete}>Confirm heard complete</button>
    </div>
    <div className={styles.problemActions}>
      <span>Audible problem?</span>
      <button type="button" onClick={() => invalidate("NO_AUDIO_OUTPUT")}>No audio</button>
      <button type="button" onClick={() => invalidate("AUDIBLE_GLITCH")}>Glitch</button>
    </div>
    {transportComplete && validity.status === "playing" && <p className={styles.notice}>Transport ended. Confirm only if the complete attempt was audible.</p>}
    <div ref={scoreRef} className={revealed ? styles.score : styles.concealedScore} aria-hidden={!revealed} />
    <div ref={audioRef} hidden />
  </article>;
}

export function MicroComparisonClient({ references }: { readonly references: readonly MicroReferenceView[] }) {
  const [validityByAttempt, setValidityByAttempt] = useState<Readonly<Record<string, PlaybackValidity>>>({});
  const [transportCompleteByAttempt, setTransportCompleteByAttempt] = useState<Readonly<Record<string, boolean>>>({});
  const [ranking, setRanking] = useState<Readonly<Record<"best" | "second" | "worst", MicroReferenceId | "">>>({
    best: "", second: "", worst: "",
  });
  const [notes, setNotes] = useState<Readonly<Record<MicroReferenceId, string>>>({ A: "", B: "", C: "" });
  const [revealed, setRevealed] = useState(false);
  const requiredAttemptIds = useMemo(() => references.map((reference) => attemptId(reference.id, "BAND_LEAD_AND_H1")), [references]);
  const heardCompleteCount = requiredAttemptIds.filter((id) => validityByAttempt[id]?.status === "heard-complete").length;
  const listeningComplete = heardCompleteCount === requiredAttemptIds.length && requiredAttemptIds.length === 3;
  const rankingComplete = new Set([ranking.best, ranking.second, ranking.worst]).size === 3
    && ranking.best !== "" && ranking.second !== "" && ranking.worst !== "";

  const updateValidity = useCallback((id: string, validity: PlaybackValidity) => {
    setValidityByAttempt((previous) => ({ ...previous, [id]: validity }));
  }, []);
  const updateTransport = useCallback((id: string, complete: boolean) => {
    setTransportCompleteByAttempt((previous) => ({ ...previous, [id]: complete }));
  }, []);

  return <main className={styles.shell}>
    <header className={styles.hero}>
      <p className={styles.eyebrow}>POST-RC.7 MICROCOMPARISON</p>
      <h1>Three static harmony references, one fixed band</h1>
      <p className={styles.intro}>Listen for phrase-level preference before seeing the construction. The lead, tempo, chord timeline, renderer, and accompaniment are identical in every reference.</p>
      <div className={styles.warningGrid}>
        <strong>STATIC HUMAN-SPECIFIED REFERENCES</strong>
        <strong>NOT B1.5 OUTPUT</strong>
        <strong>NOT PRODUCTION</strong>
      </div>
    </header>

    <section className={styles.protocol} aria-labelledby="protocol-heading">
      <div><p className={styles.kicker}>LISTENING PROTOCOL</p><h2 id="protocol-heading">Complete the full mix for A, B, and C</h2></div>
      <div className={listeningComplete ? styles.progressComplete : styles.progress}>{heardCompleteCount} / 3 heard complete</div>
      <p>Use <strong>Band + Lead + H1</strong> for the required comparison. Other projections are available for diagnosis. Transport completion alone never counts.</p>
    </section>

    <section className={styles.referenceGrid} aria-label="Static listening references">
      {references.map((reference) => <ReferencePlayer
        key={reference.id}
        reference={reference}
        revealed={revealed}
        validityByAttempt={validityByAttempt}
        transportCompleteByAttempt={transportCompleteByAttempt}
        onValidity={updateValidity}
        onTransportComplete={updateTransport}
      />)}
    </section>

    <section className={styles.rankingPanel} aria-labelledby="ranking-heading">
      <div className={styles.rankingHeading}>
        <div><p className={styles.kicker}>MEMORY-ONLY RESPONSE</p><h2 id="ranking-heading">Rank the three references</h2></div>
        <span>{listeningComplete ? "Unlocked" : "Locked until 3 / 3"}</span>
      </div>
      <div className={styles.rankControls}>
        {(["best", "second", "worst"] as const).map((position) => <label key={position}>{position[0].toUpperCase() + position.slice(1)}
          <select disabled={!listeningComplete || revealed} value={ranking[position]} onChange={(event) => setRanking((previous) => ({ ...previous, [position]: event.target.value as MicroReferenceId | "" }))}>
            <option value="">Choose</option>
            {references.map((reference) => <option key={reference.id} value={reference.id}>{reference.id}</option>)}
          </select>
        </label>)}
      </div>
      <div className={styles.noteGrid}>
        {references.map((reference) => <label key={reference.id}>Optional note for {reference.id}
          <input disabled={!listeningComplete || revealed} maxLength={160} value={notes[reference.id]} onChange={(event) => setNotes((previous) => ({ ...previous, [reference.id]: event.target.value }))} placeholder="Short listening impression" />
        </label>)}
      </div>
      <button type="button" className={styles.revealButton} disabled={!listeningComplete || !rankingComplete || revealed} onClick={() => setRevealed(true)}>Reveal construction and analysis</button>
      {!rankingComplete && listeningComplete && <p className={styles.notice}>Choose each of A, B, and C exactly once before reveal.</p>}
    </section>

    {revealed && <section className={styles.revealPanel} aria-labelledby="reveal-heading">
      <p className={styles.kicker}>POST-RANKING REVEAL</p>
      <h2 id="reveal-heading">Exact notes and Source-chord classification</h2>
      <p>Your memory-only ranking: <strong>{ranking.best}</strong> best, <strong>{ranking.second}</strong> second, <strong>{ranking.worst}</strong> worst. It is not persisted or submitted.</p>
      <div className={styles.analysisStack}>
        {references.map((reference) => <article key={reference.id} className={styles.analysisCard}>
          <h3>Reference {reference.id}</h3>
          {notes[reference.id] && <p className={styles.listenerNote}>Listening note: {notes[reference.id]}</p>}
          <div className={styles.tableWrap}><table>
            <thead><tr><th>q</th><th>Lead</th><th>Source chord</th><th>H1</th><th>Generic interval</th><th>Chromatic detail</th><th>Chord tone?</th><th>H1 motion</th></tr></thead>
            <tbody>{reference.analysis.map((row) => <tr key={`${reference.id}:${row.onsetQ.n}/${row.onsetQ.d}`} className={row.chordTone ? undefined : styles.nctRow}>
              <td>{row.onsetQ.n / row.onsetQ.d}</td><td>{row.leadPitch}</td><td>{row.sourceChord}</td><td>{row.harmonyPitch}</td><td>{row.genericInterval}</td><td>{row.chromaticInterval}</td><td>{row.chordTone ? "yes" : "no · intended NCT"}</td><td>{row.harmonyMotion}</td>
            </tr>)}</tbody>
          </table></div>
        </article>)}
      </div>
      <p className={styles.scopeNote}>Source chords are classified with the existing canonical chord parser and chord-tone projection. These human-specified references are comparison evidence only; they do not define B1.5 behavior or controlled NCT semantics.</p>
    </section>}
  </main>;
}
