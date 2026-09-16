import { binaryDigest, isSha256LowerHex } from "../digest/canonical";
import { inspectRecoveryXml } from "../../import/review/recovery";
import { validateCandidateTransitions } from "./local-candidate-transitions";
import { beforeEndingStructure } from "./ending-structure-transitions";

export const LOCAL_CANDIDATE_ARTIFACTS = ["rawXml", "candidateXml", "evidence", "links", "geometry", "provenance", "ocr", "slashes"] as const;
type ArtifactName = typeof LOCAL_CANDIDATE_ARTIFACTS[number];
export interface LocalCandidateBundle {
  readonly version: "hm-local-candidate-v1";
  readonly manifestSha256: string;
  readonly image: { readonly base64: string; readonly sha256: string; readonly mimeType: "image/png" | "image/jpeg"; readonly width: number; readonly height: number };
  /** Exact UTF-8 files, including every unresolved record and original status. */
  readonly artifacts: Readonly<Record<ArtifactName, { readonly text: string; readonly sha256: string }>>;
}
export interface CandidateRecord {
  readonly status?: string; readonly feature?: string; readonly reason?: string;
  readonly sourceBox?: readonly number[]; readonly box?: readonly number[];
  readonly [key: string]: unknown;
}
export interface LocalCandidateEvidence {
  readonly sourceEligibility: { readonly approved: false; readonly reason: string };
  readonly changes: readonly CandidateRecord[]; readonly candidates: readonly CandidateRecord[];
  readonly unresolvedEventLinks: readonly string[]; readonly unresolvedMeasureLinks: readonly string[];
  readonly limitations: readonly string[];
}
export function localCandidateEvidence(bundle: LocalCandidateBundle): LocalCandidateEvidence {
  return JSON.parse(bundle.artifacts.evidence.text);
}
export function localCandidateImageBytes(bundle: LocalCandidateBundle): Uint8Array {
  return Uint8Array.from(atob(bundle.image.base64), (c) => c.charCodeAt(0));
}
export function localCandidateReviewSummary(bundle: LocalCandidateBundle): string {
  const e = localCandidateEvidence(bundle);
  return `자동 후보 전체 대조 필요 · 연결 미확정 이벤트 ${e.unresolvedEventLinks.length}개 / 마디 ${e.unresolvedMeasureLinks.length}개 · 보완 미확정 ${e.candidates.filter((c) => c.status !== "applied-candidate").length}개 · 자동 변경 ${e.changes.length}개도 원본 확인 필요. 박자·조성·반복·템포·가사·곡선과 전체 성부를 포함합니다. 원래 근거와 미확정 기록은 전달 묶음에 보존됩니다.`;
}
function fail(): never { throw new RangeError("LOCAL_CANDIDATE_BINDING_INVALID"); }
function dimensions(data: Uint8Array, mime: string): readonly number[] {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (mime === "image/png" && data.length >= 24 && data.slice(0, 8).join() === "137,80,78,71,13,10,26,10") return [v.getUint32(16), v.getUint32(20)];
  if (mime !== "image/jpeg" || data[0] !== 255 || data[1] !== 216) return fail();
  let at = 2;
  while (at + 4 < data.length) {
    if (data[at++] !== 255) return fail();
    while (data[at] === 255) at++;
    const marker = data[at++];
    if (marker === 217 || marker === 218) break;
    if (marker === 1 || marker >= 208 && marker <= 215) continue;
    const length = v.getUint16(at);
    if (length < 2 || at + length > data.length) return fail();
    if ([192, 193, 194].includes(marker) && length >= 7) return [v.getUint16(at + 5), v.getUint16(at + 3)];
    at += length;
  }
  return fail();
}
function numericFraction(value: string): number {
  const [n, d = "1"] = value.split("/"); return Number(n) / Number(d);
}

/** Integrity proves which files/coordinates were paired, never musical correctness. */
export async function validateLocalCandidate(bundle: LocalCandidateBundle): Promise<void> {
  if (!bundle || bundle.version !== "hm-local-candidate-v1" || !bundle.image || !bundle.artifacts
    || !isSha256LowerHex(bundle.manifestSha256) || !isSha256LowerHex(bundle.image.sha256)
    || typeof bundle.image.base64 !== "string" || bundle.image.base64.length > 44_000_000
    || bundle.image.base64.length % 4 !== 0 || /[^A-Za-z0-9+/=]/u.test(bundle.image.base64)) fail();
  let total = 0;
  for (const name of LOCAL_CANDIDATE_ARTIFACTS) {
    const artifact = bundle.artifacts[name];
    if (!artifact || typeof artifact.text !== "string" || !isSha256LowerHex(artifact.sha256)) fail();
    total += artifact.text.length;
    if (total > 24_000_000 || await binaryDigest(new TextEncoder().encode(artifact.text)) !== artifact.sha256) fail();
  }
  if (Object.keys(bundle.artifacts).length !== LOCAL_CANDIDATE_ARTIFACTS.length) fail();
  const manifest = "image:" + bundle.image.sha256 + "\n" + [...LOCAL_CANDIDATE_ARTIFACTS].sort().map((key) => key + ":" + bundle.artifacts[key].sha256 + "\n").join("");
  if (await binaryDigest(new TextEncoder().encode(manifest)) !== bundle.manifestSha256) fail();
  const image = localCandidateImageBytes(bundle), size = dimensions(image, bundle.image.mimeType);
  if (await binaryDigest(image) !== bundle.image.sha256 || size[0] !== bundle.image.width || size[1] !== bundle.image.height
    || size[0] < 1 || size[1] < 1 || size[0] * size[1] > 40_000_000) fail();
  const e = JSON.parse(bundle.artifacts.evidence.text);
  if (e?.schemaVersion !== 1 || e.runtimeOracleUsed !== false || e.input?.sha256 !== bundle.image.sha256
    || JSON.stringify(e.input?.size) !== JSON.stringify(size)
    || e.engine?.rawXmlSha256 !== bundle.artifacts.rawXml.sha256 || e.sourceEligibility?.approved !== false
    || typeof e.sourceEligibility.reason !== "string"
    || !["changes", "candidates", "unresolvedEventLinks", "unresolvedMeasureLinks", "limitations"].every((key) => Array.isArray(e[key]))) fail();
  const links = JSON.parse(bundle.artifacts.links.text), provenance = JSON.parse(bundle.artifacts.provenance.text);
  const geometry = JSON.parse(bundle.artifacts.geometry.text);
  if (!links?.events || !Array.isArray(links.measures) || provenance?.xmlExactReplay !== true
    || !Array.isArray(provenance.events) || !Array.isArray(geometry?.systems) || !geometry.systems.length) fail();
  const raw = inspectRecoveryXml(bundle.artifacts.rawXml.text), candidate = inspectRecoveryXml(beforeEndingStructure(bundle.artifacts.candidateXml.text, e.changes));
  const ids = new Set<string>(), measures = new Set<string>();
  if (raw.length !== candidate.length) fail();
  for (const [i, m] of raw.entries()) {
    const mid = `p${m.part}m${m.measure}`; measures.add(mid);
    if (m.notes.length !== candidate[i].notes.length) fail(); // Only the verified structural suffix can append events.
    for (const n of m.notes) {
      const id = `d0${mid}n${n.event}`; ids.add(id);
      const link = links.events[id], event = link?.event;
      if (!event || event.id !== id || event.partIndex !== m.part || event.measureIndex !== m.measure || event.noteIndex !== n.event
        || event.voice !== n.voice || numericFraction(event.onset) !== numericFraction(n.onset)
        || numericFraction(event.duration) !== numericFraction(n.duration)) fail();
      if (!["physical-candidate", "unresolved"].includes(link.status)) fail();
    }
  }
  if (Object.keys(links.events).length !== ids.size || Object.keys(links.events).some((id) => !ids.has(id))
    || links.measures.length !== measures.size || new Set(links.measures.map((m: { measure: { id: string } }) => m.measure?.id)).size !== measures.size
    || links.measures.some((m: { measure: { id: string }; anchorEventIds?: string[] }) => !measures.has(m.measure?.id) || m.anchorEventIds?.some((id) => !ids.has(id)))
    || provenance.events.length !== ids.size || new Set(provenance.events.map((p: { id: string }) => p.id)).size !== ids.size
    || provenance.events.some((p: { id: string }) => !ids.has(p.id))) fail();
  const unresolvedEvents = Object.keys(links.events).filter((id) => links.events[id].status !== "physical-candidate").sort();
  const unresolvedMeasures = links.measures.filter((m: CandidateRecord) => m.status !== "physical-candidate").map((m: { measure: { id: string } }) => m.measure.id).sort();
  if (JSON.stringify(unresolvedEvents) !== JSON.stringify([...e.unresolvedEventLinks].sort())
    || JSON.stringify(unresolvedMeasures) !== JSON.stringify([...e.unresolvedMeasureLinks].sort())) fail();
  for (const change of e.changes) {
    if (change.reviewRequired !== true || change.measureId && !measures.has(change.measureId)
      || change.eventIds?.some((id: string) => !ids.has(id))) fail();
    if (change.feature === "ending-structure") {
      if (change.inputSha256 !== bundle.image.sha256) fail();
      for (const row of change.lineage) {
        if (row.sourceBox && (row.sourceBox.length !== 4 || row.sourceBox.some((n: number) => !Number.isFinite(n))
          || row.sourceBox[0] < 0 || row.sourceBox[1] < 0 || row.sourceBox[2] > size[0] || row.sourceBox[3] > size[1]
          || row.sourceBox[2] <= row.sourceBox[0] || row.sourceBox[3] <= row.sourceBox[1])) fail();
      }
    }
  }
  for (const system of geometry.systems) if (system.page !== 0 || JSON.stringify(system.originalImageSize) !== JSON.stringify(size)) fail();
  validateCandidateTransitions(bundle.artifacts.rawXml.text, bundle.artifacts.candidateXml.text, e.changes);
  // Validate display boxes in the original raster, not attention/rendered coordinates.
  const boxes = [...e.changes, ...e.candidates, ...Object.values(links.events), ...links.measures] as CandidateRecord[];
  for (const record of boxes) {
    const box = record.sourceBox ?? record.box;
    if (box && (box.length !== 4 || box.some((n) => !Number.isFinite(n)) || box[0] < 0 || box[1] < 0
      || box[2] > size[0] || box[3] > size[1] || box[2] <= box[0] || box[3] <= box[1])) fail();
  }
}

export async function parseLocalCandidate(file: File): Promise<LocalCandidateBundle> {
  if (file.size > 64_000_000) throw new RangeError("LOCAL_CANDIDATE_LIMIT");
  const bundle = JSON.parse(await file.text()) as LocalCandidateBundle;
  await validateLocalCandidate(bundle);
  return bundle;
}
