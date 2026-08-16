import { APPLICATION_ALGORITHM_VERSION_REGISTRY } from "../app/algorithm-version-registry";
import type { ChordToneSpec, ParsedChord } from "../domain/chord/model";
import { semanticDigest, type SemanticDigest } from "../domain/digest/canonical";
import type { EffectiveChordTimeline } from "../domain/harmony/chord-timeline";
import { pitchMidiNumber, type Alter, type SpelledPitch, type SpelledPitchClass, type Step } from "../domain/pitch";
import type { MusicalRange } from "../domain/time";

export interface AccompanimentConfig {
  readonly version: "accompaniment-v1";
  readonly configDigest: SemanticDigest;
  readonly padMaxTones: number;
  readonly bassOctave: number;
  readonly padRegisterLow: SpelledPitch;
  readonly padRegisterHigh: SpelledPitch;
  readonly velocity: number;
  readonly voicingPolicy: "semantic-compact-ascending-v1";
  readonly soundAssetVersion: "hm-band-pad-bass-v1";
  readonly normalizationVersion: "fixed-velocity-normalization-v1";
}

export interface AccompanimentSpan {
  readonly id: string;
  readonly range: MusicalRange;
  readonly bassPitch: SpelledPitch;
  readonly padPitches: readonly SpelledPitch[];
  readonly velocity: number;
}

export interface DeterministicAccompaniment {
  readonly version: "accompaniment-v1";
  readonly configDigest: SemanticDigest;
  readonly effectiveChordTimelineDigest: SemanticDigest;
  readonly spans: readonly AccompanimentSpan[];
  readonly contentDigest: SemanticDigest;
}

const STEPS: readonly Step[] = ["C", "D", "E", "F", "G", "A", "B"];
const NATURAL_SEMITONES: Readonly<Record<Step, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const MAJOR_SCALE_OFFSET = [0, 2, 4, 5, 7, 9, 11] as const;
const CONFIG_PAYLOAD = Object.freeze({
  projectionSchema: "hm-accompaniment-config-v1",
  version: APPLICATION_ALGORITHM_VERSION_REGISTRY.accompanimentVersion,
  padMaxTones: 7,
  bassOctave: 2,
  padRegisterLow: { step: "C" as const, alter: 0 as const, octave: 3 },
  padRegisterHigh: { step: "C" as const, alter: 0 as const, octave: 5 },
  velocity: 72,
  voicingPolicy: "semantic-compact-ascending-v1" as const,
  soundAssetVersion: "hm-band-pad-bass-v1" as const,
  normalizationVersion: "fixed-velocity-normalization-v1" as const,
});
export const ACCOMPANIMENT_CONFIG_DIGEST = "e15cdb1f539cae882d1238e3a57fe22422b484148a86b52dd8b78ae3ca24f21e" as SemanticDigest;

function mod12(value: number): number {
  return ((value % 12) + 12) % 12;
}

function realizeTone(root: SpelledPitchClass, tone: ChordToneSpec): SpelledPitchClass | undefined {
  const degreeIndex = (tone.degree - 1) % 7;
  const targetStep = STEPS[(STEPS.indexOf(root.step) + degreeIndex) % 7];
  const targetPc = mod12(NATURAL_SEMITONES[root.step] + root.alter + MAJOR_SCALE_OFFSET[degreeIndex] + tone.alteration);
  const alteration = ([-2, -1, 0, 1, 2] as const).find((candidate) =>
    mod12(NATURAL_SEMITONES[targetStep] + candidate) === targetPc);
  return alteration === undefined ? undefined : { step: targetStep, alter: alteration as Alter };
}

function compactPitch(pitchClass: SpelledPitchClass, low: SpelledPitch, high: SpelledPitch): SpelledPitch | undefined {
  for (let octave = low.octave - 1; octave <= high.octave + 1; octave += 1) {
    const pitch = { ...pitchClass, octave };
    if (pitchMidiNumber(pitch) >= pitchMidiNumber(low) && pitchMidiNumber(pitch) <= pitchMidiNumber(high)) return pitch;
  }
  return undefined;
}

function voicing(chord: ParsedChord, config: AccompanimentConfig): readonly SpelledPitch[] {
  const pitches = chord.tones.flatMap((tone) => {
    const pitchClass = realizeTone(chord.root, tone);
    const pitch = pitchClass ? compactPitch(pitchClass, config.padRegisterLow, config.padRegisterHigh) : undefined;
    return pitch ? [pitch] : [];
  }).sort((left, right) => pitchMidiNumber(left) - pitchMidiNumber(right));
  const distinct = pitches.filter((pitch, index) => index === 0
    || pitch.step !== pitches[index - 1].step || pitch.alter !== pitches[index - 1].alter);
  return distinct.slice(0, config.padMaxTones);
}

export async function loadAccompanimentConfig(): Promise<AccompanimentConfig> {
  if (APPLICATION_ALGORITHM_VERSION_REGISTRY.accompanimentVersion !== "accompaniment-v1") {
    throw new RangeError("ALGORITHM_CONFIG_MISMATCH");
  }
  const configDigest = await semanticDigest(CONFIG_PAYLOAD);
  if (configDigest !== ACCOMPANIMENT_CONFIG_DIGEST) throw new RangeError("ALGORITHM_CONFIG_MISMATCH");
  return { ...CONFIG_PAYLOAD, version: "accompaniment-v1", configDigest };
}

export async function generateDeterministicAccompaniment(
  timeline: EffectiveChordTimeline,
): Promise<DeterministicAccompaniment> {
  const config = await loadAccompanimentConfig();
  const payloads = timeline.spans.flatMap((span) => {
    if (span.parseResult.status !== "ok") return [];
    const chord = span.parseResult.chord;
    const bassClass = chord.bass ?? chord.root;
    return [{
      range: span.range,
      bassPitch: { ...bassClass, octave: config.bassOctave },
      padPitches: voicing(chord, config),
      velocity: config.velocity,
    }];
  });
  const contentDigest = await semanticDigest({
    projectionSchema: "hm-accompaniment-content-v1",
    version: config.version,
    configDigest: config.configDigest,
    effectiveChordTimelineDigest: timeline.digest,
    spans: payloads,
  });
  const spans = payloads.map((span, ordinal): AccompanimentSpan => ({
    id: `acc:${contentDigest}:${ordinal}`,
    ...span,
  }));
  return {
    version: config.version,
    configDigest: config.configDigest,
    effectiveChordTimelineDigest: timeline.digest,
    spans,
    contentDigest,
  };
}
