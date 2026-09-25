"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { assessAutoDraft, type AutoDraftAssessment, type AutoDraftOptions } from "../../import/workspace/auto-draft";
import type { ScoreWorkspace } from "../../import/workspace/model";
import type { HarmonyPartPreset } from "../../domain/part-presets";
import { generateAutoDraftProject } from "../../product/auto-draft";
import { IndexedDbProjectStore } from "../../product/local-project-store";

/**
 * Minimal test surface for the automatic-draft backend (not the final UI).
 * Inputs: optional harmony part, plus answers only to questions the backend
 * returned. The verdict shown is recomputed by the backend on generation.
 */
export function AutoDraftPanel({ workspace, busy, run, setStatus }: {
  readonly workspace: ScoreWorkspace; readonly busy: boolean;
  readonly run: (action: (ensureCurrent: () => void) => Promise<void>) => Promise<void>;
  readonly setStatus: (text: string) => void;
}) {
  const router = useRouter();
  const [part, setPart] = useState<"" | HarmonyPartPreset>(""), [carry, setCarry] = useState(false), [rights, setRights] = useState(false);
  const [assessment, setAssessment] = useState<AutoDraftAssessment>(), [error, setError] = useState("");
  const [confirmedAt, setConfirmedAt] = useState<string>();
  const options: AutoDraftOptions = {
    ...(part ? { harmonyPart: part } : {}),
    ...(carry ? { decisions: { unreadPrintedChords: "carry-previous" as const } } : {}),
    ...(rights && confirmedAt ? { rights: { basis: "user-confirmed-rights" as const, allowedUses: ["generation" as const], confirmedAt, sourceReference: "자동 초안 첨부 시 사용자 권리 확인" } } : {}),
  };
  const key = JSON.stringify(options);
  useEffect(() => {
    let active = true;
    void assessAutoDraft(workspace, JSON.parse(key) as AutoDraftOptions).then(a => { if (active) { setAssessment(a); setError(""); } }, e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [workspace, key]);
  const needs = (code: string) => assessment?.findings.some(f => f.code === code && f.category === "question") ?? false;
  const questions = assessment?.findings.filter(f => f.category !== "warning") ?? [];
  const warnings = assessment?.findings.filter(f => f.category === "warning") ?? [];
  const byCode = warnings.reduce<Record<string, number>>((m, f) => { m[f.code] = (m[f.code] ?? 0) + 1; return m; }, {});
  const generate = () => run(async ensureCurrent => {
    const result = await generateAutoDraftProject(workspace, options);
    ensureCurrent();
    if (result.status !== "generated") { setAssessment(result.assessment); throw Error(result.status === "source-blocked" ? `Source 검증 불일치: ${result.diagnostics.map(d => d.code).join(", ")}` : `생성 전 필요한 판단이 남았습니다(${result.assessment.status}).`); }
    const projectId = `${workspace.id}:r${workspace.revision}:auto:${part || "default"}:${Date.now()}`;
    await new IndexedDbProjectStore().saveNew({ projectId, updatedAt: new Date().toISOString(), project: result.project });
    ensureCurrent();
    setStatus(`자동 초안 생성 · 화음 ${result.generation.status} · 사람 원본 대조 없음 · 저장 ${projectId}`);
    router.push(`/workspace?project=${encodeURIComponent(projectId)}`);
  });
  return <section className="panel" data-testid="auto-draft-panel">
    <h2>자동 초안으로 화음 생성 (최소 입력)</h2>
    <p>원본 대조 없이 자동 판독값과 제품 기본값으로 연습용 초안을 만듭니다. 결과는 “자동 초안”으로 저장되며 사람 검토 완료 Source가 아닙니다.</p>
    <label>생성 화음 <select aria-label="생성 화음 파트" value={part} disabled={busy} onChange={e => setPart(e.target.value as "" | HarmonyPartPreset)}>
      <option value="">자동(Lead 음역 기준)</option><option value="alto">알토</option><option value="tenor">테너</option></select></label>
    {needs("RIGHTS_CONFIRMATION_REQUIRED") || rights ? <p><label><input type="checkbox" aria-label="생성 권리 확인" checked={rights} disabled={busy}
      onChange={e => { setRights(e.target.checked); setConfirmedAt(e.target.checked ? new Date().toISOString() : undefined); }} /> 이 악보로 화음을 생성할 권리가 있음을 확인합니다.</label></p> : null}
    {needs("PRINTED_CHORD_UNREAD") || carry ? <p><label><input type="checkbox" aria-label="판독 못한 코드 직전 코드 유지" checked={carry} disabled={busy}
      onChange={e => setCarry(e.target.checked)} /> 판독하지 못한 인쇄 코드 구간은 직전 코드를 유지합니다(초안에 표시).</label></p> : null}
    {assessment ? <p data-testid="auto-draft-status">판정 {assessment.status} · 원시 기록 {assessment.rawIssueCount}개 중 질문 {questions.length} · 경고 {warnings.length} · 기존 확인 기록으로 해소 {assessment.issueCategories["reviewed-record"]}</p> : <p>판정 계산 중…</p>}
    {questions.length ? <details open><summary>생성 전에 필요한 판단 {questions.length}개</summary><ul>{questions.slice(0, 20).map(q => <li key={q.id}>{q.messageKo} — {q.effectKo}</li>)}</ul></details> : null}
    {warnings.length ? <details><summary>초안에 표시되는 경고 {warnings.length}개</summary><ul>{Object.entries(byCode).map(([code, n]) => <li key={code}>{code} × {n}</li>)}</ul></details> : null}
    {assessment ? <details><summary>요청 값의 출처</summary><ul>{assessment.provenance.map(p => <li key={p.field}>{p.field}: {p.origin} — {p.noteKo}</li>)}</ul></details> : null}
    {error ? <p className="status">{error}</p> : null}
    <button className="primary" disabled={busy || !assessment || !(assessment.status === "ready" || assessment.status === "ready-with-warnings")} onClick={() => void generate()}>화음 생성</button>
  </section>;
}
