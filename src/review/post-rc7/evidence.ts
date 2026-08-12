import { semanticDigest, semanticId, type SemanticDigest } from "../../domain/digest/canonical";
import type { ResearchArrangement, ResearchFixture } from "./types";
import type { ResearchMetrics } from "./metrics";

export interface DeterministicEvidenceRecord {
  readonly id: string;
  readonly fixtureId: string;
  readonly baselineId: string;
  readonly fixtureDigest: SemanticDigest;
  readonly arrangementDigest: SemanticDigest;
  readonly evidenceDigest: SemanticDigest;
  readonly metrics: ResearchMetrics;
}

const fixtureProjection = (fixture: ResearchFixture) => ({
  id: fixture.id,
  placement: fixture.placement,
  performer: fixture.performer,
  preferredLeapSemitones: fixture.preferredLeapSemitones,
  hardLeapSemitones: fixture.hardLeapSemitones,
  seedHarmonyPitch: fixture.seedHarmonyPitch ?? null,
  lead: fixture.lead,
  chords: fixture.chords,
  rights: { authorshipKind: fixture.authorshipKind, rightsNote: fixture.rightsNote },
});

const arrangementProjection = (arrangement: ResearchArrangement) => ({
  fixtureId: arrangement.fixtureId,
  baselineId: arrangement.baselineId,
  lead: arrangement.lead,
  harmony: arrangement.harmony,
});

export async function buildEvidenceRecord(
  fixture: ResearchFixture,
  arrangement: ResearchArrangement,
  metrics: ResearchMetrics,
): Promise<DeterministicEvidenceRecord> {
  const fixtureDigest = await semanticDigest(fixtureProjection(fixture));
  const arrangementDigest = await semanticDigest(arrangementProjection(arrangement));
  const evidenceProjection = { fixtureDigest, arrangementDigest, metrics };
  return {
    id: await semanticId("post-rc7-evidence", evidenceProjection),
    fixtureId: fixture.id,
    baselineId: arrangement.baselineId,
    fixtureDigest,
    arrangementDigest,
    evidenceDigest: await semanticDigest(evidenceProjection),
    metrics,
  };
}
