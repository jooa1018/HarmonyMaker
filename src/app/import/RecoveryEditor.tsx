"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SpelledPitch } from "../../domain/pitch";
import { fraction, type Fraction } from "../../domain/fraction";
import { applyRecoveryEdit, inspectRecoveryXml, replayImportRecovery, undoRecoveryEdit, type RecoveryEdit, type RecoveryMeasure } from "../../import/review/recovery";
import { saveImportRecovery, type StoredImportRecovery } from "../../import/review/recovery-store";
import styles from "./import.module.css";

type NoteValue = Extract<RecoveryEdit, { kind: "note" }>["value"];
function quarterInput(value: string): Fraction | undefined {
  const match = /^(\d+)\/(\d+)$/u.exec(value);
  const decimal = /^(\d+)(?:\.(\d{1,6}))?$/u.exec(value);
  try { return match ? fraction(Number(match[1]), Number(match[2])) : decimal ? fraction(Number(decimal[1] + (decimal[2] ?? "")), 10 ** (decimal[2]?.length ?? 0)) : undefined; } catch { return undefined; }
}
function pitchText(pitch?: SpelledPitch): string {
  if (!pitch) return "";
  return `${pitch.step}${pitch.alter < 0 ? "b".repeat(-pitch.alter) : "#".repeat(pitch.alter)}${pitch.octave}`;
}
function parsePitch(value: string): SpelledPitch | undefined {
  const match = /^([A-G])(bb|b|##|#)?(-?\d)$/u.exec(value);
  if (!match) return undefined;
  return { step: match[1] as SpelledPitch["step"], alter: ({ bb: -2, b: -1, "#": 1, "##": 2 } as const)[(match[2] || "") as "b"] ?? 0, octave: Number(match[3]) };
}
function NoteRow({ measure, note, disabled, apply }: {
  readonly measure: RecoveryMeasure; readonly note: RecoveryMeasure["notes"][number]; readonly disabled: boolean;
  readonly apply: (edit: RecoveryEdit) => void;
}) {
  const [kind, setKind] = useState<NoteValue["kind"]>(note.kind === "unresolved" ? "note" : note.kind);
  const [pitch, setPitch] = useState(pitchText(note.pitch));
  const [type, setType] = useState(note.type);
  const [dots, setDots] = useState(note.dots);
  const [tieStart, setTieStart] = useState(note.tieStart);
  const [tieStop, setTieStop] = useState(note.tieStop);
  const types = ["whole", "half", "quarter", "eighth", "16th", "32nd", "64th"];
  const ready = (kind !== "note" || parsePitch(pitch)) && types.includes(type) && [0, 1, 2].includes(dots);
  return <li className={styles.reviewItem}>
    <p><strong>이벤트 {note.event + 1}</strong> · voice {note.voice} · onset {note.onset}박 · 길이 {note.duration}박 · 원래 후보 {note.kind} {pitchText(note.pitch)}</p>
    <div className={styles.rangeGrid}>
      <label className={styles.field}><span>표기</span><select aria-label={`이벤트 ${note.event + 1} 표기`} value={kind} onChange={(e) => setKind(e.target.value as NoteValue["kind"])}><option value="note">음높이 있는 음표</option><option value="rhythm">리듬 슬래시 · 음높이 없음</option><option value="rest">쉼표</option></select></label>
      {kind === "note" ? <label className={styles.field}><span>음높이 (예: Bb4)</span><input aria-label={`이벤트 ${note.event + 1} 음높이`} value={pitch} onChange={(e) => setPitch(e.target.value)} maxLength={5} /></label> : null}
      <label className={styles.field}><span>음 길이</span><select aria-label={`이벤트 ${note.event + 1} 음 길이`} value={type} onChange={(e) => setType(e.target.value)}><option value="">미확정</option>{types.map((v) => <option value={v} key={v}>{v}</option>)}</select></label>
      <label className={styles.field}><span>점</span><select aria-label={`이벤트 ${note.event + 1} 점`} value={dots} onChange={(e) => setDots(Number(e.target.value))}><option value={0}>없음</option><option value={1}>1개</option><option value={2}>2개</option></select></label>
    </div>
    {kind !== "rest" ? <div><label><input type="checkbox" checked={tieStart} onChange={(e) => setTieStart(e.target.checked)} />붙임줄 시작</label> <label><input type="checkbox" checked={tieStop} onChange={(e) => setTieStop(e.target.checked)} />붙임줄 끝</label></div> : null}
    <button type="button" disabled={disabled || !ready} onClick={() => apply({ kind: "note", part: measure.part, measure: measure.measure, event: note.event, value: {
      kind, ...(kind === "note" ? { pitch: parsePitch(pitch)! } : {}), type: type as NoteValue["type"], dots: dots as NoteValue["dots"],
      tieStart: kind !== "rest" && tieStart, tieStop: kind !== "rest" && tieStop,
    } })}>이 이벤트 교정</button>
  </li>;
}
function ChordRow({ measure, chord, disabled, apply }: {
  readonly measure: RecoveryMeasure; readonly chord?: RecoveryMeasure["chords"][number]; readonly disabled: boolean;
  readonly apply: (edit: RecoveryEdit) => void;
}) {
  const [symbol, setSymbol] = useState(chord?.text ?? "");
  const [onset, setOnset] = useState(chord?.onset ?? "");
  return <li className={styles.reviewItem}>
    <p>{chord ? `인식 코드 ${chord.event + 1}: ${chord.text} · onset ${chord.onset}박` : "원본에서 확인한 누락 코드 추가"}</p>
    <label className={styles.field}><span>코드 심벌</span><input aria-label={chord ? `코드 ${chord.event + 1} 심벌` : "추가 코드 심벌"} value={symbol} maxLength={128} onChange={(e) => setSymbol(e.target.value)} /></label>
    <label className={styles.field}><span>마디 시작부터의 위치 (박, 0부터)</span><input aria-label={chord ? `코드 ${chord.event + 1} 위치` : "추가 코드 위치"} value={onset} onChange={(e) => setOnset(e.target.value)} placeholder="예: 0 또는 3/2" /></label>
    <button type="button" disabled={disabled || !symbol || !quarterInput(onset)} onClick={() => apply({ kind: "chord", part: measure.part, measure: measure.measure, event: chord?.event ?? measure.chords.length, symbol, onset: quarterInput(onset)! })}>{chord ? "이 코드 교정" : "누락 코드 추가"}</button>
  </li>;
}
export function RecoveryEditor({ entry, onChanged, onInvalidate, onValidate }: {
  readonly entry: StoredImportRecovery; readonly onChanged: (entry: StoredImportRecovery) => void;
  readonly onInvalidate: () => void;
  readonly onValidate: (entry: StoredImportRecovery) => Promise<void>;
}) {
  const [view, setView] = useState({ xml: entry.recovery.originalXml, revision: entry.recovery.originalDigest });
  const expectedRevision = entry.recovery.operations.at(-1)?.afterDigest ?? entry.recovery.originalDigest;
  const restoring = view.revision !== expectedRevision;
  const [measureIndex, setMeasureIndex] = useState(0);
  const [reference, setReference] = useState("");
  const [meter, setMeter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pageIndex, setPageIndex] = useState(0);
  const imageRef = useRef<HTMLImageElement>(null);
  const imageLinkRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => { let active = true; void replayImportRecovery(entry.recovery).then((xml) => { if (active) setView({ xml, revision: expectedRevision }); }).catch(() => { if (active) setError("교정 이력의 무결성을 확인하지 못했습니다."); }); return () => { active = false; }; }, [entry.recovery, expectedRevision]);
  useEffect(() => {
    const page = entry.pages[pageIndex];
    if (!page) return;
    const url = URL.createObjectURL(page.blob);
    if (imageRef.current) imageRef.current.src = url;
    if (imageLinkRef.current) imageLinkRef.current.href = url;
    return () => URL.revokeObjectURL(url);
  }, [entry.pages, pageIndex]);
  const measures = useMemo(() => inspectRecoveryXml(view.xml), [view.xml]);
  const measure = measures[measureIndex];
  const commit = async (edit?: RecoveryEdit) => {
    onInvalidate();
    setBusy(true); setError("");
    try {
      const recovery = edit ? await applyRecoveryEdit(entry.recovery, edit, reference, new Date().toISOString()) : undoRecoveryEdit(entry.recovery);
      const next = { ...entry, recovery, updatedAt: new Date().toISOString() };
      await saveImportRecovery(next);
      setView({ xml: await replayImportRecovery(recovery), revision: recovery.operations.at(-1)?.afterDigest ?? recovery.originalDigest });
      onChanged(next);
    } catch (caught) { setError(`교정을 적용하지 못했습니다: ${caught instanceof Error ? caught.message : "저장 오류"}`); }
    finally { setBusy(false); }
  };
  const downloadOriginal = () => {
    const url = URL.createObjectURL(new Blob([entry.recovery.originalXml], { type: "application/vnd.recordare.musicxml+xml" }));
    const a = document.createElement("a"); a.href = url; a.download = "original-recognition.musicxml"; a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className={styles.subpanel} aria-labelledby="recovery-heading">
    <h2 id="recovery-heading">확정 전 후보 교정</h2>
    <p>원본 인식 결과와 교정 이력은 이 브라우저에 별도로 보존됩니다. 아래 페이지·시스템·마디 번호는 인식 결과의 좌표이며 원본과 직접 대조해야 합니다.</p>
    <p>음 길이를 바꾸면 뒤 이벤트의 위치도 달라질 수 있습니다. 교정 후 마디 전체와 다른 voice를 다시 확인하세요. 이 편집기는 누락 음표·마디 추가나 조각 연결을 아직 지원하지 않습니다.</p>
    {entry.incompleteReason ? <p role="alert">전체 구조 미확정: {entry.incompleteReason} 이 조각만으로 전체 Source를 확정할 수 없습니다.</p> : null}
    {entry.pages.length ? <div>
      <label className={styles.field}><span>원본 페이지</span><select value={pageIndex} onChange={(e) => setPageIndex(Number(e.target.value))}>{entry.pages.map((p, i) => <option key={p.pageIndex} value={i}>{i + 1}페이지</option>)}</select></label>
      {/* Original bytes, never a generated replacement or an inferred crop. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <a ref={imageLinkRef} target="_blank" rel="noreferrer"><img ref={imageRef} alt={`대조할 원본 ${pageIndex + 1}페이지`} style={{ maxWidth: "100%", height: "auto" }} /></a>
    </div> : <p>직접 가져온 파일입니다. 원본 악보를 함께 열어 대조하세요.</p>}
    <label className={styles.field}><span>인식 결과 위치</span><select value={measureIndex} onChange={(e) => { setMeasureIndex(Number(e.target.value)); setMeter(""); }}>{measures.map((m, i) => <option value={i} key={i}>파트 {m.part + 1} · 인식 페이지 {m.page} / 시스템 {m.system} / 마디 {m.printedNumber} · {m.notes.length}개 이벤트</option>)}</select></label>
    <label className={styles.field}><span>대조한 원본 위치 (필수)</span><input aria-label="대조한 원본 위치" value={reference} maxLength={256} onChange={(e) => setReference(e.target.value)} placeholder="예: 원본 1페이지 2번째 시스템 7마디" /></label>
    {restoring ? <p role="status">저장된 교정 후보를 복구하는 중입니다.</p> : measure ? <div>
      <p>인식 박자: {measure.meter ? `${measure.meter.numerator}/${measure.meter.denominator}` : "없음"}</p>
      <label className={styles.field}><span>이 마디에서 시작하는 박자</span><input aria-label="교정 박자" value={meter} onChange={(e) => setMeter(e.target.value)} placeholder="4/4" /></label>
      <button type="button" disabled={busy || !reference.trim() || !/^\d+\/(4|8)$/u.test(meter)} onClick={() => { const [n, d] = meter.split("/").map(Number); void commit({ kind: "meter", part: measure.part, measure: measure.measure, numerator: n, denominator: d as 4 | 8 }); }}>박자 교정</button>
      <ul className={styles.reviewList}>{measure.notes.map((note) => <NoteRow key={`${view.revision}:${measureIndex}:${note.event}`} measure={measure} note={note} disabled={busy || !reference.trim()} apply={(edit) => void commit(edit)} />)}</ul>
      <ul className={styles.reviewList}>
        {measure.chords.map((chord) => <ChordRow key={`chord:${entry.recovery.operations.length}:${measureIndex}:${chord.event}`} measure={measure} chord={chord} disabled={busy || !reference.trim()} apply={(edit) => void commit(edit)} />)}
        <ChordRow key={`new-chord:${entry.recovery.operations.length}:${measureIndex}`} measure={measure} disabled={busy || !reference.trim()} apply={(edit) => void commit(edit)} />
      </ul>
    </div> : <p role="alert">편집 가능한 마디가 없습니다. 원본만 보존합니다.</p>}
    <p role="status">{error || `명시적 교정 ${entry.recovery.operations.length}건 · 브라우저 저장됨`}</p>
    <div className={styles.presetRow}>
      <button type="button" disabled={busy || restoring || !entry.recovery.operations.length} onClick={() => void commit()}>마지막 교정 취소</button>
      <button type="button" onClick={downloadOriginal}>원본 인식 결과 보존</button>
      <button type="button" disabled={busy || restoring || Boolean(entry.incompleteReason)} onClick={async () => { setBusy(true); setError(""); try { await onValidate(entry); } catch { setError("전체 재검증을 완료하지 못했습니다."); } finally { setBusy(false); } }}>교정 후보 전체 재검증</button>
    </div>
    <details><summary>교정 전후와 출처</summary><ol>{entry.recovery.operations.map((operation, index) => <li key={index}><strong>{operation.sourceLocation}</strong> · {operation.appliedAt}<pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(operation, null, 2)}</pre></li>)}</ol></details>
  </section>;
}
