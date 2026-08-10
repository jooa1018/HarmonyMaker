import type { ArrangementPresetId } from "../../../domain/config";
import { pitchMidiNumber } from "../../../domain/pitch";
import { createRc7PipelineContext } from "../authority";
import { createRc7PlaybackArtifact } from "../playback";
import { prepareRc7ReferenceCase } from "../prepare";
import { RC7_REFERENCE_CASES } from "../reference-cases";
import { runRc7GenerationStage } from "../solver";
import {
  runRc7IntentStage,
  runRc7ReviewAlternativeStages,
  type Rc7IntentStageResult,
} from "../stages";
import type {
  Rc7GenerationStageResult,
  Rc7PipelineContext,
  Rc7ReferenceCaseDefinition,
  Rc7ScoredOpportunity,
} from "../types";
import {
  RC7_SONG_SECTION_DEFINITIONS,
  runRc7SongSection,
} from "./song-sections";

export type Rc7ListeningRiskTag =
  | "accent"
  | "selective-third-voice"
  | "pad"
  | "bounded-tpp"
  | "u2s"
  | "suspension"
  | "negative-control";

interface Rc7PlanningCase {
  readonly definition: Rc7ReferenceCaseDefinition;
  readonly preset: ArrangementPresetId;
  readonly context: Rc7PipelineContext;
  readonly intent: Rc7IntentStageResult;
}

export interface Rc7InternalStimulusMetadata {
  readonly sourceKind: "grammar-opportunity" | "lead-only-reference" | "section";
  readonly caseId: string;
  readonly preset: ArrangementPresetId;
  readonly texture: string | null;
  readonly grammarRelation: "winner" | "runner-up" | "legal-sibling" | "reference";
  readonly candidateId: string | null;
  readonly candidateContentDigest: string | null;
  readonly opportunityKey: string | null;
  readonly cost: number | null;
  readonly roleTuple: readonly string[];
}

export interface Rc7InternalStimulus {
  readonly playback: string;
  readonly leadPlayback: string;
  readonly metadata: Rc7InternalStimulusMetadata;
  readonly hardRangeFailureCount: number;
  readonly verticalFailureCount: number;
  readonly averageHarmonyMidi: number | null;
  readonly soundingDurationQByTrackOrdinal: Readonly<Record<number, number>>;
}

export interface Rc7InternalComparison {
  readonly comparisonId: string;
  readonly comparisonType: "winner-vs-runner-up" | "winner-vs-legal-sibling" | "generated-vs-lead";
  readonly riskTags: readonly Rc7ListeningRiskTag[];
  readonly left: Rc7InternalStimulus;
  readonly right: Rc7InternalStimulus;
  readonly leadReferencePlayback: string;
}

export interface Rc7InternalSectionStimulus {
  readonly sectionId: string;
  readonly songLike: boolean;
  readonly bars: number;
  readonly phraseCount: number;
  readonly riskTags: readonly Rc7ListeningRiskTag[];
  readonly playback: string;
  readonly metadata: Rc7InternalStimulusMetadata;
  readonly hardRangeFailureCount: number;
  readonly verticalFailureCount: number;
}

export interface Rc7InternalListeningCorpus {
  readonly comparisons: readonly Rc7InternalComparison[];
  readonly sections: readonly Rc7InternalSectionStimulus[];
}

function referenceDefinition(caseId: string): Rc7ReferenceCaseDefinition {
  const definition = RC7_REFERENCE_CASES.find((candidate) => candidate.caseId === caseId);
  if (!definition) throw new RangeError(`RC7_LISTENING_CASE_NOT_FOUND:${caseId}`);
  return definition;
}

async function planCase(caseId: string, preset: ArrangementPresetId): Promise<Rc7PlanningCase> {
  const definition = referenceDefinition(caseId);
  const prepared = await prepareRc7ReferenceCase(definition, { presetOverride: preset });
  const context = await createRc7PipelineContext(prepared);
  return {
    definition,
    preset,
    context,
    intent: await runRc7IntentStage(context),
  };
}

function relationFor(plan: Rc7PlanningCase, opportunity: Rc7ScoredOpportunity) {
  const rank = plan.intent.selection.opportunities.findIndex((candidate) => candidate.key === opportunity.key);
  if (rank === 0) return "winner" as const;
  if (rank === 1) return "runner-up" as const;
  return "legal-sibling" as const;
}

function averageHarmonyMidi(generation: Rc7GenerationStageResult): number | null {
  const pitches = Object.values(generation.candidate.generatedEventsByTrack).flatMap((events) => (
    events.flatMap((event) => event.kind === "note" ? [pitchMidiNumber(event.pitch)] : [])
  ));
  if (pitches.length === 0) return null;
  return pitches.reduce((total, value) => total + value, 0) / pitches.length;
}

function soundingDurationQByTrackOrdinal(
  plan: Rc7PlanningCase,
  generation: Rc7GenerationStageResult,
): Readonly<Record<number, number>> {
  const measureDurationQ = plan.definition.meterFamily === "compound-duple" ? 3 : 4;
  const absoluteQuarter = (position: {
    readonly performanceMeasureIndex: number;
    readonly offset: { readonly n: number; readonly d: number };
  }) => position.performanceMeasureIndex * measureDurationQ + position.offset.n / position.offset.d;
  return Object.fromEntries(Object.entries(generation.candidate.generatedEventsByTrack).map(([
    trackPlanId,
    events,
  ]) => [
    plan.context.ordinals.trackOrdinalById[trackPlanId],
    events.reduce((duration, event) => event.kind === "rest"
      ? duration
      : duration + absoluteQuarter(event.range.end) - absoluteQuarter(event.range.start), 0),
  ]));
}

async function realizeOpportunity(
  plan: Rc7PlanningCase,
  opportunity: Rc7ScoredOpportunity,
): Promise<Rc7InternalStimulus> {
  const stages = await runRc7ReviewAlternativeStages(plan.context, plan.intent, opportunity.key);
  const generation = await runRc7GenerationStage(
    plan.context,
    stages.intent,
    stages.activity,
    stages.anchor,
  );
  const playback = createRc7PlaybackArtifact(plan.context, generation);
  return {
    playback: playback.fullArrangementAbc,
    leadPlayback: playback.leadOnlyAbc,
    metadata: {
      sourceKind: "grammar-opportunity",
      caseId: plan.definition.caseId,
      preset: plan.preset,
      texture: opportunity.textureId,
      grammarRelation: relationFor(plan, opportunity),
      candidateId: generation.candidate.id,
      candidateContentDigest: generation.candidate.contentDigest,
      opportunityKey: opportunity.key,
      cost: opportunity.totalScore,
      roleTuple: opportunity.semanticPayload.roleTuple,
    },
    hardRangeFailureCount: generation.rangeChecks.filter((check) => !check.insideHardRange).length,
    verticalFailureCount: generation.verticalLegalityChecks.filter((check) => !check.legal).length,
    averageHarmonyMidi: averageHarmonyMidi(generation),
    soundingDurationQByTrackOrdinal: soundingDurationQByTrackOrdinal(plan, generation),
  };
}

async function findDifferentAlternative(
  plan: Rc7PlanningCase,
  baseline: Rc7InternalStimulus,
  predicate: (candidate: Rc7ScoredOpportunity) => boolean,
): Promise<Rc7InternalStimulus> {
  for (const opportunity of plan.intent.selection.opportunities) {
    if (opportunity.key === plan.intent.selection.winner.key || !predicate(opportunity)) continue;
    try {
      const realization = await realizeOpportunity(plan, opportunity);
      if (realization.playback !== baseline.playback) return realization;
    } catch {
      // Grammar eligibility is necessary but the review realizer still demands
      // a complete hard-legal Solver path. Continue to the next ordered sibling.
    }
  }
  throw new RangeError(`RC7_LISTENING_LEGAL_ALTERNATIVE_MISSING:${plan.definition.caseId}:${plan.preset}`);
}

function comparisonType(right: Rc7InternalStimulus): Rc7InternalComparison["comparisonType"] {
  return right.metadata.grammarRelation === "runner-up"
    ? "winner-vs-runner-up"
    : "winner-vs-legal-sibling";
}

async function grammarPair(
  comparisonId: string,
  caseId: string,
  preset: ArrangementPresetId,
  riskTags: readonly Rc7ListeningRiskTag[],
  predicate: (candidate: Rc7ScoredOpportunity) => boolean = () => true,
): Promise<Rc7InternalComparison> {
  const plan = await planCase(caseId, preset);
  const winner = await realizeOpportunity(plan, plan.intent.selection.winner);
  const alternative = await findDifferentAlternative(plan, winner, predicate);
  return {
    comparisonId,
    comparisonType: comparisonType(alternative),
    riskTags,
    left: winner,
    right: alternative,
    leadReferencePlayback: winner.leadPlayback,
  };
}

async function generatedVsLead(
  comparisonId: string,
  caseId: string,
  preset: ArrangementPresetId,
  riskTags: readonly Rc7ListeningRiskTag[],
): Promise<Rc7InternalComparison> {
  const plan = await planCase(caseId, preset);
  const winner = await realizeOpportunity(plan, plan.intent.selection.winner);
  return {
    comparisonId,
    comparisonType: "generated-vs-lead",
    riskTags,
    left: winner,
    right: {
      playback: winner.leadPlayback,
      leadPlayback: winner.leadPlayback,
      metadata: {
        sourceKind: "lead-only-reference",
        caseId,
        preset,
        texture: null,
        grammarRelation: "reference",
        candidateId: null,
        candidateContentDigest: null,
        opportunityKey: null,
        cost: null,
        roleTuple: [],
      },
      hardRangeFailureCount: 0,
      verticalFailureCount: 0,
      averageHarmonyMidi: null,
      soundingDurationQByTrackOrdinal: {},
    },
    leadReferencePlayback: winner.leadPlayback,
  };
}

async function songSectionStimuli(): Promise<readonly Rc7InternalSectionStimulus[]> {
  return Promise.all(RC7_SONG_SECTION_DEFINITIONS.map(async (definition) => {
    const output = await runRc7SongSection(definition);
    const phraseWinners = output.phraseOutputs.map((phrase) => phrase.winner);
    return {
      sectionId: definition.sectionId,
      songLike: true,
      bars: definition.bars,
      phraseCount: definition.phrases.length,
      riskTags: definition.sectionId.startsWith("S1")
        ? ["u2s"] as const
        : definition.sectionId.startsWith("S2")
          ? ["accent", "bounded-tpp", "selective-third-voice"] as const
          : ["pad", "suspension"] as const,
      playback: output.playback.fullArrangementAbc,
      metadata: {
        sourceKind: "section" as const,
        caseId: definition.sectionId,
        preset: output.preset,
        texture: phraseWinners.map((winner) => winner.textureId).join("→"),
        grammarRelation: "winner" as const,
        candidateId: null,
        candidateContentDigest: null,
        opportunityKey: null,
        cost: null,
        roleTuple: [],
      },
      hardRangeFailureCount: output.phraseOutputs.flatMap((phrase) => phrase.rangeChecks)
        .filter((check) => !check.insideHardRange).length,
      verticalFailureCount: output.phraseOutputs.flatMap((phrase) => phrase.verticalLegalityChecks)
        .filter((check) => !check.legal).length,
    };
  }));
}

async function finalNoCueControl(): Promise<Rc7InternalSectionStimulus> {
  const plan = await planCase("L-FINAL-VERSE-NEGATIVE", "standard");
  const winner = await realizeOpportunity(plan, plan.intent.selection.winner);
  return {
    sectionId: "CONTROL-FINAL-NO-REAL-CUE",
    songLike: false,
    bars: 3,
    phraseCount: 1,
    riskTags: ["negative-control"],
    playback: winner.playback,
    metadata: { ...winner.metadata, sourceKind: "section" },
    hardRangeFailureCount: winner.hardRangeFailureCount,
    verticalFailureCount: winner.verticalFailureCount,
  };
}

export async function buildRc7InternalListeningCorpus(): Promise<Rc7InternalListeningCorpus> {
  const comparisons = await Promise.all([
    grammarPair("CMP-01", "D-BUSY-CHORUS-ACCENT", "standard", ["accent"]),
    grammarPair("CMP-02", "D-BUSY-CHORUS-ACCENT", "standard", ["accent", "selective-third-voice"],
      (candidate) => candidate.textureId === "ACCENT_BLOCK" && candidate.activeTrackOrdinals.length === 1),
    grammarPair("CMP-03", "D-BUSY-CHORUS-ACCENT", "full", ["accent"]),
    grammarPair("CMP-04", "H-STANDARD-THIRD-POSITIVE", "standard", ["selective-third-voice"],
      (candidate) => candidate.activeTrackOrdinals.length === 1),
    grammarPair("CMP-05", "I-STANDARD-THIRD-NEGATIVE", "standard", ["selective-third-voice"],
      (candidate) => candidate.activeTrackOrdinals.length === 2),
    grammarPair("CMP-06", "K-FULL-SELECTIVE-EXPANSION", "full", ["selective-third-voice", "accent"],
      (candidate) => candidate.activeTrackOrdinals.length === 1),
    grammarPair("CMP-07", "K-FULL-SELECTIVE-EXPANSION", "standard", ["selective-third-voice", "u2s"],
      (candidate) => candidate.activeTrackOrdinals.length === 1),
    grammarPair("CMP-08", "F-SUSTAINED-PAD", "full", ["pad"],
      (candidate) => candidate.textureId !== "SUSTAINED_PAD"),
    grammarPair("CMP-09", "F-SUSTAINED-PAD", "standard", ["pad"],
      (candidate) => candidate.textureId !== "SUSTAINED_PAD"),
    grammarPair("CMP-10", "C-STANDARD-CHORUS-BOUNDED-TPP", "standard", ["bounded-tpp"]),
    grammarPair("CMP-11", "O-SIMPLE-BOUNDED-TPP", "simple", ["bounded-tpp"]),
    grammarPair("CMP-12", "E-LATE-LONG-U2S", "standard", ["u2s"]),
    grammarPair("CMP-13", "E-LATE-LONG-U2S", "full", ["u2s", "selective-third-voice"],
      (candidate) => candidate.textureId === "UNISON_TO_SPLIT" && candidate.activeTrackOrdinals.length === 1),
    grammarPair("CMP-14", "B-CUE-ACTIVE-UNISON", "full", ["u2s"]),
    grammarPair("CMP-15", "G-SUSPENSION-RELEASE", "standard", ["suspension"]),
    grammarPair("CMP-16", "G-SUSPENSION-RELEASE", "full", ["suspension"],
      (candidate) => candidate.textureId !== "SUSPENSION_RELEASE"),
    generatedVsLead("CMP-17", "M-FINAL-VERSE-REAL-CUE", "standard", ["negative-control"]),
    generatedVsLead("CMP-18", "B-CUE-ACTIVE-UNISON", "standard", ["negative-control"]),
  ]);
  const sections = [...await songSectionStimuli(), await finalNoCueControl()];
  return { comparisons, sections };
}
