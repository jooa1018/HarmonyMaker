import { parseChord } from "../../domain/chord/parser";
import { canonicalJson } from "../../domain/digest/canonical";
import { fraction, addFractions, subtractFractions, compareFractions, type Fraction } from "../../domain/fraction";
import { hasExactKeys, isPlainRecord, isCanonicalFraction, isCanonicalKeySignature, isCanonicalSpelledPitch, isCanonicalTimeSignature } from "../../domain/validation";
import { isSourceSlurMarks } from "../../domain/source/notation";
import { tempoSpec, validateRights } from "../../domain/source/model";
import { validatePerformer } from "../../domain/performer";
import { performerId } from "../../domain/ids";
import { buildImportedSectionOccurrenceReviews } from "../review/occurrences";
import { buildCandidates } from "../musicxml/parser-core";
import type { ImportedLeadEventDraft, ImportedMeasureDraft } from "../musicxml/types";
import type { WorkspaceEdit, WorkspaceState, WorkspaceOrigin } from "./model";
import { removeWorkspaceNotation, synchronizeWorkspaceNotation } from "./notation";

export const clean = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const invalid = (): never => { throw new RangeError("WORKSPACE_EDIT_INVALID"); };
function time(v: Fraction, positive = false) {
  if (!isCanonicalFraction(v) || v.n < 0 || positive && v.n === 0 || v.n / v.d > 4096) invalid();
}
export function measures(state: WorkspaceState) { return state.music?.parts.flatMap(p => p.measures) ?? []; }
export function requireMeasure(state: WorkspaceState, id: string): ImportedMeasureDraft {
  return measures(state).find(m => m.workspaceMeasureId === id) ?? invalid();
}
function mapMeasures(state: WorkspaceState, update: (m: ImportedMeasureDraft) => ImportedMeasureDraft): WorkspaceState {
  if (!state.music) return invalid();
  const music = { ...state.music, parts: state.music.parts.map(p => ({ ...p, measures: p.measures.map(update) })) };
  return { ...state, music: { ...music, leadCandidates: buildCandidates(music.parts) } };
}
function eventLocation(state: WorkspaceState, id: string) {
  const matches = state.music!.parts.flatMap(part => part.measures.flatMap(measure => {
    const event = measure.leadEvents.find(event => event.workspaceEventId === id), unknown = measure.unresolvedEvents?.find(event => event.id === id);
    return event || unknown ? [{ part, measure, event, unknown }] : [];
  }));
  return matches.length === 1 ? matches[0] : invalid();
}
function voiceKey(partOrdinal: number, staff: number, voice: string): string {
  if (!Number.isSafeInteger(staff) || staff < 1 || staff > 128 || typeof voice !== "string" || !voice.trim() || voice.length > 128 || /\p{Cc}/u.test(voice)) return invalid();
  const normalized = voice.normalize("NFC");
  return `lead:p:${partOrdinal}:s:${staff}:v:${normalized.length}:${normalized}`;
}
function refreshEditorOccurrences(state: WorkspaceState): WorkspaceState {
  if (!state.music) return state;
  const sectionOccurrences = buildImportedSectionOccurrenceReviews(state.music.parts, state.music.leadCandidates, state.request.sections, state.music.algorithmVersions.performanceExpanderVersion);
  const lyricVerses = Object.fromEntries(Object.entries(state.request.lyricVerses).filter(([key, verse]) => sectionOccurrences.some(occurrence => occurrence.key === key && occurrence.availableLyricVerses.includes(verse))));
  return { ...state, music: { ...state.music, sectionOccurrences }, request: { ...state.request, lyricVerses } };
}

/** Optional immutable context is supplied by journal replay, never by a command.
 * New tracking fields are absent from old seeds and old operation outputs. */
export function reduceWorkspaceEdit(state: WorkspaceState, edit: WorkspaceEdit, opId: string, origin?: WorkspaceOrigin, seed?: WorkspaceState, reviewDependencyVersion: 1 | 2 = 1): WorkspaceState {
  let next = reduceWorkspaceEditCore(state, edit, opId, origin, reviewDependencyVersion);
  if (["remove-notation", "event-voice", "remove-event", "move-event"].includes(edit.kind) && origin?.kind !== "legacy-recovery") next = { ...next, notationTracking: true };
  if (next.notationTracking) {
    if (!origin || !seed) throw new RangeError("WORKSPACE_NOTATION_ORIGIN_REQUIRED");
    next = synchronizeWorkspaceNotation(next, origin, seed);
  }
  return next;
}

/** Normal edits operate on Fraction values and imported nodes' stable identities.
 * No MusicXML serializer/parser round trip occurs in this reducer. */
function reduceWorkspaceEditCore(state: WorkspaceState, edit: WorkspaceEdit, opId: string, origin?: WorkspaceOrigin, reviewDependencyVersion: 1 | 2 = 1): WorkspaceState {
  const music = state.music;
  if (!music && edit.kind !== "issue") return invalid();
  const request = state.request;
  switch (edit.kind) {
    case "pickup-policy": {
      if (!hasExactKeys(edit, ["kind", "value"]) || !["none", "anticipate-first-chord"].includes(edit.value)) return invalid();
      const { initialPickup: previous, ...withoutPolicy } = request; void previous;
      return { ...state, request: edit.value === "none" ? withoutPolicy : { ...withoutPolicy, initialPickup: edit.value } };
    }
    case "title":
      if (typeof edit.title !== "string" || edit.title.length > 512) return invalid();
      return { ...state, music: { ...music!, title: edit.title.normalize("NFC") } };
    case "lead": {
      const keys = music!.leadCandidates.map(c => c.key);
      if (!keys.includes(edit.lead) || !Array.isArray(edit.rhythmVoices) || new Set(edit.rhythmVoices).size !== edit.rhythmVoices.length
        || edit.rhythmVoices.includes(edit.lead) || edit.rhythmVoices.some(v => !keys.includes(v))) return invalid();
      return { ...state, request: { ...request, lead: edit.lead, rhythmVoices: [...edit.rhythmVoices].sort() } };
    }
    case "key":
      if (!isCanonicalKeySignature(edit.key) || !measures(state).some(m => m.keyObservation?.contextId === edit.contextId)) return invalid();
      return { ...state, request: { ...request, keys: { ...request.keys, [edit.contextId]: clean(edit.key) } } };
    case "tempo":
      if (![4,8].includes(edit.tempo.beatUnit)||typeof edit.tempo.dotted!=="boolean") return invalid();
      return { ...state, request: { ...request, tempo: tempoSpec(edit.tempo.beatUnit, edit.tempo.dotted, edit.tempo.bpm) } };
    case "chord": {
      time(edit.onset); const m = requireMeasure(state, edit.measureId);
      if (typeof edit.text !== "string" || edit.text.length > 128 || edit.chordId && !m.chords.some(c => c.key === edit.chordId)) return invalid();
      const part = music!.parts.find(p => p.measures.includes(m))!;
      const old = m.chords.find(c => c.key === edit.chordId);
      const chord = { ...(old ?? { key: `inserted:${opId}`, partOrdinal: part.partOrdinal, measureOrdinal: m.ordinal }), onset: edit.onset,
        sourceText: edit.text, parseResult: parseChord(edit.text), source: "manual" as const, confirmation: "unconfirmed" as const };
      return mapMeasures(state, current => current !== m ? current : { ...current, chords: old ? current.chords.map(c => c === old ? chord : c) : [...current.chords, chord] });
    }
    case "fermata": {
      let found = false;
      if (typeof edit.value !== "boolean") return invalid();
      const next = mapMeasures(state, m => ({ ...m, leadEvents: m.leadEvents.map(e => {
        if (e.workspaceEventId !== edit.eventId) return e;
        found = true; return { ...e, fermata: edit.value };
      }) }));
      return found ? next : invalid();
    }
    case "note": {
      const v = edit.value; time(v.onset); time(v.duration, true);
      if (!["note", "rest", "rhythm"].includes(v.kind) || v.kind === "note" && !isCanonicalSpelledPitch(v.pitch)
        || v.kind !== "note" && v.pitch !== undefined || typeof v.tieStart !== "boolean" || typeof v.tieStop !== "boolean") return invalid();
      let found = false;
      const next = mapMeasures(state, m => {
        const old = m.leadEvents.find(e => e.workspaceEventId === edit.eventId);
        const unknown = m.unresolvedEvents?.find(e => e.id === edit.eventId);
        if (!old && !unknown) return m; found = true;
        const common = { workspaceEventId: edit.eventId, candidateKey: (old ?? unknown)!.candidateKey, onset: v.onset, duration: v.duration,
          ...(old?.musicXmlEventOrdinal !== undefined ? { musicXmlEventOrdinal: old.musicXmlEventOrdinal } : {}), ...(old?.fermata !== undefined ? { fermata: old.fermata } : {}) };
        const event: ImportedLeadEventDraft = v.kind === "rest" ? { ...common, kind: "rest" } : {
          ...common, ...(v.kind === "note" ? { kind: "note" as const, pitch: v.pitch! } : { kind: "rhythm" as const }),
          tieStart: v.tieStart, tieStop: v.tieStop, lyrics: old && old.kind !== "rest" ? old.lyrics : [],
          ...(old && old.kind !== "rest" && old.slurs ? { slurs: old.slurs } : {}),
        };
        return { ...m, leadEvents: old ? m.leadEvents.map(e => e === old ? event : e) : [...m.leadEvents, event], unresolvedEvents: m.unresolvedEvents?.filter(e => e.id !== edit.eventId) };
      });
      return found ? next : invalid();
    }
    case "remove-notation":
      return removeWorkspaceNotation(state, origin, edit.eventId, edit.feature);
    case "event-voice": {
      const { part, measure, event, unknown } = eventLocation(state, edit.eventId), candidateKey = voiceKey(part.partOrdinal, edit.staffNumber, edit.voice);
      return refreshEditorOccurrences(mapMeasures(state, current => current !== measure ? current : { ...current,
        leadEvents: current.leadEvents.map(item => item === event ? { ...item, candidateKey } : item),
        ...(unknown ? { unresolvedEvents: current.unresolvedEvents!.map(item => item === unknown ? { ...item, candidateKey } : item) } : {}) }));
    }
    case "insert-event": {
      const measure = requireMeasure(state, edit.measureId), part = music!.parts.find(part => part.measures.includes(measure))!;
      time(edit.onset); time(edit.duration, true);
      if (!["note", "rest", "rhythm"].includes(edit.eventKind) || edit.eventKind === "note" && !isCanonicalSpelledPitch(edit.pitch)
        || edit.eventKind !== "note" && edit.pitch !== undefined || edit.tieStart !== undefined && typeof edit.tieStart !== "boolean"
        || edit.tieStop !== undefined && typeof edit.tieStop !== "boolean" || edit.eventKind === "rest" && (edit.tieStart || edit.tieStop)
        || measure.leadEvents.length + (measure.unresolvedEvents?.length ?? 0) >= 1024 || measures(state).reduce((count, item) => count + item.leadEvents.length + (item.unresolvedEvents?.length ?? 0), 0) >= 32768) return invalid();
      const workspaceEventId = `inserted:${opId}`;
      if (measures(state).some(item => item.leadEvents.some(event => event.workspaceEventId === workspaceEventId) || item.unresolvedEvents?.some(event => event.id === workspaceEventId))) return invalid();
      const common = { workspaceEventId, candidateKey: voiceKey(part.partOrdinal, edit.staffNumber, edit.voice), onset: clean(edit.onset), duration: clean(edit.duration) };
      const event: ImportedLeadEventDraft = edit.eventKind === "rest" ? { ...common, kind: "rest" } : {
        ...common, ...(edit.eventKind === "note" ? { kind: "note" as const, pitch: clean(edit.pitch!) } : { kind: "rhythm" as const }),
        tieStart: edit.tieStart ?? false, tieStop: edit.tieStop ?? false, lyrics: [] };
      return refreshEditorOccurrences(mapMeasures(state, current => current !== measure ? current : { ...current, leadEvents: [...current.leadEvents, event] }));
    }
    case "remove-event": {
      const { measure, event, unknown } = eventLocation(state, edit.eventId);
      const next = mapMeasures(state, current => current !== measure ? current : { ...current, leadEvents: current.leadEvents.filter(item => item !== event),
        ...(unknown ? { unresolvedEvents: current.unresolvedEvents!.filter(item => item !== unknown) } : {}) });
      return refreshEditorOccurrences({ ...next, removedEventIds: [...(state.removedEventIds ?? []), edit.eventId] });
    }
    case "move-event": {
      const { part, measure, event, unknown } = eventLocation(state, edit.eventId), target = requireMeasure(state, edit.measureId); time(edit.onset);
      if (!part.measures.includes(target) || target !== measure && target.leadEvents.length + (target.unresolvedEvents?.length ?? 0) >= 1024) return invalid();
      return refreshEditorOccurrences(mapMeasures(state, current => {
        if (current !== measure && current !== target) return current;
        const leadEvents = current === measure ? current.leadEvents.filter(item => item !== event) : current.leadEvents;
        const unresolvedEvents = current === measure ? current.unresolvedEvents?.filter(item => item !== unknown) : current.unresolvedEvents;
        return { ...current, leadEvents: current === target && event ? [...leadEvents, { ...event, onset: clean(edit.onset) }] : leadEvents,
          ...(unknown ? { unresolvedEvents: current === target ? [...(unresolvedEvents ?? []), { ...unknown, onset: clean(edit.onset) }] : unresolvedEvents } : {}) };
      }));
    }
    case "measure-extent": {
      const measure = requireMeasure(state, edit.measureId); time(edit.duration, true);
      if (typeof edit.implicit !== "boolean") return invalid();
      return mapMeasures(state, current => current !== measure ? current : { ...current, duration: clean(edit.duration), implicit: edit.implicit });
    }
    case "event-lyrics": {
      const { measure, event } = eventLocation(state, edit.eventId);
      if (!event || event.kind === "rest" || !Array.isArray(edit.lyrics) || edit.lyrics.length > 32 || edit.lyrics.some(lyric => !isPlainRecord(lyric)
        || !hasExactKeys(lyric, ["text", "verse", "syllabic", "extend", "musicXmlAccent"]) || typeof lyric.text !== "string" || lyric.text.length > 2048
        || typeof lyric.verse !== "number" || !Number.isSafeInteger(lyric.verse) || lyric.verse < 1 || lyric.verse > 128 || !["single", "begin", "middle", "end"].includes(String(lyric.syllabic))
        || typeof lyric.extend !== "boolean" || typeof lyric.musicXmlAccent !== "boolean")) return invalid();
      return refreshEditorOccurrences(mapMeasures(state, current => current !== measure ? current : { ...current,
        leadEvents: current.leadEvents.map(item => item === event ? { ...event, lyrics: edit.lyrics.map(lyric => ({ ...lyric, text: lyric.text.normalize("NFC") })) } : item) }));
    }
    case "event-slurs": {
      const { measure, event } = eventLocation(state, edit.eventId);
      if (!event || event.kind === "rest" || !Array.isArray(edit.slurs) || edit.slurs.length && !isSourceSlurMarks(edit.slurs)) return invalid();
      const next = mapMeasures(state, current => current !== measure ? current : { ...current, leadEvents: current.leadEvents.map(item => {
        if (item !== event) return item;
        const changed = { ...event, ...(edit.slurs.length ? { slurs: clean(edit.slurs) } : {}) };
        if (!edit.slurs.length) delete changed.slurs;
        return changed;
      }) });
      return reviewDependencyVersion === 1 ? { ...next, slurReviewTracking: true } : next;
    }
    case "remove-chord":
    case "move-chord": {
      const matches = music!.parts.flatMap(part => part.measures.flatMap(measure => measure.chords.filter(chord => chord.key === edit.chordId).map(chord => ({ part, measure, chord }))));
      if (matches.length !== 1) return invalid();
      const { part, measure, chord } = matches[0];
      if (edit.kind === "remove-chord") return mapMeasures(state, current => current !== measure ? current : { ...current, chords: current.chords.filter(item => item !== chord) });
      time(edit.onset); const target = requireMeasure(state, edit.measureId);
      if (!part.measures.includes(target) || target !== measure && target.chords.length >= 1024) return invalid();
      return mapMeasures(state, current => {
        if (current !== measure && current !== target) return current;
        const chords = current === measure ? current.chords.filter(item => item !== chord) : current.chords;
        return { ...current, chords: current !== target ? chords : [...chords, { ...chord, measureOrdinal: target.ordinal, onset: clean(edit.onset), source: "manual" as const, confirmation: "unconfirmed" as const }] };
      });
    }
    case "meter": {
      if (!isCanonicalTimeSignature(edit.time)) return invalid();
      const first = requireMeasure(state, edit.startMeasureId), part = music!.parts.find(p => p.measures.includes(first))!;
      const end = edit.endMeasureIdExclusive === undefined ? part.measures.length : part.measures.findIndex(m => m.workspaceMeasureId === edit.endMeasureIdExclusive);
      if (end <= first.ordinal) return invalid();
      return mapMeasures(state, m => part.measures.includes(m) && m.ordinal >= first.ordinal && m.ordinal < end
        ? { ...m, time: clean(edit.time), duration: m.implicit ? m.duration : fraction(edit.time.numerator * 4, edit.time.denominator) } : m);
    }
    case "split": {
      const m = requireMeasure(state, edit.measureId); time(edit.at, true);
      if (compareFractions(edit.at, m.duration) >= 0 || (m.unresolvedEvents?.length ?? 0) > 0) return invalid();
      if (m.leadEvents.some(e => compareFractions(e.onset, edit.at) < 0 && compareFractions(addFractions(e.onset, e.duration), edit.at) > 0)) throw new RangeError("WORKSPACE_SPLIT_CROSSES_EVENT");
      const right = <T extends { readonly onset: Fraction }>(events: readonly T[]) => events.filter(e => compareFractions(e.onset, edit.at) >= 0).map(e => ({ ...e, onset: subtractFractions(e.onset, edit.at) }));
      const left = <T extends { readonly onset: Fraction }>(events: readonly T[]) => events.filter(e => compareFractions(e.onset, edit.at) < 0);
      const first: ImportedMeasureDraft = { ...m, duration: edit.at, implicit: true, leadEvents: left(m.leadEvents), chords: left(m.chords), textEvents: left(m.textEvents), repeat: { startRepeat: m.repeat.startRepeat } };
      const second: ImportedMeasureDraft = { ...m, workspaceMeasureId: `inserted:${opId}`, duration: subtractFractions(m.duration, edit.at), implicit: true, leadEvents: right(m.leadEvents), chords: right(m.chords), textEvents: right(m.textEvents), repeat: { ...m.repeat, startRepeat: false } };
      const parts = music!.parts.map(p => ({ ...p, measures: p.measures.flatMap(x => x === m ? [first, second] : [x]).map((x, i) => ({ ...x, ordinal: i, number: i + 1, chords: x.chords.map(c => ({ ...c, measureOrdinal: i })) })) }));
      const sections = request.sections.map(s => s.partOrdinal === music!.parts.find(p => p.measures.includes(m))!.partOrdinal ? { ...s,
        startMeasureOrdinal: s.startMeasureOrdinal > m.ordinal ? s.startMeasureOrdinal + 1 : s.startMeasureOrdinal,
        endMeasureOrdinalExclusive: s.endMeasureOrdinalExclusive > m.ordinal ? s.endMeasureOrdinalExclusive + 1 : s.endMeasureOrdinalExclusive,
        confirmation: "suggested" as const } : s);
      const leadCandidates = buildCandidates(parts);
      const nextMusic = { ...music!, parts, leadCandidates, sections, sectionOccurrences: buildImportedSectionOccurrenceReviews(parts, leadCandidates, sections, music!.algorithmVersions.performanceExpanderVersion) };
      return { ...state, music: nextMusic, request: { ...request, sections, lyricVerses: {} } };
    }
    case "performers":
      if (![1,2,3].includes(edit.count) || edit.slots.length !== edit.count || edit.slots.some((s,i) => s.id !== performerId(i) || s.profile && (s.profile.id !== s.id || !validatePerformer(s.profile)))) return invalid();
      return { ...state, request: { ...request, singerCount: edit.count, performers: clean(edit.slots) } };
    case "rights":
      if (!validateRights(edit.rights)) return invalid();
      return { ...state, request: { ...request, rights: clean(edit.rights) } };
    case "sections":
      if (!Array.isArray(edit.sections) || edit.sections.length > 512 || !edit.sections.length || edit.sections.some(s => !music!.sections.some(old => old.key === s.key)
        || !["confirmed", "suggested"].includes(s.confirmation) || !["intro","verse","pre-chorus","chorus","bridge","tag","ending","other"].includes(s.type))) return invalid();
      return { ...state, request: { ...request, sections: clean(edit.sections), lyricVerses: clean(edit.lyricVerses) } };
    case "issue":
      if (!edit.detail?.trim() || edit.detail.length > 2048 || !["measure", "document", "metadata"].includes(edit.scope.kind)) return invalid();
      if (edit.scope.kind === "measure") requireMeasure(state, edit.scope.measureId);
      return { ...state, issues: [...state.issues, { id: `manual:${opId}`, kind: edit.scope.kind === "metadata" ? "metadata" : "unknown", scope: clean(edit.scope),
        targetIds: edit.scope.kind === "measure" ? [edit.scope.measureId] : [], messageKo: edit.detail, requiredAction: "compare", evidenceRef: `operation:${opId}`,
        impacts: edit.scope.kind === "metadata" ? [] : ["arrange", "play-source", "export-source"] }] };
    default: return invalid();
  }
}
export function changedWorkspaceTargets(before: WorkspaceState, after: WorkspaceState): readonly string[] {
  const ids = [...new Set([...measures(before), ...measures(after)].map(m => m.workspaceMeasureId!))];
  const same = (a: unknown, b: unknown) => a === b || canonicalJson(clean(a)) === canonicalJson(clean(b));
  const beforeMeasures = new Map(measures(before).map(m => [m.workspaceMeasureId, m]));
  const afterMeasures = new Map(measures(after).map(m => [m.workspaceMeasureId, m]));
  const changed = before.music?.parts === after.music?.parts ? [] : ids.filter(id => !same(beforeMeasures.get(id) ?? null, afterMeasures.get(id) ?? null));
  if (!same(before.request, after.request)) changed.push("arrangement-request");
  if (before.music?.title !== after.music?.title) changed.push("title");
  if (!same(before.issues, after.issues)) changed.push("issues");
  if (canonicalJson(before.notationRemovals ?? null) !== canonicalJson(after.notationRemovals ?? null)) {
    changed.push(...new Set([...(before.notationRemovals ?? []), ...(after.notationRemovals ?? [])].map(item => item.eventId)));
  }
  if (before.notationTracking !== after.notationTracking) changed.push("notation-tracking");
  if (before.slurReviewTracking !== after.slurReviewTracking) changed.push("slur-review-tracking");
  if (canonicalJson(before.removedEventIds ?? null) !== canonicalJson(after.removedEventIds ?? null)) changed.push(...new Set([...(before.removedEventIds ?? []), ...(after.removedEventIds ?? [])]));
  if (canonicalJson(before.invalidatedLegacyReviewIds ?? null) !== canonicalJson(after.invalidatedLegacyReviewIds ?? null)) changed.push("legacy-review-invalidations");
  return changed;
}
