import { canonicalJson } from "../../domain/digest/canonical";
import type { IntentLock } from "../../domain/locks";
import type { GeneratedHarmonyTrackPlan } from "../../domain/performer";
import { describe, expect, it } from "vitest";
import { createIntentWitness, createRc7PipelineContext } from "./authority";
import { runRc7ReferenceCase } from "./harness";
import { prepareRc7ReferenceCase } from "./prepare";
import { RC7_REFERENCE_CASES } from "./reference-cases";
import type { Rc7PreparedCase } from "./types";

const propertyCase = RC7_REFERENCE_CASES.find((definition) => definition.caseId === "C-STANDARD-CHORUS-BOUNDED-TPP")!;

async function intentDigest(prepared: Rc7PreparedCase) {
  return (await createIntentWitness(await createRc7PipelineContext(prepared))).digest;
}

describe("rc.7 semantic determinism", () => {
  it("is invariant under 101 complete runtime-ID renames and input-order shuffles", async () => {
    const runs = [];
    for (let index = 0; index < 101; index += 1) {
      runs.push(await runRc7ReferenceCase(propertyCase, {
        idNamespace: `property-source-${index}`,
        runtimeTrackPrefix: `property-track-${index}`,
        runtimePerformerPrefix: `property-performer-${index}`,
        shuffleSeed: index + 1,
      }));
    }
    expect(new Set(runs.map((output) => output.digests.musicalSourceDigest)).size).toBe(1);
    expect(new Set(runs.map((output) => output.digests.effectiveChordTimelineDigest)).size).toBe(1);
    expect(new Set(runs.map((output) => output.digests.sourceLeadAtomizationDigest)).size).toBe(1);
    expect(new Set(runs.map((output) => output.intentInputDigest)).size).toBe(1);
    expect(new Set(runs.map((output) => output.opportunityKey)).size).toBe(1);
    expect(new Set(runs.map((output) => output.winner.textureId)).size).toBe(1);
    expect(new Set(runs.map((output) => canonicalJson({
      tracks: output.winner.activeTrackOrdinals,
      roles: output.winner.semanticPayload.roleTuple,
    }))).size).toBe(1);
    expect(new Set(runs.map((output) => output.generated.candidate.contentDigest)).size).toBe(1);
    expect(new Set(runs.map((output) => output.generated.candidate.id)).size).toBe(1);
    expect(runs.every((output) => output.activity.cacheRequired === false)).toBe(true);
    expect(runs.every((output) => output.activity.traceRequired === false)).toBe(true);
  }, 120_000);

  it("changes the product Intent digest for every valid ordinal or performer semantic change", async () => {
    const base = await prepareRc7ReferenceCase(propertyCase);
    const baseDigest = await intentDigest(base);
    const generated = base.tracks.filter(
      (track): track is GeneratedHarmonyTrackPlan => track.kind === "generated-harmony",
    );
    const swappedTracks: Rc7PreparedCase = {
      ...base,
      tracks: base.tracks.map((track) => track.kind === "generated-harmony"
        ? { ...track, canonicalOrdinal: track.canonicalOrdinal === 1 ? 2 : 1 }
        : track),
    };
    const swappedPerformers: Rc7PreparedCase = {
      ...base,
      performers: base.performers.map((entry) => entry.performerOrdinal === 1
        ? { ...entry, performerOrdinal: 2 }
        : entry.performerOrdinal === 2 ? { ...entry, performerOrdinal: 1 } : entry),
    };
    const h1Assignment = base.assignments.find((assignment) => assignment.trackPlanId === generated[0].id)!;
    const h2Assignment = base.assignments.find((assignment) => assignment.trackPlanId === generated[1].id)!;
    const swappedMapping: Rc7PreparedCase = {
      ...base,
      assignments: base.assignments.map((assignment) => assignment.trackPlanId === generated[0].id
        ? { ...assignment, performerId: h2Assignment.performerId }
        : assignment.trackPlanId === generated[1].id
          ? { ...assignment, performerId: h1Assignment.performerId }
          : assignment),
    };
    const hardRangeChange: Rc7PreparedCase = {
      ...base,
      performers: base.performers.map((entry) => entry.performerOrdinal === 1
        ? { ...entry, profile: { ...entry.profile, hardRange: { ...entry.profile.hardRange, high: { step: "F", alter: 0, octave: 6 } } } }
        : entry),
    };
    const comfortableRangeChange: Rc7PreparedCase = {
      ...base,
      performers: base.performers.map((entry) => entry.performerOrdinal === 1
        ? { ...entry, profile: { ...entry.profile, comfortableRange: { ...entry.profile.comfortableRange, low: { step: "F", alter: 0, octave: 3 } } } }
        : entry),
    };
    const preferredChange: Rc7PreparedCase = {
      ...base,
      performers: base.performers.map((entry) => entry.performerOrdinal === 1
        ? { ...entry, profile: { ...entry.profile, preferredTessitura: { ...entry.profile.preferredTessitura!, low: { step: "D", alter: 0, octave: 4 } } } }
        : entry),
    };
    const textureLock: IntentLock = {
      id: "runtime-lock-id-is-not-authority",
      presetId: base.presetId,
      kind: "texture",
      phraseId: base.phrase.id,
      textureId: "TWO_PART_PARALLEL",
    };
    const intentLockChange: Rc7PreparedCase = {
      ...base,
      locks: { ...base.locks, intent: [textureLock] },
    };
    for (const changed of [
      swappedTracks,
      swappedPerformers,
      swappedMapping,
      hardRangeChange,
      comfortableRangeChange,
      preferredChange,
      intentLockChange,
    ]) {
      expect(await intentDigest(changed)).not.toBe(baseDigest);
    }
  }, 60_000);

  it("projects optional preferred tessitura only as an explicit canonical null", async () => {
    const prepared = await prepareRc7ReferenceCase(propertyCase);
    const withoutPreferred: Rc7PreparedCase = {
      ...prepared,
      performers: prepared.performers.map((entry) => {
        if (entry.performerOrdinal !== 2) return entry;
        const profile = Object.fromEntries(Object.entries(entry.profile).filter(
          ([key]) => key !== "preferredTessitura",
        )) as unknown as typeof entry.profile;
        return { ...entry, profile };
      }),
    };
    const witness = (await createIntentWitness(await createRc7PipelineContext(withoutPreferred))).witness;
    const projection = witness.authoritativeIntentInputProjection.performers.find(
      (performer) => performer.performerOrdinal === 2,
    );
    expect(projection).toHaveProperty("preferredTessitura", null);
    expect(canonicalJson(witness)).not.toContain("undefined");
  });
});
