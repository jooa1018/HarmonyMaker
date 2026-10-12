"use client";
import { useEffect, useRef } from "react";
import type { PreparationHandle, ProjectHandle } from "../../product/harmony-worker/client";
import type { ScreenWorkerSession } from "./session";
/** Release an abandoned view, while allowing React's setup-cleanup-setup probe. */
export function useWorkerHandle(session: ScreenWorkerSession, handle?: PreparationHandle | ProjectHandle) {
  const mounted = useRef(handle);
  useEffect(() => {
    mounted.current = handle;
    return () => {
      mounted.current = undefined;
      queueMicrotask(() => { if (handle && mounted.current !== handle) session.release(handle); });
    };
  }, [handle, session]);
}
