"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { QuickHarmonyChoice, QuickHarmonyPreparation, QuickHarmonyPartResult } from "../../product/quick-harmony";
import { AppBar } from "../_ui/controls";
import { Icon } from "../_ui/Icon";
import { titleFromFileName } from "../_ui/format";
import { QuickStart } from "./QuickStart";
import { PreparationScreen } from "./PreparationScreen";
import { MakingState } from "./MakingState";
import { useQuickPreparation } from "./useQuickPreparation";

export function QuickFlow({ initial }: { initial?: { preparation: QuickHarmonyPreparation; fileName: string } }) {
  const ui = useQuickPreparation(initial);
  const router = useRouter();
  const [requested, setRequested] = useState<QuickHarmonyChoice>();
  const [blocked, setBlocked] = useState<readonly QuickHarmonyPartResult[]>([]);
  const generation = useRef(0);
  const busy = useRef(false);
  useEffect(() => () => { generation.current++; }, []);
  async function generate(choice: QuickHarmonyChoice) {
    if (busy.current || !ui.preparation) return;
    busy.current = true;
    const current = ++generation.current;
    setRequested(choice); setBlocked([]);
    try {
      // Paint the progress state before loading and running the local engine.
      await new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
      const { generateAndSave } = await import("./generate");
      const outcome = await generateAndSave(ui.preparation, choice, { isCurrent: () => current === generation.current });
      if (outcome.status === "saved") router.push(`/result?project=${encodeURIComponent(outcome.projectId)}`);
      else if (outcome.status === "returned") {
        ui.setPreparation(outcome.result.preparation);
        if (outcome.result.status === "blocked") setBlocked(outcome.result.parts);
        setRequested(undefined);
      }
    } catch (reason) {
      if (current === generation.current) { ui.setError(reason instanceof Error ? reason.message : String(reason)); setRequested(undefined); }
    } finally { if (current === generation.current) busy.current = false; }
  }
  async function openEditor() {
    if (!ui.preparation?.workspace) return;
    try {
      const { saveEditableWorkspace } = await import("./edit-workspace");
      const id = await saveEditableWorkspace(ui.preparation.workspace);
      router.push(`/score-workspace?id=${encodeURIComponent(id)}`);
    } catch (reason) { ui.setError(reason instanceof Error ? reason.message : String(reason)); }
  }
  if (ui.error) return <div className="hm"><div className="hm-page"><AppBar /><div className="hm-notice is-stop" role="alert"><div className="hm-notice-head"><Icon name="stop" /><h1 className="hm-notice-title">예상하지 못한 문제가 생겼어요. 다시 시도해 주세요.</h1></div></div><button className="hm-btn hm-btn-primary hm-btn-block" type="button" onClick={ui.reset}>다른 파일 올리기</button><details className="hm-fold"><summary>자세히</summary><div className="hm-prompt"><pre tabIndex={0}>{ui.error}</pre></div></details></div></div>;
  if (requested) return <MakingState title={ui.preparation?.summary?.title ?? titleFromFileName(ui.fileName)} measureCount={ui.preparation?.summary?.measureCount} parts={Array.isArray(requested.parts) ? requested.parts : []} />;
  return ui.preparation ? <PreparationScreen ui={ui} blocked={blocked} onGenerate={choice => void generate(choice)} onEdit={() => void openEditor()} /> : <QuickStart ui={ui} />;
}
