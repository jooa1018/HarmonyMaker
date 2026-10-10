"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { IndexedDbProjectStore, type LocalProjectRecord } from "../../product/local-project-store";
import { describeHarmonyProject, projectPracticeView, type ProjectPracticeView } from "../../product/project-view";
import { productTrackRoles } from "../../product/track-roles";
import { scoreVoiceRoles } from "../_ui/score-colors";
import { generatedParts } from "../_quick/generate";
import { QuickFlow } from "../_quick/QuickFlow";
import { ShareSheet } from "../_ui/ShareSheet";
import { createResultShare } from "./create-share";
import { AppBar } from "../_ui/controls";
import { Icon } from "../_ui/Icon";
import { partialTitle } from "../_ui/format";
import { LivePractice } from "./LivePractice";
import { downloadMusicXml } from "./download";
import { reprepareProject } from "./reprepare";

export function ResultLoading() { return <div className="hm"><div className="hm-page"><AppBar /><p role="status">악보를 그리는 중…</p></div></div>; }
export function ResultClient() {
  const projectId = useSearchParams().get("project") ?? "";
  return <SavedResult key={projectId} projectId={projectId} />;
}
function SavedResult({ projectId }: { projectId: string }) {
  const [sharing, setSharing] = useState(false);
  const [record, setRecord] = useState<LocalProjectRecord>();
  const [view, setView] = useState<ProjectPracticeView>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [again, setAgain] = useState<Awaited<ReturnType<typeof reprepareProject>>>();
  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        const found = projectId ? await new IndexedDbProjectStore().load(projectId) : undefined;
        if (!current) return;
        setRecord(found);
        if (found) {
          const next = await projectPracticeView(found.project);
          if (current) setView(next);
        }
      } catch (reason) { if (current) setError(reason instanceof Error ? reason.message : String(reason)); }
      finally { if (current) setLoading(false); }
    })();
    return () => { current = false; };
  }, [projectId]);
  async function otherParts() {
    if (!record || preparing) return;
    setPreparing(true); setNotice("");
    try {
      const prepared = await reprepareProject(record.project);
      if (prepared) setAgain(prepared);
      else setNotice("이 악보는 원본 MusicXML을 다시 올려 주세요.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setPreparing(false); }
  }
  const voiceRoles = useMemo(() => {
    if (!record || view?.status !== "available") return undefined;
    try { return scoreVoiceRoles(productTrackRoles(record.project, record.project.selectedPresetId ?? "standard", view.plan.trackIds.filter(id => id !== "track:source-lead" && id !== "track:band"))); }
    catch { return undefined; }
  }, [record, view]);
  const description = useMemo(() => record ? describeHarmonyProject(record.project) : undefined, [record]);
  if (again) return <QuickFlow initial={again} />;
  if (loading && !record) return <ResultLoading />;
  const title = description?.title ?? "제목 없는 악보";
  const parts = description?.parts ?? [];
  const details = error || (view?.status === "unavailable" ? view.code : "");
  const actions = <div className="hm-actions">
    <button className="hm-btn hm-btn-primary hm-btn-block" type="button" onClick={() => setSharing(true)}><Icon name="share" />팀원과 공유</button>
    <div className="hm-btn-row"><button className="hm-btn hm-btn-secondary" type="button" onClick={() => { try { if (record) downloadMusicXml(record.project); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } }}><Icon name="download" />MusicXML 받기</button>
      <button className="hm-btn hm-btn-secondary" type="button" aria-label="다른 파트로 다시 만들기" disabled={preparing} onClick={() => void otherParts()}><Icon name="refresh" />{preparing ? "악보 읽는 중…" : "다른 파트로"}</button></div>
  </div>;
  return <div className="hm"><div className="hm-page is-wide" inert={sharing} aria-hidden={sharing || undefined}><AppBar />
    {!record ? <div className="hm-empty"><b>{error ? "악보를 열지 못했어요" : "이 기기에 저장된 악보가 없어요"}</b><Link className="hm-btn hm-btn-primary" href="/library">내 악보</Link></div> : <div className="hm-result">
      <section className="hm-result-head"><h1 className="hm-result-title">{title}</h1><p className="hm-result-meta">{[description?.keyLabelKo, ...description?.meters ?? [], `${description?.measureCount}마디`].join(" · ")}</p>
        <div className="hm-chips"><span className="hm-chip"><span className="hm-dot is-melody" />멜로디</span>{parts.map((part, index) => <span className="hm-chip" key={index}><span className={`hm-dot ${part.role === "lower" ? "is-alto" : part.role === "upper" ? "is-tenor" : ""}`} />{part.label}</span>)}</div>
      </section>
      {parts.filter(part => part.status === "partial" || part.status === "missing").map((part, index) => <div className="hm-banner" role="status" key={index}><Icon name="alert" /><div><p className="hm-banner-title">{partialTitle(part.label, part.missingMeasures ?? [])}</p>
        {generatedParts(projectId)?.find(item => item.part === part.part)?.reasonKo && <p className="hm-banner-text">{generatedParts(projectId)?.find(item => item.part === part.part)?.reasonKo}</p>}
        <div className="hm-chips">{parts.map((item, n) => <span className={`hm-chip ${item.status === "complete" ? "is-done" : "is-partial"}`} key={n}>{item.label} {item.status === "complete" ? "완료" : item.status === "missing" ? "없음" : "일부"}</span>)}</div></div></div>)}
      {view?.status === "available" ? <LivePractice view={view} voiceRoles={voiceRoles} title={title} actions={actions} /> : <>{actions}<p role="status">{loading ? "악보를 그리는 중…" : "악보를 표시하지 못했어요. 고급 편집에서 확인해 주세요."}</p></>}
      {notice && <p className="hm-notice is-ask" role="status">{notice}</p>}
      <details className="hm-fold"><summary>고급 편집</summary><ul><li><Link href={`/workspace?project=${encodeURIComponent(projectId)}`}>음 하나씩 고치기, 후보 비교<small>프로젝트 워크스페이스에서 열려요</small></Link></li></ul></details>
    </div>}
    {details && <div className="hm-notice is-stop" role="alert"><p>예상하지 못한 문제가 생겼어요. 다시 시도해 주세요.</p><details><summary>자세히</summary><div className="hm-prompt"><pre tabIndex={0}>{details}</pre></div></details></div>}
  </div>{sharing && record && <ShareSheet onClose={() => setSharing(false)} createLink={fresh => createResultShare(record, fresh, { origin: location.origin })} />}</div>;
}
