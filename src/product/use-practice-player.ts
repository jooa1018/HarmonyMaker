"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PracticeSettings } from "../domain/share";
import type { TempoSpec } from "../domain/source/model";
import { audibleTrackIds, quarterSeconds, type PlaybackPlan, type PracticeSpeed } from "./playback-plan";
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

export interface PracticeTrackView {
  readonly id: string;
  readonly label: string;
  readonly kind: "voice" | "band";
  readonly role: "lead" | "upper" | "lower" | "band" | "other";
}
export interface PracticePlayerController {
  readonly scoreRef: React.RefObject<HTMLDivElement | null>;
  readonly scoreReady: boolean;
  readonly phase: "ready" | "starting" | "playing" | "paused" | "finished";
  readonly positionQuarter: number;
  readonly totalQuarter: number;
  readonly secondsPerQuarter: number;
  readonly speed: PracticeSpeed;
  readonly tracks: readonly PracticeTrackView[];
  readonly muted: ReadonlySet<string>;
  readonly solo: string | undefined;
  readonly bandEnabled: boolean;
  readonly levels: Readonly<Record<string, number>>;
  readonly masterLevel: number;
  readonly error: string | undefined;
  play(): void;
  pause(): void;
  restart(): void;
  setSpeed(speed: PracticeSpeed): void;
  toggleMute(trackId: string): void;
  toggleSolo(trackId: string): void;
  setBandEnabled(on: boolean): void;
  setLevel(trackId: string, level: number): void;
  setMasterLevel(level: number): void;
}
// Audio Session is optional. Invoke only from the user's Play/Resume action.
function requestPlaybackAudioSession(): void {
  try {
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session) session.type = "playback";
  } catch { /* A partial/unsupported implementation must not prevent ordinary playback. */ }
}

async function resumeWithDeadline(context: AudioContext): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      context.resume(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("AUDIO_RESUME_TIMEOUT")), 3000);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function usePracticePlayer({abc, plan, tempo, identity, initialSettings, preferredMeasuresPerLine = 4}: {
  abc: string; plan: PlaybackPlan; tempo: TempoSpec; identity: string;
  initialSettings?: PracticeSettings;
  preferredMeasuresPerLine?: number;
}): PracticePlayerController {
  const scoreRef = useRef<HTMLDivElement>(null);
  const audioOwner = useMemo(() => new PracticeAudioOwnershipController<ActiveAudio>(), []);
  const resolvedInitial = resolvePracticePlayerInitialState(plan, initialSettings);
  const [scoreReadyIdentity, setScoreReadyIdentity] = useState<string>();
  const [phase, setPhaseState] = useState<"ready" | "starting" | "playing" | "paused" | "finished">("ready");
  const [positionQuarter, setPositionState] = useState(0);
  const [speed, setSpeed] = useState<PracticeSpeed>(resolvedInitial.speed);
  const [muted, setMuted] = useState<ReadonlySet<string>>(new Set());
  const [solo, setSolo] = useState<string | undefined>(resolvedInitial.solo);
  const [bandEnabled, setBandEnabled] = useState(resolvedInitial.bandEnabled);
  const [levels, setLevels] = useState<Readonly<Record<string, number>>>({});
  const [masterLevel, setMasterLevel] = useState(1);
  const [error, setError] = useState<string>();
  // Event handlers update the transport ref synchronously, so restart(); play()
  // preserves the legacy Play-from-start button as well as the hook's resume API.
  const transport = useRef<{phase: PracticePlayerController["phase"]; positionQuarter: number}>({phase:"ready",positionQuarter:0});
  const setPhase = useCallback((value: PracticePlayerController["phase"]) => { transport.current.phase=value; setPhaseState(value); }, []);
  const setPositionQuarter = useCallback((value: number) => { transport.current.positionQuarter=value; setPositionState(value); }, []);
  const [sessionIdentity, setSessionIdentity] = useState(identity);
  if (sessionIdentity !== identity) {
    setSessionIdentity(identity);
    setPhaseState("ready"); setPositionState(0); setSpeed(resolvedInitial.speed);
    setMuted(new Set()); setSolo(resolvedInitial.solo); setBandEnabled(resolvedInitial.bandEnabled);
    setLevels({}); setMasterLevel(1); setError(undefined);
  }
  useEffect(() => { transport.current={phase:"ready",positionQuarter:0}; }, [identity]);
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
    setError(undefined);
  }, [stopNodes, setPhase, setPositionQuarter]);

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
            wrap: { minSpacing: 1.8, maxSpacing: 2.7, preferredMeasuresPerLine },
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
  }, [abc, identity, preferredMeasuresPerLine]);

  useEffect(() => () => {
    stopNodes("unmount");
  }, [identity, stopNodes]);

  const scoreReady = scoreReadyIdentity === identity;

  const begin = async (fromQuarter: number) => {
    stopNodes("replacement");
    setError(undefined);
    setPhase("starting");
    let pending: ActiveAudio | undefined;
    try {
      requestPlaybackAudioSession();
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
      await resumeWithDeadline(context);
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
          return;
        }
        setPositionQuarter(nextPosition);
      }, 40);
      audioOwner.installTimer(session, timer);
    } catch {
      if (pending && !audioOwner.isCurrent(pending)) return;
      stopNodes("startup-failure");
      setError("소리를 켜지 못했어요. 재생 버튼을 다시 눌러 주세요.");
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

  return {
    scoreRef, scoreReady, phase, positionQuarter, totalQuarter:plan.totalQuarter,
    secondsPerQuarter:quarterSeconds(tempo,speed), speed, muted, solo, bandEnabled, levels, masterLevel, error,
    tracks:plan.trackIds.map(id=>({id,label:plan.trackLabels[id],kind:id === "track:band" ? "band" : "voice",
      role:id === "track:source-lead" ? "lead" : id === "track:band" ? "band" : plan.trackRoles?.[id] ?? "other"})),
    play() {
      if (!scoreReady || transport.current.phase === "starting" || transport.current.phase === "playing") return;
      void begin(transport.current.phase === "paused" ? transport.current.positionQuarter : 0);
    },
    pause,
    restart:()=>reset("reset"),
    setSpeed(value) { reset("speed"); setSpeed(value); },
    toggleMute(id) { setMuted(current=>{ const next=new Set(current); if(next.has(id))next.delete(id);else next.add(id); return next; }); },
    toggleSolo(id) { setSolo(current=>current === id ? undefined : id); },
    setBandEnabled,
    setLevel(id,level) { setLevels(current=>({...current,[id]:practiceVolume(level)})); },
    setMasterLevel:level=>setMasterLevel(practiceVolume(level,1)),
  };
}
