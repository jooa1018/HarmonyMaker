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
import type { ProductGenerationOutcome } from "./workspace";

export interface QuickHarmonyNotice {
  readonly id: string;
  readonly messageKo: string;
  readonly actionKo: string;
  readonly choices: readonly { readonly value: string; readonly labelKo: string }[];
}

export interface QuickHarmonyPreparation {
  readonly status: "ready" | "needs-input" | "unsupported";
  /** Absent only when the file cannot be imported safely. */
  readonly workspace?: ScoreWorkspace;
  readonly questions: readonly QuickHarmonyNotice[];
  readonly reasons: readonly QuickHarmonyNotice[];
  /** Collapsed 참고 by default. */
  readonly notes: readonly QuickHarmonyNotice[];
  /** Only for 자세히; never an input authority for generation. */
  readonly details: { readonly assessment?: AutoDraftAssessment; readonly importError?: string };
}

/** API draft: H1 1-2 will extend the tuple to two distinct parts. */
export interface QuickHarmonyChoice {
  readonly parts?: "auto" | readonly [HarmonyPartPreset];
  readonly rightsConfirmed: true;
  /** Capture once when the user checks the box; reuse on retry. */
  readonly confirmedAt: string;
  readonly answers?: { readonly lead?: string; readonly unreadPrintedChords?: "carry-previous" };
}

export type QuickHarmonyResult =
  | { readonly status: "needs-input" | "unsupported"; readonly preparation: QuickHarmonyPreparation }
  | { readonly status: "blocked"; readonly preparation: QuickHarmonyPreparation; readonly project?: HarmonyProject; readonly diagnostics: readonly Diagnostic[] }
  | { readonly status: "complete" | "partial"; readonly preparation: QuickHarmonyPreparation; readonly project: HarmonyProject; readonly generation: Exclude<ProductGenerationOutcome, { status: "blocked" }> };

export class QuickHarmonyInputError extends RangeError {
  constructor(readonly code: "QUICK_HARMONY_RIGHTS_REQUIRED" | "QUICK_HARMONY_CHOICE_INVALID" | "QUICK_HARMONY_LEAD_INVALID", messageKo: string) {
    super(messageKo);
    this.name = "QuickHarmonyInputError";
  }
}

function notice(f: AutoDraftFinding): QuickHarmonyNotice {
  if (f.code === "UNSUPPORTED_MODULATION") return {
    id: f.id, messageKo: "곡 중간에 조가 바뀌는 악보는 아직 지원하지 않아요.",
    actionKo: "조가 바뀌기 전까지만 잘라서 올려 보세요.", choices: [],
  };
  if (f.code === "UNSUPPORTED_METER") return {
    id: f.id, messageKo: "이 악보에 아직 지원하지 않는 박자가 있어요.",
    actionKo: "현재는 2/4·4/4·6/8 악보를 사용할 수 있어요.", choices: [],
  };
  return {
    id: f.id, messageKo: f.messageKo, actionKo: f.effectKo,
    choices: f.answers?.map(a => ({ value: a.option, labelKo: a.meaningKo }))
      ?? (f.category === "question" ? [{ value: "edit-in-workspace", labelKo: "악보를 확인하고 고치기" }] : []),
  };
}

async function preparation(workspace: ScoreWorkspace, assessment: AutoDraftAssessment): Promise<QuickHarmonyPreparation> {
  const { state } = await readVerifiedWorkspace(workspace);
  const describe = (finding: AutoDraftFinding): QuickHarmonyNotice => {
    const result = notice(finding);
    if (finding.code === "LEAD_SELECTION_REQUIRED") return { ...result,
      choices: (state.music?.leadCandidates ?? []).filter(c => c.noteCount > 0).map(c => ({
        value: c.key, labelKo: `${c.displayPartName} · 보표 ${c.staffNumber} · 성부 ${c.voiceKey} · 음표 ${c.noteCount}개`,
      })),
    };
    const scope = finding.scope;
    const measure = scope?.kind === "measure" ? state.music?.parts.flatMap(p => p.measures).find(m => m.workspaceMeasureId === scope.measureId) : undefined;
    return measure && !result.messageKo.includes(`${measure.number}마디`)
      ? { ...result, messageKo: `${measure.number}마디: ${result.messageKo}` } : result;
  };
  // Preparation describes musical readiness. No synthetic rights are supplied
  // to the engine; the raw missing-rights finding remains in details.
  const findings = assessment.findings.filter(f => f.code !== "RIGHTS_CONFIRMATION_REQUIRED");
  const questions = findings.filter(f => f.category === "question").map(describe);
  const reasons = findings.filter(f => f.category === "unsupported").map(describe);
  const notes = findings.filter(f => f.category === "warning").map(describe);
  if (assessment.provenance.some(p => p.origin === "policy-default" || p.origin === "source-inferred")) notes.push({
    id: "automatic-values", messageKo: "악보에서 비어 있는 설정은 연습용으로 자동 선택했어요.",
    actionKo: "자세히에서 어떤 값을 사용했는지 확인할 수 있어요.", choices: [],
  });
  return { status: reasons.length ? "unsupported" : questions.length ? "needs-input" : "ready", workspace, questions, reasons, notes, details: { assessment } };
}

function rejectedFile(importError: string): QuickHarmonyPreparation {
  return { status: "unsupported", questions: [], notes: [], reasons: [{
    id: "file", messageKo: "이 파일에서 악보를 안전하게 읽을 수 없어요.",
    actionKo: "MuseScore에서 악보를 확인한 뒤 MusicXML(.musicxml, .xml, .mxl)로 다시 내보내 주세요.", choices: [],
  }], details: { importError } };
}

/** Browser-local import; does not upload, persist, or confirm rights. */
export async function prepareQuickHarmony(file: { readonly bytes: Uint8Array; readonly fileName: string }): Promise<QuickHarmonyPreparation> {
  if (!file || !(file.bytes instanceof Uint8Array) || typeof file.fileName !== "string"
    || !/\.(?:musicxml|xml|mxl)$/iu.test(file.fileName) || file.fileName.length > 512) return rejectedFile("QUICK_HARMONY_FILE_INVALID");
  const archive = file.bytes[0] === 0x50 && file.bytes[1] === 0x4b;
  if (!file.bytes.length || file.bytes.length > (archive ? DEFAULT_IMPORT_SECURITY_LIMITS.maxArchiveBytes : DEFAULT_IMPORT_SECURITY_LIMITS.maxXmlBytes)) return rejectedFile("QUICK_HARMONY_FILE_SIZE");
  const bytes = file.bytes.slice(), fileName = file.fileName;
  let workspace: ScoreWorkspace;
  try {
    const origin = await originFromMusicXml(bytes, fileName);
    // Content-derived identity keeps repeated import deterministic. Saving a new
    // project still uses the library's independent identity and saveNew API.
    workspace = await createScoreWorkspace(origin, APPLICATION_ALGORITHM_VERSION_REGISTRY, `quick:${origin.xmlDigest}`);
  } catch (error) {
    if (!(error instanceof RangeError || error instanceof TypeError)) throw error;
    return rejectedFile(error.message);
  }
  return prepareQuickHarmonyWorkspace(workspace);
}

/** Reassess an existing or explicitly corrected workspace without attestations. */
export async function prepareQuickHarmonyWorkspace(workspace: ScoreWorkspace): Promise<QuickHarmonyPreparation> {
  const owned = await createImmutableWorkspace(workspace);
  return preparation(owned, await assessAutoDraft(owned));
}

export async function generateQuickHarmony(prep: QuickHarmonyPreparation, choice: QuickHarmonyChoice): Promise<QuickHarmonyResult> {
  if (!choice || choice.rightsConfirmed !== true) throw new QuickHarmonyInputError("QUICK_HARMONY_RIGHTS_REQUIRED", "화음을 만들 권리가 있는지 확인해 주세요.");
  const c = structuredClone(choice);
  const answers = c.answers;
  if (Object.keys(c).some(k => !["parts", "rightsConfirmed", "confirmedAt", "answers"].includes(k))
    || typeof c.confirmedAt !== "string" || !Number.isFinite(Date.parse(c.confirmedAt))
    || (c.parts !== undefined && c.parts !== "auto" && (!Array.isArray(c.parts) || c.parts.length !== 1 || !["alto", "tenor"].includes(c.parts[0])))
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
    ...(Array.isArray(c.parts) ? { harmonyPart: c.parts[0] } : {}),
    ...(answers?.unreadPrintedChords ? { decisions: { unreadPrintedChords: answers.unreadPrintedChords } } : {}),
    rights: { basis: "user-confirmed-rights", allowedUses: ["generation"], confirmedAt: c.confirmedAt },
  });
  // The supplied status, questions and details are intentionally never read.
  const result = await generateAutoDraftProject(workspace, options);
  const fresh = await preparation(workspace, result.assessment);
  if (result.status === "not-generated") return { status: fresh.status === "unsupported" ? "unsupported" : "needs-input", preparation: fresh };
  if (result.status === "source-blocked") return { status: "blocked", preparation: fresh, diagnostics: result.diagnostics };
  if (result.generation.status === "blocked") return { status: "blocked", preparation: fresh, project: result.project, diagnostics: result.generation.diagnostics };
  return { status: result.generation.status, preparation: fresh, project: result.project, generation: result.generation };
}
