import { addFractions, compareFractions, fraction, subtractFractions, type Fraction } from "../domain/fraction";
import type { ArrangementRenderDocument, GeneratedVoiceEvent } from "../domain/generation/model";
import type { KeySignature, SpelledPitch } from "../domain/pitch";
import { deriveFifths } from "../domain/pitch";
import type { TimelineAtom } from "../domain/source/atomization";
import type { TempoSpec } from "../domain/source/model";
import type { PerformanceMeasureOccurrence } from "../domain/performance/repeat";
import { canonicalRangeDuration } from "./timing";
import type { ProductTrackRoleRegistry } from "./track-roles";
import { displayLyricsByAtom } from "./display-lyrics";

interface AdapterEvent {
  readonly slurs?: TimelineAtom["slurs"];
  readonly kind: "note" | "rest" | "rhythm";
  readonly offset: Fraction;
  readonly duration: Fraction;
  readonly pitch?: SpelledPitch;
  readonly tieStart: boolean;
  readonly tieStop: boolean;
  readonly lyricTokenIds: readonly string[];
}

function abcPitch(pitch: SpelledPitch, keyAlter: ReadonlyMap<string, number>, barAlter: Map<string, number>, tieStop: boolean): string {
  if (!Number.isSafeInteger(pitch.octave) || pitch.octave < -1 || pitch.octave > 9) throw new RangeError("ABC_SERIALIZATION_UNAVAILABLE");
  const identity = `${pitch.step}:${pitch.octave}`;
  const current = barAlter.get(identity) ?? keyAlter.get(pitch.step) ?? 0;
  // abcjs resolves ties before applying bar accidentals: a continuation carries
  // its source pitch but does not change the accidental for following attacks.
  const accidental = tieStop || current === pitch.alter ? "" : pitch.alter === -2 ? "__" : pitch.alter === -1 ? "_" : pitch.alter === 1 ? "^" : pitch.alter === 2 ? "^^" : "=";
  if (!tieStop) barAlter.set(identity, pitch.alter);
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
  return { kind: atom.rhythmOnly ? "rhythm" : atom.pitch ? "note" : "rest", offset: atom.range.start.offset, duration, ...(atom.pitch ? { pitch: atom.pitch } : {}), tieStart: atom.tiedToNext, tieStop: atom.tiedFromPrevious, lyricTokenIds: atom.lyricTokenIds, ...(atom.slurs ? { slurs: atom.slurs } : {}) };
}

function eventFromGenerated(event: GeneratedVoiceEvent, measures: readonly PerformanceMeasureOccurrence[]): AdapterEvent {
  const duration = canonicalRangeDuration(measures, event.range);
  return { kind: event.kind, offset: event.range.start.offset, duration, ...(event.kind === "note" ? { pitch: event.pitch } : {}), tieStart: event.kind === "note" && event.tieStart, tieStop: event.kind === "note" && event.tieStop, lyricTokenIds: event.kind === "note" ? event.lyricTokenIds : [] };
}

/** Keeps domain text intact and neutralizes structural ABC syntax only at serialization. */
export function encodeAbcFreeText(value: string): string {
  return value.normalize("NFC")
    .replace(/[\r\n\u2028\u2029\u0000-\u001f\u007f-\u009f]+/gu, " ")
    .replace(/\\/gu, "/")
    .replace(/"/gu, "'")
    .replace(/\s+/gu, " ")
    .trim();
}

function abcKey(key: KeySignature): string {
  const accidental = key.tonic.alter === -2 ? "bb" : key.tonic.alter === -1 ? "b" : key.tonic.alter === 1 ? "#" : key.tonic.alter === 2 ? "##" : "";
  return `${key.tonic.step}${accidental}${key.mode === "minor" ? "m" : ""}`;
}

function abcTempo(tempo: TempoSpec): string {
  const numerator = tempo.dotted ? 3 : 1;
  const denominator = tempo.dotted ? tempo.beatUnit * 2 : tempo.beatUnit;
  return `${numerator}/${denominator}=${tempo.bpm}`;
}

function voiceMeasures(events: readonly AdapterEvent[], measuresAuthority: ArrangementRenderDocument["measures"], durations: readonly Fraction[], chordAt: Readonly<Record<string, string>>, includeChords: boolean, key: KeySignature, invisibleGaps = false): string {
  const measures: string[] = [];
  const fifths = deriveFifths(key);
  const keyAlter = new Map((fifths < 0 ? "BEADGCF" : "FCGDAEB").slice(0, Math.abs(fifths)).split("").map(step => [step, Math.sign(fifths)]));
  for (let measureIndex = 0; measureIndex < measuresAuthority.length; measureIndex += 1) {
    // abcjs 6.7 applies accidentals to this octave only and resets at each bar.
    const barAlter = new Map<string, number>();
    const selected = events.filter((event) => (event as AdapterEvent & { measureIndex?: number }).measureIndex === measureIndex).sort((a, b) => compareFractions(a.offset, b.offset));
    let cursor = fraction(0);
    const tokens: string[] = [];
    for (const event of selected) {
      if (compareFractions(cursor, event.offset) < 0) tokens.push(`${invisibleGaps ? "x" : "z"}${abcLength(subtractFractions(event.offset, cursor))}`);
      const chord = includeChords ? chordAt[`${measureIndex}:${event.offset.n}/${event.offset.d}`] : undefined;
      // B is only ABC's staff position for its rhythm glyph; playback uses the
      // pitch-free domain atom, never this engraving placeholder.
      const glyph = event.kind === "rhythm" ? "!style=rhythm!B" : event.kind === "note" && event.pitch ? abcPitch(event.pitch, keyAlter, barAlter, event.tieStop) : "z";
      const openSlurs = "(".repeat(event.slurs?.filter((mark) => mark.type === "start").length ?? 0), closeSlurs = ")".repeat(event.slurs?.filter((mark) => mark.type === "stop").length ?? 0);
      tokens.push(`${chord ? `"${encodeAbcFreeText(chord)}"` : ""}${openSlurs}${glyph}${abcLength(event.duration)}${event.tieStart ? "-" : ""}${closeSlurs}`);
      cursor = addFractions(event.offset, event.duration);
    }
    if (compareFractions(cursor, durations[measureIndex]) < 0) tokens.push(`${invisibleGaps ? "x" : "z"}${abcLength(subtractFractions(durations[measureIndex], cursor))}`);
    const previous = measuresAuthority[measureIndex - 1];
    const current = measuresAuthority[measureIndex];
    const meterChange = measureIndex > 0 && previous
      && (previous.time.numerator !== current.time.numerator
        || previous.time.denominator !== current.time.denominator)
      ? `[M:${current.time.numerator}/${current.time.denominator}] `
      : "";
    measures.push(`${meterChange}${tokens.join(" ")} |`);
  }
  return measures.join(" ");
}

export function arrangementRenderDocumentToAbc(document: ArrangementRenderDocument, trackRoles: ProductTrackRoleRegistry, input: { readonly title: string; readonly tempo: TempoSpec; readonly key: KeySignature }): string {
  const durations = document.measures.map((measure) => measure.duration);
  const chordAt = Object.fromEntries(document.effectiveChordTimeline.spans.map((span) => {
    const symbol = span.parseResult.status === "ok" ? span.parseResult.chord.canonicalSymbol : "N.C.";
    return [`${span.range.start.performanceMeasureIndex}:${span.range.start.offset.n}/${span.range.start.offset.d}`, span.origin.kind === "arrangement-policy" ? `${symbol} (편곡 정책)` : symbol];
  }));
  const lead = document.sourceLeadTrack.atoms.map((atom) => ({ ...eventFromAtom(atom, document.measures), measureIndex: atom.range.start.performanceMeasureIndex }));
  const tracks = [
    { id: "lead", label: trackRoles.sourceLeadLabel ?? "Lead", notationOctaveShift: 0, events: lead },
    ...(document.sourceRhythmTracks?.map((track) => ({ id: `rhythm${track.voice}`, label: `Source Rhythm ${track.voice}`, notationOctaveShift: 0, events: track.atoms.map((atom) => ({ ...eventFromAtom(atom, document.measures), measureIndex: atom.range.start.performanceMeasureIndex })) })) ?? []),
    ...document.generatedHarmonyTracks.map((track) => {
      const metadata = trackRoles.byTrackPlanId[track.trackPlanId];
      if (!metadata) throw new RangeError(`TRACK_ROLE_METADATA_UNAVAILABLE:${track.trackPlanId}`);
      return { id: metadata.harmonyRole.toLowerCase(), label: metadata.label, notationOctaveShift: track.notationOctaveShift ?? 0, events: track.events.map((event) => ({ ...eventFromGenerated(event, document.measures), measureIndex: event.range.start.performanceMeasureIndex })) };
    }),
  ];
  const rhythm = document.sourceRhythmTracks ?? [];
  const sourceCount = 1 + rhythm.length;
  const chordOwner = (measureIndex: number) => { const index = rhythm.findIndex((track) => track.atoms.some((atom) => atom.range.start.performanceMeasureIndex === measureIndex)); return index < 0 ? 0 : index + 1; };
  const voices = tracks.map((track, index) => {
    const ownedChords = Object.fromEntries(Object.entries(chordAt).filter(([key]) => chordOwner(Number(key.split(":")[0])) === index));
    const voice=`[V:${track.id}] ${voiceMeasures(track.events, document.measures, durations, ownedChords, index < sourceCount, input.key, rhythm.length > 0 && index < sourceCount)}`;
    return index===0 ? voice+melodyLyricLines(document) : voice;
  }).join("\n");
  const score = rhythm.length ? `(${tracks.slice(0, sourceCount).map((track) => track.id).join(" ")}) ${tracks.slice(sourceCount).map((track) => track.id).join(" ")}` : tracks.map((track) => track.id).join(" ");
  const declarations = tracks.map((track) => `V:${track.id} name="${encodeAbcFreeText(track.label)}" clef=${track.notationOctaveShift === -1 ? "treble-8" : "treble"}`).join("\n");
  return `X:1\nT:${encodeAbcFreeText(input.title)}\nM:${document.measures[0]?.time.numerator ?? 4}/${document.measures[0]?.time.denominator ?? 4}\nL:1/16\nQ:${abcTempo(input.tempo)}\nK:${abcKey(input.key)}\n%%score ${score}\n${declarations}\n${voices}`;
}

function lyricText(text: string): string {
  // abcjs treats % as a comment even when escaped. Keep it visible as a
  // full-width percent; neutralize line injection only in the display copy.
  return encodeAbcFreeText(text).replace(/%/gu,"％").replace(/[-_*|~]/gu,"\\$&").replace(/ /gu,"\u00a0");
}

function melodyLyricLines(document: ArrangementRenderDocument): string {
  const lyrics=displayLyricsByAtom(document);
  const verses=[...new Set([...lyrics.values()].flatMap(tokens=>tokens.filter(t=>t.text.trim()).map(t=>t.verse)))].sort((a,b)=>a-b);
  return verses.map(verse=>{
    const words:string[]=[];
    for(const [index,measure] of document.measures.entries()){
      let cursor=fraction(0);
      const atoms=document.sourceLeadTrack.atoms.filter(atom=>atom.range.start.performanceMeasureIndex===index)
        .sort((a,b)=>compareFractions(a.range.start.offset,b.range.start.offset));
      for(const atom of atoms){
        // abcjs 6.7 consumes a lyric skip on both visible and invisible rests.
        // Include the exact same gaps/rests as voiceMeasures to keep alignment.
        if(compareFractions(cursor,atom.range.start.offset)<0)words.push("*");
        const tokens=(lyrics.get(atom.id) ?? []).filter(token=>token.verse===verse&&token.text.trim());
        const text=tokens.map(token=>lyricText(token.text)).join("\u00a0");
        const syllabic=tokens.at(-1)?.syllabic;
        words.push(text ? `${text}${syllabic==="begin"||syllabic==="middle"?"-":""}` : atom.tiedFromPrevious ? "_" : "*");
        cursor=addFractions(atom.range.start.offset,canonicalRangeDuration(document.measures,atom.range));
      }
      if(compareFractions(cursor,measure.duration)<0)words.push("*");
      words.push("|");
    }
    return `\nw: ${words.join(" ")}`;
  }).join("");
}

export type AbcSerializationOutcome =
  | { readonly status: "available"; readonly value: string }
  | { readonly status: "unavailable"; readonly code: "ABC_SERIALIZATION_UNAVAILABLE" };

export function arrangementRenderDocumentToAbcSafely(
  document: ArrangementRenderDocument,
  trackRoles: ProductTrackRoleRegistry,
  input: { readonly title: string; readonly tempo: TempoSpec; readonly key: KeySignature },
): AbcSerializationOutcome {
  try { return { status: "available", value: arrangementRenderDocumentToAbc(document, trackRoles, input) }; }
  catch { return { status: "unavailable", code: "ABC_SERIALIZATION_UNAVAILABLE" }; }
}
