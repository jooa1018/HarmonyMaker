import { addFractions, compareFractions, fraction, subtractFractions, type Fraction } from "../domain/fraction";
import { parseChord } from "../domain/chord/parser";
import type { ArrangementRenderDocument, GeneratedVoiceEvent } from "../domain/generation/model";
import type { ParsedChord, ChordDegree } from "../domain/chord/model";
import type { KeySignature, SpelledPitch } from "../domain/pitch";
import type { TimelineAtom } from "../domain/source/atomization";
import type { TempoSpec } from "../domain/source/model";
import type { PerformanceMeasureOccurrence } from "../domain/performance/repeat";
import { canonicalRangeDuration } from "./timing";
import type { ProductTrackRoleRegistry } from "./track-roles";

function xml(value: string): string { return value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;").replace(/'/gu, "&apos;"); }
function gcd(a: number, b: number): number { return b === 0 ? Math.abs(a) : gcd(b, a % b); }
function lcm(a: number, b: number): number { return Math.abs(a * b) / gcd(a, b); }
function pitchXml(pitch: SpelledPitch): string { return `<pitch><step>${pitch.step}</step>${pitch.alter === 0 ? "" : `<alter>${pitch.alter}</alter>`}<octave>${pitch.octave}</octave></pitch>`; }
function fifths(key: KeySignature): number {
  const names: Readonly<Record<string, number>> = { "Cb": -7, "Gb": -6, "Db": -5, "Ab": -4, "Eb": -3, "Bb": -2, F: -1, C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, "F#": 6, "C#": 7 };
  const tonic = `${key.tonic.step}${key.tonic.alter === -1 ? "b" : key.tonic.alter === 1 ? "#" : ""}`;
  const relativeMajor = key.mode === "minor" ? ({ A: "C", E: "G", B: "D", "F#": "A", "C#": "E", "G#": "B", "D#": "F#", "A#": "C#", D: "F", G: "Bb", C: "Eb", F: "Ab", Bb: "Db", Eb: "Gb", Ab: "Cb" } as Readonly<Record<string, string>>)[tonic] ?? tonic : tonic;
  return names[relativeMajor] ?? 0;
}

interface XmlEvent { readonly kind: "note" | "rest"; readonly offset: Fraction; readonly duration: Fraction; readonly pitch?: SpelledPitch; readonly tieStart: boolean; readonly tieStop: boolean; readonly lyricTokenIds: readonly string[] }
function fromAtom(atom: TimelineAtom, measures: readonly PerformanceMeasureOccurrence[]): XmlEvent { return { kind: atom.pitch ? "note" : "rest", offset: atom.range.start.offset, duration: canonicalRangeDuration(measures, atom.range), ...(atom.pitch ? { pitch: atom.pitch } : {}), tieStart: atom.tiedToNext, tieStop: atom.tiedFromPrevious, lyricTokenIds: atom.lyricTokenIds }; }
function fromGenerated(event: GeneratedVoiceEvent, measures: readonly PerformanceMeasureOccurrence[]): XmlEvent { return { kind: event.kind, offset: event.range.start.offset, duration: canonicalRangeDuration(measures, event.range), ...(event.kind === "note" ? { pitch: event.pitch } : {}), tieStart: event.kind === "note" && event.tieStart, tieStop: event.kind === "note" && event.tieStop, lyricTokenIds: event.kind === "note" ? event.lyricTokenIds : [] }; }

const NOTE_TYPES = [
  { name: "maxima", quarters: fraction(32) },
  { name: "long", quarters: fraction(16) },
  { name: "breve", quarters: fraction(8) },
  { name: "whole", quarters: fraction(4) },
  { name: "half", quarters: fraction(2) },
  { name: "quarter", quarters: fraction(1) },
  { name: "eighth", quarters: fraction(1, 2) },
  { name: "16th", quarters: fraction(1, 4) },
  { name: "32nd", quarters: fraction(1, 8) },
  { name: "64th", quarters: fraction(1, 16) },
  { name: "128th", quarters: fraction(1, 32) },
  { name: "256th", quarters: fraction(1, 64) },
] as const;

function equalFraction(left: Fraction, right: Fraction): boolean {
  return left.n === right.n && left.d === right.d;
}

function multiply(value: Fraction, numerator: number, denominator = 1): Fraction {
  return fraction(value.n * numerator, value.d * denominator);
}

function notationForDuration(duration: Fraction): { readonly type: string; readonly dots: number; readonly actualNotes?: number; readonly normalNotes?: number } {
  for (const noteType of NOTE_TYPES) {
    for (let dots = 0; dots <= 3; dots += 1) {
      const dotted = multiply(noteType.quarters, 2 ** (dots + 1) - 1, 2 ** dots);
      if (equalFraction(duration, dotted)) return { type: noteType.name, dots };
    }
  }
  const candidates = NOTE_TYPES.flatMap((noteType) => {
    const ratio = fraction(duration.n * noteType.quarters.d, duration.d * noteType.quarters.n);
    if (ratio.n > 64 || ratio.d > 64) return [];
    return [{ type: noteType.name, dots: 0, normalNotes: ratio.n, actualNotes: ratio.d, expansion: ratio.n > ratio.d ? 1 : 0, distance: Math.abs(Math.log2(ratio.n / ratio.d)) }];
  }).sort((left, right) => left.expansion - right.expansion || left.distance - right.distance || left.actualNotes - right.actualNotes || left.normalNotes - right.normalNotes || left.type.localeCompare(right.type));
  const selected = candidates[0];
  if (!selected) throw new RangeError("MUSICXML_DURATION_UNREPRESENTABLE");
  return { type: selected.type, dots: 0, actualNotes: selected.actualNotes, normalNotes: selected.normalNotes };
}

function noteXml(event: XmlEvent, divisions: number, lyricById: Readonly<Record<string, ArrangementRenderDocument["lyricTokens"][number]>>): string {
  const duration = event.duration.n * divisions / event.duration.d;
  const notation = notationForDuration(event.duration);
  const ties = `${event.tieStop ? '<tie type="stop"/>' : ""}${event.tieStart ? '<tie type="start"/>' : ""}`;
  const tied = event.tieStart || event.tieStop ? `<notations>${event.tieStop ? '<tied type="stop"/>' : ""}${event.tieStart ? '<tied type="start"/>' : ""}</notations>` : "";
  const lyric = event.lyricTokenIds.flatMap((id) => lyricById[id] ? [lyricById[id]] : [])[0];
  const lyricXml = lyric ? `<lyric number="${lyric.verse}"><syllabic>${lyric.syllabic}</syllabic><text>${xml(lyric.text)}</text>${lyric.extend ? "<extend/>" : ""}</lyric>` : "";
  const dots = "<dot/>".repeat(notation.dots);
  const tuplet = notation.actualNotes === undefined ? "" : `<time-modification><actual-notes>${notation.actualNotes}</actual-notes><normal-notes>${notation.normalNotes}</normal-notes></time-modification>`;
  return `<note>${event.kind === "note" && event.pitch ? pitchXml(event.pitch) : "<rest/>"}<duration>${duration}</duration><voice>1</voice><type>${notation.type}</type>${dots}${tuplet}${ties}${tied}${lyricXml}</note>`;
}

function pitchClassSymbol(pitch: ParsedChord["root"]): string {
  const accidental = pitch.alter === -2 ? "bb" : pitch.alter === -1 ? "b" : pitch.alter === 1 ? "#" : pitch.alter === 2 ? "##" : "";
  return `${pitch.step}${accidental}`;
}

function chordSuffix(chord: ParsedChord): string {
  const root = pitchClassSymbol(chord.root);
  const bass = chord.bass ? `/${pitchClassSymbol(chord.bass)}` : "";
  return chord.canonicalSymbol.slice(root.length, bass ? -bass.length : undefined);
}

function degreeXml(value: number, alter: number, type: "add" | "alter" | "subtract"): string {
  return `<degree><degree-value>${value}</degree-value><degree-alter>${alter}</degree-alter><degree-type>${type}</degree-type></degree>`;
}

interface StructuredDegree { readonly value: ChordDegree; readonly alter: number; readonly type: "add" | "alter" | "subtract" }
interface StructuredKind { readonly name: string; readonly suffix: string }

const STRUCTURED_KINDS: readonly StructuredKind[] = [
  { name: "major", suffix: "" }, { name: "minor", suffix: "m" },
  { name: "augmented", suffix: "aug" }, { name: "diminished", suffix: "dim" },
  { name: "dominant", suffix: "7" }, { name: "major-seventh", suffix: "maj7" },
  { name: "minor-seventh", suffix: "m7" }, { name: "diminished-seventh", suffix: "dim7" },
  { name: "augmented-seventh", suffix: "aug7" }, { name: "half-diminished", suffix: "m7b5" },
  { name: "major-minor", suffix: "mMaj7" }, { name: "major-sixth", suffix: "6" },
  { name: "minor-sixth", suffix: "m6" }, { name: "dominant-ninth", suffix: "9" },
  { name: "major-ninth", suffix: "maj9" }, { name: "minor-ninth", suffix: "m9" },
  { name: "suspended-second", suffix: "sus2" }, { name: "suspended-fourth", suffix: "sus4" },
  { name: "power", suffix: "no3" },
];

function toneCoordinates(chord: ParsedChord): string {
  return chord.tones.map((tone) => `${tone.degree}:${tone.alteration}`).sort().join("|");
}

function degreeToken(degree: StructuredDegree): string {
  if (degree.type === "subtract") return `no${degree.value}`;
  if (degree.alter !== 0) return `${degree.alter < 0 ? "b" : "#"}${degree.value}`;
  return `add${degree.value}`;
}

function structuredHarmony(chord: ParsedChord): { readonly kind: string; readonly degrees: readonly StructuredDegree[] } {
  const targetByDegree = new Map(chord.tones.map((tone) => [tone.degree, tone]));
  const candidates = STRUCTURED_KINDS.flatMap((kind, kindOrdinal) => {
    const parsedBase = parseChord(`C${kind.suffix}`);
    if (parsedBase.status !== "ok") return [];
    const baseByDegree = new Map(parsedBase.chord.tones.map((tone) => [tone.degree, tone]));
    const degrees: StructuredDegree[] = [];
    let representable = true;
    for (const tone of chord.tones) {
      const base = baseByDegree.get(tone.degree);
      if (base?.alteration === tone.alteration) continue;
      if (base && [5, 9, 11, 13].includes(tone.degree) && Math.abs(tone.alteration) === 1) {
        degrees.push({ value: tone.degree, alter: tone.alteration, type: "alter" });
      } else if (!base && [2, 4, 6, 9, 11, 13].includes(tone.degree) && tone.alteration === 0) {
        degrees.push({ value: tone.degree, alter: 0, type: "add" });
      } else if (!base && [5, 9, 11, 13].includes(tone.degree) && Math.abs(tone.alteration) === 1) {
        degrees.push({ value: tone.degree, alter: tone.alteration, type: "alter" });
      } else representable = false;
    }
    for (const tone of parsedBase.chord.tones) {
      if (targetByDegree.has(tone.degree)) continue;
      if (tone.degree === 3 || tone.degree === 5) degrees.push({ value: tone.degree, alter: 0, type: "subtract" });
      else representable = false;
    }
    for (const omission of chord.omissions) {
      if (!degrees.some((degree) => degree.type === "subtract" && degree.value === omission)
        && !parsedBase.chord.omissions.includes(omission)) degrees.push({ value: omission, alter: 0, type: "subtract" });
    }
    if (!representable) return [];
    const typeRank = { add: 0, alter: 1, subtract: 2 } as const;
    degrees.sort((left, right) => typeRank[left.type] - typeRank[right.type] || left.value - right.value || left.alter - right.alter);
    const reconstructed = parseChord(`C${kind.suffix}${degrees.map(degreeToken).join("")}`);
    if (reconstructed.status !== "ok" || toneCoordinates(reconstructed.chord) !== toneCoordinates(chord)
      || chord.omissions.some((omission) => !reconstructed.chord.omissions.includes(omission))) return [];
    const extraOmissions = reconstructed.chord.omissions.filter((omission) => !chord.omissions.includes(omission)).length;
    const originMismatch = chord.tones.filter((tone) => reconstructed.chord.tones.find((candidate) => candidate.degree === tone.degree)?.origin !== tone.origin).length;
    return [{ kind, degrees, extraOmissions, originMismatch, kindOrdinal }];
  }).sort((left, right) => left.extraOmissions - right.extraOmissions || left.degrees.length - right.degrees.length || left.originMismatch - right.originMismatch || left.kindOrdinal - right.kindOrdinal);
  const selected = candidates[0];
  if (!selected) throw new RangeError(`MUSICXML_CHORD_UNREPRESENTABLE:${chord.canonicalSymbol}`);
  return { kind: selected.kind.name, degrees: selected.degrees };
}

function harmonyXml(document: ArrangementRenderDocument, measureIndex: number, divisions: number): string {
  return document.effectiveChordTimeline.spans.filter((span) => span.range.start.performanceMeasureIndex === measureIndex).map((span) => {
    const offset = span.range.start.offset.n * divisions / span.range.start.offset.d;
    if (span.parseResult.status === "no-chord") return `<harmony><kind text="N.C.">none</kind>${offset ? `<offset>${offset}</offset>` : ""}</harmony>`;
    const chord = span.parseResult.chord;
    const structured = structuredHarmony(chord);
    return `<harmony><root><root-step>${chord.root.step}</root-step>${chord.root.alter === 0 ? "" : `<root-alter>${chord.root.alter}</root-alter>`}</root><kind text="${xml(chordSuffix(chord))}">${structured.kind}</kind>${structured.degrees.map((degree) => degreeXml(degree.value, degree.alter, degree.type)).join("")}${chord.bass ? `<bass><bass-step>${chord.bass.step}</bass-step>${chord.bass.alter === 0 ? "" : `<bass-alter>${chord.bass.alter}</bass-alter>`}</bass>` : ""}${offset ? `<offset>${offset}</offset>` : ""}</harmony>`;
  }).join("");
}

function fullMeasureDuration(measure: ArrangementRenderDocument["measures"][number]): Fraction {
  return fraction(measure.time.numerator * 4, measure.time.denominator);
}

function timeXml(measure: ArrangementRenderDocument["measures"][number]): string {
  return `<time><beats>${measure.time.numerator}</beats><beat-type>${measure.time.denominator}</beat-type></time>`;
}

function tempoXml(tempo: TempoSpec): string {
  const beatUnit = tempo.beatUnit === 4 ? "quarter" : "eighth";
  return `<direction placement="above"><direction-type><metronome><beat-unit>${beatUnit}</beat-unit>${tempo.dotted ? "<beat-unit-dot/>" : ""}<per-minute>${tempo.bpm}</per-minute></metronome></direction-type></direction>`;
}

function partXml(input: { readonly id: string; readonly events: readonly (XmlEvent & { readonly measureIndex: number })[]; readonly document: ArrangementRenderDocument; readonly divisions: number; readonly key: KeySignature; readonly tempo: TempoSpec; readonly includeHarmony: boolean; readonly includeTempo: boolean }): string {
  const lyricById = Object.fromEntries(input.document.lyricTokens.map((token) => [token.id, token]));
  const measures = input.document.measures.map((measure, measureIndex) => {
    const events = input.events.filter((event) => event.measureIndex === measureIndex).sort((a, b) => compareFractions(a.offset, b.offset));
    const filled: XmlEvent[] = [];
    let cursor = fraction(0);
    for (const event of events) {
      if (compareFractions(cursor, event.offset) < 0) filled.push({ kind: "rest", offset: cursor, duration: subtractFractions(event.offset, cursor), tieStart: false, tieStop: false, lyricTokenIds: [] });
      filled.push(event);
      cursor = addFractions(event.offset, event.duration);
    }
    if (compareFractions(cursor, measure.duration) < 0) filled.push({ kind: "rest", offset: cursor, duration: subtractFractions(measure.duration, cursor), tieStart: false, tieStop: false, lyricTokenIds: [] });
    const previous = input.document.measures[measureIndex - 1];
    const meterChanged = measureIndex === 0 || !previous
      || previous.time.numerator !== measure.time.numerator
      || previous.time.denominator !== measure.time.denominator;
    const attributes = measureIndex === 0
      ? `<attributes><divisions>${input.divisions}</divisions><key><fifths>${fifths(input.key)}</fifths><mode>${input.key.mode}</mode></key>${timeXml(measure)}<clef><sign>G</sign><line>2</line></clef></attributes>`
      : meterChanged ? `<attributes>${timeXml(measure)}</attributes>` : "";
    const implicit = !equalFraction(measure.duration, fullMeasureDuration(measure));
    return `<measure number="${measureIndex + 1}"${implicit ? ' implicit="yes"' : ""}>${attributes}${input.includeTempo && measureIndex === 0 ? tempoXml(input.tempo) : ""}${input.includeHarmony ? harmonyXml(input.document, measureIndex, input.divisions) : ""}${filled.map((event) => noteXml(event, input.divisions, lyricById)).join("")}</measure>`;
  }).join("");
  return `<part id="${input.id}">${measures}</part>`;
}

export function exportArrangementMusicXml(document: ArrangementRenderDocument, trackRoles: ProductTrackRoleRegistry, input: { readonly title: string; readonly composer?: string; readonly key: KeySignature; readonly tempo: TempoSpec }): string {
  const allFractions = [
    ...document.measures.map((measure) => measure.duration),
    ...document.sourceLeadTrack.atoms.flatMap((atom) => [atom.range.start.offset, canonicalRangeDuration(document.measures, atom.range)]),
    ...document.generatedHarmonyTracks.flatMap((track) => track.events.flatMap((event) => [event.range.start.offset, canonicalRangeDuration(document.measures, event.range)])),
  ];
  const divisions = allFractions.reduce((value, item) => lcm(value, item.d), 1);
  if (!Number.isSafeInteger(divisions) || divisions > 1_000_000) throw new RangeError("MUSICXML_DIVISIONS_UNREPRESENTABLE");
  const tracks = [
    { id: "P1", name: "Source Lead", events: document.sourceLeadTrack.atoms.map((atom) => ({ ...fromAtom(atom, document.measures), measureIndex: atom.range.start.performanceMeasureIndex })) },
    ...document.generatedHarmonyTracks.map((track) => {
      const metadata = trackRoles.byTrackPlanId[track.trackPlanId];
      if (!metadata) throw new RangeError(`TRACK_ROLE_METADATA_UNAVAILABLE:${track.trackPlanId}`);
      return { id: `P-${metadata.harmonyRole}`, name: metadata.label, events: track.events.map((event) => ({ ...fromGenerated(event, document.measures), measureIndex: event.range.start.performanceMeasureIndex })) };
    }),
  ];
  const partList = tracks.map((track) => `<score-part id="${track.id}"><part-name>${xml(track.name)}</part-name></score-part>`).join("");
  const parts = tracks.map((track, index) => partXml({ id: track.id, events: track.events, document, divisions, key: input.key, tempo: input.tempo, includeHarmony: index === 0, includeTempo: index === 0 })).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><work><work-title>${xml(input.title)}</work-title></work>${input.composer ? `<identification><creator type="composer">${xml(input.composer)}</creator></identification>` : ""}<part-list>${partList}</part-list>${parts}</score-partwise>`;
}
