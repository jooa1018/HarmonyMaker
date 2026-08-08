export type PlaybackPhase = "ready" | "playing" | "paused" | "reset" | "finished";
export type PlaybackPosition = "start" | "current";

export interface PlaybackState {
  phase: PlaybackPhase;
  position: PlaybackPosition;
  error: string | null;
}

export type PlaybackAction =
  | { type: "clear-error" }
  | { type: "played" }
  | { type: "paused" }
  | { type: "reset" }
  | { type: "finished" }
  | { type: "mixer-applied" }
  | { type: "operation-failed"; message: string };

export const initialPlaybackState: PlaybackState = {
  phase: "ready",
  position: "start",
  error: null,
};

export function reducePlayback(state: PlaybackState, action: PlaybackAction): PlaybackState {
  switch (action.type) {
    case "clear-error":
      return { ...state, error: null };
    case "played":
      return { phase: "playing", position: "current", error: null };
    case "paused":
      return { phase: "paused", position: "current", error: null };
    case "reset":
    case "mixer-applied":
      return { phase: "reset", position: "start", error: null };
    case "finished":
      return { phase: "finished", position: "start", error: null };
    case "operation-failed":
      return { phase: "ready", position: "start", error: action.message };
  }
}

export const playbackStatusLabel: Record<PlaybackPhase, string> = {
  ready: "준비",
  playing: "재생 중",
  paused: "일시 정지",
  reset: "처음으로 돌아감",
  finished: "재생 완료",
};
