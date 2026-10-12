import type { ArrangementPresetId } from "../domain/config";
import type { ArrangementRenderDocument, GeneratedVoiceEvent } from "../domain/generation/model";
import type { HarmonyProject } from "../domain/project";
import type { CompactChord, CompactFraction, CompactNoteEvent, CompactTrack, CompactVocalEvent, PracticeSettings, PracticeSharePayload } from "../domain/share";
import { isPracticeSharePayload } from "../domain/share";
import type { TimelineAtom } from "../domain/source/atomization";
import type { Fraction } from "../domain/fraction";
import type { MaterializedArrangement } from "./render";
import { canonicalRangeDuration } from "./timing";
import { displayLyricsByAtom } from "./display-lyrics";
import { validCompactChordPolicy, type CompactChordOrigin } from "../domain/share-chord-policy";
import type { EffectiveChordTimeline } from "../domain/harmony/chord-timeline";

function compactOrigins(timeline: EffectiveChordTimeline): readonly CompactChordOrigin[] {
  const sources = new Map<string, number>(), spans = new Map(timeline.spans.map((span,index) => [span.id,index]));
  if (spans.size !== timeline.spans.length) throw new RangeError("SHARE_ARRANGEMENT_POLICY_INCONSISTENT");
  const source = (id: string) => { if (!sources.has(id)) sources.set(id,sources.size); return sources.get(id)!; };
  return timeline.spans.map(span => {
    const o = span.origin;
    if (o.kind === "source-event") return { kind:o.kind, source:source(o.sourceChordEventId) };
    if (o.kind === "arrangement-policy") return { kind:o.kind, policy:o.policy, followingSource:source(o.followingSourceChordEventId) };
    const previous = spans.get(o.previousSpanId);
    if (previous === undefined) throw new RangeError("SHARE_ARRANGEMENT_POLICY_INCONSISTENT");
    return { kind:o.kind, carrySource:o.carrySource, source:source(o.originatingSourceChordEventId), previous,
      ...(o.carryTokenSourceChordEventId !== undefined ? {tokenSource:source(o.carryTokenSourceChordEventId)} : {}) };
  });
}

function compact(value: Fraction): CompactFraction { return [value.n, value.d]; }
function lyricMap(document: ArrangementRenderDocument): { readonly tokens: PracticeSharePayload["lyrics"]; readonly sourceToLocal: Readonly<Record<string, string>> } {
  const sourceToLocal = Object.fromEntries(document.lyricTokens.map((token, index) => [token.id, `ly:${index}`]));
  return {
    sourceToLocal,
    tokens: document.lyricTokens.map((token, index) => ({ id: `ly:${index}`, text: token.text, verse: token.verse, syllabic: token.syllabic, extend: token.extend })),
  };
}
function compactEvent(input: { readonly measureIndex: number; readonly offset: Fraction; readonly duration: Fraction; readonly rhythmOnly?: true; readonly pitch?: { readonly step: "A" | "B" | "C" | "D" | "E" | "F" | "G"; readonly alter: -2 | -1 | 0 | 1 | 2; readonly octave: number }; readonly tieStart: boolean; readonly tieStop: boolean; readonly lyricTokenIds: readonly string[] }, sourceToLocal: Readonly<Record<string, string>>): CompactVocalEvent {
  if (!input.pitch && !input.rhythmOnly) return { kind: "rest", occurrenceIndex: input.measureIndex, offset: compact(input.offset), duration: compact(input.duration) };
  const lyricTokenIds = input.lyricTokenIds.flatMap((id) => sourceToLocal[id] ? [sourceToLocal[id]] : []);
  if (input.rhythmOnly) return { kind: "rhythm", occurrenceIndex: input.measureIndex, offset: compact(input.offset), duration: compact(input.duration), ...(input.tieStart ? { tieStart: true } : {}), ...(input.tieStop ? { tieStop: true } : {}), ...(lyricTokenIds.length ? { lyricTokenIds } : {}) };
  if (!input.pitch) throw new RangeError("SHARE_PITCH_UNAVAILABLE");
  return { kind: "note", occurrenceIndex: input.measureIndex, offset: compact(input.offset), duration: compact(input.duration), pitch: [input.pitch.step, input.pitch.alter, input.pitch.octave], ...(input.tieStart ? { tieStart: true } : {}), ...(input.tieStop ? { tieStop: true } : {}), ...(lyricTokenIds.length > 0 ? { lyricTokenIds } : {}) } as CompactNoteEvent;
}
function atomEvent(atom: TimelineAtom, document: ArrangementRenderDocument, sourceToLocal: Readonly<Record<string, string>>): CompactVocalEvent {
  const event = compactEvent({ measureIndex: atom.range.start.performanceMeasureIndex, offset: atom.range.start.offset, duration: canonicalRangeDuration(document.measures, atom.range), ...(atom.pitch ? { pitch: atom.pitch } : {}), ...(atom.rhythmOnly ? { rhythmOnly: true } : {}), tieStart: atom.tiedToNext, tieStop: atom.tiedFromPrevious, lyricTokenIds: atom.lyricTokenIds }, sourceToLocal);
  return {...event,...(event.kind !== "rest" && atom.slurs?.length ? {slurs:atom.slurs.map(mark=>({...mark}))} : {}),...(atom.tuplets ? {tuplets:atom.tuplets.map(mark=>({...mark}))} : {})};
}
function generatedEvent(event: GeneratedVoiceEvent, document: ArrangementRenderDocument, sourceToLocal: Readonly<Record<string, string>>): CompactVocalEvent { return compactEvent({ measureIndex: event.range.start.performanceMeasureIndex, offset: event.range.start.offset, duration: canonicalRangeDuration(document.measures, event.range), ...(event.kind === "note" ? { pitch: event.pitch, tieStart: event.tieStart, tieStop: event.tieStop, lyricTokenIds: event.lyricTokenIds } : { tieStart: false, tieStop: false, lyricTokenIds: [] }) }, sourceToLocal); }

export function confirmShareRights(project: HarmonyProject, confirmedAt?: string): HarmonyProject {
  if (project.source.importInfo?.sourceKind === "score-workspace") {
    throw new RangeError("WORKSPACE_RIGHTS_IMMUTABLE_USE_EXPORT_CONFIRMATION");
  }
  const allowedUses = [...new Set([...project.source.rights.allowedUses, "share" as const])].sort();
  return { ...project, source: { ...project.source, rights: { ...project.source.rights, allowedUses, ...(confirmedAt ? { confirmedAt } : {}) } } };
}

export function materializePracticeShare(input: { readonly project: HarmonyProject; readonly presetId: ArrangementPresetId; readonly materialized: MaterializedArrangement; readonly playbackDefaults?: PracticeSettings; readonly workspaceShareConfirmedForThisExport?: true }): PracticeSharePayload {
  if (input.materialized.validity !== "valid") throw new RangeError("SHARE_ARTIFACT_INVALID");
  // A per-export confirmation authorizes only the compact practice payload.
  // It never rewrites the rights attestation sealed in a workspace Source.
  const workspaceConfirmation = input.project.source.importInfo?.sourceKind === "score-workspace"
    && input.workspaceShareConfirmedForThisExport === true;
  if (!workspaceConfirmation && !input.project.source.rights.allowedUses.includes("share")) throw new RangeError("SHARE_RIGHTS_REQUIRED");
  const document = input.materialized.document;
  const timeline = document.effectiveChordTimeline;
  const hasPolicy = timeline.resolutionPolicy.initialPickup !== undefined || timeline.spans.some(span => span.origin.kind === "arrangement-policy");
  const projectPolicy = input.project.chordTimelineState.status === "resolved" ? input.project.chordTimelineState.timeline.resolutionPolicy : undefined;
  if (projectPolicy?.initialPickup && (!hasPolicy || projectPolicy.initialPickup !== timeline.resolutionPolicy.initialPickup
    || projectPolicy.gapPolicy !== timeline.resolutionPolicy.gapPolicy)) throw new RangeError("SHARE_ARRANGEMENT_POLICY_INCONSISTENT");
  const origins = hasPolicy ? compactOrigins(timeline) : undefined;
  // V4 share has one Source voice. Refuse a lossy public payload until that schema expands.
  if (document.sourceRhythmTracks?.length) throw new RangeError("SHARE_SEPARATE_RHYTHM_VOICES_UNSUPPORTED");
  const hasNotation = document.sourceLeadTrack.atoms.some((atom) => atom.slurs?.length || atom.tuplets?.length);
  const localLyrics = lyricMap(document);
  const displayLyrics = displayLyricsByAtom(document);
  const tracks: CompactTrack[] = [
    { kind: "source-lead", label: input.materialized.trackRoles.sourceLeadLabel ?? "Lead", events: document.sourceLeadTrack.atoms.map((atom) => atomEvent({ ...atom, lyricTokenIds: (displayLyrics.get(atom.id) ?? []).map(token => token.id) }, document, localLyrics.sourceToLocal)) },
    ...document.generatedHarmonyTracks.map((track) => {
      const metadata = input.materialized.trackRoles.byTrackPlanId[track.trackPlanId];
      if (!metadata) throw new RangeError(`TRACK_ROLE_METADATA_UNAVAILABLE:${track.trackPlanId}`);
      return {
        kind: "generated-harmony" as const,
        label: metadata.label,
        harmonyRole: metadata.harmonyRole,
        ...(track.notationOctaveShift !== undefined ? { notationOctaveShift: track.notationOctaveShift } : {}),
        placementRoles: [...new Set(metadata.placements.map((placement) => placement.placementRole))].sort(),
        events: track.events.map((event) => generatedEvent(event, document, localLyrics.sourceToLocal)),
      };
    }),
  ];
  const chords: CompactChord[] = document.effectiveChordTimeline.spans.map((span,index) => {
    const common = {
      startOccurrenceIndex: span.range.start.performanceMeasureIndex, startOffset: compact(span.range.start.offset),
      endOccurrenceIndex: span.range.end.performanceMeasureIndex, endOffset: compact(span.range.end.offset),
      ...(origins ? {origin:origins[index]} : {}),
    };
    return span.parseResult.status === "ok"
      ? { ...common, kind: "chord", symbol: span.parseResult.chord.canonicalSymbol }
      : { ...common, kind: "no-chord" };
  });
  const payload: PracticeSharePayload = {
    schemaVersion: hasNotation || hasPolicy ? 5 : 4, title: input.project.source.title, tempo: input.project.source.defaultTempo,
    ...(hasPolicy ? {resolutionPolicy:{...timeline.resolutionPolicy}} : {}),
    key: input.project.source.defaultKey, presetId: input.presetId,
    arrangementArtifactDigest: input.materialized.artifactDigest,
    effectiveChordTimelineDigest: document.effectiveChordTimeline.digest,
    arrangement: { measures: document.measures.map((measure, index) => ({ index, sourceMeasureNumber: measure.sourceMeasureNumber, lyricVerseIndex: input.project.source.sectionOccurrences.find((occurrence) => index >= occurrence.startPerformanceMeasureIndex && index < occurrence.endPerformanceMeasureIndexExclusive)?.lyricVerseIndex ?? 1, timeSignature: [measure.time.numerator, measure.time.denominator], duration: compact(measure.duration) })), tracks },
    lyrics: localLyrics.tokens, chords,
    ...(input.playbackDefaults ? { playbackDefaults: input.playbackDefaults } : {}),
    rightsShareConfirmed: true,
  };
  if (hasPolicy && !validCompactChordPolicy(timeline.resolutionPolicy,chords,payload.arrangement.measures))
    throw new RangeError("SHARE_ARRANGEMENT_POLICY_INCONSISTENT");
  if (!isPracticeSharePayload(payload)) throw new RangeError("SHARE_PAYLOAD_INVALID");
  return payload;
}
