import { describe, expect, it } from "vitest";
import { createPresetProfileRegistry, isCoreArrangementMode, resolveEffectiveArrangementConfig, validateArrangementSettings } from "./config";
import { pitchRange } from "./pitch";
import { SOURCE_LEAD_TRACK, validateAssignments, validatePerformer, validateTrackPlans, type PerformerProfile, type VocalTrackPlan } from "./performer";

describe("performer, track, and preset config", () => {
  it("enforces performer range nesting including preferred tessitura", () => {
    const profile: PerformerProfile = {
      id: "performer:0", displayName: "Singer",
      hardRange: pitchRange({ step: "C", alter: 0, octave: 3 }, { step: "C", alter: 0, octave: 5 }),
      comfortableRange: pitchRange({ step: "E", alter: 0, octave: 3 }, { step: "A", alter: 0, octave: 4 }),
      preferredTessitura: pitchRange({ step: "G", alter: 0, octave: 3 }, { step: "G", alter: 0, octave: 4 }),
    };
    expect(validatePerformer(profile)).toBe(true);
    expect(validatePerformer({ ...profile, preferredTessitura: profile.hardRange })).toBe(false);
  });

  it("keeps Source Lead ordinal zero and generated ordinals contiguous", () => {
    const plans: VocalTrackPlan[] = [SOURCE_LEAD_TRACK, { kind: "generated-harmony", id: "track:1", displayLabel: "Harmony 1", canonicalOrdinal: 1, enabled: true }, { kind: "generated-harmony", id: "track:2", displayLabel: "Harmony 2", canonicalOrdinal: 2, enabled: false }];
    expect(validateTrackPlans(plans)).toBe(true);
    expect(validateTrackPlans([SOURCE_LEAD_TRACK, { kind: "generated-harmony", id: "track:bad", displayLabel: "Bad", canonicalOrdinal: 2, enabled: true }])).toBe(false);
    const performer = { id: "p:0", displayName: "Lead", hardRange: pitchRange({ step: "C", alter: 0, octave: 3 }, { step: "C", alter: 0, octave: 5 }), comfortableRange: pitchRange({ step: "D", alter: 0, octave: 3 }, { step: "B", alter: 0, octave: 4 }) };
    expect(validateAssignments([SOURCE_LEAD_TRACK], [performer], [{ trackPlanId: SOURCE_LEAD_TRACK.id, performerId: performer.id }])).toEqual([]);
  });

  it("runtime-rejects impossible Core mode and unordered/duplicate presets", () => {
    expect(isCoreArrangementMode({ profileId: "worship-band-v1", harmonicContext: "standalone-vocal" })).toBe(false);
    expect(validateArrangementSettings({ mode: { profileId: "worship-band-v1", harmonicContext: "band-supported" }, requestedPresetIds: ["simple", "standard"], userCaps: { maxHarmonyTracks: 2, allowOctaveDouble: true } })).toBe(true);
    expect(validateArrangementSettings({ mode: { profileId: "worship-band-v1", harmonicContext: "band-supported" }, requestedPresetIds: ["full", "simple"], userCaps: { maxHarmonyTracks: 2, allowOctaveDouble: true } })).toBe(false);
  });

  it("builds independent preset provenance and applies user caps", async () => {
    const registry = await createPresetProfileRegistry("preset-v1");
    const mode = { profileId: "worship-band-v1", harmonicContext: "band-supported" } as const;
    const simple = await resolveEffectiveArrangementConfig({ registry, expectedPresetProfileVersion: "preset-v1", mode, presetId: "simple", userCaps: { maxHarmonyTracks: 2, allowOctaveDouble: true }, assignedEnabledHarmonyTrackCount: 2 });
    const full = await resolveEffectiveArrangementConfig({ registry, expectedPresetProfileVersion: "preset-v1", mode, presetId: "full", userCaps: { maxHarmonyTracks: 1, allowOctaveDouble: false }, assignedEnabledHarmonyTrackCount: 2 });
    expect(simple.digest).not.toBe(full.digest);
    expect(simple.maxHarmonyTracks).toBe(1);
    expect(full.maxHarmonyTracks).toBe(1);
    expect(full.allowOctaveDouble).toBe(false);
    await expect(resolveEffectiveArrangementConfig({ registry, expectedPresetProfileVersion: "wrong", mode, presetId: "full", userCaps: { maxHarmonyTracks: 1, allowOctaveDouble: false }, assignedEnabledHarmonyTrackCount: 1 })).rejects.toThrow("PRESET_PROFILE_VERSION_MISMATCH");
  });
});
