import type { QuickHarmonyChoice, QuickHarmonyNotice, QuickHarmonyPreparation } from "../../product/quick-harmony";
type SelectionPreparation = Pick<QuickHarmonyPreparation, "status" | "summary" | "questions">;
import type { PartChoice } from "../_ui/format";

export interface QuickSelection {
  readonly part?: PartChoice;
  readonly tempoOverride?: number;
  readonly rights: boolean;
  readonly confirmedAt?: string;
  readonly answers: NonNullable<QuickHarmonyChoice["answers"]>;
}
export const emptySelection = (): QuickSelection => ({ rights: false, answers: {} });
export function preparedSelection(preparation: SelectionPreparation): QuickSelection {
  return { ...emptySelection(), part: preparation.summary?.recommendedPart };
}
export function confirmRights(selection: QuickSelection, checked: boolean, now: () => string): QuickSelection {
  return { ...selection, rights: checked, confirmedAt: checked ? selection.confirmedAt ?? now() : selection.confirmedAt };
}
export function questionKind(question: QuickHarmonyNotice): "lead" | "chord" | "pickup" | "edit" {
  if (question.id === "pickup-chord") return "pickup";
  if (question.choices.some(choice => choice.value === "carry-previous")) return "chord";
  if (question.choices.length && question.choices.every(choice => choice.value !== "edit-in-workspace")) return "lead";
  return "edit";
}
function answerKey(question: QuickHarmonyNotice): keyof QuickSelection["answers"] | undefined {
  const kind = questionKind(question);
  return kind === "lead" ? "lead" : kind === "chord" ? "unreadPrintedChords" : kind === "pickup" ? "pickupChord" : undefined;
}
export function questionAnswer(question: QuickHarmonyNotice, selection: QuickSelection) {
  const key = answerKey(question);
  return key ? selection.answers[key] : undefined;
}
export function selectQuestionAnswer(selection: QuickSelection, question: QuickHarmonyNotice, value: string): QuickSelection | undefined {
  const key = answerKey(question);
  if (!key || !question.choices.some(choice => choice.value === value)) return undefined;
  // The engine owns the offered values, including future values for this answer field.
  return { ...selection, answers: { ...selection.answers, [key]: value } };
}
export function unansweredQuestions(preparation: SelectionPreparation, selection: QuickSelection) {
  return preparation.questions.filter(question => questionKind(question) === "edit"
    || !question.choices.some(choice => choice.value === questionAnswer(question, selection)));
}
export function harmonyChoice(preparation: SelectionPreparation, selection: QuickSelection): QuickHarmonyChoice | undefined {
  if (preparation.status === "unsupported" || !selection.part || !selection.rights || !selection.confirmedAt || unansweredQuestions(preparation, selection).length) return undefined;
  return {
    rightsConfirmed: true, confirmedAt: selection.confirmedAt,
    parts: selection.part === "both" ? ["alto", "tenor"] : [selection.part],
    answers: selection.answers,
    ...(selection.tempoOverride === undefined ? {} : { tempo: { bpm: selection.tempoOverride } }),
  };
}
