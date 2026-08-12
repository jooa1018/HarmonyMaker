"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type ABCJS from "abcjs";
import type { BaselineResult, DecisionTrace } from "@/review/post-rc7/arranger";
import type { ResearchMetrics } from "@/review/post-rc7/metrics";
import { createPlaybackArtifact } from "@/review/post-rc7/playback";
import { closePlaybackForContextChange, isListeningScoreEligible, type PlaybackAttempt, type PlaybackInvalidReason, type PlaybackValidity } from "@/review/post-rc7/playback-validity";
import { RENDERER_TIERS } from "@/review/post-rc7/renderer";
import type { PlaybackMix, RendererTier, ResearchArrangement, ResearchBaselineId, ResearchChordSpan } from "@/review/post-rc7/types";
import styles from "./review.module.css";

export interface ReviewCaseView {
  readonly baselineId: ResearchBaselineId;
  readonly arrangement: ResearchArrangement;
  readonly decisionTrace: readonly DecisionTrace[];
  readonly scheduleDigest: BaselineResult["scheduleDigest"];
  readonly arrangementDigest: BaselineResult["arrangementDigest"];
  readonly metrics: ResearchMetrics;
  readonly repeatedRelation: { readonly relation: string | null; readonly count: number };
}

interface FixtureSummary {
  readonly id: string;
  readonly title: string;
  readonly placement: "upper" | "lower";
  readonly rightsNote: string;
  readonly acceptanceEligibility: string;
  readonly tags: readonly string[];
}

interface FixtureView extends FixtureSummary {
  readonly chords: readonly ResearchChordSpan[];
}

interface ManifestItem extends FixtureSummary {
  readonly authorshipKind: string;
}

const MIXES: readonly PlaybackMix[] = ["BAND_LEAD_AND_HARMONY", "LEAD_AND_HARMONY", "LEAD_ONLY", "HARMONY_ONLY", "BAND_ONLY"];
const REQUIRED_MIXES: readonly PlaybackMix[] = ["LEAD_ONLY", "HARMONY_ONLY", "LEAD_AND_HARMONY", "BAND_LEAD_AND_HARMONY"];
const NOT_STARTED_VALIDITY: PlaybackValidity = { status: "not-started" };
const MIX_LABEL: Readonly<Record<PlaybackMix, string>> = {
  LEAD_ONLY: "Lead only",
  HARMONY_ONLY: "Harmony only",
  LEAD_AND_HARMONY: "Lead + Harmony",
  BAND_ONLY: "Source chord band only",
  BAND_LEAD_AND_HARMONY: "Source chord band + Lead + Harmony",
};

const ratio = (metric: { readonly valueBp: number | null }): string => metric.valueBp === null ? "n/a" : `${(metric.valueBp / 100).toFixed(2)}%`;
const validityLabel = (validity: PlaybackValidity): string => {
  if (validity.status === "invalid") return `invalid(${validity.reason})`;
  return validity.status;
};

export function B15ReviewClient({ fixture, fixtureManifest, cases }: {
  readonly fixture: FixtureView;
  readonly fixtureManifest: readonly ManifestItem[];
  readonly cases: readonly ReviewCaseView[];
}) {
  const [baselineId, setBaselineId] = useState<ResearchBaselineId>("B1.5-MATCHED");
  const [mix, setMix] = useState<PlaybackMix>("BAND_LEAD_AND_HARMONY");
  const [tier, setTier] = useState<RendererTier>("COMPETENT_PLAIN");
  const [validityByAttempt, setValidityByAttempt] = useState<Readonly<Record<string, PlaybackValidity>>>({});
  const [transportCompleteByAttempt, setTransportCompleteByAttempt] = useState<Readonly<Record<string, boolean>>>({});
  const [renderedAbc, setRenderedAbc] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const scoreRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLDivElement>(null);
  const abcRef = useRef<typeof ABCJS | null>(null);
  const tuneRef = useRef<ABCJS.TuneObject | null>(null);
  const controllerRef = useRef<ABCJS.SynthObjectController | null>(null);
  const activeAttemptRef = useRef<string | null>(null);
  const current = cases.find((candidate) => candidate.baselineId === baselineId) ?? cases[0];
  const artifact = useMemo(() => createPlaybackArtifact(current.arrangement, mix, tier, fixture.chords), [current, fixture.chords, mix, tier]);
  const ready = renderedAbc === artifact.abc;
  const attemptKey = `${fixture.id}:${baselineId}:${mix}:${tier}`;
  const validity = validityByAttempt[attemptKey] ?? NOT_STARTED_VALIDITY;
  const transportComplete = transportCompleteByAttempt[attemptKey] === true;

  const markValidity = useCallback((next: PlaybackValidity) => {
    setValidityByAttempt((previous) => ({ ...previous, [attemptKey]: next }));
  }, [attemptKey]);

  useEffect(() => {
    let disposed = false;
    const staleAttemptKey = activeAttemptRef.current;
    if (staleAttemptKey && staleAttemptKey !== attemptKey) {
      controllerRef.current?.pause();
      setValidityByAttempt((previous) => previous[staleAttemptKey]?.status === "playing"
        ? { ...previous, [staleAttemptKey]: closePlaybackForContextChange(previous[staleAttemptKey]) }
        : previous);
      setTransportCompleteByAttempt((previous) => ({ ...previous, [staleAttemptKey]: false }));
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
        responsive: "resize", staffwidth: Math.max(680, scoreRef.current.clientWidth - 24), add_classes: true,
      })[0] ?? null;
      if (tuneRef.current) setRenderedAbc(artifact.abc);
    };
    void render().catch(() => markValidity({ status: "invalid", reason: "INITIALIZATION_FAILURE" }));
    return () => { disposed = true; controllerRef.current?.pause(); };
  }, [artifact.abc, attemptKey, markValidity]);

  const play = async () => {
    if (!ready || !tuneRef.current || !abcRef.current || !audioRef.current || busy) return;
    setBusy(true);
    activeAttemptRef.current = attemptKey;
    setTransportCompleteByAttempt((previous) => ({ ...previous, [attemptKey]: false }));
    markValidity({ status: "playing", startedAtIso: new Date().toISOString() });
    try {
      const controller = new abcRef.current.synth.SynthController();
      controller.load(audioRef.current, {
        onStart: () => markValidity({ status: "playing", startedAtIso: new Date().toISOString() }),
        onFinished: () => setTransportCompleteByAttempt((previous) => ({ ...previous, [attemptKey]: true })),
      }, { displayLoop: false, displayRestart: false, displayPlay: false, displayProgress: false, displayWarp: false });
      const result = await controller.setTune(tuneRef.current, true, {});
      if (result.status === "no-audio-context") throw new Error("NO_AUDIO_OUTPUT");
      controllerRef.current = controller;
      await controller.play();
    } catch (error) {
      activeAttemptRef.current = null;
      markValidity({ status: "invalid", reason: error instanceof Error && error.message === "NO_AUDIO_OUTPUT" ? "NO_AUDIO_OUTPUT" : "PLAYBACK_START_FAILURE" });
    } finally {
      setBusy(false);
    }
  };

  const stopEarly = () => {
    controllerRef.current?.pause();
    activeAttemptRef.current = null;
    markValidity({ status: "invalid", reason: "STOPPED_EARLY" });
  };

  const confirmHeardComplete = () => {
    if (!transportComplete || validity.status !== "playing") return;
    activeAttemptRef.current = null;
    markValidity({ status: "heard-complete", completedAtIso: new Date().toISOString() });
  };

  const manuallyInvalidate = (reason: PlaybackInvalidReason) => {
    controllerRef.current?.pause();
    activeAttemptRef.current = null;
    markValidity({ status: "invalid", reason });
  };

  const requiredKeys = useMemo(() => REQUIRED_MIXES.map((requiredMix) => `${fixture.id}:${baselineId}:${requiredMix}:COMPETENT_PLAIN`), [baselineId, fixture.id]);
  const playbackAttempts = useMemo(() => {
    const required: PlaybackAttempt[] = REQUIRED_MIXES.map((requiredMix, index) => ({
      id: requiredKeys[index],
      fixtureId: fixture.id,
      baselineId,
      mix: requiredMix,
      rendererTier: "COMPETENT_PLAIN",
      validity: validityByAttempt[requiredKeys[index]] ?? NOT_STARTED_VALIDITY,
    }));
    const prefix = `${fixture.id}:${baselineId}:`;
    const extras: PlaybackAttempt[] = Object.entries(validityByAttempt)
      .filter(([id]) => id.startsWith(prefix) && !requiredKeys.includes(id))
      .map(([id, attemptValidity]) => {
        const [, , attemptMix, attemptTier] = id.split(":");
        return {
          id,
          fixtureId: fixture.id,
          baselineId,
          mix: attemptMix as PlaybackMix,
          rendererTier: attemptTier as RendererTier,
          validity: attemptValidity,
        };
      });
    return [...required, ...extras];
  }, [baselineId, fixture.id, requiredKeys, validityByAttempt]);
  const eligible = isListeningScoreEligible(playbackAttempts, requiredKeys);
  const selectedTier = RENDERER_TIERS.find((entry) => entry.tier === tier)!;
  const evidenceJson = useMemo(() => JSON.stringify({
    fixture,
    baselineId,
    arrangement: current.arrangement,
    decisionTrace: current.decisionTrace,
    scheduleDigest: current.scheduleDigest,
    arrangementDigest: current.arrangementDigest,
    metrics: current.metrics,
    humanReferenceCandidateSpaceHook: "AVAILABLE_NOT_POPULATED",
    playbackAttempts: playbackAttempts.map((attempt) => ({
      ...attempt,
      artifact: createPlaybackArtifact(current.arrangement, attempt.mix, attempt.rendererTier, fixture.chords),
    })),
    requiredAttemptIds: requiredKeys,
    listeningScoreEligible: eligible,
    selectedPlayback: { artifact, validity },
  }, null, 2), [artifact, baselineId, current, eligible, fixture, playbackAttempts, requiredKeys, validity]);

  const downloadEvidence = () => {
    const url = URL.createObjectURL(new Blob([evidenceJson], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${fixture.id}-${baselineId}-evidence.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return <main className={styles.shell}>
    <header className={styles.hero}>
      <p className={styles.eyebrow}>POST-RC.7 · ISOLATED RESEARCH ONLY</p>
      <h1>Chord-aware 3rd/6th baseline</h1>
      <p>Phase 0 evidence harness for B0, B1, B1.5-MATCHED, and B1.5-E2E. No production Step 4 path is connected.</p>
      <div className={styles.stopBanner}>Maximum state: <strong>READY_FOR_DEVELOPMENT_LISTENING</strong> · acceptance and renderer beauty are not established.</div>
    </header>

    <section className={styles.panel} aria-labelledby="fixture-heading">
      <div className={styles.sectionHeading}><div><p className={styles.kicker}>RIGHTS-SAFE CORPUS</p><h2 id="fixture-heading">{fixture.title}</h2></div><span className={styles.badge}>{fixture.placement.toUpperCase()}</span></div>
      <form method="get" className={styles.controls}>
        <label>Fixture<select name="fixture" defaultValue={fixture.id}>{fixtureManifest.map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}</select></label>
        <button type="submit">Load fixture</button>
      </form>
      <p className={styles.muted}>{fixture.rightsNote}</p>
      <p className={styles.mono}>{fixture.id} · {fixture.acceptanceEligibility} · {fixture.tags.join(" · ")}</p>
    </section>

    <section className={styles.panel} aria-labelledby="baseline-heading">
      <div className={styles.sectionHeading}><div><p className={styles.kicker}>CONTROL MATRIX</p><h2 id="baseline-heading">Baseline</h2></div><span className={styles.badge}>{baselineId}</span></div>
      <div className={styles.segmented}>{cases.map((item) => <button key={item.baselineId} type="button" aria-pressed={baselineId === item.baselineId} onClick={() => setBaselineId(item.baselineId)}>{item.baselineId}</button>)}</div>
      <dl className={styles.metrics}>
        <div><dt>Participation</dt><dd>{ratio(current.metrics.harmonyParticipation)}</dd></div>
        <div><dt>Actual unison</dt><dd>{ratio(current.metrics.actualUnison)}</dd></div>
        <div><dt>Harmonic divergence</dt><dd>{ratio(current.metrics.harmonicDivergence)}</dd></div>
        <div><dt>Independent runs</dt><dd>{current.metrics.independentRuns.length}</dd></div>
        <div><dt>Hard range failures</dt><dd>{current.metrics.diagnostics.hardRangeFailures}</dd></div>
        <div><dt>Hard leap failures</dt><dd>{current.metrics.diagnostics.hardLeapFailures}</dd></div>
        <div><dt>Max leap</dt><dd>{current.metrics.diagnostics.maxLeapSemitones ?? "n/a"}</dd></div>
        <div><dt>Repeated relation</dt><dd>{current.repeatedRelation.relation ?? "n/a"} × {current.repeatedRelation.count}</dd></div>
      </dl>
      <p className={styles.mono}>schedule {current.scheduleDigest}<br />arrangement {current.arrangementDigest}</p>
      <div className={styles.auditActions}><button type="button" onClick={() => void navigator.clipboard.writeText(evidenceJson)}>Copy evidence JSON</button><button type="button" onClick={downloadEvidence}>Download evidence JSON</button></div>
    </section>

    <section className={styles.panel} aria-labelledby="playback-heading">
      <div className={styles.sectionHeading}><div><p className={styles.kicker}>AUDITABLE PLAYBACK</p><h2 id="playback-heading">Listen and validate</h2></div><span className={`${styles.badge} ${validity.status === "invalid" ? styles.badgeInvalid : ""}`}>{validityLabel(validity)}</span></div>
      <div className={styles.controls}>
        <label>Mix<select value={mix} onChange={(event) => setMix(event.target.value as PlaybackMix)}>{MIXES.map((value) => <option key={value} value={value}>{MIX_LABEL[value]}</option>)}</select></label>
        <label>Renderer tier<select value={tier} onChange={(event) => setTier(event.target.value as RendererTier)}>{RENDERER_TIERS.map((entry) => <option key={entry.tier} value={entry.tier}>{entry.tier}</option>)}</select></label>
        <button type="button" className={styles.primary} disabled={!ready || busy || validity.status === "playing"} onClick={() => void play()}>Play from start</button>
        <button type="button" disabled={validity.status !== "playing" || transportComplete} onClick={stopEarly}>Stop early</button>
        <button type="button" disabled={!transportComplete || validity.status !== "playing"} onClick={confirmHeardComplete}>Confirm heard complete</button>
      </div>
      <div ref={scoreRef} className={styles.score} aria-label={`${MIX_LABEL[mix]} score`} />
      <div ref={audioRef} hidden />
      {transportComplete && validity.status !== "heard-complete" && <p className={styles.ineligible}>Transport reached the end. A human listener must confirm that the full attempt was actually audible before it becomes heard-complete.</p>}
      <div className={styles.auditActions}><span>Audible problem:</span><button type="button" onClick={() => manuallyInvalidate("NO_AUDIO_OUTPUT")}>No audio</button><button type="button" onClick={() => manuallyInvalidate("AUDIBLE_GLITCH")}>Glitch</button></div>
      <p className={styles.muted}>{selectedTier.note} Beauty ceiling established: <strong>{selectedTier.beautyCeilingEstablished ? "yes" : "no"}</strong>.</p>
      <p className={styles.muted}>The band is a deterministic playback projection of the frozen Source chord spans: Source bass, then fifth, root, and remaining declared tones. It never enters B1/B1.5 generation or ranking.</p>
      <p className={eligible ? styles.eligible : styles.ineligible}>Four-mix competent-plain listening record, including Source-chord band context: {eligible ? "eligible" : "incomplete"}</p>
    </section>

    <section className={styles.panel} aria-labelledby="trace-heading">
      <div className={styles.sectionHeading}><div><p className={styles.kicker}>DETERMINISTIC TRACE</p><h2 id="trace-heading">Chord-boundary and candidate evidence</h2></div><span className={styles.badge}>{current.decisionTrace.length} decisions</span></div>
      <p className={styles.muted}>Human-reference candidate-space hook: <strong>AVAILABLE_NOT_POPULATED</strong>. Human references are comparison annotations, never Source-chord authority.</p>
      {current.decisionTrace.length === 0 ? <p>B0 intentionally has no H1 decisions.</p> : current.decisionTrace.map((decision) => {
        const chosen = decision.candidates.find((candidate) => candidate.selected)!;
        const rejected = decision.candidates.filter((candidate) => candidate.rejectionReasons.length > 0);
        return <details key={decision.id} className={styles.trace}>
          <summary>{decision.trigger} · {decision.sourceChordSymbol} · {decision.lyric} · selected {chosen.family}{chosen.relation ? ` (${chosen.relation})` : ""}</summary>
          <p>Lead chord tone: {String(decision.leadIsSourceChordTone)} · rejected siblings: {rejected.length} · same syllable ID: <span className={styles.mono}>{decision.syllableId}</span></p>
          <ul>{[chosen, ...rejected.slice(0, 6), ...decision.candidates.filter((candidate) => candidate.family === "REST").slice(0, 1)].map((candidate) => <li key={candidate.id}><strong>{candidate.selected ? "SELECTED" : "SIBLING"}</strong> {candidate.family} {candidate.relation ?? ""} {candidate.rejectionReasons.join(", ") || "legal"}</li>)}</ul>
        </details>;
      })}
    </section>
  </main>;
}
