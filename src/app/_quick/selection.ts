import type { QuickHarmonyChoice, QuickHarmonyNotice, QuickHarmonyPreparation } from "../../product/quick-harmony";
import type { PartChoice } from "../_ui/format";

export interface QuickSelection {
  readonly part?: PartChoice;
  readonly rights: boolean;
  readonly confirmedAt?: string;
  readonly answers: NonNullable<QuickHarmonyChoice["answers"]>;
}
export const emptySelection = (): QuickSelection => ({ rights: false, answers: {} });
export function preparedSelection(preparation: QuickHarmonyPreparation): QuickSelection {
  return { ...emptySelection(), part: preparation.summary?.recommendedPart };
}
export function confirmRights(selection: QuickSelection, checked: boolean, now: () => string): QuickSelection {
  return { ...selection, rights: checked, confirmedAt: checked ? selection.confirmedAt ?? now() : selection.confirmedAt };
}
export function questionKind(question: QuickHarmonyNotice): "lead" | "chord" | "edit" {
  if (question.choices.some(choice => choice.value === "carry-previous")) return "chord";
  if (question.choices.length && question.choices.every(choice => choice.value !== "edit-in-workspace")) return "lead";
  return "edit";
}
export function unansweredQuestions(preparation: QuickHarmonyPreparation, selection: QuickSelection) {
  return preparation.questions.filter(question => {
    const answer = questionKind(question) === "lead" ? selection.answers.lead : selection.answers.unreadPrintedChords;
    return questionKind(question) === "edit" || !question.choices.some(choice => choice.value === answer);
  });
}
export function harmonyChoice(preparation: QuickHarmonyPreparation, selection: QuickSelection): QuickHarmonyChoice | undefined {
  if (preparation.status === "unsupported" || !preparation.workspace || !selection.part || !selection.rights || !selection.confirmedAt || unansweredQuestions(preparation, selection).length) return undefined;
  return {
    rightsConfirmed: true, confirmedAt: selection.confirmedAt,
    parts: selection.part === "both" ? ["alto", "tenor"] : [selection.part],
    answers: selection.answers,
  };
}
