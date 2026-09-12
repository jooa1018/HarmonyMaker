"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { IndexedDbProjectStore, type LocalProjectRecord } from "../../product/local-project-store";
import { importHarmonyProject } from "../../product/project-transfer";

/** File recovery is available even when this browser has no project or draft. */
export function ProjectLibrary() {
  const router = useRouter();
  const store = useMemo(() => new IndexedDbProjectStore(), []);
  const [items, setItems] = useState<readonly Pick<LocalProjectRecord, "projectId" | "updatedAt">[]>([]);
  const [message, setMessage] = useState("저장한 프로젝트를 확인하는 중…");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void store.list().then(rows => { if (active) { setItems(rows); setMessage(rows.length ? "저장한 프로젝트를 선택하세요." : "이 브라우저에 저장한 프로젝트가 없습니다. 파일을 가져올 수 있습니다."); } })
      .catch(() => { if (active) setMessage("저장소를 읽지 못했습니다. 브라우저의 저장 공간을 확인하세요."); });
    return () => { active = false; };
  }, [store]);
  const open = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file || busy) return;
    setBusy(true); setMessage("프로젝트 파일을 검증하고 새 사본으로 저장하는 중…");
    try {
      const project = await importHarmonyProject(await file.text());
      const projectId = crypto.randomUUID();
      await store.saveNew({ projectId, project, updatedAt: new Date().toISOString() });
      router.push(`/workspace?project=${encodeURIComponent(projectId)}`);
    } catch (error) { setMessage(`프로젝트를 열지 못했습니다: ${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };
  return <section className="panel"><h2>저장한 프로젝트 · 파일 열기</h2>
    <p>프로젝트 파일은 확정 당시 Source와 편곡 결과를 포함합니다. 가져온 파일은 기존 저장본을 보존하고 새 사본으로 저장합니다.</p>
    <label>프로젝트 가져오기<input type="file" accept="application/json,.json" disabled={busy} onChange={event => void open(event)} /></label>
    <p role="status">{message}</p>
    {items.map(item => <p key={item.projectId}><Link href={`/workspace?project=${encodeURIComponent(item.projectId)}`}>{item.updatedAt} · {item.projectId}</Link></p>)}
  </section>;
}
