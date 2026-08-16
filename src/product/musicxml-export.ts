import { addFractions, compareFractions, fraction, subtractFractions, type Fraction } from "../domain/fraction";
import type { ArrangementRenderDocument, GeneratedVoiceEvent } from "../domain/generation/model";
import type { KeySignature, SpelledPitch } from "../domain/pitch";
import type { TimelineAtom } from "../domain/source/atomization";
import type { PerformanceMeasureOccurrence } from "../domain/performance/repeat";
import { canonicalRangeDuration } from "./timing";

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

function noteXml(event: XmlEvent, divisions: number, lyricById: Readonly<Record<string, ArrangementRenderDocument["lyricTokens"][number]>>): string {
  const duration = event.duration.n * divisions / event.duration.d;
  const ties = `${event.tieStop ? '<tie type="stop"/>' : ""}${event.tieStart ? '<tie type="start"/>' : ""}`;
  const tied = event.tieStart || event.tieStop ? `<notations>${event.tieStop ? '<tied type="stop"/>' : ""}${event.tieStart ? '<tied type="start"/>' : ""}</notations>` : "";
  const lyric = event.lyricTokenIds.flatMap((id) => lyricById[id] ? [lyricById[id]] : [])[0];
  const lyricXml = lyric ? `<lyric number="${lyric.verse}"><syllabic>${lyric.syllabic}</syllabic><text>${xml(lyric.text)}</text>${lyric.extend ? "<extend/>" : ""}</lyric>` : "";
  return `<note>${event.kind === "note" && event.pitch ? pitchXml(event.pitch) : "<rest/>"}<duration>${duration}</duration><voice>1</voice><type>quarter</type>${ties}${tied}${lyricXml}</note>`;
}

function harmonyXml(document: ArrangementRenderDocument, measureIndex: number, divisions: number): string {
  return document.effectiveChordTimeline.spans.filter((span) => span.range.start.performanceMeasureIndex === measureIndex).map((span) => {
    const offset = span.range.start.offset.n * divisions / span.range.start.offset.d;
    if (span.parseResult.status === "no-chord") return `<harmony><kind text="N.C.">none</kind>${offset ? `<offset>${offset}</offset>` : ""}</harmony>`;
    const chord = span.parseResult.chord;
    const suffix = chord.canonicalSymbol.slice(chord.canonicalSymbol.indexOf(chord.root.step) + 1).split("/")[0];
    const kind = suffix === "m" ? "minor" : suffix === "7" ? "dominant" : suffix === "maj7" ? "major-seventh" : suffix === "m7" ? "minor-seventh" : suffix === "sus2" ? "suspended-second" : suffix === "sus4" ? "suspended-fourth" : "major";
    return `<harmony><root><root-step>${chord.root.step}</root-step>${chord.root.alter === 0 ? "" : `<root-alter>${chord.root.alter}</root-alter>`}</root><kind>${kind}</kind>${chord.bass ? `<bass><bass-step>${chord.bass.step}</bass-step>${chord.bass.alter === 0 ? "" : `<bass-alter>${chord.bass.alter}</bass-alter>`}</bass>` : ""}${offset ? `<offset>${offset}</offset>` : ""}</harmony>`;
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

export function exportArrangementMusicXml(document: ArrangementRenderDocument, input: { readonly title: string; readonly composer?: string; readonly key: KeySignature }): string {
  const allFractions = [
    ...document.measures.map((measure) => measure.duration),
    ...document.sourceLeadTrack.atoms.flatMap((atom) => [atom.range.start.offset, canonicalRangeDuration(document.measures, atom.range)]),
    ...document.generatedHarmonyTracks.flatMap((track) => track.events.flatMap((event) => [event.range.start.offset, canonicalRangeDuration(document.measures, event.range)])),
  ];
  const divisions = allFractions.reduce((value, item) => lcm(value, item.d), 1);
  if (!Number.isSafeInteger(divisions) || divisions > 1_000_000) throw new RangeError("MUSICXML_DIVISIONS_UNREPRESENTABLE");
  const tracks = [
    { id: "P1", name: "Source Lead", events: document.sourceLeadTrack.atoms.map((atom) => ({ ...fromAtom(atom, document.measures), measureIndex: atom.range.start.performanceMeasureIndex })) },
    ...document.generatedHarmonyTracks.map((track, index) => ({ id: `P${index + 2}`, name: index === 0 ? "Upper / Harmony 1" : "Lower / Harmony 2", events: track.events.map((event) => ({ ...fromGenerated(event, document.measures), measureIndex: event.range.start.performanceMeasureIndex })) })),
  ];
  const partList = tracks.map((track) => `<score-part id="${track.id}"><part-name>${xml(track.name)}</part-name></score-part>`).join("");
  const parts = tracks.map((track, index) => partXml({ id: track.id, events: track.events, document, divisions, key: input.key, includeHarmony: index === 0 })).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><work><work-title>${xml(input.title)}</work-title></work>${input.composer ? `<identification><creator type="composer">${xml(input.composer)}</creator></identification>` : ""}<part-list>${partList}</part-list>${parts}</score-partwise>`;
}
