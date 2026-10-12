import type { TempoSpec } from "../../domain/source/model";

export function PracticeTempo({ tempo, speed }: { tempo: TempoSpec; speed: number }) {
  return <span className="hm-bpm"><span aria-hidden="true">{tempo.beatUnit === 8 ? "♪" : "♩"}{tempo.dotted ? "." : ""} = </span><span>{Math.round(tempo.bpm * speed / 100)}</span><span className="hm-sr-only"> BPM</span></span>;
}
export function LeadOctaveSwitch({ value, onChange }: { value: 0 | -1; onChange: (value: 0 | -1) => void }) {
  return <div className="hm-switch-row"><span><b>멜로디 한 옥타브 낮게</b><small>남성 음역으로 들려서 테너가 멜로디 위에 와요</small></span><button className="hm-switch" type="button" role="switch" aria-checked={value === -1} aria-label="멜로디 한 옥타브 낮게" onClick={() => onChange(value === -1 ? 0 : -1)} /></div>;
}
