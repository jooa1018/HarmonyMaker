"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from "react";
import { useRouter } from "next/navigation";

import { binaryDigest, type BinaryDigest } from "../../domain/digest/canonical";
import { storeOmrImportHandoff } from "../../domain/omr/browser-handoff";
import { rasterizePdfPages } from "../../domain/omr/browser-raster";
import type { OmrDeleteResult, OmrProviderPreflight, OmrProviderResult, OmrPublicStatus } from "../../domain/omr/contracts";
import { analyzeImageQuality, type ImageQualityReport } from "../../domain/omr/image-quality";
import { classifyInputSource, type InputSourceKind } from "../../domain/omr/input";
import { mapEvidenceBoxToNormalizedOriginal, type BoundingBox } from "../../domain/omr/foundation";
import {
  acquireOmrJob,
  applyOmrCreateCorrection,
  canResetOmrCreateAfterCorrection,
  consumeExplicitOmrFreshStart,
  finishOmrStart,
  isOmrJobHandleShape,
  isUnavailableRecoveryHandle,
  omrFreshStartAction,
  OmrApiRequestError,
  requireExplicitOmrFreshStart,
  readOmrApiJson as json,
  tryBeginOmrStart,
  type OmrFreshStartState,
} from "./browser-recovery";
import {
  bindOmrBrowserJobManifest,
  clearOmrBrowserJobManifest,
  createOmrBrowserJobManifest,
  markOmrBrowserJobManifest,
  markOmrBrowserJobDeletePending,
  persistNewOmrBrowserJobManifest,
  readOmrBrowserJobManifest,
  setOmrBrowserUploadRetry,
  type OmrBrowserJobManifest,
} from "./browser-job-manifest";
import {
  assertOmrBrowserMonitorGeneration, canCancelOmrStatus, isOmrMonitorRetryDue, isOmrMonitorTerminal,
  nextOmrUploadBindingRetryTarget,
  omrBrowserAuthorityAction, omrDeletionDisposition,
  runOmrBrowserMonitorSession, scheduleOmrMonitorRetryResume, shouldStartOmrMonitorNow,
  type OmrBrowserMonitorGeneration,
} from "./browser-job-lifecycle";
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
  readonly uploadIdentity?: string;
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

async function waitForMonitor(targetTime: number, signal: AbortSignal): Promise<void> {
  while (Date.now() < targetTime) {
    const delay = Math.min(30_000, Math.max(1, targetTime - Date.now()));
    await new Promise<void>((resolve, reject) => {
      const finish = () => { signal.removeEventListener("abort", abort); resolve(); };
      const timer = window.setTimeout(finish, delay);
      const abort = () => {
        window.clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        reject(new DOMException("aborted", "AbortError"));
      };
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    });
  }
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
  const uploadInFlightRef = useRef(false);
  const [status, setStatus] = useState<OmrPublicStatus>();
  const [result, setResult] = useState<OmrProviderResult>();
  const [pageOrderInput, setPageOrderInput] = useState<readonly number[]>([]);
  const [vendorInputPayload, setVendorInputPayload] = useState<Readonly<Record<string, string | number | boolean>>>({});
  const [manifest, setManifest] = useState<OmrBrowserJobManifest>();
  const [invalidManifestRecovery, setInvalidManifestRecovery] = useState(false);
  const manifestRef = useRef(manifest);
  const monitorAbortRef = useRef<AbortController | undefined>(undefined);

  const currentMonitorAuthority = useCallback((): OmrBrowserMonitorGeneration | undefined => {
    const current = manifestRef.current;
    return current?.jobHandle
      ? { jobHandle: current.jobHandle, manifestDigest: current.manifestDigest }
      : undefined;
  }, []);
  const abortCurrentMonitor = useCallback(() => { monitorAbortRef.current?.abort(); }, []);

  useEffect(() => { pagesRef.current = pages; }, [pages]);
  useEffect(() => { manifestRef.current = manifest; }, [manifest]);
  useEffect(() => () => {
    abortCurrentMonitor();
    for (const page of pagesRef.current) URL.revokeObjectURL(page.previewUrl);
  }, [abortCurrentMonitor]);

  const replacePages = useCallback((next: readonly PreparedPage[]) => {
    if (manifestRef.current) throw new RangeError("OMR_BROWSER_MANIFEST_ACTIVE");
    for (const page of pagesRef.current) URL.revokeObjectURL(page.previewUrl);
    pagesRef.current = next; setPages(next); setHandle(undefined); setHandleRecoveryStorageKey(undefined);
    setFreshStart({ mode: "normal" }); setStatus(undefined); setResult(undefined);
  }, []);

  const manifestLocked = Boolean(manifest);

  useEffect(() => {
    let active = true;
    void readOmrBrowserJobManifest().then(async (stored) => {
      if (!active || !stored) return;
      const restored = await Promise.all(stored.pages.map(async (page): Promise<PreparedPage> => ({
        key: page.previewIdentity,
        bytes: new Uint8Array(await page.bytes.arrayBuffer()),
        mimeType: page.mimeType,
        rawDigest: page.rawDigest,
        canonicalPageDigest: page.canonicalPageDigest,
        previewUrl: URL.createObjectURL(page.bytes),
        width: page.width,
        height: page.height,
        clientQuality: structuredClone(page.clientQuality),
        quality: structuredClone(page.quality),
        uploadIdentity: page.uploadIdentity,
      })));
      if (!active) {
        for (const page of restored) URL.revokeObjectURL(page.previewUrl);
        return;
      }
      for (const page of pagesRef.current) URL.revokeObjectURL(page.previewUrl);
      pagesRef.current = restored;
      setPages(restored);
      setManifest(stored);
      setSourceKind(stored.sourceKind);
      if (stored.jobHandle) {
        setHandle(stored.jobHandle);
        setHandleRecoveryStorageKey(stored.recoveryStorageKey);
      }
      setMessage(stored.lifecycle === "delete-pending"
        ? `삭제 조정 중인 OMR manifest와 exact handle을 복구했습니다.${stored.pendingDeletion?.nextAttemptAt ? ` 다음 확인 ${stored.pendingDeletion.nextAttemptAt}` : ""}`
        : stored.pendingUploadRetry
          ? `생성 시점 provider binding 복구를 기다리는 exact upload manifest를 복구했습니다. 다음 시도 ${stored.pendingUploadRetry.nextAttemptAt}`
        : stored.jobHandle
        ? "저장된 OMR 페이지 manifest와 작업 handle을 정확히 복구했습니다."
        : "저장된 OMR 페이지 manifest를 복구했습니다. 같은 생성 키로 재개할 수 있습니다.");
    }).catch((caught: unknown) => {
      if (!active) return;
      if (caught instanceof RangeError && caught.message === "OMR_BROWSER_MANIFEST_INVALID") {
        setInvalidManifestRecovery(true);
        setError("저장된 OMR manifest의 무결성을 확인할 수 없습니다. 자동 fallback을 중단했습니다. 명시적으로 폐기한 뒤 입력을 다시 선택하세요.");
      } else setError(caught instanceof Error ? caught.message : "저장된 OMR manifest를 복구하지 못했습니다.");
    });
    return () => { active = false; };
  }, []);

  const discardInvalidManifest = async () => {
    abortCurrentMonitor();
    setBusy(true);
    try {
      const removed = await clearOmrBrowserJobManifest();
      if (removed?.createStorageKey) localStorage.removeItem(removed.createStorageKey);
      if (removed?.recoveryStorageKey) localStorage.removeItem(removed.recoveryStorageKey);
      setInvalidManifestRecovery(false);
      setError(undefined);
      setMessage("손상된 저장 manifest를 명시적으로 폐기했습니다. 입력을 다시 선택하세요.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "손상된 manifest를 폐기하지 못했습니다.");
    } finally { setBusy(false); }
  };

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
  const authorityAction = useMemo(() => manifest ? omrBrowserAuthorityAction({
    lifecycle: manifest.lifecycle,
    ...(status ? { statusKind: status.kind } : {}),
    correctionLocked: omrFreshStartAction(freshStart) === "unlock-correction",
  }) : undefined, [freshStart, manifest, status]);

  const mutate = useCallback(async (url: string, method: "POST" | "DELETE", body?: unknown, signal?: AbortSignal) => {
    if (!csrf) throw new Error("세션 CSRF 토큰이 없습니다.");
    return fetch(url, {
      method,
      headers: { "x-csrf-token": csrf, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal ? { signal } : {}),
    });
  }, [csrf]);

  const applyPublicStatus = useCallback(async (
    authority: OmrBrowserMonitorGeneration,
    next: OmrPublicStatus,
    signal: AbortSignal,
  ) => {
    const assertCurrent = () => assertOmrBrowserMonitorGeneration({ authority, currentAuthority: currentMonitorAuthority, signal });
    assertCurrent();
    const currentManifest = manifestRef.current;
    if (next.kind === "completed") {
      const resultResponse = await fetch(`/api/omr/jobs/${encodeURIComponent(authority.jobHandle)}/result`, { cache: "no-store", signal });
      assertCurrent();
      const exported = await json<{ readonly result: OmrProviderResult }>(resultResponse);
      assertCurrent();
      let updatedManifest: OmrBrowserJobManifest | undefined;
      if (currentManifest?.jobHandle === authority.jobHandle
        && currentManifest.manifestDigest === authority.manifestDigest
        && currentManifest.lifecycle !== "completed") {
        updatedManifest = await markOmrBrowserJobManifest(currentManifest.manifestDigest, "completed");
        assertCurrent();
      }
      assertCurrent();
      setResult(exported.result);
      setStatus(next);
      if (updatedManifest) {
        manifestRef.current = updatedManifest;
        setManifest(updatedManifest);
      }
      return;
    }
    if (["failed", "cancelled", "cancel-failed", "reconciliation-required"].includes(next.kind)
      && currentManifest?.jobHandle === authority.jobHandle
      && currentManifest.manifestDigest === authority.manifestDigest
      && currentManifest.lifecycle !== "terminal") {
      const updated = await markOmrBrowserJobManifest(currentManifest.manifestDigest, "terminal");
      assertCurrent();
      setStatus(next);
      manifestRef.current = updated; setManifest(updated);
      return;
    }
    assertCurrent();
    if (next.kind === "needs-input" && next.inputRequest.kind === "confirm-page-order") setPageOrderInput([...next.inputRequest.pageIndices]);
    if (next.kind === "needs-input" && next.inputRequest.kind === "vendor-specific") setVendorInputPayload(structuredClone(next.inputRequest.payload));
    setStatus(next);
  }, [currentMonitorAuthority]);

  const monitor = useCallback(async (jobHandle: string) => {
    abortCurrentMonitor();
    const currentManifest = manifestRef.current;
    if (currentManifest?.jobHandle !== jobHandle) return;
    const authority: OmrBrowserMonitorGeneration = {
      jobHandle,
      manifestDigest: currentManifest.manifestDigest,
    };
    const controller = new AbortController();
    monitorAbortRef.current = controller;
    try {
      await runOmrBrowserMonitorSession({
        authority,
        currentAuthority: currentMonitorAuthority,
        signal: controller.signal,
        sync: async (signal) => {
          const syncResponse = await mutate(`/api/omr/jobs/${encodeURIComponent(jobHandle)}/sync`, "POST", undefined, signal);
          assertOmrBrowserMonitorGeneration({ authority, currentAuthority: currentMonitorAuthority, signal });
          const response = await json<{ readonly status: OmrPublicStatus }>(syncResponse);
          assertOmrBrowserMonitorGeneration({ authority, currentAuthority: currentMonitorAuthority, signal });
          return response.status;
        },
        applyStatus: (next, signal) => applyPublicStatus(authority, next, signal),
        waitUntil: waitForMonitor,
        onBudgetPause: (nextAt) => setMessage(nextAt === undefined
          ? "활성 상태 확인 시간 한도에 도달했습니다. exact handle과 manifest는 유지됩니다. ‘상태 확인 재개’로 계속할 수 있습니다."
          : `활성 상태 확인을 일시 중지했습니다. exact handle과 manifest는 유지됩니다. 다음 제공자 확인 목표 ${new Date(nextAt).toISOString()}`),
      });
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === "AbortError")) {
        setError(caught instanceof Error ? caught.message : "OMR 작업 상태를 다시 확인하지 못했습니다.");
      }
    } finally {
      if (monitorAbortRef.current === controller) monitorAbortRef.current = undefined;
    }
  }, [abortCurrentMonitor, applyPublicStatus, currentMonitorAuthority, mutate]);

  useEffect(() => {
    if (!handle || manifest?.jobHandle !== handle || manifest.lifecycle === "delete-pending" || !status) return;
    return scheduleOmrMonitorRetryResume({
      status,
      nowEpochMs: Date.now(),
      setTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
      clearTimer: (timer) => window.clearTimeout(timer),
      resume: () => { if (document.visibilityState === "visible") void monitor(handle); },
    });
  }, [handle, manifest, monitor, status]);

  const resumeBoundUpload = useCallback(async (
    jobHandle: string,
    authority: OmrBrowserJobManifest,
    csrfToken: string,
  ) => {
    if (uploadInFlightRef.current) return;
    if (authority.jobHandle !== jobHandle || !["bound"].includes(authority.lifecycle)) {
      throw new RangeError("OMR_BROWSER_MANIFEST_BINDING_CONFLICT");
    }
    uploadInFlightRef.current = true;
    try {
      for (let pageIndex = 0; pageIndex < authority.pages.length; pageIndex += 1) {
        const page = authority.pages[pageIndex];
        const bytes = new Uint8Array(await page.bytes.arrayBuffer());
        setStatus({ kind: "uploading", uploadedPages: pageIndex, totalPages: authority.pages.length });
        await json(await fetch(`/api/omr/jobs/${encodeURIComponent(jobHandle)}/pages/${pageIndex}`, {
          method: "PUT",
          headers: {
            "content-type": page.mimeType,
            "x-csrf-token": csrfToken,
            "x-page-digest": page.rawDigest,
            "x-idempotency-key": page.uploadIdentity,
            "x-quality-warning-acknowledged": String(page.warnAcknowledged),
            "x-duplicate-page-confirmed": String(page.duplicateConfirmed),
          },
          body: bytes.buffer,
        }));
      }
      if (manifestRef.current?.manifestDigest === authority.manifestDigest
        && manifestRef.current.pendingUploadRetry) {
        const cleared = await setOmrBrowserUploadRetry(authority.manifestDigest, undefined);
        manifestRef.current = cleared;
        setManifest(cleared);
      }
      await json(await fetch(`/api/omr/jobs/${encodeURIComponent(jobHandle)}/start`, {
        method: "POST", headers: { "x-csrf-token": csrfToken },
      }));
      setStatus({ kind: "queued" });
      void monitor(jobHandle);
    } catch (caught) {
      if (caught instanceof OmrApiRequestError && caught.code === "OMR_PROVIDER_BINDING_UNAVAILABLE") {
        const current = manifestRef.current;
        if (current?.manifestDigest === authority.manifestDigest && current.lifecycle === "bound") {
          const attempt = (current.pendingUploadRetry?.attempt ?? 0) + 1;
          const pending = await setOmrBrowserUploadRetry(current.manifestDigest, {
            code: "OMR_PROVIDER_BINDING_UNAVAILABLE",
            attempt,
            nextAttemptAt: new Date(nextOmrUploadBindingRetryTarget(attempt, Date.now())).toISOString(),
          });
          manifestRef.current = pending;
          setManifest(pending);
          setMessage(`생성 시점 provider binding을 아직 사용할 수 없습니다. exact upload authority를 유지하며 다음 시도 ${pending.pendingUploadRetry?.nextAttemptAt ?? "미정"}`);
        }
      }
      throw caught;
    } finally {
      uploadInFlightRef.current = false;
    }
  }, [monitor]);

  useEffect(() => {
    if (!csrf || !manifest?.jobHandle || manifest.lifecycle === "delete-pending" || startInFlightRef.current) return;
    let active = true;
    const controller = new AbortController();
    const jobHandle = manifest.jobHandle;
    const authority: OmrBrowserMonitorGeneration = { jobHandle, manifestDigest: manifest.manifestDigest };
    void (async () => {
      const recoveredResponse = await fetch(`/api/omr/jobs/${encodeURIComponent(jobHandle)}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      assertOmrBrowserMonitorGeneration({ authority, currentAuthority: currentMonitorAuthority, signal: controller.signal });
      const recovered = await json<{ readonly status: OmrPublicStatus }>(recoveredResponse);
      assertOmrBrowserMonitorGeneration({ authority, currentAuthority: currentMonitorAuthority, signal: controller.signal });
      await applyPublicStatus(authority, recovered.status, controller.signal);
      assertOmrBrowserMonitorGeneration({ authority, currentAuthority: currentMonitorAuthority, signal: controller.signal });
      if (recovered.status.kind === "created" || recovered.status.kind === "uploading") {
        const retryAt = manifest.pendingUploadRetry
          ? Date.parse(manifest.pendingUploadRetry.nextAttemptAt) : undefined;
        if (retryAt === undefined || retryAt <= Date.now()) {
          await resumeBoundUpload(jobHandle, manifest, csrf);
          assertOmrBrowserMonitorGeneration({ authority, currentAuthority: currentMonitorAuthority, signal: controller.signal });
        }
      } else if (shouldStartOmrMonitorNow(recovered.status, Date.now())) {
        void monitor(jobHandle);
      }
    })().catch((caught: unknown) => {
      if (!active || (caught instanceof DOMException && caught.name === "AbortError")) return;
      if (isUnavailableRecoveryHandle(caught)) {
        setFreshStart(requireExplicitOmrFreshStart("stale-recovery-handle"));
        setHandle(undefined); setHandleRecoveryStorageKey(undefined); setStatus(undefined);
        setError("저장된 작업 handle이 더 이상 유효하지 않습니다. manifest를 폐기하고 새 작업을 시작하려면 명시적으로 확인하세요.");
      } else setError(caught instanceof Error ? caught.message : "저장된 OMR 작업을 복구하지 못했습니다.");
    });
    return () => { active = false; controller.abort(); };
  }, [applyPublicStatus, csrf, currentMonitorAuthority, manifest, monitor, resumeBoundUpload]);

  useEffect(() => {
    const retry = manifest?.pendingUploadRetry;
    if (!retry || !csrf || !manifest.jobHandle || manifest.lifecycle !== "bound") return;
    let active = true;
    let timer: number | undefined;
    const resumeWhenDueAndIdle = () => {
      if (!active) return;
      if (uploadInFlightRef.current) {
        timer = window.setTimeout(resumeWhenDueAndIdle, 1_000);
        return;
      }
      void resumeBoundUpload(manifest.jobHandle as string, manifest, csrf).catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : "페이지 업로드 binding 복구를 재개하지 못했습니다.");
      });
    };
    timer = window.setTimeout(resumeWhenDueAndIdle, Math.max(0, Date.parse(retry.nextAttemptAt) - Date.now()));
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [csrf, manifest, resumeBoundUpload]);

  useEffect(() => {
    const resumeVisible = () => {
      if (document.visibilityState === "visible" && handle && status
        && manifest?.lifecycle !== "delete-pending" && !isOmrMonitorTerminal(status)) {
        if ((status.kind === "created" || status.kind === "uploading") && csrf && manifest) {
          const retryAt = manifest.pendingUploadRetry
            ? Date.parse(manifest.pendingUploadRetry.nextAttemptAt) : undefined;
          if (retryAt === undefined || retryAt <= Date.now()) {
            void resumeBoundUpload(handle, manifest, csrf).catch((caught: unknown) => {
              setError(caught instanceof Error ? caught.message : "페이지 업로드를 재개하지 못했습니다.");
            });
          }
        } else if (status.kind !== "retry-pending" || isOmrMonitorRetryDue(status, Date.now())) {
          void monitor(handle);
        }
      }
    };
    document.addEventListener("visibilitychange", resumeVisible);
    return () => document.removeEventListener("visibilitychange", resumeVisible);
  }, [csrf, handle, manifest, monitor, resumeBoundUpload, status]);

  const start = async () => {
    if (omrFreshStartAction(freshStart) === "unlock-correction") return;
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
      if (sourceKind === "musicxml" || sourceKind === "mxl") throw new RangeError("OMR_REQUEST_INVALID");
      let authority = manifestRef.current;
      if (freshIntent.forceFresh && authority) {
        abortCurrentMonitor();
        const removedKeys = await clearOmrBrowserJobManifest(authority.manifestDigest);
        if (removedKeys?.createStorageKey) localStorage.removeItem(removedKeys.createStorageKey);
        if (removedKeys?.recoveryStorageKey) localStorage.removeItem(removedKeys.recoveryStorageKey);
        authority = undefined;
        manifestRef.current = undefined;
        setManifest(undefined);
      }
      if (!authority) {
        const createStorageKey = `harmonymaker:omr-create:v4:${preflight.capabilitySnapshotDigest}:${sourceKind}:${pages.map((page) => page.rawDigest).join(":")}`;
        authority = await createOmrBrowserJobManifest({
          sourceKind,
          capabilitySnapshotDigest: preflight.capabilitySnapshotDigest,
          createStorageKey,
          pages: pages.map((page, pageIndex) => ({
            pageIndex,
            rawDigest: page.rawDigest,
            canonicalPageDigest: page.canonicalPageDigest,
            mimeType: page.mimeType,
            bytes: page.bytes,
            width: page.width,
            height: page.height,
            clientQuality: page.clientQuality,
            quality: page.quality,
            warnAcknowledged: page.quality.status !== "warn" || warnAccepted,
            duplicateConfirmed: duplicatesAccepted,
          })),
        });
        await persistNewOmrBrowserJobManifest(authority);
        manifestRef.current = authority;
        setManifest(authority);
      }
      const activeAuthority = authority;
      if (!activeAuthority) throw new RangeError("OMR_BROWSER_MANIFEST_INVALID");
      const createStorageKey = activeAuthority.createStorageKey;
      const recoveryStorageKey = activeAuthority.recoveryStorageKey;
      const acquisition = await acquireOmrJob<OmrPublicStatus>({
        storage: localStorage, createStorageKey, recoveryStorageKey, canonicalInputIdentity: createStorageKey, forceFresh: freshIntent.forceFresh,
        createRequest: () => ({
          pageCount: activeAuthority.pages.length,
          pages: activeAuthority.pages.map((page) => ({ pageIndex: page.pageIndex, pageDigest: page.rawDigest, mimeType: page.mimeType })),
          sourceKind: activeAuthority.sourceKind,
          rights: { basis: "user-confirmed-rights", allowedUses: ["generation", "provider-transfer"], confirmedAt: new Date().toISOString() },
          providerTransferConsent: true, consentCapabilitySnapshotDigest: activeAuthority.capabilitySnapshotDigest, idempotencyKey: crypto.randomUUID(),
        }),
        validateCreateRequest: (request) => request.pageCount === activeAuthority.pages.length && request.sourceKind === activeAuthority.sourceKind
          && request.consentCapabilitySnapshotDigest === activeAuthority.capabilitySnapshotDigest
          && Array.isArray(request.pages) && request.pages.every((page, pageIndex) => {
            const expected = activeAuthority.pages[pageIndex];
            return page !== null && typeof page === "object"
              && (page as Readonly<Record<string, unknown>>).pageIndex === pageIndex
              && (page as Readonly<Record<string, unknown>>).pageDigest === expected?.rawDigest
              && (page as Readonly<Record<string, unknown>>).mimeType === expected?.mimeType;
          }),
        recover: async (storedHandle) => (await json<{ readonly status: OmrPublicStatus }>(await fetch(`/api/omr/jobs/${encodeURIComponent(storedHandle)}`, { cache: "no-store" }))).status,
        create: async (request) => json<{ readonly handle: string }>(await fetch("/api/omr/jobs", { method: "POST", headers, body: JSON.stringify(request) })),
        validateCreatedHandle: isOmrJobHandleShape,
      });
      if (acquisition.kind === "fresh-start-required") {
        if (acquisition.reason === "retired-create-replay") {
          abortCurrentMonitor();
          await clearOmrBrowserJobManifest(activeAuthority.manifestDigest);
          manifestRef.current = undefined; setManifest(undefined);
        }
        setFreshStart(requireExplicitOmrFreshStart(acquisition.reason));
        setHandleRecoveryStorageKey(undefined); setHandle(undefined); setStatus(undefined);
        setError(acquisition.reason === "stale-recovery-handle"
          ? "이전 작업을 복구할 수 없습니다. 권리와 제공자 전송 동의를 다시 확인한 뒤 ‘새 작업 시작’을 선택하세요."
          : acquisition.reason === "invalid-persisted-create"
            ? "저장된 생성 요청이 손상되었거나 현재 입력과 맞지 않습니다. 자동 요청은 중단되었습니다. 확인 후 ‘새 작업 시작’을 선택하세요."
            : "이전 생성 요청은 만료되어 재사용할 수 없습니다. 권리와 제공자 전송 동의를 다시 확인한 뒤 ‘새 작업 시작’을 선택하세요.");
        return;
      }
      if (acquisition.kind === "create-preserved") {
        const labels = {
          pending: "같은 생성 키의 처리 완료를 기다리고 있습니다.",
          "outcome-uncertain": "같은 생성 키의 제공자 생성 결과를 확인해야 합니다.",
          "reconciliation-required": "같은 생성 키의 조정이 필요합니다.",
          quota: "사용 한도가 회복되면 같은 생성 키로 다시 시도할 수 있습니다.",
          "deterministic-rejection": "생성 요청이 거부되었습니다. 진단을 위해 같은 생성 키와 manifest를 보존했습니다.",
          transient: "일시적 오류입니다. 같은 생성 키와 manifest로 안전하게 다시 시도할 수 있습니다.",
        } as const;
        if (canResetOmrCreateAfterCorrection(acquisition.outcome)) {
          await applyOmrCreateCorrection(acquisition.outcome, {
            refreshPreflight: async () => (await json<{ readonly preflight: OmrProviderPreflight }>(
              await fetch("/api/omr/provider-capabilities", { cache: "no-store" }),
            )).preflight,
            acceptRefreshedPreflight: setPreflight,
            revokeTransferConsent: () => setTransfer(false),
          });
          setFreshStart(requireExplicitOmrFreshStart("pre-dispatch-correction"));
        }
        setError(`${acquisition.outcome.code}: ${acquisition.outcome.messageKo ?? labels[acquisition.outcome.kind]}`);
        return;
      }
      const jobHandle = acquisition.handle;
      const recoveredStatus = acquisition.recoveredStatus;
      authority = await bindOmrBrowserJobManifest(activeAuthority.manifestDigest, jobHandle);
      manifestRef.current = authority; setManifest(authority);
      setFreshStart({ mode: "normal" });
      setHandleRecoveryStorageKey(recoveryStorageKey);
      setHandle(jobHandle); setStatus(recoveredStatus ?? { kind: "created" });
      if (!recoveredStatus || recoveredStatus.kind === "created" || recoveredStatus.kind === "uploading") {
        await resumeBoundUpload(jobHandle, authority, csrfToken);
      }
      if (recoveredStatus && recoveredStatus.kind !== "created" && recoveredStatus.kind !== "uploading") {
        const applyController = new AbortController();
        await applyPublicStatus({ jobHandle, manifestDigest: authority.manifestDigest }, recoveredStatus, applyController.signal);
      }
      if (recoveredStatus && recoveredStatus.kind !== "created" && recoveredStatus.kind !== "uploading"
        && shouldStartOmrMonitorNow(recoveredStatus, Date.now())) void monitor(jobHandle);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "OMR 작업을 시작하지 못했습니다."); }
    finally { finishOmrStart(startInFlightRef); setBusy(false); }
  };

  const unlockCreateCorrection = async () => {
    if (omrFreshStartAction(freshStart) !== "unlock-correction") return;
    abortCurrentMonitor();
    setBusy(true); setError(undefined);
    try {
      const authority = manifestRef.current;
      if (authority) {
        const removedKeys = await clearOmrBrowserJobManifest(authority.manifestDigest);
        if (removedKeys?.createStorageKey) localStorage.removeItem(removedKeys.createStorageKey);
        if (removedKeys?.recoveryStorageKey) localStorage.removeItem(removedKeys.recoveryStorageKey);
      }
      manifestRef.current = undefined; setManifest(undefined);
      setHandleRecoveryStorageKey(undefined); setHandle(undefined); setStatus(undefined); setResult(undefined);
      setFreshStart({ mode: "normal" });
      setMessage("확정된 no-dispatch 생성 요청과 K1을 폐기하고 입력을 잠금 해제했습니다. 입력 또는 동의를 수정한 뒤 별도로 인식을 시작하세요.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "생성 수정 잠금을 해제하지 못했습니다.");
    } finally { setBusy(false); }
  };

  const submitInput = async (response: import("../../domain/omr/contracts").VendorInputResponse) => {
    if (!handle) return;
    setBusy(true); setError(undefined);
    try {
      await json(await mutate(`/api/omr/jobs/${encodeURIComponent(handle)}/input`, "POST", response));
      void monitor(handle);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "추가 입력을 제출하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const resumeBrowserWork = async () => {
    if (!handle || !status || !manifest || manifest.lifecycle === "delete-pending") return;
    setBusy(true); setError(undefined);
    try {
      if (authorityAction === "resume-upload") {
        if (!csrf) throw new RangeError("OMR_SESSION_CSRF_UNAVAILABLE");
        await resumeBoundUpload(handle, manifest, csrf);
      } else void monitor(handle);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "OMR 작업을 재개하지 못했습니다.");
    } finally { setBusy(false); }
  };

  const cancel = async () => {
    if (!handle) return;
    abortCurrentMonitor();
    setBusy(true); setError(undefined);
    try { await json(await mutate(`/api/omr/jobs/${encodeURIComponent(handle)}/cancel`, "POST")); void monitor(handle); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "취소하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!handle) return;
    abortCurrentMonitor();
    setBusy(true); setError(undefined);
    try {
      const beforeDispatch = manifestRef.current;
      if (beforeDispatch?.jobHandle === handle && beforeDispatch.lifecycle !== "delete-pending") {
        const pending = await markOmrBrowserJobDeletePending(beforeDispatch.manifestDigest, {
          vendorStatus: "failed",
        });
        manifestRef.current = pending;
        setManifest(pending);
      }
      const response = await json<{ readonly deletion: OmrDeleteResult }>(await mutate(`/api/omr/jobs/${encodeURIComponent(handle)}`, "DELETE"));
      setMessage(`로컬 handle 삭제: ${String(response.deletion.localHandleDeleted)} · 제공자 삭제: ${response.deletion.vendor.status}`);
      if (omrDeletionDisposition(response.deletion) === "pending-preserve") {
        const currentManifest = manifestRef.current;
        if (currentManifest?.jobHandle === handle) {
          const updated = await markOmrBrowserJobDeletePending(currentManifest.manifestDigest, {
            vendorStatus: response.deletion.vendor.status,
            ...(response.deletion.cleanupState === "pending" && response.deletion.nextAttemptAt
              ? { nextAttemptAt: response.deletion.nextAttemptAt } : {}),
          });
          manifestRef.current = updated;
          setManifest(updated);
        }
        setMessage(`삭제 조정이 아직 완료되지 않았습니다. exact handle과 manifest를 유지합니다.${response.deletion.cleanupState === "pending" && response.deletion.nextAttemptAt ? ` 다음 시도 ${response.deletion.nextAttemptAt}` : ""}`);
        return;
      }
      if (handleRecoveryStorageKey) localStorage.removeItem(handleRecoveryStorageKey);
      const currentManifest = manifestRef.current;
      if (currentManifest) await clearOmrBrowserJobManifest(currentManifest.manifestDigest);
      manifestRef.current = undefined; setManifest(undefined);
      setHandleRecoveryStorageKey(undefined);
      setHandle(undefined); setStatus(undefined); setResult(undefined);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "삭제하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const handoff = async () => {
    if (!result) return;
    abortCurrentMonitor();
    setBusy(true); setError(undefined);
    try {
      const authority = manifestRef.current;
      if (!authority || authority.jobHandle !== handle || authority.lifecycle !== "completed") throw new RangeError("OMR_BROWSER_MANIFEST_BINDING_CONFLICT");
      await storeOmrImportHandoff({
        fileName: "omr-result.musicxml", mimeType: "application/vnd.recordare.musicxml+xml",
        bytes: new TextEncoder().encode(result.rawMusicXml), omrProviderResult: result,
        pageImages: await Promise.all(authority.pages.map(async (page) => ({
          pageIndex: page.pageIndex,
          rawDigest: page.rawDigest,
          canonicalPageDigest: page.canonicalPageDigest,
          bytes: new Uint8Array(await page.bytes.arrayBuffer()),
          mimeType: page.mimeType,
        }))),
      });
      if (handleRecoveryStorageKey) localStorage.removeItem(handleRecoveryStorageKey);
      await clearOmrBrowserJobManifest(authority.manifestDigest);
      manifestRef.current = undefined; setManifest(undefined);
      setHandleRecoveryStorageKey(undefined);
      router.push("/import");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Quick Review로 전달하지 못했습니다."); setBusy(false); }
  };

  const move = (index: number, direction: -1 | 1) => {
    if (manifestRef.current) return;
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
        <label className={styles.dropZone} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (manifestLocked) return; const files = [...event.dataTransfer.files]; if (files.length) void selectFiles(files); }}>
          <span>{busy ? "처리 중…" : "PDF / PNG / JPEG / MusicXML / MXL 선택 또는 드롭"}</span>
          <input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.musicxml,.xml,.mxl,application/pdf,image/png,image/jpeg,application/vnd.recordare.musicxml+xml,application/vnd.recordare.musicxml" onChange={onFile} disabled={busy || manifestLocked || invalidManifestRecovery} />
        </label>
        {fixtureControlsEnabled && preflight?.capabilities.vendorId === "hm-reference" ? <div className={styles.actions}><button type="button" onClick={() => void loadReference()} disabled={busy || manifestLocked}>결정적 reference E2E 불러오기</button><button type="button" onClick={() => void loadCanonicalDuplicateReference()} disabled={busy || manifestLocked}>canonical duplicate JPEG E2E</button></div> : null}
        {manifestLocked ? <p className={styles.notice}>이 페이지 순서·digest·미리보기·업로드 identity는 활성 OMR 작업에 고정되어 있습니다. 작업 데이터를 삭제한 뒤에만 입력을 교체할 수 있습니다.</p> : null}
        {invalidManifestRecovery ? <div className={styles.actions}><button type="button" onClick={() => void discardInvalidManifest()} disabled={busy}>손상된 저장 manifest 폐기</button></div> : null}
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
          <div className={styles.actions}><button type="button" onClick={() => move(index, -1)} disabled={index === 0 || busy || manifestLocked}>앞으로</button><button type="button" onClick={() => move(index, 1)} disabled={index === pages.length - 1 || busy || manifestLocked}>뒤로</button></div>
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
        <div className={styles.actions}><button className="primary" type="button" onClick={() => void start()} disabled={!ready || busy || Boolean(handle) || omrFreshStartAction(freshStart) === "unlock-correction"}>{freshStart.mode === "explicit-required" ? "새 작업 시작" : "인식 시작"}</button>{omrFreshStartAction(freshStart) === "unlock-correction" ? <button type="button" onClick={() => void unlockCreateCorrection()} disabled={busy}>manifest·K1 폐기 후 입력 수정</button> : null}{handle && status && manifest?.lifecycle !== "delete-pending" && canCancelOmrStatus(status) ? <button type="button" onClick={() => void cancel()} disabled={busy}>취소</button> : null}{handle ? <button type="button" onClick={() => void remove()} disabled={busy}>{manifest?.lifecycle === "delete-pending" ? "삭제 상태 다시 확인" : "작업·보관 데이터 삭제"}</button> : null}</div>
      </section> : null}

      {status ? <section className="panel" aria-labelledby="status-heading">
        <h2 id="status-heading">3. 작업 상태</h2>
        <p className={styles.status}>{statusLabels[status.kind]}{status.kind === "uploading" ? ` · ${status.uploadedPages}/${status.totalPages}` : ""}{status.kind === "failed" || status.kind === "cancel-failed" || status.kind === "reconciliation-required" ? ` · ${status.code}: ${status.messageKo}` : status.kind === "cancel-pending" ? ` · ${status.messageKo}` : status.kind === "retry-pending" ? ` · ${status.messageKo} · 다음 시도 ${status.nextAttemptAt}` : ""}</p>
        {handle && manifest?.lifecycle !== "delete-pending" && !isOmrMonitorTerminal(status) ? <button type="button" onClick={() => void resumeBrowserWork()} disabled={busy}>{authorityAction === "resume-upload" ? "페이지 업로드 재개" : "상태 확인 재개"}</button> : null}
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
        <div className={styles.actions}><button className="primary" type="button" onClick={() => void handoff()} disabled={busy || authorityAction !== "quick-review"}>정본 importer · Quick Review로 전달</button><button type="button" onClick={() => void remove()} disabled={busy}>{authorityAction === "delete-retry" ? "삭제 상태 다시 확인" : "검토 후 삭제"}</button></div>
      </section> : null}
    </div>
  );
}
