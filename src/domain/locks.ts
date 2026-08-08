import type { ChordToneSpec } from "./chord/model";
import type { ArrangementPresetId } from "./config";
import type { LeadAtomReference } from "./source/atomization";
import type { NonChordToneKind, TexturePatternId, VoiceActivityDirective } from "./plans";
import type { SpelledPitch } from "./pitch";
import type { MusicalPosition, MusicalRange } from "./time";
import type { VocalPlacementRole } from "./performer";

interface LockBase { readonly id: string; readonly presetId: ArrangementPresetId }
export interface TextureLock extends LockBase { readonly kind: "texture"; readonly phraseId: string; readonly textureId: TexturePatternId }
export interface PlacementRoleLock extends LockBase { readonly kind: "placement-role"; readonly phraseId: string; readonly trackPlanId: string; readonly placementRole: VocalPlacementRole }
export type IntentLock = TextureLock | PlacementRoleLock;
export interface ExactActivityLock extends LockBase { readonly kind: "activity"; readonly phraseId: string; readonly trackPlanId: string; readonly range: MusicalRange; readonly activity: VoiceActivityDirective }
export type ActivityLock = ExactActivityLock;
export type LockedAnchorEndpointSpec =
  | { readonly kind: "chord-tone"; readonly position: MusicalPosition; readonly chordSpanId: string; readonly selectedTone: ChordToneSpec }
  | { readonly kind: "lead-derived"; readonly position: MusicalPosition; readonly leadAtom: LeadAtomReference; readonly relation: "unison" | "octave" };
interface LockedNonChordToneSpecBase { readonly kind: NonChordToneKind; readonly contextChordSpanId: string; readonly targetChordSpanId: string; readonly resolution: LockedAnchorEndpointSpec; readonly resolutionDeadline: MusicalPosition }
export type LockedNonChordToneSpec =
  | (LockedNonChordToneSpecBase & { readonly kind: "passing" | "neighbor"; readonly preparation: LockedAnchorEndpointSpec; readonly direction: "up" | "down" })
  | (LockedNonChordToneSpecBase & { readonly kind: "anticipation"; readonly preparation: LockedAnchorEndpointSpec })
  | (LockedNonChordToneSpecBase & { readonly kind: "suspension"; readonly preparation: LockedAnchorEndpointSpec; readonly resolutionDirection: "down" | "up" });
export type AnchorLock =
  | (LockBase & { readonly kind: "anchor-chord-tone"; readonly phraseId: string; readonly trackPlanId: string; readonly position: MusicalPosition; readonly chordSpanId: string; readonly selectedTone: ChordToneSpec })
  | (LockBase & { readonly kind: "anchor-lead-derived"; readonly phraseId: string; readonly trackPlanId: string; readonly position: MusicalPosition; readonly leadAtom: LeadAtomReference; readonly relation: "unison" | "octave" })
  | (LockBase & { readonly kind: "anchor-planned-nct"; readonly phraseId: string; readonly trackPlanId: string; readonly position: MusicalPosition; readonly nctSpec: LockedNonChordToneSpec });
export interface PitchLock extends LockBase { readonly kind: "pitch"; readonly phraseId: string; readonly trackPlanId: string; readonly position: MusicalPosition; readonly pitch: SpelledPitch }
export type SolverLock = PitchLock;
export interface VariantStageLocks { readonly intent: readonly IntentLock[]; readonly activity: readonly ActivityLock[]; readonly anchor: readonly AnchorLock[]; readonly solver: readonly SolverLock[] }

export function validateLockScope(lock: IntentLock | ActivityLock | AnchorLock | SolverLock, presetId: ArrangementPresetId): boolean {
  if (lock.presetId !== presetId || !lock.id || !("phraseId" in lock) || !lock.phraseId) return false;
  if (lock.kind === "pitch" && (!lock.trackPlanId || lock.position.performanceMeasureIndex < 0)) return false;
  return true;
}
export function findPitchAnchorConflicts(anchorLocks: readonly AnchorLock[], pitchLocks: readonly PitchLock[], realizedPitchByAnchorLockId: Readonly<Record<string, SpelledPitch>>): readonly string[] {
  const conflicts: string[] = [];
  for (const pitchLock of pitchLocks) {
    const anchor = anchorLocks.find((candidate) => candidate.phraseId === pitchLock.phraseId && candidate.trackPlanId === pitchLock.trackPlanId && candidate.position.performanceMeasureIndex === pitchLock.position.performanceMeasureIndex && candidate.position.offset.n === pitchLock.position.offset.n && candidate.position.offset.d === pitchLock.position.offset.d);
    const realized = anchor ? realizedPitchByAnchorLockId[anchor.id] : undefined;
    if (anchor && realized && (realized.step !== pitchLock.pitch.step || realized.alter !== pitchLock.pitch.alter || realized.octave !== pitchLock.pitch.octave)) conflicts.push(`STAGE_LOCK_SCOPE_INVALID:${anchor.id}:${pitchLock.id}`);
  }
  return conflicts;
}

