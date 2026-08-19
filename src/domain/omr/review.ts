import { parseChord } from "../chord/parser";
import { canonicalJson, semanticDigest } from "../digest/canonical";
import { digestMusicalSource } from "../digest/source";
import { addFractions, compareFractions, subtractFractions, type Fraction } from "../fraction";
import { sourceRevisionRecordId } from "../ids";
import type { LeadEvent, SongSourceDocument, SourceMeasure } from "../source/model";
import { normalizeSongSourceDocument } from "../source/normalize";
import { computeSourceProvenanceDigest } from "../source/provenance";
import {
  computeRevisionHistoryDigest, createSourceIdRemap, createSourceRevisionProjection,
  revisionRefsEqual, type SourceIdRemap, type SourceIdRemapEntry, type SourceRevisionRecord,
  type SourceRevisionRef,
} from "../source/revision";
import {
  createOmrAutoRepairProposalId, createOmrReviewAlternativeId, createOmrReviewItemId,
  isCorrectionPatchCompatible, remapRevisionScopedTarget,
  type OmrAutoRepairProposal, type OmrCorrectionPatch, type OmrCorrectionRecord,
  type OmrEvidenceArchive, type OmrReviewAlternative, type OmrReviewItem,
  type OmrReviewRecord, type RevisionScopedTarget,
  type SourceEvidenceIndex,
} from "./foundation";
import type { DiagnosticCode } from "../diagnostics";
import { isPlainRecord } from "../validation";
import { remapMusicXmlSourceTargetMap } from "./import-identity";
import {
  applyBarlinePatchToProjection, applyBarlineStructuralPatch,
} from "./barline-structure";

function currentRevision(source: SongSourceDocument): SourceRevisionRef {
  return { documentId: source.documentId, revisionOrdinal: source.revisionOrdinal, revisionDigest: source.revisionDigest };
}

function resolveTarget(target: RevisionScopedTarget, source: SongSourceDocument, remaps: readonly SourceIdRemap[]): RevisionScopedTarget {
  let resolved = target;
  const current = currentRevision(source);
  if (revisionRefsEqual(resolved.sourceRevision, current)) return resolved;
  const ordered = [...remaps].sort((a, b) => a.fromRevision.revisionOrdinal - b.fromRevision.revisionOrdinal);
  for (const remap of ordered) {
    if (!revisionRefsEqual(resolved.sourceRevision, remap.fromRevision)) continue;
    const next = remapRevisionScopedTarget(resolved, remap);
    if (!next) throw new RangeError("STALE_REFERENCE");
    resolved = next;
  }
  if (!revisionRefsEqual(resolved.sourceRevision, current)) throw new RangeError("STALE_REFERENCE");
  return resolved;
}

function targetProjection(source: SongSourceDocument, target: RevisionScopedTarget["target"]): unknown {
  for (const measure of source.sourceMeasures) {
    if (target.kind === "voice-event") { const found = measure.leadEvents.find((event) => event.id === target.eventId); if (found) return found; }
    if (target.kind === "chord-event") { const found = measure.chordEvents.find((event) => event.id === target.chordEventId); if (found) return found; }
    if (target.kind === "section-text") { const found = measure.textEvents.find((event) => event.id === target.sourceTextId); if (found) return found; }
    if ((target.kind === "measure" || target.kind === "measure-start" || target.kind === "measure-end") && measure.id === target.sourceMeasureId) return measure;
  }
  throw new RangeError("STALE_REFERENCE");
}

function applyVoicePatch(event: LeadEvent, patch: OmrCorrectionPatch): LeadEvent {
  if (patch.kind === "replace-event") {
    if (compareFractions(event.onset, patch.event.onset) !== 0 || compareFractions(event.duration, patch.event.duration) !== 0) {
      throw new RangeError("OMR_CORRECTION_STRUCTURAL_MOVE_UNSUPPORTED");
    }
    if (patch.event.kind === "rest") return { kind: "rest", id: event.id, sourceMeasureId: event.sourceMeasureId, onset: patch.event.onset, duration: patch.event.duration };
    return { kind: "note", id: event.id, sourceMeasureId: event.sourceMeasureId, onset: patch.event.onset, duration: patch.event.duration, pitch: patch.event.pitch, tieStart: patch.event.tieStart, tieStop: patch.event.tieStop, lyricTokenIds: event.kind === "note" ? event.lyricTokenIds : [] };
  }
  if (event.kind !== "note" && (patch.kind === "pitch" || patch.kind === "accidental" || patch.kind === "tie")) throw new RangeError("OMR_CORRECTION_TARGET_INCOMPATIBLE");
  if (patch.kind === "pitch" && event.kind === "note") return { ...event, pitch: patch.pitch };
  if (patch.kind === "accidental" && event.kind === "note") return { ...event, pitch: { ...event.pitch, alter: patch.alter } };
  if (patch.kind === "tie" && event.kind === "note") return { ...event, tieStart: patch.tieStart, tieStop: patch.tieStop };
  if (patch.kind === "duration") return { ...event, duration: patch.duration };
  throw new RangeError("OMR_CORRECTION_TARGET_INCOMPATIBLE");
}

function applyPatchToProjection(target: RevisionScopedTarget["target"], before: unknown, patch: OmrCorrectionPatch): unknown {
  if (patch.kind === "insert-barline" || patch.kind === "delete-barline") {
    if (target.kind !== "measure-end") throw new RangeError("OMR_CORRECTION_TARGET_INCOMPATIBLE");
    return applyBarlinePatchToProjection(before, patch);
  }
  if (!isPlainRecord(before)) throw new RangeError("OMR_REVIEW_RESOLUTION_INVALID");
  if (target.kind === "voice-event") return applyVoicePatch(before as unknown as LeadEvent, patch);
  if (target.kind === "chord-event" && patch.kind === "chord") {
    const sourceText = patch.parseResult.status === "ok" ? patch.parseResult.chord.canonicalSymbol : patch.parseResult.sourceText;
    return { ...before, sourceText, parseResult: patch.parseResult, source: "manual", confirmation: "confirmed" };
  }
  if (target.kind === "measure-start" && patch.kind === "time-signature") return { ...before, time: patch.value };
  if (target.kind === "measure-start" && patch.kind === "key-signature") return { ...before, key: patch.value };
  if (target.kind === "section-text" && patch.kind === "replace-source-text") return { ...before, text: patch.text.normalize("NFC") };
  throw new RangeError("OMR_CORRECTION_TARGET_INCOMPATIBLE");
}

function validateTargetTie(sourceMeasures: readonly SourceMeasure[], eventId: string): void {
  const events: Array<{ readonly event: LeadEvent; readonly start: Fraction; readonly end: Fraction }> = [];
  let measureStart = { n: 0, d: 1 } as Fraction;
  for (const measure of sourceMeasures) {
    for (const event of measure.leadEvents) {
      const start = addFractions(measureStart, event.onset);
      events.push({ event, start, end: addFractions(start, event.duration) });
    }
    measureStart = addFractions(measureStart, measure.duration);
  }
  events.sort((left, right) => compareFractions(left.start, right.start) || compareFractions(left.end, right.end));
  const index = events.findIndex(({ event }) => event.id === eventId);
  const current = events[index];
  if (!current || current.event.kind !== "note") throw new RangeError("OMR_TIE_INVALID");
  const samePitch = (left: Extract<LeadEvent, { readonly kind: "note" }>, right: Extract<LeadEvent, { readonly kind: "note" }>) => left.pitch.step === right.pitch.step && left.pitch.alter === right.pitch.alter && left.pitch.octave === right.pitch.octave;
  const previous = events[index - 1];
  const next = events[index + 1];
  if (current.event.tieStop && (!previous || previous.event.kind !== "note" || !previous.event.tieStart || compareFractions(previous.end, current.start) !== 0 || !samePitch(previous.event, current.event))) throw new RangeError("OMR_TIE_INVALID");
  if (current.event.tieStart && (!next || next.event.kind !== "note" || !next.event.tieStop || compareFractions(current.end, next.start) !== 0 || !samePitch(current.event, next.event))) throw new RangeError("OMR_TIE_INVALID");
}

function applyPatch(source: SongSourceDocument, target: RevisionScopedTarget["target"], patch: OmrCorrectionPatch): SongSourceDocument {
  let found = false;
  const sourceMeasures = source.sourceMeasures.map((measure): SourceMeasure => {
    if (target.kind === "voice-event" && measure.leadEvents.some((event) => event.id === target.eventId)) {
      found = true;
      const replacingNoteWithRest = patch.kind === "replace-event" && patch.event.kind === "rest";
      const removedLyrics = replacingNoteWithRest ? new Set(measure.lyricTokens.filter((token) => token.leadEventId === target.eventId).map((token) => token.id)) : new Set<string>();
      return {
        ...measure,
        leadEvents: measure.leadEvents.map((event) => event.id === target.eventId ? applyVoicePatch(event, patch) : event),
        lyricTokens: measure.lyricTokens.filter((token) => !removedLyrics.has(token.id)),
      };
    }
    if (target.kind === "chord-event" && measure.chordEvents.some((event) => event.id === target.chordEventId) && patch.kind === "chord") {
      found = true;
      const sourceText = patch.parseResult.status === "ok" ? patch.parseResult.chord.canonicalSymbol : patch.parseResult.sourceText;
      return { ...measure, chordEvents: measure.chordEvents.map((event) => event.id === target.chordEventId ? { ...event, sourceText, parseResult: patch.parseResult, source: "manual", confirmation: "confirmed" } : event) };
    }
    if (target.kind === "measure-start" && measure.id === target.sourceMeasureId) {
      if (patch.kind === "time-signature") { found = true; return { ...measure, time: patch.value }; }
      if (patch.kind === "key-signature") { found = true; return { ...measure, key: patch.value }; }
    }
    if (target.kind === "section-text" && patch.kind === "replace-source-text" && measure.textEvents.some((event) => event.id === target.sourceTextId)) {
      found = true; return { ...measure, textEvents: measure.textEvents.map((event) => event.id === target.sourceTextId ? { ...event, text: patch.text.normalize("NFC") } : event) };
    }
    return measure;
  });
  if (!found) throw new RangeError("STALE_REFERENCE");
  if (target.kind === "voice-event" && patch.kind === "tie") validateTargetTie(sourceMeasures, target.eventId);
  const performanceSequence = target.kind === "measure-start" && patch.kind === "time-signature"
    ? { ...source.performanceSequence, occurrences: source.performanceSequence.occurrences.map((occurrence) => occurrence.sourceMeasureId === target.sourceMeasureId ? { ...occurrence, time: patch.value } : occurrence) }
    : source.performanceSequence;
  return normalizeSongSourceDocument({ ...source, sourceMeasures, performanceSequence });
}

function identityRemapEntries(source: SongSourceDocument, patched: SongSourceDocument): readonly SourceIdRemapEntry[] {
  const entries: SourceIdRemapEntry[] = [];
  const existing = new Map<SourceIdRemapEntry["entityKind"], Set<string>>([
    ["measure", new Set(patched.sourceMeasures.map((item) => item.id))],
    ["lead-event", new Set(patched.sourceMeasures.flatMap((item) => item.leadEvents.map((event) => event.id)))],
    ["chord-event", new Set(patched.sourceMeasures.flatMap((item) => item.chordEvents.map((event) => event.id)))],
    ["lyric-token", new Set(patched.sourceMeasures.flatMap((item) => item.lyricTokens.map((token) => token.id)))],
    ["source-text", new Set(patched.sourceMeasures.flatMap((item) => item.textEvents.map((event) => event.id)))],
    ["section-definition", new Set(patched.sectionDefinitions.map((item) => item.id))],
    ["section-occurrence", new Set(patched.sectionOccurrences.map((item) => item.id))],
    ["phrase", new Set(patched.phraseRegions.map((item) => item.id))],
  ]);
  const add = (entityKind: SourceIdRemapEntry["entityKind"], fromId: string) => entries.push(existing.get(entityKind)?.has(fromId)
    ? { entityKind, fromId, toIds: [fromId], status: "mapped-one" }
    : { entityKind, fromId, toIds: [], status: "deleted" });
  for (const measure of source.sourceMeasures) {
    add("measure", measure.id);
    measure.leadEvents.forEach((event) => add("lead-event", event.id));
    measure.chordEvents.forEach((event) => add("chord-event", event.id));
    measure.lyricTokens.forEach((token) => add("lyric-token", token.id));
    measure.textEvents.forEach((event) => add("source-text", event.id));
  }
  source.sectionDefinitions.forEach((item) => add("section-definition", item.id));
  source.sectionOccurrences.forEach((item) => add("section-occurrence", item.id));
  source.phraseRegions.forEach((item) => add("phrase", item.id));
  return entries;
}

export async function applyOmrCorrection(input: {
  readonly source: SongSourceDocument;
  readonly target: RevisionScopedTarget;
  readonly patch: OmrCorrectionPatch;
  readonly correctionSource: OmrCorrectionRecord["source"];
  readonly appliedAt: string;
  readonly reviewItemId?: string;
  readonly autoRepairProposalId?: string;
  readonly remaps?: readonly SourceIdRemap[];
}): Promise<{ readonly source: SongSourceDocument; readonly correction: OmrCorrectionRecord; readonly revisionRecord: SourceRevisionRecord; readonly idRemap: SourceIdRemap }> {
  const target = resolveTarget(input.target, input.source, input.remaps ?? []);
  if (!isCorrectionPatchCompatible(target.target, input.patch)) throw new RangeError("OMR_CORRECTION_TARGET_INCOMPATIBLE");
  if (!Number.isFinite(Date.parse(input.appliedAt)) || (input.reviewItemId !== undefined && input.autoRepairProposalId !== undefined)) throw new RangeError("OMR_REVIEW_RESOLUTION_INVALID");
  const structuralPatch = input.patch.kind === "insert-barline" || input.patch.kind === "delete-barline";
  const structural = structuralPatch ? applyBarlineStructuralPatch(input.source, target.target, input.patch) : undefined;
  const beforeProjectionValue = structural
    ? structural.beforeProjection
    : targetProjection(input.source, target.target);
  const beforeProjection = canonicalJson(beforeProjectionValue);
  const patched = structural?.source ?? applyPatch(input.source, target.target, input.patch);
  const fromRevision = currentRevision(input.source);
  const pending: SongSourceDocument = { ...patched, revisionOrdinal: input.source.revisionOrdinal + 1, previousRevision: fromRevision };
  const revisionDigest = await digestMusicalSource(pending);
  const toRevision = { documentId: input.source.documentId, revisionOrdinal: pending.revisionOrdinal, revisionDigest };
  const idRemap = await createSourceIdRemap(fromRevision, toRevision, structural?.remapEntries ?? identityRemapEntries(input.source, pending));
  const afterProjectionValue = structural?.afterProjection ?? targetProjection(pending, target.target);
  const revisionRecord: SourceRevisionRecord = {
    id: sourceRevisionRecordId(fromRevision.revisionOrdinal, toRevision.revisionOrdinal, 0), editOrdinal: 0,
    fromRevision, toRevision, commandKind: "omr-correction",
    beforeProjection: createSourceRevisionProjection("omr-correction", { target: target.target, value: JSON.parse(beforeProjection) }),
    afterProjection: createSourceRevisionProjection("omr-correction", { target: target.target, value: afterProjectionValue as Readonly<Record<string, unknown>> }),
    idRemap,
  };
  const history = [...input.source.revisionHistory, revisionRecord];
  const musicXmlSourceTargetMap = input.source.importInfo?.musicXmlSourceTargetMap
    ? await remapMusicXmlSourceTargetMap(input.source.importInfo.musicXmlSourceTargetMap, idRemap)
    : undefined;
  const importInfo = pending.importInfo?.sourceKind === "omr" ? (() => {
    const { omrRuntimeWarningAcknowledgements: _discarded, ...withoutAcknowledgements } = pending.importInfo;
    void _discarded;
    return { ...withoutAcknowledgements, musicXmlSourceTargetMap: musicXmlSourceTargetMap! };
  })() : pending.importInfo?.sourceKind === "musicxml"
    ? { ...pending.importInfo, musicXmlSourceTargetMap: musicXmlSourceTargetMap! }
    : pending.importInfo;
  let source = normalizeSongSourceDocument({
    ...pending,
    revisionDigest,
    revisionHistory: history,
    revisionHistoryDigest: await computeRevisionHistoryDigest(history),
    ...(importInfo ? { importInfo } : {}),
  });
  source = { ...source, sourceProvenanceDigest: await computeSourceProvenanceDigest(source) };
  const correctionDigest = await semanticDigest({ projectionSchema: "hm-omr-correction-id-v2", target, beforeProjection, patch: input.patch, correctionSource: input.correctionSource, reviewItemId: input.reviewItemId ?? null, autoRepairProposalId: input.autoRepairProposalId ?? null });
  const correction: OmrCorrectionRecord = {
    id: `omr-correction:${correctionDigest.slice(0, 32)}`,
    ...(input.reviewItemId ? { reviewItemId: input.reviewItemId } : {}),
    ...(input.autoRepairProposalId ? { autoRepairProposalId: input.autoRepairProposalId } : {}),
    ...(input.reviewItemId ? { reviewItemTarget: input.target } : {}),
    target, beforeProjection, patch: input.patch, source: input.correctionSource, appliedAt: input.appliedAt,
  };
  return { source, correction, revisionRecord, idRemap };
}

export async function validateOmrCorrectionHistory(source: SongSourceDocument, record: OmrReviewRecord): Promise<readonly string[]> {
  const errors: string[] = [];
  const history = source.revisionHistory.filter((entry) => entry.commandKind === "omr-correction");
  if (history.length !== record.corrections.length) return ["OMR_REVIEW_RESOLUTION_INVALID:correction-history-count"];
  const resolveThroughHistory = (original: RevisionScopedTarget, targetRevision: SourceRevisionRef): RevisionScopedTarget | undefined => {
    let resolved = original;
    for (const entry of source.revisionHistory) {
      if (resolved.sourceRevision.revisionOrdinal >= targetRevision.revisionOrdinal) break;
      if (!revisionRefsEqual(resolved.sourceRevision, entry.fromRevision)) continue;
      const next = remapRevisionScopedTarget(resolved, entry.idRemap); if (!next) return undefined; resolved = next;
    }
    return revisionRefsEqual(resolved.sourceRevision, targetRevision) ? resolved : undefined;
  };
  const revisionProjection = (value: string): { readonly target: unknown; readonly value: unknown } | undefined => {
    try {
      const parsed = JSON.parse(value) as { readonly value?: { readonly target?: unknown; readonly value?: unknown } };
      return parsed.value && "target" in parsed.value && "value" in parsed.value
        ? { target: parsed.value.target, value: parsed.value.value }
        : undefined;
    } catch { return undefined; }
  };
  for (const [index, correction] of record.corrections.entries()) {
    const revisionRecord = history[index];
    if (!revisionRecord || !revisionRefsEqual(correction.target.sourceRevision, revisionRecord.fromRevision)) {
      errors.push(`OMR_REVIEW_RESOLUTION_INVALID:${correction.id}:revision-order`); continue;
    }
    const before = revisionProjection(revisionRecord.beforeProjection);
    const after = revisionProjection(revisionRecord.afterProjection);
    if (!before || canonicalJson(before.target) !== canonicalJson(correction.target.target)
      || canonicalJson(before.value) !== correction.beforeProjection) {
      errors.push(`OMR_REVIEW_RESOLUTION_INVALID:${correction.id}:before-projection`);
    }
    if (!after || canonicalJson(after.target) !== canonicalJson(correction.target.target)) {
      errors.push(`OMR_REVIEW_RESOLUTION_INVALID:${correction.id}:after-projection`);
    } else {
      try {
        if (canonicalJson(applyPatchToProjection(correction.target.target, before?.value, correction.patch)) !== canonicalJson(after.value)) {
          errors.push(`OMR_REVIEW_RESOLUTION_INVALID:${correction.id}:patch-projection`);
        }
      } catch { errors.push(`OMR_REVIEW_RESOLUTION_INVALID:${correction.id}:patch-projection`); }
    }
    const digest = await semanticDigest({ projectionSchema: "hm-omr-correction-id-v2", target: correction.target, beforeProjection: correction.beforeProjection, patch: correction.patch, correctionSource: correction.source, reviewItemId: correction.reviewItemId ?? null, autoRepairProposalId: correction.autoRepairProposalId ?? null });
    if (correction.id !== `omr-correction:${digest.slice(0, 32)}`) errors.push(`OMR_REVIEW_RESOLUTION_INVALID:${correction.id}:id`);
    if (correction.reviewItemTarget) {
      const linked = resolveThroughHistory(correction.reviewItemTarget, correction.target.sourceRevision);
      if (!linked || canonicalJson(linked) !== canonicalJson(correction.target)) errors.push(`OMR_REVIEW_RESOLUTION_INVALID:${correction.id}:remap-link`);
    }
    for (let previousIndex = index - 1; previousIndex >= 0; previousIndex -= 1) {
      const previous = record.corrections[previousIndex];
      const remapped = resolveThroughHistory(previous.target, correction.target.sourceRevision);
      if (!remapped || canonicalJson(remapped.target) !== canonicalJson(correction.target.target)) continue;
      const previousAfter = revisionProjection(history[previousIndex]?.afterProjection ?? "");
      if (!previousAfter || canonicalJson(previousAfter.value) !== correction.beforeProjection) {
        errors.push(`OMR_REVIEW_RESOLUTION_INVALID:${correction.id}:target-chain`);
      }
      break;
    }
  }
  const referenceCounts = new Map(record.corrections.map((correction) => [correction.id, 0]));
  const addReference = (correctionId: string) => referenceCounts.set(correctionId, (referenceCounts.get(correctionId) ?? 0) + 1);
  for (const item of record.reviewItems) {
    if (item.resolution.status === "accepted" || item.resolution.status === "manually-corrected") addReference(item.resolution.correctionRecordId);
  }
  const correctionById = new Map(record.corrections.map((correction) => [correction.id, correction]));
  for (const proposal of record.autoRepairs) {
    if (proposal.resolution.status !== "accepted") continue;
    addReference(proposal.resolution.correctionRecordId);
    const correction = correctionById.get(proposal.resolution.correctionRecordId);
    if (correction) {
      const remapped = resolveThroughHistory(proposal.target, correction.target.sourceRevision);
      if (!remapped || canonicalJson(remapped) !== canonicalJson(correction.target)) {
        errors.push(`OMR_REVIEW_RESOLUTION_INVALID:${proposal.id}:remap-link`);
      }
    }
  }
  for (const correction of record.corrections) {
    if (referenceCounts.get(correction.id) !== 1) errors.push(`OMR_REVIEW_RESOLUTION_INVALID:${correction.id}:reference-count`);
  }
  return errors;
}

export async function createOmrReviewItem(input: {
  readonly target: RevisionScopedTarget;
  readonly reasonCode: DiagnosticCode;
  readonly alternatives: readonly { readonly labelKo: string; readonly patch: OmrCorrectionPatch; readonly confidenceBp?: OmrReviewAlternative["confidenceBp"] }[];
  readonly evidenceIds: readonly string[];
}): Promise<OmrReviewItem> {
  if (new Set(input.evidenceIds).size !== input.evidenceIds.length
    || input.alternatives.length === 0
    || input.alternatives.some((alternative) => !isCorrectionPatchCompatible(input.target.target, alternative.patch))) {
    throw new RangeError("OMR_REVIEW_RESOLUTION_INVALID");
  }
  const id = await createOmrReviewItemId(input.target, input.reasonCode);
  const alternatives = await Promise.all(input.alternatives.map(async (alternative, ordinal): Promise<OmrReviewAlternative> => ({
    id: await createOmrReviewAlternativeId(id, alternative.patch, ordinal),
    labelKo: alternative.labelKo.normalize("NFC"), patch: alternative.patch,
    ...(alternative.confidenceBp === undefined ? {} : { confidenceBp: alternative.confidenceBp }),
  })));
  return { id, target: input.target, reasonCode: input.reasonCode, alternatives, evidenceIds: [...input.evidenceIds].sort(), resolution: { status: "open" } };
}

export async function acceptOmrReviewAlternative(input: {
  readonly source: SongSourceDocument;
  readonly item: OmrReviewItem;
  readonly alternativeId: string;
  readonly appliedAt: string;
  readonly remaps?: readonly SourceIdRemap[];
}): Promise<Awaited<ReturnType<typeof applyOmrCorrection>> & { readonly item: OmrReviewItem }> {
  if (input.item.resolution.status !== "open" && input.item.resolution.status !== "rejected") throw new RangeError("OMR_REVIEW_RESOLUTION_INVALID");
  const alternative = input.item.alternatives.find((candidate) => candidate.id === input.alternativeId);
  if (!alternative) throw new RangeError("OMR_REVIEW_RESOLUTION_INVALID");
  const result = await applyOmrCorrection({ source: input.source, target: input.item.target, patch: alternative.patch, correctionSource: "review-alternative", appliedAt: input.appliedAt, reviewItemId: input.item.id, remaps: input.remaps });
  return { ...result, item: { ...input.item, resolution: { status: "accepted", selectedAlternativeId: alternative.id, correctionRecordId: result.correction.id } } };
}

export async function manuallyCorrectOmrReviewItem(input: {
  readonly source: SongSourceDocument;
  readonly item: OmrReviewItem;
  readonly patch: OmrCorrectionPatch;
  readonly appliedAt: string;
  readonly remaps?: readonly SourceIdRemap[];
}): Promise<Awaited<ReturnType<typeof applyOmrCorrection>> & { readonly item: OmrReviewItem }> {
  if ((input.item.resolution.status !== "open" && input.item.resolution.status !== "rejected") || !isCorrectionPatchCompatible(input.item.target.target, input.patch)) throw new RangeError("OMR_REVIEW_RESOLUTION_INVALID");
  const result = await applyOmrCorrection({ source: input.source, target: input.item.target, patch: input.patch, correctionSource: "manual", appliedAt: input.appliedAt, reviewItemId: input.item.id, remaps: input.remaps });
  return { ...result, item: { ...input.item, resolution: { status: "manually-corrected", correctionRecordId: result.correction.id } } };
}

export function rejectOmrReviewAlternatives(item: OmrReviewItem, alternativeIds: readonly string[]): OmrReviewItem {
  const available = new Set(item.alternatives.map((alternative) => alternative.id));
  if ((item.resolution.status !== "open" && item.resolution.status !== "rejected") || alternativeIds.length === 0 || new Set(alternativeIds).size !== alternativeIds.length
    || alternativeIds.some((id) => !available.has(id))) throw new RangeError("OMR_REVIEW_RESOLUTION_INVALID");
  const prior = item.resolution.status === "rejected" ? item.resolution.rejectedAlternativeIds : [];
  return { ...item, resolution: { status: "rejected", rejectedAlternativeIds: [...new Set([...prior, ...alternativeIds])].sort() } };
}

export async function unsupportedOmrAutoRepairDiagnostics(source: SongSourceDocument): Promise<readonly import("../diagnostics").Diagnostic[]> {
  const diagnostics: import("../../import/musicxml/diagnostics").ImportDiagnosticInput[] = [];
  for (const measure of source.sourceMeasures) {
    if (measure.leadEvents.some((event) => event.kind === "note" && event.pitch.alter !== 0)) {
      diagnostics.push({ code: "OMR_REVIEW_REQUIRED", severity: "warning", messageKo: "임시표 문맥 자동 수리는 지원되지 않아 검토가 필요합니다.", details: { sourceMeasureId: measure.id, unsupportedAutoRepair: "ACCIDENTAL_CONTEXT" } });
    }
    let cursor = { n: 0, d: 1 } as Fraction;
    if (measure.leadEvents.some((event) => {
      const noncontiguous = compareFractions(event.onset, cursor) !== 0;
      cursor = addFractions(event.onset, event.duration);
      return noncontiguous;
    })) {
      diagnostics.push({ code: "OMR_REVIEW_REQUIRED", severity: "warning", messageKo: "성부 시간축 자동 수리는 지원되지 않아 검토가 필요합니다.", details: { sourceMeasureId: measure.id, unsupportedAutoRepair: "VOICE_TIMELINE" } });
    }
  }
  const { materializeImportDiagnostics } = await import("../../import/musicxml/diagnostics");
  return materializeImportDiagnostics(diagnostics);
}

export async function resolveOmrAutoRepair(input: {
  readonly source: SongSourceDocument;
  readonly proposal: OmrAutoRepairProposal;
  readonly resolution: "accepted" | "rejected";
  readonly appliedAt: string;
  readonly remaps?: readonly SourceIdRemap[];
}): Promise<{ readonly source: SongSourceDocument; readonly proposal: OmrAutoRepairProposal; readonly correction?: OmrCorrectionRecord; readonly idRemap?: SourceIdRemap }> {
  if (input.proposal.resolution.status !== "pending") throw new RangeError("OMR_REVIEW_RESOLUTION_INVALID");
  if (input.resolution === "rejected") return { source: input.source, proposal: { ...input.proposal, resolution: { status: "rejected" } } };
  const resolvedTarget = resolveTarget(input.proposal.target, input.source, input.remaps ?? []);
  if (canonicalJson(targetProjection(input.source, resolvedTarget.target)) !== input.proposal.originalProjection) {
    throw new RangeError("OMR_AUTO_REPAIR_STALE");
  }
  const applied = await applyOmrCorrection({ source: input.source, target: resolvedTarget, patch: input.proposal.patch, correctionSource: "auto-accepted", appliedAt: input.appliedAt, autoRepairProposalId: input.proposal.id, remaps: input.remaps });
  return { source: applied.source, correction: applied.correction, idRemap: applied.idRemap, proposal: { ...input.proposal, resolution: { status: "accepted", correctionRecordId: applied.correction.id } } };
}

export async function proposeOmrAutoRepairs(source: SongSourceDocument): Promise<readonly OmrAutoRepairProposal[]> {
  const proposals: OmrAutoRepairProposal[] = [];
  const revision = currentRevision(source);
  for (const measure of source.sourceMeasures) {
    const lastEvent = measure.leadEvents.at(-1);
    if (lastEvent) {
      const end = addFractions(lastEvent.onset, lastEvent.duration);
      if (end.n !== measure.duration.n || end.d !== measure.duration.d) {
        const duration = subtractFractions(measure.duration, lastEvent.onset);
        if (duration.n > 0) {
          const target = { sourceRevision: revision, target: { kind: "voice-event", eventId: lastEvent.id } } as const;
          const patch = { kind: "duration", duration } as const;
          proposals.push({ id: await createOmrAutoRepairProposalId({ target, reason: "MEASURE_DURATION", patch, patchOrdinal: 0 }), target, originalProjection: canonicalJson(lastEvent), patch, reason: "MEASURE_DURATION", confidence: "medium", resolution: { status: "pending" } });
        }
      }
    }
    for (const event of measure.leadEvents) if (event.kind === "note" && (event.tieStart || event.tieStop)) {
      const target = { sourceRevision: revision, target: { kind: "voice-event", eventId: event.id } } as const;
      const patch = { kind: "tie", tieStart: false, tieStop: false } as const;
      proposals.push({ id: await createOmrAutoRepairProposalId({ target, reason: "TIE_PITCH", patch, patchOrdinal: 0 }), target, originalProjection: canonicalJson(event), patch, reason: "TIE_PITCH", confidence: "low", resolution: { status: "pending" } });
    }
    for (const chord of measure.chordEvents) if (chord.parseResult.status === "failed") {
      const reparsed = parseChord(chord.sourceText);
      if (reparsed.status === "ok" || reparsed.status === "no-chord") {
        const target = { sourceRevision: revision, target: { kind: "chord-event", chordEventId: chord.id } } as const;
        const patch = { kind: "chord", parseResult: reparsed } as const;
        proposals.push({ id: await createOmrAutoRepairProposalId({ target, reason: "CHORD_GRAMMAR", patch, patchOrdinal: 0 }), target, originalProjection: canonicalJson(chord), patch, reason: "CHORD_GRAMMAR", confidence: "high", resolution: { status: "pending" } });
      }
    }
  }
  return proposals.sort((a, b) => a.id.localeCompare(b.id));
}

export function validateReviewEvidenceReferences(record: OmrReviewRecord, index: SourceEvidenceIndex, archive: OmrEvidenceArchive): readonly string[] {
  const indexed = new Set(index.evidence.map((item) => item.id));
  const archived = new Set(archive.unmappedEvidence.map((item) => item.id));
  return record.reviewItems.flatMap((item) => item.evidenceIds.flatMap((evidenceId) => Number(indexed.has(evidenceId)) + Number(archived.has(evidenceId)) === 1 ? [] : [`OMR_REVIEW_RESOLUTION_INVALID:${item.id}:evidence:${evidenceId}`]));
}

/** Ensures indexed evidence still names the current remap of its original review target. */
export function validateReviewEvidenceTargetBindings(
  source: SongSourceDocument,
  record: OmrReviewRecord,
  index: SourceEvidenceIndex,
  archive: OmrEvidenceArchive,
): readonly string[] {
  const archived = new Set(archive.unmappedEvidence.map((item) => item.id));
  const evidenceById = new Map(index.evidence.map((item) => [item.id, item]));
  const mappingByVendorTarget = new Map(index.targetMappings.map((mapping) => [mapping.vendorTargetId, mapping]));
  const resolveCurrent = (original: RevisionScopedTarget): RevisionScopedTarget | undefined => {
    let resolved = original;
    for (const revision of source.revisionHistory) {
      if (!revisionRefsEqual(resolved.sourceRevision, revision.fromRevision)) continue;
      const next = remapRevisionScopedTarget(resolved, revision.idRemap);
      if (!next) return undefined;
      resolved = next;
    }
    return revisionRefsEqual(resolved.sourceRevision, index.sourceRevision) ? resolved : undefined;
  };
  return record.reviewItems.flatMap((item) => item.evidenceIds.flatMap((evidenceId) => {
    if (archived.has(evidenceId)) return [];
    const evidence = evidenceById.get(evidenceId);
    const mapping = evidence?.vendorTargetId ? mappingByVendorTarget.get(evidence.vendorTargetId) : undefined;
    const resolved = resolveCurrent(item.target);
    return evidence && mapping && resolved && canonicalJson(resolved) === canonicalJson(mapping.target)
      ? []
      : [`OMR_REVIEW_RESOLUTION_INVALID:${item.id}:evidence-target:${evidenceId}`];
  }));
}
