import { APPLICATION_ALGORITHM_VERSION_REGISTRY } from "../../app/algorithm-version-registry";
import {
  digestPerformanceSequence,
  digestSourceChordProjection,
  resolveEffectiveChordTimeline,
} from "../harmony/chord-timeline";
import type { HarmonyProject } from "../project";
import { atomizeSourceLead } from "../source/atomization";
import type { SongSourceDocument } from "../source/model";

/** Rebuilds only accepted derived authorities after an item-scoped OMR Source revision. */
export async function integrateReviewedOmrSource(
  project: HarmonyProject,
  source: SongSourceDocument,
): Promise<HarmonyProject> {
  if (project.source.documentId !== source.documentId
    || Object.values(project.variants).some((variant) => variant?.lifecycle !== "empty")) {
    throw new RangeError("OMR_PRODUCT_HANDOFF_INVALID");
  }
  const policy = project.chordTimelineState.status === "resolved"
    ? project.chordTimelineState.timeline.resolutionPolicy
    : project.chordTimelineState.resolutionPolicy;
  const sourceChordProjectionDigest = await digestSourceChordProjection(source.sourceMeasures);
  const performanceSequenceDigest = await digestPerformanceSequence(source.performanceSequence, source.sourceMeasures);
  const chordTimelineState = await resolveEffectiveChordTimeline({
    sourceMeasures: source.sourceMeasures,
    performanceSequence: source.performanceSequence,
    sourceChordProjectionDigest,
    performanceSequenceDigest,
    policy,
    resolverVersion: APPLICATION_ALGORITHM_VERSION_REGISTRY.chordTimelineResolverVersion,
    expectedResolverVersion: APPLICATION_ALGORITHM_VERSION_REGISTRY.chordTimelineResolverVersion,
  });
  if (chordTimelineState.status !== "resolved") throw new RangeError("OMR_REVIEW_REQUIRED");
  const atomization = await atomizeSourceLead({
    sourceMeasures: source.sourceMeasures,
    performanceSequence: source.performanceSequence,
    sectionOccurrences: source.sectionOccurrences,
    phraseRegions: source.phraseRegions,
    chordTimeline: chordTimelineState.timeline,
    musicalSourceDigest: source.revisionDigest,
    atomizerVersion: APPLICATION_ALGORITHM_VERSION_REGISTRY.sourceLeadAtomizerVersion,
  });
  return {
    ...project,
    source,
    chordTimelineState,
    sourceLeadAtomizationState: { status: "resolved", atomization, diagnostics: [] },
  };
}
