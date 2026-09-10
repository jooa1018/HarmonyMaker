import type { MusicXmlImportDraft } from "../musicxml/types";

/** Keep separate, pitch-free voices on the chosen staff. Never fold polyphony into Lead. */
export function importedRhythmVoices(draft: MusicXmlImportDraft) {
  const selected = draft.leadCandidates.find((candidate) => candidate.key === draft.selectedLeadStaffKey);
  const part = draft.parts.find((candidate) => candidate.partOrdinal === selected?.partOrdinal);
  if (!selected || !part) return [];
  return draft.leadCandidates.flatMap((candidate, index) => {
    if (candidate.key === selected.key || candidate.partOrdinal !== selected.partOrdinal || candidate.staffNumber !== selected.staffNumber) return [];
    const events = part.measures.flatMap((measure) => measure.leadEvents.filter((event) => event.candidateKey === candidate.key));
    if (!events.some((event) => event.kind === "rhythm") || events.some((event) => event.kind === "note")) return [];
    return [{ candidate, voice: index + 1 }];
  });
}
