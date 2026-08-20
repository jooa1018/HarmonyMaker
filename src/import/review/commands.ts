import { parseChord } from "../../domain/chord/parser";
import { fraction, type Fraction } from "../../domain/fraction";
import { performerId } from "../../domain/ids";
import type { KeySignature, PitchRange } from "../../domain/pitch";
import type { RightsMetadata, SectionType, TempoSpec } from "../../domain/source/model";
import { tempoSpec, validateRights } from "../../domain/source/model";
import type {
  ImportedChordDraft,
  MusicXmlImportDraft,
  PerformerReviewSlot,
} from "../musicxml/types";

function updateChord(
  draft: MusicXmlImportDraft,
  chordKey: string,
  transform: (chord: ImportedChordDraft) => ImportedChordDraft,
): MusicXmlImportDraft {
  let found = false;
  const parts = draft.parts.map((part) => ({
    ...part,
    measures: part.measures.map((measure) => ({
      ...measure,
      chords: measure.chords.map((chord) => {
        if (chord.key !== chordKey) return chord;
        found = true;
        return transform(chord);
      }),
    })),
  }));
  return found ? { ...draft, parts } : draft;
}

export function selectLeadCandidate(
  draft: MusicXmlImportDraft,
  candidateKey: string,
): MusicXmlImportDraft {
  const candidate = draft.leadCandidates.find((item) => item.key === candidateKey);
  if (!candidate) return draft;
  const selectedLeadKey = draft.parts.find((part) => part.partOrdinal === candidate.partOrdinal)
    ?.measures[0]?.key;
  const { defaultKey: _previousPartKey, ...withoutDefaultKey } = draft;
  void _previousPartKey;
  return {
    ...withoutDefaultKey,
    selectedLeadStaffKey: candidateKey,
    ...(selectedLeadKey ? { defaultKey: selectedLeadKey } : {}),
  };
}

export function setDefaultKey(
  draft: MusicXmlImportDraft,
  defaultKey: KeySignature,
): MusicXmlImportDraft {
  return { ...draft, defaultKey };
}

export function setDefaultTempo(
  draft: MusicXmlImportDraft,
  value: TempoSpec,
): MusicXmlImportDraft {
  return { ...draft, defaultTempo: tempoSpec(value.beatUnit, value.dotted, value.bpm) };
}

export function confirmChord(
  draft: MusicXmlImportDraft,
  chordKey: string,
): MusicXmlImportDraft {
  return updateChord(draft, chordKey, (chord) => ({ ...chord, confirmation: "confirmed" }));
}

export function replaceChord(
  draft: MusicXmlImportDraft,
  chordKey: string,
  sourceText: string,
): MusicXmlImportDraft {
  return updateChord(draft, chordKey, (chord) => ({
    ...chord,
    sourceText,
    parseResult: parseChord(sourceText),
    source: "manual",
    confirmation: "unconfirmed",
  }));
}

export function addChord(
  draft: MusicXmlImportDraft,
  partOrdinal: number,
  measureOrdinal: number,
  onset: Fraction,
  sourceText: string,
): MusicXmlImportDraft {
  const part = draft.parts.find((candidate) => candidate.partOrdinal === partOrdinal);
  const measure = part?.measures[measureOrdinal];
  if (!part || !measure || onset.n < 0) return draft;
  const existing = measure.chords.filter((chord) => chord.onset.n * onset.d === onset.n * chord.onset.d).length;
  const chord: ImportedChordDraft = {
    key: `chord:user:p:${partOrdinal}:m:${measureOrdinal}:o:${onset.n}/${onset.d}:${existing}`,
    partOrdinal,
    measureOrdinal,
    onset: fraction(onset.n, onset.d),
    sourceText,
    parseResult: parseChord(sourceText),
    source: "manual",
    confirmation: "unconfirmed",
  };
  return {
    ...draft,
    parts: draft.parts.map((candidate) => candidate.partOrdinal !== partOrdinal
      ? candidate
      : {
          ...candidate,
          measures: candidate.measures.map((candidateMeasure) => candidateMeasure.ordinal !== measureOrdinal
            ? candidateMeasure
            : { ...candidateMeasure, chords: [...candidateMeasure.chords, chord] }),
        }),
  };
}

export function confirmSection(
  draft: MusicXmlImportDraft,
  sectionKey: string,
): MusicXmlImportDraft {
  return {
    ...draft,
    sections: draft.sections.map((section) => section.key === sectionKey
      ? { ...section, confirmation: "confirmed" }
      : section),
  };
}

export function editSection(
  draft: MusicXmlImportDraft,
  sectionKey: string,
  edit: { readonly type: SectionType; readonly label: string },
): MusicXmlImportDraft {
  return {
    ...draft,
    sections: draft.sections.map((section) => section.key === sectionKey
      ? { ...section, type: edit.type, label: edit.label.normalize("NFC"), confirmation: "suggested" }
      : section),
  };
}

export function setSectionOccurrenceLyricVerse(
  draft: MusicXmlImportDraft,
  occurrenceKey: string,
  verse: number,
): MusicXmlImportDraft {
  if (!Number.isSafeInteger(verse) || verse < 1) return draft;
  let found = false;
  const sectionOccurrences = draft.sectionOccurrences.map((occurrence) => {
    if (occurrence.key !== occurrenceKey || !occurrence.availableLyricVerses.includes(verse)) return occurrence;
    found = true;
    return { ...occurrence, selectedLyricVerse: verse };
  });
  return found ? { ...draft, sectionOccurrences } : draft;
}

export function setSingerCount(
  draft: MusicXmlImportDraft,
  singerCount: 1 | 2 | 3,
): MusicXmlImportDraft {
  const slots = Array.from({ length: singerCount }, (_, ordinal): PerformerReviewSlot => draft.performerSlots[ordinal] ?? {
    id: performerId(ordinal),
    displayName: ordinal === 0 ? "Lead" : `Singer ${ordinal + 1}`,
  });
  return { ...draft, singerCount, performerSlots: slots };
}

export function setPerformerRange(
  draft: MusicXmlImportDraft,
  performerOrdinal: number,
  value: {
    readonly displayName: string;
    readonly hardRange: PitchRange;
    readonly comfortableRange: PitchRange;
    readonly preferredTessitura?: PitchRange;
  },
): MusicXmlImportDraft {
  if (!Number.isSafeInteger(performerOrdinal) || performerOrdinal < 0 || performerOrdinal >= draft.singerCount) return draft;
  const id = performerId(performerOrdinal);
  return {
    ...draft,
    performerSlots: draft.performerSlots.map((slot, ordinal) => ordinal !== performerOrdinal
      ? slot
      : {
          id,
          displayName: value.displayName,
          profile: {
            id,
            displayName: value.displayName,
            hardRange: value.hardRange,
            comfortableRange: value.comfortableRange,
            ...(value.preferredTessitura ? { preferredTessitura: value.preferredTessitura } : {}),
          },
        }),
  };
}

export function confirmRights(
  draft: MusicXmlImportDraft,
  rights: RightsMetadata,
): MusicXmlImportDraft {
  return validateRights(rights) && rights.allowedUses.includes("generation")
    ? { ...draft, rights: { ...rights, allowedUses: [...rights.allowedUses].sort() } }
    : { ...draft, rights: undefined };
}
