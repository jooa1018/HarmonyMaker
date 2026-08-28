import type { Diagnostic } from "../../domain/diagnostics";
import { addFractions, compareFractions, type Fraction } from "../../domain/fraction";
import { comparePitches } from "../../domain/pitch";
import {
  diagnosticInputsFromDiagnostics,
  materializeImportDiagnostics,
  type ImportDiagnosticInput,
} from "./diagnostics";
import type {
  ImportedLeadEventDraft,
  ImportedPartDraft,
  LeadVoiceCandidate,
  MusicXmlImportDraft,
} from "./types";
import * as core from "./parser-core";

export { createSecureDocumentId, __musicXmlParserInternals } from "./parser-core";

// Internal OMR handoff contract emitted by OmrClient. Direct MusicXML imports keep
// the conservative same-voice overlap blocker; only provider-produced OMR results
// are partitioned into explicit review lanes so no musical event is silently lost.
const OMR_HANDOFF_FILE_NAME = "omr-result.musicxml";

interface DerivedCandidateDescriptor {
  readonly key: string;
  readonly rawKey: string;
  readonly lane: number;
  readonly source: LeadVoiceCandidate;
}

function fixedCompare(left: string, right: string): -1 | 0 | 1 {
  return left < right ? -1 : left > right ? 1 : 0;
}

function laneCandidateKey(rawKey: string, lane: number): string {
  return lane === 0 ? rawKey : `${rawKey}:lane:${lane + 1}`;
}

function firstAvailableLane(ends: readonly Fraction[], onset: Fraction): number {
  for (let lane = 0; lane < ends.length; lane += 1) {
    if (compareFractions(ends[lane], onset) <= 0) return lane;
  }
  return ends.length;
}

function assignmentKey(
  partOrdinal: number,
  measureOrdinal: number,
  candidateKey: string,
  eventOrdinal: number,
): string {
  return JSON.stringify([partOrdinal, measureOrdinal, candidateKey, eventOrdinal]);
}

function rebuildCandidates(
  parts: readonly ImportedPartDraft[],
  descriptors: ReadonlyMap<string, DerivedCandidateDescriptor>,
): readonly LeadVoiceCandidate[] {
  const candidates = [...descriptors.values()].map((descriptor): LeadVoiceCandidate => {
    const part = parts.find((item) => item.partOrdinal === descriptor.source.partOrdinal);
    if (!part) throw new RangeError("derived lead candidate references a missing part");
    const occurrences = part.measures.flatMap((measure) => measure.leadEvents
      .filter((event) => event.candidateKey === descriptor.key)
      .map((event) => ({ measureOrdinal: measure.ordinal, event })));
    const notes = occurrences
      .map((entry) => entry.event)
      .filter((event): event is Extract<ImportedLeadEventDraft, { readonly kind: "note" }> => event.kind === "note");
    const pitches = notes.map((note) => note.pitch).sort(comparePitches);
    return {
      key: descriptor.key,
      partOrdinal: descriptor.source.partOrdinal,
      staffNumber: descriptor.source.staffNumber,
      voiceKey: descriptor.source.voiceKey,
      displayPartName: descriptor.lane === 0
        ? descriptor.source.displayPartName
        : `${descriptor.source.displayPartName} · 겹침 lane ${descriptor.lane + 1}`,
      noteCount: notes.length,
      lyricCount: notes.reduce((sum, note) => sum + note.lyrics.length, 0),
      ...(pitches.length > 0 ? { pitchRangePreview: { low: pitches[0], high: pitches[pitches.length - 1] } } : {}),
      measureCoverage: [...new Set(occurrences.map((entry) => entry.measureOrdinal))]
        .sort((left, right) => left - right),
    };
  });
  return candidates.sort((left, right) => left.partOrdinal - right.partOrdinal
    || left.staffNumber - right.staffNumber
    || fixedCompare(left.voiceKey, right.voiceKey)
    || fixedCompare(left.key, right.key));
}

function expandCandidateScopedDiagnostics(
  diagnostics: readonly Diagnostic[],
  derivedKeysByRaw: ReadonlyMap<string, readonly string[]>,
): readonly ImportDiagnosticInput[] {
  return diagnosticInputsFromDiagnostics(diagnostics).flatMap((input) => {
    const details = input.details;
    const rawKey = details?.diagnosticScope === "lead-candidate"
      && typeof details.candidateKey === "string"
      ? details.candidateKey
      : undefined;
    if (!rawKey) return [input];
    const keys = derivedKeysByRaw.get(rawKey);
    if (!keys || keys.length <= 1) return [input];
    return keys.map((candidateKey) => candidateKey === rawKey
      ? input
      : { ...input, details: { ...details, candidateKey } });
  });
}

async function splitOverlappingLeadCandidates(
  draft: MusicXmlImportDraft,
): Promise<MusicXmlImportDraft> {
  const rawCandidateByKey = new Map(draft.leadCandidates.map((candidate) => [candidate.key, candidate]));
  const descriptors = new Map<string, DerivedCandidateDescriptor>();
  const assignments = new Map<string, string>();
  const derivedKeysByRawMutable = new Map<string, Set<string>>();
  let splitDetected = false;

  const parts = draft.parts.map((part): ImportedPartDraft => ({
    ...part,
    measures: part.measures.map((measure) => {
      const laneEndsByRaw = new Map<string, Fraction[]>();
      const leadEvents = measure.leadEvents.map((event): ImportedLeadEventDraft => {
        const source = rawCandidateByKey.get(event.candidateKey);
        if (!source) throw new RangeError("lead event references a missing candidate");
        const ends = laneEndsByRaw.get(event.candidateKey) ?? [];
        const lane = firstAvailableLane(ends, event.onset);
        ends[lane] = addFractions(event.onset, event.duration);
        laneEndsByRaw.set(event.candidateKey, ends);
        if (lane > 0) splitDetected = true;
        const key = laneCandidateKey(event.candidateKey, lane);
        if (!descriptors.has(key)) descriptors.set(key, {
          key,
          rawKey: event.candidateKey,
          lane,
          source,
        });
        const derived = derivedKeysByRawMutable.get(event.candidateKey) ?? new Set<string>();
        derived.add(key);
        derivedKeysByRawMutable.set(event.candidateKey, derived);
        if (event.musicXmlEventOrdinal !== undefined) {
          assignments.set(assignmentKey(
            part.partOrdinal,
            measure.ordinal,
            event.candidateKey,
            event.musicXmlEventOrdinal,
          ), key);
        }
        return key === event.candidateKey ? event : { ...event, candidateKey: key };
      });
      return { ...measure, leadEvents };
    }),
  }));

  if (!splitDetected) return draft;

  const leadCandidates = rebuildCandidates(parts, descriptors);
  const identityInventory = draft.musicXmlIdentityInventory === undefined
    ? undefined
    : {
        ...draft.musicXmlIdentityInventory,
        leadEvents: draft.musicXmlIdentityInventory.leadEvents.map((item) => {
          const key = assignments.get(assignmentKey(
            item.partOrdinal,
            item.measureOrdinal,
            item.candidateKey,
            item.eventOrdinal,
          ));
          return key && key !== item.candidateKey ? { ...item, candidateKey: key } : item;
        }),
      };
  const derivedKeysByRaw = new Map<string, readonly string[]>(
    [...derivedKeysByRawMutable.entries()].map(([key, values]) => [key, [...values].sort(fixedCompare)]),
  );
  const diagnostics = await materializeImportDiagnostics(
    expandCandidateScopedDiagnostics(draft.diagnostics, derivedKeysByRaw),
  );

  return {
    ...draft,
    parts,
    leadCandidates,
    ...(identityInventory ? { musicXmlIdentityInventory: identityInventory } : {}),
    diagnostics,
  };
}

export async function importMusicXml(
  rawBytes: Uint8Array,
  options: Parameters<typeof core.importMusicXml>[1],
): Promise<Awaited<ReturnType<typeof core.importMusicXml>>> {
  const result = await core.importMusicXml(rawBytes, options);
  if (result.status !== "review-required" || options.originalFileName !== OMR_HANDOFF_FILE_NAME) return result;
  const draft = await splitOverlappingLeadCandidates(result.draft);
  return draft === result.draft ? result : { ...result, draft, diagnostics: draft.diagnostics };
}
