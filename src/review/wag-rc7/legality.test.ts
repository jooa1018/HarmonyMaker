import type { AnchorLock, SolverLock } from "../../domain/locks";
import { pitchMidiNumber } from "../../domain/pitch";
import { describe, expect, it } from "vitest";
import { createRc7PipelineContext } from "./authority";
import { toneForPitch } from "./music";
import { prepareRc7ReferenceCase } from "./prepare";
import { RC7_DEFAULT_PERFORMERS, RC7_REFERENCE_CASES } from "./reference-cases";
import { runRc7GenerationStage, selectNctPath } from "./solver";
import { runRc7ActivityStage, runRc7AnchorStage, runRc7IntentStage } from "./stages";
import type { Rc7PreparedCase, Rc7ReferenceCaseDefinition } from "./types";

function definition(caseId: string) {
  return RC7_REFERENCE_CASES.find((candidate) => candidate.caseId === caseId)!;
}

async function generate(prepared: Rc7PreparedCase) {
  const context = await createRc7PipelineContext(prepared);
  const intent = await runRc7IntentStage(context);
  const activity = await runRc7ActivityStage(context, intent);
  const anchor = await runRc7AnchorStage(context, activity);
  const generated = await runRc7GenerationStage(context, intent, activity, anchor);
  return { context, intent, activity, anchor, generated };
}

describe("rc.7 hard music legality", () => {
  it("supports exactly one, two, or three assigned singers without out-of-range output", async () => {
    const sources: Rc7ReferenceCaseDefinition[] = [
      {
        ...definition("A-SPARSE-BASE-VERSE"),
        caseId: "LEGALITY-ONE-SINGER",
        maxHarmonyTracks: 0,
        performerEntries: RC7_DEFAULT_PERFORMERS.slice(0, 1),
      },
      {
        ...definition("B-CUE-ACTIVE-UNISON"),
        caseId: "LEGALITY-TWO-SINGERS",
        maxHarmonyTracks: 1,
        performerEntries: RC7_DEFAULT_PERFORMERS.slice(0, 2),
      },
      {
        ...definition("C-STANDARD-CHORUS-BOUNDED-TPP"),
        caseId: "LEGALITY-THREE-SINGERS",
        maxHarmonyTracks: 2,
        performerEntries: RC7_DEFAULT_PERFORMERS,
      },
    ];
    for (const source of sources) {
      const result = await generate(await prepareRc7ReferenceCase(source));
      expect(result.generated.rangeChecks.every((check) => check.insideHardRange)).toBe(true);
      expect(result.intent.assignedTracks.length).toBe(source.performerEntries!.length - 1);
    }
  }, 30_000);

  it("hard-rejects a fresh independent unison attack", async () => {
    const base = await prepareRc7ReferenceCase(definition("C-STANDARD-CHORUS-BOUNDED-TPP"));
    const automatic = await generate(base);
    const directive = automatic.anchor.plan.phraseAnchorPlans[0].anchorDirectives[0];
    if (directive.kind !== "chord-tone") throw new Error("fixture drift");
    const leadPitch = base.sourceLeadAtomization.atoms.find((atom) => (
      atom.pitch && atom.range.start.performanceMeasureIndex === directive.position.performanceMeasureIndex
        && atom.range.start.offset.n * directive.position.offset.d
          === directive.position.offset.n * atom.range.start.offset.d
    ))?.pitch;
    const span = base.effectiveChordTimeline.spans.find((candidate) => candidate.id === directive.chordSpanId);
    if (!leadPitch || span?.parseResult.status !== "ok") throw new Error("fixture drift");
    const leadTone = toneForPitch(span.parseResult.chord, leadPitch);
    if (!leadTone) throw new Error("fixture drift");
    const anchorLock: AnchorLock = {
      id: "independent-unison-anchor",
      kind: "anchor-chord-tone",
      presetId: base.presetId,
      phraseId: base.phrase.id,
      trackPlanId: directive.trackPlanId,
      position: directive.position,
      chordSpanId: directive.chordSpanId,
      selectedTone: leadTone,
    };
    const solverLock: SolverLock = {
      id: "independent-unison-pitch",
      kind: "pitch",
      presetId: base.presetId,
      phraseId: base.phrase.id,
      trackPlanId: directive.trackPlanId,
      position: directive.position,
      pitch: leadPitch,
    };
    const prepared: Rc7PreparedCase = {
      ...base,
      locks: { ...base.locks, anchor: [anchorLock], solver: [solverLock] },
    };
    await expect(generate(prepared)).rejects.toThrow("NO_LEGAL_VOICING");
  }, 30_000);

  it("hard-rejects a sustained Pad that would overlap the Lead by a semitone", async () => {
    const source = definition("F-SUSTAINED-PAD");
    const custom: Rc7ReferenceCaseDefinition = {
      ...source,
      caseId: "LEGALITY-PAD-SEMITONE",
      notes: source.notes.map((note, index) => index === 0
        ? { ...note, pitch: { step: "E", alter: 0, octave: 5 } }
        : index === 1
          ? { ...note, pitch: { step: "F", alter: 1, octave: 5 } }
          : note),
    };
    const raw = await prepareRc7ReferenceCase(custom);
    const base: Rc7PreparedCase = {
      ...raw,
      locks: {
        ...raw.locks,
        intent: [{
          id: "pad-texture-lock",
          kind: "texture",
          presetId: raw.presetId,
          phraseId: raw.phrase.id,
          textureId: "SUSTAINED_PAD",
        }],
      },
    };
    const automatic = await generate(base);
    expect(automatic.intent.selection.winner.textureId).toBe("SUSTAINED_PAD");
    const directive = automatic.anchor.plan.phraseAnchorPlans[0].anchorDirectives[0];
    if (directive.kind !== "chord-tone") throw new Error("fixture drift");
    const span = base.effectiveChordTimeline.spans.find((candidate) => candidate.id === directive.chordSpanId);
    if (span?.parseResult.status !== "ok") throw new Error("fixture drift");
    const fifth = span.parseResult.chord.tones.find((tone) => tone.role === "fifth");
    if (!fifth) throw new Error("fixture drift");
    const anchorLock: AnchorLock = {
      id: "pad-root-anchor",
      kind: "anchor-chord-tone",
      presetId: base.presetId,
      phraseId: base.phrase.id,
      trackPlanId: directive.trackPlanId,
      position: directive.position,
      chordSpanId: directive.chordSpanId,
      selectedTone: fifth,
    };
    const solverLock: SolverLock = {
      id: "pad-c5-pitch",
      kind: "pitch",
      presetId: base.presetId,
      phraseId: base.phrase.id,
      trackPlanId: directive.trackPlanId,
      position: directive.position,
      pitch: { step: "G", alter: 0, octave: 5 },
    };
    await expect(generate({
      ...base,
      locks: { ...base.locks, anchor: [anchorLock], solver: [solverLock] },
    })).rejects.toThrow("PAD_SEMITONE_COLLISION");
  }, 30_000);

  it("realizes an exact preparation, suspension hold, and bounded step resolution", async () => {
    const result = await generate(await prepareRc7ReferenceCase(definition("G-SUSPENSION-RELEASE")));
    const nct = result.anchor.plan.phraseAnchorPlans[0].nctPlans[0];
    expect(nct.kind).toBe("suspension");
    if (nct.kind !== "suspension") throw new Error("fixture drift");
    const anchors = new Map(result.generated.realizedAnchors.map((anchor) => [anchor.directiveId, anchor.pitch]));
    const preparation = anchors.get(nct.preparationDirectiveId);
    const resolution = anchors.get(nct.resolutionDirectiveId);
    if (!preparation || !resolution) throw new Error("fixture drift");
    const signed = pitchMidiNumber(resolution) - pitchMidiNumber(preparation);
    expect(Math.abs(signed)).toBeGreaterThanOrEqual(1);
    expect(Math.abs(signed)).toBeLessThanOrEqual(2);
    expect(Math.sign(signed)).toBe(nct.resolutionDirection === "up" ? 1 : -1);
    const notes = Object.values(result.generated.candidate.generatedEventsByTrack).flat()
      .filter((event) => event.kind === "note");
    expect(notes.some((event) => event.kind === "note" && event.source === "planned-nct" && event.tieStop)).toBe(true);
    expect(result.generated.candidate.metrics.plannedNctResolution.valueBp).toBe(10_000);
  }, 30_000);

  it("uses strict NCT path improvement and lets exact ties choose the plain path", () => {
    expect(selectNctPath(999, 1_000)).toBe("nct");
    expect(selectNctPath(1_000, 1_000)).toBe("plain");
    expect(selectNctPath(1_001, 1_000)).toBe("plain");
  });

  it("rejects duplicate anchor targets and never selects a hard-pruned rescue pitch", async () => {
    const base = await prepareRc7ReferenceCase(definition("C-STANDARD-CHORUS-BOUNDED-TPP"));
    const automatic = await generate(base);
    const directive = automatic.anchor.plan.phraseAnchorPlans[0].anchorDirectives[0];
    if (directive.kind !== "chord-tone") throw new Error("fixture drift");
    const lock = (id: string): AnchorLock => ({
      id,
      kind: "anchor-chord-tone",
      presetId: base.presetId,
      phraseId: base.phrase.id,
      trackPlanId: directive.trackPlanId,
      position: directive.position,
      chordSpanId: directive.chordSpanId,
      selectedTone: directive.selectedTone,
    });
    await expect(generate({
      ...base,
      locks: { ...base.locks, anchor: [lock("duplicate-a"), lock("duplicate-b")] },
    })).rejects.toThrow();
    expect(automatic.generated.pitchTrace.filter((entry) => entry.selected)
      .every((entry) => entry.eligible && entry.rejectionReasons.length === 0)).toBe(true);
  }, 30_000);
});
