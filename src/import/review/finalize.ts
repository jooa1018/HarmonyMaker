import { chordSemanticProjection } from "../../domain/chord/parser";
import { semanticDigest, compareCanonicalValues } from "../../domain/digest/canonical";
import { digestMusicalSource, digestMusicalSourceComponents } from "../../domain/digest/source";
import { buildMusicXmlSourceTargetMap } from "../../domain/omr/import-identity";
import type { Diagnostic } from "../../domain/diagnostics";
import { fraction } from "../../domain/fraction";
import {
  leadEventId,
  lyricTokenId,
  phraseRegionId,
  sectionDefinitionId,
  sectionOccurrenceId,
  sourceChordEventId,
  sourceMeasureId,
  sourceTextEventId,
} from "../../domain/ids";
import { expandRepeats } from "../../domain/performance/repeat";
import type { PerformanceSequence } from "../../domain/performance/repeat";
import { validateCoreInputLimits } from "../../domain/limits";
import type {
  LeadEvent,
  LyricToken,
  PhraseRegion,
  SectionDefinition,
  SectionOccurrence,
  SongSourceDocument,
  SourceChordEvent,
  SourceMeasure,
  SourceTextEvent,
} from "../../domain/source/model";
import { validateSectionPartition } from "../../domain/source/model";
import { normalizeSongSourceDocument } from "../../domain/source/normalize";
import { computeRevisionHistoryDigest } from "../../domain/source/revision";
import {
  isSongSourceDocument,
  validateSongSourceDocumentIntegrity,
} from "../../domain/source/validation";
import type {
  ImportedChordDraft,
  ImportedLeadEventDraft,
  ImportedMeasureDraft,
  ImportedPartDraft,
  ImportedSectionDraft,
  MusicXmlImportDraft,
  Step3ImportVersions,
  UnsupportedPerformanceFlow,
} from "../musicxml/types";
import { materializeImportDiagnostics, type ImportDiagnosticInput } from "../musicxml/diagnostics";
import {
  buildImportedSectionOccurrenceReviews,
  buildImportedSectionOccurrenceRuns,
  importedSectionOccurrenceReviewKey,
} from "./occurrences";

export type ImportedSourceFinalizationResult =
  | {
      readonly status: "complete";
      readonly source: SongSourceDocument;
      readonly diagnostics: readonly Diagnostic[];
    }
  | {
      readonly status: "blocked";
      readonly diagnostics: readonly Diagnostic[];
    };

function blockedInput(
  issue: string,
  messageKo: string,
  code: ImportDiagnosticInput["code"] = "SOURCE_REVISION_INVALID",
): ImportDiagnosticInput {
  return { code, messageKo, details: { issue } };
}

function leadProjection(event: ImportedLeadEventDraft): object {
  return event.kind === "rest"
    ? { kind: "rest", onset: event.onset, duration: event.duration }
    : {
        kind: "note",
        onset: event.onset,
        duration: event.duration,
        pitch: event.pitch,
        tieStart: event.tieStart,
        tieStop: event.tieStop,
      };
}

function chordParseProjection(chord: ImportedChordDraft): object {
  if (chord.parseResult.status === "ok") {
    return { status: "ok", chord: chordSemanticProjection(chord.parseResult.chord) };
  }
  if (chord.parseResult.status === "failed") {
    return {
      status: "failed",
      errorCode: chord.parseResult.errorCode,
      token: chord.parseResult.token ?? null,
    };
  }
  return { status: chord.parseResult.status };
}

function chordProjection(chord: ImportedChordDraft): object {
  return {
    onset: chord.onset,
    parseResult: chordParseProjection(chord),
    source: chord.source,
    confirmation: chord.confirmation,
  };
}

function assertUniqueProjections<T>(
  values: readonly T[],
  project: (value: T) => object,
  label: string,
): void {
  for (let index = 1; index < values.length; index += 1) {
    if (compareCanonicalValues(project(values[index - 1]), project(values[index])) === 0) {
      throw new RangeError(`duplicate semantic ${label}`);
    }
  }
}

function materializeLead(
  measureOrdinal: number,
  measure: ImportedMeasureDraft,
  selectedLeadKey: string,
): { readonly leadEvents: readonly LeadEvent[]; readonly lyricTokens: readonly LyricToken[] } {
  const ordered = measure.leadEvents
    .filter((event) => event.candidateKey === selectedLeadKey)
    .sort((left, right) => compareCanonicalValues(leadProjection(left), leadProjection(right)));
  assertUniqueProjections(ordered, leadProjection, "lead event");
  const tokenEntries = ordered.flatMap((event, leadOrdinal) => event.kind === "note"
    ? event.lyrics.map((lyric) => ({ leadOrdinal, lyric }))
    : []);
  const tokenProjection = (entry: typeof tokenEntries[number]) => ({
    verse: entry.lyric.verse,
    leadEventOrdinal: entry.leadOrdinal,
    syllabic: entry.lyric.syllabic,
    extend: entry.lyric.extend,
    productionEmphasis: entry.lyric.musicXmlAccent ? "musicxml-accent-suggested" : "none",
  });
  tokenEntries.sort((left, right) => compareCanonicalValues(tokenProjection(left), tokenProjection(right)));
  assertUniqueProjections(tokenEntries, tokenProjection, "lyric token");
  const tokenCounts = new Map<string, number>();
  const lyricTokens = tokenEntries.map(({ leadOrdinal, lyric }): LyricToken => {
    const countKey = `${leadOrdinal}:${lyric.verse}`;
    const tokenOrdinal = tokenCounts.get(countKey) ?? 0;
    tokenCounts.set(countKey, tokenOrdinal + 1);
    const base = {
      id: lyricTokenId(measureOrdinal, leadOrdinal, lyric.verse, tokenOrdinal),
      text: lyric.text,
      syllabic: lyric.syllabic,
      leadEventId: leadEventId(measureOrdinal, leadOrdinal),
      verse: lyric.verse,
      extend: lyric.extend,
    };
    return lyric.musicXmlAccent
      ? { ...base, emphasis: "suggested", emphasisSource: "musicxml-accent" }
      : { ...base, emphasis: "none" };
  });
  const tokenIdsByLead = new Map<number, string[]>();
  tokenEntries.forEach((entry, ordinal) => {
    const values = tokenIdsByLead.get(entry.leadOrdinal) ?? [];
    values.push(lyricTokens[ordinal].id);
    tokenIdsByLead.set(entry.leadOrdinal, values);
  });
  const sourceMeasure = sourceMeasureId(measureOrdinal);
  const leadEvents = ordered.map((event, eventOrdinal): LeadEvent => event.kind === "rest"
    ? {
        kind: "rest",
        id: leadEventId(measureOrdinal, eventOrdinal),
        sourceMeasureId: sourceMeasure,
        onset: event.onset,
        duration: event.duration,
      }
    : {
        kind: "note",
        id: leadEventId(measureOrdinal, eventOrdinal),
        sourceMeasureId: sourceMeasure,
        onset: event.onset,
        duration: event.duration,
        pitch: event.pitch,
        tieStart: event.tieStart,
        tieStop: event.tieStop,
        lyricTokenIds: tokenIdsByLead.get(eventOrdinal) ?? [],
      });
  return { leadEvents, lyricTokens };
}

function materializeChords(
  measureOrdinal: number,
  measure: ImportedMeasureDraft | undefined,
): readonly SourceChordEvent[] {
  if (!measure) return [];
  const ordered = [...measure.chords].sort((left, right) => compareCanonicalValues(
    chordProjection(left),
    chordProjection(right),
  ));
  assertUniqueProjections(ordered, chordProjection, "source chord event");
  return ordered.map((chord, chordOrdinal) => ({
    id: sourceChordEventId(measureOrdinal, chordOrdinal),
    sourceMeasureId: sourceMeasureId(measureOrdinal),
    onset: chord.onset,
    sourceText: chord.sourceText,
    parseResult: chord.parseResult,
    source: chord.source,
    confirmation: chord.confirmation,
  }));
}

function textProjection(event: ImportedMeasureDraft["textEvents"][number]): object {
  return {
    onset: event.onset,
    kind: event.kind,
    text: event.kind === "section-label" ? event.text.normalize("NFC") : null,
  };
}

function materializeTexts(
  measureOrdinal: number,
  measure: ImportedMeasureDraft,
): readonly SourceTextEvent[] {
  const ordered = [...measure.textEvents]
    .sort((left, right) => compareCanonicalValues(textProjection(left), textProjection(right))
      || (left.text < right.text ? -1 : left.text > right.text ? 1 : 0));
  const unique = ordered.filter((event, index) => index === 0
    || compareCanonicalValues(textProjection(event), textProjection(ordered[index - 1])) !== 0);
  const counts = new Map<string, number>();
  return unique.map((event) => {
    const key = `${event.onset.n}/${event.onset.d}:${event.kind}`;
    const ordinal = counts.get(key) ?? 0;
    counts.set(key, ordinal + 1);
    return {
      id: sourceTextEventId(measureOrdinal, event.onset, event.kind, ordinal),
      sourceMeasureId: sourceMeasureId(measureOrdinal),
      onset: event.onset,
      kind: event.kind,
      text: event.text,
    };
  });
}

function hasAlignedChordAuthorityMeasures(
  selectedPart: ImportedPartDraft,
  candidate: ImportedPartDraft,
): boolean {
  return candidate.measures.length === selectedPart.measures.length
    && candidate.measures.every((measure, ordinal) => {
      const selected = selectedPart.measures[ordinal];
      return selected !== undefined
        && compareCanonicalValues({
          number: measure.number,
          implicit: measure.implicit,
          time: measure.time,
          duration: measure.duration,
          repeat: measure.repeat,
        }, {
          number: selected.number,
          implicit: selected.implicit,
          time: selected.time,
          duration: selected.duration,
          repeat: selected.repeat,
        }) === 0;
    });
}

export function chordAuthorityPart(
  draft: MusicXmlImportDraft,
  selectedPart: ImportedPartDraft,
): ImportedPartDraft {
  if (selectedPart.measures.some((measure) => measure.chords.length > 0)) return selectedPart;
  const candidate = draft.parts.find((part) => part.measures.some((measure) => measure.chords.length > 0));
  if (!candidate) return selectedPart;
  if (!hasAlignedChordAuthorityMeasures(selectedPart, candidate)) {
    throw new RangeError(`chord-authority-part-misaligned:p:${candidate.partOrdinal}`);
  }
  return candidate;
}

function materializeMeasures(
  draft: MusicXmlImportDraft,
  selectedPart: ImportedPartDraft,
  selectedLeadKey: string,
): readonly SourceMeasure[] {
  const chordPart = chordAuthorityPart(draft, selectedPart);
  return selectedPart.measures.map((measure, measureOrdinal): SourceMeasure => {
    const lead = materializeLead(measureOrdinal, measure, selectedLeadKey);
    return {
      id: sourceMeasureId(measureOrdinal),
      number: measure.number,
      implicit: measure.implicit,
      time: measure.time,
      duration: measure.duration,
      ...(measure.key ? { key: measure.key } : {}),
      leadEvents: lead.leadEvents,
      chordEvents: materializeChords(measureOrdinal, chordPart.measures[measureOrdinal]),
      lyricTokens: lead.lyricTokens,
      textEvents: materializeTexts(measureOrdinal, measure),
      repeat: measure.repeat,
    };
  });
}

interface DefinitionBuild {
  readonly key: string;
  readonly start: number;
  readonly end: number;
  readonly type: ImportedSectionDraft["type"];
  readonly label: string;
  readonly confirmation: ImportedSectionDraft["confirmation"];
}

function materializeSections(
  draft: MusicXmlImportDraft,
  selectedPart: ImportedPartDraft,
  sourceMeasures: readonly SourceMeasure[],
  performance: SongSourceDocument["performanceSequence"],
  selectedLeadKey: string,
): {
  readonly definitions: readonly SectionDefinition[];
  readonly occurrences: readonly SectionOccurrence[];
  readonly phrases: readonly PhraseRegion[];
} {
  const builds: DefinitionBuild[] = draft.sections
    .filter((section) => section.partOrdinal === selectedPart.partOrdinal)
    .map((section) => ({
      key: section.key,
      start: section.startMeasureOrdinal,
      end: section.endMeasureOrdinalExclusive,
      type: section.type,
      label: section.label,
      confirmation: section.confirmation,
    }))
    .sort((left, right) => compareCanonicalValues(
      { type: left.type, sourceMeasureOrdinals: Array.from({ length: left.end - left.start }, (_, index) => left.start + index), confirmation: left.confirmation },
      { type: right.type, sourceMeasureOrdinals: Array.from({ length: right.end - right.start }, (_, index) => right.start + index), confirmation: right.confirmation },
    ));
  if (builds.length === 0
    || builds.some((build) => build.start < 0 || build.end <= build.start || build.end > sourceMeasures.length)) {
    throw new RangeError("section definitions do not cover valid source ranges");
  }
  const duplicateCounts = new Map<string, number>();
  const definitions = builds.map((build): SectionDefinition => {
    const duplicateKey = `${build.start}:${build.end}:${build.type}`;
    const duplicateOrdinal = duplicateCounts.get(duplicateKey) ?? 0;
    duplicateCounts.set(duplicateKey, duplicateOrdinal + 1);
    return {
      id: sectionDefinitionId(build.start, build.end, build.type, duplicateOrdinal),
      type: build.type,
      label: build.label,
      sourceMeasureIds: sourceMeasures.slice(build.start, build.end).map((measure) => measure.id),
      confirmation: build.confirmation,
    };
  });
  const definitionByBuildKey = new Map(builds.map((build, index) => [build.key, {
    definition: definitions[index],
    definitionOrdinal: index,
    build,
  }]));
  const runs = buildImportedSectionOccurrenceRuns(selectedPart, draft.sections, performance);
  const occurrenceBuilds = runs.map((run) => {
    const definition = definitionByBuildKey.get(run.sectionKey);
    if (!definition) throw new RangeError("section occurrence references a missing definition");
    const reviewKey = importedSectionOccurrenceReviewKey({
      candidateKey: selectedLeadKey,
      sectionKey: run.sectionKey,
      occurrenceIndex: run.occurrenceIndex,
      startPerformanceMeasureIndex: run.startPerformanceMeasureIndex,
      endPerformanceMeasureIndexExclusive: run.endPerformanceMeasureIndexExclusive,
    });
    const review = draft.sectionOccurrences.find((candidate) => candidate.key === reviewKey);
    const lyricVerseIndex = review?.selectedLyricVerse
      ?? (review?.availableLyricVerses.length === 1 ? review.availableLyricVerses[0] : 1);
    return {
      definition,
      occurrenceIndex: run.occurrenceIndex,
      variant: run.occurrenceIndex === 0 ? "base" as const : "reprise" as const,
      lyricVerseIndex,
      start: run.startPerformanceMeasureIndex,
      end: run.endPerformanceMeasureIndexExclusive,
    };
  }).sort((left, right) => compareCanonicalValues(
    {
      definitionOrdinal: left.definition.definitionOrdinal,
      occurrenceIndex: left.occurrenceIndex,
      variant: left.variant,
      lyricVerseIndex: left.lyricVerseIndex,
      startPerformanceMeasureIndex: left.start,
      endPerformanceMeasureIndexExclusive: left.end,
    },
    {
      definitionOrdinal: right.definition.definitionOrdinal,
      occurrenceIndex: right.occurrenceIndex,
      variant: right.variant,
      lyricVerseIndex: right.lyricVerseIndex,
      startPerformanceMeasureIndex: right.start,
      endPerformanceMeasureIndexExclusive: right.end,
    },
  ));
  const occurrences = occurrenceBuilds.map((build): SectionOccurrence => ({
    id: sectionOccurrenceId(build.start, build.end, build.definition.definitionOrdinal),
    sectionDefinitionId: build.definition.definition.id,
    occurrenceIndex: build.occurrenceIndex,
    variant: build.variant,
    lyricVerseIndex: build.lyricVerseIndex,
    startPerformanceMeasureIndex: build.start,
    endPerformanceMeasureIndexExclusive: build.end,
  }));
  const phraseBuilds = occurrences.map((occurrence, occurrenceOrdinal) => ({
    occurrence,
    occurrenceOrdinal,
    range: {
      start: { performanceMeasureIndex: occurrence.startPerformanceMeasureIndex, offset: fraction(0) },
      end: { performanceMeasureIndex: occurrence.endPerformanceMeasureIndexExclusive, offset: fraction(0) },
    },
  })).sort((left, right) => compareCanonicalValues(
    { sectionOccurrenceOrdinal: left.occurrenceOrdinal, range: left.range },
    { sectionOccurrenceOrdinal: right.occurrenceOrdinal, range: right.range },
  ));
  const phrases = phraseBuilds.map((build): PhraseRegion => ({
    id: phraseRegionId(build.occurrenceOrdinal, build.range.start, build.range.end),
    sectionOccurrenceId: build.occurrence.id,
    range: build.range,
    boundarySource: "section-boundary",
  }));
  return { definitions, occurrences, phrases };
}

function selectedPartForDraft(draft: MusicXmlImportDraft): ImportedPartDraft | undefined {
  const candidate = draft.leadCandidates.find((item) => item.key === draft.selectedLeadStaffKey);
  return candidate ? draft.parts.find((part) => part.partOrdinal === candidate.partOrdinal) : undefined;
}

export interface ImportedSourceNormalization {
  readonly sourceMeasures: readonly SourceMeasure[];
  readonly performanceSequence: PerformanceSequence;
  readonly sectionDefinitions: readonly SectionDefinition[];
  readonly sectionOccurrences: readonly SectionOccurrence[];
  readonly phraseRegions: readonly PhraseRegion[];
  readonly chordAuthorityPartOrdinal: number;
  readonly unsupportedPerformanceFlows: readonly UnsupportedPerformanceFlow[];
  readonly unresolvedLyricOccurrenceKeys: readonly string[];
  readonly musicalSourceDigest?: Awaited<ReturnType<typeof digestMusicalSourceComponents>>;
}

export type ImportedSourceNormalizationResult =
  | {
      readonly status: "complete";
      readonly normalization: ImportedSourceNormalization;
      readonly diagnostics: readonly Diagnostic[];
    }
  | {
      readonly status: "blocked";
      readonly diagnostics: readonly Diagnostic[];
    };

function versionMismatchInputs(
  draft: MusicXmlImportDraft,
  versions: Step3ImportVersions,
): readonly ImportDiagnosticInput[] {
  const fields = [
    "performanceExpanderVersion",
    "chordTimelineResolverVersion",
    "sourceLeadAtomizerVersion",
  ] as const;
  return fields.flatMap((field) => draft.algorithmVersions[field] === versions[field] ? [] : [{
    code: "ALGORITHM_CONFIG_MISMATCH" as const,
    messageKo: "가져오기 draft의 알고리즘 버전과 현재 실행 registry가 일치하지 않습니다.",
    details: {
      issue: `version:${field}`,
      storedVersion: draft.algorithmVersions[field],
      currentVersion: versions[field],
    },
  }]);
}

function limitInputs(counts: Parameters<typeof validateCoreInputLimits>[0]): readonly ImportDiagnosticInput[] {
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

function expectedOccurrenceReviewKeys(
  draft: MusicXmlImportDraft,
  selectedPart: ImportedPartDraft,
  selectedLeadKey: string,
  performance: PerformanceSequence,
): readonly string[] {
  return buildImportedSectionOccurrenceRuns(selectedPart, draft.sections, performance).map((run) =>
    importedSectionOccurrenceReviewKey({
      candidateKey: selectedLeadKey,
      sectionKey: run.sectionKey,
      occurrenceIndex: run.occurrenceIndex,
      startPerformanceMeasureIndex: run.startPerformanceMeasureIndex,
      endPerformanceMeasureIndexExclusive: run.endPerformanceMeasureIndexExclusive,
    }));
}

export async function normalizeImportedSource(
  draft: MusicXmlImportDraft,
  versions: Step3ImportVersions,
): Promise<ImportedSourceNormalizationResult> {
  const prerequisiteErrors: ImportDiagnosticInput[] = [...versionMismatchInputs(draft, versions)];
  if (!draft.selectedLeadStaffKey) prerequisiteErrors.push(blockedInput(
    "lead-selection",
    "Source Lead staff/voice를 명시적으로 선택해야 합니다.",
    "IMPORT_UNSUPPORTED_ELEMENT",
  ));
  const selectedPart = selectedPartForDraft(draft);
  if (!selectedPart) prerequisiteErrors.push(blockedInput(
    "invalid-lead-selection",
    "선택한 Source Lead candidate를 찾을 수 없습니다.",
    "IMPORT_UNSUPPORTED_ELEMENT",
  ));
  if (prerequisiteErrors.length > 0 || !selectedPart) {
    return { status: "blocked", diagnostics: await materializeImportDiagnostics(prerequisiteErrors) };
  }
  const selectedLeadKey = draft.selectedLeadStaffKey;
  if (!selectedLeadKey) throw new RangeError("selected lead key disappeared after prerequisite validation");
  try {
    const sourceMeasures = materializeMeasures(draft, selectedPart, selectedLeadKey);
    const expanded = expandRepeats(sourceMeasures, versions.performanceExpanderVersion);
    if (expanded.status === "blocked") {
      return {
        status: "blocked",
        diagnostics: await materializeImportDiagnostics([{
          code: expanded.code,
          messageKo: "repeat/ending을 유한한 PerformanceSequence로 전개할 수 없습니다.",
          details: { issue: expanded.code },
        }]),
      };
    }
    const sections = materializeSections(
      draft,
      selectedPart,
      sourceMeasures,
      expanded.sequence,
      selectedLeadKey,
    );
    const limits = limitInputs({
      maxSourceMeasures: sourceMeasures.length,
      maxPerformanceMeasures: expanded.sequence.occurrences.length,
      maxSectionOccurrences: sections.occurrences.length,
      maxPhraseRegions: sections.phrases.length,
    });
    if (limits.length > 0) {
      return { status: "blocked", diagnostics: await materializeImportDiagnostics(limits) };
    }
    if (validateSectionPartition(
      sections.definitions,
      sections.occurrences,
      sourceMeasures,
      expanded.sequence,
    ).length > 0) {
      return {
        status: "blocked",
        diagnostics: await materializeImportDiagnostics([blockedInput(
          "section-partition",
          "Section occurrence가 PerformanceSequence를 정확히 덮지 않습니다.",
          "SECTION_COVERAGE_INVALID",
        )]),
      };
    }
    const occurrenceReviewKeys = expectedOccurrenceReviewKeys(
      draft,
      selectedPart,
      selectedLeadKey,
      expanded.sequence,
    );
    const recomputedReviews = buildImportedSectionOccurrenceReviews(
      draft.parts,
      draft.leadCandidates,
      draft.sections,
      versions.performanceExpanderVersion,
    );
    const recomputedReviewByKey = new Map(recomputedReviews.map((review) => [review.key, review]));
    const unresolvedLyricOccurrenceKeys = occurrenceReviewKeys.filter((key) => {
      const review = draft.sectionOccurrences.find((candidate) => candidate.key === key);
      const expectedReview = recomputedReviewByKey.get(key);
      if (!review || !expectedReview
        || compareCanonicalValues({
          key: review.key,
          candidateKey: review.candidateKey,
          partOrdinal: review.partOrdinal,
          sectionKey: review.sectionKey,
          occurrenceIndex: review.occurrenceIndex,
          startPerformanceMeasureIndex: review.startPerformanceMeasureIndex,
          endPerformanceMeasureIndexExclusive: review.endPerformanceMeasureIndexExclusive,
          availableLyricVerses: review.availableLyricVerses,
        }, {
          key: expectedReview.key,
          candidateKey: expectedReview.candidateKey,
          partOrdinal: expectedReview.partOrdinal,
          sectionKey: expectedReview.sectionKey,
          occurrenceIndex: expectedReview.occurrenceIndex,
          startPerformanceMeasureIndex: expectedReview.startPerformanceMeasureIndex,
          endPerformanceMeasureIndexExclusive: expectedReview.endPerformanceMeasureIndexExclusive,
          availableLyricVerses: expectedReview.availableLyricVerses,
        }) !== 0) return true;
      if (review.selectedLyricVerse !== undefined
        && review.availableLyricVerses.length > 0
        && !review.availableLyricVerses.includes(review.selectedLyricVerse)) return true;
      if (review.availableLyricVerses.length <= 1) return false;
      return review.selectedLyricVerse === undefined
        || !review.availableLyricVerses.includes(review.selectedLyricVerse);
    });
    const musicalSourceDigest = draft.defaultKey && draft.defaultTempo
      && unresolvedLyricOccurrenceKeys.length === 0
      ? await digestMusicalSourceComponents({
          defaultKey: draft.defaultKey,
          defaultTempo: draft.defaultTempo,
          sourceMeasures,
          performanceSequence: expanded.sequence,
          sectionDefinitions: sections.definitions,
          sectionOccurrences: sections.occurrences,
          phraseRegions: sections.phrases,
        })
      : undefined;
    return {
      status: "complete",
      normalization: {
        sourceMeasures,
        performanceSequence: expanded.sequence,
        sectionDefinitions: sections.definitions,
        sectionOccurrences: sections.occurrences,
        phraseRegions: sections.phrases,
        chordAuthorityPartOrdinal: chordAuthorityPart(draft, selectedPart).partOrdinal,
        unsupportedPerformanceFlows: draft.unsupportedPerformanceFlows,
        unresolvedLyricOccurrenceKeys,
        ...(musicalSourceDigest ? { musicalSourceDigest } : {}),
      },
      diagnostics: [],
    };
  } catch (error) {
    const issue = error instanceof Error ? error.message : "source-normalization-failed";
    return {
      status: "blocked",
      diagnostics: await materializeImportDiagnostics([{
        code: issue.startsWith("chord-authority-part-misaligned")
          ? "IMPORT_UNSUPPORTED_ELEMENT"
          : "SOURCE_REVISION_INVALID",
        messageKo: issue.startsWith("chord-authority-part-misaligned")
          ? "선택한 Lead part와 chord authority part의 마디 구조가 일치하지 않습니다."
          : "MusicXML draft를 canonical Source 구조로 정규화할 수 없습니다.",
        details: { issue },
      }]),
    };
  }
}

async function finalizeNormalization(
  draft: MusicXmlImportDraft,
  versions: Step3ImportVersions,
  normalized: ImportedSourceNormalization,
): Promise<ImportedSourceFinalizationResult> {
  const prerequisiteErrors: ImportDiagnosticInput[] = [];
  if (!draft.defaultKey) prerequisiteErrors.push(blockedInput(
    "missing-key",
    "기본 조성을 확인해야 합니다.",
    "UNSUPPORTED_KEY_SIGNATURE",
  ));
  if (!draft.defaultTempo) prerequisiteErrors.push(blockedInput(
    "missing-tempo",
    "초기 tempo를 명시적으로 입력해야 합니다.",
    "IMPORT_UNSUPPORTED_ELEMENT",
  ));
  if (!draft.rights || !draft.rights.allowedUses.includes("generation")) prerequisiteErrors.push(blockedInput(
    "missing-generation-right",
    "generation 권리를 확인해야 합니다.",
    "RIGHTS_GENERATION_NOT_CONFIRMED",
  ));
  for (const occurrenceKey of normalized.unresolvedLyricOccurrenceKeys) prerequisiteErrors.push(blockedInput(
    `lyric-verse-ambiguity:${occurrenceKey}`,
    "Section occurrence별 production lyric verse를 확인해야 합니다.",
    "IMPORT_UNSUPPORTED_ELEMENT",
  ));
  if (prerequisiteErrors.length > 0 || !draft.defaultKey || !draft.defaultTempo || !draft.rights) {
    return { status: "blocked", diagnostics: await materializeImportDiagnostics(prerequisiteErrors) };
  }
  try {
    const revisionHistoryDigest = await computeRevisionHistoryDigest([]);
    const pendingDigest = await semanticDigest({ projectionSchema: "hm-import-pending-source-v1" });
    let source: SongSourceDocument = normalizeSongSourceDocument({
      schemaVersion: 9,
      documentId: draft.documentId,
      revisionOrdinal: 0,
      revisionDigest: pendingDigest,
      revisionHistory: [],
      revisionHistoryDigest,
      title: draft.title,
      ...(draft.composer ? { composer: draft.composer } : {}),
      defaultKey: draft.defaultKey,
      defaultTempo: draft.defaultTempo,
      sourceMeasures: normalized.sourceMeasures,
      performanceSequence: normalized.performanceSequence,
      sectionDefinitions: normalized.sectionDefinitions,
      sectionOccurrences: normalized.sectionOccurrences,
      phraseRegions: normalized.phraseRegions,
      rights: { ...draft.rights, allowedUses: [...draft.rights.allowedUses].sort() },
      importInfo: {
        sourceKind: "musicxml",
        ...(draft.originalFileName ? { originalFileName: draft.originalFileName } : {}),
        rawDigest: draft.rawDigest,
        importerVersion: draft.importerVersion,
        providerMetadata: { containerKind: draft.containerKind },
      },
    });
    source = { ...source, revisionDigest: normalized.musicalSourceDigest ?? await digestMusicalSource(source) };
    source = normalizeSongSourceDocument({
      ...source,
      importInfo: {
        ...source.importInfo!,
        musicXmlSourceTargetMap: await buildMusicXmlSourceTargetMap(draft, source),
      },
    });
    const valid = isSongSourceDocument(source)
      && await validateSongSourceDocumentIntegrity(source, versions.performanceExpanderVersion);
    if (!valid) {
      return {
        status: "blocked",
        diagnostics: await materializeImportDiagnostics([blockedInput(
          "source-integrity",
          "정규화된 Source가 canonical integrity 검증을 통과하지 못했습니다.",
        )]),
      };
    }
    return { status: "complete", source, diagnostics: [] };
  } catch (error) {
    return {
      status: "blocked",
      diagnostics: await materializeImportDiagnostics([{
        code: "SOURCE_REVISION_INVALID",
        messageKo: "MusicXML draft를 canonical Source로 확정할 수 없습니다.",
        details: { issue: error instanceof Error ? error.message : "source-finalization-failed" },
      }]),
    };
  }
}

export async function finalizeImportedSource(
  draft: MusicXmlImportDraft,
  versions: Step3ImportVersions,
): Promise<ImportedSourceFinalizationResult> {
  const normalized = await normalizeImportedSource(draft, versions);
  if (normalized.status === "blocked") return normalized;
  return finalizeNormalization(draft, versions, normalized.normalization);
}

export async function finalizeNormalizedImportedSource(
  draft: MusicXmlImportDraft,
  versions: Step3ImportVersions,
  normalization: ImportedSourceNormalization,
): Promise<ImportedSourceFinalizationResult> {
  return finalizeNormalization(draft, versions, normalization);
}
