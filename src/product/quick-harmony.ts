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
import { quickHarmonyNotice, quickHarmonyPartReason, type QuickHarmonyNotice } from "./quick-harmony-notices";
export type { QuickHarmonySummary } from "./quick-harmony-summary";
export type { QuickHarmonyNotice } from "./quick-harmony-notices";
import type { ProductGenerationOutcome } from "./workspace";

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
  /** Canonical ISO UTC time of the whole choice; reused for rights and Lead journal entries. */
  readonly confirmedAt: string;
  readonly answers?: { readonly lead?: string; readonly unreadPrintedChords?: "carry-previous" };
}

export interface QuickHarmonyPartResult {
  readonly part: HarmonyPartPreset;
  readonly status: "complete" | "partial" | "missing";
  /** Printed Source measure numbers, sorted and deduplicated (including repeats). */
  readonly missingMeasures: readonly number[];
  readonly reasonKo: string;
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
  if (assessment.provenance.some(p => p.origin === "policy-default" || p.origin === "source-inferred")) notes.push(
    quickHarmonyNotice({id:"automatic-values",code:"AUTOMATIC_VALUES",category:"warning"}, "악보 설정"));
  for (const part of state.music?.parts ?? []) for (const measure of part.measures) {
    for (const chord of measure.chords) if (chord.interpretation === "kind-text" && chord.source === "musicxml") {
      notes.push(quickHarmonyNotice({ id: `chord-kind-text:${chord.key}`, code: "CHORD_KIND_TEXT", category: "warning" },
        `${measure.number}번째 마디`, { chordName: chord.sourceText }));
    }
  }
  const request = assessment.request;
  const summary = state.music && request?.lead
    ? summarizeQuickHarmonyMelody(state.music, {...request, lead:request.lead}) : undefined;
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

export async function generateQuickHarmony(prep: QuickHarmonyPreparation, choice: QuickHarmonyChoice): Promise<QuickHarmonyResult> {
  if (!choice || choice.rightsConfirmed !== true) throw new QuickHarmonyInputError("QUICK_HARMONY_RIGHTS_REQUIRED", "화음을 만들 권리가 있는지 확인해 주세요.");
  const c = structuredClone(choice);
  const answers = c.answers;
  if (Object.keys(c).some(k => !["parts", "rightsConfirmed", "confirmedAt", "answers"].includes(k))
    || typeof c.confirmedAt !== "string" || !Number.isFinite(Date.parse(c.confirmedAt))
    || new Date(c.confirmedAt).toISOString() !== c.confirmedAt
    || (c.parts !== undefined && c.parts !== "auto" && (!Array.isArray(c.parts) || c.parts.length < 1 || c.parts.length > 2
      || !Array.from(c.parts).every(part => part === "alto" || part === "tenor") || new Set(c.parts).size !== c.parts.length))
    || (answers !== undefined && (!answers || typeof answers !== "object" || Array.isArray(answers)
      || Object.keys(answers).some(k => !["lead", "unreadPrintedChords"].includes(k))
      || (answers.lead !== undefined && typeof answers.lead !== "string")
      || (answers.unreadPrintedChords !== undefined && answers.unreadPrintedChords !== "carry-previous")))) {
    throw new QuickHarmonyInputError("QUICK_HARMONY_CHOICE_INVALID", "성부 선택과 권리 확인 시각을 다시 확인해 주세요.");
  }
  if (!prep.workspace) return { status: "unsupported", preparation: rejectedFile("QUICK_HARMONY_WORKSPACE_REQUIRED") };
  let workspace = await createImmutableWorkspace(prep.workspace);
  if (answers?.lead !== undefined) {
    const { state } = await readVerifiedWorkspace(workspace);
    if (!state.music?.leadCandidates.some(candidate => candidate.key === answers.lead && candidate.noteCount > 0)) {
      throw new QuickHarmonyInputError("QUICK_HARMONY_LEAD_INVALID", "악보에 있는 멜로디 성부를 선택해 주세요.");
    }
    if (state.request.lead !== answers.lead) workspace = await applyWorkspaceCommand(workspace, workspace,
      { kind: "lead", lead: answers.lead, rhythmVoices: [] },
      { id: `quick-lead:${workspace.revision}:${workspace.historyDigest}`, note: "사용자가 멜로디 성부를 선택함", actor: "user", at: c.confirmedAt });
  }
  const options = normalizeAutoDraftOptions({
    ...(Array.isArray(c.parts) ? { harmonyParts: c.parts } : {}),
    ...(answers?.unreadPrintedChords ? { decisions: { unreadPrintedChords: answers.unreadPrintedChords } } : {}),
    rights: { basis: "user-confirmed-rights", allowedUses: ["generation"], confirmedAt: c.confirmedAt },
  });
  // The supplied status, questions and details are intentionally never read.
  const result = await generateAutoDraftProject(workspace, options);
  const fresh = await preparation(workspace, result.assessment);
  if (result.status === "not-generated") return { status: fresh.status === "unsupported" ? "unsupported" : "needs-input", preparation: fresh };
  if (result.status === "source-blocked") return { status: "blocked", preparation: fresh, parts: (options.harmonyParts ?? []).map(part => ({ part, status: "missing", missingMeasures: [], reasonKo: "악보 판정에서 생성이 중단됐어요." })), diagnostics: result.diagnostics };
  const parts = partResults(result.project, result.generation);
  if (result.generation.status === "blocked") return { status: "blocked", preparation: fresh, project: result.project, parts, diagnostics: result.generation.diagnostics };
  if (options.harmonyParts && parts.every(p => p.status === "missing")) return {
    status: "blocked", preparation: fresh, project: result.project, parts, diagnostics: result.generation.execution.generation.result.diagnostics,
  };
  const status = options.harmonyParts && parts.some(p => p.status !== "complete") ? "partial" : result.generation.status;
  return { status, preparation: fresh, project: result.project, parts, generation: result.generation };
}
