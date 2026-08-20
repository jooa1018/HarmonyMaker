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
import { validateCoreInputLimits } from "../../domain/limits";
import { validatePerformer } from "../../domain/performer";
import { comparePitches } from "../../domain/pitch";
import { atomizeSourceLead, type SourceLeadAtomization } from "../../domain/source/atomization";
import type { SongSourceDocument, SourceMeasure } from "../../domain/source/model";
import type { ImportedLeadEventDraft, MusicXmlImportDraft, Step3ImportVersions } from "../musicxml/types";
import {
  diagnosticInputsFromDiagnostics,
  materializeImportDiagnostics,
  type ImportDiagnosticInput,
} from "../musicxml/diagnostics";
import {
  finalizeNormalizedImportedSource,
  normalizeImportedSource,
  type ImportedSourceNormalization,
} from "./finalize";

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
  readonly normalization?: ImportedSourceNormalization;
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

function supportedPlanningMeter(sourceMeasures: readonly SourceMeasure[]): boolean {
  return sourceMeasures.every((measure) => {
    const time = measure.time;
    return (time.numerator === 4
        && time.denominator === 4
        && canonicalJson(time.beatGroups) === canonicalJson([1, 1, 1, 1]))
      || (time.numerator === 6
        && time.denominator === 8
        && canonicalJson(time.beatGroups) === canonicalJson([3, 3]));
  });
}

function hasUnsupportedModulation(
  sourceMeasures: readonly SourceMeasure[],
  defaultKey: MusicXmlImportDraft["defaultKey"],
): boolean {
  return defaultKey !== undefined && sourceMeasures.some((measure) => measure.key !== undefined
    && (measure.key.mode !== defaultKey.mode
      || measure.key.tonic.step !== defaultKey.tonic.step
      || measure.key.tonic.alter !== defaultKey.tonic.alter));
}

function performerReviewIssues(draft: MusicXmlImportDraft): ReadonlyMap<string, string> {
  const invalid = new Map<string, string>();
  for (let ordinal = 0; ordinal < draft.singerCount; ordinal += 1) {
    const expectedId = performerId(ordinal);
    const slot = draft.performerSlots[ordinal];
    if (!slot
      || slot.id !== expectedId
      || !slot.profile
      || slot.profile.id !== expectedId
      || !validatePerformer(slot.profile)) invalid.set(expectedId, "invalid-performer-profile");
  }
  for (const slot of draft.performerSlots.slice(draft.singerCount)) invalid.set(slot.id, "unexpected-performer-slot");
  const candidate = draft.leadCandidates.find((item) => item.key === draft.selectedLeadStaffKey);
  const part = candidate ? draft.parts.find((item) => item.partOrdinal === candidate.partOrdinal) : undefined;
  const leadProfile = draft.performerSlots[0]?.profile;
  if (candidate && part && leadProfile && validatePerformer(leadProfile)) {
    const pitches = part.measures.flatMap((measure) => measure.leadEvents
      .filter((event) => event.candidateKey === candidate.key && event.kind === "note")
      .map((event) => event.kind === "note" ? event.pitch : undefined)
      .filter((pitch): pitch is NonNullable<typeof pitch> => pitch !== undefined));
    if (pitches.some((pitch) => comparePitches(pitch, leadProfile.hardRange.low) < 0
      || comparePitches(pitch, leadProfile.hardRange.high) > 0)) {
      invalid.set(performerId(0), "selected-lead-outside-hard-range");
    }
  }
  return invalid;
}

function diagnosticAppliesToSelection(
  diagnostic: Diagnostic,
  draft: MusicXmlImportDraft,
  normalization: ImportedSourceNormalization | undefined,
): boolean {
  const scope = diagnostic.details?.diagnosticScope;
  if (scope === undefined) return true;
  if (!draft.selectedLeadStaffKey) return true;
  if (scope === "lead-candidate") return diagnostic.details?.candidateKey === draft.selectedLeadStaffKey;
  const selectedCandidate = draft.leadCandidates.find((candidate) => candidate.key === draft.selectedLeadStaffKey);
  const selectedPartOrdinal = selectedCandidate?.partOrdinal;
  if (scope === "selected-lead-part") return diagnostic.details?.partOrdinal === selectedPartOrdinal;
  if (scope !== "lead-part") return true;
  const rawChordPartOrdinal = draft.parts.find((part) => part.measures.some((measure) => measure.chords.length > 0))?.partOrdinal;
  const partOrdinal = diagnostic.details?.partOrdinal;
  return partOrdinal === selectedPartOrdinal
    || partOrdinal === normalization?.chordAuthorityPartOrdinal
    || partOrdinal === rawChordPartOrdinal;
}

function inputLimitDiagnostics(
  counts: Parameters<typeof validateCoreInputLimits>[0],
): readonly ImportDiagnosticInput[] {
  return validateCoreInputLimits(counts).map((violation) => ({
    code: "INPUT_LIMIT_EXCEEDED",
    messageKo: "Core 입력 상한을 초과했습니다.",
    details: {
      issue: violation.limit,
      actual: violation.actual,
      maximum: violation.maximum,
    },
  }));
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
  versions: Step3ImportVersions,
): Promise<QuickReviewAnalysis> {
  const normalized = await normalizeImportedSource(draft, versions);
  const normalization = normalized.status === "complete" ? normalized.normalization : undefined;
  const diagnosticInputs: ImportDiagnosticInput[] = [
    ...diagnosticInputsFromDiagnostics(draft.diagnostics
      .filter((diagnostic) => diagnosticAppliesToSelection(diagnostic, draft, normalization))),
    ...selectedLeadDiagnostics(draft),
  ];
  if (normalized.status === "blocked") {
    diagnosticInputs.push(...diagnosticInputsFromDiagnostics(normalized.diagnostics));
  }
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
  const performerIssues = performerReviewIssues(draft);
  const invalidPerformerIds = [...performerIssues.keys()].sort();
  for (const performerId of invalidPerformerIds) diagnosticInputs.push({
    code: "PERFORMER_RANGE_INVALID",
    messageKo: performerIssues.get(performerId) === "selected-lead-outside-hard-range"
      ? "선택한 Source Lead의 실제 음역이 Lead performer hardRange를 벗어납니다."
      : "hard/comfortable/preferred 음역의 포함 관계를 확인해야 합니다.",
    details: { performerId, issue: performerIssues.get(performerId) ?? "invalid-performer-profile" },
  });
  const missingRightsUses: readonly "generation"[] = draft.rights?.allowedUses.includes("generation") ? [] : ["generation"];
  if (missingRightsUses.length > 0) diagnosticInputs.push({
    code: "RIGHTS_GENERATION_NOT_CONFIRMED",
    messageKo: "generation 권리를 확인해야 합니다.",
    details: { issue: "missing-generation-right" },
  });
  let source: SongSourceDocument | undefined;
  let chordTimelineState: EffectiveChordTimelineState = {
    status: "unresolved",
    resolutionPolicy: { gapPolicy: "carry-until-next" },
    diagnostics: [],
  };
  let atomization: SourceLeadAtomization | undefined;
  let unconfirmedChordEventIds: readonly string[] = [];
  let unconfirmedSectionDefinitionIds: readonly string[] = [];
  if (normalization) {
    if (!supportedPlanningMeter(normalization.sourceMeasures)) diagnosticInputs.push({
      code: "UNSUPPORTED_METER",
      messageKo: "Core planning readiness는 4/4와 6/8만 지원합니다.",
      details: { issue: "planning-meter" },
    });
    if (hasUnsupportedModulation(normalization.sourceMeasures, draft.defaultKey)) diagnosticInputs.push({
      code: "UNSUPPORTED_MODULATION",
      messageKo: "선택한 Source Lead의 곡 중간 조바꿈은 Core planning에서 지원하지 않습니다.",
      details: { issue: "selected-source-modulation" },
    });
    unconfirmedChordEventIds = normalization.sourceMeasures.flatMap((measure) => measure.chordEvents
      .filter((event) => event.confirmation !== "confirmed")
      .map((event) => event.id));
    unconfirmedSectionDefinitionIds = normalization.sectionDefinitions
      .filter((section) => section.confirmation !== "confirmed")
      .map((section) => section.id);
    for (const sectionId of unconfirmedSectionDefinitionIds) diagnosticInputs.push({
      code: "SECTION_UNCONFIRMED",
      messageKo: "가져온 Section suggestion을 확인해야 합니다.",
      details: { sectionDefinitionId: sectionId },
    });
    const sourceChordProjectionDigest = await digestSourceChordProjection(normalization.sourceMeasures);
    const performanceSequenceDigest = await digestPerformanceSequence(
      normalization.performanceSequence,
      normalization.sourceMeasures,
    );
    chordTimelineState = await resolveEffectiveChordTimeline({
      sourceMeasures: normalization.sourceMeasures,
      performanceSequence: normalization.performanceSequence,
      sourceChordProjectionDigest,
      performanceSequenceDigest,
      policy: { gapPolicy: "carry-until-next" },
      resolverVersion: versions.chordTimelineResolverVersion,
      expectedResolverVersion: versions.chordTimelineResolverVersion,
    });
    diagnosticInputs.push(...diagnosticInputsFromDiagnostics(chordTimelineState.diagnostics));
    if (chordTimelineState.status === "resolved") {
      diagnosticInputs.push(...inputLimitDiagnostics({
        maxResolvedChordSpans: chordTimelineState.timeline.spans.length,
      }));
    }
    if (chordTimelineState.status === "resolved") {
      try {
        if (!normalization.musicalSourceDigest) throw new RangeError(
          normalization.unresolvedLyricOccurrenceKeys.length > 0
            ? "lyric-verse-authority-incomplete"
            : "musical-source-digest-prerequisite-incomplete",
        );
        atomization = await atomizeSourceLead({
          sourceMeasures: normalization.sourceMeasures,
          performanceSequence: normalization.performanceSequence,
          sectionOccurrences: normalization.sectionOccurrences,
          phraseRegions: normalization.phraseRegions,
          chordTimeline: chordTimelineState.timeline,
          musicalSourceDigest: normalization.musicalSourceDigest,
          atomizerVersion: versions.sourceLeadAtomizerVersion,
        });
        diagnosticInputs.push(...inputLimitDiagnostics({ maxLeadAtoms: atomization.atoms.length }));
      } catch (error) {
        const issue = error instanceof Error ? error.message : "atomization-failed";
        if (issue !== "musical-source-digest-prerequisite-incomplete"
          && issue !== "lyric-verse-authority-incomplete") diagnosticInputs.push({
            code: "SOURCE_LEAD_ATOMIZATION_STALE",
            messageKo: "Source Lead atomization을 현재 Source에서 계산할 수 없습니다.",
            details: { issue },
          });
      }
    }
    if (draft.defaultKey
      && draft.defaultTempo
      && draft.rights?.allowedUses.includes("generation")
      && normalization.unresolvedLyricOccurrenceKeys.length === 0) {
      const finalized = await finalizeNormalizedImportedSource(draft, versions, normalization);
      if (finalized.status === "complete") source = finalized.source;
      else diagnosticInputs.push(...diagnosticInputsFromDiagnostics(finalized.diagnostics));
    }
  }
  for (const occurrenceKey of normalization?.unresolvedLyricOccurrenceKeys ?? []) diagnosticInputs.push({
    code: "IMPORT_UNSUPPORTED_ELEMENT",
    messageKo: "Section occurrence별 production lyric verse를 명시적으로 선택해야 합니다.",
    details: { issue: "lyric-verse-ambiguity", occurrenceKey },
  });
  const diagnostics = await materializeImportDiagnostics(dedupeInputs(diagnosticInputs));
  const unresolvedChordGapDiagnosticIds = diagnostics
    .filter((diagnostic) => diagnostic.code === "SOURCE_CHORD_GAP"
      || diagnostic.code === "SOURCE_CHORD_CARRY_WITHOUT_PREVIOUS")
    .map((diagnostic) => diagnostic.id);
  const blockingDiagnosticIds = diagnostics
    .filter((diagnostic) => diagnostic.severity === "blocking")
    .map((diagnostic) => diagnostic.id);
  const allChordsConfirmed = normalization !== undefined
    && normalization.sourceMeasures.every((measure) => measure.chordEvents.every((event) => event.confirmation === "confirmed"));
  const allSectionsConfirmed = normalization !== undefined
    && normalization.sectionDefinitions.every((section) => section.confirmation === "confirmed");
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
      && normalization?.unresolvedLyricOccurrenceKeys.length === 0
      && invalidPerformerIds.length === 0
      && missingRightsUses.length === 0
      && draft.unsupportedPerformanceFlows.length === 0
      && blockingDiagnosticIds.length === 0,
  };
  return {
    state,
    diagnostics,
    ...(source ? { source } : {}),
    ...(normalization ? { normalization } : {}),
    chordTimelineState,
    ...(atomization ? { atomization } : {}),
  };
}
