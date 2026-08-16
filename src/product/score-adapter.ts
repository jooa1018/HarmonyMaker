import { addFractions, compareFractions, fraction, subtractFractions, type Fraction } from "../domain/fraction";
import type { ArrangementRenderDocument, GeneratedVoiceEvent } from "../domain/generation/model";
import type { KeySignature, SpelledPitch } from "../domain/pitch";
import type { TimelineAtom } from "../domain/source/atomization";
import type { TempoSpec } from "../domain/source/model";
import type { PerformanceMeasureOccurrence } from "../domain/performance/repeat";
import { canonicalRangeDuration } from "./timing";

interface AdapterEvent {
  readonly kind: "note" | "rest";
  readonly offset: Fraction;
  readonly duration: Fraction;
  readonly pitch?: SpelledPitch;
  readonly tieStart: boolean;
  readonly lyricTokenIds: readonly string[];
}

function abcPitch(pitch: SpelledPitch): string {
  const accidental = pitch.alter === -2 ? "__" : pitch.alter === -1 ? "_" : pitch.alter === 1 ? "^" : pitch.alter === 2 ? "^^" : "=";
  const upper = pitch.octave <= 4;
  const letter = upper ? pitch.step : pitch.step.toLowerCase();
  const octave = pitch.octave < 4 ? ",".repeat(4 - pitch.octave) : pitch.octave > 5 ? "'".repeat(pitch.octave - 5) : "";
  return `${accidental}${letter}${octave}`;
}

function abcLength(duration: Fraction): string {
  const units = fraction(duration.n * 4, duration.d);
  if (units.n === units.d) return "";
  if (units.d === 1) return String(units.n);
  if (units.n === 1) return `/${units.d}`;
  return `${units.n}/${units.d}`;
}

function eventFromAtom(atom: TimelineAtom, measures: readonly PerformanceMeasureOccurrence[]): AdapterEvent {
  const duration = canonicalRangeDuration(measures, atom.range);
  return { kind: atom.pitch ? "note" : "rest", offset: atom.range.start.offset, duration, ...(atom.pitch ? { pitch: atom.pitch } : {}), tieStart: atom.tiedToNext, lyricTokenIds: atom.lyricTokenIds };
}

function eventFromGenerated(event: GeneratedVoiceEvent, measures: readonly PerformanceMeasureOccurrence[]): AdapterEvent {
  const duration = canonicalRangeDuration(measures, event.range);
  return { kind: event.kind, offset: event.range.start.offset, duration, ...(event.kind === "note" ? { pitch: event.pitch } : {}), tieStart: event.kind === "note" && event.tieStart, lyricTokenIds: event.kind === "note" ? event.lyricTokenIds : [] };
}

function quote(value: string): string { return value.replace(/["\\]/gu, ""); }

function abcKey(key: KeySignature): string {
  const accidental = key.tonic.alter === -2 ? "bb" : key.tonic.alter === -1 ? "b" : key.tonic.alter === 1 ? "#" : key.tonic.alter === 2 ? "##" : "";
  return `${key.tonic.step}${accidental}${key.mode === "minor" ? "m" : ""}`;
}

function voiceMeasures(events: readonly AdapterEvent[], measureCount: number, durations: readonly Fraction[], chordAt: Readonly<Record<string, string>>, includeChords: boolean): string {
  const measures: string[] = [];
  for (let measureIndex = 0; measureIndex < measureCount; measureIndex += 1) {
    const selected = events.filter((event) => (event as AdapterEvent & { measureIndex?: number }).measureIndex === measureIndex).sort((a, b) => compareFractions(a.offset, b.offset));
    let cursor = fraction(0);
    const tokens: string[] = [];
    for (const event of selected) {
      if (compareFractions(cursor, event.offset) < 0) tokens.push(`z${abcLength(subtractFractions(event.offset, cursor))}`);
      const chord = includeChords ? chordAt[`${measureIndex}:${event.offset.n}/${event.offset.d}`] : undefined;
      tokens.push(`${chord ? `"${quote(chord)}"` : ""}${event.kind === "note" && event.pitch ? abcPitch(event.pitch) : "z"}${abcLength(event.duration)}${event.tieStart ? "-" : ""}`);
      cursor = addFractions(event.offset, event.duration);
    }
    if (compareFractions(cursor, durations[measureIndex]) < 0) tokens.push(`z${abcLength(subtractFractions(durations[measureIndex], cursor))}`);
    measures.push(`${tokens.join(" ")} |`);
  }
  return measures.join(" ");
}

export function arrangementRenderDocumentToAbc(document: ArrangementRenderDocument, input: { readonly title: string; readonly tempo: TempoSpec; readonly key: KeySignature }): string {
  const durations = document.measures.map((measure) => measure.duration);
  const chordAt = Object.fromEntries(document.effectiveChordTimeline.spans.map((span) => [`${span.range.start.performanceMeasureIndex}:${span.range.start.offset.n}/${span.range.start.offset.d}`, span.parseResult.status === "ok" ? span.parseResult.chord.canonicalSymbol : "N.C."]));
  const lead = document.sourceLeadTrack.atoms.map((atom) => ({ ...eventFromAtom(atom, document.measures), measureIndex: atom.range.start.performanceMeasureIndex }));
  const tracks = [
    { id: "lead", label: "Lead", events: lead },
    ...document.generatedHarmonyTracks.map((track, index) => ({ id: `h${index + 1}`, label: index === 0 ? "Upper / H1" : "Lower / H2", events: track.events.map((event) => ({ ...eventFromGenerated(event, document.measures), measureIndex: event.range.start.performanceMeasureIndex })) })),
  ];
  const voices = tracks.map((track, index) => `[V:${track.id}] ${voiceMeasures(track.events, document.measures.length, durations, chordAt, index === 0)}`).join("\n");
  const score = tracks.map((track) => track.id).join(" ");
  const declarations = tracks.map((track) => `V:${track.id} name="${quote(track.label)}" clef=treble`).join("\n");
  return `X:1\nT:${quote(input.title)}\nM:${document.measures[0]?.time.numerator ?? 4}/${document.measures[0]?.time.denominator ?? 4}\nL:1/16\nQ:${input.tempo.dotted ? "3/" : "1/"}${input.tempo.beatUnit}=${input.tempo.bpm}\nK:${abcKey(input.key)}\n%%score ${score}\n${declarations}\n${voices}`;
}
