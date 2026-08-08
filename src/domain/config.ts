import { semanticDigest, type SemanticDigest } from "./digest/canonical";
import { extendedBasisPoints, type ExtendedBasisPoints } from "./rates";

export type ArrangementPresetId = "simple" | "standard" | "full";
export type ArrangementMode =
  | { readonly profileId: "worship-band-v1"; readonly harmonicContext: "band-supported" }
  | { readonly profileId: "standalone-vocal-reserved"; readonly harmonicContext: "standalone-vocal" };
export type CoreArrangementMode = Extract<ArrangementMode, { readonly profileId: "worship-band-v1" }>;
export interface UserArrangementCaps { readonly maxHarmonyTracks: 0 | 1 | 2; readonly allowOctaveDouble: boolean }
export interface ArrangementSettings { readonly mode: CoreArrangementMode; readonly requestedPresetIds: readonly ArrangementPresetId[]; readonly userCaps: UserArrangementCaps }
export interface PresetDifficultyProfile {
  readonly presetId: ArrangementPresetId;
  readonly maxActiveVoiceCount: 1 | 2 | 3;
  readonly maxHarmonyAttackRatioBp: ExtendedBasisPoints;
  readonly preferredMaxLeapSemitones: number;
  readonly hardMaxLeapSemitones: number;
  readonly allowSuspension: boolean;
  readonly allowColorTones: boolean;
  readonly allowOctaveDouble: boolean;
  readonly rhythmicComplexity: 0 | 1 | 2;
  readonly maxRoleChangesPerSection: 0 | 1 | 2;
  readonly maxSustainPrimaryPulses: number;
}
export interface PresetProfileRegistry { readonly presetProfileVersion: string; readonly profiles: Readonly<Record<ArrangementPresetId, PresetDifficultyProfile>>; readonly presetProfileDigest: SemanticDigest }
export interface EffectiveArrangementConfig extends PresetDifficultyProfile {
  readonly mode: CoreArrangementMode;
  readonly presetProfileVersion: string;
  readonly presetProfileDigest: SemanticDigest;
  readonly maxHarmonyTracks: 0 | 1 | 2;
  readonly digest: SemanticDigest;
}
const PRESET_ORDER: readonly ArrangementPresetId[] = ["simple", "standard", "full"];
const PROFILE_PAYLOADS: Readonly<Record<ArrangementPresetId, PresetDifficultyProfile>> = {
  simple: { presetId: "simple", maxActiveVoiceCount: 2, maxHarmonyAttackRatioBp: extendedBasisPoints(3500), preferredMaxLeapSemitones: 4, hardMaxLeapSemitones: 7, allowSuspension: false, allowColorTones: false, allowOctaveDouble: false, rhythmicComplexity: 0, maxRoleChangesPerSection: 0, maxSustainPrimaryPulses: 2 },
  standard: { presetId: "standard", maxActiveVoiceCount: 3, maxHarmonyAttackRatioBp: extendedBasisPoints(6000), preferredMaxLeapSemitones: 5, hardMaxLeapSemitones: 9, allowSuspension: true, allowColorTones: true, allowOctaveDouble: false, rhythmicComplexity: 1, maxRoleChangesPerSection: 1, maxSustainPrimaryPulses: 4 },
  full: { presetId: "full", maxActiveVoiceCount: 3, maxHarmonyAttackRatioBp: extendedBasisPoints(9000), preferredMaxLeapSemitones: 7, hardMaxLeapSemitones: 12, allowSuspension: true, allowColorTones: true, allowOctaveDouble: true, rhythmicComplexity: 2, maxRoleChangesPerSection: 2, maxSustainPrimaryPulses: 8 },
};

export function isCoreArrangementMode(value: unknown): value is CoreArrangementMode {
  if (typeof value !== "object" || value === null) return false;
  const mode = value as Readonly<Record<string, unknown>>;
  return mode.profileId === "worship-band-v1" && mode.harmonicContext === "band-supported";
}
export function validateArrangementSettings(value: unknown): value is ArrangementSettings {
  if (typeof value !== "object" || value === null) return false;
  const settings = value as Readonly<Record<string, unknown>>;
  if (!isCoreArrangementMode(settings.mode) || !Array.isArray(settings.requestedPresetIds) || typeof settings.userCaps !== "object" || settings.userCaps === null) return false;
  const requested = settings.requestedPresetIds;
  if (requested.length === 0 || new Set(requested).size !== requested.length || requested.some((item) => !PRESET_ORDER.includes(item as ArrangementPresetId))) return false;
  if (requested.some((item, index) => index > 0 && PRESET_ORDER.indexOf(item as ArrangementPresetId) <= PRESET_ORDER.indexOf(requested[index - 1] as ArrangementPresetId))) return false;
  const caps = settings.userCaps as Readonly<Record<string, unknown>>;
  return [0, 1, 2].includes(Number(caps.maxHarmonyTracks)) && typeof caps.allowOctaveDouble === "boolean";
}
export async function createPresetProfileRegistry(presetProfileVersion: string): Promise<PresetProfileRegistry> {
  const presetProfileDigest = await semanticDigest({ projectionSchema: "hm-preset-profile-registry-v1", presetProfileVersion, profiles: PRESET_ORDER.map((id) => PROFILE_PAYLOADS[id]) });
  return { presetProfileVersion, profiles: PROFILE_PAYLOADS, presetProfileDigest };
}
export async function resolveEffectiveArrangementConfig(input: { readonly registry: PresetProfileRegistry; readonly expectedPresetProfileVersion: string; readonly mode: CoreArrangementMode; readonly presetId: ArrangementPresetId; readonly userCaps: UserArrangementCaps; readonly assignedEnabledHarmonyTrackCount: number }): Promise<EffectiveArrangementConfig> {
  if (input.registry.presetProfileVersion !== input.expectedPresetProfileVersion) throw new RangeError("PRESET_PROFILE_VERSION_MISMATCH");
  const profile = input.registry.profiles[input.presetId];
  const maxHarmonyTracks = Math.min(input.userCaps.maxHarmonyTracks, input.assignedEnabledHarmonyTrackCount, profile.maxActiveVoiceCount - 1) as 0 | 1 | 2;
  const resolved = { ...profile, mode: input.mode, presetProfileVersion: input.registry.presetProfileVersion, presetProfileDigest: input.registry.presetProfileDigest, maxHarmonyTracks, allowOctaveDouble: input.userCaps.allowOctaveDouble && profile.allowOctaveDouble };
  const digest = await semanticDigest({ projectionSchema: "hm-effective-arrangement-config-v1", userCaps: input.userCaps, assignedEnabledHarmonyTrackCount: input.assignedEnabledHarmonyTrackCount, ...resolved });
  return { ...resolved, digest };
}
