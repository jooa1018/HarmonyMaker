import { canonicalJson, semanticDigest, type SemanticDigest } from "../digest/canonical";

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
export interface SourceRevisionRecord {
  readonly id: string;
  readonly editOrdinal: number;
  readonly fromRevision: SourceRevisionRef;
  readonly toRevision: SourceRevisionRef;
  readonly commandKind: "source-chord-edit" | "omr-correction" | "section-edit" | "phrase-edit" | "manual-source-edit" | "undo-redo";
  readonly beforeProjection: string;
  readonly afterProjection: string;
  readonly idRemap: SourceIdRemap;
}

export function validateRemapEntry(entry: SourceIdRemapEntry): boolean {
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
  if (!entries.every(validateRemapEntry)) throw new RangeError("SOURCE_ID_REMAP_FAILED");
  const sorted = [...entries].sort((a, b) => a.entityKind.localeCompare(b.entityKind) || a.fromId.localeCompare(b.fromId));
  const projection = { projectionSchema: "hm-source-id-remap-v1", fromRevision, toRevision, entries: sorted };
  const remapDigest = await semanticDigest(projection);
  return { id: `remap:${fromRevision.revisionOrdinal}:${toRevision.revisionOrdinal}`, fromRevision, toRevision, entries: sorted, remapDigest };
}

export function remapSourceId(remap: SourceIdRemap, entityKind: SourceEntityKind, fromId: string): readonly string[] | undefined {
  const entry = remap.entries.find((candidate) => candidate.entityKind === entityKind && candidate.fromId === fromId);
  return entry?.status === "mapped-one" ? entry.toIds : undefined;
}

export function validateRevisionHistory(current: SourceRevisionRef, history: readonly SourceRevisionRecord[]): boolean {
  if (current.revisionOrdinal === 0) return history.length === 0;
  if (history.length === 0) return false;
  for (let index = 0; index < history.length; index += 1) {
    const record = history[index];
    if (record.editOrdinal !== 0 || record.fromRevision.documentId !== current.documentId || record.toRevision.documentId !== current.documentId) return false;
    if (index > 0) {
      const previous = history[index - 1].toRevision;
      if (canonicalJson(previous) !== canonicalJson(record.fromRevision)) return false;
    }
  }
  return canonicalJson(history.at(-1)?.toRevision) === canonicalJson(current);
}
