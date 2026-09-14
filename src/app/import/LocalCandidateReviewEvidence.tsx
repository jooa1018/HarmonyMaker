"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { localCandidateEvidence, localCandidateImageBytes, localCandidateReviewSummary, type CandidateRecord, type LocalCandidateBundle } from "../../domain/omr/local-candidate";
import styles from "./import.module.css";

/** Read-only trace viewer; selecting a region never accepts or edits a hypothesis. */
export function LocalCandidateReviewEvidence({ bundle }: { readonly bundle: LocalCandidateBundle }) {
  const [filter, setFilter] = useState("unresolved"), [index, setIndex] = useState(0);
  const imageRef = useRef<SVGImageElement>(null), linkRef = useRef<HTMLAnchorElement>(null);
  const data = useMemo(() => {
    const e = localCandidateEvidence(bundle);
    const links = JSON.parse(bundle.artifacts.links.text);
    const rows: { id: string; category: string; record: CandidateRecord }[] = [
      ...e.candidates.map((record, i) => ({ id: `보완 ${i + 1} · ${record.feature} · ${record.status}`, category: record.status === "applied-candidate" ? "supplement" : "unresolved", record })),
      ...e.changes.map((record, i) => ({ id: `자동 변경 ${i + 1} · ${record.feature}`, category: "change", record })),
      ...Object.entries(links.events as Record<string, CandidateRecord>).map(([id, record]) => ({ id: `${id} · ${record.status}`, category: record.status === "physical-candidate" ? "event" : "unresolved", record })),
      ...links.measures.map((record: CandidateRecord & { measure: { id: string } }) => ({ id: `${record.measure.id} · ${record.status}`, category: record.status === "physical-candidate" ? "measure" : "unresolved", record })),
    ];
    const timeline = e.candidates.filter((r) => ["hm-automatic-timeline-v1", "hm-automatic-timeline-v1.1"].includes(String(r.ruleVersion)));
    return { e, rows, timeline };
  }, [bundle]);
  const rows = filter === "all" ? data.rows : data.rows.filter((r) => r.category === filter);
  const row = rows[Math.min(index, Math.max(0, rows.length - 1))];
  const box = row?.record.sourceBox ?? row?.record.box;
  const viewBox = box ? `${Math.max(0, box[0] - 30)} ${Math.max(0, box[1] - 45)} ${box[2] - box[0] + 60} ${box[3] - box[1] + 90}` : `0 0 ${bundle.image.width} ${bundle.image.height}`;
  useEffect(() => {
    const url = URL.createObjectURL(new Blob([localCandidateImageBytes(bundle).slice().buffer as ArrayBuffer], { type: bundle.image.mimeType }));
    imageRef.current?.setAttribute("href", url);
    if (linkRef.current) linkRef.current.href = url;
    return () => URL.revokeObjectURL(url);
  }, [bundle]);
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(bundle)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = "local-candidate.original-bundle.json"; a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <details className={styles.subpanel} open>
    <summary>로컬 후보 원본·추적 근거·미확정</summary>
    <p>전달 무결성 확인됨 · 최초 자동 후보의 음악 보존 미확정 · Source 미승인</p>
    <p>{localCandidateReviewSummary(bundle)}</p>
    {data.timeline.length ? <p data-testid="timeline-candidate-summary">자동 시간축 후보 v1 · 적용 {data.timeline.filter(r => r.status === "applied-candidate").length}건 · 보류 {data.timeline.filter(r => r.status === "unresolved").length}건. 박자·못갖춘 길이 후보는 원본 대조가 필요하며 사람의 확인을 대신하지 않습니다. 이전 단계의 미확정 기록도 보존합니다. 아래 ‘자동 변경’에서 변경 전후 값과 근거를 확인하세요.</p> : null}
    <p>아래 번호와 연결은 최초 자동 후보의 식별자입니다. 교정 뒤 위치와 같다고 가정하지 마세요. attention 추정값은 확정 원본 좌표가 아닙니다.</p>
    <label className={styles.field}><span>추적 항목 종류</span><select aria-label="추적 항목 종류" value={filter} onChange={(e) => { setFilter(e.target.value); setIndex(0); }}>
      <option value="unresolved">미확정</option><option value="change">자동 변경</option><option value="supplement">보완 후보</option><option value="event">이벤트 연결 후보</option><option value="measure">마디 연결 후보</option><option value="all">전체 근거</option>
    </select></label>
    <label className={styles.field}><span>원본 대조 근거 · {rows.length}개</span><select aria-label="원본 대조 근거" value={Math.min(index, Math.max(0, rows.length - 1))} onChange={(e) => setIndex(Number(e.target.value))}>
      {rows.map((r, i) => <option key={r.id} value={i}>{r.id}</option>)}
    </select></label>
    <a ref={linkRef} target="_blank" rel="noreferrer">대조 원본 전체 열기</a>
    <p>{box ? "원본 이미지의 후보 영역 · 확정 연결이 아닙니다." : "이 항목은 대응 원본 영역도 미확정입니다. 전체 원본으로 대조하세요."}</p>
    <svg role="img" aria-label="선택한 근거의 원본 영역" viewBox={viewBox} style={{ width: "100%", maxHeight: 260, border: "1px solid #aeb6c7" }}>
      <image ref={imageRef} width={bundle.image.width} height={bundle.image.height} />
      {box ? <rect x={box[0]} y={box[1]} width={box[2] - box[0]} height={box[3] - box[1]} stroke="#d11" strokeWidth="1" fill="none" /> : null}
    </svg>
    <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 300, overflow: "auto" }}>{row ? JSON.stringify(row.record, null, 2) : "해당 항목 없음 · 전곡 검증 완료를 뜻하지 않습니다."}</pre>
    <details><summary>전체 미확정과 처리 한계</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify({ sourceEligibility: data.e.sourceEligibility, unresolvedEventLinks: data.e.unresolvedEventLinks, unresolvedMeasureLinks: data.e.unresolvedMeasureLinks, limitations: data.e.limitations }, null, 2)}</pre></details>
    <button type="button" onClick={download}>최초 후보·원본·근거 묶음 보존</button>
  </details>;
}
