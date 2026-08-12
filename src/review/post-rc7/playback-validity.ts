import type { PlaybackMix } from "./types";

export type PlaybackInvalidReason =
  | "INITIALIZATION_FAILURE"
  | "NO_AUDIO_OUTPUT"
  | "SET_TUNE_FAILURE"
  | "PLAYBACK_START_FAILURE"
  | "STOPPED_EARLY"
  | "AUDIBLE_GLITCH"
  | "OTHER";

export type PlaybackValidity =
  | { readonly status: "not-started" }
  | { readonly status: "playing"; readonly startedAtIso: string }
  | { readonly status: "heard-complete"; readonly completedAtIso: string }
  | { readonly status: "invalid"; readonly reason: PlaybackInvalidReason; readonly detail?: string };

export interface PlaybackAttempt {
  readonly id: string;
  readonly fixtureId: string;
  readonly baselineId: string;
  readonly mix: PlaybackMix;
  readonly validity: PlaybackValidity;
}

export const initialPlaybackValidity = (): PlaybackValidity => ({ status: "not-started" });

export function beginPlayback(startedAtIso: string): PlaybackValidity {
  return { status: "playing", startedAtIso };
}

export function completePlayback(current: PlaybackValidity, completedAtIso: string): PlaybackValidity {
  if (current.status !== "playing") throw new Error("PLAYBACK_NOT_RUNNING");
  return { status: "heard-complete", completedAtIso };
}

export function invalidatePlayback(reason: PlaybackInvalidReason, detail?: string): PlaybackValidity {
  return detail === undefined ? { status: "invalid", reason } : { status: "invalid", reason, detail };
}

export function isListeningScoreEligible(attempts: readonly PlaybackAttempt[], requiredAttemptIds: readonly string[]): boolean {
  const byId = new Map(attempts.map((attempt) => [attempt.id, attempt]));
  return requiredAttemptIds.length > 0 && requiredAttemptIds.every((id) => byId.get(id)?.validity.status === "heard-complete");
}
