"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { QuickHarmonyChoice, QuickHarmonyPartResult } from "../../product/quick-harmony";
import type { WorkerStage } from "../../product/harmony-worker/client";
import { AppBar } from "../_ui/controls";
import { titleFromFileName } from "../_ui/format";
import { useScreenWorker } from "../_worker/useScreenWorker";
import type { ScreenWorkerSession } from "../_worker/session";
import { WorkerFailure, isAbort, stageLabel } from "../_worker/presentation";
import { QuickStart } from "./QuickStart";
import { PreparationScreen } from "./PreparationScreen";
import { MakingState } from "./MakingState";
import { useQuickPreparation, type InitialPreparation } from "./useQuickPreparation";

export function QuickFlow({ initial, session: supplied, onInvalidate }: { initial?: InitialPreparation; session?: ScreenWorkerSession; onInvalidate?: (error?: unknown) => void }) {
  const owned = useScreenWorker(), session = supplied ?? owned;
  const ui = useQuickPreparation(session, initial, onInvalidate), router = useRouter();
  const [requested, setRequested] = useState<QuickHarmonyChoice>();
  const [blocked, setBlocked] = useState<readonly QuickHarmonyPartResult[]>();
  const [stage, setStage] = useState<WorkerStage>("loading"), [editing, setEditing] = useState(false);
  const generation = useRef(0), busy = useRef(false);
  useEffect(() => () => { generation.current++; }, []);
  function failed(reason: unknown) {
    ui.fail(reason); setRequested(undefined);
  }
  async function generate(choice: QuickHarmonyChoice) {
    if (busy.current || !ui.preparation) return;
    busy.current = true;
    const current = ++generation.current;
    setRequested(choice); setBlocked(undefined); setStage("loading");
    try {
      const outcome = await session.run(client => client.generate(ui.preparation!.handle, choice, { onStage: setStage }));
      if (current !== generation.current) return;
      if (outcome.status === "saved") {
        router.push(`/result?project=${encodeURIComponent(outcome.project.projectId!)}`);
        // Result routes reopen by id; no handle crosses route ownership.
        session.release(outcome.project.handle);
        if (initial) onInvalidate?.();
      } else {
        ui.setPreparation(outcome.preparation); setBlocked(outcome.parts); setRequested(undefined);
      }
    } catch (reason) { if (current === generation.current) failed(reason); }
    finally { if (current === generation.current) busy.current = false; }
  }
  function cancel() {
    if (session.cancel() === "committing") return;
    generation.current++; busy.current = false; setRequested(undefined); ui.reset(); onInvalidate?.();
  }
  async function openEditor() {
    if (!ui.preparation || busy.current) return;
    busy.current = true; setEditing(true);
    const current = ++generation.current;
    try {
      const result = await session.run(client => client.saveEditableWorkspace(ui.preparation!.handle, { onStage: setStage }));
      if (current === generation.current) router.push(`/score-workspace?id=${encodeURIComponent(result.workspaceId)}`);
    } catch (reason) { if (current === generation.current) failed(reason); }
    finally { if (current === generation.current) { busy.current = false; setEditing(false); } }
  }
  if (ui.error && !isAbort(ui.error)) return <div className="hm"><div className="hm-page"><AppBar /><WorkerFailure error={ui.error} /><button className="hm-btn hm-btn-primary hm-btn-block" type="button" onClick={ui.reset}>다른 파일 올리기</button></div></div>;
  if (editing) return <div className="hm"><div className="hm-page"><AppBar /><p role="status">{stageLabel(stage)}</p></div></div>;
  if (requested) return <MakingState title={ui.preparation?.summary?.title ?? titleFromFileName(ui.fileName)} measureCount={ui.preparation?.summary?.measureCount} parts={Array.isArray(requested.parts) ? requested.parts : []} stage={stage} onCancel={cancel} />;
  return ui.preparation ? <PreparationScreen ui={{ ...ui, cancel }} blocked={blocked} onGenerate={choice => void generate(choice)} onEdit={() => void openEditor()} /> : <QuickStart ui={{ ...ui, cancel }} />;
}
