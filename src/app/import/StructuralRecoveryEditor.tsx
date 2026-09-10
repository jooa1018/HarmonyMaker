"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { binaryDigest } from "../../domain/digest/canonical";
import { fraction, type Fraction } from "../../domain/fraction";
import type { SpelledPitch } from "../../domain/pitch";
import { createImportRecovery } from "../../import/review/recovery";
import type { StoredImportRecovery } from "../../import/review/recovery-store";
import { applyStructuralEdit, attestStructuralMeasure, createStructuralRecovery, inspectStructuralMeasure, inspectStructuralNote, redoStructuralEdit, replayStructuralRecovery, structuralDigest, undoStructuralEdit, validateStructuralRecovery, verifiedStructuralCandidate, type RecoveryNoteValue, type StructuralEdit, type StructuralMeasure, type StructuralRecovery, type StructuralState } from "../../import/review/structural-recovery";
import { loadStructuralRecoveries, saveStructuralRecovery, type StoredStructuralRecovery } from "../../import/review/structural-recovery-store";
import { exportStructuralBundle, importStructuralBundle } from "../../import/review/structural-recovery-bundle";
import styles from "./import.module.css";

function quarters(s: string): Fraction | undefined {
  const m = /^(\d+)(?:\/(\d+)|\.(\d{1,6}))?$/u.exec(s.trim()); if (!m) return;
  try { return m[2] ? fraction(Number(m[1]), Number(m[2])) : m[3] ? fraction(Number(m[1] + m[3]), 10 ** m[3].length) : fraction(Number(m[1])); } catch { return; }
}
const qtext = (q?: Fraction) => q ? `${q.n}/${q.d}` : "";
function pitch(s: string): SpelledPitch | undefined {
  const m = /^([A-G])(bb|b|##|#)?(-?\d)$/u.exec(s); if (!m) return;
  return { step: m[1] as SpelledPitch["step"], alter: ({ bb: -2, b: -1, "#": 1, "##": 2 } as const)[m[2] as "b"] ?? 0, octave: Number(m[3]) };
}
const pitchText = (p?: SpelledPitch) => p ? `${p.step}${p.alter < 0 ? "b".repeat(-p.alter) : "#".repeat(p.alter)}${p.octave}` : "";
function Field({ name, value, onChange }: { name: string; value: string; onChange: (value: string) => void }) {
  return <label className={styles.field}><span>{name}</span><input aria-label={name} value={value} onChange={(e) => onChange(e.target.value)} maxLength={256} /></label>;
}
function NoteForm({ m, eventId, apply, disabled }: { m: StructuralMeasure; eventId: string; apply: (edit: StructuralEdit) => void; disabled: boolean }) {
  const event = m.notes.find((e) => e.id === eventId), n = useMemo(() => event ? inspectStructuralNote(m, event) : undefined, [m, event]);
  const [kind, setKind] = useState<RecoveryNoteValue["kind"]>(n?.kind === "rhythm" || n?.kind === "rest" ? n.kind : "note");
  const [p, setP] = useState(pitchText(n?.pitch)), [onset, setOnset] = useState(qtext(event?.onset)), [voice, setVoice] = useState(n?.voice ?? "1");
  const [type, setType] = useState(n?.type ?? "eighth"), [dots, setDots] = useState(n?.dots ?? 0);
  const [start, setStart] = useState(n?.tieStart ?? false), [stop, setStop] = useState(n?.tieStop ?? false);
  const [removeMarks, setRemoveMarks] = useState<readonly ("articulations" | "arpeggiate" | "slur")[]>([]);
  const types = ["whole", "half", "quarter", "eighth", "16th", "32nd", "64th"];
  return <fieldset disabled={disabled}><legend>{event ? "선택 이벤트의 값·위치 교정" : "원본에서 확인한 누락 이벤트 삽입"}</legend>
    <div className={styles.rangeGrid}>
      <label className={styles.field}><span>종류</span><select aria-label="구조 이벤트 종류" value={kind} onChange={(e) => setKind(e.target.value as RecoveryNoteValue["kind"])}><option value="note">음표</option><option value="rhythm">리듬 슬래시 · pitch 없음</option><option value="rest">쉼표</option></select></label>
      {kind === "note" ? <Field name="구조 이벤트 음높이" value={p} onChange={setP} /> : null}
      <Field name="구조 이벤트 onset" value={onset} onChange={setOnset} /><Field name="구조 이벤트 성부" value={voice} onChange={setVoice} />
      <label className={styles.field}><span>길이</span><select aria-label="구조 이벤트 길이" value={type} onChange={(e) => setType(e.target.value)}>{types.map((t) => <option key={t}>{t}</option>)}</select></label>
      <label className={styles.field}><span>점</span><select aria-label="구조 이벤트 점" value={dots} onChange={(e) => setDots(Number(e.target.value))}>{[0, 1, 2].map((d) => <option key={d}>{d}</option>)}</select></label>
    </div>
    {kind !== "rest" ? <p><label><input aria-label="구조 이벤트 붙임줄 시작" type="checkbox" checked={start} onChange={(e) => setStart(e.target.checked)} />붙임줄 시작</label> <label><input aria-label="구조 이벤트 붙임줄 끝" type="checkbox" checked={stop} onChange={(e) => setStop(e.target.checked)} />붙임줄 끝</label></p> : null}
    {event ? <details><summary>원본에 없는 추가 표기 제거</summary>{([['articulations', '악센트·스타카토'], ['arpeggiate', '아르페지오'], ['slur', '프레이즈선']] as const).map(([name, label]) => <label key={name} style={{ display: "block" }}><input type="checkbox" aria-label={`원본에 없는 ${label} 제거`} checked={removeMarks.includes(name)} onChange={(e) => setRemoveMarks(e.target.checked ? [...removeMarks, name] : removeMarks.filter((m) => m !== name))} />원본에 없는 {label} 제거 · 붙임줄과 구별</label>)}</details> : null}
    <button type="button" disabled={!quarters(onset) || !voice || !types.includes(type) || kind === "note" && !pitch(p)} onClick={() => apply({ kind: "note", measureId: m.id, ...(event ? { eventId: event.id } : {}), ...(removeMarks.length ? { removeNotations: removeMarks } : {}), onset: quarters(onset)!, voice, value: { kind, ...(kind === "note" ? { pitch: pitch(p)! } : {}), type: type as RecoveryNoteValue["type"], dots: dots as 0 | 1 | 2, tieStart: kind !== "rest" && start, tieStop: kind !== "rest" && stop } })}>{event ? "선택 이벤트 교정 적용" : "누락 이벤트 삽입"}</button>
    {event ? <button type="button" onClick={() => apply({ kind: "remove", measureId: m.id, eventId: event.id })}>원본에 없는 선택 이벤트 제거</button> : null}
  </fieldset>;
}
function MeasureForm({ m, state, apply, disabled, attest }: { m: StructuralMeasure; state: StructuralState; disabled: boolean; apply: (edit: StructuralEdit) => void; attest: (page: number, system: number, label: string, counts: Record<string, number>, chords: number) => void }) {
  const [label, setLabel] = useState(m.label), [meter, setMeter] = useState(m.meter ? `${m.meter.numerator}/${m.meter.denominator}` : ""), [fifths, setFifths] = useState(m.fifths === undefined ? "" : String(m.fifths)), [extent, setExtent] = useState(qtext(m.extent)), [implicit, setImplicit] = useState(m.implicit);
  const [clef, setClef] = useState(m.clef);
  const [right, setRight] = useState(""), [rebase, setRebase] = useState("0"), [selected, setSelected] = useState<readonly string[]>([]);
  const [dest, setDest] = useState(m.id), [moveEvent, setMoveEvent] = useState(m.notes[0]?.id ?? ""), [moveAt, setMoveAt] = useState(""), [moveVoice, setMoveVoice] = useState("1");
  const [chordId, setChordId] = useState(""), [symbol, setSymbol] = useState(""), [chordAt, setChordAt] = useState("");
  const [page, setPage] = useState(""), [system, setSystem] = useState(""), [sourceLabel, setSourceLabel] = useState(""), [counts, setCounts] = useState(""), [chordCount, setChordCount] = useState("");
  const [uncertainty, setUncertainty] = useState("");
  const [resolution, setResolution] = useState(""), [resolved, setResolved] = useState(false);
  const view = useMemo(() => inspectStructuralMeasure(m), [m]);
  return <fieldset disabled={disabled}><legend>마디 경계·문맥·원본 대응</legend>
    <div className={styles.rangeGrid}><Field name="원본 마디 표기" value={label} onChange={setLabel} /><Field name="구조 박자" value={meter} onChange={setMeter} /><Field name="조표 fifths" value={fifths} onChange={setFifths} /><Field name="원본 실제 마디 길이" value={extent} onChange={setExtent} /></div>
    <p><label><input aria-label="짧게 표기된 마디" type="checkbox" checked={implicit} onChange={(e) => setImplicit(e.target.checked)} />원본의 못갖춘마디 또는 짧게 표기된 마디</label></p>
    <label className={styles.field}><span>원본 음자리표</span><select aria-label="원본 음자리표" value={clef} onChange={(e) => setClef(e.target.value)}><option value="">미확정</option><option value="G:2">높은음자리표</option><option value="F:4">낮은음자리표</option><option value="C:3">알토음자리표</option><option value="C:4">테너음자리표</option></select></label>
    <button type="button" disabled={!/^[1-9]\d?\/(4|8)$/u.test(meter) || !/^-?\d$/u.test(fifths) || !quarters(extent) || !label.trim() || !clef} onClick={() => { const [numerator, denominator] = meter.split("/").map(Number); apply({ kind: "context", measureId: m.id, label, numerator, denominator: denominator as 4 | 8, fifths: Number(fifths), clef, extent: quarters(extent)!, implicit }); }}>원본 마디 문맥 적용</button>
    <details><summary>확인한 경계에서 마디 분리</summary>
      <p>새 마디로 옮길 이벤트만 선택하세요. 아무 이벤트도 남지 않은 구간이면 선택 없이 경계를 복원한 뒤 누락 이벤트를 삽입합니다. 길이를 임의로 줄이거나 쉼표를 채우지 않습니다.</p>
      {[...m.notes, ...m.chords, ...m.directions].map((e, i) => <label key={e.id} style={{ display: "block" }}><input aria-label={`분리할 이벤트 ${i + 1}`} type="checkbox" checked={selected.includes(e.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, e.id] : selected.filter((id) => id !== e.id))} />{i + 1} · {e.node.name} · onset {qtext(e.onset)}</label>)}
      <Field name="분리 후 오른쪽 마디 표기" value={right} onChange={setRight} /><Field name="이동 이벤트 onset에서 뺄 박수" value={rebase} onChange={setRebase} />
      <button type="button" disabled={!right.trim() || !quarters(rebase)} onClick={() => apply({ kind: "split", measureId: m.id, rightEventIds: selected, rebase: quarters(rebase)!, rightLabel: right })}>확인한 마디 경계 분리</button>
    </details>
    <details><summary>이벤트의 마디·성부 이동</summary>
      <label className={styles.field}><span>이동할 이벤트</span><select aria-label="이동할 이벤트" value={moveEvent} onChange={(e) => setMoveEvent(e.target.value)}>{m.notes.map((n, i) => <option key={n.id} value={n.id}>음표/쉼표/슬래시 {i + 1}</option>)}{m.chords.map((n, i) => <option key={n.id} value={n.id}>코드 {i + 1}</option>)}</select></label>
      <label className={styles.field}><span>대상 마디</span><select aria-label="이동 대상 마디" value={dest} onChange={(e) => setDest(e.target.value)}>{state.measures.map((n, i) => <option key={n.id} value={n.id}>{i + 1} · {n.label}</option>)}</select></label>
      <Field name="이동 후 onset" value={moveAt} onChange={setMoveAt} /><Field name="이동 후 성부" value={moveVoice} onChange={setMoveVoice} />
      <button type="button" disabled={!moveEvent || !quarters(moveAt) || !moveVoice} onClick={() => apply({ kind: "move", measureId: m.id, eventId: moveEvent, destinationId: dest, onset: quarters(moveAt)!, voice: moveVoice })}>이벤트 위치 이동</button>
    </details>
    <details><summary>누락 코드·코드 위치 교정</summary>
      <p>{view.chords.map((c, i) => `${i + 1}: ${c.text}@${c.onset}`).join(" · ") || "인식 코드 없음"}</p>
      <label className={styles.field}><span>코드 선택</span><select aria-label="구조 코드 선택" value={chordId} onChange={(e) => setChordId(e.target.value)}><option value="">누락 코드 삽입</option>{m.chords.map((c, i) => <option key={c.id} value={c.id}>코드 {i + 1}</option>)}</select></label>
      <Field name="구조 코드 심벌" value={symbol} onChange={setSymbol} /><Field name="구조 코드 onset" value={chordAt} onChange={setChordAt} />
      <button type="button" disabled={!symbol.trim() || !quarters(chordAt)} onClick={() => apply({ kind: "chord", measureId: m.id, ...(chordId ? { eventId: chordId } : {}), symbol, onset: quarters(chordAt)! })}>코드 교정 적용</button>
      {chordId ? <button type="button" onClick={() => apply({ kind: "remove", measureId: m.id, eventId: chordId })}>원본에 없는 코드 제거</button> : null}
    </details>
    <details><summary>미확정 표기 보존</summary><p>의미가 불명확한 곡선 등을 기록하면 Source 확정이 차단됩니다. pitch·붙임줄 등으로 임의 변환하지 않습니다.</p><Field name="미확정 원본 표기" value={uncertainty} onChange={setUncertainty} /><button type="button" disabled={!uncertainty.trim()} onClick={() => apply({ kind: "uncertainty", measureId: m.id, detail: uncertainty })}>미확정 표기 기록</button>
      {state.uncertainties[m.id] ? <div><p>남은 사항: {state.uncertainties[m.id]}</p><Field name="확인된 원본 의미와 처리 근거" value={resolution} onChange={setResolution} /><label><input type="checkbox" checked={resolved} onChange={(e) => setResolved(e.target.checked)} />원본 근거를 확보했고 필요한 음악 교정을 완료했습니다.</label><button type="button" disabled={!resolved || !resolution.trim()} onClick={() => apply({ kind: "resolve-uncertainty", measureId: m.id, detail: resolution })}>근거와 함께 미확정 사항 해결 기록</button><p>원래 기록과 해결 근거를 모두 보존하고 전체 원본 대조를 다시 요구합니다.</p></div> : null}
    </details>
    <details><summary>이 revision의 원본 전체 대조 확인</summary>
      <p>원본의 음높이·리듬·성부·코드·연결을 직접 대조한 뒤 원본에서 센 개수를 입력하세요. 이후 어떤 교정이든 전체 확인을 무효화합니다.</p>
      <div className={styles.rangeGrid}><Field name="대응 원본 페이지" value={page} onChange={setPage} /><Field name="대응 원본 시스템" value={system} onChange={setSystem} /><Field name="대응 원본 표기 마디" value={sourceLabel} onChange={setSourceLabel} /><Field name="원본 성부별 이벤트 수" value={counts} onChange={setCounts} /><Field name="원본 코드 수" value={chordCount} onChange={setChordCount} /></div>
      <p>성부별 개수 예: 1:8,2:4. 음표·쉼표·리듬 슬래시를 모두 셉니다.</p>
      <button type="button" disabled={!page || !system || !sourceLabel || !counts || !/^\d+$/u.test(chordCount)} onClick={() => {
        const entries = counts.split(",").map((s) => s.trim().split(":"));
        if (entries.some(([v, n]) => !v || !/^\d+$/u.test(n ?? "")) || new Set(entries.map(([v]) => v)).size !== entries.length) return;
        attest(Number(page), Number(system), sourceLabel, Object.fromEntries(entries.map(([v, n]) => [v, Number(n)])), Number(chordCount));
      }}>이 마디의 원본 음악 대조 확인</button>
    </details>
  </fieldset>;
}
function RecoveryHistory({ workspace }: { workspace: StructuralRecovery }) {
  const [open, setOpen] = useState(false), [page, setPage] = useState(0);
  const count = workspace.operations.length, pageCount = Math.max(1, Math.ceil(count / 20));
  const current = Math.min(page, pageCount - 1);
  return <details onToggle={(e) => setOpen(e.currentTarget.open)}><summary>원본과 구조 교정 이력</summary>
    {open ? <div><p>기존 교정 {workspace.documents.reduce((n, d) => n + d.recovery.operations.length, 0)}건 · 구조 교정 {count}건을 모두 보존합니다.</p>
      <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)}>이전 이력</button><span>{current + 1} / {pageCount}</span><button type="button" disabled={current + 1 >= pageCount} onClick={() => setPage(current + 1)}>다음 이력</button>
      <ol start={current * 20 + 1}>{workspace.operations.slice(current * 20, current * 20 + 20).map((o) => <li key={o.id}>{o.edit.kind} · {o.sourceLocation}<pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(o, null, 2)}</pre></li>)}</ol>
    </div> : null}
  </details>;
}
export function StructuralRecoveryEditor({ retained, onInvalidate, onValidate }: { retained: readonly StoredImportRecovery[]; onInvalidate: () => void; onValidate: (candidate: { xml: string; proof: string }) => Promise<void> }) {
  const [entry, setEntry] = useState<StoredStructuralRecovery>(), [saved, setSaved] = useState<readonly StoredStructuralRecovery[]>([]), [state, setState] = useState<StructuralState>(), [digest, setDigest] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [source, setSource] = useState(""), [measureId, setMeasureId] = useState(""), [eventId, setEventId] = useState("");
  const [files, setFiles] = useState<readonly File[]>([]), [original, setOriginal] = useState<File>(), [selected, setSelected] = useState<readonly string[]>([]), [issues, setIssues] = useState<readonly string[]>([]), [overfull, setOverfull] = useState<number>();
  const [joinAt, setJoinAt] = useState(0), [voiceMap, setVoiceMap] = useState(""), [role, setRole] = useState("");
  const [inventory, setInventory] = useState("");
  const pageRef = useRef<HTMLImageElement>(null);
  useEffect(() => { let active = true; void loadStructuralRecoveries().then((rows) => { if (active) { setSaved(rows); setEntry(rows[0]); } }).catch(() => { if (active) setError("구조 교정 저장소의 무결성을 확인하지 못했습니다."); }); return () => { active = false; }; }, []);
  useEffect(() => { let active = true; if (entry) void replayStructuralRecovery(entry.workspace).then(async (next) => { const d = await structuralDigest(next); if (active) { setState(next); setDigest(d); } }).catch((e: unknown) => { if (active) setError(String(e)); }); return () => { active = false; }; }, [entry]);
  useEffect(() => { const p = entry?.pages[0]; if (!p) return; const url = URL.createObjectURL(p.blob); if (pageRef.current) pageRef.current.src = url; return () => URL.revokeObjectURL(url); }, [entry?.pages]);
  const current = state?.measures.find((m) => m.id === measureId) ?? state?.measures[0];
  const eventOptions = useMemo(() => current?.notes.map((event, index) => ({ id: event.id, ordinal: index + 1, note: inspectStructuralNote(current, event) })) ?? [], [current]);
  const restoring = Boolean(entry && (entry.workspace.operations.at(-1)?.afterDigest ? entry.workspace.operations.at(-1)?.afterDigest !== digest : !state));
  const task = async (run: () => Promise<void>) => { if (busy) return; setBusy(true); setError(""); try { await run(); } catch (e) { setError(e instanceof Error ? e.message : "교정 저장 오류"); } finally { setBusy(false); } };
  const save = async (workspace: StructuralRecovery) => {
    if (!entry) return; onInvalidate(); setIssues([]); setOverfull(undefined);
    const next = { ...entry, workspace, storageRevision: entry.storageRevision + 1, updatedAt: new Date().toISOString() };
    await saveStructuralRecovery(next, entry.storageRevision); const s = await replayStructuralRecovery(workspace);
    setState(s); setDigest(await structuralDigest(s)); setEntry(next); setSaved((rs) => rs.map((r) => r.id === next.id ? next : r));
  };
  const apply = (edit: StructuralEdit) => { void task(async () => { if (entry) await save(await applyStructuralEdit(entry.workspace, digest, edit, source, crypto.randomUUID(), new Date().toISOString())); }); };
  const create = () => task(async () => {
    const chosen = selected.map((id) => retained.find((r) => r.id === id)!);
    const docs: StructuralRecovery["documents"][number][] = chosen.map((r) => ({ id: r.id, recovery: r.recovery, ...(r.incompleteReason ? { failureReason: r.incompleteReason } : {}) }));
    for (const file of files) docs.push({ id: crypto.randomUUID(), recovery: await createImportRecovery(new Uint8Array(await file.arrayBuffer()), file.name), failureReason: "사용자가 보존한 인식 출력 · 전곡 구조 미확정" });
    const id = crypto.randomUUID(), workspace = await createStructuralRecovery(id, docs);
    let pages = chosen[0]?.pages ?? [];
    if (chosen.some((r) => r.pages.length !== pages.length || r.pages.some((p, i) => p.rawDigest !== pages[i]?.rawDigest))) throw new RangeError("RECOVERY_ORIGINAL_PAGES_DIFFER");
    if (original) { if (pages.length) throw new RangeError("RECOVERY_ORIGINAL_PAGES_ALREADY_BOUND"); const rawDigest = await binaryDigest(new Uint8Array(await original.arrayBuffer())); pages = [{ pageIndex: 0, rawDigest, canonicalPageDigest: rawDigest, mimeType: original.type as "image/jpeg" | "image/png", blob: original }]; }
    if (!pages.length) throw new RangeError("RECOVERY_ORIGINAL_IMAGE_REQUIRED");
    const next = { id, workspace, pages, storageRevision: 0, updatedAt: new Date().toISOString() };
    await saveStructuralRecovery(next); onInvalidate(); setState(await replayStructuralRecovery(workspace)); setDigest(await structuralDigest(await replayStructuralRecovery(workspace))); setEntry(next); setSaved((rs) => [next, ...rs]); setMeasureId(""); setEventId("");
  });
  return <section className={styles.subpanel} aria-labelledby="structural-heading"><h2 id="structural-heading">전곡 구조 복구 · 보존된 인식 결과</h2>
    <p>이미 회수한 출력에서 이어갑니다. 원본 출력과 기존 교정을 복사해 보존하며 OMR을 다시 호출하지 않습니다. 모든 조각 연결과 원본 대조를 마친 revision만 전체 재검증할 수 있습니다.</p>
    <details><summary>구조 복구 작업 만들기</summary>
      <p>조각을 원본 순서대로 선택하세요. 선택 순서: {selected.map((id) => retained.find((r) => r.id === id)?.recovery.originalFileName).join(" → ")}</p>
      {retained.map((r) => <label key={r.id} style={{ display: "block" }}><input type="checkbox" checked={selected.includes(r.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, r.id] : selected.filter((id) => id !== r.id))} />{r.recovery.originalFileName} · 기존 교정 {r.recovery.operations.length}건</label>)}
      <label className={styles.field}><span>보존한 인식 조각 파일 · 원본 순서</span><input aria-label="보존한 인식 조각 파일" type="file" multiple accept=".musicxml,.xml,.mxl" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} /></label>
      <p>{files.map((f) => f.name).join(" → ")}</p>
      <label className={styles.field}><span>대조할 원본 이미지 (파일로 복구할 때)</span><input aria-label="구조 복구 원본 이미지" type="file" accept="image/png,image/jpeg" onChange={(e) => setOriginal(e.target.files?.[0])} /></label>
      <button type="button" disabled={busy || !selected.length && !files.length} onClick={() => void create()}>원본을 보존하고 구조 복구 시작</button>
    </details>
    <details><summary>보존한 구조 교정 묶음 열기</summary><p>이 앱에서 보존한 원본·교정 이력을 별도 사본으로 엽니다. 기존 작업은 유지하며, Source 검증은 다시 수행합니다.</p><input aria-label="구조 교정 묶음 열기" type="file" accept="application/json,.json" disabled={busy} onChange={(e) => { const file = e.target.files?.[0]; if (file) void task(async () => { const next = await importStructuralBundle(file); onInvalidate(); setState(undefined); setDigest(""); setEntry(next); setSaved((rs) => [next, ...rs]); setMeasureId(""); setEventId(""); setIssues([]); }); }} /></details>
    {saved.length ? <label className={styles.field}><span>저장된 구조 복구</span><select aria-label="저장된 구조 복구" value={entry?.id ?? ""} disabled={busy} onChange={(e) => { onInvalidate(); setState(undefined); setDigest(""); setEntry(saved.find((r) => r.id === e.target.value)); setMeasureId(""); setEventId(""); setIssues([]); }}>{saved.map((r) => <option value={r.id} key={r.id}>{r.workspace.documents.map((d) => d.recovery.originalFileName).join(" + ")} · {r.workspace.operations.length}건</option>)}</select></label> : null}
    {entry ? <div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={pageRef} alt="구조 복구 대조 원본" style={{ maxWidth: "100%", height: "auto" }} />
      <p>원본 문서 {entry.workspace.documents.length}개 · 후보 마디 {state?.measures.length ?? "복구 중"}개 · 명시적 구조 교정 {entry.workspace.operations.length}건 · 이 revision 원본 확인 {entry.workspace.coverage.length}개</p>
      <Field name="구조 교정 원본 위치" value={source} onChange={setSource} />
      <details><summary>원본 전곡의 시스템·마디 목록</summary><p>인식 결과 개수와 별개로 원본의 표기 순서를 입력하세요. 한 줄에 페이지/시스템:마디표기,마디표기 형식입니다. 못갖춘마디도 포함하며 반복 재생 순서와 구별합니다.</p>
        <label className={styles.field}><span>원본 전체 표기 순서</span><textarea aria-label="원본 전체 표기 순서" value={inventory} maxLength={8192} onChange={(e) => setInventory(e.target.value)} placeholder="1/1:pickup,A,B&#10;1/2:C,D" /></label>
        <button type="button" disabled={busy || restoring || !source.trim() || !inventory.trim()} onClick={() => { const rows = inventory.split(/\r?\n/u).filter((s) => s.trim()); const parsed = rows.map((row) => /^(\d+)\/(\d+):(.+)$/u.exec(row.trim())); if (parsed.some((r) => !r)) { setError("원본 목록 형식을 확인하세요: 페이지/시스템:마디표기,마디표기"); return; } apply({ kind: "inventory", systems: parsed.map((r) => ({ page: Number(r![1]), system: Number(r![2]), labels: r![3].split(",").map((s) => s.trim()) })) }); }}>원본 전곡 목록 기록</button>
      </details>
      <fieldset disabled={busy || restoring}><legend>조각 연결 확인</legend>
        <label className={styles.field}><span>연결 경계</span><select aria-label="조각 연결 경계" value={joinAt} onChange={(e) => setJoinAt(Number(e.target.value))}>{entry.workspace.documents.slice(1).map((d, i) => <option value={i} key={d.id}>{i + 1} → {i + 2}: {d.recovery.originalFileName}</option>)}</select></label>
        <Field name="연결할 파트의 원본 역할" value={role} onChange={setRole} /><Field name="오른쪽 조각 성부 대응" value={voiceMap} onChange={setVoiceMap} /><p>성부 대응 예: 1:1,2:2. 각 조각의 박자·조표를 먼저 원본대로 교정하세요. 경계를 넘는 붙임줄은 전체 검증에서 검사합니다.</p>
        <button type="button" disabled={!source.trim() || !role.trim() || !voiceMap || entry.workspace.documents.length < 2} onClick={() => { const entries = voiceMap.split(",").map((s) => s.trim().split(":")); if (entries.some((e) => e.length !== 2) || new Set(entries.map(([a]) => a)).size !== entries.length) return; apply({ kind: "join", leftDocumentId: entry.workspace.documents[joinAt].id, rightDocumentId: entry.workspace.documents[joinAt + 1].id, partRole: role, voiceMap: Object.fromEntries(entries) }); }}>원본 순서와 파트·성부 연결 적용</button>
      </fieldset>
      {state && current && !restoring ? <div>
        <label className={styles.field}><span>구조 복구 마디</span><select aria-label="구조 복구 마디" value={current.id} disabled={busy} onChange={(e) => { setMeasureId(e.target.value); setEventId(""); }}>{state.measures.map((m, i) => <option key={m.id} value={m.id}>{i + 1} · 후보 표기 {m.label} · {m.notes.length} 이벤트</option>)}</select></label>
        <details><summary>인식 출력의 원래 위치</summary><p style={{ overflowWrap: "anywhere" }}>{current.origin}</p></details>
        <label className={styles.field}><span>이벤트 선택</span><select aria-label="구조 복구 이벤트" value={current.notes.some((e) => e.id === eventId) ? eventId : ""} disabled={busy} onChange={(e) => setEventId(e.target.value)}><option value="">누락 이벤트 새로 삽입</option>{eventOptions.map(({ id, ordinal, note: n }) => <option key={id} value={id}>{ordinal} · {n.kind} {pitchText(n.pitch)} · voice {n.voice} · onset {n.onset} / 길이 {n.duration}</option>)}</select></label>
        <NoteForm key={`${digest}:${current.id}:${eventId}`} m={current} eventId={eventId} apply={apply} disabled={busy || !source.trim()} />
        <MeasureForm key={`${digest}:${current.id}`} m={current} state={state} disabled={busy || !source.trim()} apply={apply} attest={(page, system, printedLabel, voiceCounts, chordCount) => { void task(async () => save(await attestStructuralMeasure(entry.workspace, { measureId: current.id, page, system, printedLabel, voiceCounts, chordCount, sourceLocation: source, revisionDigest: digest }))); }} />
      </div> : <p role="status">구조 교정 이력을 복구하고 있습니다.</p>}
      <div className={styles.presetRow}>
        <button type="button" disabled={busy || restoring || !entry.workspace.operations.length} onClick={() => void task(() => save(undoStructuralEdit(entry.workspace)))}>구조 교정 취소</button>
        <button type="button" disabled={busy || restoring || !entry.workspace.redo.length} onClick={() => void task(async () => save(await redoStructuralEdit(entry.workspace)))}>구조 교정 재적용</button>
        <button type="button" disabled={busy || restoring} onClick={() => void task(async () => {
          const result = await validateStructuralRecovery(entry.workspace); setIssues(result.issues); setOverfull(result.overfull);
          if (!result.issues.length) {
            if (!entry.pages.length) throw new RangeError("RECOVERY_ORIGINAL_IMAGE_REQUIRED");
            const candidate = await verifiedStructuralCandidate(entry.workspace);
            await onValidate({ ...candidate, proof: JSON.stringify({ ...JSON.parse(candidate.proof), originalPages: entry.pages.map(({ pageIndex, rawDigest, canonicalPageDigest }) => ({ pageIndex, rawDigest, canonicalPageDigest })) }) });
          }
        })}>전곡 구조·이벤트 전체 재검증</button>
        <button type="button" disabled={busy || restoring} onClick={() => void task(async () => { const value = await exportStructuralBundle(entry); const url = URL.createObjectURL(new Blob([value], { type: "application/json" })); const a = document.createElement("a"); a.href = url; a.download = "harmonymaker-recovery.json"; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); })}>원본·교정 이력 묶음 보존</button>
      </div>
      {overfull !== undefined ? <p>현재 후보 overfull {overfull}개 · 원시 출력의 진단은 원본 문서에 별도 보존됩니다.</p> : null}
      {issues.length ? <details open><summary>Source 확정 전 남은 검증 {issues.length}개</summary><ul>{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></details> : null}
      <RecoveryHistory key={entry.id} workspace={entry.workspace} />
    </div> : null}
    <p role="status">{error || (busy ? "구조 교정을 검증·저장 중입니다." : "구조 교정은 별도 후보로 브라우저에 보존됩니다.")}</p>
  </section>;
}
