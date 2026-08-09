import { canonicalJson, semanticDigest, type SemanticDigest } from "../digest/canonical";
import { sourceIdRemapId, sourceRevisionRecordId } from "../ids";
import { hasExactKeys, isCanonicalId, isPlainRecord, isSemanticDigest } from "../validation";

export interface SourceRevisionRef {
  readonly documentId: string;
  readonly revisionOrdinal: number;
  readonly revisionDigest: SemanticDigest;
}
export type SourceEntityKind = "measure" | "lead-event" | "chord-event" | "lyric-token" | "source-text" | "section-definition" | "section-occurrence" | "phrase";
export interface SourceIdRemapEntry {
  readonly entityKind: SourceEntityKind;
  readonly fromId: string;
  readonly toIds: readonly string[];
  readonly status: "mapped-one" | "mapped-many" | "deleted" | "unresolved";
}
export interface SourceIdRemap {
  readonly id: string;
  readonly fromRevision: SourceRevisionRef;
  readonly toRevision: SourceRevisionRef;
  readonly entries: readonly SourceIdRemapEntry[];
  readonly remapDigest: SemanticDigest;
}
export type SourceRevisionCommandKind = "source-chord-edit" | "omr-correction" | "section-edit" | "phrase-edit" | "manual-source-edit" | "undo-redo";
export interface SourceRevisionRecord {
  readonly id: string;
  readonly editOrdinal: number;
  readonly fromRevision: SourceRevisionRef;
  readonly toRevision: SourceRevisionRef;
  readonly commandKind: SourceRevisionCommandKind;
  readonly beforeProjection: string;
  readonly afterProjection: string;
  readonly idRemap: SourceIdRemap;
}

export function sourceRevisionProjectionSchema(commandKind: SourceRevisionCommandKind): string {
  return `hm-source-revision-${commandKind}-v1`;
}

export function createSourceRevisionProjection(
  commandKind: SourceRevisionCommandKind,
  value: Readonly<Record<string, unknown>>,
): string {
  if (!isPlainRecord(value) || Object.keys(value).length === 0) {
    throw new RangeError("source revision projection value must be a non-empty record");
  }
  return canonicalJson({ projectionSchema: sourceRevisionProjectionSchema(commandKind), value });
}

export function isSourceRevisionProjection(
  projection: string,
  commandKind: SourceRevisionCommandKind,
): boolean {
  try {
    const parsed: unknown = JSON.parse(projection);
    return isPlainRecord(parsed)
      && hasExactKeys(parsed, ["projectionSchema", "value"])
      && parsed.projectionSchema === sourceRevisionProjectionSchema(commandKind)
      && isPlainRecord(parsed.value)
      && Object.keys(parsed.value).length > 0
      && canonicalJson(parsed) === projection;
  } catch {
    return false;
  }
}

export function isSourceRevisionRef(value: unknown): value is SourceRevisionRef {
  return isPlainRecord(value)
    && hasExactKeys(value, ["documentId", "revisionOrdinal", "revisionDigest"])
    && isCanonicalId(value.documentId)
    && Number.isSafeInteger(value.revisionOrdinal)
    && (value.revisionOrdinal as number) >= 0
    && isSemanticDigest(value.revisionDigest);
}

export function revisionRefsEqual(left: SourceRevisionRef, right: SourceRevisionRef): boolean {
  return left.documentId === right.documentId
    && left.revisionOrdinal === right.revisionOrdinal
    && left.revisionDigest === right.revisionDigest;
}

export function validateRemapEntry(entry: unknown): entry is SourceIdRemapEntry {
  if (!isPlainRecord(entry)
    || !hasExactKeys(entry, ["entityKind", "fromId", "toIds", "status"])
    || !["measure", "lead-event", "chord-event", "lyric-token", "source-text", "section-definition", "section-occurrence", "phrase"].includes(String(entry.entityKind))
    || !isCanonicalId(entry.fromId)
    || !Array.isArray(entry.toIds)
    || !entry.toIds.every(isCanonicalId)
    || !["mapped-one", "mapped-many", "deleted", "unresolved"].includes(String(entry.status))) return false;
  const unique = new Set(entry.toIds).size === entry.toIds.length;
  if (!unique) return false;
  if (entry.status === "mapped-one") return entry.toIds.length === 1;
  if (entry.status === "mapped-many") return entry.toIds.length > 1;
  return entry.toIds.length === 0;
}

export async function createSourceIdRemap(
  fromRevision: SourceRevisionRef,
  toRevision: SourceRevisionRef,
  entries: readonly SourceIdRemapEntry[],
): Promise<SourceIdRemap> {
  if (fromRevision.documentId !== toRevision.documentId || toRevision.revisionOrdinal !== fromRevision.revisionOrdinal + 1) throw new RangeError("SOURCE_REVISION_MISMATCH");
  if (!entries.every(validateRemapEntry)
    || new Set(entries.map((entry) => `${entry.entityKind}:${entry.fromId}`)).size !== entries.length) throw new RangeError("SOURCE_ID_REMAP_FAILED");
  const sorted = [...entries]
    .map((entry) => ({ ...entry, toIds: [...entry.toIds].sort() }))
    .sort((a, b) => a.entityKind.localeCompare(b.entityKind) || a.fromId.localeCompare(b.fromId));
  const projection = { projectionSchema: "hm-source-id-remap-v1", fromRevision, toRevision, entries: sorted };
  const remapDigest = await semanticDigest(projection);
  return { id: sourceIdRemapId(fromRevision.revisionOrdinal, toRevision.revisionOrdinal), fromRevision, toRevision, entries: sorted, remapDigest };
}

export function remapSourceId(remap: SourceIdRemap, entityKind: SourceEntityKind, fromId: string): readonly string[] | undefined {
  const entry = remap.entries.find((candidate) => candidate.entityKind === entityKind && candidate.fromId === fromId);
  return entry?.status === "mapped-one" ? entry.toIds : undefined;
}

export function validateRevisionHistory(current: SourceRevisionRef, history: readonly SourceRevisionRecord[]): boolean {
  if (!isSourceRevisionRef(current)) return false;
  if (current.revisionOrdinal === 0) return history.length === 0;
  if (history.length === 0) return false;
  let previousTo: SourceRevisionRef | undefined;
  let pairKey = "";
  let expectedEditOrdinal = 0;
  for (const record of history) {
    if (!isPlainRecord(record)
      || !hasExactKeys(record, ["id", "editOrdinal", "fromRevision", "toRevision", "commandKind", "beforeProjection", "afterProjection", "idRemap"])
      || !isPlainRecord(record.idRemap)
      || !hasExactKeys(record.idRemap, ["id", "fromRevision", "toRevision", "entries", "remapDigest"])
      || !Array.isArray(record.idRemap.entries)
      || !Number.isSafeInteger(record.editOrdinal)
      || (record.editOrdinal as number) < 0
      || !["source-chord-edit", "omr-correction", "section-edit", "phrase-edit", "manual-source-edit", "undo-redo"].includes(String(record.commandKind))
      || !isSemanticDigest(record.idRemap.remapDigest)
      || !isSourceRevisionRef(record.fromRevision)
      || !isSourceRevisionRef(record.toRevision)
      || record.fromRevision.documentId !== current.documentId
      || record.toRevision.documentId !== current.documentId
      || record.toRevision.revisionOrdinal !== record.fromRevision.revisionOrdinal + 1
      || record.id !== sourceRevisionRecordId(record.fromRevision.revisionOrdinal, record.toRevision.revisionOrdinal, record.editOrdinal)
      || record.idRemap.id !== sourceIdRemapId(record.fromRevision.revisionOrdinal, record.toRevision.revisionOrdinal)
      || !revisionRefsEqual(record.idRemap.fromRevision, record.fromRevision)
      || !revisionRefsEqual(record.idRemap.toRevision, record.toRevision)
      || !record.idRemap.entries.every((entry) => isPlainRecord(entry)
        && hasExactKeys(entry, ["entityKind", "fromId", "toIds", "status"])
        && ["measure", "lead-event", "chord-event", "lyric-token", "source-text", "section-definition", "section-occurrence", "phrase"].includes(String(entry.entityKind))
        && isCanonicalId(entry.fromId)
        && Array.isArray(entry.toIds)
        && entry.toIds.every(isCanonicalId)
        && ["mapped-one", "mapped-many", "deleted", "unresolved"].includes(String(entry.status))
        && validateRemapEntry(entry as unknown as SourceIdRemapEntry))
      || new Set(record.idRemap.entries.map((entry) => `${entry.entityKind}:${entry.fromId}`)).size !== record.idRemap.entries.length) return false;
    const canonicalRemapEntries = [...record.idRemap.entries]
      .map((entry) => ({ ...entry, toIds: [...entry.toIds].sort() }))
      .sort((left, right) => left.entityKind.localeCompare(right.entityKind) || left.fromId.localeCompare(right.fromId));
    if (canonicalJson(record.idRemap.entries) !== canonicalJson(canonicalRemapEntries)) return false;
    if (!isSourceRevisionProjection(record.beforeProjection, record.commandKind)
      || !isSourceRevisionProjection(record.afterProjection, record.commandKind)) return false;
    const nextPairKey = `${record.fromRevision.revisionOrdinal}:${record.toRevision.revisionOrdinal}`;
    if (nextPairKey !== pairKey) {
      if (previousTo && !revisionRefsEqual(previousTo, record.fromRevision)) return false;
      if (!previousTo && record.fromRevision.revisionOrdinal !== 0) return false;
      pairKey = nextPairKey;
      expectedEditOrdinal = 0;
    } else if (!previousTo || !revisionRefsEqual(previousTo, record.toRevision)) {
      return false;
    }
    if (record.editOrdinal !== expectedEditOrdinal) return false;
    expectedEditOrdinal += 1;
    previousTo = record.toRevision;
  }
  return previousTo !== undefined && revisionRefsEqual(previousTo, current);
}

export async function computeSourceIdRemapDigest(remap: Omit<SourceIdRemap, "remapDigest">): Promise<SemanticDigest> {
  const entries = [...remap.entries]
    .map((entry) => ({ ...entry, toIds: [...entry.toIds].sort() }))
    .sort((left, right) => left.entityKind.localeCompare(right.entityKind) || left.fromId.localeCompare(right.fromId));
  return semanticDigest({
    projectionSchema: "hm-source-id-remap-v1",
    fromRevision: remap.fromRevision,
    toRevision: remap.toRevision,
    entries,
  });
}

export async function computeRevisionHistoryDigest(
  history: readonly SourceRevisionRecord[],
): Promise<SemanticDigest> {
  return semanticDigest({
    projectionSchema: "hm-source-revision-history-v1",
    records: history.map((record) => ({
      editOrdinal: record.editOrdinal,
      fromRevision: record.fromRevision,
      toRevision: record.toRevision,
      commandKind: record.commandKind,
      beforeProjection: record.beforeProjection,
      afterProjection: record.afterProjection,
      idRemapDigest: record.idRemap.remapDigest,
    })),
  });
}

export async function validateRevisionHistoryIntegrity(
  current: SourceRevisionRef,
  history: readonly SourceRevisionRecord[],
  expectedHistoryDigest?: SemanticDigest,
): Promise<boolean> {
  if (!validateRevisionHistory(current, history)) return false;
  for (const record of history) {
    if (record.idRemap.remapDigest !== await computeSourceIdRemapDigest(record.idRemap)) return false;
  }
  return expectedHistoryDigest === undefined
    || expectedHistoryDigest === await computeRevisionHistoryDigest(history);
}
