"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PracticeSettings } from "../domain/share";
import type { TempoSpec } from "../domain/source/model";
import { audibleTrackIds, PRACTICE_SPEEDS, quarterSeconds, type PlaybackPlan, type PracticeSpeed } from "./playback-plan";
import { PRACTICE_AUDIO_START_LEAD_SECONDS, practiceVolume, releasePracticeAudio, schedulePracticeAudio, updatePracticeAudioMix, type PracticeAudioGraph } from "./practice-audio";
import {
  PracticeAudioOwnershipController,
  type OwnedAudioSession,
  type PracticeAudioReleaseReason,
} from "./practice-audio-ownership";

export { disposeOwnedAudioSession, type OwnedAudioSession } from "./practice-audio-ownership";

interface ActiveAudio extends OwnedAudioSession {
  readonly context: AudioContext;
  graph?: PracticeAudioGraph;
  startedAt: number;
  readonly positionQuarter: number;
  readonly secondsPerQuarter: number;
}

export interface PracticePlayerInitialState {
  readonly speed: PracticeSpeed;
  readonly solo?: string;
  readonly bandEnabled: boolean;
}

export function resolvePracticePlayerInitialState(plan: Pick<PlaybackPlan, "trackIds">, settings?: PracticeSettings): PracticePlayerInitialState {
  const solo = settings?.selectedTrackIndex === undefined ? undefined : plan.trackIds[settings.selectedTrackIndex];
  return {
    speed: settings?.speedPercent ?? 100,
    ...(solo ? { solo } : {}),
    bandEnabled: settings?.accompanimentEnabled ?? true,
  };
}

interface ProductPracticePlayerProps {
  readonly abc: string;
  readonly plan: PlaybackPlan;
  readonly tempo: TempoSpec;
  readonly identity: string;
  readonly initialSettings?: PracticeSettings;
  readonly readOnly?: boolean;
}

export function ProductPracticePlayer(props: ProductPracticePlayerProps) {
  return <ProductPracticePlayerSession key={props.identity} {...props} />;
}

function ProductPracticePlayerSession({ abc, plan, tempo, identity, initialSettings, readOnly = false }: ProductPracticePlayerProps) {
  const scoreRef = useRef<HTMLDivElement>(null);
  const audioOwner = useMemo(() => new PracticeAudioOwnershipController<ActiveAudio>(), []);
  const resolvedInitial = resolvePracticePlayerInitialState(plan, initialSettings);
  const [scoreReadyIdentity, setScoreReadyIdentity] = useState<string>();
  const [phase, setPhase] = useState<"ready" | "starting" | "playing" | "paused" | "finished">("ready");
  const [positionQuarter, setPositionQuarter] = useState(0);
  const [cursorEventId, setCursorEventId] = useState<string>();
  const [speed, setSpeed] = useState<PracticeSpeed>(resolvedInitial.speed);
  const [muted, setMuted] = useState<ReadonlySet<string>>(new Set());
  const [solo, setSolo] = useState<string | undefined>(resolvedInitial.solo);
  const [bandEnabled, setBandEnabled] = useState(resolvedInitial.bandEnabled);
  const [levels, setLevels] = useState<Readonly<Record<string, number>>>({});
  const [masterLevel, setMasterLevel] = useState(1);
  const [error, setError] = useState<string>();
  const audible = useMemo(() => new Set(audibleTrackIds(plan, { muted, ...(solo ? { solo } : {}), bandEnabled })), [bandEnabled, muted, plan, solo]);

  useEffect(() => {
    const graph = audioOwner.active?.graph;
    if (graph) updatePracticeAudioMix(graph, { audible, levels, masterLevel });
  }, [audible, levels, masterLevel, phase, audioOwner]);

  const stopNodes = useCallback((reason: PracticeAudioReleaseReason) => {
    audioOwner.release(reason);
  }, [audioOwner]);

  const reset = useCallback((reason: PracticeAudioReleaseReason = "reset") => {
    stopNodes(reason);
    setPhase("ready");
    setPositionQuarter(0);
    setCursorEventId(undefined);
    setError(undefined);
  }, [stopNodes]);

  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | undefined;
    void import("abcjs").then(({ default: abcjs }) => {
      if (disposed || !scoreRef.current) return;
      const score = scoreRef.current;
      let renderedWidth = 0;
      const render = () => {
        const width = Math.floor(score.clientWidth);
        if (disposed || width <= 0 || width === renderedWidth) return;
        try {
          score.replaceChildren();
          // Responsive SVG alone shrinks an unbroken voice to fit. Wrap the
          // existing notation into systems at the actual available width.
          abcjs.renderAbc(score, abc, {
            responsive: "resize", staffwidth: Math.max(240, width - 24), add_classes: true,
            wrap: { minSpacing: 1.8, maxSpacing: 2.7, preferredMeasuresPerLine: 4 },
          });
          renderedWidth = width;
          setScoreReadyIdentity(identity);
        } catch { setError("악보를 표시하지 못했습니다."); }
      };
      render();
      observer = new ResizeObserver(render);
      observer.observe(score);
    }).catch(() => { if (!disposed) setError("악보를 표시하지 못했습니다."); });
    return () => { disposed = true; observer?.disconnect(); };
  }, [abc, identity]);

  useEffect(() => () => {
    stopNodes("unmount");
  }, [stopNodes]);

  const scoreReady = scoreReadyIdentity === identity;

  const begin = async (fromQuarter: number) => {
    stopNodes("replacement");
    setError(undefined);
    setPhase("starting");
    let pending: ActiveAudio | undefined;
    try {
      const AudioContextConstructor = window.AudioContext;
      const context = new AudioContextConstructor();
      const secondsPerQuarter = quarterSeconds(tempo, speed);
      const session: ActiveAudio = {
        context, get nodes() { return session.graph?.nodes ?? []; }, startedAt: 0,
        positionQuarter: fromQuarter, secondsPerQuarter, disposed: false,
        disposeAudio: () => {
          if (session.graph) releasePracticeAudio(session.graph, context);
          else void context.close().catch(() => undefined);
        },
      };
      pending = session;
      audioOwner.replace(session);
      // Freeze the clock before creating/queuing sources. A slow resume or a
      // busy main thread can no longer consume the first notes' scheduling lead.
      await context.suspend();
      if (!audioOwner.isCurrent(session)) return;
      session.startedAt = context.currentTime + PRACTICE_AUDIO_START_LEAD_SECONDS;
      session.graph = schedulePracticeAudio(context, plan, { fromQuarter, secondsPerQuarter,
        startedAt: session.startedAt, audible, levels, masterLevel });
      await context.resume();
      if (!audioOwner.isCurrent(session)) return;
      setPhase("playing");
      const timer = setInterval(() => {
        const current = audioOwner.active;
        if (!current) return;
        const nextPosition = current.positionQuarter + Math.max(0, current.context.currentTime - current.startedAt) / secondsPerQuarter;
        if (nextPosition >= plan.totalQuarter) {
          stopNodes("finish");
          setPhase("finished");
          setPositionQuarter(0);
          setCursorEventId(undefined);
          return;
        }
        setPositionQuarter(nextPosition);
        const cursor = plan.events.findLast((event) => audible.has(event.trackId) && event.startQuarter <= nextPosition && event.startQuarter + event.durationQuarter > nextPosition);
        setCursorEventId(cursor?.eventId);
      }, 40);
      audioOwner.installTimer(session, timer);
    } catch {
      if (pending && !audioOwner.isCurrent(pending)) return;
      stopNodes("startup-failure");
      setError("오디오를 시작하지 못했습니다. 재생 버튼을 다시 눌러 주세요.");
      setPhase("ready");
    }
  };

  const pause = () => {
    const current = audioOwner.active;
    if (!current) return;
    const next = current.positionQuarter + Math.max(0, current.context.currentTime - current.startedAt) / current.secondsPerQuarter;
    stopNodes("pause");
    setPositionQuarter(Math.min(next, plan.totalQuarter));
    setPhase("paused");
  };

  const labels = plan.trackLabels;

  return <section className="panel practice-player" aria-label={readOnly ? "공유 연습 플레이어" : "프로젝트 연습 플레이어"}>
    <div ref={scoreRef} className="score-wrap" aria-label="정본 ArrangementRenderDocument 악보" />
    <div className="transport">
      <button className="primary" type="button" disabled={!scoreReady || phase === "playing" || phase === "starting"} onClick={() => void begin(0)}>Play</button>
      <button type="button" disabled={phase !== "playing"} onClick={pause}>Pause</button>
      <button type="button" disabled={phase !== "paused"} onClick={() => void begin(positionQuarter)}>Resume</button>
      <button type="button" disabled={phase === "ready" && positionQuarter === 0} onClick={() => reset("reset")}>Reset</button>
    </div>
    <div className="voices">
      {plan.trackIds.map((trackId) => <div className="voice" key={trackId}>
        <strong>{labels[trackId]}</strong>{" "}
        {trackId === "track:band" ? <button type="button" aria-pressed={bandEnabled} onClick={() => setBandEnabled((value) => !value)}>Band {bandEnabled ? "On" : "Off"}</button> : <>
          <button type="button" aria-label={`${labels[trackId]} mute`} aria-pressed={muted.has(trackId)} onClick={() => setMuted((current) => { const next = new Set(current); if (next.has(trackId)) next.delete(trackId); else next.add(trackId); return next; })}>Mute</button>{" "}
          <button type="button" aria-label={`${labels[trackId]} solo`} aria-pressed={solo === trackId} onClick={() => setSolo((current) => current === trackId ? undefined : trackId)}>Solo</button>
        </>}
        <label className="volume">{labels[trackId]} 음량 <input type="range" min="0" max="200" step="5" aria-label={`${labels[trackId]} volume`} value={Math.round((levels[trackId] ?? 1) * 100)} onChange={(event) => setLevels((current) => ({ ...current, [trackId]: practiceVolume(Number(event.target.value) / 100) }))} /><output>{Math.round((levels[trackId] ?? 1) * 100)}%</output></label>
      </div>)}
    </div>
    <label className="volume">전체 음량 <input type="range" min="0" max="100" step="5" aria-label="Master volume" value={Math.round(masterLevel * 100)} onChange={(event) => setMasterLevel(practiceVolume(Number(event.target.value) / 100, 1))} /><output>{Math.round(masterLevel * 100)}%</output></label>
    <label className="speed">Speed <select aria-label="Playback speed" value={speed} onChange={(event) => { reset("speed"); setSpeed(Number(event.target.value) as PracticeSpeed); }}>{PRACTICE_SPEEDS.map((value) => <option key={value} value={value}>{value}%</option>)}</select></label>
    <p>음량·Mute·Solo·Band는 재생 중에도 적용됩니다. 음량 100%는 파트별 기본 믹스이며, 속도를 바꾸면 처음으로 돌아갑니다.</p>
    <p className="status" aria-live="polite">{phase === "ready" ? "준비" : phase === "starting" ? "오디오 준비 중" : phase === "playing" ? "재생 중" : phase === "paused" ? "일시 정지" : "재생 완료"} · {positionQuarter.toFixed(2)} / {plan.totalQuarter.toFixed(2)} quarter · event <code>{cursorEventId ?? "—"}</code></p>
    {error ? <p className="status error" role="alert">{error}</p> : null}
  </section>;
}
