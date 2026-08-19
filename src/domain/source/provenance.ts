import { semanticDigest, type SemanticDigest } from "../digest/canonical";
import type { SongSourceDocument } from "./model";

export async function computeSourceProvenanceDigest(
  source: Pick<SongSourceDocument, "importInfo" | "sourceEvidence" | "rights">,
): Promise<SemanticDigest> {
  return semanticDigest({
    projectionSchema: "hm-source-provenance-v1",
    importInfo: source.importInfo ?? null,
    sourceEvidence: source.sourceEvidence ?? null,
    rights: source.rights,
  });
}

/** Explicit upgrade helper; persistence/import callers must opt in and then revalidate. */
export async function upgradeSourceProvenance<T extends Omit<SongSourceDocument, "sourceProvenanceDigest">>(source: T): Promise<SongSourceDocument> {
  return { ...source, sourceProvenanceDigest: await computeSourceProvenanceDigest(source) } as SongSourceDocument;
}
