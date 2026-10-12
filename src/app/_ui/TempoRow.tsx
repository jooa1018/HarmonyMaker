"use client";
import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import type { TempoSpec } from "../../domain/source/model";

/** Limits and source are supplied by the adapter; fixture limits are not engine policy. */
export function TempoRow({ tempo, value, onChange, min, max }: {
  tempo: TempoSpec & { origin: "auto" | "score" }; value?: number;
  onChange: (value: number | undefined) => void; min: number; max: number;
}) {
  const id = useId(), bpm = value ?? tempo.bpm;
  const current = useRef(bpm), taps = useRef<number[]>([]);
  const hold = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const repeat = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [tapping, setTapping] = useState(false);
  const beat = `${tempo.beatUnit === 8 ? "♪" : "♩"}${tempo.dotted ? "." : ""}`;
  useEffect(() => { current.current = bpm; }, [bpm]);
  function stopHold() { clearTimeout(hold.current); clearInterval(repeat.current); }
  useEffect(() => () => { stopHold(); clearTimeout(tapTimer.current); }, []);
  function set(next: number) {
    current.current = Math.max(min, Math.min(max, Math.round(next)));
    onChange(current.current === tempo.bpm ? undefined : current.current);
    if (current.current === min || current.current === max) stopHold();
  }
  function tap() {
    const now = performance.now(), previous = taps.current.at(-1);
    if (previous !== undefined && now - previous > 2000) taps.current = [];
    taps.current.push(now); if (taps.current.length > 7) taps.current.shift();
    setTapping(true); clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => setTapping(false), 2000);
    if (taps.current.length >= 2) set(60000 / ((now - taps.current[0]) / (taps.current.length - 1)));
  }
  function startStep(event: PointerEvent<HTMLButtonElement>, delta: -1 | 1) {
    if (!event.isPrimary || event.button !== 0) return;
    stopHold(); set(current.current + delta);
    if (current.current === min || current.current === max) return;
    hold.current = setTimeout(() => { repeat.current = setInterval(() => set(current.current + delta), 80); }, 400);
  }
  return <div className="hm-tempo">
    <div className="hm-tempo-top"><span className="hm-field-label" id={id}>빠르기</span><span className={`hm-tempo-badge${tempo.origin === "score" ? " is-score" : ""}`} hidden={bpm !== tempo.bpm}>{tempo.origin === "score" ? "악보에 적힌 빠르기" : "자동으로 정함"}</span></div>
    <div className="hm-tempo-ctrl" role="group" aria-labelledby={id}>
      <button className="hm-stepbtn" type="button" aria-label="1 느리게" disabled={bpm <= min} onPointerDown={event => startStep(event, -1)} onPointerUp={stopHold} onPointerLeave={stopHold} onPointerCancel={stopHold} onBlur={stopHold} onClick={event => { if (event.detail === 0) set(current.current + -1); }}>−</button>
      <output className="hm-tempo-value" aria-live="polite"><span aria-hidden="true">{beat} = </span><span>{bpm}</span><span className="hm-sr-only"> BPM</span></output>
      <button className="hm-stepbtn" type="button" aria-label="1 빠르게" disabled={bpm >= max} onPointerDown={event => startStep(event, 1)} onPointerUp={stopHold} onPointerLeave={stopHold} onPointerCancel={stopHold} onBlur={stopHold} onClick={event => { if (event.detail === 0) set(current.current + 1); }}>+</button>
      <button className={`hm-btn hm-btn-secondary hm-btn-sm hm-tap${tapping ? " is-tapping" : ""}`} type="button"
        onPointerDown={event => { if (event.isPrimary && event.button === 0) tap(); }}
        onClick={event => { if (event.detail === 0) tap(); }}
        onKeyDown={event => { if ((event.key === "Enter" || event.key === " ") && !event.repeat) { event.preventDefault(); tap(); } }}>박자 두드리기</button>
    </div>
    <p className="hm-small">{tempo.origin === "auto" && <>악보에 빠르기 표시가 없어 {beat}={tempo.bpm}으로 정했어요. </>}원곡보다 빠르면 줄이거나, 노래 박자에 맞춰 버튼을 4번 이상 두드려 주세요.</p>
  </div>;
}
