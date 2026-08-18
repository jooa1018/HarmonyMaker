import { canonicalJson } from "../digest/canonical";
import {
  addFractions, compareFractions, fraction, subtractFractions, type Fraction,
} from "../fraction";
import {
  leadEventId, lyricTokenId, performanceOccurrenceId, phraseRegionId,
  sectionDefinitionId, sectionOccurrenceId, sourceChordEventId, sourceMeasureId,
  sourceTextEventId,
} from "../ids";
import { expandRepeats } from "../performance/repeat";
import type {
  LeadEvent, PhraseRegion, SectionDefinition, SectionOccurrence, SongSourceDocument,
  SourceMeasure,
} from "../source/model";
import { normalizeSongSourceDocument } from "../source/normalize";
import type { SourceIdRemapEntry } from "../source/revision";
import type { MusicalPosition } from "../time";
import type { OmrCorrectionPatch, RevisionScopedTarget } from "./foundation";

type BarlinePatch = Extract<OmrCorrectionPatch, { readonly kind: "insert-barline" | "delete-barline" }>;

export interface BarlineStructuralResult {
  readonly source: SongSourceDocument;
  readonly remapEntries: readonly SourceIdRemapEntry[];
  readonly beforeProjection: unknown;
  readonly afterProjection: unknown;
}

interface MeasureOrigin {
  readonly provisionalId: string;
  readonly oldMeasureIds: readonly string[];
}

function expectedMeasureDuration(measure: SourceMeasure): Fraction {
  return fraction(measure.time.numerator * 4, measure.time.denominator);
}

function shiftedEvent<T extends { readonly onset: Fraction }>(event: T, shift: Fraction): T {
  return { ...event, onset: subtractFractions(event.onset, shift) };
}

function splitMeasure(measure: SourceMeasure): readonly [SourceMeasure, SourceMeasure] {
  const split = expectedMeasureDuration(measure);
  if (compareFractions(measure.duration, split) <= 0) throw new RangeError("OMR_BARLINE_SPLIT_NOT_OVERFULL");
  if (measure.leadEvents.some((event) => compareFractions(event.onset, split) < 0
    && compareFractions(addFractions(event.onset, event.duration), split) > 0)) {
    throw new RangeError("OMR_BARLINE_SPLIT_EVENT_CROSSES_BOUNDARY");
  }
  const firstLeadIds = new Set(measure.leadEvents
    .filter((event) => compareFractions(event.onset, split) < 0)
    .map((event) => event.id));
  const firstLyrics = measure.lyricTokens.filter((token) => firstLeadIds.has(token.leadEventId));
  const secondLyrics = measure.lyricTokens.filter((token) => !firstLeadIds.has(token.leadEventId));
  const first: SourceMeasure = {
    ...measure,
    id: `${measure.id}:split-a`,
    duration: split,
    leadEvents: measure.leadEvents.filter((event) => firstLeadIds.has(event.id)),
    chordEvents: measure.chordEvents.filter((event) => compareFractions(event.onset, split) < 0),
    lyricTokens: firstLyrics,
    textEvents: measure.textEvents.filter((event) => compareFractions(event.onset, split) < 0),
    repeat: {
      startRepeat: measure.repeat.startRepeat,
      ...(measure.repeat.endingNumbers ? { endingNumbers: measure.repeat.endingNumbers } : {}),
    },
  };
  const secondId = `${measure.id}:split-b`;
  const second: SourceMeasure = {
    ...measure,
    id: secondId,
    number: measure.number + 1,
    implicit: false,
    duration: subtractFractions(measure.duration, split),
    leadEvents: measure.leadEvents
      .filter((event) => !firstLeadIds.has(event.id))
      .map((event) => ({ ...shiftedEvent(event, split), sourceMeasureId: secondId })),
    chordEvents: measure.chordEvents
      .filter((event) => compareFractions(event.onset, split) >= 0)
      .map((event) => ({ ...shiftedEvent(event, split), sourceMeasureId: secondId })),
    lyricTokens: secondLyrics,
    textEvents: measure.textEvents
      .filter((event) => compareFractions(event.onset, split) >= 0)
      .map((event) => ({ ...shiftedEvent(event, split), sourceMeasureId: secondId })),
    repeat: {
      startRepeat: false,
      ...(measure.repeat.endRepeat ? { endRepeat: measure.repeat.endRepeat } : {}),
      ...(measure.repeat.endingNumbers ? { endingNumbers: measure.repeat.endingNumbers } : {}),
    },
  };
  return [first, second];
}

function mergeMeasures(first: SourceMeasure, second: SourceMeasure): SourceMeasure {
  if (canonicalJson(first.time) !== canonicalJson(second.time)
    || canonicalJson(first.key ?? null) !== canonicalJson(second.key ?? null)
    || first.repeat.endRepeat !== undefined
    || second.repeat.startRepeat
    || canonicalJson(first.repeat.endingNumbers ?? null) !== canonicalJson(second.repeat.endingNumbers ?? null)) {
    throw new RangeError("OMR_BARLINE_MERGE_INCOMPATIBLE");
  }
  const id = `${first.id}:merged`;
  return {
    ...first,
    id,
    duration: addFractions(first.duration, second.duration),
    leadEvents: [
      ...first.leadEvents.map((event) => ({ ...event, sourceMeasureId: id })),
      ...second.leadEvents.map((event) => ({ ...event, sourceMeasureId: id, onset: addFractions(first.duration, event.onset) })),
    ],
    chordEvents: [
      ...first.chordEvents.map((event) => ({ ...event, sourceMeasureId: id })),
      ...second.chordEvents.map((event) => ({ ...event, sourceMeasureId: id, onset: addFractions(first.duration, event.onset) })),
    ],
    lyricTokens: [...first.lyricTokens, ...second.lyricTokens],
    textEvents: [
      ...first.textEvents.map((event) => ({ ...event, sourceMeasureId: id })),
      ...second.textEvents.map((event) => ({ ...event, sourceMeasureId: id, onset: addFractions(first.duration, event.onset) })),
    ],
    repeat: {
      startRepeat: first.repeat.startRepeat,
      ...(second.repeat.endRepeat ? { endRepeat: second.repeat.endRepeat } : {}),
      ...(first.repeat.endingNumbers ? { endingNumbers: first.repeat.endingNumbers } : {}),
    },
  };
}

function measureProjection(measure: SourceMeasure): unknown {
  const leadOrdinal = new Map(measure.leadEvents.map((event, ordinal) => [event.id, ordinal]));
  return {
    number: measure.number,
    implicit: measure.implicit,
    time: measure.time,
    duration: measure.duration,
    key: measure.key ?? null,
    leadEvents: measure.leadEvents.map((event) => event.kind === "rest"
      ? { kind: event.kind, onset: event.onset, duration: event.duration }
      : {
          kind: event.kind, onset: event.onset, duration: event.duration, pitch: event.pitch,
          tieStart: event.tieStart, tieStop: event.tieStop,
          lyricOrdinals: event.lyricTokenIds.map((id) => measure.lyricTokens.findIndex((token) => token.id === id)),
        }),
    chordEvents: measure.chordEvents.map(({ onset, sourceText, parseResult, source, confirmation }) => ({ onset, sourceText, parseResult, source, confirmation })),
    lyricTokens: measure.lyricTokens.map(({ text, syllabic, leadEventId: id, verse, extend, emphasis, ...rest }) => ({ text, syllabic, leadOrdinal: leadOrdinal.get(id), verse, extend, emphasis, ...rest })),
    textEvents: measure.textEvents.map(({ onset, kind, text }) => ({ onset, kind, text })),
    repeat: measure.repeat,
  };
}

export function createBarlineBeforeProjection(
  source: SongSourceDocument,
  target: RevisionScopedTarget["target"],
  patch: BarlinePatch,
): unknown {
  if (target.kind !== "measure-end") throw new RangeError("OMR_CORRECTION_TARGET_INCOMPATIBLE");
  const index = source.sourceMeasures.findIndex((measure) => measure.id === target.sourceMeasureId);
  if (index < 0) throw new RangeError("STALE_REFERENCE");
  const selected = source.sourceMeasures[index];
  if (patch.kind === "insert-barline") return { structuralKind: patch.kind, selected };
  const next = source.sourceMeasures[index + 1];
  if (!next) throw new RangeError("OMR_BARLINE_MERGE_MISSING_NEXT");
  return { structuralKind: patch.kind, selected, next };
}

export function applyBarlinePatchToProjection(before: unknown, patch: BarlinePatch): unknown {
  const value = before as { readonly structuralKind?: string; readonly selected?: SourceMeasure; readonly next?: SourceMeasure };
  if (!value.selected || value.structuralKind !== patch.kind) throw new RangeError("OMR_REVIEW_RESOLUTION_INVALID");
  const measures = patch.kind === "insert-barline"
    ? splitMeasure(value.selected)
    : [mergeMeasures(value.selected, value.next ?? (() => { throw new RangeError("OMR_REVIEW_RESOLUTION_INVALID"); })())];
  return { structuralKind: patch.kind, measures: measures.map(measureProjection) };
}

function remapPosition(
  position: MusicalPosition,
  oldLength: number,
  newLength: number,
  positionMap: ReadonlyMap<number, readonly { readonly newIndex: number; readonly offsetShift: Fraction }[]>,
): MusicalPosition {
  if (position.performanceMeasureIndex === oldLength) return { performanceMeasureIndex: newLength, offset: fraction(0) };
  const mapped = positionMap.get(position.performanceMeasureIndex);
  if (!mapped || mapped.length === 0) throw new RangeError("OMR_BARLINE_POSITION_UNMAPPABLE");
  if (mapped.length === 1) return {
    performanceMeasureIndex: mapped[0].newIndex,
    offset: addFractions(mapped[0].offsetShift, position.offset),
  };
  const second = mapped[1];
  const split = second.offsetShift.n < 0 ? fraction(-second.offsetShift.n, second.offsetShift.d) : fraction(0);
  return compareFractions(position.offset, split) < 0
    ? { performanceMeasureIndex: mapped[0].newIndex, offset: position.offset }
    : { performanceMeasureIndex: second.newIndex, offset: subtractFractions(position.offset, split) };
}

function mappedEntry(entityKind: SourceIdRemapEntry["entityKind"], fromId: string, toIds: readonly string[]): SourceIdRemapEntry {
  const unique = [...new Set(toIds)].sort();
  if (unique.length === 0) return { entityKind, fromId, toIds: [], status: "deleted" };
  if (unique.length === 1) return { entityKind, fromId, toIds: unique, status: "mapped-one" };
  return { entityKind, fromId, toIds: unique, status: "mapped-many" };
}

function remapDefinitionMeasures(
  definitions: readonly SectionDefinition[],
  replacement: ReadonlyMap<string, readonly string[]>,
  mergePair?: readonly [string, string],
): readonly SectionDefinition[] {
  return definitions.map((definition, index) => {
    if (mergePair) {
      const hasFirst = definition.sourceMeasureIds.includes(mergePair[0]);
      const hasSecond = definition.sourceMeasureIds.includes(mergePair[1]);
      if (hasFirst !== hasSecond) throw new RangeError("OMR_BARLINE_SECTION_BOUNDARY_UNMAPPABLE");
    }
    const sourceMeasureIds = definition.sourceMeasureIds.flatMap((id) => replacement.get(id) ?? []);
    return {
      ...definition,
      id: `struct:def:${index}`,
      sourceMeasureIds: sourceMeasureIds.filter((id, ordinal) => ordinal === 0 || id !== sourceMeasureIds[ordinal - 1]),
    };
  });
}

export function applyBarlineStructuralPatch(
  source: SongSourceDocument,
  target: RevisionScopedTarget["target"],
  patch: BarlinePatch,
): BarlineStructuralResult {
  if (target.kind !== "measure-end") throw new RangeError("OMR_CORRECTION_TARGET_INCOMPATIBLE");
  const targetIndex = source.sourceMeasures.findIndex((measure) => measure.id === target.sourceMeasureId);
  if (targetIndex < 0) throw new RangeError("STALE_REFERENCE");
  const beforeProjection = createBarlineBeforeProjection(source, target, patch);
  const provisionalRaw: SourceMeasure[] = [];
  const origins: MeasureOrigin[] = [];
  const replacement = new Map<string, readonly string[]>();
  const push = (measure: SourceMeasure, oldMeasureIds: readonly string[]) => {
    const provisionalId = `struct:measure:${provisionalRaw.length}`;
    provisionalRaw.push({
      ...measure,
      id: provisionalId,
      leadEvents: measure.leadEvents.map((event) => ({ ...event, sourceMeasureId: provisionalId })),
      chordEvents: measure.chordEvents.map((event) => ({ ...event, sourceMeasureId: provisionalId })),
      textEvents: measure.textEvents.map((event) => ({ ...event, sourceMeasureId: provisionalId })),
    });
    origins.push({ provisionalId, oldMeasureIds });
    oldMeasureIds.forEach((id) => replacement.set(id, [...(replacement.get(id) ?? []), provisionalId]));
  };
  let mergePair: readonly [string, string] | undefined;
  for (let index = 0; index < source.sourceMeasures.length; index += 1) {
    const measure = source.sourceMeasures[index];
    if (index !== targetIndex) {
      if (patch.kind === "delete-barline" && index === targetIndex + 1) continue;
      push(measure, [measure.id]);
      continue;
    }
    if (patch.kind === "insert-barline") {
      const [first, second] = splitMeasure(measure);
      push(first, [measure.id]);
      push(second, [measure.id]);
    } else {
      const next = source.sourceMeasures[index + 1];
      if (!next) throw new RangeError("OMR_BARLINE_MERGE_MISSING_NEXT");
      mergePair = [measure.id, next.id];
      push(mergeMeasures(measure, next), mergePair);
    }
  }

  const expanded = expandRepeats(provisionalRaw, source.performanceSequence.expanderVersion);
  if (expanded.status !== "complete") throw new RangeError(`OMR_BARLINE_${expanded.code}`);
  const expectedProvisionalIds: string[] = [];
  const positionMap = new Map<number, readonly { readonly newIndex: number; readonly offsetShift: Fraction }[]>();
  const boundaryMap = new Map<number, number>();
  let oldIndex = 0;
  let newIndex = 0;
  boundaryMap.set(0, 0);
  while (oldIndex < source.performanceSequence.occurrences.length) {
    const old = source.performanceSequence.occurrences[oldIndex];
    if (patch.kind === "insert-barline" && old.sourceMeasureId === target.sourceMeasureId) {
      const ids = replacement.get(old.sourceMeasureId);
      if (!ids || ids.length !== 2) throw new RangeError("OMR_BARLINE_REMAP_FAILED");
      expectedProvisionalIds.push(ids[0], ids[1]);
      positionMap.set(oldIndex, [
        { newIndex, offsetShift: fraction(0) },
        { newIndex: newIndex + 1, offsetShift: fraction(-expectedMeasureDuration(source.sourceMeasures[targetIndex]).n, expectedMeasureDuration(source.sourceMeasures[targetIndex]).d) },
      ]);
      oldIndex += 1; newIndex += 2; boundaryMap.set(oldIndex, newIndex);
      continue;
    }
    if (patch.kind === "delete-barline" && old.sourceMeasureId === mergePair?.[0]) {
      const next = source.performanceSequence.occurrences[oldIndex + 1];
      if (!next || next.sourceMeasureId !== mergePair[1]) throw new RangeError("OMR_BARLINE_PERFORMANCE_PAIR_UNMAPPABLE");
      const id = replacement.get(mergePair[0])?.[0];
      if (!id) throw new RangeError("OMR_BARLINE_REMAP_FAILED");
      expectedProvisionalIds.push(id);
      positionMap.set(oldIndex, [{ newIndex, offsetShift: fraction(0) }]);
      positionMap.set(oldIndex + 1, [{ newIndex, offsetShift: source.sourceMeasures[targetIndex].duration }]);
      boundaryMap.set(oldIndex, newIndex);
      oldIndex += 2; newIndex += 1; boundaryMap.set(oldIndex, newIndex);
      continue;
    }
    if (patch.kind === "delete-barline" && old.sourceMeasureId === mergePair?.[1]) {
      throw new RangeError("OMR_BARLINE_PERFORMANCE_PAIR_UNMAPPABLE");
    }
    const id = replacement.get(old.sourceMeasureId)?.[0];
    if (!id) throw new RangeError("OMR_BARLINE_REMAP_FAILED");
    expectedProvisionalIds.push(id);
    positionMap.set(oldIndex, [{ newIndex, offsetShift: fraction(0) }]);
    oldIndex += 1; newIndex += 1; boundaryMap.set(oldIndex, newIndex);
  }
  if (canonicalJson(expanded.sequence.occurrences.map((item) => item.sourceMeasureId)) !== canonicalJson(expectedProvisionalIds)) {
    throw new RangeError("OMR_BARLINE_PERFORMANCE_REPLAY_MISMATCH");
  }

  const provisionalDefinitions = remapDefinitionMeasures(source.sectionDefinitions, replacement, mergePair);
  const definitionIdMap = new Map(source.sectionDefinitions.map((definition, index) => [definition.id, provisionalDefinitions[index].id]));
  const provisionalOccurrences: SectionOccurrence[] = source.sectionOccurrences.map((occurrence, index) => {
    const start = boundaryMap.get(occurrence.startPerformanceMeasureIndex);
    const end = boundaryMap.get(occurrence.endPerformanceMeasureIndexExclusive);
    if (start === undefined || end === undefined || start >= end) throw new RangeError("OMR_BARLINE_SECTION_BOUNDARY_UNMAPPABLE");
    return {
      ...occurrence,
      id: `struct:occurrence:${index}`,
      sectionDefinitionId: definitionIdMap.get(occurrence.sectionDefinitionId) ?? "struct:missing-definition",
      startPerformanceMeasureIndex: start,
      endPerformanceMeasureIndexExclusive: end,
    };
  });
  const occurrenceIdMap = new Map(source.sectionOccurrences.map((occurrence, index) => [occurrence.id, provisionalOccurrences[index].id]));
  const provisionalPhrases: PhraseRegion[] = source.phraseRegions.map((phrase, index) => ({
    ...phrase,
    id: `struct:phrase:${index}`,
    sectionOccurrenceId: occurrenceIdMap.get(phrase.sectionOccurrenceId) ?? "struct:missing-occurrence",
    range: {
      start: remapPosition(phrase.range.start, source.performanceSequence.occurrences.length, expanded.sequence.occurrences.length, positionMap),
      end: remapPosition(phrase.range.end, source.performanceSequence.occurrences.length, expanded.sequence.occurrences.length, positionMap),
    },
  }));
  const provisional = normalizeSongSourceDocument({
    ...source,
    sourceMeasures: provisionalRaw,
    performanceSequence: expanded.sequence,
    sectionDefinitions: provisionalDefinitions,
    sectionOccurrences: provisionalOccurrences,
    phraseRegions: provisionalPhrases,
  });

  const finalMeasureIdByProvisional = new Map<string, string>();
  const entityMaps = new Map<SourceIdRemapEntry["entityKind"], Map<string, string>>([
    ["lead-event", new Map()], ["chord-event", new Map()], ["lyric-token", new Map()], ["source-text", new Map()],
    ["section-definition", new Map()], ["section-occurrence", new Map()], ["phrase", new Map()],
  ]);
  const finalMeasures = provisional.sourceMeasures.map((measure, measureOrdinal): SourceMeasure => {
    const finalMeasureId = sourceMeasureId(measureOrdinal);
    finalMeasureIdByProvisional.set(measure.id, finalMeasureId);
    const leadMap = entityMaps.get("lead-event")!;
    measure.leadEvents.forEach((event, ordinal) => leadMap.set(event.id, leadEventId(measureOrdinal, ordinal)));
    const lyricMap = entityMaps.get("lyric-token")!;
    const lyricCounts = new Map<string, number>();
    measure.lyricTokens.forEach((token) => {
      const leadOrdinal = measure.leadEvents.findIndex((event) => event.id === token.leadEventId);
      const key = `${leadOrdinal}:${token.verse}`;
      const tokenOrdinal = lyricCounts.get(key) ?? 0;
      lyricCounts.set(key, tokenOrdinal + 1);
      lyricMap.set(token.id, lyricTokenId(measureOrdinal, leadOrdinal, token.verse, tokenOrdinal));
    });
    const chordMap = entityMaps.get("chord-event")!;
    measure.chordEvents.forEach((event, ordinal) => chordMap.set(event.id, sourceChordEventId(measureOrdinal, ordinal)));
    const textMap = entityMaps.get("source-text")!;
    const textCounts = new Map<string, number>();
    measure.textEvents.forEach((event) => {
      const key = `${event.onset.n}/${event.onset.d}:${event.kind}`;
      const ordinal = textCounts.get(key) ?? 0;
      textCounts.set(key, ordinal + 1);
      textMap.set(event.id, sourceTextEventId(measureOrdinal, event.onset, event.kind, ordinal));
    });
    return {
      ...measure,
      id: finalMeasureId,
      leadEvents: measure.leadEvents.map((event): LeadEvent => event.kind === "rest"
        ? { ...event, id: leadMap.get(event.id)!, sourceMeasureId: finalMeasureId }
        : { ...event, id: leadMap.get(event.id)!, sourceMeasureId: finalMeasureId, lyricTokenIds: event.lyricTokenIds.map((id) => lyricMap.get(id)!) }),
      chordEvents: measure.chordEvents.map((event) => ({ ...event, id: chordMap.get(event.id)!, sourceMeasureId: finalMeasureId })),
      lyricTokens: measure.lyricTokens.map((token) => ({ ...token, id: lyricMap.get(token.id)!, leadEventId: leadMap.get(token.leadEventId)! })),
      textEvents: measure.textEvents.map((event) => ({ ...event, id: textMap.get(event.id)!, sourceMeasureId: finalMeasureId })),
    };
  });
  const measureOrdinalById = new Map(finalMeasures.map((measure, index) => [measure.id, index]));
  const finalPerformance = {
    ...provisional.performanceSequence,
    occurrences: provisional.performanceSequence.occurrences.map((occurrence, performanceIndex) => {
      const id = finalMeasureIdByProvisional.get(occurrence.sourceMeasureId)!;
      const ordinal = measureOrdinalById.get(id)!;
      const measure = finalMeasures[ordinal];
      return {
        ...occurrence,
        occurrenceId: performanceOccurrenceId(performanceIndex, ordinal, occurrence.occurrenceIndexForSource),
        sourceMeasureId: id,
        sourceMeasureNumber: measure.number,
        performanceIndex,
        time: measure.time,
        duration: measure.duration,
      };
    }),
  };
  const definitionCounts = new Map<string, number>();
  const finalDefinitions = provisional.sectionDefinitions.map((definition): SectionDefinition => {
    const ids = definition.sourceMeasureIds.map((id) => finalMeasureIdByProvisional.get(id)!);
    const ordinals = ids.map((id) => measureOrdinalById.get(id)!);
    const key = `${ordinals[0]}:${ordinals.at(-1)! + 1}:${definition.type}`;
    const duplicate = definitionCounts.get(key) ?? 0;
    definitionCounts.set(key, duplicate + 1);
    const id = sectionDefinitionId(ordinals[0], ordinals.at(-1)! + 1, definition.type, duplicate);
    return { ...definition, id, sourceMeasureIds: ids };
  });
  const finalDefinitionByProvisional = new Map(provisional.sectionDefinitions.map((definition, index) => [definition.id, finalDefinitions[index].id]));
  source.sectionDefinitions.forEach((definition, index) => {
    const provisionalId = provisionalDefinitions[index].id;
    const finalId = finalDefinitionByProvisional.get(provisionalId);
    if (finalId) entityMaps.get("section-definition")!.set(definition.id, finalId);
  });
  const definitionOrdinalById = new Map(finalDefinitions.map((definition, index) => [definition.id, index]));
  const finalOccurrences = provisional.sectionOccurrences.map((occurrence): SectionOccurrence => {
    const definitionId = finalDefinitionByProvisional.get(occurrence.sectionDefinitionId)!;
    const id = sectionOccurrenceId(occurrence.startPerformanceMeasureIndex, occurrence.endPerformanceMeasureIndexExclusive, definitionOrdinalById.get(definitionId)!);
    return { ...occurrence, id, sectionDefinitionId: definitionId };
  });
  const finalOccurrenceByProvisional = new Map(provisional.sectionOccurrences.map((occurrence, index) => [occurrence.id, finalOccurrences[index].id]));
  source.sectionOccurrences.forEach((occurrence, index) => {
    const finalId = finalOccurrenceByProvisional.get(provisionalOccurrences[index].id);
    if (finalId) entityMaps.get("section-occurrence")!.set(occurrence.id, finalId);
  });
  const occurrenceOrdinalById = new Map(finalOccurrences.map((occurrence, index) => [occurrence.id, index]));
  const finalPhrases = provisional.phraseRegions.map((phrase): PhraseRegion => {
    const occurrenceId = finalOccurrenceByProvisional.get(phrase.sectionOccurrenceId)!;
    return { ...phrase, id: phraseRegionId(occurrenceOrdinalById.get(occurrenceId)!, phrase.range.start, phrase.range.end), sectionOccurrenceId: occurrenceId };
  });
  const finalPhraseByProvisional = new Map(provisional.phraseRegions.map((phrase, index) => [phrase.id, finalPhrases[index].id]));
  source.phraseRegions.forEach((phrase, index) => {
    const finalId = finalPhraseByProvisional.get(provisionalPhrases[index].id);
    if (finalId) entityMaps.get("phrase")!.set(phrase.id, finalId);
  });

  const finalSource = normalizeSongSourceDocument({
    ...provisional,
    sourceMeasures: finalMeasures,
    performanceSequence: finalPerformance,
    sectionDefinitions: finalDefinitions,
    sectionOccurrences: finalOccurrences,
    phraseRegions: finalPhrases,
  });
  const measureTargets = new Map<string, string[]>();
  origins.forEach((origin) => origin.oldMeasureIds.forEach((oldId) => {
    measureTargets.set(oldId, [...(measureTargets.get(oldId) ?? []), finalMeasureIdByProvisional.get(origin.provisionalId)!]);
  }));
  const remapEntries: SourceIdRemapEntry[] = source.sourceMeasures.map((measure) => mappedEntry("measure", measure.id, measureTargets.get(measure.id) ?? []));
  const addOldEntities = (kind: SourceIdRemapEntry["entityKind"], ids: readonly string[]) => ids.forEach((id) => remapEntries.push(mappedEntry(kind, id, entityMaps.get(kind)?.get(id) ? [entityMaps.get(kind)!.get(id)!] : [])));
  addOldEntities("lead-event", source.sourceMeasures.flatMap((measure) => measure.leadEvents.map((event) => event.id)));
  addOldEntities("chord-event", source.sourceMeasures.flatMap((measure) => measure.chordEvents.map((event) => event.id)));
  addOldEntities("lyric-token", source.sourceMeasures.flatMap((measure) => measure.lyricTokens.map((token) => token.id)));
  addOldEntities("source-text", source.sourceMeasures.flatMap((measure) => measure.textEvents.map((event) => event.id)));
  addOldEntities("section-definition", source.sectionDefinitions.map((item) => item.id));
  addOldEntities("section-occurrence", source.sectionOccurrences.map((item) => item.id));
  addOldEntities("phrase", source.phraseRegions.map((item) => item.id));
  return { source: finalSource, remapEntries, beforeProjection, afterProjection: applyBarlinePatchToProjection(beforeProjection, patch) };
}
