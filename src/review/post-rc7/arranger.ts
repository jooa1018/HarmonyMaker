import type { ChordToneSpec, ParsedChord } from "../../domain/chord/model";
import { semanticDigest, semanticId, type SemanticDigest } from "../../domain/digest/canonical";
import { addFractions, compareFractions, subtractFractions, type Fraction } from "../../domain/fraction";
import { containsPitch, pitchMidiNumber, type Alter, type SpelledPitch, type SpelledPitchClass, type Step } from "../../domain/pitch";
import type { ResearchActivitySchedule, ResearchArrangement, ResearchBaselineId, ResearchChordSpan, ResearchFixture, ResearchNoteEvent } from "./types";

const STEPS: readonly Step[] = ["C", "D", "E", "F", "G", "A", "B"];
const NATURAL_PC: Readonly<Record<Step, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const DEGREE_SEMITONES: Readonly<Record<number, number>> = { 1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11, 9: 14, 11: 17, 13: 21 };

export type CandidateFamily = "NAIVE_FIXED_THIRD" | "CHORD_AWARE_THIRD_SIXTH" | "LEGAL_CONTINUATION" | "LOW_MOTION_CHORD_TONE" | "CONTEXTUAL_CHORD_TONE" | "REST";
export type CandidateRejection = "PLACEMENT" | "HARD_RANGE" | "HARD_LEAP";

export interface CandidateTrace {
  readonly id: string;
  readonly pitch: SpelledPitch | null;
  readonly family: CandidateFamily;
  readonly sourceChordTone: boolean;
  readonly chordClash: boolean;
  readonly relation: string | null;
  readonly rankTuple: readonly number[];
  readonly rejectionReasons: readonly CandidateRejection[];
  readonly selected: boolean;
}

export interface DecisionTrace {
  readonly id: string;
  readonly onsetQ: Fraction;
  readonly durationQ: Fraction;
  readonly syllableId: string;
  readonly lyric: string;
  readonly leadPitch: SpelledPitch;
  readonly sourceChordSymbol: string;
  readonly leadIsSourceChordTone: boolean;
  readonly trigger: "LEAD_ATTACK" | "CANONICAL_CHORD_BOUNDARY";
  readonly selectedCandidateId: string;
  readonly candidates: readonly CandidateTrace[];
}

export interface BaselineResult {
  readonly arrangement: ResearchArrangement;
  readonly decisionTrace: readonly DecisionTrace[];
  readonly scheduleDigest: SemanticDigest;
  readonly arrangementDigest: SemanticDigest;
}

interface DecisionSegment {
  readonly onsetQ: Fraction;
  readonly durationQ: Fraction;
  readonly lead: ResearchNoteEvent;
  readonly chord: ResearchChordSpan;
  readonly trigger: "LEAD_ATTACK" | "CANONICAL_CHORD_BOUNDARY";
  readonly allowRest: boolean;
}

const mod = (value: number, modulus: number): number => ((value % modulus) + modulus) % modulus;
const endOf = (event: { readonly onsetQ: Fraction; readonly durationQ: Fraction }): Fraction => addFractions(event.onsetQ, event.durationQ);
const sameFraction = (left: Fraction, right: Fraction): boolean => left.n === right.n && left.d === right.d;
const pitchClassMidi = (pitch: SpelledPitchClass): number => mod(NATURAL_PC[pitch.step] + pitch.alter, 12);

function chordAt(chords: readonly ResearchChordSpan[], at: Fraction): ResearchChordSpan | undefined {
  return chords.find((span) => compareFractions(span.onsetQ, at) <= 0 && compareFractions(at, endOf(span)) < 0);
}

function leadAt(lead: readonly ResearchNoteEvent[], at: Fraction): ResearchNoteEvent | undefined {
  return lead.find((event) => compareFractions(event.onsetQ, at) <= 0 && compareFractions(at, endOf(event)) < 0);
}

function decisionSegments(fixture: ResearchFixture): readonly DecisionSegment[] {
  const raw = [...fixture.lead.flatMap((event) => [event.onsetQ, endOf(event)]), ...fixture.chords.flatMap((span) => [span.onsetQ, endOf(span)])];
  const boundaries = raw
    .filter((value, index) => raw.findIndex((candidate) => sameFraction(value, candidate)) === index)
    .sort(compareFractions);
  const result: DecisionSegment[] = [];
  for (let index = 0; index + 1 < boundaries.length; index += 1) {
    const onsetQ = boundaries[index];
    const lead = leadAt(fixture.lead, onsetQ);
    const chord = chordAt(fixture.chords, onsetQ);
    if (!lead || !chord) continue;
    result.push({
      onsetQ,
      durationQ: subtractFractions(boundaries[index + 1], onsetQ),
      lead,
      chord,
      trigger: sameFraction(lead.onsetQ, onsetQ) ? "LEAD_ATTACK" : "CANONICAL_CHORD_BOUNDARY",
      allowRest: true,
    });
  }
  return result;
}

function scheduleFor(fixture: ResearchFixture, baselineId: ResearchBaselineId, allSegments: readonly DecisionSegment[]): ResearchActivitySchedule {
  if (baselineId !== "B1.5-E2E") return fixture.matchedActivitySchedule;
  return {
    id: `${fixture.id}:activity:full-phrase-lead-coupled-v0`,
    policy: "FULL_PHRASE_LEAD_COUPLED_V0",
    slots: allSegments.map((segment, index) => ({
      id: `${fixture.id}:activity:e2e-slot:${index}`,
      onsetQ: segment.onsetQ,
      durationQ: segment.durationQ,
      allowHarmony: true,
      allowRest: true,
      source: "FULL_PHRASE_LEAD_COUPLED_V0",
    })),
  };
}

function tonePitchClass(chord: ParsedChord, tone: ChordToneSpec): SpelledPitchClass {
  const rootIndex = STEPS.indexOf(chord.root.step);
  const degreeOffset = (tone.degree - 1) % 7;
  const step = STEPS[mod(rootIndex + degreeOffset, 7)];
  const desiredPc = mod(pitchClassMidi(chord.root) + DEGREE_SEMITONES[tone.degree] + tone.alteration, 12);
  const alter = mod(desiredPc - NATURAL_PC[step] + 6, 12) - 6;
  if (alter < -2 || alter > 2) throw new Error("UNSPELLABLE_CHORD_TONE");
  return { step, alter: alter as Alter };
}

export function sourceChordPitchClasses(chord: ParsedChord): readonly SpelledPitchClass[] {
  return chord.tones.map((tone) => tonePitchClass(chord, tone));
}

function isChordTone(pitch: SpelledPitch, chord: ParsedChord): boolean {
  return sourceChordPitchClasses(chord).some((candidate) => pitchClassMidi(candidate) === mod(pitchMidiNumber(pitch), 12));
}

function directedRelation(lead: SpelledPitch, harmony: SpelledPitch): string {
  const leadOrdinal = lead.octave * 7 + STEPS.indexOf(lead.step);
  const harmonyOrdinal = harmony.octave * 7 + STEPS.indexOf(harmony.step);
  const delta = harmonyOrdinal - leadOrdinal;
  return `${delta < 0 ? "LOWER" : delta > 0 ? "UPPER" : "UNISON"}_${Math.abs(delta) + 1}`;
}

function isThirdOrSixth(relation: string): boolean {
  const generic = Number(relation.split("_")[1]);
  return mod(generic - 1, 7) + 1 === 3 || mod(generic - 1, 7) + 1 === 6;
}

function fixedThird(lead: SpelledPitch, placement: "upper" | "lower"): SpelledPitch {
  const direction = placement === "upper" ? 1 : -1;
  const targetMidi = pitchMidiNumber(lead) + direction * 4;
  const sourceOrdinal = lead.octave * 7 + STEPS.indexOf(lead.step);
  const targetOrdinal = sourceOrdinal + direction * 2;
  const step = STEPS[mod(targetOrdinal, 7)];
  const octave = Math.floor(targetOrdinal / 7);
  const naturalMidi = (octave + 1) * 12 + NATURAL_PC[step];
  const alter = targetMidi - naturalMidi;
  if (alter < -2 || alter > 2) throw new Error("UNSPELLABLE_FIXED_THIRD");
  return { step, alter: alter as Alter, octave };
}

function hardLegalFixedThird(lead: SpelledPitch, fixture: ResearchFixture): SpelledPitch | undefined {
  const raw = fixedThird(lead, fixture.placement);
  const leadMidi = pitchMidiNumber(lead);
  return Array.from({ length: 7 }, (_, index) => ({ ...raw, octave: index + 1 }))
    .filter((pitch) => containsPitch(fixture.performer.hardRange, pitch))
    .filter((pitch) => fixture.placement === "upper" ? pitchMidiNumber(pitch) > leadMidi : pitchMidiNumber(pitch) < leadMidi)
    .sort((left, right) => Math.abs(pitchMidiNumber(left) - pitchMidiNumber(raw)) - Math.abs(pitchMidiNumber(right) - pitchMidiNumber(raw)))[0];
}

function candidateFamily(lead: SpelledPitch, pitch: SpelledPitch, previous: SpelledPitch | undefined, leadChordTone: boolean): CandidateFamily {
  const relation = directedRelation(lead, pitch);
  if (leadChordTone && isThirdOrSixth(relation)) return "CHORD_AWARE_THIRD_SIXTH";
  if (previous && pitchMidiNumber(previous) === pitchMidiNumber(pitch)) return "LEGAL_CONTINUATION";
  if (previous && Math.abs(pitchMidiNumber(previous) - pitchMidiNumber(pitch)) <= 2) return "LOW_MOTION_CHORD_TONE";
  return "CONTEXTUAL_CHORD_TONE";
}

function enumerateCandidates(segment: DecisionSegment, fixture: ResearchFixture, previous: SpelledPitch | undefined): readonly Omit<CandidateTrace, "id" | "selected">[] {
  const leadMidi = pitchMidiNumber(segment.lead.pitch);
  const leadChordTone = isChordTone(segment.lead.pitch, segment.chord.chord);
  const values: Omit<CandidateTrace, "id" | "selected">[] = [];
  for (const pitchClass of sourceChordPitchClasses(segment.chord.chord)) {
    for (let octave = 1; octave <= 7; octave += 1) {
      const pitch: SpelledPitch = { ...pitchClass, octave };
      const midi = pitchMidiNumber(pitch);
      const relation = directedRelation(segment.lead.pitch, pitch);
      const family = candidateFamily(segment.lead.pitch, pitch, previous, leadChordTone);
      const rejectionReasons: CandidateRejection[] = [];
      if (fixture.placement === "upper" ? midi <= leadMidi : midi >= leadMidi) rejectionReasons.push("PLACEMENT");
      if (!containsPitch(fixture.performer.hardRange, pitch)) rejectionReasons.push("HARD_RANGE");
      const motion = previous ? Math.abs(midi - pitchMidiNumber(previous)) : 0;
      if (previous && motion > fixture.hardLeapSemitones) rejectionReasons.push("HARD_LEAP");
      const clash = Math.abs(midi - leadMidi) <= 2 ? 1 : 0;
      const preferredExcess = Math.max(0, motion - fixture.preferredLeapSemitones);
      const tessituraMiss = fixture.performer.preferredTessitura && !containsPitch(fixture.performer.preferredTessitura, pitch) ? 1 : 0;
      const primary = isThirdOrSixth(relation) ? 0 : 1;
      const continuation = previous && midi === pitchMidiNumber(previous) ? 0 : 1;
      const lowMotion = previous && motion <= 2 ? 0 : 1;
      const roleOrdinal = fixture.placement === "upper" ? midi : -midi;
      const rankTuple = leadChordTone
        ? [primary, clash, motion, preferredExcess, tessituraMiss, roleOrdinal]
        : [continuation, lowMotion, primary, clash, motion, preferredExcess, tessituraMiss, roleOrdinal];
      values.push({ pitch, family, sourceChordTone: true, chordClash: false, relation, rankTuple, rejectionReasons });
    }
  }
  return values.sort((left, right) => {
    for (let index = 0; index < Math.max(left.rankTuple.length, right.rankTuple.length); index += 1) {
      const difference = (left.rankTuple[index] ?? 0) - (right.rankTuple[index] ?? 0);
      if (difference !== 0) return difference;
    }
    return pitchMidiNumber(left.pitch!) - pitchMidiNumber(right.pitch!);
  });
}

async function eventFor(segment: DecisionSegment, fixture: ResearchFixture, baselineId: ResearchBaselineId, pitch: SpelledPitch): Promise<ResearchNoteEvent> {
  const projection = { fixtureId: fixture.id, baselineId, onsetQ: segment.onsetQ, durationQ: segment.durationQ, pitch, syllableId: segment.lead.syllableId };
  return {
    id: await semanticId("post-rc7-note", projection),
    onsetQ: segment.onsetQ,
    durationQ: segment.durationQ,
    pitch,
    syllableId: segment.lead.syllableId,
    lyric: segment.lead.lyric,
    lyricOnset: segment.trigger === "LEAD_ATTACK" && segment.lead.lyricOnset,
    attack: segment.trigger === "LEAD_ATTACK",
    provenance: segment.trigger === "LEAD_ATTACK" ? "LEAD_COUPLED" : "CANONICAL_CHORD_BOUNDARY",
  };
}

export async function generateBaseline(fixture: ResearchFixture, baselineId: ResearchBaselineId): Promise<BaselineResult> {
  const allSegments = decisionSegments(fixture);
  const schedule = scheduleFor(fixture, baselineId, allSegments);
  const segments = schedule.slots.filter((slot) => slot.allowHarmony).map((slot) => {
    const segment = allSegments.find((candidate) => sameFraction(candidate.onsetQ, slot.onsetQ) && sameFraction(candidate.durationQ, slot.durationQ));
    if (!segment) throw new Error("ACTIVITY_SLOT_DOES_NOT_MATCH_CANONICAL_DECISION_GRID");
    return { ...segment, allowRest: slot.allowRest };
  });
  const harmony: ResearchNoteEvent[] = [];
  const decisionTrace: DecisionTrace[] = [];
  let previous = fixture.seedHarmonyPitch;

  if (baselineId !== "B0") {
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      if (baselineId === "B1") {
        const pitch = hardLegalFixedThird(segment.lead.pitch, fixture);
        if (!pitch) {
          if (!segment.allowRest) throw new Error("NO_LEGAL_B1_CANDIDATE_AND_REST_FORBIDDEN");
          const restId = await semanticId("post-rc7-candidate", { fixtureId: fixture.id, baselineId, index, rest: true });
          decisionTrace.push({
            id: await semanticId("post-rc7-decision", { fixtureId: fixture.id, baselineId, index }),
            onsetQ: segment.onsetQ, durationQ: segment.durationQ, syllableId: segment.lead.syllableId, lyric: segment.lead.lyric,
            leadPitch: segment.lead.pitch, sourceChordSymbol: segment.chord.chord.canonicalSymbol,
            leadIsSourceChordTone: isChordTone(segment.lead.pitch, segment.chord.chord), trigger: segment.trigger,
            selectedCandidateId: restId,
            candidates: [{ id: restId, pitch: null, family: "REST", sourceChordTone: false, chordClash: false, relation: null, rankTuple: [9_999], rejectionReasons: [], selected: true }],
          });
          continue;
        }
        const candidateId = await semanticId("post-rc7-candidate", { fixtureId: fixture.id, baselineId, index, pitch });
        harmony.push(await eventFor(segment, fixture, baselineId, pitch));
        decisionTrace.push({
          id: await semanticId("post-rc7-decision", { fixtureId: fixture.id, baselineId, index }),
          onsetQ: segment.onsetQ, durationQ: segment.durationQ, syllableId: segment.lead.syllableId, lyric: segment.lead.lyric,
          leadPitch: segment.lead.pitch, sourceChordSymbol: segment.chord.chord.canonicalSymbol,
          leadIsSourceChordTone: isChordTone(segment.lead.pitch, segment.chord.chord), trigger: segment.trigger,
          selectedCandidateId: candidateId,
          candidates: [{ id: candidateId, pitch, family: "NAIVE_FIXED_THIRD", sourceChordTone: isChordTone(pitch, segment.chord.chord), chordClash: !isChordTone(pitch, segment.chord.chord), relation: directedRelation(segment.lead.pitch, pitch), rankTuple: [], rejectionReasons: [], selected: true }],
        });
        previous = pitch;
        continue;
      }

      const raw = enumerateCandidates(segment, fixture, previous);
      const selectedIndex = raw.findIndex((candidate) => candidate.rejectionReasons.length === 0);
      if (selectedIndex < 0 && !segment.allowRest) throw new Error("NO_LEGAL_B15_CANDIDATE_AND_REST_FORBIDDEN");
      const candidateIds = await Promise.all(raw.map((candidate) => semanticId("post-rc7-candidate", { fixtureId: fixture.id, baselineId, index, pitch: candidate.pitch })));
      const restId = await semanticId("post-rc7-candidate", { fixtureId: fixture.id, baselineId, index, rest: true });
      const candidates: CandidateTrace[] = raw.map((candidate, candidateIndex) => ({ ...candidate, id: candidateIds[candidateIndex], selected: candidateIndex === selectedIndex }));
      candidates.push({ id: restId, pitch: null, family: "REST", sourceChordTone: false, chordClash: false, relation: null, rankTuple: [9_999], rejectionReasons: [], selected: selectedIndex < 0 });
      if (selectedIndex >= 0) {
        const selected = raw[selectedIndex];
        harmony.push(await eventFor(segment, fixture, baselineId, selected.pitch!));
        previous = selected.pitch!;
      }
      decisionTrace.push({
        id: await semanticId("post-rc7-decision", { fixtureId: fixture.id, baselineId, index }),
        onsetQ: segment.onsetQ, durationQ: segment.durationQ, syllableId: segment.lead.syllableId, lyric: segment.lead.lyric,
        leadPitch: segment.lead.pitch, sourceChordSymbol: segment.chord.chord.canonicalSymbol,
        leadIsSourceChordTone: isChordTone(segment.lead.pitch, segment.chord.chord), trigger: segment.trigger,
        selectedCandidateId: selectedIndex >= 0 ? candidateIds[selectedIndex] : restId,
        candidates,
      });
    }
  }

  const arrangement: ResearchArrangement = { fixtureId: fixture.id, baselineId, lead: fixture.lead, harmony };
  return {
    arrangement,
    decisionTrace,
    scheduleDigest: await semanticDigest({ policy: schedule.policy, slots: schedule.slots }),
    arrangementDigest: await semanticDigest(arrangement),
  };
}

export function longestRepeatedRelation(trace: readonly DecisionTrace[]): { readonly relation: string | null; readonly count: number } {
  let bestRelation: string | null = null;
  let bestCount = 0;
  let currentRelation: string | null = null;
  let currentCount = 0;
  for (const decision of trace) {
    const relation = decision.candidates.find((candidate) => candidate.selected)?.relation ?? null;
    if (relation !== null && relation === currentRelation) currentCount += 1;
    else { currentRelation = relation; currentCount = relation === null ? 0 : 1; }
    if (currentCount > bestCount) { bestCount = currentCount; bestRelation = currentRelation; }
  }
  return { relation: bestRelation, count: bestCount };
}

export interface HumanReferenceCandidateSpaceAudit {
  readonly status: "AVAILABLE_NOT_POPULATED" | "REFERENCE_IN_CANDIDATE_SPACE" | "REFERENCE_OUTSIDE_CANDIDATE_SPACE";
  readonly candidateId: string | null;
  readonly rejectionReasons: readonly CandidateRejection[];
}

export function auditHumanReferenceCandidateSpace(decision: DecisionTrace, referencePitch?: SpelledPitch): HumanReferenceCandidateSpaceAudit {
  if (!referencePitch) return { status: "AVAILABLE_NOT_POPULATED", candidateId: null, rejectionReasons: [] };
  const candidate = decision.candidates.find((item) => item.pitch && item.pitch.step === referencePitch.step && item.pitch.alter === referencePitch.alter && item.pitch.octave === referencePitch.octave);
  return candidate
    ? { status: "REFERENCE_IN_CANDIDATE_SPACE", candidateId: candidate.id, rejectionReasons: candidate.rejectionReasons }
    : { status: "REFERENCE_OUTSIDE_CANDIDATE_SPACE", candidateId: null, rejectionReasons: [] };
}
