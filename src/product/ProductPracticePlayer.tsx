"use client";

import type { PracticeSettings } from "../domain/share";
import type { TempoSpec } from "../domain/source/model";
import { audibleTrackIds, PRACTICE_SPEEDS, type PlaybackPlan, type PracticeSpeed } from "./playback-plan";
import { usePracticePlayer } from "./use-practice-player";
export { resolvePracticePlayerInitialState, type PracticePlayerInitialState } from "./use-practice-player";
export { disposeOwnedAudioSession, type OwnedAudioSession } from "./practice-audio-ownership";

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
  const player = usePracticePlayer({abc,plan,tempo,identity,initialSettings});
  const {scoreRef,scoreReady,phase,positionQuarter,speed,muted,solo,bandEnabled,levels,masterLevel,error,pause,setSpeed,setBandEnabled,setMasterLevel} = player;
  const audible = new Set(audibleTrackIds(plan,{muted,solo,bandEnabled}));
  const cursorEventId = phase === "playing" || phase === "paused"
    ? plan.events.findLast(event=>audible.has(event.trackId)&&event.startQuarter<=positionQuarter&&event.startQuarter+event.durationQuarter>positionQuarter)?.eventId : undefined;
  const labels = plan.trackLabels;

  return <section className="panel practice-player" aria-label={readOnly ? "공유 연습 플레이어" : "프로젝트 연습 플레이어"}>
    <div ref={scoreRef} className="score-wrap" aria-label="정본 ArrangementRenderDocument 악보" />
    <div className="transport">
      <button className="primary" type="button" disabled={!scoreReady || phase === "playing" || phase === "starting"} onClick={() => { player.restart(); player.play(); }}>Play</button>
      <button type="button" disabled={phase !== "playing"} onClick={pause}>Pause</button>
      <button type="button" disabled={phase !== "paused"} onClick={player.play}>Resume</button>
      <button type="button" disabled={phase === "ready" && positionQuarter === 0} onClick={player.restart}>Reset</button>
    </div>
    <div className="voices">
      {plan.trackIds.map((trackId) => <div className="voice" key={trackId}>
        <strong>{labels[trackId]}</strong>{" "}
        {trackId === "track:band" ? <button type="button" aria-pressed={bandEnabled} onClick={() => setBandEnabled(!bandEnabled)}>Band {bandEnabled ? "On" : "Off"}</button> : <>
          <button type="button" aria-label={`${labels[trackId]} mute`} aria-pressed={muted.has(trackId)} onClick={() => player.toggleMute(trackId)}>Mute</button>{" "}
          <button type="button" aria-label={`${labels[trackId]} solo`} aria-pressed={solo === trackId} onClick={() => player.toggleSolo(trackId)}>Solo</button>
        </>}
        <label className="volume">{labels[trackId]} 음량 <input type="range" min="0" max="200" step="5" aria-label={`${labels[trackId]} volume`} value={Math.round((levels[trackId] ?? 1) * 100)} onChange={(event) => player.setLevel(trackId, Number(event.target.value) / 100)} /><output>{Math.round((levels[trackId] ?? 1) * 100)}%</output></label>
      </div>)}
    </div>
    <label className="volume">전체 음량 <input type="range" min="0" max="100" step="5" aria-label="Master volume" value={Math.round(masterLevel * 100)} onChange={(event) => setMasterLevel(Number(event.target.value) / 100)} /><output>{Math.round(masterLevel * 100)}%</output></label>
    <label className="speed">Speed <select aria-label="Playback speed" value={speed} onChange={(event) => setSpeed(Number(event.target.value) as PracticeSpeed)}>{PRACTICE_SPEEDS.map((value) => <option key={value} value={value}>{value}%</option>)}</select></label>
    <p>음량·Mute·Solo·Band는 재생 중에도 적용됩니다. 음량 100%는 파트별 기본 믹스이며, 속도를 바꾸면 처음으로 돌아갑니다.</p>
    <p className="status" aria-live="polite">{phase === "ready" ? "준비" : phase === "starting" ? "오디오 준비 중" : phase === "playing" ? "재생 중" : phase === "paused" ? "일시 정지" : "재생 완료"} · {positionQuarter.toFixed(2)} / {plan.totalQuarter.toFixed(2)} quarter · event <code>{cursorEventId ?? "—"}</code></p>
    {error ? <p className="status error" role="alert">{error}</p> : null}
  </section>;
}
