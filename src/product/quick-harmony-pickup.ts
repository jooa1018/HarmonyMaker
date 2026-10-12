import { addFractions, compareFractions, fraction } from "../domain/fraction";
import { sourceMeasureId } from "../domain/ids";
import { expandRepeats } from "../domain/performance/repeat";
import type { ImportedPartDraft } from "../import/musicxml/types";
import type { AutoDraftAssessment } from "../import/workspace/auto-draft";
import type { WorkspaceState } from "../import/workspace/model";
import type { QuickHarmonyNotice } from "./quick-harmony-notices";

export type PickupChordCheck = { readonly kind: "none" }
  | { readonly kind: "unavailable"; readonly notice: QuickHarmonyNotice }
  | { readonly kind: "question"; readonly measureId: string; readonly chord: string; readonly notice: QuickHarmonyNotice };
const unavailable = (): PickupChordCheck => ({ kind: "unavailable", notice: {
  id: "pickup-chord-unavailable", messageKo: "첫 못갖춘마디에 사용할 코드를 확실히 정할 수 없어요.",
  actionKo: "MuseScore에서 못갖춘마디와 다음 마디 시작의 코드를 확인하고 MusicXML로 다시 내보내 주세요.", choices: [],
} });

/** Readiness only: uses the existing repeat expander; never changes a resolver rule. */
export function inspectRepeatedPickup(part: ImportedPartDraft, lead: string, performanceVersion: string): PickupChordCheck {
  const [pickup, following] = part.measures;
  if (!pickup?.implicit || pickup.chords.length || !following) return { kind: "none" };
  const source = part.measures.map(m => ({ id: sourceMeasureId(m.ordinal), number: m.number, implicit: m.implicit,
    time: m.time, duration: m.duration, repeat: m.repeat, leadEvents: [], chordEvents: [], lyricTokens: [], textEvents: [] }));
  const expanded = expandRepeats(source, performanceVersion);
  if (expanded.status === "blocked") return unavailable();
  const occurrences = expanded.sequence.occurrences;
  const repeated = [pickup, following].some(m => m.repeat.startRepeat || m.repeat.endRepeat || m.repeat.endingNumbers?.length
    || occurrences.filter(o => o.sourceMeasureId === sourceMeasureId(m.ordinal)).length !== 1);
  if (!repeated) return { kind: "none" };
  const first = occurrences[0], next = occurrences[1], events = pickup.leadEvents.filter(e => e.candidateKey === lead);
  if (!first || !next || first.sourceMeasureId !== source[0].id || next.sourceMeasureId !== source[1].id
    || first.performanceIndex !== 0 || next.performanceIndex !== 1 || first.occurrenceIndexForSource !== 0 || next.occurrenceIndexForSource !== 0
    || pickup.duration.n <= 0 || compareFractions(pickup.duration, fraction(pickup.time.numerator * 4, pickup.time.denominator)) >= 0
    || !events.some(e => e.kind === "note") || events.some(e => e.onset.n < 0 || e.duration.n <= 0
      || compareFractions(addFractions(e.onset, e.duration), pickup.duration) > 0)) return unavailable();
  const anchors = following.chords.filter(c => c.onset.n === 0);
  if (anchors.length !== 1 || anchors[0].confirmation !== "confirmed" || anchors[0].parseResult.status !== "ok" || !pickup.workspaceMeasureId) return unavailable();
  const chord = anchors[0].parseResult.chord.canonicalSymbol;
  return { kind: "question", measureId: pickup.workspaceMeasureId, chord, notice: {
    id: "pickup-chord", messageKo: `첫 못갖춘마디에 코드가 없어요. ${following.number}번째 마디 첫 코드(${chord})를 못갖춘마디에도 쓸까요?`,
    actionKo: "확인하면 못갖춘마디 시작에 코드를 적어요. 반복할 때도 같은 코드를 쓰고, 쉼표로 시작하면 반주가 먼저 울릴 수 있어요.",
    choices: [{ value: "use-following-first-chord", labelKo: `${chord} 코드 사용하기` }],
  } };
}

export function quickPickupChord(state: WorkspaceState, assessment: AutoDraftAssessment, performanceVersion: string): PickupChordCheck {
  const lead = assessment.request?.lead, music = state.music;
  if (!lead || !music) return { kind: "none" };
  const candidate = music.leadCandidates.find(c => c.key === lead), part = music.parts.find(p => p.partOrdinal === candidate?.partOrdinal);
  if (!part) return { kind: "none" };
  // Exactly the existing auto-draft projection's chord confirmation convention:
  // parsed workspace chords become confirmed Source events, without a human-review claim.
  const projected = { ...part, measures: part.measures.map(m => ({ ...m, chords: m.chords.map(c => ({ ...c, confirmation: "confirmed" as const })) })) };
  const result = inspectRepeatedPickup(projected, lead, performanceVersion);
  if (result.kind !== "question") return result;
  // Never offer an anchor whose source evidence still has an unresolved question.
  const anchorMeasureId = part.measures[1].workspaceMeasureId;
  if (assessment.findings.some(f => (f.category === "question" || f.category === "unsupported") && f.code !== "RIGHTS_CONFIRMATION_REQUIRED"
    && (f.scope?.kind !== "measure" || f.scope.measureId === anchorMeasureId))) return unavailable();
  return result;
}
