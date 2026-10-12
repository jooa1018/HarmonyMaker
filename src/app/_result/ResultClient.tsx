"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ProjectView, WorkerStage } from "../../product/harmony-worker/client";
import { useWorkerHandle } from "../_worker/useWorkerHandle";
import { useScreenWorker } from "../_worker/useScreenWorker";
import { WorkerFailure, isAbort, stageLabel } from "../_worker/presentation";
import type { InitialPreparation } from "../_quick/useQuickPreparation";
import { scoreVoiceRoles } from "../_ui/score-colors";
import { QuickFlow } from "../_quick/QuickFlow";
import { ShareSheet } from "../_ui/ShareSheet";
import { createResultShare } from "./create-share";
import { AppBar } from "../_ui/controls";
import { Icon } from "../_ui/Icon";
import { partialTitle } from "../_ui/format";
import { ActionTiles } from "../_ui/ActionTiles";
import { LivePractice } from "./LivePractice";
import { downloadMusicXml } from "./download";

export function ResultLoading() { return <div className="hm"><div className="hm-page"><AppBar /><p role="status">악보를 그리는 중…</p></div></div>; }
export function ResultClient() {
  const projectId = useSearchParams().get("project") ?? "";
  return <SavedResult key={projectId} projectId={projectId} />;
}
function SavedResult({ projectId }: { projectId: string }) {
  const [sharing, setSharing] = useState(false);
  const session = useScreenWorker();
  const [record, setRecord] = useState<ProjectView>();
  useWorkerHandle(session, record?.handle);
  const [loading, setLoading] = useState(true), [stage, setStage] = useState<WorkerStage>("loading");
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [again, setAgain] = useState<InitialPreparation>();
  const revision = useRef(0);
  const load = useCallback(async () => {
    const current = ++revision.current;
    try {
      const found = projectId ? await session.run(client => client.open(projectId, { onStage: setStage })) : null;
      if (current === revision.current) setRecord(found ?? undefined);
      else if (found) session.release(found.handle);
    } catch (reason) { if (current === revision.current) { setRecord(undefined); if (!isAbort(reason)) setError(reason); } }
    finally { if (current === revision.current) setLoading(false); }
  }, [projectId, session]);
  useEffect(() => {
    let active = true;
    const invalidate = () => { revision.current++; };
    void Promise.resolve().then(() => { if (active) void load(); });
    return () => { active = false; invalidate(); };
  }, [load]);
  const recover = useCallback((reason?: unknown) => {
    setRecord(undefined); setAgain(undefined); setPreparing(false); setLoading(true);
    if (reason && !isAbort(reason)) setError(reason);
    void load();
  }, [load]);
  async function otherParts() {
    if (!record || preparing) return;
    setPreparing(true); setNotice(""); setError(undefined);
    try {
      const prepared = await session.run(client => client.prepareFromProject(record.handle, { onStage: setStage }));
      if (prepared) { session.release(record.handle); setRecord(undefined); setAgain({ preparation: prepared, fileName: record.description.title ?? "화음 악보" }); }
      else setNotice("이 악보는 원본 MusicXML을 다시 올려 주세요.");
    } catch (reason) { recover(reason); }
    finally { setPreparing(false); }
  }
  async function download() {
    if (!record) return;
    try { const xml = await session.run(client => client.exportMusicXml(record.handle)); downloadMusicXml(xml, record.description.title ?? "화음 악보"); }
    catch (reason) { recover(reason); }
  }
  async function share(fresh: boolean) {
    if (!record) throw new Error("WORKER_HANDLE_EXPIRED");
    try {
      const payload = await session.run(client => client.sharePayload(record.handle, { rightsConfirmed: true, confirmedAt: new Date().toISOString(), playbackDefaults: { speedPercent: 100, accompanimentEnabled: true } }));
      return await createResultShare({ projectId, rightsBasis: record.rightsBasis, payload }, fresh, { origin: location.origin });
    } catch (reason) {
      recover(reason);
      if (reason && typeof reason === "object" && "code" in reason) throw new Error(String(reason.code));
      throw reason;
    }
  }
  const view = record?.practice, description = record?.description;
  const voiceRoles = useMemo(() => record?.trackRoles ? scoreVoiceRoles(record.trackRoles) : undefined, [record]);
  if (again) return <QuickFlow initial={again} session={session} onInvalidate={recover} />;
  const title = description?.title ?? "제목 없는 악보", parts = description?.parts ?? [];
  const actions = (openAudio?: () => void) => <div className="hm-actions">
    <button className="hm-btn hm-btn-primary hm-btn-block" type="button" onClick={() => setSharing(true)}><Icon name="share" />팀원과 공유</button>
    <ActionTiles onAudio={openAudio ?? (() => {})} disabledAudio={!openAudio} onDownload={() => void download()} onOther={() => void otherParts()} preparing={preparing} />
  </div>;
  return <div className="hm"><div className="hm-page is-wide" inert={sharing} aria-hidden={sharing || undefined}><AppBar />
    {loading && !record ? <p role="status">{stageLabel(stage)} · 악보를 그리는 중…</p> : !record ? <div className="hm-empty"><b>{error ? "악보를 열지 못했어요" : "이 기기에 저장된 악보가 없어요"}</b><Link className="hm-btn hm-btn-primary" href="/library">내 악보</Link></div> : <div className="hm-result">
      <section className="hm-result-head"><h1 className="hm-result-title">{title}</h1><p className="hm-result-meta">{[description?.keyLabelKo, ...description?.meters ?? [], `${description?.measureCount}마디`].join(" · ")}</p>
        <div className="hm-chips"><span className="hm-chip"><span className="hm-dot is-melody" />멜로디</span>{parts.map((part, index) => <span className="hm-chip" key={index}><span className={`hm-dot ${part.role === "lower" ? "is-alto" : part.role === "upper" ? "is-tenor" : ""}`} />{part.label}</span>)}</div>
      </section>
      {parts.filter(part => part.status === "partial" || part.status === "missing").map((part, index) => <div className="hm-banner" role="status" key={index}><Icon name="alert" /><div><p className="hm-banner-title">{partialTitle(part.label, part.missingMeasures ?? [])}</p>
        {part.reasonKo && <p className="hm-banner-text">{part.reasonKo}</p>}
        <div className="hm-chips">{parts.map((item, n) => <span className={`hm-chip ${item.status === "complete" ? "is-done" : "is-partial"}`} key={n}>{item.label} {item.status === "complete" ? "완료" : item.status === "missing" ? "없음" : "일부"}</span>)}</div></div></div>)}
      {view?.status === "available" ? <LivePractice view={view} voiceRoles={voiceRoles} title={title} actions={actions} /> : <>{actions()}<p role="status">{loading ? "악보를 그리는 중…" : "악보를 표시하지 못했어요. 고급 편집에서 확인해 주세요."}</p></>}
      {notice && <p className="hm-notice is-ask" role="status">{notice}</p>}
      <details className="hm-fold"><summary>고급 편집</summary><ul><li><Link href={`/workspace?project=${encodeURIComponent(projectId)}`}>음 하나씩 고치기, 후보 비교<small>프로젝트 워크스페이스에서 열려요</small></Link></li></ul></details>
    </div>}
    {Boolean(error) && <WorkerFailure error={error} />}
  </div>{sharing && <ShareSheet onClose={() => setSharing(false)} createLink={share} />}</div>;
}
