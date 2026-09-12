import { parseChord } from "../../domain/chord/parser";
import { canonicalJson } from "../../domain/digest/canonical";
import { fraction, addFractions, subtractFractions, compareFractions, type Fraction } from "../../domain/fraction";
import { isCanonicalFraction, isCanonicalKeySignature, isCanonicalSpelledPitch, isCanonicalTimeSignature } from "../../domain/validation";
import { tempoSpec, validateRights } from "../../domain/source/model";
import { validatePerformer } from "../../domain/performer";
import { performerId } from "../../domain/ids";
import { buildImportedSectionOccurrenceReviews } from "../review/occurrences";
import { buildCandidates } from "../musicxml/parser-core";
import type { ImportedLeadEventDraft, ImportedMeasureDraft } from "../musicxml/types";
import type { WorkspaceEdit, WorkspaceState } from "./model";

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

/** Normal edits operate on Fraction values and imported nodes' stable identities.
 * No MusicXML serializer/parser round trip occurs in this reducer. */
export function reduceWorkspaceEdit(state: WorkspaceState, edit: WorkspaceEdit, opId: string): WorkspaceState {
  const music = state.music;
  if (!music && edit.kind !== "issue") return invalid();
  const request = state.request;
  switch (edit.kind) {
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
  const changed = ids.filter(id => canonicalJson(clean(measures(before).find(m => m.workspaceMeasureId === id) ?? null)) !== canonicalJson(clean(measures(after).find(m => m.workspaceMeasureId === id) ?? null)));
  if (canonicalJson(before.request) !== canonicalJson(after.request)) changed.push("arrangement-request");
  if (before.music?.title !== after.music?.title) changed.push("title");
  if (canonicalJson(before.issues) !== canonicalJson(after.issues)) changed.push("issues");
  return changed;
}
