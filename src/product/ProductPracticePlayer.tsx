"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PracticeSettings } from "../domain/share";
import type { TempoSpec } from "../domain/source/model";
import { audibleTrackIds, PRACTICE_SPEEDS, quarterSeconds, type PlaybackPlan, type PracticeSpeed } from "./playback-plan";
import {
  PracticeAudioOwnershipController,
  type OwnedAudioSession,
  type PracticeAudioReleaseReason,
} from "./practice-audio-ownership";

export { disposeOwnedAudioSession, type OwnedAudioSession } from "./practice-audio-ownership";

interface ActiveAudio extends OwnedAudioSession {
  readonly context: AudioContext;
  readonly nodes: readonly OscillatorNode[];
  readonly startedAt: number;
  readonly positionQuarter: number;
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
  const [phase, setPhase] = useState<"ready" | "playing" | "paused" | "finished">("ready");
  const [positionQuarter, setPositionQuarter] = useState(0);
  const [cursorEventId, setCursorEventId] = useState<string>();
  const [speed, setSpeed] = useState<PracticeSpeed>(resolvedInitial.speed);
  const [muted, setMuted] = useState<ReadonlySet<string>>(new Set());
  const [solo, setSolo] = useState<string | undefined>(resolvedInitial.solo);
  const [bandEnabled, setBandEnabled] = useState(resolvedInitial.bandEnabled);
  const [error, setError] = useState<string>();
  const audible = useMemo(() => new Set(audibleTrackIds(plan, { muted, ...(solo ? { solo } : {}), bandEnabled })), [bandEnabled, muted, plan, solo]);

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
    void import("abcjs").then(({ default: abcjs }) => {
      if (disposed || !scoreRef.current) return;
      scoreRef.current.replaceChildren();
      abcjs.renderAbc(scoreRef.current, abc, { responsive: "resize", staffwidth: Math.max(680, scoreRef.current.clientWidth - 24), add_classes: true });
      setScoreReadyIdentity(identity);
    }).catch(() => setError("악보를 표시하지 못했습니다."));
    return () => { disposed = true; };
  }, [abc, identity]);

  useEffect(() => () => {
    stopNodes("unmount");
  }, [stopNodes]);

  const scoreReady = scoreReadyIdentity === identity;

  const begin = async (fromQuarter: number) => {
    stopNodes("replacement");
    setError(undefined);
    try {
      const AudioContextConstructor = window.AudioContext;
      const context = new AudioContextConstructor();
      const startedAt = context.currentTime + 0.05;
      const nodes: OscillatorNode[] = [];
      const session: ActiveAudio = { context, nodes, startedAt, positionQuarter: fromQuarter, disposed: false };
      audioOwner.replace(session);
      const secondsPerQuarter = quarterSeconds(tempo, speed);
      await context.resume();
      if (!audioOwner.isCurrent(session)) return;
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
      stopNodes("startup-failure");
      setError("오디오를 시작하지 못했습니다. 재생 버튼을 다시 눌러 주세요.");
      setPhase("ready");
    }
  };

  const pause = () => {
    const current = audioOwner.active;
    if (!current) return;
    const next = current.positionQuarter + Math.max(0, current.context.currentTime - current.startedAt) / quarterSeconds(tempo, speed);
    stopNodes("pause");
    setPositionQuarter(Math.min(next, plan.totalQuarter));
    setPhase("paused");
  };

  const changeMixer = (reason: "solo" | "mute" | "band", change: () => void) => { reset(reason); change(); };
  const labels = plan.trackLabels;

  return <section className="panel practice-player" aria-label={readOnly ? "공유 연습 플레이어" : "프로젝트 연습 플레이어"}>
    <div ref={scoreRef} className="score-wrap" aria-label="정본 ArrangementRenderDocument 악보" />
    <div className="transport">
      <button className="primary" type="button" disabled={!scoreReady || phase === "playing"} onClick={() => void begin(0)}>Play</button>
      <button type="button" disabled={phase !== "playing"} onClick={pause}>Pause</button>
      <button type="button" disabled={phase !== "paused"} onClick={() => void begin(positionQuarter)}>Resume</button>
      <button type="button" disabled={phase === "ready" && positionQuarter === 0} onClick={() => reset("reset")}>Reset</button>
    </div>
    <div className="voices">
      {plan.trackIds.map((trackId) => <div className="voice" key={trackId}>
        <strong>{labels[trackId]}</strong>{" "}
        {trackId === "track:band" ? <button type="button" aria-pressed={bandEnabled} onClick={() => changeMixer("band", () => setBandEnabled((value) => !value))}>Band {bandEnabled ? "On" : "Off"}</button> : <>
          <button type="button" aria-label={`${labels[trackId]} mute`} aria-pressed={muted.has(trackId)} onClick={() => changeMixer("mute", () => setMuted((current) => { const next = new Set(current); if (next.has(trackId)) next.delete(trackId); else next.add(trackId); return next; }))}>Mute</button>{" "}
          <button type="button" aria-label={`${labels[trackId]} solo`} aria-pressed={solo === trackId} onClick={() => changeMixer("solo", () => setSolo((current) => current === trackId ? undefined : trackId))}>Solo</button>
        </>}
      </div>)}
    </div>
    <label className="speed">Speed <select aria-label="Playback speed" value={speed} onChange={(event) => { reset("speed"); setSpeed(Number(event.target.value) as PracticeSpeed); }}>{PRACTICE_SPEEDS.map((value) => <option key={value} value={value}>{value}%</option>)}</select></label>
    <p className="status" aria-live="polite">{phase === "ready" ? "준비" : phase === "playing" ? "재생 중" : phase === "paused" ? "일시 정지" : "재생 완료"} · {positionQuarter.toFixed(2)} / {plan.totalQuarter.toFixed(2)} quarter · event <code>{cursorEventId ?? "—"}</code></p>
    {error ? <p className="status error" role="alert">{error}</p> : null}
  </section>;
}
