import { addFractions, compareFractions, fraction, subtractFractions, type Fraction } from "../domain/fraction";
import type { ArrangementRenderDocument, GeneratedVoiceEvent } from "../domain/generation/model";
import type { ParsedChord, ChordDegree } from "../domain/chord/model";
import type { KeySignature, SpelledPitch } from "../domain/pitch";
import type { TimelineAtom } from "../domain/source/atomization";
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

function musicXmlKind(chord: ParsedChord): { readonly name: string; readonly represented: ReadonlySet<ChordDegree> } {
  const tone = (degree: ChordDegree) => chord.tones.find((candidate) => candidate.degree === degree);
  const suspended = chord.tones.find((candidate) => candidate.origin === "suspension");
  if (suspended) return { name: suspended.degree === 2 ? "suspended-second" : "suspended-fourth", represented: new Set([1, suspended.degree]) };
  const third = tone(3);
  const fifth = tone(5);
  const seventh = tone(7);
  const ninth = tone(9);
  const sixth = tone(6);
  const quality = fifth?.origin === "quality" && fifth.alteration === -1 ? "diminished"
    : fifth?.origin === "quality" && fifth.alteration === 1 ? "augmented"
      : third?.origin === "quality" && third.alteration === -1 ? "minor" : "major";
  if (ninth?.origin === "extension" && seventh?.origin === "extension") {
    const name = seventh.alteration === 0 ? (quality === "minor" ? "major-ninth" : "major-ninth")
      : quality === "minor" ? "minor-ninth" : "dominant-ninth";
    return { name, represented: new Set([1, 3, 5, 7, 9]) };
  }
  if (seventh?.origin === "extension") {
    const name = quality === "diminished" ? "diminished-seventh"
      : quality === "augmented" ? "augmented-seventh"
        : quality === "minor" && seventh.alteration === 0 ? "major-minor"
          : quality === "minor" ? "minor-seventh"
            : seventh.alteration === 0 ? "major-seventh" : "dominant";
    return { name, represented: new Set([1, 3, 5, 7]) };
  }
  if (sixth?.origin === "extension") return { name: quality === "minor" ? "minor-sixth" : "major-sixth", represented: new Set([1, 3, 5, 6]) };
  return { name: quality, represented: new Set([1, 3, 5]) };
}

function degreeXml(value: number, alter: number, type: "add" | "alter" | "subtract"): string {
  return `<degree><degree-value>${value}</degree-value><degree-alter>${alter}</degree-alter><degree-type>${type}</degree-type></degree>`;
}

function chordDegreesXml(chord: ParsedChord, represented: ReadonlySet<ChordDegree>): string {
  const degrees = chord.tones.flatMap((tone) => {
    if (tone.origin === "addition") return [degreeXml(tone.degree, tone.alteration, "add")];
    if (tone.origin === "alteration") return [degreeXml(tone.degree, tone.alteration, "alter")];
    if ((tone.origin === "extension" || tone.origin === "suspension") && !represented.has(tone.degree)) return [degreeXml(tone.degree, tone.alteration, "add")];
    return [];
  });
  degrees.push(...chord.omissions.map((degree) => degreeXml(degree, 0, "subtract")));
  return degrees.join("");
}

function harmonyXml(document: ArrangementRenderDocument, measureIndex: number, divisions: number): string {
  return document.effectiveChordTimeline.spans.filter((span) => span.range.start.performanceMeasureIndex === measureIndex).map((span) => {
    const offset = span.range.start.offset.n * divisions / span.range.start.offset.d;
    if (span.parseResult.status === "no-chord") return `<harmony><kind text="N.C.">none</kind>${offset ? `<offset>${offset}</offset>` : ""}</harmony>`;
    const chord = span.parseResult.chord;
    const kind = musicXmlKind(chord);
    return `<harmony><root><root-step>${chord.root.step}</root-step>${chord.root.alter === 0 ? "" : `<root-alter>${chord.root.alter}</root-alter>`}</root><kind text="${xml(chordSuffix(chord))}">${kind.name}</kind>${chordDegreesXml(chord, kind.represented)}${chord.bass ? `<bass><bass-step>${chord.bass.step}</bass-step>${chord.bass.alter === 0 ? "" : `<bass-alter>${chord.bass.alter}</bass-alter>`}</bass>` : ""}${offset ? `<offset>${offset}</offset>` : ""}</harmony>`;
  }).join("");
}

function partXml(input: { readonly id: string; readonly events: readonly (XmlEvent & { readonly measureIndex: number })[]; readonly document: ArrangementRenderDocument; readonly divisions: number; readonly key: KeySignature; readonly includeHarmony: boolean }): string {
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
    const attributes = measureIndex === 0 ? `<attributes><divisions>${input.divisions}</divisions><key><fifths>${fifths(input.key)}</fifths><mode>${input.key.mode}</mode></key><time><beats>${measure.time.numerator}</beats><beat-type>${measure.time.denominator}</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>` : "";
    return `<measure number="${measureIndex + 1}">${attributes}${input.includeHarmony ? harmonyXml(input.document, measureIndex, input.divisions) : ""}${filled.map((event) => noteXml(event, input.divisions, lyricById)).join("")}</measure>`;
  }).join("");
  return `<part id="${input.id}">${measures}</part>`;
}

export function exportArrangementMusicXml(document: ArrangementRenderDocument, trackRoles: ProductTrackRoleRegistry, input: { readonly title: string; readonly composer?: string; readonly key: KeySignature }): string {
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
  const parts = tracks.map((track, index) => partXml({ id: track.id, events: track.events, document, divisions, key: input.key, includeHarmony: index === 0 })).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><work><work-title>${xml(input.title)}</work-title></work>${input.composer ? `<identification><creator type="composer">${xml(input.composer)}</creator></identification>` : ""}<part-list>${partList}</part-list>${parts}</score-partwise>`;
}
