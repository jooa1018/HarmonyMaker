"use client";
import { useEffect, useRef, useState } from "react";
import type { PreparationView, WorkerStage } from "../../product/harmony-worker/client";
import type { PartChoice } from "../_ui/format";
import type { ScreenWorkerSession } from "../_worker/session";
import { useWorkerHandle } from "../_worker/useWorkerHandle";
import { isAbort } from "../_worker/presentation";
import { confirmRights, emptySelection, preparedSelection, type QuickSelection } from "./selection";

export type InitialPreparation = { preparation: PreparationView; fileName: string };
export function useQuickPreparation(session: ScreenWorkerSession, initial?: InitialPreparation, onInvalidate?: (error?: unknown) => void) {
  const [fileName, setFileName] = useState(initial?.fileName ?? "");
  const [preparation, setPreparation] = useState<PreparationView | undefined>(initial?.preparation);
  const [selection, setSelection] = useState(() => initial ? preparedSelection(initial.preparation) : emptySelection());
  const [reading, setReading] = useState(false), [answering, setAnswering] = useState(false);
  const [stage, setStage] = useState<WorkerStage>("loading"), [error, setError] = useState<unknown>();
  const request = useRef(0), answerRequest = useRef(0);
  useEffect(() => () => { request.current++; answerRequest.current++; }, []);
  useWorkerHandle(session, preparation?.handle);
  function clear() {
    request.current++; answerRequest.current++; setPreparation(undefined);
    setSelection(emptySelection()); setReading(false); setAnswering(false);
  }
  function reset() { clear(); setFileName(""); setError(undefined); }
  function fail(reason: unknown) { clear(); if (!isAbort(reason)) setError(reason); onInvalidate?.(reason); }
  async function chooseFile(file: File) {
    const current = ++request.current; answerRequest.current++; setAnswering(false);
    setFileName(file.name); setPreparation(undefined); setSelection(emptySelection()); setReading(true); setError(undefined);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (current !== request.current) return;
      const result = await session.run(client => client.prepare({ bytes, fileName: file.name }, { onStage: setStage }));
      if (current !== request.current) { session.release(result.handle); return; }
      setPreparation(result); setSelection(preparedSelection(result));
    } catch (reason) { if (current === request.current) fail(reason); }
    finally { if (current === request.current) setReading(false); }
  }
  async function answer(next: QuickSelection) {
    if (!preparation) return;
    const current = ++answerRequest.current;
    setSelection(next); setAnswering(true);
    try {
      const result = await session.run(client => client.answer(preparation.handle, { answers: next.answers, confirmedAt: next.confirmedAt ?? new Date().toISOString() }, { onStage: setStage }));
      if (current === answerRequest.current) {
        setPreparation(result);
        setSelection(previous => ({ ...previous, part: previous.part ?? result.summary?.recommendedPart }));
      }
    } catch (reason) { if (current === answerRequest.current) fail(reason); }
    finally { if (current === answerRequest.current) setAnswering(false); }
  }
  return {
    fileName, preparation, selection, reading, answering, stage, error, reset, chooseFile, setPreparation, setError, fail,
    cancel() { if (session.cancel() !== "committing") reset(); },
    setTempo(tempoOverride: number | undefined) { setSelection(previous => ({ ...previous, tempoOverride })); },
    setPart(part: PartChoice) { setSelection(previous => ({ ...previous, part })); },
    setRights(checked: boolean) { const at = selection.confirmedAt ?? new Date().toISOString(); setSelection(previous => confirmRights(previous, checked, () => at)); },
    setLead(lead: string) { void answer({ ...selection, answers: { ...selection.answers, lead } }); },
    setCarry() { void answer({ ...selection, answers: { ...selection.answers, unreadPrintedChords: "carry-previous" } }); },
  };
}
export type QuickPreparationController = ReturnType<typeof useQuickPreparation>;
