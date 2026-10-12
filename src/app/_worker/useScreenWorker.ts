"use client";
import { useEffect, useState } from "react";
import { ScreenWorkerSession } from "./session";
export function useScreenWorker() {
  const [session] = useState(() => new ScreenWorkerSession());
  useEffect(() => { session.activate(); return () => session.close(); }, [session]);
  return session;
}
