import { defaultHarmonyPart, type HarmonyPartPreset } from "../domain/part-presets";
import { pitchMidiNumber } from "../domain/pitch";
import type { MusicXmlImportDraft } from "../import/musicxml/types";
import type { ArrangementRequest } from "../import/workspace/model";

export interface QuickHarmonySummary {
  readonly title: string | null;
  readonly keyLabelKo: string;
  readonly meters: readonly string[];
  readonly measureCount: number;
  readonly hasLyrics: boolean;
  readonly verseCount: number;
  readonly recommendedPart: HarmonyPartPreset;
}

/** The selected printed melody, before repeat expansion or verse selection. */
export function summarizeQuickHarmonyMelody(music: MusicXmlImportDraft, request: ArrangementRequest & {readonly lead: string}): QuickHarmonySummary {
  const candidate = music.leadCandidates.find(candidate => candidate.key === request.lead);
  const part = music.parts.find(part => part.partOrdinal === candidate?.partOrdinal);
  if(!part)throw new RangeError("QUICK_HARMONY_SUMMARY_LEAD_REQUIRED");
  const events = part.measures.flatMap(measure => measure.leadEvents).filter(event => event.candidateKey === request.lead);
  const pitches = events.flatMap(event => event.kind === "note" ? [pitchMidiNumber(event.pitch)] : []).sort((a,b)=>a-b);
  if(!pitches.length)throw new RangeError("QUICK_HARMONY_SUMMARY_PITCH_REQUIRED");
  const first = part.measures[0];
  const key = first?.keyObservation ? request.keys[first.keyObservation.contextId] ?? first.key : first?.key;
  const accidental = key ? ({[-2]:"bb",[-1]:"b",0:"",1:"#",2:"##"} as const)[key.tonic.alter] : "";
  const verses = new Set(events.flatMap(event => event.kind === "rest" ? [] : event.lyrics.filter(lyric=>lyric.text.trim()).map(lyric=>lyric.verse)));
  return {
    title: music.title.trim() || null,
    keyLabelKo: key ? `${key.tonic.step}${accidental}${key.mode === "major" ? "장조" : "단조"}` : "조성 확인 필요",
    meters: [...new Set(part.measures.map(measure=>`${measure.time.numerator}/${measure.time.denominator}`))],
    measureCount: part.measures.length,
    hasLyrics: verses.size > 0,
    verseCount: verses.size,
    recommendedPart: defaultHarmonyPart(pitches[Math.floor(pitches.length / 2)]),
  };
}
