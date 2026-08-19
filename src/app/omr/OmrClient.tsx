"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from "react";
import { useRouter } from "next/navigation";

import { binaryDigest, type BinaryDigest } from "../../domain/digest/canonical";
import { storeOmrImportHandoff } from "../../domain/omr/browser-handoff";
import { rasterizePdfPages } from "../../domain/omr/browser-raster";
import type { OmrProviderPreflight, OmrProviderResult, OmrPublicStatus } from "../../domain/omr/contracts";
import { analyzeImageQuality, type ImageQualityReport } from "../../domain/omr/image-quality";
import { classifyInputSource, type InputSourceKind } from "../../domain/omr/input";
import { mapEvidenceBoxToNormalizedOriginal, type BoundingBox } from "../../domain/omr/foundation";
import {
  acquireOmrJob,
  consumeExplicitOmrFreshStart,
  finishOmrStart,
  requireExplicitOmrFreshStart,
  readOmrApiJson as json,
  tryBeginOmrStart,
  type OmrFreshStartState,
} from "./browser-recovery";
import styles from "./omr.module.css";

interface PreparedPage {
  readonly key: string;
  readonly bytes: Uint8Array;
  readonly mimeType: "image/png" | "image/jpeg";
  readonly rawDigest: BinaryDigest;
  readonly canonicalPageDigest: BinaryDigest;
  readonly previewUrl: string;
  readonly width: number;
  readonly height: number;
  readonly clientQuality: ImageQualityReport;
  readonly quality: ImageQualityReport;
}

const statusLabels: Readonly<Record<OmrPublicStatus["kind"], string>> = {
  created: "작업 생성됨", uploading: "페이지 업로드 중", queued: "대기 중", processing: "인식 중",
  "needs-input": "추가 입력 필요", completed: "인식 완료", failed: "인식 실패", cancelled: "취소됨",
  "cancel-pending": "제공자 취소 확인 중", "cancel-failed": "제공자 취소 실패", "reconciliation-required": "제공자 상태 조정 필요",
  "retry-pending": "일시적 오류 재시도 대기",
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

async function prepareImage(bytes: Uint8Array, mimeType: "image/png" | "image/jpeg"): Promise<Omit<PreparedPage, "canonicalPageDigest">> {
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
    const clientQuality = analyzeImageQuality({ width, height, luma, originalWidth: bitmap.width, originalHeight: bitmap.height });
    return { key: crypto.randomUUID(), bytes, mimeType, rawDigest: await binaryDigest(bytes), previewUrl: URL.createObjectURL(blob), width: bitmap.width, height: bitmap.height, clientQuality, quality: clientQuality };
  } finally { bitmap.close(); }
}

function evidenceStyle(box: BoundingBox): CSSProperties {
  return {
    left: `${Number(box.xMu) / 10_000}%`, top: `${Number(box.yMu) / 10_000}%`,
    width: `${Number(box.widthMu) / 10_000}%`, height: `${Number(box.heightMu) / 10_000}%`,
  };
}

export function OmrClient({ fixtureControlsEnabled }: { readonly fixtureControlsEnabled: boolean }) {
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
  const [preflight, setPreflight] = useState<OmrProviderPreflight>();
  const [handle, setHandle] = useState<string>();
  const [handleRecoveryStorageKey, setHandleRecoveryStorageKey] = useState<string>();
  const [freshStart, setFreshStart] = useState<OmrFreshStartState>({ mode: "normal" });
  const startInFlightRef = useRef(false);
  const [status, setStatus] = useState<OmrPublicStatus>();
  const [result, setResult] = useState<OmrProviderResult>();
  const [pageOrderInput, setPageOrderInput] = useState<readonly number[]>([]);
  const [vendorInputPayload, setVendorInputPayload] = useState<Readonly<Record<string, string | number | boolean>>>({});

  useEffect(() => { pagesRef.current = pages; }, [pages]);
  useEffect(() => () => { for (const page of pagesRef.current) URL.revokeObjectURL(page.previewUrl); }, []);

  const replacePages = useCallback((next: readonly PreparedPage[]) => {
    for (const page of pagesRef.current) URL.revokeObjectURL(page.previewUrl);
    pagesRef.current = next; setPages(next); setHandle(undefined); setHandleRecoveryStorageKey(undefined);
    setFreshStart({ mode: "normal" }); setStatus(undefined); setResult(undefined);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const session = await json<{ readonly csrfToken: string }>(await fetch("/api/session", { method: "POST" }));
      const response = await json<{ readonly preflight: OmrProviderPreflight }>(await fetch("/api/omr/provider-capabilities", { cache: "no-store" }));
      if (!active) return;
      setCsrf(session.csrfToken);
      setPreflight((current) => {
        if (current && current.capabilitySnapshotDigest !== response.preflight.capabilitySnapshotDigest) setTransfer(false);
        return response.preflight;
      });
    })().catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : "OMR 제공자 사전 고지를 불러오지 못했습니다."); });
    return () => { active = false; };
  }, []);

  const prepareAuthoritativeImage = useCallback(async (bytes: Uint8Array, mimeType: "image/png" | "image/jpeg"): Promise<PreparedPage> => {
    const prepared = await prepareImage(bytes, mimeType);
    let csrfToken = csrf;
    if (!csrfToken) {
      const session = await json<{ readonly csrfToken: string }>(await fetch("/api/session", { method: "POST" }));
      csrfToken = session.csrfToken; setCsrf(csrfToken);
    }
    const response = await json<{ readonly inspection: { readonly digest: BinaryDigest; readonly width: number; readonly height: number; readonly quality: ImageQualityReport } }>(await fetch("/api/omr/quality-preflight", {
      method: "POST", headers: { "content-type": mimeType, "x-csrf-token": csrfToken, "x-page-digest": prepared.rawDigest }, body: bytes.slice().buffer as ArrayBuffer,
    }));
    return { ...prepared, canonicalPageDigest: response.inspection.digest, width: response.inspection.width, height: response.inspection.height, quality: response.inspection.quality };
  }, [csrf]);

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
        const prepared = await Promise.all(raster.pages.map((page) => prepareAuthoritativeImage(page.bytes, page.mimeType)));
        replacePages(prepared);
        if (raster.classification.suggestedKind) {
          setSourceKind(raster.classification.suggestedKind); setPdfConfirmation(false);
          setMessage(`${raster.probe.pageCount}쪽 PDF 준비 완료 · ${raster.classification.suggestedKind === "digital-pdf" ? "디지털 PDF" : "스캔 PDF"}로 안전 분류됨`);
        } else {
          setSourceKind("scanned-pdf"); setPdfConfirmation(true);
          setMessage(`${raster.probe.pageCount}쪽 PDF 준비 완료 · 디지털/스캔 유형을 직접 확인하세요.`);
        }
      } else {
        replacePages([await prepareAuthoritativeImage(bytes, classification.mimeType as "image/png" | "image/jpeg")]);
        setSourceKind("camera-photo"); setPdfConfirmation(false); setMessage("사진 1쪽의 해상도·흐림·원근·반사·잘림 검사를 완료했습니다.");
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "입력을 준비하지 못했습니다."); }
    finally { setBusy(false); }
  }, [prepareAuthoritativeImage, replacePages, router]);

  const selectFiles = useCallback(async (files: readonly File[]) => {
    if (files.length === 1) { await selectFile(files[0]); return; }
    setBusy(true); setError(undefined);
    try {
      if (files.length < 1 || files.length > 12) throw new RangeError("OMR_PAGE_LIMIT_EXCEEDED");
      const prepared: PreparedPage[] = [];
      for (const file of files) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const classification = await classifyInputSource({ bytes, declaredMimeType: inferredMime(file), originalFileName: file.name });
        if (classification.detectedKind !== "camera-photo") throw new RangeError("OMR_MULTI_IMAGE_ONLY");
        prepared.push(await prepareAuthoritativeImage(bytes, classification.mimeType as "image/png" | "image/jpeg"));
      }
      replacePages(prepared); setSourceKind("camera-photo"); setPdfConfirmation(false);
      setMessage(`카메라/이미지 ${prepared.length}쪽을 선택한 순서대로 준비했습니다. 아래에서 명시적으로 순서를 조정하세요.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "여러 이미지 페이지를 준비하지 못했습니다."); }
    finally { setBusy(false); }
  }, [prepareAuthoritativeImage, replacePages, selectFile]);

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    if (files.length) void selectFiles(files);
    event.target.value = "";
  };

  const loadReference = async () => {
    setBusy(true); setError(undefined);
    try {
      if (!fixtureControlsEnabled || preflight?.capabilities.vendorId !== "hm-reference") throw new RangeError("OMR_REFERENCE_FIXTURE_DISABLED");
      const { referenceOmrPageBytes } = await import("../../domain/omr/reference-fixture-data");
      replacePages([await prepareAuthoritativeImage(referenceOmrPageBytes(), "image/png")]);
      setSourceKind("camera-photo"); setPdfConfirmation(false);
      setMessage("내장 결정적 reference fixture 1쪽을 준비했습니다. 실제 제공자 정확도 증거로 사용할 수 없습니다.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "reference fixture를 읽지 못했습니다."); }
    finally { setBusy(false); }
  };

  const loadCanonicalDuplicateReference = async () => {
    setBusy(true); setError(undefined);
    try {
      if (!fixtureControlsEnabled || preflight?.capabilities.vendorId !== "hm-reference") throw new RangeError("OMR_REFERENCE_FIXTURE_DISABLED");
      const { referenceOmrDuplicateJpegPages } = await import("../../domain/omr/reference-duplicate-jpeg-fixture-data");
      const prepared = await Promise.all(referenceOmrDuplicateJpegPages().map((bytes) => prepareAuthoritativeImage(bytes, "image/jpeg")));
      replacePages(prepared); setSourceKind("camera-photo"); setPdfConfirmation(false);
      setMessage("raw bytes는 다르지만 정규화된 decoded page가 같은 JPEG 2쪽을 준비했습니다.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "중복 JPEG fixture를 읽지 못했습니다."); }
    finally { setBusy(false); }
  };

  const duplicate = useMemo(() => new Set(pages.map((page) => page.canonicalPageDigest)).size !== pages.length, [pages]);
  const hasWarning = pages.some((page) => page.quality.status === "warn");
  const hasRetake = pages.some((page) => page.quality.status === "retake");
  const ready = pages.length > 0 && !hasRetake && rights && transfer && Boolean(preflight) && (!hasWarning || warnAccepted) && (!duplicate || duplicatesAccepted) && !pdfConfirmation;

  const mutate = useCallback(async (url: string, method: "POST" | "DELETE", body?: unknown) => {
    if (!csrf) throw new Error("세션 CSRF 토큰이 없습니다.");
    return fetch(url, { method, headers: { "x-csrf-token": csrf, ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }, [csrf]);

  const poll = useCallback(async (jobHandle: string) => {
    for (let attempt = 0; attempt < 90; attempt += 1) {
      const response = await json<{ readonly status: OmrPublicStatus }>(await mutate(`/api/omr/jobs/${encodeURIComponent(jobHandle)}/sync`, "POST"));
      if (response.status.kind === "needs-input" && response.status.inputRequest.kind === "confirm-page-order") setPageOrderInput([...response.status.inputRequest.pageIndices]);
      if (response.status.kind === "needs-input" && response.status.inputRequest.kind === "vendor-specific") setVendorInputPayload(structuredClone(response.status.inputRequest.payload));
      setStatus(response.status);
      if (["completed", "failed", "cancelled", "needs-input", "cancel-failed", "reconciliation-required"].includes(response.status.kind)) {
        if (response.status.kind === "completed") {
          const exported = await json<{ readonly result: OmrProviderResult }>(await fetch(`/api/omr/jobs/${encodeURIComponent(jobHandle)}/result`, { cache: "no-store" }));
          setResult(exported.result);
        }
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
    throw new Error("인식 상태 확인 시간이 초과되었습니다. handle로 다시 조회할 수 있습니다.");
  }, [mutate]);

  const start = async () => {
    if (!ready || !tryBeginOmrStart(startInFlightRef)) return;
    const freshIntent = consumeExplicitOmrFreshStart(freshStart);
    if (freshIntent.forceFresh) setFreshStart(freshIntent.nextState);
    setBusy(true); setError(undefined); setResult(undefined);
    try {
      let csrfToken = csrf;
      if (!csrfToken) {
        const session = await json<{ readonly csrfToken: string }>(await fetch("/api/session", { method: "POST" }));
        csrfToken = session.csrfToken; setCsrf(csrfToken);
      }
      const headers = { "content-type": "application/json", "x-csrf-token": csrfToken };
      if (!preflight) throw new RangeError("OMR_PROVIDER_CAPABILITY_MISSING");
      const createStorageKey = `harmonymaker:omr-create:v3:${preflight.capabilitySnapshotDigest}:${sourceKind}:${pages.map((page) => page.rawDigest).join(":")}`;
      const recoveryStorageKey = `${createStorageKey}:recovered-handle`;
      const acquisition = await acquireOmrJob<OmrPublicStatus>({
        storage: localStorage, createStorageKey, recoveryStorageKey, canonicalInputIdentity: createStorageKey, forceFresh: freshIntent.forceFresh,
        createRequest: () => ({
          pageCount: pages.length, pages: pages.map((page, pageIndex) => ({ pageIndex, pageDigest: page.rawDigest, mimeType: page.mimeType })), sourceKind,
          rights: { basis: "user-confirmed-rights", allowedUses: ["generation", "provider-transfer"], confirmedAt: new Date().toISOString() },
          providerTransferConsent: true, consentCapabilitySnapshotDigest: preflight.capabilitySnapshotDigest, idempotencyKey: crypto.randomUUID(),
        }),
        validateCreateRequest: (request) => request.pageCount === pages.length && request.sourceKind === sourceKind
          && request.consentCapabilitySnapshotDigest === preflight.capabilitySnapshotDigest
          && Array.isArray(request.pages) && request.pages.every((page, pageIndex) => {
            const expected = pages[pageIndex];
            return page !== null && typeof page === "object"
              && (page as Readonly<Record<string, unknown>>).pageIndex === pageIndex
              && (page as Readonly<Record<string, unknown>>).pageDigest === expected?.rawDigest
              && (page as Readonly<Record<string, unknown>>).mimeType === expected?.mimeType;
          }),
        recover: async (storedHandle) => (await json<{ readonly status: OmrPublicStatus }>(await fetch(`/api/omr/jobs/${encodeURIComponent(storedHandle)}`, { cache: "no-store" }))).status,
        create: async (request) => json<{ readonly handle: string }>(await fetch("/api/omr/jobs", { method: "POST", headers, body: JSON.stringify(request) })),
      });
      if (acquisition.kind === "fresh-start-required") {
        setFreshStart(requireExplicitOmrFreshStart(acquisition.reason));
        setHandleRecoveryStorageKey(undefined); setHandle(undefined); setStatus(undefined);
        setError(acquisition.reason === "stale-recovery-handle"
          ? "이전 작업을 복구할 수 없습니다. 권리와 제공자 전송 동의를 다시 확인한 뒤 ‘새 작업 시작’을 선택하세요."
          : acquisition.reason === "invalid-persisted-create"
            ? "저장된 생성 요청이 손상되었거나 현재 입력과 맞지 않습니다. 자동 요청은 중단되었습니다. 확인 후 ‘새 작업 시작’을 선택하세요."
            : acquisition.reason === "rejected-create-request"
              ? "저장된 생성 요청이 서버에서 거부되었습니다. 확인 후 ‘새 작업 시작’을 선택하세요."
              : "이전 생성 요청은 만료되어 재사용할 수 없습니다. 권리와 제공자 전송 동의를 다시 확인한 뒤 ‘새 작업 시작’을 선택하세요.");
        return;
      }
      const jobHandle = acquisition.handle;
      const recoveredStatus = acquisition.recoveredStatus;
      setFreshStart({ mode: "normal" });
      setHandleRecoveryStorageKey(recoveryStorageKey);
      setHandle(jobHandle); setStatus(recoveredStatus ?? { kind: "created" });
      if (!recoveredStatus || recoveredStatus.kind === "created" || recoveredStatus.kind === "uploading") {
        for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
          const page = pages[pageIndex];
          setStatus({ kind: "uploading", uploadedPages: pageIndex, totalPages: pages.length });
          await json(await fetch(`/api/omr/jobs/${encodeURIComponent(jobHandle)}/pages/${pageIndex}`, {
            method: "PUT", headers: { "content-type": page.mimeType, "x-csrf-token": csrfToken, "x-page-digest": page.rawDigest, "x-idempotency-key": `${jobHandle}:${pageIndex}`, "x-quality-warning-acknowledged": String(warnAccepted), "x-duplicate-page-confirmed": String(duplicatesAccepted) }, body: page.bytes.slice().buffer as ArrayBuffer,
          }));
        }
        await json(await fetch(`/api/omr/jobs/${encodeURIComponent(jobHandle)}/start`, { method: "POST", headers: { "x-csrf-token": csrfToken } }));
      }
      await poll(jobHandle);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "OMR 작업을 시작하지 못했습니다."); }
    finally { finishOmrStart(startInFlightRef); setBusy(false); }
  };

  const submitInput = async (response: import("../../domain/omr/contracts").VendorInputResponse) => {
    if (!handle) return;
    setBusy(true); setError(undefined);
    try {
      await json(await mutate(`/api/omr/jobs/${encodeURIComponent(handle)}/input`, "POST", response));
      await poll(handle);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "추가 입력을 제출하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const cancel = async () => {
    if (!handle) return;
    setBusy(true); setError(undefined);
    try { await json(await mutate(`/api/omr/jobs/${encodeURIComponent(handle)}/cancel`, "POST")); await poll(handle); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "취소하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!handle) return;
    setBusy(true); setError(undefined);
    try {
      const response = await json<{ readonly deletion: { readonly localHandleDeleted: boolean; readonly vendor: { readonly status: string } } }>(await mutate(`/api/omr/jobs/${encodeURIComponent(handle)}`, "DELETE"));
      setMessage(`로컬 handle 삭제: ${String(response.deletion.localHandleDeleted)} · 제공자 삭제: ${response.deletion.vendor.status}`);
      if (handleRecoveryStorageKey) localStorage.removeItem(handleRecoveryStorageKey);
      setHandleRecoveryStorageKey(undefined);
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
      if (handleRecoveryStorageKey) localStorage.removeItem(handleRecoveryStorageKey);
      setHandleRecoveryStorageKey(undefined);
      router.push("/import");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Quick Review로 전달하지 못했습니다."); setBusy(false); }
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= pages.length) return;
    const next = [...pages]; [next[index], next[target]] = [next[target], next[index]]; setPages(next);
  };

  const moveRequestedPage = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= pageOrderInput.length) return;
    const next = [...pageOrderInput]; [next[index], next[target]] = [next[target], next[index]]; setPageOrderInput(next);
  };
  const vendorSpecificRequest = status?.kind === "needs-input" && status.inputRequest.kind === "vendor-specific" ? status.inputRequest : undefined;

  return (
    <div className={styles.flow}>
      <section className="panel" aria-labelledby="omr-source-heading">
        <h2 id="omr-source-heading">1. 안전한 Source 준비</h2>
        <label className={styles.dropZone} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const files = [...event.dataTransfer.files]; if (files.length) void selectFiles(files); }}>
          <span>{busy ? "처리 중…" : "PDF / PNG / JPEG / MusicXML / MXL 선택 또는 드롭"}</span>
          <input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.musicxml,.xml,.mxl,application/pdf,image/png,image/jpeg,application/vnd.recordare.musicxml+xml,application/vnd.recordare.musicxml" onChange={onFile} disabled={busy} />
        </label>
        {fixtureControlsEnabled && preflight?.capabilities.vendorId === "hm-reference" ? <div className={styles.actions}><button type="button" onClick={() => void loadReference()} disabled={busy}>결정적 reference E2E 불러오기</button><button type="button" onClick={() => void loadCanonicalDuplicateReference()} disabled={busy}>canonical duplicate JPEG E2E</button></div> : null}
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
          <p className={styles.subtle}>server-authoritative · blur {page.quality.blurBp}/10000 · perspective {page.quality.perspectiveBp}/10000 · glare {page.quality.glareBp}/10000 · crop {page.quality.cropRiskBp}/10000</p>
          <p className={styles.subtle}>browser preview (non-gating): {page.clientQuality.status}</p>
          {page.quality.reasons.length ? <p><code>{page.quality.reasons.join(", ")}</code></p> : null}
          <div className={styles.actions}><button type="button" onClick={() => move(index, -1)} disabled={index === 0 || busy}>앞으로</button><button type="button" onClick={() => move(index, 1)} disabled={index === pages.length - 1 || busy}>뒤로</button></div>
        </article>)}</div>
        {pdfConfirmation ? <div className={styles.checks}><label><input type="radio" name="pdf-kind" onChange={() => { setSourceKind("digital-pdf"); setPdfConfirmation(false); }} /> 텍스트/벡터 기반 디지털 PDF</label><label><input type="radio" name="pdf-kind" onChange={() => { setSourceKind("scanned-pdf"); setPdfConfirmation(false); }} /> 스캔 이미지 PDF</label></div> : null}
        <div className={styles.checks}>
          {hasWarning ? <label><input type="checkbox" checked={warnAccepted} onChange={(event) => setWarnAccepted(event.target.checked)} /> 경고 페이지를 확인했으며 현재 이미지로 계속합니다.</label> : null}
          {duplicate ? <label><input type="checkbox" checked={duplicatesAccepted} onChange={(event) => setDuplicatesAccepted(event.target.checked)} /> 정규화된 동일 페이지가 의도된 중복임을 확인합니다.</label> : null}
          <label><input type="checkbox" checked={rights} onChange={(event) => setRights(event.target.checked)} /> 이 악보를 편곡 생성에 사용하고 처리할 권리가 있습니다.</label>
          {preflight ? <div className={styles.status} aria-label="OMR provider capability preflight"><strong>{preflight.capabilities.vendorDisplayName}</strong> (<code>{preflight.capabilities.vendorId}</code>) · 외부 전송 {String(preflight.capabilities.externalTransfer)} · evidence {preflight.capabilities.evidenceGranularity} · 즉시 삭제 {String(preflight.capabilities.canDeleteImmediately)} · 보관 고지 <code>{preflight.capabilities.retentionPolicyReference}</code></div> : <p className={styles.notice}>제공자 capability와 보관 고지를 불러오는 중입니다.</p>}
          <label><input type="checkbox" checked={transfer} disabled={!preflight} onChange={(event) => setTransfer(event.target.checked)} /> 위 capability snapshot과 외부 제공자 전송·보관 고지를 확인하고 명시적으로 동의합니다.</label>
        </div>
        {hasRetake ? <p className={`${styles.status} ${styles.error}`}>RETAKE 페이지는 업로드할 수 없습니다. 다시 촬영하거나 더 선명한 스캔을 선택하세요.</p> : null}
        <div className={styles.actions}><button className="primary" type="button" onClick={() => void start()} disabled={!ready || busy || Boolean(handle)}>{freshStart.mode === "explicit-required" ? "새 작업 시작" : "인식 시작"}</button>{handle && status && !["completed", "failed", "cancelled"].includes(status.kind) ? <button type="button" onClick={() => void cancel()} disabled={busy}>취소</button> : null}{handle ? <button type="button" onClick={() => void remove()} disabled={busy}>작업·보관 데이터 삭제</button> : null}</div>
      </section> : null}

      {status ? <section className="panel" aria-labelledby="status-heading">
        <h2 id="status-heading">3. 작업 상태</h2>
        <p className={styles.status}>{statusLabels[status.kind]}{status.kind === "uploading" ? ` · ${status.uploadedPages}/${status.totalPages}` : ""}{status.kind === "failed" || status.kind === "cancel-failed" || status.kind === "reconciliation-required" ? ` · ${status.code}: ${status.messageKo}` : status.kind === "cancel-pending" ? ` · ${status.messageKo}` : ""}</p>
        {status.kind === "processing" && status.progressBp !== undefined ? <progress className={styles.progress} max={10_000} value={status.progressBp}>{status.progressBp / 100}%</progress> : null}
        {status.kind === "needs-input" && status.inputRequest.kind === "select-instrument" ? <div><p>인식할 악기/파트를 선택하세요.</p><div className={styles.actions}>{status.inputRequest.choices.map((choice) => <button type="button" key={choice} onClick={() => void submitInput({ kind: "select-instrument", requestId: status.inputRequest.requestId, choice })} disabled={busy}>{choice}</button>)}</div></div> : null}
        {status.kind === "needs-input" && status.inputRequest.kind === "confirm-page-order" ? <div><p>제공자 요청 순서를 직접 확인하고 조정하세요.</p><ol>{pageOrderInput.map((pageIndex, index) => <li key={pageIndex}>원본 page {pageIndex + 1} <button type="button" onClick={() => moveRequestedPage(index, -1)} disabled={busy || index === 0}>앞으로</button><button type="button" onClick={() => moveRequestedPage(index, 1)} disabled={busy || index === pageOrderInput.length - 1}>뒤로</button></li>)}</ol><button type="button" disabled={busy} onClick={() => void submitInput({ kind: "confirm-page-order", requestId: status.inputRequest.requestId, pageIndices: pageOrderInput })}>이 page order 확정</button></div> : null}
        {vendorSpecificRequest ? <div><p>제공자별 bounded 입력 (<code>{vendorSpecificRequest.schemaId}</code>)</p>{Object.entries(vendorInputPayload).slice(0, 32).map(([key, value]) => <label className={styles.field} key={key}><span>{key}</span>{typeof value === "boolean" ? <input type="checkbox" checked={value} onChange={(event) => setVendorInputPayload((current) => ({ ...current, [key]: event.target.checked }))} /> : <input value={String(value)} maxLength={8192} type={typeof value === "number" ? "number" : "text"} onChange={(event) => setVendorInputPayload((current) => ({ ...current, [key]: typeof value === "number" ? Number(event.target.value) : event.target.value }))} />}</label>)}<button type="button" disabled={busy || JSON.stringify(vendorInputPayload).length > 8192} onClick={() => void submitInput({ kind: "vendor-specific", requestId: vendorSpecificRequest.requestId, schemaId: vendorSpecificRequest.schemaId, payload: vendorInputPayload })}>bounded 입력 제출</button></div> : null}
        <dl className={styles.meta}><dt>opaque handle</dt><dd><code>{handle}</code></dd></dl>
      </section> : null}

      {result ? <section className="panel" aria-labelledby="review-heading">
        <h2 id="review-heading">4. 인식 증거와 Quick Review</h2>
        <dl className={styles.meta}><dt>adapter</dt><dd>{result.vendorId}</dd><dt>결과 digest</dt><dd><code>{result.vendorResultDigest}</code></dd><dt>증거 granularity</dt><dd>{result.evidence.granularity}</dd><dt>즉시 삭제</dt><dd>{String(result.retentionInfo.canDeleteImmediately)}</dd><dt>보관 정책</dt><dd>{result.retentionInfo.policyReference ?? "제공자 고지 없음"}</dd></dl>
        {pages.map((page, pageIndex) => <div className={styles.evidence} key={page.key}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={page.previewUrl} alt={`${pageIndex + 1}쪽 인식 증거 overlay`} />
          {result.evidence.evidence.filter((item) => item.granularity !== "page").map((item) => {
            const box = mapEvidenceBoxToNormalizedOriginal(item, result.evidence.frames, result.evidence.transforms);
            const frame = box && result.evidence.frames.find((candidate) => candidate.id === box.frameId);
            return box && frame?.pageIndex === pageIndex ? <span className={styles.evidenceBox} style={evidenceStyle(box)} key={item.id} title={`${item.id} · confidence ${item.confidenceBp ?? "미제공"}`} /> : null;
          })}
        </div>)}
        <p>이 overlay는 제공자 증거의 원본 정규화 좌표를 표시합니다. 실제 음표·마디 수정과 Source revision/remap은 다음 Quick Review에서 정본 importer 결과에 적용됩니다.</p>
        <div className={styles.actions}><button className="primary" type="button" onClick={() => void handoff()} disabled={busy}>정본 importer · Quick Review로 전달</button><button type="button" onClick={() => void remove()} disabled={busy}>검토 후 삭제</button></div>
      </section> : null}
    </div>
  );
}
