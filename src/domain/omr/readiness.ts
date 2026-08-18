import type { Diagnostic } from "../diagnostics";
import { addFractions, compareFractions, fraction } from "../fraction";
import { pitchMidiNumber } from "../pitch";
import type { SongSourceDocument } from "../source/model";
import { materializeImportDiagnostics, type ImportDiagnosticInput } from "../../import/musicxml/diagnostics";
import { validateOmrReviewCompletion } from "./foundation";
import { validateOmrCorrectionHistory } from "./review";
import { revisionRefsEqual } from "../source/revision";

export type RuntimeOmrReadiness = "validator-ready" | "review-required" | "blocked";

export interface RuntimeOmrValidationResult {
  readonly readiness: RuntimeOmrReadiness;
  readonly diagnostics: readonly Diagnostic[];
}

function sourceRevision(source: SongSourceDocument) {
  return { documentId: source.documentId, revisionOrdinal: source.revisionOrdinal, revisionDigest: source.revisionDigest };
}

export async function validateRuntimeOmrReadiness(
  source: SongSourceDocument,
  options: { readonly includeAcknowledgedWarnings?: boolean } = {},
): Promise<RuntimeOmrValidationResult> {
  const diagnostics: ImportDiagnosticInput[] = [];
  const omrReview = source.importInfo?.omrReviewRecord;
  if (omrReview) {
    const completionErrors = validateOmrReviewCompletion(omrReview);
    if (completionErrors.length > 0) diagnostics.push({ code: "OMR_REVIEW_REQUIRED", severity: "blocking", messageKo: "해결되지 않은 OMR 검토 항목 또는 자동 수리가 있습니다.", details: { unresolvedCount: completionErrors.length } });
    const historyErrors = await validateOmrCorrectionHistory(source, omrReview);
    if (historyErrors.length > 0) diagnostics.push({ code: "OMR_REVIEW_REQUIRED", severity: "blocking", messageKo: "OMR 수정 이력과 Source revision/remap 연결이 일치하지 않습니다.", details: { historyErrorCount: historyErrors.length } });
  }
  const timeline: Array<{ readonly event: SongSourceDocument["sourceMeasures"][number]["leadEvents"][number]; readonly sourceMeasureId: string; readonly start: import("../fraction").Fraction; readonly end: import("../fraction").Fraction; readonly ordinal: number }> = [];
  let measureStart = fraction(0);
  let ordinal = 0;
  for (const measure of source.sourceMeasures) {
    for (const event of measure.leadEvents) {
      const start = addFractions(measureStart, event.onset);
      timeline.push({ event, sourceMeasureId: measure.id, start, end: addFractions(start, event.duration), ordinal });
      ordinal += 1;
    }
    measureStart = addFractions(measureStart, measure.duration);
  }
  timeline.sort((left, right) => compareFractions(left.start, right.start) || compareFractions(left.end, right.end) || left.ordinal - right.ordinal);
  const sameSpelledPitch = (left: Extract<(typeof timeline)[number]["event"], { readonly kind: "note" }>, right: Extract<(typeof timeline)[number]["event"], { readonly kind: "note" }>) => left.pitch.step === right.pitch.step && left.pitch.alter === right.pitch.alter && left.pitch.octave === right.pitch.octave;
  for (const [index, entry] of timeline.entries()) {
    if (entry.event.kind !== "note") continue;
    const previous = timeline[index - 1]; const next = timeline[index + 1];
    if ((entry.event.tieStop && (!previous || previous.event.kind !== "note" || !previous.event.tieStart || compareFractions(previous.end, entry.start) !== 0 || !sameSpelledPitch(previous.event, entry.event)))
      || (entry.event.tieStart && (!next || next.event.kind !== "note" || !next.event.tieStop || compareFractions(entry.end, next.start) !== 0 || !sameSpelledPitch(entry.event, next.event)))) {
      diagnostics.push({ code: "OMR_TIE_INVALID", severity: "blocking", messageKo: "타이의 연결 음높이 또는 인접 관계가 올바르지 않습니다.", details: { sourceMeasureId: entry.sourceMeasureId, eventId: entry.event.id } });
    }
  }
  for (const [measureIndex, measure] of source.sourceMeasures.entries()) {
    const expected = fraction(measure.time.numerator * 4, measure.time.denominator);
    if ((!measure.implicit && compareFractions(measure.duration, expected) !== 0)
      || (measure.implicit && (compareFractions(measure.duration, fraction(0)) <= 0 || compareFractions(measure.duration, expected) > 0))) {
      diagnostics.push({ code: "OMR_MEASURE_DURATION_INVALID", severity: "blocking", messageKo: "마디 길이가 박자표와 일치하지 않습니다.", details: { sourceMeasureId: measure.id, measureIndex } });
    }
    let cursor = fraction(0);
    for (const [eventIndex, event] of measure.leadEvents.entries()) {
      if (compareFractions(event.onset, cursor) < 0 || compareFractions(addFractions(event.onset, event.duration), measure.duration) > 0) {
        diagnostics.push({ code: "OMR_REVIEW_REQUIRED", severity: "blocking", messageKo: "성부 시간축이 겹치거나 마디 범위를 벗어납니다.", details: { sourceMeasureId: measure.id, eventIndex, issue: "voice-timeline" } });
      }
      cursor = addFractions(event.onset, event.duration);
      if (event.kind === "note") {
        const previousNote = [...measure.leadEvents.slice(0, eventIndex)].reverse().find((candidate) => candidate.kind === "note");
        if (previousNote?.kind === "note" && Math.abs(pitchMidiNumber(previousNote.pitch) - pitchMidiNumber(event.pitch)) > 24) {
          diagnostics.push({ code: "OMR_REVIEW_REQUIRED", severity: "warning", messageKo: "두 옥타브를 넘는 도약을 확인해 주세요.", details: { sourceMeasureId: measure.id, eventId: event.id, issue: "octave-jump" } });
        }
      }
    }
    for (const chord of measure.chordEvents) {
      if (chord.parseResult.status !== "ok" && chord.parseResult.status !== "no-chord") {
        diagnostics.push({ code: "OMR_CHORD_UNPARSEABLE", severity: "blocking", messageKo: "화음 기호를 해석할 수 없습니다.", details: { sourceMeasureId: measure.id, chordEventId: chord.id } });
      } else if (chord.confirmation !== "confirmed") {
        diagnostics.push({ code: "OMR_REVIEW_REQUIRED", severity: "warning", messageKo: "OMR 화음 기호를 확인해 주세요.", details: { sourceMeasureId: measure.id, chordEventId: chord.id, issue: "chord-confirmation" } });
      }
    }
  }
  const sourceIds = new Set(source.sourceMeasures.map((measure) => measure.id));
  if (source.performanceSequence.occurrences.some((occurrence) => !sourceIds.has(occurrence.sourceMeasureId))) {
    diagnostics.push({ code: "OMR_REVIEW_REQUIRED", severity: "blocking", messageKo: "연주 순서가 Source 마디를 올바르게 참조하지 않습니다.", details: { issue: "performance-order" } });
  }
  if (source.sourceMeasures.every((measure) => measure.leadEvents.every((event) => event.kind === "rest"))) {
    diagnostics.push({ code: "OMR_REVIEW_REQUIRED", severity: "blocking", messageKo: "선택된 주선율 성부가 없습니다.", details: { issue: "selected-melody-staff" } });
  }
  const materialized = await materializeImportDiagnostics(diagnostics);
  const acknowledged = options.includeAcknowledgedWarnings
    ? new Set<string>()
    : new Set((source.importInfo?.omrRuntimeWarningAcknowledgements ?? [])
      .filter((item) => revisionRefsEqual(item.sourceRevision, sourceRevision(source)))
      .map((item) => item.diagnosticId));
  const visible = materialized.filter((diagnostic) => diagnostic.severity !== "warning" || !acknowledged.has(diagnostic.id));
  const readiness: RuntimeOmrReadiness = visible.some((diagnostic) => diagnostic.severity === "blocking" || diagnostic.severity === "error")
    ? "blocked"
    : visible.length > 0 ? "review-required" : "validator-ready";
  return { readiness, diagnostics: visible };
}

export async function acknowledgeRuntimeOmrWarnings(
  source: SongSourceDocument,
  input: { readonly diagnosticIds?: readonly string[]; readonly acknowledgedAt: string },
): Promise<SongSourceDocument> {
  if (!source.importInfo || !Number.isFinite(Date.parse(input.acknowledgedAt))) throw new RangeError("OMR_WARNING_ACKNOWLEDGEMENT_INVALID");
  const raw = await validateRuntimeOmrReadiness(source, { includeAcknowledgedWarnings: true });
  const warnings = raw.diagnostics.filter((diagnostic) => diagnostic.severity === "warning");
  const requested = input.diagnosticIds ?? warnings.map((diagnostic) => diagnostic.id);
  const available = new Set(warnings.map((diagnostic) => diagnostic.id));
  if (requested.length === 0 || new Set(requested).size !== requested.length || requested.some((id) => !available.has(id))) {
    throw new RangeError("OMR_WARNING_ACKNOWLEDGEMENT_INVALID");
  }
  const revision = sourceRevision(source);
  const retained = (source.importInfo.omrRuntimeWarningAcknowledgements ?? [])
    .filter((item) => revisionRefsEqual(item.sourceRevision, revision) && !requested.includes(item.diagnosticId));
  const omrRuntimeWarningAcknowledgements = [
    ...retained,
    ...requested.map((diagnosticId) => ({ diagnosticId, sourceRevision: revision, acknowledgedAt: input.acknowledgedAt })),
  ].sort((left, right) => left.diagnosticId.localeCompare(right.diagnosticId));
  return { ...source, importInfo: { ...source.importInfo, omrRuntimeWarningAcknowledgements } };
}

export async function validateRuntimeOmrWarningAcknowledgements(source: SongSourceDocument): Promise<boolean> {
  const acknowledgements = source.importInfo?.omrRuntimeWarningAcknowledgements ?? [];
  if (new Set(acknowledgements.map((item) => item.diagnosticId)).size !== acknowledgements.length) return false;
  const revision = sourceRevision(source);
  if (acknowledgements.some((item) => !revisionRefsEqual(item.sourceRevision, revision))) return false;
  const raw = await validateRuntimeOmrReadiness(source, { includeAcknowledgedWarnings: true });
  const warningIds = new Set(raw.diagnostics.filter((diagnostic) => diagnostic.severity === "warning").map((diagnostic) => diagnostic.id));
  return acknowledgements.every((item) => warningIds.has(item.diagnosticId));
}
