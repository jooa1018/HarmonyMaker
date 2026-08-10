import type { Fraction } from "@/domain/fraction";
import type { SpelledPitch } from "@/domain/pitch";
import type { MusicalPosition, MusicalRange } from "@/domain/time";
import { RC7_GRAMMAR_CONFIG_DIGEST, RC7_PRESET_ORDER } from "@/review/wag-rc7/constants";
import { runRc7ReferenceCase } from "@/review/wag-rc7/harness";
import { RC7_REFERENCE_CASES } from "@/review/wag-rc7/reference-cases";
import type { Rc7ReviewOutput } from "@/review/wag-rc7/types";
import type { Rc7BrowserCase, Rc7BrowserEvent } from "./browser-types";
import { ReviewHarnessClient } from "./ReviewHarnessClient";

export const dynamic = "force-dynamic";

function fractionLabel(value: Fraction): string {
  return value.d === 1 ? `${value.n}` : `${value.n}/${value.d}`;
}

function positionLabel(position: MusicalPosition): string {
  return `m${position.performanceMeasureIndex + 1}+${fractionLabel(position.offset)}q`;
}

function rangeLabel(range: MusicalRange): string {
  return `${positionLabel(range.start)}–${positionLabel(range.end)}`;
}

function pitchLabel(pitch: SpelledPitch): string {
  const accidental = pitch.alter > 0 ? "♯".repeat(pitch.alter) : "♭".repeat(-pitch.alter);
  return `${pitch.step}${accidental}${pitch.octave}`;
}

function eventRows(output: Rc7ReviewOutput): readonly Rc7BrowserEvent[] {
  const ordinalByTrack = new Map(output.intent.verifiedAssignedTracks.map((track) => (
    [track.trackPlanId, track.trackOrdinal] as const
  )));
  const rows: Rc7BrowserEvent[] = [];
  for (const [trackPlanId, events] of Object.entries(output.generated.candidate.generatedEventsByTrack)) {
    const ordinal = ordinalByTrack.get(trackPlanId);
    if (ordinal === undefined) continue;
    const voice: Rc7BrowserEvent["voice"] = ordinal === 1 ? "Harmony 1" : "Harmony 2";
    for (const event of events) {
      rows.push({
        voice,
        range: rangeLabel(event.range),
        pitch: event.kind === "note" ? pitchLabel(event.pitch) : "rest",
        source: event.kind === "note" ? event.source : "rest",
      });
    }
  }
  return rows;
}

function toBrowserCase(
  output: Rc7ReviewOutput,
  definition: (typeof RC7_REFERENCE_CASES)[number],
): Rc7BrowserCase {
  return {
    caseId: output.caseId,
    title: output.title,
    description: definition.description,
    defaultPreset: definition.presetId,
    preset: output.preset,
    texture: output.winner.textureId,
    section: output.section,
    sectionVariant: output.sectionVariant,
    meter: output.meter === "simple-quadruple" ? "4/4" : "6/8",
    candidateId: output.generated.candidate.id,
    candidateContentDigest: output.generated.candidate.contentDigest,
    opportunityKey: output.opportunityKey,
    intentInputDigest: output.intentInputDigest,
    grammarConfigDigest: RC7_GRAMMAR_CONFIG_DIGEST,
    activeTrackOrdinals: output.winner.activeTrackOrdinals,
    roleTuple: output.winner.activeTrackPlanIds.map((trackPlanId) => (
      output.winner.roleByTrackPlanId[trackPlanId] ?? "unassigned"
    )),
    leadAttackCount: output.leadAtomsSummary.filter((atom) => atom.pitch !== null && !atom.tiedFromPrevious).length,
    harmonyAttackCount: output.activity.plan.phraseActivityPlans.reduce((count, plan) => (
      count + plan.attackEvents.length
    ), 0),
    anchorCount: output.anchor.plan.phraseAnchorPlans.reduce((count, plan) => (
      count + plan.anchorDirectives.length
    ), 0),
    rangeCheckCount: output.rangeChecks.length,
    verticalCheckCount: output.verticalLegalityChecks.length,
    nctKinds: [...new Set(output.nctClassification.filter((entry) => entry.legal)
      .map((entry) => entry.classification))],
    generatedEvents: eventRows(output),
    winnerScore: output.winner.totalScore,
    winnerScoreParts: output.winner.scoreParts,
    playback: output.playback,
  };
}

export default async function WagRc7ReviewPage() {
  const cases = await Promise.all(RC7_REFERENCE_CASES.flatMap((definition) => (
    RC7_PRESET_ORDER.map(async (preset) => toBrowserCase(
      await runRc7ReferenceCase(definition, { presetOverride: preset }),
      definition,
    ))
  )));

  return <ReviewHarnessClient cases={cases} />;
}
