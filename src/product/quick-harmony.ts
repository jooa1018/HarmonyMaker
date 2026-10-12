import { RecoveryXmlError } from "../import/review/recovery";
import type { ImportDiagnosticInput } from "../import/musicxml/diagnostics";
import { quickHarmonyParts } from "../domain/quick-harmony-policy";
import { projectPartStatus } from "./project-part-status";
import { APPLICATION_ALGORITHM_VERSION_REGISTRY } from "../app/algorithm-version-registry";
import type { Diagnostic } from "../domain/diagnostics";
import type { HarmonyPartPreset } from "../domain/part-presets";
import type { HarmonyProject } from "../domain/project";
import { DEFAULT_IMPORT_SECURITY_LIMITS } from "../import/musicxml/types";
import { assessAutoDraft, normalizeAutoDraftOptions, type AutoDraftAssessment, type AutoDraftFinding } from "../import/workspace/auto-draft";
import { originFromMusicXml } from "../import/workspace/input";
import { applyWorkspaceCommand, createImmutableWorkspace, createScoreWorkspace, readVerifiedWorkspace } from "../import/workspace/journal";
import type { ScoreWorkspace } from "../import/workspace/model";
import { generateAutoDraftProject } from "./auto-draft";
import { summarizeQuickHarmonyMelody, type QuickHarmonySummary } from "./quick-harmony-summary";
import { quickHarmonyNotice, quickHarmonyPartReason, quickHarmonyBlockedNotices, type QuickHarmonyNotice } from "./quick-harmony-notices";
export type { QuickHarmonySummary } from "./quick-harmony-summary";
export type { QuickHarmonyNotice } from "./quick-harmony-notices";
import type { ProductGenerationOutcome } from "./workspace";
import { quickPickupChord } from "./quick-harmony-pickup";
import { fraction } from "../domain/fraction";

/** Same inclusive integer range as the existing import/workspace tempo editor. */
export const QUICK_HARMONY_TEMPO_MIN = 20;
export const QUICK_HARMONY_TEMPO_MAX = 300;

export interface QuickHarmonyPreparation {
  readonly summary?: QuickHarmonySummary;
  readonly status: "ready" | "needs-input" | "unsupported";
  /** Absent only when the file cannot be imported safely. */
  readonly workspace?: ScoreWorkspace;
  readonly questions: readonly QuickHarmonyNotice[];
  readonly reasons: readonly QuickHarmonyNotice[];
  /** Collapsed 참고 by default. */
  readonly notes: readonly QuickHarmonyNotice[];
  /** Only for 자세히; never an input authority for generation. */
  readonly details: { readonly assessment?: AutoDraftAssessment; readonly importError?: string; readonly importDiagnostics?: readonly ImportDiagnosticInput[] };
}

export interface QuickHarmonyChoice {
  readonly parts?: "auto" | readonly [HarmonyPartPreset] | readonly ["alto", "tenor"] | readonly ["tenor", "alto"];
  readonly rightsConfirmed: true;
  /** Canonical ISO UTC time of the whole choice; reused for rights, Lead and tempo journal entries. */
  readonly confirmedAt: string;
  /** BPM in the currently effective beat unit (including its dot). */
  readonly tempo?: { readonly bpm: number };
  readonly answers?: { readonly lead?: string; readonly unreadPrintedChords?: "carry-previous"; readonly pickupChord?: "use-following-first-chord" };
}

export interface QuickHarmonyPartResult {
  readonly part: HarmonyPartPreset;
  readonly status: "complete" | "partial" | "missing";
  /** Printed Source measure numbers, sorted and deduplicated (including repeats). */
  readonly missingMeasures: readonly number[];
  readonly reasonKo: string;
  readonly actionKo?: string;
}

export type QuickHarmonyResult =
  | { readonly status: "needs-input" | "unsupported"; readonly preparation: QuickHarmonyPreparation }
  | { readonly status: "blocked"; readonly preparation: QuickHarmonyPreparation; readonly project?: HarmonyProject; readonly parts: readonly QuickHarmonyPartResult[]; readonly diagnostics: readonly Diagnostic[] }
  | { readonly status: "complete" | "partial"; readonly preparation: QuickHarmonyPreparation; readonly project: HarmonyProject; readonly parts: readonly QuickHarmonyPartResult[]; readonly generation: Exclude<ProductGenerationOutcome, { status: "blocked" }> };

export class QuickHarmonyInputError extends RangeError {
  constructor(readonly code: "QUICK_HARMONY_RIGHTS_REQUIRED" | "QUICK_HARMONY_CHOICE_INVALID" | "QUICK_HARMONY_LEAD_INVALID", messageKo: string) {
    super(messageKo);
    this.name = "QuickHarmonyInputError";
  }
}

async function preparation(workspace: ScoreWorkspace, assessment: AutoDraftAssessment): Promise<QuickHarmonyPreparation> {
  const { state } = await readVerifiedWorkspace(workspace);
  const measures = new Map(state.music?.parts.flatMap(part => part.measures.map(measure => [measure.workspaceMeasureId, measure.number] as const)));
  const describe = (finding: AutoDraftFinding): QuickHarmonyNotice => {
    const scope = finding.scope;
    const number = scope?.kind === "measure" ? measures.get(scope.measureId) : undefined;
    const locationKo = number !== undefined ? `${number}번째 마디` : scope?.kind === "metadata" ? "악보 설정"
      : scope?.kind === "measure" ? "위치를 확인할 수 없는 마디" : "악보 전체";
    const result = quickHarmonyNotice(finding, locationKo);
    if (finding.code === "LEAD_SELECTION_REQUIRED") return { ...result,
      choices: (state.music?.leadCandidates ?? []).filter(c => c.noteCount > 0).map(c => ({
        value: c.key, labelKo: `${c.displayPartName} · 보표 ${c.staffNumber} · 성부 ${c.voiceKey} · 음표 ${c.noteCount}개`,
      })),
    };
    return result;
  };
  // Preparation describes musical readiness. No synthetic rights are supplied
  // to the engine; the raw missing-rights finding remains in details.
  const findings = assessment.findings.filter(f => f.code !== "RIGHTS_CONFIRMATION_REQUIRED");
  const questions = findings.filter(f => f.category === "question").map(describe);
  const reasons = findings.filter(f => f.category === "unsupported").map(describe);
  const notes = findings.filter(f => f.category === "warning").map(describe);
  const pickup = quickPickupChord(state, assessment, workspace.algorithmVersions.performanceExpanderVersion);
  if (pickup.kind === "question") questions.push(pickup.notice);
  if (pickup.kind === "unavailable") reasons.push(pickup.notice);
  if (assessment.provenance.some(p => p.field !== "tempo" && (p.origin === "policy-default" || p.origin === "source-inferred"))) notes.push(
    quickHarmonyNotice({id:"automatic-values",code:"AUTOMATIC_VALUES",category:"warning"}, "악보 설정"));
  for (const part of state.music?.parts ?? []) for (const measure of part.measures) {
    for (const chord of measure.chords) if (chord.interpretation === "kind-text" && chord.source === "musicxml") {
      notes.push(quickHarmonyNotice({ id: `chord-kind-text:${chord.key}`, code: "CHORD_KIND_TEXT", category: "warning" },
        `${measure.number}번째 마디`, { chordName: chord.sourceText }));
    }
  }
  const request = assessment.request;
  const summary = state.music && request?.lead
    ? summarizeQuickHarmonyMelody(state.music, {...request, lead:request.lead}, assessment.provenance.find(p => p.field === "tempo")?.origin === "policy-default" ? "auto" : "score") : undefined;
  return { status: reasons.length ? "unsupported" : questions.length ? "needs-input" : "ready", workspace, questions, reasons, notes,
    ...(summary ? {summary} : {}), details: { assessment } };
}

function rejectedFile(importError: string, importDiagnostics?: readonly ImportDiagnosticInput[]): QuickHarmonyPreparation {
  return { status: "unsupported", questions: [], notes: [], reasons: [
    quickHarmonyNotice({id:"file",code:"FILE_UNREADABLE",category:"unsupported"}, "파일")
  ], details: { importError, ...(importDiagnostics ? { importDiagnostics } : {}) } };
}

/** Browser-local import; does not upload, persist, or confirm rights. */
export async function prepareQuickHarmony(file: { readonly bytes: Uint8Array; readonly fileName: string }): Promise<QuickHarmonyPreparation> {
  if (!file || !(file.bytes instanceof Uint8Array) || typeof file.fileName !== "string"
    || !/\.(?:musicxml|xml|mxl)$/iu.test(file.fileName) || file.fileName.length > 512) return rejectedFile("QUICK_HARMONY_FILE_INVALID");
  const archive = file.bytes[0] === 0x50 && file.bytes[1] === 0x4b;
  if (!file.bytes.length || file.bytes.length > (archive ? DEFAULT_IMPORT_SECURITY_LIMITS.maxArchiveBytes : DEFAULT_IMPORT_SECURITY_LIMITS.maxXmlBytes)) return rejectedFile("QUICK_HARMONY_FILE_SIZE", [{ code: "IMPORT_CORRUPT_XML", messageKo: "파일 크기가 허용 범위를 벗어났습니다.", details: { reason: !file.bytes.length ? "empty" : archive ? "archive-size-limit" : "xml-size-limit" } }]);
  const bytes = file.bytes.slice(), fileName = file.fileName;
  let workspace: ScoreWorkspace;
  try {
    const origin = await originFromMusicXml(bytes, fileName);
    // Content-derived identity keeps repeated import deterministic. Saving a new
    // project still uses the library's independent identity and saveNew API.
    workspace = await createScoreWorkspace(origin, APPLICATION_ALGORITHM_VERSION_REGISTRY, `quick:${origin.xmlDigest}`);
  } catch (error) {
    if (!(error instanceof RangeError || error instanceof TypeError)) throw error;
    return rejectedFile(error.message, error instanceof RecoveryXmlError ? error.diagnostics : undefined);
  }
  return prepareQuickHarmonyWorkspace(workspace);
}

/** Reassess an existing or explicitly corrected workspace without attestations. */
export async function prepareQuickHarmonyWorkspace(workspace: ScoreWorkspace): Promise<QuickHarmonyPreparation> {
  const owned = await createImmutableWorkspace(workspace);
  return preparation(owned, await assessAutoDraft(owned));
}

function partResults(project: HarmonyProject, generation: ProductGenerationOutcome): readonly QuickHarmonyPartResult[] {
  const requested = quickHarmonyParts(project.source) ?? [];
  const document = generation.status === "blocked" ? undefined : generation.execution.renderDocument;
  return requested.map((part, index) => {
    const plan = project.trackPlans.find(t => t.canonicalOrdinal === index + 1);
    const {status,missingMeasures} = projectPartStatus(project,document,plan?.id);
    return { part, status, missingMeasures, reasonKo: quickHarmonyPartReason(part,status,missingMeasures) };
  });
}

function blockedGuidance(preparation: QuickHarmonyPreparation, parts: readonly QuickHarmonyPartResult[], diagnostics: readonly Diagnostic[]) {
  const notices = quickHarmonyBlockedNotices(diagnostics);
  return { preparation: { ...preparation, reasons: [...preparation.reasons, ...notices] },
    parts: parts.map(part => ({ ...part, ...(notices[0] ? {
      reasonKo: `${part.part === "alto" ? "알토" : "테너"}: ${notices[0].messageKo}`, actionKo: notices[0].actionKo,
    } : {}) })) };
}

function validateQuickHarmonyFields(c: Omit<QuickHarmonyChoice, "rightsConfirmed">): void {
  const answers = c.answers;
  if (Object.keys(c).some(k => !["parts", "rightsConfirmed", "confirmedAt", "answers", "tempo"].includes(k))
    || typeof c.confirmedAt !== "string" || !Number.isFinite(Date.parse(c.confirmedAt))
    || new Date(c.confirmedAt).toISOString() !== c.confirmedAt
    || (c.tempo !== undefined && (!c.tempo || typeof c.tempo !== "object" || Array.isArray(c.tempo)
      || Object.keys(c.tempo).some(k => k !== "bpm") || !Number.isSafeInteger(c.tempo.bpm)
      || c.tempo.bpm < QUICK_HARMONY_TEMPO_MIN || c.tempo.bpm > QUICK_HARMONY_TEMPO_MAX))
    || (c.parts !== undefined && c.parts !== "auto" && (!Array.isArray(c.parts) || c.parts.length < 1 || c.parts.length > 2
      || !Array.from(c.parts).every(part => part === "alto" || part === "tenor") || new Set(c.parts).size !== c.parts.length))
    || (answers !== undefined && (!answers || typeof answers !== "object" || Array.isArray(answers)
      || Object.keys(answers).some(k => !["lead", "unreadPrintedChords", "pickupChord"].includes(k))
      || (answers.lead !== undefined && typeof answers.lead !== "string")
      || (answers.unreadPrintedChords !== undefined && answers.unreadPrintedChords !== "carry-previous")
      || (answers.pickupChord !== undefined && answers.pickupChord !== "use-following-first-chord")))) {
    throw new QuickHarmonyInputError("QUICK_HARMONY_CHOICE_INVALID", "성부 선택, 빠르기와 권리 확인 시각을 다시 확인해 주세요.");
  }
}

export function validateQuickHarmonyChoice(choice: QuickHarmonyChoice): QuickHarmonyChoice {
  if (!choice || choice.rightsConfirmed !== true) throw new QuickHarmonyInputError("QUICK_HARMONY_RIGHTS_REQUIRED", "화음을 만들 권리가 있는지 확인해 주세요.");
  const c = structuredClone(choice);
  validateQuickHarmonyFields(c);
  return c;
}

async function choiceWorkspace(source: ScoreWorkspace, c: QuickHarmonyAnswer): Promise<ScoreWorkspace> {
  const answers = c.answers;
  let workspace = await createImmutableWorkspace(source);
  if (answers?.lead !== undefined) {
    const { state } = await readVerifiedWorkspace(workspace);
    if (!state.music?.leadCandidates.some(candidate => candidate.key === answers.lead && candidate.noteCount > 0)) {
      throw new QuickHarmonyInputError("QUICK_HARMONY_LEAD_INVALID", "악보에 있는 멜로디 성부를 선택해 주세요.");
    }
    if (state.request.lead !== answers.lead) workspace = await applyWorkspaceCommand(workspace, workspace,
      { kind: "lead", lead: answers.lead, rhythmVoices: [] },
      { id: `quick-lead:${workspace.revision}:${workspace.historyDigest}`, note: "사용자가 멜로디 성부를 선택함", actor: "user", at: c.confirmedAt });
  }
  if (c.tempo !== undefined) {
    const effective = (await assessAutoDraft(workspace)).request?.tempo;
    if (!effective) throw new QuickHarmonyInputError("QUICK_HARMONY_CHOICE_INVALID", "악보의 박자와 빠르기를 먼저 확인해 주세요.");
    workspace = await applyWorkspaceCommand(workspace, workspace, { kind: "tempo", tempo: { ...effective, bpm: c.tempo.bpm } },
      { id: `quick-tempo:${workspace.revision}:${workspace.historyDigest}`, note: "사용자가 빠르기를 선택함", actor: "user", at: c.confirmedAt });
  }
  if (answers?.pickupChord !== undefined) {
    const { state } = await readVerifiedWorkspace(workspace);
    const assessment = await assessAutoDraft(workspace);
    const pickup = quickPickupChord(state, assessment, workspace.algorithmVersions.performanceExpanderVersion);
    if (pickup.kind === "question") {
      workspace = await applyWorkspaceCommand(workspace, workspace,
        { kind: "chord", measureId: pickup.measureId, text: pickup.chord, onset: fraction(0) },
        { id: `quick-pickup-chord:${workspace.revision}:${workspace.historyDigest}`, note: "사용자가 다음 마디 첫 코드를 못갖춘마디 시작에도 사용하기로 확인함", actor: "user", at: c.confirmedAt });
      if (state.request.initialPickup) workspace = await applyWorkspaceCommand(workspace, workspace,
        { kind: "pickup-policy", value: "none" }, { id: `quick-pickup-explicit:${workspace.revision}:${workspace.historyDigest}`, note: "명시 코드를 사용하므로 선행 정책 해제", actor: "user", at: c.confirmedAt });
    } else {
      // A direct caller may generate from the answer preview. Its verified journal
      // already holds this edit; do not insert the chord twice.
      const lead = state.music?.leadCandidates.find(v => v.key === assessment.request?.lead);
      const first = state.music?.parts.find(p => p.partOrdinal === lead?.partOrdinal)?.measures[0];
      const recorded = workspace.operations.some(o => {
        const command = o.command;
        return o.id.startsWith("quick-pickup-chord:") && o.actor === "user"
          && command.kind === "chord" && command.measureId === first?.workspaceMeasureId
          && first?.chords.some(ch => ch.key === `inserted:${o.id}` && ch.onset.n === 0 && ch.sourceText === command.text);
      });
      if (!recorded) throw new QuickHarmonyInputError("QUICK_HARMONY_CHOICE_INVALID", "확인할 못갖춘마디 코드가 없어요. 악보를 다시 판정해 주세요.");
    }
  }
  return workspace;
}

export type QuickHarmonyAnswer = Pick<QuickHarmonyChoice, "answers" | "tempo" | "confirmedAt">;

/** Preview answers only. No rights attestation or project is created here. */
export async function answerQuickHarmony(prep: QuickHarmonyPreparation, answer: QuickHarmonyAnswer): Promise<QuickHarmonyPreparation> {
  if (!answer || typeof answer !== "object" || Array.isArray(answer)
    || Object.keys(answer).some(key => !["answers", "tempo", "confirmedAt"].includes(key)))
    throw new QuickHarmonyInputError("QUICK_HARMONY_CHOICE_INVALID", "선택 내용을 다시 확인해 주세요.");
  const c = structuredClone(answer);
  validateQuickHarmonyFields(c);
  if (!prep.workspace) return rejectedFile("QUICK_HARMONY_WORKSPACE_REQUIRED");
  const workspace = await choiceWorkspace(prep.workspace, c);
  return preparation(workspace, await assessAutoDraft(workspace, {
    ...(c.answers?.unreadPrintedChords ? { decisions: { unreadPrintedChords: c.answers.unreadPrintedChords } } : {}),
  }));
}

export async function generateQuickHarmony(prep: QuickHarmonyPreparation, choice: QuickHarmonyChoice): Promise<QuickHarmonyResult> {
  const c = validateQuickHarmonyChoice(choice), answers = c.answers;
  if (!prep.workspace) return { status: "unsupported", preparation: rejectedFile("QUICK_HARMONY_WORKSPACE_REQUIRED") };
  const workspace = await choiceWorkspace(prep.workspace, c);
  const options = normalizeAutoDraftOptions({
    ...(Array.isArray(c.parts) ? { harmonyParts: c.parts } : {}),
    ...(answers?.unreadPrintedChords ? { decisions: { unreadPrintedChords: answers.unreadPrintedChords } } : {}),
    rights: { basis: "user-confirmed-rights", allowedUses: ["generation"], confirmedAt: c.confirmedAt },
  });
  const checked = await preparation(workspace, await assessAutoDraft(workspace, options));
  if (checked.questions.some(q => q.id === "pickup-chord") || checked.reasons.some(r => r.id === "pickup-chord-unavailable"))
    return { status: checked.status === "unsupported" ? "unsupported" : "needs-input", preparation: checked };
  // The supplied status, questions and details are intentionally never read.
  const result = await generateAutoDraftProject(workspace, options);
  const fresh = await preparation(workspace, result.assessment);
  if (result.status === "not-generated") return { status: fresh.status === "unsupported" ? "unsupported" : "needs-input", preparation: fresh };
  if (result.status === "source-blocked") {
    return { status: "blocked", ...blockedGuidance(fresh, (options.harmonyParts ?? []).map(part => ({ part, status: "missing", missingMeasures: [],
      reasonKo: quickHarmonyPartReason(part, "missing", []) })), result.diagnostics), diagnostics: result.diagnostics };
  }
  const parts = partResults(result.project, result.generation);
  if (result.generation.status === "blocked") return { status: "blocked", ...blockedGuidance(fresh, parts, result.generation.diagnostics), project: result.project, diagnostics: result.generation.diagnostics };
  if (options.harmonyParts && parts.every(p => p.status === "missing")) return {
    status: "blocked", ...blockedGuidance(fresh, parts, result.generation.execution.generation.result.diagnostics), project: result.project, diagnostics: result.generation.execution.generation.result.diagnostics,
  };
  const status = options.harmonyParts && parts.some(p => p.status !== "complete") ? "partial" : result.generation.status;
  return { status, preparation: fresh, project: result.project, parts, generation: result.generation };
}
