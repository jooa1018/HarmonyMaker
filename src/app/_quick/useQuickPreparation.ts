"use client";
import { useEffect, useRef, useState } from "react";
import type { QuickHarmonyPreparation } from "../../product/quick-harmony";
import type { PartChoice } from "../_ui/format";
import { confirmRights, emptySelection, preparedSelection } from "./selection";

export function useQuickPreparation() {
  const [fileName, setFileName] = useState("");
  const [preparation, setPreparation] = useState<QuickHarmonyPreparation>();
  const [selection, setSelection] = useState(emptySelection);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);
  useEffect(() => () => { request.current++; }, []);
  function reset() {
    request.current++; setFileName(""); setPreparation(undefined);
    setSelection(emptySelection()); setReading(false); setError("");
  }
  async function chooseFile(file: File) {
    const current = ++request.current;
    setFileName(file.name); setPreparation(undefined); setSelection(emptySelection()); setReading(true); setError("");
    try {
      const { prepareQuickHarmony } = await import("../../product/quick-harmony");
      const result = await prepareQuickHarmony({ bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name });
      if (current !== request.current) return;
      setPreparation(result); setSelection(preparedSelection(result));
    } catch (reason) {
      if (current === request.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally { if (current === request.current) setReading(false); }
  }
  return {
    fileName, preparation, selection, reading, error, reset, chooseFile, setPreparation, setError,
    setPart(part: PartChoice) { setSelection(previous => ({ ...previous, part })); },
    setRights(checked: boolean) { const at = selection.confirmedAt ?? new Date().toISOString(); setSelection(previous => confirmRights(previous, checked, () => at)); },
    setLead(lead: string) { setSelection(previous => ({ ...previous, answers: { ...previous.answers, lead } })); },
    setCarry() { setSelection(previous => ({ ...previous, answers: { ...previous.answers, unreadPrintedChords: "carry-previous" } })); },
  };
}
export type QuickPreparationController = ReturnType<typeof useQuickPreparation>;
