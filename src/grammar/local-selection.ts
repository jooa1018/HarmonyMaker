import type { ChordToneSpec, ParsedChord } from "../domain/chord/model";
import type { EffectiveArrangementConfig } from "../domain/config";
import type { SemanticDigest } from "../domain/digest/canonical";
import type { PerformerProfile, VocalPlacementRole } from "../domain/performer";
import {
  containsPitch,
  pitchMidiNumber,
  type SpelledPitch,
  type SpelledPitchClass,
  type Step,
} from "../domain/pitch";
import type { MusicalRange } from "../domain/time";

const STEPS: readonly Step[] = ["C", "D", "E", "F", "G", "A", "B"];
const NATURAL_SEMITONE: Readonly<Record<Step, number>> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};
const MAJOR_SCALE_OFFSET = [0, 2, 4, 5, 7, 9, 11] as const;
const TONE_ROLE_ORDINAL = { root: 0, third: 1, fifth: 2, seventh: 3, color: 4, suspension: 5 } as const;
const TONE_ORIGIN_ORDINAL = { root: 0, quality: 1, extension: 2, addition: 3, alteration: 4, suspension: 5 } as const;

export type LocalDecisionTrigger =
  | "LEAD_ATTACK"
  | "CANONICAL_CHORD_BOUNDARY"
  | "CANONICAL_PHRASE_BOUNDARY"
  | "CANONICAL_SECTION_BOUNDARY"
  | "STAGE_LOCK_BOUNDARY";

export interface LocalHarmonyDecisionContext {
  readonly phraseId: string;
  readonly trackPlanId: string;
  readonly placementRole: VocalPlacementRole;
  readonly sourceLeadAtomizationDigest: SemanticDigest;
  readonly leadAtomId: string;
  readonly exactRange: MusicalRange;
  readonly chordSpanId: string;
  readonly leadPitch: SpelledPitch;
  readonly trigger: LocalDecisionTrigger;
  readonly lyricOnset: boolean;
  readonly previousSoundingPitch?: SpelledPitch;
  readonly continuityState: "continuous" | "reentry" | "initial";
}

export type V0HarmonyCandidateFamily =
  | "LEGAL_CONTINUATION"
  | "LOW_MOTION_CHORD_TONE"
  | "CHORD_AWARE_THIRD_SIXTH"
  | "CONTEXTUAL_CHORD_TONE"
  | "REST";

type V0PitchCandidateFamily = Exclude<V0HarmonyCandidateFamily, "REST">;

export interface LocalSelectionConstraints {
  /** Whether Activity/current-stage locks permit the frozen hard-impossibility rest fallback. */
  readonly restFallback: "permitted" | "forbidden";
  /** Exact pitches retained by already-resolved stage locks. Omit when there is no pitch lock. */
  readonly allowedPitches?: readonly SpelledPitch[];
  /** Sounding pitches unavailable because of an already-resolved exact collision constraint. */
  readonly collisionPitches?: readonly SpelledPitch[];
}

export interface SourceToneExclusion {
  readonly tone: ChordToneSpec;
  readonly reason: "SOURCE_CHORD_TONE_SPELLING_UNREPRESENTABLE";
}

export interface RankedLocalHarmonyCandidate {
  readonly tone: ChordToneSpec;
  readonly pitch: SpelledPitch;
  readonly family: V0PitchCandidateFamily;
  readonly rankTuple: readonly number[];
}

interface LocalSelectionCommon {
  readonly leadIsSourceChordTone: boolean;
  readonly candidates: readonly RankedLocalHarmonyCandidate[];
  readonly sourceToneExclusions: readonly SourceToneExclusion[];
}

export type LocalSelectionResult =
  | (LocalSelectionCommon & { readonly status: "note"; readonly selected: RankedLocalHarmonyCandidate })
  | (LocalSelectionCommon & { readonly status: "rest"; readonly reason: "LOCAL_REST_HARD_IMPOSSIBILITY" })
  | (LocalSelectionCommon & { readonly status: "blocked"; readonly code: "GEN_NO_PITCH_CANDIDATE" });

function mod12(value: number): number {
  return ((value % 12) + 12) % 12;
}

export function realizeSourceChordTone(
  root: SpelledPitchClass,
  tone: ChordToneSpec,
): SpelledPitchClass | undefined {
  const degreeClassIndex = (tone.degree - 1) % 7;
  const targetStep = STEPS[(STEPS.indexOf(root.step) + degreeClassIndex) % 7];
  const rootPc = mod12(NATURAL_SEMITONE[root.step] + root.alter);
  const targetPc = mod12(rootPc + MAJOR_SCALE_OFFSET[degreeClassIndex] + tone.alteration);
  const targetAlter = ([-2, -1, 0, 1, 2] as const).find(
    (alter) => mod12(NATURAL_SEMITONE[targetStep] + alter) === targetPc,
  );
  return targetAlter === undefined ? undefined : { step: targetStep, alter: targetAlter };
}

function compareTone(left: ChordToneSpec, right: ChordToneSpec): number {
  return left.degree - right.degree
    || left.alteration - right.alteration
    || TONE_ROLE_ORDINAL[left.role] - TONE_ROLE_ORDINAL[right.role]
    || TONE_ORIGIN_ORDINAL[left.origin] - TONE_ORIGIN_ORDINAL[right.origin];
}

function toneKey(tone: ChordToneSpec): string {
  return `${tone.degree}:${tone.alteration}:${TONE_ROLE_ORDINAL[tone.role]}:${TONE_ORIGIN_ORDINAL[tone.origin]}`;
}

function samePitch(left: SpelledPitch, right: SpelledPitch): boolean {
  return left.step === right.step && left.alter === right.alter && left.octave === right.octave;
}

function exactPitchAllowed(pitch: SpelledPitch, constraints: LocalSelectionConstraints): boolean {
  if (constraints.allowedPitches && !constraints.allowedPitches.some((allowed) => samePitch(allowed, pitch))) return false;
  const midi = pitchMidiNumber(pitch);
  return !constraints.collisionPitches?.some((occupied) => pitchMidiNumber(occupied) === midi);
}

function enumerateTonePitches(pitchClass: SpelledPitchClass, performer: PerformerProfile): readonly SpelledPitch[] {
  const result: SpelledPitch[] = [];
  for (let octave = -2; octave <= 10; octave += 1) {
    const pitch = { ...pitchClass, octave };
    const midi = pitchMidiNumber(pitch);
    if (midi >= 0 && midi <= 127 && containsPitch(performer.hardRange, pitch)) result.push(pitch);
  }
  return result;
}

function pitchClassEquals(pitch: SpelledPitch, pitchClass: SpelledPitchClass): boolean {
  return mod12(pitchMidiNumber(pitch)) === mod12(NATURAL_SEMITONE[pitchClass.step] + pitchClass.alter);
}

function genericThirdOrSixth(lead: SpelledPitch, harmony: SpelledPitch): boolean {
  const leadIndex = lead.octave * 7 + STEPS.indexOf(lead.step);
  const harmonyIndex = harmony.octave * 7 + STEPS.indexOf(harmony.step);
  const simpleClass = (Math.abs(harmonyIndex - leadIndex) % 7) + 1;
  return simpleClass === 3 || simpleClass === 6;
}

function rangeBand(pitch: SpelledPitch, performer: PerformerProfile): number {
  if (performer.preferredTessitura && containsPitch(performer.preferredTessitura, pitch)) return 0;
  if (containsPitch(performer.comfortableRange, pitch)) return performer.preferredTessitura ? 1 : 0;
  return 2;
}

function leadProximity(motionFromLead: number): number {
  return motionFromLead >= 3 ? 0 : motionFromLead === 2 ? 1 : 2;
}

function compareRank(left: readonly number[], right: readonly number[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function pitchTuple(pitch: SpelledPitch): readonly number[] {
  return [pitchMidiNumber(pitch), STEPS.indexOf(pitch.step), pitch.alter, pitch.octave];
}

function candidateKey(tone: ChordToneSpec, pitch: SpelledPitch): string {
  return `${toneKey(tone)}:${pitchTuple(pitch).join(":")}`;
}

export function selectLocalHarmonyDecision(
  context: LocalHarmonyDecisionContext,
  chord: ParsedChord,
  performer: PerformerProfile,
  config: EffectiveArrangementConfig,
  constraints: LocalSelectionConstraints = { restFallback: "permitted" },
): LocalSelectionResult {
  const canonicalTones = [...chord.tones].sort(compareTone).filter(
    (tone, index, tones) => index === 0 || toneKey(tone) !== toneKey(tones[index - 1]),
  );
  const realizedTones = canonicalTones.map((tone) => ({ tone, pitchClass: realizeSourceChordTone(chord.root, tone) }));
  const sourceToneExclusions: SourceToneExclusion[] = realizedTones
    .filter((entry): entry is { readonly tone: ChordToneSpec; readonly pitchClass: undefined } => entry.pitchClass === undefined)
    .map(({ tone }) => ({ tone, reason: "SOURCE_CHORD_TONE_SPELLING_UNREPRESENTABLE" }));
  const leadIsSourceChordTone = realizedTones.some(
    ({ pitchClass }) => pitchClass !== undefined && pitchClassEquals(context.leadPitch, pitchClass),
  );
  const leadMidi = pitchMidiNumber(context.leadPitch);
  const previousMidi = context.continuityState === "continuous" && context.previousSoundingPitch
    ? pitchMidiNumber(context.previousSoundingPitch)
    : undefined;
  const toneOrdinal = new Map(canonicalTones.map((tone, ordinal) => [tone, ordinal]));
  const seen = new Set<string>();
  const candidates: RankedLocalHarmonyCandidate[] = [];

  for (const { tone, pitchClass } of realizedTones) {
    if (!pitchClass) continue;
    for (const pitch of enumerateTonePitches(pitchClass, performer)) {
      const candidateMidi = pitchMidiNumber(pitch);
      if (context.placementRole === "upper" ? candidateMidi <= leadMidi : candidateMidi >= leadMidi) continue;
      const motion = previousMidi === undefined ? 0 : Math.abs(candidateMidi - previousMidi);
      if (previousMidi !== undefined && motion > config.hardMaxLeapSemitones) continue;
      if (!exactPitchAllowed(pitch, constraints)) continue;
      const key = candidateKey(tone, pitch);
      if (seen.has(key)) continue;
      seen.add(key);

      const thirdOrSixth = genericThirdOrSixth(context.leadPitch, pitch);
      const legalContinuation = !leadIsSourceChordTone && previousMidi !== undefined && candidateMidi === previousMidi;
      const lowMotion = !leadIsSourceChordTone && !legalContinuation && motion <= 2;
      const family: V0PitchCandidateFamily = legalContinuation
        ? "LEGAL_CONTINUATION"
        : lowMotion
          ? "LOW_MOTION_CHORD_TONE"
          : thirdOrSixth
            ? "CHORD_AWARE_THIRD_SIXTH"
            : "CONTEXTUAL_CHORD_TONE";
      const thirdOrSixthOrdinal = family === "CHORD_AWARE_THIRD_SIXTH" ? 0 : 1;
      const sourceColorPolicyOrdinal = tone.role === "color" && !config.allowColorTones ? 1 : 0;
      const preferredLeapViolation = motion > config.preferredMaxLeapSemitones ? 1 : 0;
      const preferredLeapExcess = Math.max(0, motion - config.preferredMaxLeapSemitones);
      const commonTail = [
        sourceColorPolicyOrdinal,
        rangeBand(pitch, performer),
        preferredLeapViolation,
        preferredLeapExcess,
        leadProximity(Math.abs(candidateMidi - leadMidi)),
        motion,
        toneOrdinal.get(tone) as number,
        context.placementRole === "upper" ? candidateMidi : -candidateMidi,
        ...pitchTuple(pitch),
      ];
      const rankTuple = leadIsSourceChordTone
        ? [thirdOrSixthOrdinal, ...commonTail]
        : [
            family === "LEGAL_CONTINUATION" ? 0 : 1,
            family === "LEGAL_CONTINUATION" || family === "LOW_MOTION_CHORD_TONE" ? 0 : 1,
            thirdOrSixthOrdinal,
            ...commonTail,
          ];
      candidates.push({ tone, pitch, family, rankTuple });
    }
  }

  candidates.sort((left, right) => compareRank(left.rankTuple, right.rankTuple));
  const common = { leadIsSourceChordTone, candidates, sourceToneExclusions } as const;
  if (candidates.length > 0) return { ...common, status: "note", selected: candidates[0] };
  return constraints.restFallback === "permitted"
    ? { ...common, status: "rest", reason: "LOCAL_REST_HARD_IMPOSSIBILITY" }
    : { ...common, status: "blocked", code: "GEN_NO_PITCH_CANDIDATE" };
}
