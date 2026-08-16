import type { ArrangementPresetId } from "../domain/config";
import type { ArrangementRenderDocument, GeneratedVoiceEvent } from "../domain/generation/model";
import type { HarmonyProject } from "../domain/project";
import type { CompactChord, CompactFraction, CompactNoteEvent, CompactTrack, CompactVocalEvent, PracticeSettings, PracticeSharePayload } from "../domain/share";
import { isPracticeSharePayload } from "../domain/share";
import type { TimelineAtom } from "../domain/source/atomization";
import type { Fraction } from "../domain/fraction";
import type { MaterializedArrangement } from "./render";
import { canonicalRangeDuration } from "./timing";

function compact(value: Fraction): CompactFraction { return [value.n, value.d]; }
function lyricMap(document: ArrangementRenderDocument): { readonly tokens: PracticeSharePayload["lyrics"]; readonly sourceToLocal: Readonly<Record<string, string>> } {
  const sourceToLocal = Object.fromEntries(document.lyricTokens.map((token, index) => [token.id, `ly:${index}`]));
  return {
    sourceToLocal,
    tokens: document.lyricTokens.map((token, index) => ({ id: `ly:${index}`, text: token.text, verse: token.verse, syllabic: token.syllabic, extend: token.extend })),
  };
}
function compactEvent(input: { readonly measureIndex: number; readonly offset: Fraction; readonly duration: Fraction; readonly pitch?: { readonly step: "A" | "B" | "C" | "D" | "E" | "F" | "G"; readonly alter: -2 | -1 | 0 | 1 | 2; readonly octave: number }; readonly tieStart: boolean; readonly tieStop: boolean; readonly lyricTokenIds: readonly string[] }, sourceToLocal: Readonly<Record<string, string>>): CompactVocalEvent {
  if (!input.pitch) return { kind: "rest", occurrenceIndex: input.measureIndex, offset: compact(input.offset), duration: compact(input.duration) };
  const lyricTokenIds = input.lyricTokenIds.flatMap((id) => sourceToLocal[id] ? [sourceToLocal[id]] : []);
  return { kind: "note", occurrenceIndex: input.measureIndex, offset: compact(input.offset), duration: compact(input.duration), pitch: [input.pitch.step, input.pitch.alter, input.pitch.octave], ...(input.tieStart ? { tieStart: true } : {}), ...(input.tieStop ? { tieStop: true } : {}), ...(lyricTokenIds.length > 0 ? { lyricTokenIds } : {}) } as CompactNoteEvent;
}
function atomEvent(atom: TimelineAtom, document: ArrangementRenderDocument, sourceToLocal: Readonly<Record<string, string>>): CompactVocalEvent { return compactEvent({ measureIndex: atom.range.start.performanceMeasureIndex, offset: atom.range.start.offset, duration: canonicalRangeDuration(document.measures, atom.range), ...(atom.pitch ? { pitch: atom.pitch } : {}), tieStart: atom.tiedToNext, tieStop: atom.tiedFromPrevious, lyricTokenIds: atom.lyricTokenIds }, sourceToLocal); }
function generatedEvent(event: GeneratedVoiceEvent, document: ArrangementRenderDocument, sourceToLocal: Readonly<Record<string, string>>): CompactVocalEvent { return compactEvent({ measureIndex: event.range.start.performanceMeasureIndex, offset: event.range.start.offset, duration: canonicalRangeDuration(document.measures, event.range), ...(event.kind === "note" ? { pitch: event.pitch, tieStart: event.tieStart, tieStop: event.tieStop, lyricTokenIds: event.lyricTokenIds } : { tieStart: false, tieStop: false, lyricTokenIds: [] }) }, sourceToLocal); }

export function confirmShareRights(project: HarmonyProject, confirmedAt?: string): HarmonyProject {
  const allowedUses = [...new Set([...project.source.rights.allowedUses, "share" as const])].sort();
  return { ...project, source: { ...project.source, rights: { ...project.source.rights, allowedUses, ...(confirmedAt ? { confirmedAt } : {}) } } };
}

export function materializePracticeShare(input: { readonly project: HarmonyProject; readonly presetId: ArrangementPresetId; readonly materialized: MaterializedArrangement; readonly playbackDefaults?: PracticeSettings }): PracticeSharePayload {
  if (input.materialized.validity !== "valid") throw new RangeError("SHARE_ARTIFACT_INVALID");
  if (!input.project.source.rights.allowedUses.includes("share")) throw new RangeError("SHARE_RIGHTS_REQUIRED");
  const document = input.materialized.document;
  const localLyrics = lyricMap(document);
  const tracks: CompactTrack[] = [
    { kind: "source-lead", label: "Lead", events: document.sourceLeadTrack.atoms.map((atom) => atomEvent(atom, document, localLyrics.sourceToLocal)) },
    ...document.generatedHarmonyTracks.map((track, index) => ({ kind: "generated-harmony" as const, label: index === 0 ? "Upper / Harmony 1" : "Lower / Harmony 2", events: track.events.map((event) => generatedEvent(event, document, localLyrics.sourceToLocal)) })),
  ];
  const chords: CompactChord[] = document.effectiveChordTimeline.spans.map((span) => ({
    kind: span.parseResult.status === "ok" ? "chord" as const : "no-chord" as const,
    startOccurrenceIndex: span.range.start.performanceMeasureIndex, startOffset: compact(span.range.start.offset),
    endOccurrenceIndex: span.range.end.performanceMeasureIndex, endOffset: compact(span.range.end.offset),
    ...(span.parseResult.status === "ok" ? { symbol: span.parseResult.chord.canonicalSymbol } : {}),
  }));
  const payload: PracticeSharePayload = {
    schemaVersion: 3, title: input.project.source.title, tempo: input.project.source.defaultTempo,
    key: input.project.source.defaultKey, presetId: input.presetId,
    arrangementArtifactDigest: input.materialized.artifactDigest,
    effectiveChordTimelineDigest: document.effectiveChordTimeline.digest,
    arrangement: { measures: document.measures.map((measure, index) => ({ index, sourceMeasureNumber: measure.sourceMeasureNumber, lyricVerseIndex: input.project.source.sectionOccurrences.find((occurrence) => index >= occurrence.startPerformanceMeasureIndex && index < occurrence.endPerformanceMeasureIndexExclusive)?.lyricVerseIndex ?? 1, timeSignature: [measure.time.numerator, measure.time.denominator], duration: compact(measure.duration) })), tracks },
    lyrics: localLyrics.tokens, chords,
    ...(input.playbackDefaults ? { playbackDefaults: input.playbackDefaults } : {}),
    rightsShareConfirmed: true,
  };
  if (!isPracticeSharePayload(payload)) throw new RangeError("SHARE_PAYLOAD_INVALID");
  return payload;
}
