import { binaryDigest } from "../../domain/digest/canonical";
import { exactJson } from "./encoding";
import { performerId } from "../../domain/ids";
import { localCandidateEvidence, validateLocalCandidate, type LocalCandidateBundle } from "../../domain/omr/local-candidate";
import { inspectMusicXmlWorkspace } from "../musicxml/parser-core";
import { DEFAULT_IMPORT_SECURITY_LIMITS, type Step3ImportVersions } from "../musicxml/types";
import { xmlChild, xmlText } from "../musicxml/xml";
import { extractMusicXmlFromMxl } from "../mxl/archive";
import { recoveryXmlRoot } from "../review/recovery";
import { replayStructuralRecovery, structuralCandidateXml, type StructuralRecovery } from "../review/structural-recovery";
import { compareFractions } from "../../domain/fraction";
import type { WorkspaceIssue, WorkspaceOrigin, WorkspaceScope, WorkspaceState } from "./model";

const enc = new TextEncoder();
export function encodeBase64(bytes: Uint8Array): string {
  let s = ""; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
}
export function decodeBase64(text: string): Uint8Array {
  if (typeof text !== "string" || text.length > 88_000_000 || text.length % 4 || /[^A-Za-z0-9+/=]/u.test(text)) throw new RangeError("WORKSPACE_BASE64_INVALID");
  return Uint8Array.from(atob(text), c => c.charCodeAt(0));
}
export async function originFromMusicXml(bytes: Uint8Array, fileName: string): Promise<WorkspaceOrigin> {
  let xmlBytes = bytes;
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const r = extractMusicXmlFromMxl(bytes, DEFAULT_IMPORT_SECURITY_LIMITS);
    if (r.status !== "complete") throw new RangeError("WORKSPACE_MXL_SECURITY_REJECTED");
    xmlBytes = r.musicXmlBytes;
  }
  const xml = new TextDecoder("utf-8", { fatal: true }).decode(xmlBytes);
  recoveryXmlRoot(xml);
  return { kind: "musicxml", fileName, xml, xmlDigest: await binaryDigest(enc.encode(xml)), originalFile: { base64: encodeBase64(bytes), sha256: await binaryDigest(bytes) } };
}
export async function originFromLocalCandidate(bundle: LocalCandidateBundle, fileName: string): Promise<WorkspaceOrigin> {
  await validateLocalCandidate(bundle);
  return { kind: "local-omr", fileName, xml: bundle.artifacts.candidateXml.text, xmlDigest: bundle.artifacts.candidateXml.sha256, localCandidate: structuredClone(bundle) };
}

async function replayLegacyData(text: string) {
  if (text.length > 64_000_000) throw new RangeError("WORKSPACE_LEGACY_LIMIT");
  const old = JSON.parse(text) as { version: string; workspace: StructuralRecovery; pages: { mimeType: string; dataUrl: string; rawDigest: string; pageIndex: number }[] };
  if (old.version !== "hm-structural-recovery-bundle-v1" || !Array.isArray(old.pages) || old.pages.length > 12) throw new RangeError("WORKSPACE_LEGACY_INVALID");
  const state = await replayStructuralRecovery(old.workspace);
  let pageBytes = 0;
  for (const [index, page] of old.pages.entries()) {
    if (page.pageIndex !== index || !["image/png", "image/jpeg"].includes(page.mimeType) || !page.dataUrl.startsWith(`data:${page.mimeType};base64,`)) throw new RangeError("WORKSPACE_LEGACY_PAGE_INVALID");
    const bytes = decodeBase64(page.dataUrl.slice(page.dataUrl.indexOf(",") + 1)); pageBytes += bytes.length;
    if (await binaryDigest(bytes) !== page.rawDigest || pageBytes > 32_000_000) throw new RangeError("WORKSPACE_LEGACY_PAGE_INVALID");
  }
  for (const d of old.workspace.documents) if (d.localCandidate && (old.pages.length !== 1 || old.pages[0].rawDigest !== d.localCandidate.image.sha256)) throw new RangeError("WORKSPACE_LEGACY_EVIDENCE_INVALID");
  return { old, state, xml: structuralCandidateXml(state, old.workspace.documents[0].recovery.originalXml) };
}
// Validation/seed/projection all read the same immutable legacy bytes. Replay
// once per exact text in a session, not three times per import. One entry bounds
// retention. A changed byte always requires a new security/history replay.
let legacyCache: {text:string;result:ReturnType<typeof replayLegacyData>}|undefined;
function legacyData(text:string) {
  if(legacyCache?.text===text)return legacyCache.result;
  const result=replayLegacyData(text);legacyCache={text,result};
  void result.catch(()=>{if(legacyCache?.result===result)legacyCache=undefined;});return result;
}
export async function originFromLegacyBundle(text: string, fileName: string): Promise<WorkspaceOrigin> {
  const legacy = await legacyData(text);
  return { kind: "legacy-recovery", fileName, xml: legacy.xml, xmlDigest: await binaryDigest(enc.encode(legacy.xml)), legacyBundle: text };
}
export async function validateWorkspaceOrigin(origin: WorkspaceOrigin): Promise<void> {
  if (!origin || !["musicxml", "local-omr", "legacy-recovery"].includes(origin.kind) || typeof origin.fileName !== "string" || origin.fileName.length > 512
    || typeof origin.xml !== "string" || enc.encode(origin.xml).length > 4_000_000 || await binaryDigest(enc.encode(origin.xml)) !== origin.xmlDigest) throw new RangeError("WORKSPACE_ORIGIN_INVALID");
  recoveryXmlRoot(origin.xml);
  if (origin.kind === "local-omr") {
    if (!origin.localCandidate) throw new RangeError("WORKSPACE_EVIDENCE_REQUIRED");
    await validateLocalCandidate(origin.localCandidate);
    if (origin.localCandidate.artifacts.candidateXml.text !== origin.xml) throw new RangeError("WORKSPACE_INPUT_SUBSTITUTED");
  } else if (origin.localCandidate) throw new RangeError("WORKSPACE_ORIGIN_KIND_INVALID");
  if (origin.kind === "legacy-recovery") {
    if (!origin.legacyBundle || (await legacyData(origin.legacyBundle)).xml !== origin.xml) throw new RangeError("WORKSPACE_LEGACY_SUBSTITUTED");
  } else if (origin.legacyBundle) throw new RangeError("WORKSPACE_ORIGIN_KIND_INVALID");
  if (origin.originalFile) {
    const bytes = decodeBase64(origin.originalFile.base64);
    if (await binaryDigest(bytes) !== origin.originalFile.sha256 || (await originFromMusicXml(bytes, origin.fileName)).xml !== origin.xml) throw new RangeError("WORKSPACE_INPUT_SUBSTITUTED");
  }
  if (origin.kind === "musicxml" && origin.xml.includes("harmonymaker-local-candidate")) throw new RangeError("WORKSPACE_EVIDENCE_REQUIRED");
}

export async function workspaceEvidenceDigest(origin: WorkspaceOrigin): Promise<string> {
  return binaryDigest(enc.encode(exactJson(origin)));
}
function candidateIssues(bundle: LocalCandidateBundle): WorkspaceIssue[] {
  const e = localCandidateEvidence(bundle), out: WorkspaceIssue[] = [];
  const append = (id: string, scope: WorkspaceScope, messageKo: string, kind: WorkspaceIssue["kind"], evidenceRef: string) => out.push({ id, kind, scope, targetIds: scope.kind === "measure" ? [scope.measureId] : [], messageKo, requiredAction: "compare", evidenceRef, impacts: ["arrange", "play-source", "export-source"] });
  for (const id of e.unresolvedEventLinks) {
    const mid = /^d0(p\d+m\d+)n\d+$/u.exec(id)?.[1];
    append(`link:${id}`, mid ? { kind: "measure", measureId: mid } : { kind: "document" }, `원본 음표/쉼표의 연결을 확인하세요: ${id}`, "correspondence", `links/events/${id}`);
  }
  for (const id of e.unresolvedMeasureLinks) append(`measure-link:${id}`, { kind: "measure", measureId: id }, `원본 마디 경계를 확인하세요: ${id}`, "correspondence", `links/measures/${id}`);
  for (const [index, c] of e.candidates.entries()) {
    if (c.status === "applied-candidate") continue; // Still covered by explicit measure comparison, never auto-approved.
    const mid = Number.isSafeInteger(c.measureIndex) ? `p0m${c.measureIndex}` : undefined;
    append(`candidate:${index}`, mid ? { kind: "measure", measureId: mid } : { kind: "document" },
      `${String(c.feature ?? "음악")} 후보: ${String(c.reason ?? c.status ?? "미확정")}`,
      c.feature === "lyric" ? "lyrics" : c.feature === "chord" || c.feature === "meter" ? "correspondence" : "unknown", `evidence/candidates/${index}`);
  }
  return out;
}

/** Reuses the secure importer, keeping its immutable observations and all voices.
 * Only the separate compiler can turn this preservation model into Source. */
export async function seedWorkspace(origin: WorkspaceOrigin, versions: Step3ImportVersions, id: string): Promise<WorkspaceState> {
  await validateWorkspaceOrigin(origin);
  const result = await inspectMusicXmlWorkspace(enc.encode(origin.xml), { algorithmVersions: versions, originalFileName: origin.fileName, identityFactory: () => id });
  let music = result.status === "review-required" ? result.draft : undefined;
  const issues: WorkspaceIssue[] = result.diagnostics.filter(d => !["workspace-overfull", "invalid-pitch"].includes(String(d.details?.issue)) && d.code !== "UNSUPPORTED_MODULATION").map((d, i) => {
    const part = d.details?.partOrdinal, measure = d.details?.measureOrdinal;
    const mid = Number.isSafeInteger(part) && Number.isSafeInteger(measure) ? `p${part}m${measure}` : undefined;
    return { id: `import:${i}`, kind: "unsupported", scope: mid ? { kind: "measure", measureId: mid, ...(typeof d.details?.candidateKey === "string" ? { voiceKey: d.details.candidateKey } : {}) } : { kind: "document" },
      targetIds: mid ? [mid] : [], messageKo: d.messageKo, requiredAction: "unsupported", evidenceRef: `import-diagnostic/${d.id}`, impacts: ["arrange", "play-source", "export-source"] };
  });
  if (origin.localCandidate) issues.push(...candidateIssues(origin.localCandidate));
  if (origin.legacyBundle && music) {
    const { old, state } = await legacyData(origin.legacyBundle);
    // The old serializer omitted mode. Restore observations from each immutable
    // input context, not from a globally guessed key or a particular score name.
    const observed = new Map<string, NonNullable<typeof music>["parts"][number]["measures"][number]["keyObservation"]>();
    for (const doc of old.workspace.documents) {
      const parsed = await inspectMusicXmlWorkspace(enc.encode(doc.recovery.originalXml), { algorithmVersions: versions, identityFactory: () => id });
      if (parsed.status === "review-required") for (const m of parsed.draft.parts[0].measures) observed.set(`${doc.id}:m${m.ordinal}`, m.keyObservation);
    }
    music = { ...music, parts: music.parts.map(p => ({ ...p, measures: p.measures.map((m, index) => {
      const prior = state.measures[index]; if (!prior) throw new RangeError("WORKSPACE_LEGACY_MAPPING_INVALID");
      const ordered = [...prior.notes].sort((a,b) => (xmlText(xmlChild(a.node,"voice")) || "1").localeCompare(xmlText(xmlChild(b.node,"voice")) || "1") || compareFractions(a.onset,b.onset) || a.id.localeCompare(b.id));
      const keyObservation = observed.get(prior.origin);
      if(keyObservation&&prior.fifths!==undefined&&keyObservation.fifths!==prior.fifths) issues.push({
        id:`legacy-key:${prior.id}`,kind:"unsupported",scope:{kind:"measure",measureId:prior.id},targetIds:[prior.id],
        messageKo:`구형 교정 조표 fifths=${prior.fifths}와 불변 원본 관찰 fifths=${keyObservation.fifths}가 다릅니다. 두 값을 보존했으며, 이 조표 교정의 유효 문맥 승격은 1차 변환에서 지원하지 않습니다.`,
        requiredAction:"unsupported",evidenceRef:"legacyBundle/workspace/operations",impacts:["arrange","play-source","export-source"]});
      return { ...m, workspaceMeasureId: prior.id, ...(keyObservation ? { keyObservation: { ...keyObservation, contextId: `${prior.documentId}:${keyObservation.contextId}` } } : {}),
        leadEvents: m.leadEvents.map(e => { const ordinal = Number(/n(\d+)$/u.exec(e.workspaceEventId ?? "")?.[1]); const oldEvent = ordered[ordinal]; if (!oldEvent) throw new RangeError("WORKSPACE_LEGACY_MAPPING_INVALID"); return { ...e, workspaceEventId: oldEvent.id }; }) };
    }) })) };
    for (const [mid, detail] of Object.entries(state.uncertainties)) issues.push({ id: `legacy:${mid}`, kind: "unknown", scope: { kind: "measure", measureId: mid }, targetIds: [mid], messageKo: detail, requiredAction: "compare", evidenceRef: "legacyBundle/workspace", impacts: ["arrange", "play-source", "export-source"] });
  }
  return { ...(music ? { music } : {}), issues, attestations: [], request: { range: "whole-score", rhythmVoices: [], keys: {}, singerCount: 1, performers: [{ id: performerId(0), displayName: "Lead" }], sections: music?.sections ?? [], lyricVerses: {}, policy: "existing-wag-v1", preset: "standard" } };
}

export function workspaceOriginalImages(origin: WorkspaceOrigin): readonly string[] {
  if (origin.localCandidate) return [`data:${origin.localCandidate.image.mimeType};base64,${origin.localCandidate.image.base64}`];
  if (origin.legacyBundle) return (JSON.parse(origin.legacyBundle).pages as { dataUrl: string }[]).map(p => p.dataUrl);
  return [];
}
