import { canonicalJson, compareCanonicalValues, semanticDigest } from "../digest/canonical";
import type {
  MusicXmlCurrentSourceTarget, MusicXmlSourceTargetMap, MusicXmlSourceTargetMapEntry,
  MusicXmlSourceTargetSelector, SongSourceDocument,
} from "../source/model";
import type { SourceIdRemap, SourceRevisionRef } from "../source/revision";
import { revisionRefsEqual } from "../source/revision";
import type { ImportedChordDraft, ImportedLeadEventDraft, ImportedTextDraft, MusicXmlImportDraft } from "../../import/musicxml/types";

function currentRevision(source: SongSourceDocument): SourceRevisionRef {
  return { documentId: source.documentId, revisionOrdinal: source.revisionOrdinal, revisionDigest: source.revisionDigest };
}

function leadProjection(event: ImportedLeadEventDraft): object {
  return event.kind === "rest"
    ? { kind: "rest", onset: event.onset, duration: event.duration }
    : { kind: "note", onset: event.onset, duration: event.duration, pitch: event.pitch, tieStart: event.tieStart, tieStop: event.tieStop };
}

function chordProjection(chord: ImportedChordDraft): object {
  return { onset: chord.onset, parseResult: chord.parseResult, source: chord.source, confirmation: chord.confirmation };
}

function textProjection(event: ImportedTextDraft): object {
  return { onset: event.onset, kind: event.kind, text: event.kind === "section-label" ? event.text.normalize("NFC") : null };
}

function entry(selector: MusicXmlSourceTargetSelector, target: MusicXmlCurrentSourceTarget): MusicXmlSourceTargetMapEntry {
  return { selector, status: "mapped-one", targets: [target] };
}

function canonicalEntries(entries: readonly MusicXmlSourceTargetMapEntry[]): readonly MusicXmlSourceTargetMapEntry[] {
  return [...entries]
    .map((item) => ({ ...item, targets: [...item.targets].sort(compareCanonicalValues) }) as MusicXmlSourceTargetMapEntry)
    .sort((left, right) => compareCanonicalValues(left.selector, right.selector));
}

export async function computeMusicXmlSourceTargetMapDigest(
  map: Omit<MusicXmlSourceTargetMap, "mapDigest">,
) {
  return semanticDigest({
    projectionSchema: "hm-musicxml-source-target-map-v1",
    version: map.version,
    sourceRevision: map.sourceRevision,
    entries: canonicalEntries(map.entries),
  });
}

export async function buildMusicXmlSourceTargetMap(
  draft: MusicXmlImportDraft,
  source: SongSourceDocument,
): Promise<MusicXmlSourceTargetMap> {
  const selected = draft.leadCandidates.find((candidate) => candidate.key === draft.selectedLeadStaffKey);
  const selectedPart = draft.parts.find((part) => part.partOrdinal === selected?.partOrdinal);
  if (!selected || !selectedPart || selectedPart.measures.length !== source.sourceMeasures.length) {
    throw new RangeError("OMR_IMPORT_IDENTITY_INVALID");
  }
  const chordPart = selectedPart.measures.some((measure) => measure.chords.length > 0)
    ? selectedPart
    : draft.parts.find((part) => part.measures.some((measure) => measure.chords.length > 0)) ?? selectedPart;
  if (chordPart.measures.length !== selectedPart.measures.length) throw new RangeError("OMR_IMPORT_IDENTITY_INVALID");

  const entries: MusicXmlSourceTargetMapEntry[] = [];
  for (const [measureOrdinal, measure] of selectedPart.measures.entries()) {
    const sourceMeasure = source.sourceMeasures[measureOrdinal];
    if (!sourceMeasure) throw new RangeError("OMR_IMPORT_IDENTITY_INVALID");
    for (const kind of ["measure", "measure-start", "measure-end"] as const) {
      entries.push(entry(
        { kind, musicXmlPartOrdinal: selected.partOrdinal, measureOrdinal },
        { kind, sourceMeasureId: sourceMeasure.id },
      ));
    }

    const lead = measure.leadEvents
      .filter((event) => event.candidateKey === selected.key)
      .sort((left, right) => compareCanonicalValues(leadProjection(left), leadProjection(right)));
    lead.forEach((eventDraft, eventOrdinal) => {
      const event = sourceMeasure.leadEvents[eventOrdinal];
      if (eventDraft.musicXmlEventOrdinal === undefined || !event) return;
      entries.push(entry({
        kind: "voice-event", musicXmlPartOrdinal: selected.partOrdinal,
        musicXmlStaffNumber: selected.staffNumber, musicXmlVoiceKey: selected.voiceKey,
        measureOrdinal, eventOrdinal: eventDraft.musicXmlEventOrdinal,
      }, { kind: "voice-event", eventId: event.id }));
    });

    const chordDrafts = [...(chordPart.measures[measureOrdinal]?.chords ?? [])]
      .sort((left, right) => compareCanonicalValues(chordProjection(left), chordProjection(right)));
    chordDrafts.forEach((chordDraft, chordOrdinal) => {
      const chord = sourceMeasure.chordEvents[chordOrdinal];
      if (chordDraft.musicXmlEventOrdinal === undefined || !chord) return;
      entries.push(entry({
        kind: "chord-event", musicXmlPartOrdinal: chordPart.partOrdinal,
        measureOrdinal, eventOrdinal: chordDraft.musicXmlEventOrdinal,
      }, { kind: "chord-event", chordEventId: chord.id }));
    });

    const orderedText = [...measure.textEvents]
      .sort((left, right) => compareCanonicalValues(textProjection(left), textProjection(right))
        || left.text.localeCompare(right.text))
      .filter((event, index, values) => index === 0
        || compareCanonicalValues(textProjection(event), textProjection(values[index - 1])) !== 0);
    orderedText.forEach((textDraft, textOrdinal) => {
      const text = sourceMeasure.textEvents[textOrdinal];
      if (textDraft.musicXmlEventOrdinal === undefined || !text) return;
      entries.push(entry({
        kind: "section-text", musicXmlPartOrdinal: selected.partOrdinal,
        measureOrdinal, eventOrdinal: textDraft.musicXmlEventOrdinal,
      }, { kind: "section-text", sourceTextId: text.id }));
    });
  }
  const inventorySelectors: MusicXmlSourceTargetSelector[] = [
    ...(draft.musicXmlIdentityInventory?.leadEvents ?? [])
      .filter((item) => item.candidateKey === selected.key)
      .map((item) => ({
        kind: "voice-event" as const,
        musicXmlPartOrdinal: item.partOrdinal,
        musicXmlStaffNumber: item.staffNumber,
        musicXmlVoiceKey: item.voiceKey,
        measureOrdinal: item.measureOrdinal,
        eventOrdinal: item.eventOrdinal,
      })),
    ...(draft.musicXmlIdentityInventory?.chordEvents ?? [])
      .filter((item) => item.partOrdinal === chordPart.partOrdinal)
      .map((item) => ({ kind: "chord-event" as const, musicXmlPartOrdinal: item.partOrdinal, measureOrdinal: item.measureOrdinal, eventOrdinal: item.eventOrdinal })),
    ...(draft.musicXmlIdentityInventory?.textEvents ?? [])
      .filter((item) => item.partOrdinal === selected.partOrdinal)
      .map((item) => ({ kind: "section-text" as const, musicXmlPartOrdinal: item.partOrdinal, measureOrdinal: item.measureOrdinal, eventOrdinal: item.eventOrdinal })),
  ];
  const mappedSelectors = new Set(entries.map((item) => canonicalJson(item.selector)));
  for (const selector of inventorySelectors) {
    if (!mappedSelectors.has(canonicalJson(selector))) entries.push({ selector, status: "deleted", targets: [] });
  }
  const withoutDigest = {
    version: "musicxml-source-target-map-v1" as const,
    sourceRevision: currentRevision(source),
    entries: canonicalEntries(entries),
  };
  return { ...withoutDigest, mapDigest: await computeMusicXmlSourceTargetMapDigest(withoutDigest) };
}

function targetId(target: MusicXmlCurrentSourceTarget): string {
  return target.kind === "voice-event" ? target.eventId
    : target.kind === "chord-event" ? target.chordEventId
      : target.kind === "section-text" ? target.sourceTextId
        : target.sourceMeasureId;
}

function withTargetId(target: MusicXmlCurrentSourceTarget, id: string): MusicXmlCurrentSourceTarget {
  return target.kind === "voice-event" ? { kind: target.kind, eventId: id }
    : target.kind === "chord-event" ? { kind: target.kind, chordEventId: id }
      : target.kind === "section-text" ? { kind: target.kind, sourceTextId: id }
        : { kind: target.kind, sourceMeasureId: id };
}

function entityKind(target: MusicXmlCurrentSourceTarget) {
  return target.kind === "voice-event" ? "lead-event" as const
    : target.kind === "chord-event" ? "chord-event" as const
      : target.kind === "section-text" ? "source-text" as const
        : "measure" as const;
}

export async function remapMusicXmlSourceTargetMap(
  map: MusicXmlSourceTargetMap,
  remap: SourceIdRemap,
): Promise<MusicXmlSourceTargetMap> {
  if (!revisionRefsEqual(map.sourceRevision, remap.fromRevision)) throw new RangeError("OMR_IMPORT_IDENTITY_INVALID");
  const entries = map.entries.map((item): MusicXmlSourceTargetMapEntry => {
    if (item.status === "deleted" || item.status === "unresolved") return { ...item };
    const targets = item.targets.flatMap((target) => {
      const found = remap.entries.find((candidate) => candidate.entityKind === entityKind(target) && candidate.fromId === targetId(target));
      return found?.toIds.map((id) => withTargetId(target, id)) ?? [];
    });
    const unique = [...new Map(targets.map((target) => [canonicalJson(target), target])).values()].sort(compareCanonicalValues);
    if (unique.length === 0) return { selector: item.selector, status: "deleted", targets: [] };
    if (unique.length === 1) return { selector: item.selector, status: "mapped-one", targets: [unique[0]] };
    return { selector: item.selector, status: "mapped-many", targets: unique };
  });
  const withoutDigest = { version: map.version, sourceRevision: remap.toRevision, entries: canonicalEntries(entries) };
  return { ...withoutDigest, mapDigest: await computeMusicXmlSourceTargetMapDigest(withoutDigest) };
}

function targetExists(source: SongSourceDocument, target: MusicXmlCurrentSourceTarget): boolean {
  if (target.kind === "voice-event") return source.sourceMeasures.some((measure) => measure.leadEvents.some((event) => event.id === target.eventId));
  if (target.kind === "chord-event") return source.sourceMeasures.some((measure) => measure.chordEvents.some((event) => event.id === target.chordEventId));
  if (target.kind === "section-text") return source.sourceMeasures.some((measure) => measure.textEvents.some((event) => event.id === target.sourceTextId));
  return source.sourceMeasures.some((measure) => measure.id === target.sourceMeasureId);
}

export async function validateMusicXmlSourceTargetMap(source: SongSourceDocument): Promise<boolean> {
  const map = source.importInfo?.musicXmlSourceTargetMap;
  if (!map) return source.importInfo === undefined || source.importInfo.sourceKind === "manual";
  if (map.version !== "musicxml-source-target-map-v1" || !revisionRefsEqual(map.sourceRevision, currentRevision(source))
    || !Array.isArray(map.entries) || canonicalJson(map.entries) !== canonicalJson(canonicalEntries(map.entries))
    || new Set(map.entries.map((item) => canonicalJson(item.selector))).size !== map.entries.length) return false;
  for (const item of map.entries) {
    if (item.status === "mapped-one" && item.targets.length !== 1) return false;
    if (item.status === "mapped-many" && item.targets.length < 2) return false;
    if ((item.status === "deleted" || item.status === "unresolved") && item.targets.length !== 0) return false;
    if ((item.targets as readonly MusicXmlCurrentSourceTarget[]).some((target) => target.kind !== item.selector.kind || !targetExists(source, target))) return false;
  }
  return map.mapDigest === await computeMusicXmlSourceTargetMapDigest({ version: map.version, sourceRevision: map.sourceRevision, entries: map.entries });
}

export function resolveMusicXmlSourceTarget(
  map: MusicXmlSourceTargetMap,
  selector: MusicXmlSourceTargetSelector,
): MusicXmlCurrentSourceTarget | undefined {
  const found = map.entries.find((item) => canonicalJson(item.selector) === canonicalJson(selector));
  return found?.status === "mapped-one" ? found.targets[0] : undefined;
}
