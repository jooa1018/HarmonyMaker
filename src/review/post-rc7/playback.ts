import { addFractions, compareFractions, equalFractions, fraction, multiplyFractions, subtractFractions, type Fraction } from "../../domain/fraction";
import { pitchMidiNumber, type Alter, type SpelledPitch, type SpelledPitchClass, type Step } from "../../domain/pitch";
import type { ChordToneSpec, ParsedChord } from "../../domain/chord/model";
import type { ResearchArrangement, ResearchChordSpan, ResearchNoteEvent, PlaybackMix, RendererTier } from "./types";

export interface PlaybackProjectionEvent {
  readonly onsetQ: Fraction;
  readonly durationQ: Fraction;
  readonly pitch: SpelledPitch;
  readonly syllableId: string;
  readonly attack: boolean;
  readonly lyricOnset: boolean;
  readonly sourceEventIds: readonly string[];
}

export interface BandPlaybackProjectionEvent {
  readonly onsetQ: Fraction;
  readonly durationQ: Fraction;
  readonly sourceChordSymbol: string;
  readonly pitches: readonly SpelledPitch[];
  readonly sourceChordEventIds: readonly string[];
}

export interface ResearchPlaybackArtifact {
  readonly mix: PlaybackMix;
  readonly rendererTier: RendererTier;
  readonly renderer: "abcjs-6.7.0";
  readonly soundSource: "browser-synth-no-voicebank";
  readonly licenseProvenance: "synthetic-original-fixtures";
  readonly abc: string;
  readonly sourceEventIds: readonly string[];
  readonly sourceChordEventIds: readonly string[];
  readonly playbackProjection: {
    readonly lead: readonly PlaybackProjectionEvent[];
    readonly harmony: readonly PlaybackProjectionEvent[];
    readonly band: readonly BandPlaybackProjectionEvent[];
  };
}

const STEPS: readonly Step[] = ["C", "D", "E", "F", "G", "A", "B"];
const NATURAL_PC: Readonly<Record<Step, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const DEGREE_SEMITONES: Readonly<Record<number, number>> = { 1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11, 9: 14, 11: 17, 13: 21 };
const mod = (value: number, divisor: number): number => ((value % divisor) + divisor) % divisor;

function accidental(pitch: ResearchNoteEvent["pitch"]): string {
  if (pitch.alter === 0) return "=";
  return pitch.alter > 0 ? "^".repeat(pitch.alter) : "_".repeat(-pitch.alter);
}

function abcPitch(pitch: SpelledPitch): string {
  if (pitch.octave >= 5) return `${accidental(pitch)}${pitch.step.toLowerCase()}${"'".repeat(pitch.octave - 5)}`;
  return `${accidental(pitch)}${pitch.step}${",".repeat(Math.max(0, 4 - pitch.octave))}`;
}

function tonePitchClass(chord: ParsedChord, tone: ChordToneSpec): SpelledPitchClass {
  const rootIndex = STEPS.indexOf(chord.root.step);
  const degreeOffset = (tone.degree - 1) % 7;
  const step = STEPS[mod(rootIndex + degreeOffset, 7)];
  const rootPc = mod(NATURAL_PC[chord.root.step] + chord.root.alter, 12);
  const desiredPc = mod(rootPc + DEGREE_SEMITONES[tone.degree] + tone.alteration, 12);
  const alter = mod(desiredPc - NATURAL_PC[step] + 6, 12) - 6;
  if (alter < -2 || alter > 2) throw new Error("UNSPELLABLE_SOURCE_CHORD_TONE");
  return { step, alter: alter as Alter };
}

function pitchClassAtOrAbove(pitchClass: SpelledPitchClass, minimumMidi: number): SpelledPitch {
  let octave = Math.floor(minimumMidi / 12) - 1;
  let candidate: SpelledPitch = { ...pitchClass, octave };
  while (pitchMidiNumber(candidate) < minimumMidi) {
    octave += 1;
    candidate = { ...pitchClass, octave };
  }
  return candidate;
}

/**
 * Review-playback-only voicing: Source bass, then fifth, root, and remaining
 * declared Source tones in canonical degree order. No harmony-generation state
 * or candidate ranking is consulted.
 */
export function sourceChordBandVoicing(chord: ParsedChord): readonly SpelledPitch[] {
  const bassClass = chord.bass ?? chord.root;
  const bass = pitchClassAtOrAbove(bassClass, 36);
  const paired = chord.tones.map((tone) => ({ tone, pitchClass: tonePitchClass(chord, tone) }));
  const ordered = [
    ...paired.filter(({ tone }) => tone.degree === 5),
    ...paired.filter(({ tone }) => tone.degree === 1),
    ...paired.filter(({ tone }) => tone.degree !== 5 && tone.degree !== 1),
  ];
  const voiced: SpelledPitch[] = [bass];
  let minimumMidi = pitchMidiNumber(bass) + 1;
  for (const { pitchClass } of ordered) {
    const value = pitchClassAtOrAbove(pitchClass, minimumMidi);
    voiced.push(value);
    minimumMidi = pitchMidiNumber(value) + 1;
  }
  return voiced;
}

function sameVoicing(left: readonly SpelledPitch[], right: readonly SpelledPitch[]): boolean {
  return left.length === right.length
    && left.every((pitch, index) => pitchMidiNumber(pitch) === pitchMidiNumber(right[index]));
}

export function createBandPlaybackProjection(chords: readonly ResearchChordSpan[]): readonly BandPlaybackProjectionEvent[] {
  const ordered = [...chords].sort((left, right) => compareFractions(left.onsetQ, right.onsetQ));
  const projected: BandPlaybackProjectionEvent[] = [];
  for (const chord of ordered) {
    const pitches = sourceChordBandVoicing(chord.chord);
    const previous = projected[projected.length - 1];
    const contiguous = previous && equalFractions(addFractions(previous.onsetQ, previous.durationQ), chord.onsetQ);
    if (previous
      && contiguous
      && previous.sourceChordSymbol === chord.chord.canonicalSymbol
      && sameVoicing(previous.pitches, pitches)) {
      projected[projected.length - 1] = {
        ...previous,
        durationQ: addFractions(previous.durationQ, chord.durationQ),
        sourceChordEventIds: [...previous.sourceChordEventIds, chord.id],
      };
      continue;
    }
    projected.push({
      onsetQ: chord.onsetQ,
      durationQ: chord.durationQ,
      sourceChordSymbol: chord.chord.canonicalSymbol,
      pitches,
      sourceChordEventIds: [chord.id],
    });
  }
  return projected;
}

function abcLength(durationQ: Fraction): string {
  const eighthUnits = multiplyFractions(durationQ, fraction(2));
  if (eighthUnits.n === eighthUnits.d) return "";
  if (eighthUnits.d === 1) return String(eighthUnits.n);
  if (eighthUnits.n === 1) return `/${eighthUnits.d}`;
  return `${eighthUnits.n}/${eighthUnits.d}`;
}

function sameSoundingPitch(left: SpelledPitch, right: SpelledPitch): boolean {
  return pitchMidiNumber(left) === pitchMidiNumber(right);
}

export function coalescePlaybackEvents(events: readonly ResearchNoteEvent[]): readonly PlaybackProjectionEvent[] {
  const ordered = [...events].sort((left, right) => compareFractions(left.onsetQ, right.onsetQ));
  const projected: PlaybackProjectionEvent[] = [];
  for (const event of ordered) {
    const previous = projected[projected.length - 1];
    const contiguous = previous && equalFractions(addFractions(previous.onsetQ, previous.durationQ), event.onsetQ);
    if (
      previous
      && contiguous
      && sameSoundingPitch(previous.pitch, event.pitch)
      && previous.syllableId === event.syllableId
      && event.attack === false
    ) {
      projected[projected.length - 1] = {
        ...previous,
        durationQ: addFractions(previous.durationQ, event.durationQ),
        sourceEventIds: [...previous.sourceEventIds, event.id],
      };
      continue;
    }
    projected.push({
      onsetQ: event.onsetQ,
      durationQ: event.durationQ,
      pitch: event.pitch,
      syllableId: event.syllableId,
      attack: event.attack,
      lyricOnset: event.lyricOnset,
      sourceEventIds: [event.id],
    });
  }
  return projected;
}

function voiceAbc(events: readonly PlaybackProjectionEvent[], totalDurationQ: Fraction): string {
  const tokens: string[] = [];
  let cursor = fraction(0);
  for (const event of events) {
    if (compareFractions(cursor, event.onsetQ) < 0) tokens.push(`z${abcLength(subtractFractions(event.onsetQ, cursor))}`);
    tokens.push(`${abcPitch(event.pitch)}${abcLength(event.durationQ)}`);
    cursor = addFractions(event.onsetQ, event.durationQ);
  }
  if (compareFractions(cursor, totalDurationQ) < 0) tokens.push(`z${abcLength(subtractFractions(totalDurationQ, cursor))}`);
  return `${tokens.join(" ")} |`;
}

function bandVoiceAbc(events: readonly BandPlaybackProjectionEvent[], totalDurationQ: Fraction): string {
  const tokens: string[] = [];
  let cursor = fraction(0);
  for (const event of events) {
    if (compareFractions(cursor, event.onsetQ) < 0) tokens.push(`z${abcLength(subtractFractions(event.onsetQ, cursor))}`);
    tokens.push(`[${event.pitches.map(abcPitch).join("")}]${abcLength(event.durationQ)}`);
    cursor = addFractions(event.onsetQ, event.durationQ);
  }
  if (compareFractions(cursor, totalDurationQ) < 0) tokens.push(`z${abcLength(subtractFractions(totalDurationQ, cursor))}`);
  return `${tokens.join(" ")} |`;
}

function maxEnd(events: readonly { readonly onsetQ: Fraction; readonly durationQ: Fraction }[]): Fraction {
  return events.reduce((max, event) => {
    const end = addFractions(event.onsetQ, event.durationQ);
    return compareFractions(end, max) > 0 ? end : max;
  }, fraction(0));
}

export function createPlaybackArtifact(
  arrangement: ResearchArrangement,
  mix: PlaybackMix,
  rendererTier: RendererTier = "COMPETENT_PLAIN",
  sourceChords: readonly ResearchChordSpan[] = [],
): ResearchPlaybackArtifact {
  const includeLead = mix !== "HARMONY_ONLY" && mix !== "BAND_ONLY";
  const includeHarmony = mix !== "LEAD_ONLY" && mix !== "BAND_ONLY";
  const includeBand = mix === "BAND_ONLY" || mix === "BAND_LEAD_AND_HARMONY";
  if (includeBand && sourceChords.length === 0) throw new Error("BAND_CONTEXT_REQUIRES_SOURCE_CHORDS");
  const totalDurationQ = maxEnd([...arrangement.lead, ...arrangement.harmony, ...(includeBand ? sourceChords : [])]);
  const projectedLead = coalescePlaybackEvents(arrangement.lead);
  const projectedHarmony = coalescePlaybackEvents(arrangement.harmony);
  const projectedBand = createBandPlaybackProjection(sourceChords);
  const melodicScore = includeLead && includeHarmony ? "(lead harmony)"
    : includeLead ? "(lead)"
      : includeHarmony ? "(harmony)" : "";
  const score = [melodicScore, includeBand ? "band" : ""].filter(Boolean).join(" ");
  const program = rendererTier === "POOR" ? 80 : 53;
  const headers = [
    "X:1", `T:${arrangement.fixtureId} · ${arrangement.baselineId} · ${mix}`,
    "M:4/4", "L:1/8", "Q:1/4=88", "K:C", `%%score ${score}`,
    ...(includeLead ? ['V:lead name="Lead" clef=treble'] : []),
    ...(includeHarmony ? ['V:harmony name="Harmony 1" clef=treble'] : []),
    ...(includeBand ? ['V:band name="Source chord band" clef=bass'] : []),
  ];
  const body = [
    ...(includeLead ? [`[V:lead] %%MIDI program ${program}\n${voiceAbc(projectedLead, totalDurationQ)}`] : []),
    ...(includeHarmony ? [`[V:harmony] %%MIDI program ${program}\n${voiceAbc(projectedHarmony, totalDurationQ)}`] : []),
    ...(includeBand ? [`[V:band] %%MIDI program 0\n${bandVoiceAbc(projectedBand, totalDurationQ)}`] : []),
  ];
  const sourceEvents = [...(includeLead ? arrangement.lead : []), ...(includeHarmony ? arrangement.harmony : [])];
  const sourceChordEventIds = includeBand ? sourceChords.map((chord) => chord.id) : [];
  return {
    mix,
    rendererTier,
    renderer: "abcjs-6.7.0",
    soundSource: "browser-synth-no-voicebank",
    licenseProvenance: "synthetic-original-fixtures",
    abc: `${headers.join("\n")}\n${body.join("\n")}\n`,
    sourceEventIds: [...sourceEvents.map((event) => event.id), ...sourceChordEventIds],
    sourceChordEventIds,
    playbackProjection: {
      lead: includeLead ? projectedLead : [],
      harmony: includeHarmony ? projectedHarmony : [],
      band: includeBand ? projectedBand : [],
    },
  };
}
