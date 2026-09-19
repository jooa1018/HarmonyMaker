"use client";
import { useMemo, useState } from "react";
import type { CandidateRecord, LocalCandidateBundle } from "../../domain/omr/local-candidate";
import { localCandidateEvidence } from "../../domain/omr/local-candidate";
import type { WorkspaceIssue, WorkspaceState } from "../../import/workspace/model";
import styles from "./score-workspace.module.css";

interface Row { issue: WorkspaceIssue; record?: CandidateRecord; system?: number; targets: readonly string[]; }
/** Presentation grouping only: no status, severity, OCR agreement or grouping key approves a fact. */
function rowsFor(bundle: LocalCandidateBundle, issues: readonly WorkspaceIssue[]): Row[] {
  const evidence = localCandidateEvidence(bundle), links = JSON.parse(bundle.artifacts.links.text);
  const measures = links.measures as {measure: {id: string; systemIndex?: number}; [key: string]: unknown}[];
  return issues.filter(i => i.requiredAction === "compare").map(issue => {
    const candidate = /^candidate:(\d+)$/u.exec(issue.id);
    const record: CandidateRecord | undefined = candidate ? evidence.candidates[Number(candidate[1])]
      : issue.id.startsWith("link:") ? links.events[issue.id.slice(5)]
      : issue.id.startsWith("measure-link:") ? measures.find(m => m.measure.id === issue.id.slice(13)) : undefined;
    const association = record?.association as {measureIndex?: number; eventIds?: readonly string[]} | undefined;
    const targets = [...new Set([
      ...issue.targetIds, ...(typeof record?.eventId === "string" ? [record.eventId] : []), ...(association?.eventIds ?? []),
      ...(typeof association?.measureIndex === "number" ? [`p0m${association.measureIndex}`] : []),
    ])];
    const mid = issue.scope.kind === "measure" ? issue.scope.measureId : targets.map(t => /^(?:d0)?(p\d+m\d+)(?:n\d+)?$/u.exec(t)?.[1]).find(Boolean);
    const system = typeof record?.systemIndex === "number" ? record.systemIndex : measures.find(m => m.measure.id === mid)?.measure.systemIndex;
    return {issue, record, targets, ...(Number.isSafeInteger(system) ? {system} : {})};
  });
}

export function WorkspaceIssueReview({bundle,state,issues,revision,digest,onConfirm}: {
  bundle: LocalCandidateBundle; state: WorkspaceState; issues: readonly WorkspaceIssue[]; revision: number; digest: string;
  onConfirm: (ids: readonly string[], note: string, expected: {revision: number; digest: string}) => Promise<void>;
}) {
  const rows = useMemo(() => rowsFor(bundle,issues),[bundle,issues]);
  const groups = useMemo(() => [...new Set(rows.map(r => r.system ?? -1))].sort((a,b) => a-b),[rows]);
  const [group,setGroup] = useState(-2), [selected,setSelected] = useState<readonly string[]>([]), [note,setNote] = useState("");
  const active = groups.includes(group) ? group : groups[0];
  const visible = rows.filter(r => (r.system ?? -1) === active).slice(0,128);
  const ids = selected.filter(id => visible.some(r => r.issue.id === id));
  const geometry = useMemo(() => JSON.parse(bundle.artifacts.geometry.text),[bundle]);
  const bounds = active >= 0 ? geometry.systems?.[active]?.bounds as number[] | undefined : undefined;
  const box = bounds ? [0,Math.max(0,bounds[1]-65),bundle.image.width,Math.min(bundle.image.height,bounds[3]+85)] : [0,0,bundle.image.width,bundle.image.height];
  const links = useMemo(() => JSON.parse(bundle.artifacts.links.text),[bundle]);
  const mids = new Set((links.measures as {measure: {id: string; systemIndex: number}}[]).filter(m => active < 0 || m.measure.systemIndex === active).map(m => m.measure.id));
  const current = state.music?.parts.flatMap(p => p.measures.filter(m => mids.has(m.workspaceMeasureId!))) ?? [];
  if (!rows.length) return null;
  return <details className={styles.context} data-testid="evidence-batch-review">
    <summary>원본 구역별 미확정 대조 · {rows.length}개 기록</summary>
    <p>동일 구역의 기록을 함께 표시합니다. 서로 다른 기호는 각각의 대상으로 남고, 선택한 항목마다 기존 대조 명령을 기록합니다. 원시 상태·자동 복원·해시는 확인을 대신하지 않습니다.</p>
    <label>대조할 원본 구역<select aria-label="대조할 원본 구역" value={active} onChange={e=>{setGroup(Number(e.target.value));setSelected([]);setNote("");}}>{groups.map(g=><option key={g} value={g}>{g<0?"원본 위치 미확정 · 전체 문맥":`원본 시스템 ${g+1}`}</option>)}</select></label>
    <svg role="img" aria-label="묶음 대조 원본 구역" viewBox={`${box[0]} ${box[1]} ${box[2]-box[0]} ${box[3]-box[1]}`} style={{width:"100%",maxHeight:360}}><image href={`data:${bundle.image.mimeType};base64,${bundle.image.base64}`} width={bundle.image.width} height={bundle.image.height}/></svg>
    <details><summary>이 구역의 현재 음악 · 확인 revision {revision}</summary>{current.map(m=><div key={m.workspaceMeasureId}><strong>{m.number}마디 · {m.workspaceMeasureId}</strong><pre className={styles.wrap}>{JSON.stringify({time:m.time,duration:m.duration,chords:m.chords,events:m.leadEvents},null,2)}</pre></div>)}</details>
    <p>확인 범위: 각 기록의 문자·음절 부착·절·이어 부르기, 코드값·박 위치, 음표/쉼표·성부 연결, 기호·박자·구간 길이 중 아래에 표시된 해당 사실. 자동 후보에서 달라진 현재 값을 원본과 대조하세요.</p>
    {visible.map(row=><div key={row.issue.id} data-review-issue={row.issue.id}><label><input type="checkbox" aria-label={`묶음 선택 ${row.issue.id}`} checked={ids.includes(row.issue.id)} onChange={e=>setSelected(e.target.checked?[...ids,row.issue.id]:ids.filter(id=>id!==row.issue.id))}/>{row.issue.id} · {row.issue.messageKo}</label><p>대상 {row.targets.join(", ")||"연결 미확정 · 전체 문맥 직접 확인 필요"} · 근거 {row.issue.evidenceRef} · 검토 의존 범위 {row.issue.scope.kind === "document" ? "문서 전체 (음악 변경 시 재대조 필요)" : row.issue.scope.kind === "measure" ? row.issue.scope.measureId : "표시 정보"}</p><details><summary>이 대상의 원시 관측·좌표·연결 근거</summary><pre className={styles.wrap}>{JSON.stringify(row.record??row.issue,null,2)}</pre></details></div>)}
    <label><input aria-label="표시된 대상 모두 명시적으로 선택" type="checkbox" checked={visible.length>0&&ids.length===visible.length} onChange={e=>setSelected(e.target.checked?visible.map(r=>r.issue.id):[])}/>표시된 {visible.length}개 대상을 모두 선택 (승인 전 원본과 개별 사실 대조)</label>
    <label>묶음 원본 대조 결과<input aria-label="묶음 원본 대조 결과" value={note} maxLength={1200} onChange={e=>setNote(e.target.value)} placeholder="어떤 사실을 확인·교정했는지, 원본 위치와 남긴 판단"/></label>
    <p>선택 {ids.length}개 · 음악 수정 0개 · 기존 개별 대조 {ids.length}건. 미선택 항목은 차단을 유지합니다. 현재 음악 변경은 기존 의존 규칙에 따라 이 확인을 무효화합니다.</p>
    <button disabled={!ids.length||note.trim().length<8} onClick={()=>void onConfirm(ids,note,{revision,digest}).then(()=>{setSelected([]);setNote("");})}>선택한 원본 사실 대조 저장</button>
  </details>;
}
