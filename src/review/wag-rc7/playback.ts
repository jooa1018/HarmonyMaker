import {
  addFractions,
  compareFractions,
  fraction,
  multiplyFractions,
  subtractFractions,
  type Fraction,
} from "../../domain/fraction";
import type { GeneratedVoiceEvent } from "../../domain/generation/model";
import type { SpelledPitch } from "../../domain/pitch";
import type { MusicalRange } from "../../domain/time";
import { positionToGlobalQ } from "./music";
import { measureDurationsForCase } from "./prepare";
import type {
  Rc7GenerationStageResult,
  Rc7PipelineContext,
  Rc7PlaybackArtifact,
} from "./types";

export { scaleRc7AbcTempo } from "./playback-tempo";

interface PlaybackSegment {
  readonly range: MusicalRange;
  readonly pitch: SpelledPitch | null;
  readonly tieToNext: boolean;
}

function accidental(pitch: SpelledPitch): string {
  if (pitch.alter === 0) return "=";
  return pitch.alter > 0 ? "^".repeat(pitch.alter) : "_".repeat(-pitch.alter);
}

function abcPitch(pitch: SpelledPitch): string {
  if (pitch.octave >= 5) {
    return `${accidental(pitch)}${pitch.step.toLowerCase()}${"'".repeat(pitch.octave - 5)}`;
  }
  return `${accidental(pitch)}${pitch.step}${",".repeat(Math.max(0, 4 - pitch.octave))}`;
}

function abcLength(durationQ: Fraction): string {
  const eighthUnits = multiplyFractions(durationQ, fraction(2));
  if (eighthUnits.n === eighthUnits.d) return "";
  if (eighthUnits.d === 1) return String(eighthUnits.n);
  if (eighthUnits.n === 1) return `/${eighthUnits.d}`;
  return `${eighthUnits.n}/${eighthUnits.d}`;
}

function token(pitch: SpelledPitch | null, duration: Fraction, tied: boolean): string {
  return `${pitch ? abcPitch(pitch) : "z"}${abcLength(duration)}${pitch && tied ? "-" : ""}`;
}

function voiceAbc(
  segments: readonly PlaybackSegment[],
  durations: readonly Fraction[],
): string {
  const ordered = [...segments].sort((left, right) => {
    const leftStart = positionToGlobalQ(left.range.start, durations);
    const rightStart = positionToGlobalQ(right.range.start, durations);
    return compareFractions(leftStart, rightStart);
  });
  const result: string[] = [];
  let measureStart = fraction(0);
  for (const duration of durations) {
    const measureEnd = addFractions(measureStart, duration);
    let cursor = measureStart;
    for (const segment of ordered) {
      const rawStart = positionToGlobalQ(segment.range.start, durations);
      const rawEnd = positionToGlobalQ(segment.range.end, durations);
      if (compareFractions(rawEnd, measureStart) <= 0 || compareFractions(rawStart, measureEnd) >= 0) continue;
      const start = compareFractions(rawStart, measureStart) < 0 ? measureStart : rawStart;
      const end = compareFractions(rawEnd, measureEnd) > 0 ? measureEnd : rawEnd;
      if (compareFractions(cursor, start) < 0) result.push(token(null, subtractFractions(start, cursor), false));
      const continues = compareFractions(rawEnd, end) > 0 || (compareFractions(rawEnd, end) === 0 && segment.tieToNext);
      result.push(token(segment.pitch, subtractFractions(end, start), continues));
      cursor = end;
    }
    if (compareFractions(cursor, measureEnd) < 0) result.push(token(null, subtractFractions(measureEnd, cursor), false));
    result.push("|");
    measureStart = measureEnd;
  }
  return result.join(" ");
}

function keyHeader(context: Rc7PipelineContext): string {
  const key = context.prepared.defaultKey;
  const symbol = `${key.tonic.step}${key.tonic.alter > 0 ? "#".repeat(key.tonic.alter) : "b".repeat(-key.tonic.alter)}`;
  return `${symbol}${key.mode === "minor" ? "m" : ""}`;
}

function tempoHeader(context: Rc7PipelineContext): string {
  const tempo = context.prepared.defaultTempo;
  return `Q:${tempo.dotted ? "3/8" : `1/${tempo.beatUnit}`}=${tempo.bpm}`;
}

function title(text: string): string {
  return text.replace(/[\r\n]/gu, " ").replace(/[^\p{L}\p{N} .·_()-]/gu, "").slice(0, 120);
}

function generatedSegments(events: readonly GeneratedVoiceEvent[]): readonly PlaybackSegment[] {
  return events.map((event): PlaybackSegment => event.kind === "rest"
    ? { range: event.range, pitch: null, tieToNext: false }
    : { range: event.range, pitch: event.pitch, tieToNext: event.tieStart });
}

function headers(context: Rc7PipelineContext, score: string, voiceDefinitions: string): string {
  return [
    "X:1",
    `T:${title(context.prepared.title)}`,
    `M:${context.prepared.meterFamily === "simple-quadruple" ? "4/4" : "6/8"}`,
    "L:1/8",
    tempoHeader(context),
    `K:${keyHeader(context)}`,
    score,
    voiceDefinitions,
  ].join("\n");
}

export function createRc7PlaybackArtifact(
  context: Rc7PipelineContext,
  generation: Rc7GenerationStageResult,
): Rc7PlaybackArtifact {
  const durations = measureDurationsForCase(context.prepared);
  const lead = context.prepared.sourceLeadAtomization.atoms.map((atom): PlaybackSegment => ({
    range: atom.range,
    pitch: atom.pitch,
    tieToNext: atom.tiedToNext,
  }));
  const generatedByOrdinal = new Map(context.prepared.tracks
    .filter((track) => track.kind === "generated-harmony")
    .map((track) => [track.canonicalOrdinal, generation.candidate.generatedEventsByTrack[track.id] ?? []]));
  const h1 = generatedSegments(generatedByOrdinal.get(1) ?? []);
  const h2 = generatedSegments(generatedByOrdinal.get(2) ?? []);
  const fullHeader = headers(
    context,
    "%%score (lead h1 h2)",
    [
      'V:lead name="Lead" clef=treble',
      'V:h1 name="Harmony 1" clef=treble',
      'V:h2 name="Harmony 2" clef=treble',
    ].join("\n"),
  );
  const leadHeader = headers(context, "%%score lead", 'V:lead name="Lead" clef=treble');
  return {
    renderer: "abcjs-6.7.0",
    soundSource: "browser-synth-no-voicebank",
    licenseProvenance: "synthetic-original-fixtures",
    fullArrangementAbc: `${fullHeader}\n[V:lead] ${voiceAbc(lead, durations)}\n[V:h1] ${voiceAbc(h1, durations)}\n[V:h2] ${voiceAbc(h2, durations)}\n`,
    leadOnlyAbc: `${leadHeader}\n[V:lead] ${voiceAbc(lead, durations)}\n`,
    voiceLabels: ["Lead", "Harmony 1", "Harmony 2"],
  };
}
