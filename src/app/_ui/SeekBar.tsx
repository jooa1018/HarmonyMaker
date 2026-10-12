"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { formatClock } from "./format";

/** UI uses seconds; the live adapter maps them to the engine's quarter positions. */
export interface SeekController {
  seek: (seconds: number) => void;
  measureAt: (seconds: number) => string | number | undefined;
  stepMeasure: (seconds: number, direction: -1 | 1) => number;
}
export function SeekBar({ seconds, totalSeconds, controller, previewDrag }: {
  seconds: number; totalSeconds: number; controller: SeekController; previewDrag?: number;
}) {
  const [draft, setDraft] = useState<number>();
  const [tipLeft, setTipLeft] = useState<number>();
  const root = useRef<HTMLDivElement>(null), tip = useRef<HTMLSpanElement>(null);
  const pointer = useRef<number | undefined>(undefined);
  const clamp = (value: number) => Math.max(0, Math.min(totalSeconds, value));
  const position = clamp(draft ?? previewDrag ?? seconds), dragging = draft !== undefined || previewDrag !== undefined;
  const measure = controller.measureAt(position);
  const percent = totalSeconds > 0 ? position / totalSeconds * 100 : 0;
  useLayoutEffect(() => {
    if (!dragging || !root.current || !tip.current) return;
    const update = () => {
      const width = root.current!.clientWidth, half = tip.current!.offsetWidth / 2;
      setTipLeft(Math.max(half, Math.min(percent / 100 * width, width - half)));
    };
    update(); const observer = new ResizeObserver(update); observer.observe(root.current); observer.observe(tip.current);
    return () => observer.disconnect();
  }, [dragging, percent, position]);
  function point(clientX: number) {
    const box = root.current!.getBoundingClientRect();
    return box.width > 0 ? clamp((clientX - box.left) / box.width * totalSeconds) : 0;
  }
  function cancel() { pointer.current = undefined; setDraft(undefined); }
  return <div ref={root} className={`hm-seek${dragging ? " is-dragging" : ""}`} role="slider" tabIndex={0} aria-label="재생 위치" aria-valuemin={0} aria-valuemax={totalSeconds} aria-valuenow={position} aria-valuetext={`${formatClock(position)}${measure === undefined ? "" : `, ${measure}번째 마디`}`}
    onPointerDown={event => {
      if (!event.isPrimary || event.button !== 0 || pointer.current !== undefined) return;
      event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
      pointer.current = event.pointerId; setDraft(point(event.clientX));
    }}
    onPointerMove={event => { if (pointer.current === event.pointerId) setDraft(point(event.clientX)); }}
    onPointerUp={event => {
      if (pointer.current !== event.pointerId) return;
      const next = point(event.clientX); cancel();
      // Synchronous inside the user gesture, once per completed pointer gesture.
      controller.seek(next);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onPointerCancel={event => { if (pointer.current === event.pointerId) cancel(); }} onLostPointerCapture={event => { if (pointer.current === event.pointerId) cancel(); }}
    onKeyDown={event => {
      let next: number;
      if (event.key === "Home") next = 0;
      else if (event.key === "End") next = totalSeconds;
      else if (event.key === "ArrowRight" || event.key === "ArrowUp") next = controller.stepMeasure(seconds, 1);
      else if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = controller.stepMeasure(seconds, -1);
      else return;
      event.preventDefault(); if (pointer.current === undefined) controller.seek(clamp(next));
    }}>
    <span className="hm-seek-track"><span className="hm-seek-fill" style={{ width: `${percent}%` }} /></span>
    <span className="hm-seek-thumb" style={{ left: `${percent}%` }} />
    <span ref={tip} className="hm-seek-tip" hidden={!dragging} style={{ left: tipLeft === undefined ? `${percent}%` : `${tipLeft}px` }}>{measure !== undefined && `${measure}번째 마디 · `}{formatClock(position)}</span>
  </div>;
}
