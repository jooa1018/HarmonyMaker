export const VOICE_COUNT = 3;
export type MixerState = { muted: readonly boolean[]; solo: number | null };

export const initialMixerState: MixerState = { muted: [false, false, false], solo: null };

export function toggleMute(state: MixerState, voice: number): MixerState {
  return { ...state, muted: state.muted.map((value, index) => index === voice ? !value : value) };
}

export function toggleSolo(state: MixerState, voice: number): MixerState {
  return { ...state, solo: state.solo === voice ? null : voice };
}

// Solo takes precedence: a soloed voice is audible even if its mute toggle was previously on.
export function voicesOff(state: MixerState): number[] {
  if (state.solo !== null) return Array.from({ length: VOICE_COUNT }, (_, index) => index).filter(index => index !== state.solo);
  return state.muted.flatMap((muted, index) => muted ? [index] : []);
}

export function normalizeSpeed(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.min(150, Math.max(50, Math.round(value / 5) * 5));
}
