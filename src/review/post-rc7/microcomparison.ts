import { parseChord } from "../../domain/chord/parser";
import type { ParsedChord } from "../../domain/chord/model";
import { addFractions, compareFractions, fraction, multiplyFractions, subtractFractions, type Fraction } from "../../domain/fraction";
import { pitchMidiNumber, type Alter, type SpelledPitch, type Step } from "../../domain/pitch";
import { sourceChordPitchClasses } from "./arranger";

export type MicroReferenceId = "A" | "B" | "C";
export type MicroPlaybackMix = "H1_ONLY" | "LEAD_AND_H1" | "BAND_LEAD_AND_H1" | "BAND_ONLY";

export interface MicroNoteEvent {
  readonly id: string;
  readonly onsetQ: Fraction;
  readonly durationQ: Fraction;
  readonly pitch: SpelledPitch;
}

export interface MicroHarmonyEvent extends MicroNoteEvent {
  readonly provenance: "HUMAN_SPECIFIED_MICROREFERENCE";
}

export interface MicroBandEvent {
  readonly id: string;
  readonly onsetQ: Fraction;
  readonly durationQ: Fraction;
  readonly pitches: readonly SpelledPitch[];
}

export interface MicroChordSpan {
  readonly id: string;
  readonly onsetQ: Fraction;
  readonly durationQ: Fraction;
  readonly sourceText: string;
  readonly chord: ParsedChord;
}

export interface MicroAnalysisRow {
  readonly onsetQ: Fraction;
  readonly leadPitch: string;
  readonly sourceChord: string;
  readonly harmonyPitch: string;
  readonly genericInterval: string;
  readonly chromaticInterval: string;
  readonly chordTone: boolean;
  readonly harmonyMotion: string;
}

export interface MicroReference {
  readonly id: MicroReferenceId;
  readonly fixtureId: string;
  readonly provenance: "HUMAN_SPECIFIED_MICROREFERENCE";
  readonly lead: readonly MicroNoteEvent[];
  readonly chords: readonly MicroChordSpan[];
  readonly band: readonly MicroBandEvent[];
  readonly harmony: readonly MicroHarmonyEvent[];
  readonly analysis: readonly MicroAnalysisRow[];
}

export interface MicroPlaybackArtifact {
  readonly referenceId: MicroReferenceId;
  readonly mix: MicroPlaybackMix;
  readonly rendererTier: "COMPETENT_PLAIN";
  readonly renderer: "abcjs-6.7.0";
  readonly soundSource: "browser-synth-no-voicebank";
  readonly licenseProvenance: "project-original-static-microfixture";
  readonly abc: string;
  readonly sourceEventIds: readonly string[];
  readonly playbackProjection: {
    readonly lead: readonly MicroNoteEvent[];
    readonly harmony: readonly MicroHarmonyEvent[];
    readonly band: readonly MicroBandEvent[];
  };
}

const STEPS: readonly Step[] = ["C", "D", "E", "F", "G", "A", "B"];
const TOTAL_DURATION_Q = fraction(4);

const pitch = (step: Step, octave: number, alter: Alter = 0): SpelledPitch => ({ step, alter, octave });

const noteEvents = (voice: "lead" | "h1", pitches: readonly SpelledPitch[]): readonly MicroNoteEvent[] =>
  pitches.map((value, index) => ({
    id: `hm-micro-nct-v0:${voice}:${index}`,
    onsetQ: fraction(index),
    durationQ: fraction(1),
    pitch: value,
  }));

const chordSpan = (sourceText: string, onsetQ: number, durationQ: number, index: number): MicroChordSpan => {
  const parsed = parseChord(sourceText);
  if (parsed.status !== "ok") throw new Error(`MICROFIXTURE_CHORD_PARSE_FAILURE:${sourceText}`);
  return {
    id: `hm-micro-nct-v0:chord:${index}`,
    onsetQ: fraction(onsetQ),
    durationQ: fraction(durationQ),
    sourceText,
    chord: parsed.chord,
  };
};

const LEAD = noteEvents("lead", [pitch("C", 4), pitch("D", 4), pitch("E", 4), pitch("G", 4)]);
const CHORDS = [chordSpan("C", 0, 2, 0), chordSpan("F", 2, 2, 1)] as const;
const BAND: readonly MicroBandEvent[] = [
  {
    id: "hm-micro-nct-v0:band:0",
    onsetQ: fraction(0),
    durationQ: fraction(2),
    pitches: [pitch("C", 2), pitch("G", 2), pitch("C", 3), pitch("E", 3)],
  },
  {
    id: "hm-micro-nct-v0:band:1",
    onsetQ: fraction(2),
    durationQ: fraction(2),
    pitches: [pitch("F", 2), pitch("C", 3), pitch("F", 3), pitch("A", 3)],
  },
] as const;

const HARMONIES: Readonly<Record<MicroReferenceId, readonly SpelledPitch[]>> = {
  A: [pitch("E", 4), pitch("E", 4), pitch("F", 4), pitch("C", 5)],
  B: [pitch("E", 4), pitch("E", 4), pitch("G", 4), pitch("C", 5)],
  C: [pitch("E", 4), pitch("F", 4), pitch("G", 4), pitch("C", 5)],
};

const mod = (value: number, divisor: number): number => ((value % divisor) + divisor) % divisor;

export function pitchName(value: SpelledPitch): string {
  const accidental = value.alter < 0 ? "b".repeat(-value.alter) : "#".repeat(value.alter);
  return `${value.step}${accidental}${value.octave}`;
}

function chordAt(onsetQ: Fraction): MicroChordSpan {
  const found = CHORDS.find((span) =>
    compareFractions(span.onsetQ, onsetQ) <= 0
    && compareFractions(onsetQ, addFractions(span.onsetQ, span.durationQ)) < 0);
  if (!found) throw new Error("MICROFIXTURE_CHORD_GAP");
  return found;
}

function genericInterval(lead: SpelledPitch, harmony: SpelledPitch): string {
  const leadOrdinal = lead.octave * 7 + STEPS.indexOf(lead.step);
  const harmonyOrdinal = harmony.octave * 7 + STEPS.indexOf(harmony.step);
  const generic = Math.abs(harmonyOrdinal - leadOrdinal) + 1;
  const suffix = generic % 10 === 1 && generic % 100 !== 11 ? "st"
    : generic % 10 === 2 && generic % 100 !== 12 ? "nd"
      : generic % 10 === 3 && generic % 100 !== 13 ? "rd" : "th";
  return `${generic}${suffix}`;
}

function chromaticInterval(lead: SpelledPitch, harmony: SpelledPitch): string {
  const generic = Number.parseInt(genericInterval(lead, harmony), 10);
  const semitones = Math.abs(pitchMidiNumber(harmony) - pitchMidiNumber(lead));
  const names: Readonly<Record<string, string>> = {
    "1:0": "perfect unison",
    "2:1": "minor 2nd",
    "2:2": "major 2nd",
    "3:3": "minor 3rd",
    "3:4": "major 3rd",
    "4:5": "perfect 4th",
    "5:7": "perfect 5th",
    "6:8": "minor 6th",
    "6:9": "major 6th",
  };
  return names[`${generic}:${semitones}`] ?? `${semitones} semitones`;
}

function isSourceChordTone(value: SpelledPitch, span: MicroChordSpan): boolean {
  return sourceChordPitchClasses(span.chord).some((candidate) => {
    const natural: Readonly<Record<Step, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    return mod(natural[candidate.step] + candidate.alter, 12) === mod(pitchMidiNumber(value), 12);
  });
}

function motionLabel(previous: SpelledPitch | undefined, current: SpelledPitch): string {
  if (!previous) return "start";
  const delta = pitchMidiNumber(current) - pitchMidiNumber(previous);
  if (delta === 0) return "repeat (0 st)";
  return `${delta > 0 ? "up" : "down"} ${Math.abs(delta)} st`;
}

function buildReference(id: MicroReferenceId): MicroReference {
  const harmony = noteEvents("h1", HARMONIES[id]).map((event) => ({
    ...event,
    id: `${event.id}:${id}`,
    provenance: "HUMAN_SPECIFIED_MICROREFERENCE" as const,
  }));
  const analysis = harmony.map((event, index): MicroAnalysisRow => {
    const lead = LEAD[index];
    const span = chordAt(event.onsetQ);
    return {
      onsetQ: event.onsetQ,
      leadPitch: pitchName(lead.pitch),
      sourceChord: span.sourceText,
      harmonyPitch: pitchName(event.pitch),
      genericInterval: genericInterval(lead.pitch, event.pitch),
      chromaticInterval: chromaticInterval(lead.pitch, event.pitch),
      chordTone: isSourceChordTone(event.pitch, span),
      harmonyMotion: motionLabel(harmony[index - 1]?.pitch, event.pitch),
    };
  });
  return {
    id,
    fixtureId: `hm-micro-nct-v0:${id}`,
    provenance: "HUMAN_SPECIFIED_MICROREFERENCE",
    lead: LEAD,
    chords: CHORDS,
    band: BAND,
    harmony,
    analysis,
  };
}

export const MICROCOMPARISON_REFERENCES: readonly MicroReference[] = [
  buildReference("A"), buildReference("B"), buildReference("C"),
] as const;

function abcAccidental(value: SpelledPitch): string {
  if (value.alter === 0) return "=";
  return value.alter > 0 ? "^".repeat(value.alter) : "_".repeat(-value.alter);
}

function abcPitch(value: SpelledPitch): string {
  if (value.octave >= 5) return `${abcAccidental(value)}${value.step.toLowerCase()}${"'".repeat(value.octave - 5)}`;
  return `${abcAccidental(value)}${value.step}${",".repeat(Math.max(0, 4 - value.octave))}`;
}

function abcLength(durationQ: Fraction): string {
  const eighthUnits = multiplyFractions(durationQ, fraction(2));
  if (eighthUnits.n === eighthUnits.d) return "";
  if (eighthUnits.d === 1) return String(eighthUnits.n);
  if (eighthUnits.n === 1) return `/${eighthUnits.d}`;
  return `${eighthUnits.n}/${eighthUnits.d}`;
}

function monophonicAbc(events: readonly MicroNoteEvent[]): string {
  const tokens: string[] = [];
  let cursor = fraction(0);
  for (const event of events) {
    if (compareFractions(cursor, event.onsetQ) < 0) tokens.push(`z${abcLength(subtractFractions(event.onsetQ, cursor))}`);
    tokens.push(`${abcPitch(event.pitch)}${abcLength(event.durationQ)}`);
    cursor = addFractions(event.onsetQ, event.durationQ);
  }
  if (compareFractions(cursor, TOTAL_DURATION_Q) < 0) tokens.push(`z${abcLength(subtractFractions(TOTAL_DURATION_Q, cursor))}`);
  return `${tokens.join(" ")} |`;
}

function bandAbc(events: readonly MicroBandEvent[]): string {
  const tokens: string[] = [];
  let cursor = fraction(0);
  for (const event of events) {
    if (compareFractions(cursor, event.onsetQ) < 0) tokens.push(`z${abcLength(subtractFractions(event.onsetQ, cursor))}`);
    tokens.push(`[${event.pitches.map(abcPitch).join("")}]${abcLength(event.durationQ)}`);
    cursor = addFractions(event.onsetQ, event.durationQ);
  }
  if (compareFractions(cursor, TOTAL_DURATION_Q) < 0) tokens.push(`z${abcLength(subtractFractions(TOTAL_DURATION_Q, cursor))}`);
  return `${tokens.join(" ")} |`;
}

export function createMicroPlaybackArtifact(reference: MicroReference, mix: MicroPlaybackMix): MicroPlaybackArtifact {
  const includeLead = mix === "LEAD_AND_H1" || mix === "BAND_LEAD_AND_H1";
  const includeHarmony = mix !== "BAND_ONLY";
  const includeBand = mix === "BAND_LEAD_AND_H1" || mix === "BAND_ONLY";
  const voices = [includeLead ? "lead" : null, includeHarmony ? "harmony" : null, includeBand ? "band" : null]
    .filter((voice): voice is string => voice !== null);
  const headers = [
    "X:1",
    `T:Post-rc.7 static microreference ${reference.id} · ${mix}`,
    "M:4/4",
    "L:1/8",
    "Q:1/4=88",
    "K:C",
    `%%score (${voices.join(" ")})`,
    ...(includeLead ? ['V:lead name="Lead" clef=treble'] : []),
    ...(includeHarmony ? ['V:harmony name="Harmony 1" clef=treble'] : []),
    ...(includeBand ? ['V:band name="Band" clef=bass'] : []),
  ];
  const body = [
    ...(includeLead ? [`[V:lead] %%MIDI program 53\n${monophonicAbc(reference.lead)}`] : []),
    ...(includeHarmony ? [`[V:harmony] %%MIDI program 53\n${monophonicAbc(reference.harmony)}`] : []),
    ...(includeBand ? [`[V:band] %%MIDI program 0\n${bandAbc(reference.band)}`] : []),
  ];
  const sourceEvents = [
    ...(includeLead ? reference.lead : []),
    ...(includeHarmony ? reference.harmony : []),
    ...(includeBand ? reference.band : []),
  ];
  return {
    referenceId: reference.id,
    mix,
    rendererTier: "COMPETENT_PLAIN",
    renderer: "abcjs-6.7.0",
    soundSource: "browser-synth-no-voicebank",
    licenseProvenance: "project-original-static-microfixture",
    abc: `${headers.join("\n")}\n${body.join("\n")}\n`,
    sourceEventIds: sourceEvents.map((event) => event.id),
    playbackProjection: {
      lead: includeLead ? reference.lead : [],
      harmony: includeHarmony ? reference.harmony : [],
      band: includeBand ? reference.band : [],
    },
  };
}

export const MICRO_PLAYBACK_MIXES: readonly MicroPlaybackMix[] = [
  "BAND_LEAD_AND_H1", "LEAD_AND_H1", "H1_ONLY", "BAND_ONLY",
] as const;

export function microRankingComplete(ranking: Readonly<Record<"best" | "second" | "worst", MicroReferenceId | "">>): boolean {
  return new Set([ranking.best, ranking.second, ranking.worst]).size === 3
    && ranking.best !== "" && ranking.second !== "" && ranking.worst !== "";
}
