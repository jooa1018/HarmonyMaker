"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from "react";
import { useRouter } from "next/navigation";

import { binaryDigest, type BinaryDigest } from "../../domain/digest/canonical";
import { storeOmrImportHandoff } from "../../domain/omr/browser-handoff";
import { rasterizePdfPages } from "../../domain/omr/browser-raster";
import type { OmrProviderResult, OmrPublicStatus, VendorInputRequest } from "../../domain/omr/contracts";
import { analyzeImageQuality, type ImageQualityReport } from "../../domain/omr/image-quality";
import { classifyInputSource, type InputSourceKind } from "../../domain/omr/input";
import { referenceOmrPageBytes } from "../../domain/omr/reference-fixture-data";
import type { OmrEvidence } from "../../domain/omr/foundation";
import styles from "./omr.module.css";

interface PreparedPage {
  readonly key: string;
  readonly bytes: Uint8Array;
  readonly mimeType: "image/png" | "image/jpeg";
  readonly digest: BinaryDigest;
  readonly previewUrl: string;
  readonly width: number;
  readonly height: number;
  readonly quality: ImageQualityReport;
}

interface ApiErrorBody { readonly error?: { readonly messageKo?: string; readonly code?: string } }

const statusLabels: Readonly<Record<OmrPublicStatus["kind"], string>> = {
  created: "작업 생성됨", uploading: "페이지 업로드 중", queued: "대기 중", processing: "인식 중",
  "needs-input": "추가 입력 필요", completed: "인식 완료", failed: "인식 실패", cancelled: "취소됨",
};

function inferredMime(file: File): string {
  if (file.type) return file.type;
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".mxl")) return "application/vnd.recordare.musicxml";
  if (lower.endsWith(".musicxml") || lower.endsWith(".xml")) return "application/vnd.recordare.musicxml+xml";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

async function prepareImage(bytes: Uint8Array, mimeType: "image/png" | "image/jpeg"): Promise<PreparedPage> {
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: mimeType });
  const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image", premultiplyAlpha: "none", colorSpaceConversion: "default" });
  try {
    const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(8, Math.round(bitmap.width * scale));
    const height = Math.max(8, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true, colorSpace: "srgb" });
    if (!context) throw new RangeError("OMR_IMAGE_DECODE_FAILED");
    context.fillStyle = "#ffffff"; context.fillRect(0, 0, width, height); context.drawImage(bitmap, 0, 0, width, height);
    const rgba = context.getImageData(0, 0, width, height).data;
    const luma = new Uint8Array(width * height);
    for (let index = 0; index < luma.length; index += 1) {
      const offset = index * 4;
      luma[index] = Math.round(rgba[offset] * 0.2126 + rgba[offset + 1] * 0.7152 + rgba[offset + 2] * 0.0722);
    }
    return { key: crypto.randomUUID(), bytes, mimeType, digest: await binaryDigest(bytes), previewUrl: URL.createObjectURL(blob), width: bitmap.width, height: bitmap.height, quality: analyzeImageQuality({ width, height, luma }) };
  } finally { bitmap.close(); }
}

async function json<T>(response: Response): Promise<T> {
  const body = await response.json() as T & ApiErrorBody;
  if (!response.ok) throw new Error(body.error?.messageKo ?? body.error?.code ?? `HTTP ${response.status}`);
  return body;
}

function evidenceStyle(evidence: OmrEvidence): CSSProperties {
  return {
    left: `${Number(evidence.box.xMu) / 10_000}%`, top: `${Number(evidence.box.yMu) / 10_000}%`,
    width: `${Number(evidence.box.widthMu) / 10_000}%`, height: `${Number(evidence.box.heightMu) / 10_000}%`,
  };
}

export function OmrClient() {
  const router = useRouter();
  const [pages, setPages] = useState<readonly PreparedPage[]>([]);
  const pagesRef = useRef(pages);
  const [sourceKind, setSourceKind] = useState<InputSourceKind>("camera-photo");
  const [pdfConfirmation, setPdfConfirmation] = useState(false);
  const [rights, setRights] = useState(false);
  const [transfer, setTransfer] = useState(false);
  const [warnAccepted, setWarnAccepted] = useState(false);
  const [duplicatesAccepted, setDuplicatesAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("사진(PNG/JPEG) 또는 PDF를 선택하세요. MusicXML/MXL은 인식 없이 정본 importer로 전달됩니다.");
  const [error, setError] = useState<string>();
  const [csrf, setCsrf] = useState<string>();
  const [handle, setHandle] = useState<string>();
  const [status, setStatus] = useState<OmrPublicStatus>();
  const [result, setResult] = useState<OmrProviderResult>();

  useEffect(() => { pagesRef.current = pages; }, [pages]);
  useEffect(() => () => { for (const page of pagesRef.current) URL.revokeObjectURL(page.previewUrl); }, []);

  const replacePages = useCallback((next: readonly PreparedPage[]) => {
    for (const page of pagesRef.current) URL.revokeObjectURL(page.previewUrl);
    pagesRef.current = next; setPages(next); setHandle(undefined); setStatus(undefined); setResult(undefined);
  }, []);

  const selectFile = useCallback(async (file: File) => {
    setBusy(true); setError(undefined); setMessage(`${file.name} 형식과 서명을 검사하는 중…`);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const mimeType = inferredMime(file);
      const classification = await classifyInputSource({ bytes, declaredMimeType: mimeType, originalFileName: file.name });
      if (classification.detectedKind === "musicxml" || classification.detectedKind === "mxl") {
        await storeOmrImportHandoff({ fileName: file.name, mimeType, bytes });
        router.push("/import");
        return;
      }
      if (classification.detectedKind === "pdf") {
        setMessage("PDF.js 고정 정책으로 페이지를 래스터화하는 중…");
        const raster = await rasterizePdfPages({ bytes, maxPages: 12 });
        const prepared = await Promise.all(raster.pages.map((page) => prepareImage(page.bytes, page.mimeType)));
        replacePages(prepared);
        if (raster.classification.suggestedKind) {
          setSourceKind(raster.classification.suggestedKind); setPdfConfirmation(false);
          setMessage(`${raster.probe.pageCount}쪽 PDF 준비 완료 · ${raster.classification.suggestedKind === "digital-pdf" ? "디지털 PDF" : "스캔 PDF"}로 안전 분류됨`);
        } else {
          setSourceKind("scanned-pdf"); setPdfConfirmation(true);
          setMessage(`${raster.probe.pageCount}쪽 PDF 준비 완료 · 디지털/스캔 유형을 직접 확인하세요.`);
        }
      } else {
        replacePages([await prepareImage(bytes, classification.mimeType as "image/png" | "image/jpeg")]);
        setSourceKind("camera-photo"); setPdfConfirmation(false); setMessage("사진 1쪽의 해상도·흐림·원근·반사·잘림 검사를 완료했습니다.");
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "입력을 준비하지 못했습니다."); }
    finally { setBusy(false); }
  }, [replacePages, router]);

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void selectFile(file);
    event.target.value = "";
  };

  const loadReference = async () => {
    setBusy(true); setError(undefined);
    try {
      replacePages([await prepareImage(referenceOmrPageBytes(), "image/png")]);
      setSourceKind("camera-photo"); setPdfConfirmation(false);
      setMessage("내장 결정적 reference fixture 1쪽을 준비했습니다. 실제 제공자 정확도 증거로 사용할 수 없습니다.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "reference fixture를 읽지 못했습니다."); }
    finally { setBusy(false); }
  };

  const duplicate = useMemo(() => new Set(pages.map((page) => page.digest)).size !== pages.length, [pages]);
  const hasWarning = pages.some((page) => page.quality.status === "warn");
  const hasRetake = pages.some((page) => page.quality.status === "retake");
  const ready = pages.length > 0 && !hasRetake && rights && transfer && (!hasWarning || warnAccepted) && (!duplicate || duplicatesAccepted) && !pdfConfirmation;

  const mutate = useCallback(async (url: string, method: "POST" | "DELETE", body?: unknown) => {
    if (!csrf) throw new Error("세션 CSRF 토큰이 없습니다.");
    return fetch(url, { method, headers: { "x-csrf-token": csrf, ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }, [csrf]);

  const poll = useCallback(async (jobHandle: string) => {
    for (let attempt = 0; attempt < 90; attempt += 1) {
      const response = await json<{ readonly status: OmrPublicStatus }>(await fetch(`/api/omr/jobs/${encodeURIComponent(jobHandle)}`, { cache: "no-store" }));
      setStatus(response.status);
      if (["completed", "failed", "cancelled", "needs-input"].includes(response.status.kind)) {
        if (response.status.kind === "completed") {
          const exported = await json<{ readonly result: OmrProviderResult }>(await fetch(`/api/omr/jobs/${encodeURIComponent(jobHandle)}/result`, { cache: "no-store" }));
          setResult(exported.result);
        }
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
    throw new Error("인식 상태 확인 시간이 초과되었습니다. handle로 다시 조회할 수 있습니다.");
  }, []);

  const start = async () => {
    if (!ready) return;
    setBusy(true); setError(undefined); setResult(undefined);
    try {
      let csrfToken = csrf;
      if (!csrfToken) {
        const session = await json<{ readonly csrfToken: string }>(await fetch("/api/session", { method: "POST" }));
        csrfToken = session.csrfToken; setCsrf(csrfToken);
      }
      const headers = { "content-type": "application/json", "x-csrf-token": csrfToken };
      const created = await json<{ readonly handle: string }>(await fetch("/api/omr/jobs", { method: "POST", headers, body: JSON.stringify({ pageCount: pages.length, sourceKind, rights: { basis: "user-confirmed-rights", allowedUses: ["generation", "provider-transfer"], confirmedAt: new Date().toISOString() }, providerTransferConsent: true, idempotencyKey: crypto.randomUUID() }) }));
      setHandle(created.handle); setStatus({ kind: "created" });
      for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
        const page = pages[pageIndex];
        setStatus({ kind: "uploading", uploadedPages: pageIndex, totalPages: pages.length });
        await json(await fetch(`/api/omr/jobs/${encodeURIComponent(created.handle)}/pages/${pageIndex}`, {
          method: "PUT", headers: { "content-type": page.mimeType, "x-csrf-token": csrfToken, "x-page-digest": page.digest, "x-idempotency-key": `${created.handle}:${pageIndex}`, "x-quality-warning-acknowledged": String(warnAccepted), "x-duplicate-page-confirmed": String(duplicatesAccepted) }, body: page.bytes.slice().buffer as ArrayBuffer,
        }));
      }
      await json(await fetch(`/api/omr/jobs/${encodeURIComponent(created.handle)}/start`, { method: "POST", headers: { "x-csrf-token": csrfToken } }));
      await poll(created.handle);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "OMR 작업을 시작하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const submitInput = async (request: VendorInputRequest, choice: string) => {
    if (!handle) return;
    setBusy(true); setError(undefined);
    try {
      const response = request.kind === "select-instrument"
        ? { kind: request.kind, requestId: request.requestId, choice }
        : request.kind === "confirm-page-order"
          ? { kind: request.kind, requestId: request.requestId, pageIndices: request.pageIndices }
          : { kind: request.kind, requestId: request.requestId, schemaId: request.schemaId, payload: request.payload };
      await json(await mutate(`/api/omr/jobs/${encodeURIComponent(handle)}/input`, "POST", response));
      await poll(handle);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "추가 입력을 제출하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const cancel = async () => {
    if (!handle) return;
    setBusy(true); setError(undefined);
    try { await json(await mutate(`/api/omr/jobs/${encodeURIComponent(handle)}/cancel`, "POST")); setStatus({ kind: "cancelled" }); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "취소하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!handle) return;
    setBusy(true); setError(undefined);
    try {
      const response = await json<{ readonly deletion: { readonly localHandleDeleted: boolean; readonly vendor: { readonly status: string } } }>(await mutate(`/api/omr/jobs/${encodeURIComponent(handle)}`, "DELETE"));
      setMessage(`로컬 handle 삭제: ${String(response.deletion.localHandleDeleted)} · 제공자 삭제: ${response.deletion.vendor.status}`);
      setHandle(undefined); setStatus(undefined); setResult(undefined);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "삭제하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const handoff = async () => {
    if (!result) return;
    setBusy(true); setError(undefined);
    try {
      await storeOmrImportHandoff({
        fileName: "omr-result.musicxml", mimeType: "application/vnd.recordare.musicxml+xml",
        bytes: new TextEncoder().encode(result.rawMusicXml), omrProviderResult: result,
        pageImages: pages.map((page) => ({ bytes: page.bytes, mimeType: page.mimeType })),
      });
      router.push("/import");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Quick Review로 전달하지 못했습니다."); setBusy(false); }
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= pages.length) return;
    const next = [...pages]; [next[index], next[target]] = [next[target], next[index]]; setPages(next);
  };

  return (
    <div className={styles.flow}>
      <section className="panel" aria-labelledby="omr-source-heading">
        <h2 id="omr-source-heading">1. 안전한 Source 준비</h2>
        <label className={styles.dropZone} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) void selectFile(file); }}>
          <span>{busy ? "처리 중…" : "PDF / PNG / JPEG / MusicXML / MXL 선택 또는 드롭"}</span>
          <input type="file" accept=".pdf,.png,.jpg,.jpeg,.musicxml,.xml,.mxl,application/pdf,image/png,image/jpeg,application/vnd.recordare.musicxml+xml,application/vnd.recordare.musicxml" onChange={onFile} disabled={busy} />
        </label>
        <div className={styles.actions}><button type="button" onClick={() => void loadReference()} disabled={busy}>결정적 reference E2E 불러오기</button></div>
        <p className={styles.status}>{message}</p>
        {error ? <p className={`${styles.status} ${styles.error}`} role="alert">{error}</p> : null}
      </section>

      {pages.length ? <section className="panel" aria-labelledby="quality-heading">
        <h2 id="quality-heading">2. 페이지 순서와 품질 gate</h2>
        <div className={styles.grid}>{pages.map((page, index) => <article className={styles.pageCard} key={page.key}>
          {/* A local object URL never crosses the network. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={page.previewUrl} alt={`악보 ${index + 1}쪽 미리보기`} />
          <p><strong>{index + 1}쪽</strong> · {page.width}×{page.height}</p>
          <span className={`${styles.badge} ${styles[page.quality.status]}`}>{page.quality.status.toUpperCase()}</span>
          <p className={styles.subtle}>blur {page.quality.blurBp}/10000 · perspective {page.quality.perspectiveBp}/10000 · glare {page.quality.glareBp}/10000 · crop {page.quality.cropRiskBp}/10000</p>
          {page.quality.reasons.length ? <p><code>{page.quality.reasons.join(", ")}</code></p> : null}
          <div className={styles.actions}><button type="button" onClick={() => move(index, -1)} disabled={index === 0 || busy}>앞으로</button><button type="button" onClick={() => move(index, 1)} disabled={index === pages.length - 1 || busy}>뒤로</button></div>
        </article>)}</div>
        {pdfConfirmation ? <div className={styles.checks}><label><input type="radio" name="pdf-kind" onChange={() => { setSourceKind("digital-pdf"); setPdfConfirmation(false); }} /> 텍스트/벡터 기반 디지털 PDF</label><label><input type="radio" name="pdf-kind" onChange={() => { setSourceKind("scanned-pdf"); setPdfConfirmation(false); }} /> 스캔 이미지 PDF</label></div> : null}
        <div className={styles.checks}>
          {hasWarning ? <label><input type="checkbox" checked={warnAccepted} onChange={(event) => setWarnAccepted(event.target.checked)} /> 경고 페이지를 확인했으며 현재 이미지로 계속합니다.</label> : null}
          {duplicate ? <label><input type="checkbox" checked={duplicatesAccepted} onChange={(event) => setDuplicatesAccepted(event.target.checked)} /> 같은 digest의 중복 페이지가 의도된 것임을 확인합니다.</label> : null}
          <label><input type="checkbox" checked={rights} onChange={(event) => setRights(event.target.checked)} /> 이 악보를 편곡 생성에 사용하고 처리할 권리가 있습니다.</label>
          <label><input type="checkbox" checked={transfer} onChange={(event) => setTransfer(event.target.checked)} /> 페이지가 구성된 OMR 제공자에게 전송될 수 있음에 명시적으로 동의합니다.</label>
        </div>
        {hasRetake ? <p className={`${styles.status} ${styles.error}`}>RETAKE 페이지는 업로드할 수 없습니다. 다시 촬영하거나 더 선명한 스캔을 선택하세요.</p> : null}
        <div className={styles.actions}><button className="primary" type="button" onClick={() => void start()} disabled={!ready || busy || Boolean(handle)}>인식 시작</button>{handle && status && !["completed", "failed", "cancelled"].includes(status.kind) ? <button type="button" onClick={() => void cancel()} disabled={busy}>취소</button> : null}{handle ? <button type="button" onClick={() => void remove()} disabled={busy}>작업·보관 데이터 삭제</button> : null}</div>
      </section> : null}

      {status ? <section className="panel" aria-labelledby="status-heading">
        <h2 id="status-heading">3. 작업 상태</h2>
        <p className={styles.status}>{statusLabels[status.kind]}{status.kind === "uploading" ? ` · ${status.uploadedPages}/${status.totalPages}` : ""}{status.kind === "failed" ? ` · ${status.code}: ${status.messageKo}` : ""}</p>
        {status.kind === "processing" && status.progressBp !== undefined ? <progress className={styles.progress} max={10_000} value={status.progressBp}>{status.progressBp / 100}%</progress> : null}
        {status.kind === "needs-input" && status.inputRequest.kind === "select-instrument" ? <div><p>인식할 악기/파트를 선택하세요.</p><div className={styles.actions}>{status.inputRequest.choices.map((choice) => <button type="button" key={choice} onClick={() => void submitInput(status.inputRequest, choice)} disabled={busy}>{choice}</button>)}</div></div> : null}
        {status.kind === "needs-input" && status.inputRequest.kind !== "select-instrument" ? <button type="button" onClick={() => void submitInput(status.inputRequest, "")} disabled={busy}>요청 내용 확인 후 제출</button> : null}
        <dl className={styles.meta}><dt>opaque handle</dt><dd><code>{handle}</code></dd></dl>
      </section> : null}

      {result ? <section className="panel" aria-labelledby="review-heading">
        <h2 id="review-heading">4. 인식 증거와 Quick Review</h2>
        <dl className={styles.meta}><dt>adapter</dt><dd>{result.vendorId}</dd><dt>결과 digest</dt><dd><code>{result.vendorResultDigest}</code></dd><dt>증거 granularity</dt><dd>{result.evidence.granularity}</dd><dt>즉시 삭제</dt><dd>{String(result.retentionInfo.canDeleteImmediately)}</dd><dt>보관 정책</dt><dd>{result.retentionInfo.policyReference ?? "제공자 고지 없음"}</dd></dl>
        {pages[0] ? <div className={styles.evidence}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={pages[0].previewUrl} alt="첫 페이지 인식 증거 overlay" />
          {result.evidence.evidence.filter((item) => item.granularity !== "page").map((item) => <span className={styles.evidenceBox} style={evidenceStyle(item)} key={item.id} title={`${item.id} · confidence ${item.confidenceBp ?? "미제공"}`} />)}
        </div> : null}
        <p>이 overlay는 제공자 증거의 원본 정규화 좌표를 표시합니다. 실제 음표·마디 수정과 Source revision/remap은 다음 Quick Review에서 정본 importer 결과에 적용됩니다.</p>
        <div className={styles.actions}><button className="primary" type="button" onClick={() => void handoff()} disabled={busy}>정본 importer · Quick Review로 전달</button><button type="button" onClick={() => void remove()} disabled={busy}>검토 후 삭제</button></div>
      </section> : null}
    </div>
  );
}
