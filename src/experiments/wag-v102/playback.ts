import type { ChordToneSpec, ParsedChord } from "../../domain/chord/model";
import { pitchMidiNumber, type SpelledPitch, type SpelledPitchClass } from "../../domain/pitch";
import { realizeSourceChordTone } from "../../grammar/local-selection";
import {
  LISTENING_COMPARISONS,
  fixtureById,
  pitchLabel,
  runExperimentSequence,
  type ListeningComparisonSpec,
  type SelectorExperimentVariant,
  type SequenceExperimentResult,
} from "./experiment";

export interface ListeningSideArtifact {
  readonly variant: SelectorExperimentVariant;
  readonly experimentDigest: string;
  readonly abc: string;
  readonly pitchLabels: readonly string[];
  readonly metrics: SequenceExperimentResult["metrics"];
  readonly traces: SequenceExperimentResult["traces"];
}

export interface ListeningItemArtifact {
  readonly id: string;
  readonly feature: ListeningComparisonSpec["feature"];
  readonly fixtureId: string;
  readonly title: string;
  readonly reverseDuplicateOf?: string;
  readonly baseline: ListeningSideArtifact;
  readonly challenger: ListeningSideArtifact;
}

const NATURAL_PC: Readonly<Record<SpelledPitch["step"], number>> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

function abcAccidental(pitch: SpelledPitch): string {
  if (pitch.alter === 0) return "=";
  return pitch.alter > 0 ? "^".repeat(pitch.alter) : "_".repeat(-pitch.alter);
}

function abcPitch(pitch: SpelledPitch): string {
  if (pitch.octave >= 5) return `${abcAccidental(pitch)}${pitch.step.toLowerCase()}${"'".repeat(pitch.octave - 5)}`;
  return `${abcAccidental(pitch)}${pitch.step}${",".repeat(Math.max(0, 4 - pitch.octave))}`;
}

function pitchClassAtOrAbove(pitchClass: SpelledPitchClass, minimumMidi: number): SpelledPitch {
  let octave = Math.floor(minimumMidi / 12) - 1;
  let result: SpelledPitch = { ...pitchClass, octave };
  while (pitchMidiNumber(result) < minimumMidi) {
    octave += 1;
    result = { ...pitchClass, octave };
  }
  return result;
}

function toneOrder(left: ChordToneSpec, right: ChordToneSpec): number {
  const priority = (tone: ChordToneSpec): number => tone.degree === 1 ? 0 : tone.degree === 5 ? 1 : tone.degree === 3 ? 2 : 3;
  return priority(left) - priority(right) || left.degree - right.degree || left.alteration - right.alteration;
}

export function experimentBandVoicing(chord: ParsedChord): readonly SpelledPitch[] {
  const bassClass = chord.bass ?? chord.root;
  const bass = pitchClassAtOrAbove(bassClass, 36);
  const result: SpelledPitch[] = [bass];
  let minimumMidi = pitchMidiNumber(bass) + 1;
  for (const tone of [...chord.tones].sort(toneOrder)) {
    const pitchClass = realizeSourceChordTone(chord.root, tone);
    if (!pitchClass) continue;
    const value = pitchClassAtOrAbove(pitchClass, minimumMidi);
    if (!result.some((existing) => pitchMidiNumber(existing) === pitchMidiNumber(value))) {
      result.push(value);
      minimumMidi = pitchMidiNumber(value) + 1;
    }
    if (result.length >= 5) break;
  }
  return result;
}

function chordToken(chord: ParsedChord): string {
  return `[${experimentBandVoicing(chord).map(abcPitch).join("")}]`;
}

function buildAbc(result: SequenceExperimentResult): string {
  const fixture = fixtureById(result.fixtureId);
  const leadTokens = fixture.decisions.map((decision) => abcPitch(decision.leadPitch));
  const harmonyTokens = result.selectedPitches.map((selected) => selected ? abcPitch(selected) : "z");
  const bandTokens = fixture.decisions.map((decision) => chordToken(decision.chord));
  return [
    "X:1",
    `T:${fixture.id}`,
    "M:4/4",
    "L:1/4",
    "Q:1/4=84",
    "K:C",
    "%%score (lead harmony) band",
    'V:lead name="Lead" clef=treble',
    'V:harmony name="Harmony" clef=treble',
    'V:band name="Band" clef=bass',
    `[V:lead] %%MIDI program 53\n${leadTokens.join(" ")} |`,
    `[V:harmony] %%MIDI program 53\n${harmonyTokens.join(" ")} |`,
    `[V:band] %%MIDI program 0\n${bandTokens.join(" ")} |`,
    "",
  ].join("\n");
}

function side(result: SequenceExperimentResult): ListeningSideArtifact {
  return {
    variant: result.variant,
    experimentDigest: result.semanticDigest,
    abc: buildAbc(result),
    pitchLabels: result.selectedPitches.map(pitchLabel),
    metrics: result.metrics,
    traces: result.traces,
  };
}

export async function buildListeningItem(spec: ListeningComparisonSpec): Promise<ListeningItemArtifact> {
  const fixture = fixtureById(spec.fixtureId);
  const baseline = await runExperimentSequence(fixture, spec.baselineVariant);
  const challenger = await runExperimentSequence(fixture, spec.challengerVariant, baseline.selectedPitches);
  return {
    id: spec.id,
    feature: spec.feature,
    fixtureId: fixture.id,
    title: fixture.title,
    ...(spec.reverseDuplicateOf ? { reverseDuplicateOf: spec.reverseDuplicateOf } : {}),
    baseline: side(baseline),
    challenger: side(challenger),
  };
}

export async function buildListeningManifest(): Promise<readonly ListeningItemArtifact[]> {
  return Promise.all(LISTENING_COMPARISONS.map(buildListeningItem));
}

export function validateListeningParity(item: ListeningItemArtifact): boolean {
  const fixture = fixtureById(item.fixtureId);
  const baselineBand = fixture.decisions.map((decision) => experimentBandVoicing(decision.chord).map(pitchMidiNumber));
  const challengerBand = fixture.decisions.map((decision) => experimentBandVoicing(decision.chord).map(pitchMidiNumber));
  const lead = fixture.decisions.map((decision) => pitchMidiNumber(decision.leadPitch));
  return JSON.stringify(baselineBand) === JSON.stringify(challengerBand)
    && lead.length === item.baseline.pitchLabels.length
    && lead.length === item.challenger.pitchLabels.length;
}

export function soundingPitchClass(pitch: SpelledPitch): number {
  return ((NATURAL_PC[pitch.step] + pitch.alter) % 12 + 12) % 12;
}
