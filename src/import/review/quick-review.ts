import { canonicalJson } from "../../domain/digest/canonical";
import type { Diagnostic } from "../../domain/diagnostics";
import {
  addFractions,
  compareFractions,
  type Fraction,
} from "../../domain/fraction";
import {
  digestPerformanceSequence,
  digestSourceChordProjection,
  resolveEffectiveChordTimeline,
  type EffectiveChordTimelineState,
} from "../../domain/harmony/chord-timeline";
import { performerId } from "../../domain/ids";
import { validatePerformer } from "../../domain/performer";
import { atomizeSourceLead, type SourceLeadAtomization } from "../../domain/source/atomization";
import type { SongSourceDocument } from "../../domain/source/model";
import type { ImportedLeadEventDraft, MusicXmlImportDraft, Step3ImportVersions } from "../musicxml/types";
import { STEP3_IMPORT_VERSIONS } from "../musicxml/types";
import {
  diagnosticInputsFromDiagnostics,
  materializeImportDiagnostics,
  type ImportDiagnosticInput,
} from "../musicxml/diagnostics";
import { finalizeImportedSource } from "./finalize";

export interface QuickReviewState {
  readonly selectedLeadStaffKey?: string;
  readonly unresolvedChordGapDiagnosticIds: readonly string[];
  readonly unconfirmedChordEventIds: readonly string[];
  readonly unconfirmedSectionDefinitionIds: readonly string[];
  readonly invalidPerformerIds: readonly string[];
  readonly unsupportedPerformanceFlowIds: readonly string[];
  readonly missingRightsUses: readonly "generation"[];
  readonly blockingDiagnosticIds: readonly string[];
  readonly readyForPlanning: boolean;
}

export interface QuickReviewAnalysis {
  readonly state: QuickReviewState;
  readonly diagnostics: readonly Diagnostic[];
  readonly source?: SongSourceDocument;
  readonly chordTimelineState: EffectiveChordTimelineState;
  readonly atomization?: SourceLeadAtomization;
}

interface PositionedDraftEvent {
  readonly event: ImportedLeadEventDraft;
  readonly start: Fraction;
  readonly end: Fraction;
}

function samePitch(
  left: Extract<ImportedLeadEventDraft, { readonly kind: "note" }>,
  right: Extract<ImportedLeadEventDraft, { readonly kind: "note" }>,
): boolean {
  return left.pitch.step === right.pitch.step
    && left.pitch.alter === right.pitch.alter
    && left.pitch.octave === right.pitch.octave;
}

function selectedLeadDiagnostics(draft: MusicXmlImportDraft): readonly ImportDiagnosticInput[] {
  if (!draft.selectedLeadStaffKey) return [{
    code: "IMPORT_UNSUPPORTED_ELEMENT",
    messageKo: "Source Lead staff/voice를 명시적으로 선택해야 합니다.",
    details: { issue: "lead-selection" },
  }];
  const candidate = draft.leadCandidates.find((item) => item.key === draft.selectedLeadStaffKey);
  const part = candidate ? draft.parts.find((item) => item.partOrdinal === candidate.partOrdinal) : undefined;
  if (!candidate || !part) return [{
    code: "IMPORT_UNSUPPORTED_ELEMENT",
    messageKo: "선택한 Source Lead candidate가 존재하지 않습니다.",
    details: { issue: "invalid-lead-selection" },
  }];
  const positioned: PositionedDraftEvent[] = [];
  let measureStart = { n: 0, d: 1 } as Fraction;
  for (const measure of part.measures) {
    for (const event of measure.leadEvents.filter((item) => item.candidateKey === candidate.key)) {
      const start = addFractions(measureStart, event.onset);
      positioned.push({ event, start, end: addFractions(start, event.duration) });
    }
    measureStart = addFractions(measureStart, measure.duration);
  }
  positioned.sort((left, right) => compareFractions(left.start, right.start)
    || compareFractions(left.end, right.end));
  const diagnostics: ImportDiagnosticInput[] = [];
  if (!positioned.some((entry) => entry.event.kind === "note")) diagnostics.push({
    code: "IMPORT_UNSUPPORTED_ELEMENT",
    messageKo: "선택한 Source Lead에 pitched note가 없습니다.",
    details: { issue: "lead-has-no-notes" },
  });
  for (let index = 0; index < positioned.length; index += 1) {
    const current = positioned[index];
    const previous = positioned[index - 1];
    const next = positioned[index + 1];
    if (previous && compareFractions(previous.end, current.start) > 0) diagnostics.push({
      code: "INPUT_EVENT_OVERLAP",
      messageKo: "선택한 Source Lead voice에 겹치는 event가 있습니다.",
      details: { issue: "selected-lead-overlap", eventOrdinal: index },
    });
    if (current.event.kind !== "note") continue;
    if (current.event.tieStop && (!previous
      || previous.event.kind !== "note"
      || compareFractions(previous.end, current.start) !== 0
      || !previous.event.tieStart
      || !samePitch(previous.event, current.event))) diagnostics.push({
      code: "INPUT_INVALID_TIE",
      messageKo: "tie stop이 같은 pitch의 연속 tie start와 연결되지 않습니다.",
      details: { issue: "tie-stop-mismatch", eventOrdinal: index },
    });
    if (current.event.tieStart && (!next
      || next.event.kind !== "note"
      || compareFractions(current.end, next.start) !== 0
      || !next.event.tieStop
      || !samePitch(current.event, next.event))) diagnostics.push({
      code: "INPUT_INVALID_TIE",
      messageKo: "tie start가 같은 pitch의 연속 tie stop과 연결되지 않습니다.",
      details: { issue: "tie-start-mismatch", eventOrdinal: index },
    });
  }
  return diagnostics;
}

function supportedPlanningMeter(source: SongSourceDocument): boolean {
  return source.sourceMeasures.every((measure) => {
    const time = measure.time;
    return (time.numerator === 4
        && time.denominator === 4
        && canonicalJson(time.beatGroups) === canonicalJson([1, 1, 1, 1]))
      || (time.numerator === 6
        && time.denominator === 8
        && canonicalJson(time.beatGroups) === canonicalJson([3, 3]));
  });
}

function hasUnsupportedModulation(source: SongSourceDocument): boolean {
  return source.sourceMeasures.some((measure) => measure.key !== undefined
    && (measure.key.mode !== source.defaultKey.mode
      || measure.key.tonic.step !== source.defaultKey.tonic.step
      || measure.key.tonic.alter !== source.defaultKey.tonic.alter));
}

function invalidPerformerSlotIds(draft: MusicXmlImportDraft): readonly string[] {
  const invalid = new Set<string>();
  for (let ordinal = 0; ordinal < draft.singerCount; ordinal += 1) {
    const expectedId = performerId(ordinal);
    const slot = draft.performerSlots[ordinal];
    if (!slot
      || slot.id !== expectedId
      || !slot.profile
      || slot.profile.id !== expectedId
      || !validatePerformer(slot.profile)) invalid.add(expectedId);
  }
  for (const slot of draft.performerSlots.slice(draft.singerCount)) invalid.add(slot.id);
  return [...invalid].sort();
}

function hasUnresolvedLyricAmbiguity(
  draft: MusicXmlImportDraft,
  source: SongSourceDocument | undefined,
): boolean {
  if (draft.selectedLyricVerse !== undefined || !draft.selectedLeadStaffKey) return false;
  const candidate = draft.leadCandidates.find((item) => item.key === draft.selectedLeadStaffKey);
  const part = candidate ? draft.parts.find((item) => item.partOrdinal === candidate.partOrdinal) : undefined;
  if (!candidate || !part) return false;
  const verses = [...new Set(part.measures.flatMap((measure) => measure.leadEvents
    .filter((event) => event.candidateKey === candidate.key && event.kind === "note")
    .flatMap((event) => event.kind === "note" ? event.lyrics.map((lyric) => lyric.verse) : [])))].sort((left, right) => left - right);
  if (verses.length <= 1) return false;
  if (!source) return true;
  const occurrencesByDefinition = new Map<string, typeof source.sectionOccurrences>();
  for (const occurrence of source.sectionOccurrences) {
    occurrencesByDefinition.set(occurrence.sectionDefinitionId, [
      ...(occurrencesByDefinition.get(occurrence.sectionDefinitionId) ?? []),
      occurrence,
    ]);
  }
  const repeated = [...occurrencesByDefinition.values()].filter((occurrences) => occurrences.length > 1);
  return repeated.length === 0 || repeated.some((occurrences) => {
    const ordered = [...occurrences].sort((left, right) => left.occurrenceIndex - right.occurrenceIndex);
    return ordered.length !== verses.length
      || ordered.some((occurrence, index) => occurrence.lyricVerseIndex !== verses[index]);
  });
}

function dedupeInputs(inputs: readonly ImportDiagnosticInput[]): readonly ImportDiagnosticInput[] {
  const byProjection = new Map<string, ImportDiagnosticInput>();
  for (const input of inputs) {
    const key = canonicalJson({
      code: input.code,
      severity: input.severity ?? "blocking",
      location: input.location ?? null,
      details: input.details ?? null,
    });
    if (!byProjection.has(key)) byProjection.set(key, input);
  }
  return [...byProjection.values()];
}

export async function deriveQuickReview(
  draft: MusicXmlImportDraft,
  versions: Step3ImportVersions = STEP3_IMPORT_VERSIONS,
): Promise<QuickReviewAnalysis> {
  const diagnosticInputs: ImportDiagnosticInput[] = [
    ...diagnosticInputsFromDiagnostics(draft.diagnostics),
    ...selectedLeadDiagnostics(draft),
  ];
  if (!draft.defaultKey) diagnosticInputs.push({
    code: "UNSUPPORTED_KEY_SIGNATURE",
    messageKo: "기본 조성을 확인해야 합니다.",
    details: { issue: "missing-key" },
  });
  if (!draft.defaultTempo) diagnosticInputs.push({
    code: "IMPORT_UNSUPPORTED_ELEMENT",
    messageKo: "초기 tempo를 명시적으로 입력해야 합니다.",
    details: { issue: "missing-tempo" },
  });
  const invalidPerformerIds = invalidPerformerSlotIds(draft);
  for (const performerId of invalidPerformerIds) diagnosticInputs.push({
    code: "PERFORMER_RANGE_INVALID",
    messageKo: "hard/comfortable/preferred 음역의 포함 관계를 확인해야 합니다.",
    details: { performerId },
  });
  const missingRightsUses: readonly "generation"[] = draft.rights?.allowedUses.includes("generation") ? [] : ["generation"];
  if (missingRightsUses.length > 0) diagnosticInputs.push({
    code: "RIGHTS_GENERATION_NOT_CONFIRMED",
    messageKo: "generation 권리를 확인해야 합니다.",
    details: { issue: "missing-generation-right" },
  });
  const finalized = await finalizeImportedSource(draft, versions);
  let source: SongSourceDocument | undefined;
  if (finalized.status === "complete") source = finalized.source;
  else diagnosticInputs.push(...diagnosticInputsFromDiagnostics(finalized.diagnostics));
  let chordTimelineState: EffectiveChordTimelineState = {
    status: "unresolved",
    resolutionPolicy: { gapPolicy: "carry-until-next" },
    diagnostics: [],
  };
  let atomization: SourceLeadAtomization | undefined;
  let unconfirmedChordEventIds: readonly string[] = [];
  let unconfirmedSectionDefinitionIds: readonly string[] = [];
  if (source) {
    if (!supportedPlanningMeter(source)) diagnosticInputs.push({
      code: "UNSUPPORTED_METER",
      messageKo: "Core planning readiness는 4/4와 6/8만 지원합니다.",
      details: { issue: "planning-meter" },
    });
    if (hasUnsupportedModulation(source)) diagnosticInputs.push({
      code: "UNSUPPORTED_MODULATION",
      messageKo: "선택한 Source Lead의 곡 중간 조바꿈은 Core planning에서 지원하지 않습니다.",
      details: { issue: "selected-source-modulation" },
    });
    unconfirmedChordEventIds = source.sourceMeasures.flatMap((measure) => measure.chordEvents
      .filter((event) => event.confirmation !== "confirmed")
      .map((event) => event.id));
    unconfirmedSectionDefinitionIds = source.sectionDefinitions
      .filter((section) => section.confirmation !== "confirmed")
      .map((section) => section.id);
    for (const sectionId of unconfirmedSectionDefinitionIds) diagnosticInputs.push({
      code: "SECTION_UNCONFIRMED",
      messageKo: "가져온 Section suggestion을 확인해야 합니다.",
      details: { sectionDefinitionId: sectionId },
    });
    const sourceChordProjectionDigest = await digestSourceChordProjection(source.sourceMeasures);
    const performanceSequenceDigest = await digestPerformanceSequence(source.performanceSequence, source.sourceMeasures);
    chordTimelineState = await resolveEffectiveChordTimeline({
      sourceMeasures: source.sourceMeasures,
      performanceSequence: source.performanceSequence,
      sourceChordProjectionDigest,
      performanceSequenceDigest,
      policy: { gapPolicy: "carry-until-next" },
      resolverVersion: versions.chordTimelineResolverVersion,
      expectedResolverVersion: versions.chordTimelineResolverVersion,
    });
    diagnosticInputs.push(...diagnosticInputsFromDiagnostics(chordTimelineState.diagnostics));
    if (chordTimelineState.status === "resolved") {
      try {
        atomization = await atomizeSourceLead({
          sourceMeasures: source.sourceMeasures,
          performanceSequence: source.performanceSequence,
          sectionOccurrences: source.sectionOccurrences,
          phraseRegions: source.phraseRegions,
          chordTimeline: chordTimelineState.timeline,
          musicalSourceDigest: source.revisionDigest,
          atomizerVersion: versions.sourceLeadAtomizerVersion,
        });
      } catch (error) {
        diagnosticInputs.push({
          code: "SOURCE_LEAD_ATOMIZATION_STALE",
          messageKo: "Source Lead atomization을 현재 Source에서 계산할 수 없습니다.",
          details: { issue: error instanceof Error ? error.message : "atomization-failed" },
        });
      }
    }
  }
  if (hasUnresolvedLyricAmbiguity(draft, source)) diagnosticInputs.push({
    code: "IMPORT_UNSUPPORTED_ELEMENT",
    messageKo: "여러 lyric verse 중 production verse를 명시적으로 선택해야 합니다.",
    details: { issue: "lyric-verse-ambiguity" },
  });
  const diagnostics = await materializeImportDiagnostics(dedupeInputs(diagnosticInputs));
  const unresolvedChordGapDiagnosticIds = diagnostics
    .filter((diagnostic) => diagnostic.code === "SOURCE_CHORD_GAP"
      || diagnostic.code === "SOURCE_CHORD_CARRY_WITHOUT_PREVIOUS")
    .map((diagnostic) => diagnostic.id);
  const blockingDiagnosticIds = diagnostics
    .filter((diagnostic) => diagnostic.severity === "blocking")
    .map((diagnostic) => diagnostic.id);
  const allChordsConfirmed = source !== undefined
    && source.sourceMeasures.every((measure) => measure.chordEvents.every((event) => event.confirmation === "confirmed"));
  const allSectionsConfirmed = source !== undefined
    && source.sectionDefinitions.every((section) => section.confirmation === "confirmed");
  const state: QuickReviewState = {
    ...(draft.selectedLeadStaffKey ? { selectedLeadStaffKey: draft.selectedLeadStaffKey } : {}),
    unresolvedChordGapDiagnosticIds,
    unconfirmedChordEventIds,
    unconfirmedSectionDefinitionIds,
    invalidPerformerIds,
    unsupportedPerformanceFlowIds: draft.unsupportedPerformanceFlows.map((flow) => flow.id),
    missingRightsUses,
    blockingDiagnosticIds,
    readyForPlanning: draft.selectedLeadStaffKey !== undefined
      && source !== undefined
      && chordTimelineState.status === "resolved"
      && atomization !== undefined
      && allChordsConfirmed
      && allSectionsConfirmed
      && invalidPerformerIds.length === 0
      && missingRightsUses.length === 0
      && draft.unsupportedPerformanceFlows.length === 0
      && blockingDiagnosticIds.length === 0,
  };
  return {
    state,
    diagnostics,
    ...(source ? { source } : {}),
    chordTimelineState,
    ...(atomization ? { atomization } : {}),
  };
}
