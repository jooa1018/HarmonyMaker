"use client";
import Link from "next/link";
import { useEffect,useState } from "react";
import type { WorkspaceProjectionMetadata } from "../../domain/source/model";
import { ScoreWorkspaceStore } from "../../import/workspace/store";

export function ProjectionNotice({metadata}:{metadata:WorkspaceProjectionMetadata}) {
  const [status,setStatus]=useState("대응하는 저장 초안을 확인하는 중…");
  useEffect(()=>{let active=true;const check=()=>void new ScoreWorkspaceStore().load(metadata.workspaceId).then(row=>{if(active)setStatus(!row?"원본 작업 공간이 이 브라우저에 없습니다. 프로젝트에 포함된 snapshot입니다.":row.workspace.revision===metadata.workspaceRevision&&row.workspace.digest===metadata.workspaceDigest?"현재 저장된 작업 공간 revision과 일치합니다.":"이전 입력의 결과입니다. 작업 공간이 수정되어 현재 요청에는 stale입니다.");}).catch(()=>{if(active)setStatus("최신 초안을 읽지 못했습니다. 현재 결과로 확인하지 않았습니다.");});check();window.addEventListener("focus",check);return()=>{active=false;window.removeEventListener("focus",check);};},[metadata.workspaceId,metadata.workspaceRevision,metadata.workspaceDigest]);
  return <section className="panel" data-testid="workspace-projection"><h2>편곡 입력의 출처</h2><p>작업 공간 revision {metadata.workspaceRevision} · {metadata.originKind} · 전곡 · 선택 {metadata.selectedVoices.join(", ")} · 선택 밖 성부 {metadata.excludedVoices.join(", ")||"없음"}</p><p>{status}</p>{metadata.autoDraft?<p data-testid="auto-draft-source-status">자동 초안 · 사람의 원본 대조 없음 · 정책 {metadata.autoDraft.policyVersion} · 판정 {metadata.autoDraft.status} · 원시 기록 {metadata.autoDraft.rawIssueCount}개(경고·정책은 요청 출처에 기록)</p>:null}<p>이 프로젝트는 확정 당시 입력 snapshot을 사용합니다. 원본 교정은 <Link href={`/score-workspace?id=${encodeURIComponent(metadata.workspaceId)}`}>악보 작업 공간</Link>에서 재개하세요. 새 교정 결과는 별도 프로젝트로 저장됩니다.</p></section>;
}
