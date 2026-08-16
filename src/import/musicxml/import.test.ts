import { describe, expect, it } from "vitest";
import { chordSemanticProjection } from "../../domain/chord/parser";
import { canonicalJson } from "../../domain/digest/canonical";
import { digestMusicalSource } from "../../domain/digest/source";
import { fraction } from "../../domain/fraction";
import { expandRepeats } from "../../domain/performance/repeat";
import { validatePerformer } from "../../domain/performer";
import { validateSongSourceDocumentIntegrity } from "../../domain/source/validation";
import {
  addChord,
  confirmChord,
  confirmRights,
  confirmSection,
  deriveQuickReview as deriveQuickReviewWithRegistry,
  importMusicXml,
  replaceChord,
  selectLeadCandidate,
  setDefaultTempo,
  setPerformerRange,
  setSectionOccurrenceLyricVerse,
  setSingerCount,
  type MusicXmlImportDraft,
} from "..";

const encoder = new TextEncoder();
const identityFactory = () => "doc:step3-test";
const TEST_ALGORITHM_VERSIONS = {
  performanceExpanderVersion: "repeat-v1",
  chordTimelineResolverVersion: "chord-timeline-v1",
  sourceLeadAtomizerVersion: "source-lead-atomizer-v1",
} as const;
const deriveQuickReview = (draft: MusicXmlImportDraft) =>
  deriveQuickReviewWithRegistry(draft, TEST_ALGORITHM_VERSIONS);

interface ScoreOptions {
  readonly title?: string;
  readonly composer?: string;
  readonly fifths?: number;
  readonly mode?: "major" | "minor";
  readonly beats?: 4 | 6;
  readonly beatType?: 4 | 8;
  readonly implicit?: boolean;
  readonly lyrics?: boolean;
  readonly accent?: boolean;
  readonly twoVoices?: boolean;
  readonly twoStaffs?: boolean;
  readonly chordKind?: string;
  readonly chordKindText?: string;
  readonly chordDegrees?: readonly {
    readonly value: number;
    readonly alter: number;
    readonly type: "add" | "alter" | "subtract";
  }[];
  readonly slashBass?: boolean;
  readonly noChord?: boolean;
  readonly section?: string;
  readonly flowWords?: string;
  readonly omitTempo?: boolean;
  readonly extraCreatorFirst?: boolean;
  readonly attributesReordered?: boolean;
}

function noteXml(
  step: string,
  duration: number,
  voice: string,
  staff: number,
  options: { readonly lyric?: boolean; readonly accent?: boolean; readonly chord?: boolean } = {},
): string {
  return `<note>${options.chord ? "<chord/>" : ""}<pitch><step>${step}</step><octave>4</octave></pitch><duration>${duration}</duration><voice>${voice}</voice><staff>${staff}</staff>${options.accent ? "<notations><articulations><accent/></articulations></notations>" : ""}${options.lyric ? "<lyric number=\"1\"><syllabic>single</syllabic><text>la</text></lyric>" : ""}</note>`;
}

function harmonyXml(options: ScoreOptions): string {
  if (options.noChord) return "<harmony><kind>none</kind></harmony>";
  const kind = options.chordKind ?? "major";
  const text = options.chordKindText ? ` text=\"${options.chordKindText}\"` : "";
  const degrees = (options.chordDegrees ?? []).map((degree) => `<degree><degree-value>${degree.value}</degree-value><degree-alter>${degree.alter}</degree-alter><degree-type>${degree.type}</degree-type></degree>`).join("");
  return `<harmony><root><root-step>C</root-step></root><kind${text}>${kind}</kind>${degrees}${options.slashBass ? "<bass><bass-step>G</bass-step></bass>" : ""}</harmony>`;
}

function scoreXml(options: ScoreOptions = {}): string {
  const beats = options.beats ?? 4;
  const beatType = options.beatType ?? 4;
  const divisions = beatType === 8 ? 2 : 1;
  const noteDuration = 1;
  const noteCount = options.implicit ? 1 : beats;
  const fifths = options.fifths ?? 0;
  const mode = options.mode ?? "major";
  const key = `<key><fifths>${fifths}</fifths><mode>${mode}</mode></key>`;
  const time = `<time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time>`;
  const attributes = options.attributesReordered
    ? `<attributes>${time}${key}<divisions>${divisions}</divisions></attributes>`
    : `<attributes><divisions>${divisions}</divisions>${key}${time}</attributes>`;
  const primaryNotes = Array.from({ length: noteCount }, (_, index) => noteXml(
    ["C", "D", "E", "F", "G", "A"][index % 6],
    noteDuration,
    "1",
    1,
    { lyric: options.lyrics && index === 0, accent: options.accent && index === 0 },
  )).join("");
  const secondVoice = options.twoVoices
    ? `<backup><duration>${noteCount * noteDuration}</duration></backup>${Array.from({ length: noteCount }, () => noteXml("G", noteDuration, "2", 1)).join("")}`
    : "";
  const secondStaff = options.twoStaffs
    ? `<backup><duration>${noteCount * noteDuration}</duration></backup>${Array.from({ length: noteCount }, () => noteXml("A", noteDuration, "1", 2)).join("")}`
    : "";
  const direction = `${options.omitTempo ? "" : "<direction><sound tempo=\"100\"/></direction>"}<direction><direction-type><rehearsal>${options.section ?? "Verse"}</rehearsal></direction-type></direction>${options.flowWords ? `<direction><direction-type><words>${options.flowWords}</words></direction-type></direction>` : ""}`;
  const creators = options.extraCreatorFirst
    ? `<creator type=\"lyricist\">Someone</creator><creator type=\"composer\">${options.composer ?? "Composer"}</creator>`
    : `<creator type=\"composer\">${options.composer ?? "Composer"}</creator>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0"><work><work-title>${options.title ?? "Synthetic"}</work-title></work><identification>${creators}</identification><part-list><score-part id="P1"><part-name>Lead</part-name></score-part></part-list><part id="P1"><measure number="1"${options.implicit ? " implicit=\"yes\"" : ""}>${attributes}${direction}${harmonyXml(options)}${primaryNotes}${secondVoice}${secondStaff}</measure></part></score-partwise>`;
}

function repeatScoreXml(withEndings = false): string {
  const attrs = "<attributes><divisions>1</divisions><key><fifths>0</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>";
  const notes = Array.from({ length: 4 }, () => noteXml("C", 1, "1", 1)).join("");
  const measure = (number: number, prefix: string, suffix: string, root: string) => `<measure number="${number}">${prefix}<harmony><root><root-step>${root}</root-step></root><kind>major</kind></harmony>${notes}${suffix}</measure>`;
  const measures = withEndings
    ? [
        measure(1, `${attrs}<direction><sound tempo="100"/></direction><direction><direction-type><rehearsal>Verse</rehearsal></direction-type></direction><barline location="left"><repeat direction="forward"/></barline>`, "", "C"),
        measure(2, "<barline location=\"left\"><ending number=\"1\" type=\"start\"/></barline>", "<barline location=\"right\"><ending number=\"1\" type=\"stop\"/><repeat direction=\"backward\"/></barline>", "F"),
        measure(3, "<barline location=\"left\"><ending number=\"2\" type=\"start\"/></barline>", "<barline location=\"right\"><ending number=\"2\" type=\"stop\"/></barline>", "G"),
      ].join("")
    : [
        measure(1, `${attrs}<direction><sound tempo="100"/></direction><direction><direction-type><rehearsal>Verse</rehearsal></direction-type></direction><barline location="left"><repeat direction="forward"/></barline>`, "", "C"),
        measure(2, "", "<barline location=\"right\"><repeat direction=\"backward\" times=\"2\"/></barline>", "G"),
      ].join("");
  return `<score-partwise><work><work-title>Repeat</work-title></work><part-list><score-part id="P1"><part-name>Lead</part-name></score-part></part-list><part id="P1">${measures}</part></score-partwise>`;
}

async function imported(xml: string, fileName = "fixture.musicxml"): Promise<MusicXmlImportDraft> {
  const result = await importMusicXml(encoder.encode(xml), {
    algorithmVersions: TEST_ALGORITHM_VERSIONS,
    originalFileName: fileName,
    identityFactory,
  });
  expect(result.status).toBe("review-required");
  if (result.status !== "review-required") throw new Error("fixture import was blocked");
  return result.draft;
}

function finishReview(draft: MusicXmlImportDraft): MusicXmlImportDraft {
  let next = draft.selectedLeadStaffKey ? draft : selectLeadCandidate(draft, draft.leadCandidates[0].key);
  for (const part of next.parts) {
    for (const measure of part.measures) {
      for (const chord of measure.chords) next = confirmChord(next, chord.key);
    }
  }
  for (const section of next.sections) next = confirmSection(next, section.key);
  next = setPerformerRange(next, 0, {
    displayName: "Lead",
    hardRange: { low: { step: "C", alter: 0, octave: 3 }, high: { step: "C", alter: 0, octave: 6 } },
    comfortableRange: { low: { step: "G", alter: 0, octave: 3 }, high: { step: "G", alter: 0, octave: 5 } },
    preferredTessitura: { low: { step: "C", alter: 0, octave: 4 }, high: { step: "C", alter: 0, octave: 5 } },
  });
  next = confirmRights(next, { basis: "self-authored", allowedUses: ["generation"] });
  return next;
}

describe("MusicXML import and canonical review", () => {
  it("imports ordered MusicXML into an explicit-selection draft", async () => {
    const draft = await imported(scoreXml({ lyrics: true, slashBass: true }));
    expect(draft.leadCandidates).toHaveLength(1);
    expect(draft.selectedLeadStaffKey).toBeUndefined();
    expect(draft.parts[0].measures[0].duration).toEqual(fraction(4));
    expect(draft.parts[0].measures[0].chords[0].parseResult.status).toBe("ok");
    expect(draft.parts[0].measures[0].chords[0].sourceText).toContain("/G");
  });

  it("finalizes through source, timeline, atomization, and exact Quick Review readiness", async () => {
    const review = await deriveQuickReview(finishReview(await imported(scoreXml({ lyrics: true }))));
    expect(review.state.readyForPlanning).toBe(true);
    expect(review.chordTimelineState.status).toBe("resolved");
    expect(review.atomization?.atoms.length).toBeGreaterThan(0);
    expect(review.source && await validateSongSourceDocumentIntegrity(review.source, "repeat-v1")).toBe(true);
    expect(review.source?.revisionDigest).toBe(review.source && await digestMusicalSource(review.source));
  });

  it("keeps file/display metadata and semantic XML ordering out of the musical digest", async () => {
    const left = await deriveQuickReview(finishReview(await imported(scoreXml({ title: "Left", composer: "A" }), "left.musicxml")));
    const right = await deriveQuickReview(finishReview(await imported(scoreXml({ title: "Right", composer: "B", attributesReordered: true, extraCreatorFirst: true }), "arbitrary-name.mxl")));
    expect(left.source?.revisionDigest).toBe(right.source?.revisionDigest);
  });

  it("normalizes equivalent MusicXML chord display aliases", async () => {
    const m7 = await deriveQuickReview(finishReview(await imported(scoreXml({ chordKind: "major-seventh", chordKindText: "M7" }))));
    const delta = await deriveQuickReview(finishReview(await imported(scoreXml({ chordKind: "major-seventh", chordKindText: "Δ7" }))));
    expect(m7.source?.revisionDigest).toBe(delta.source?.revisionDigest);
  });

  it.each([
    ["Cadd9", { chordKind: "major", chordDegrees: [{ value: 9, alter: 0, type: "add" }] }],
    ["C7#11", { chordKind: "dominant", chordDegrees: [{ value: 11, alter: 1, type: "alter" }] }],
    ["Cno5", { chordKind: "major", chordDegrees: [{ value: 5, alter: 0, type: "subtract" }] }],
  ] as const)("preserves structured-only %s through save-and-confirm", async (symbol, options) => {
    const draft = await imported(scoreXml(options));
    const importedChord = draft.parts[0].measures[0].chords[0];
    expect(importedChord.sourceText).toBe(symbol);
    expect(importedChord.parseResult.status).toBe("ok");
    const confirmed = confirmChord(replaceChord(draft, importedChord.key, importedChord.sourceText), importedChord.key);
    const confirmedChord = confirmed.parts[0].measures[0].chords[0];
    expect(confirmedChord.confirmation).toBe("confirmed");
    expect(confirmedChord.parseResult.status).toBe("ok");
    if (importedChord.parseResult.status !== "ok" || confirmedChord.parseResult.status !== "ok") return;
    expect(canonicalJson(chordSemanticProjection(confirmedChord.parseResult.chord)))
      .toBe(canonicalJson(chordSemanticProjection(importedChord.parseResult.chord)));
  });

  it("ignores semantic-unequal kind text in favor of structured degrees", async () => {
    const draft = await imported(scoreXml({
      chordKind: "major",
      chordKindText: "7",
      chordDegrees: [{ value: 9, alter: 0, type: "add" }],
    }));
    const chord = draft.parts[0].measures[0].chords[0];
    expect(chord.sourceText).toBe("Cadd9");
    expect(chord.parseResult.status === "ok" ? chord.parseResult.chord.canonicalSymbol : undefined).toBe("Cadd9");
  });

  it("preserves an unrepresentable MusicXML harmony string as failed review provenance", async () => {
    const draft = await imported(scoreXml({ chordKind: "other", chordKindText: "mystery" }));
    const importedChord = draft.parts[0].measures[0].chords[0];
    expect(importedChord.parseResult.status).toBe("failed");
    expect(importedChord.sourceText).toBe("Cmystery");
    const review = await deriveQuickReview(finishReview(draft));
    expect(review.source?.sourceMeasures[0].chordEvents[0].sourceText).toBe("Cmystery");
    expect(review.diagnostics.some((item) => item.code === "SOURCE_CHORD_PARSE_FAILED")).toBe(true);
  });

  it("changes source semantics for a different explicit Lead candidate", async () => {
    const draft = await imported(scoreXml({ twoVoices: true }));
    expect(draft.leadCandidates).toHaveLength(2);
    const first = finishReview(selectLeadCandidate(draft, draft.leadCandidates[0].key));
    const second = finishReview(selectLeadCandidate(draft, draft.leadCandidates[1].key));
    const firstReview = await deriveQuickReview(first);
    const secondReview = await deriveQuickReview(second);
    expect(firstReview.source?.revisionDigest).not.toBe(secondReview.source?.revisionDigest);
  });

  it("projects MusicXML accent into production lyric semantics", async () => {
    const plain = await deriveQuickReview(finishReview(await imported(scoreXml({ lyrics: true }))));
    const accented = await deriveQuickReview(finishReview(await imported(scoreXml({ lyrics: true, accent: true }))));
    expect(plain.source?.revisionDigest).not.toBe(accented.source?.revisionDigest);
    expect(plain.atomization?.digest).not.toBe(accented.atomization?.digest);
  });

  it("round-trips canonical source JSON through the authoritative integrity gate", async () => {
    const review = await deriveQuickReview(finishReview(await imported(scoreXml({ lyrics: true }))));
    expect(review.source).toBeDefined();
    const decoded: unknown = JSON.parse(JSON.stringify(review.source));
    expect(await validateSongSourceDocumentIntegrity(decoded, "repeat-v1")).toBe(true);
    expect(canonicalJson(decoded)).toBe(canonicalJson(review.source));
  });

  it("rejects a forged persisted source after the semantic round-trip", async () => {
    const review = await deriveQuickReview(finishReview(await imported(scoreXml({ lyrics: true }))));
    expect(review.source).toBeDefined();
    const decoded = JSON.parse(JSON.stringify(review.source)) as Record<string, unknown>;
    decoded.revisionDigest = "0".repeat(64);
    expect(await validateSongSourceDocumentIntegrity(decoded, "repeat-v1")).toBe(false);
  });

  it("uses the authoritative repeat expander for repeats and first/second endings", async () => {
    const repeat = await deriveQuickReview(finishReview(await imported(repeatScoreXml(false))));
    const ending = await deriveQuickReview(finishReview(await imported(repeatScoreXml(true))));
    expect(repeat.source?.performanceSequence.occurrences.map((item) => item.sourceMeasureNumber)).toEqual([1, 2, 1, 2]);
    expect(ending.source?.performanceSequence.occurrences.map((item) => item.sourceMeasureNumber)).toEqual([1, 2, 1, 3]);
    expect(ending.source).toBeDefined();
    if (!ending.source) return;
    const recomputed = expandRepeats(ending.source.sourceMeasures, "repeat-v1");
    expect(recomputed.status).toBe("complete");
    if (recomputed.status === "complete") {
      expect(canonicalJson(recomputed.sequence)).toBe(canonicalJson(ending.source.performanceSequence));
    }
  });

  it("keeps resolved timeline spans partitioned and carry references acyclic", async () => {
    const review = await deriveQuickReview(finishReview(await imported(repeatScoreXml(false))));
    expect(review.chordTimelineState.status).toBe("resolved");
    if (review.chordTimelineState.status !== "resolved" || !review.source) return;
    const spans = review.chordTimelineState.timeline.spans;
    const ordinalById = new Map(spans.map((span, ordinal) => [span.id, ordinal]));
    const sourceIds = new Set(review.source.sourceMeasures.flatMap((measure) => measure.chordEvents.map((event) => event.id)));
    for (let index = 0; index < spans.length; index += 1) {
      const span = spans[index];
      expect(span.range.start.performanceMeasureIndex).toBeLessThanOrEqual(span.range.end.performanceMeasureIndex);
      if (index > 0) {
        const previous = spans[index - 1];
        const ordered = previous.range.end.performanceMeasureIndex < span.range.start.performanceMeasureIndex
          || (previous.range.end.performanceMeasureIndex === span.range.start.performanceMeasureIndex
            && previous.range.end.offset.n * span.range.start.offset.d <= span.range.start.offset.n * previous.range.end.offset.d);
        expect(ordered).toBe(true);
      }
      if (span.origin.kind === "source-event") expect(sourceIds.has(span.origin.sourceChordEventId)).toBe(true);
      else {
        expect(ordinalById.get(span.origin.previousSpanId)).toBeLessThan(index);
        expect(span.origin.previousSpanId).not.toBe(span.id);
        expect(sourceIds.has(span.origin.originatingSourceChordEventId)).toBe(true);
        if (span.origin.carryTokenSourceChordEventId) expect(sourceIds.has(span.origin.carryTokenSourceChordEventId)).toBe(true);
      }
    }
  });

  it("blocks unsupported D.S./Coda flow without guessing a sequence", async () => {
    const draft = await imported(scoreXml({ flowWords: "D.S. al Coda" }));
    const review = await deriveQuickReview(finishReview(draft));
    expect(review.state.readyForPlanning).toBe(false);
    expect(review.state.unsupportedPerformanceFlowIds).toHaveLength(1);
    expect(review.diagnostics.some((item) => item.code === "UNSUPPORTED_PERFORMANCE_FLOW")).toBe(true);
  });

  it("recomputes chord parsing and coverage after review commands", async () => {
    let draft = await imported(scoreXml());
    const chord = draft.parts[0].measures[0].chords[0];
    draft = replaceChord(draft, chord.key, "not-a-chord");
    let review = await deriveQuickReview(finishReview(draft));
    expect(review.state.readyForPlanning).toBe(false);
    expect(review.diagnostics.some((item) => item.code === "SOURCE_CHORD_PARSE_FAILED")).toBe(true);
    draft = replaceChord(draft, chord.key, "C");
    review = await deriveQuickReview(finishReview(draft));
    expect(review.state.readyForPlanning).toBe(true);
    const noHarmony = await imported(scoreXml().replace(harmonyXml({}), ""));
    const withChord = addChord(noHarmony, 0, 0, fraction(0), "N.C.");
    expect((await deriveQuickReview(finishReview(withChord))).state.readyForPlanning).toBe(true);
  });

  it("keeps tempo absence explicit until the reviewer supplies it", async () => {
    let draft = finishReview(await imported(scoreXml({ omitTempo: true })));
    let review = await deriveQuickReview(draft);
    expect(review.state.readyForPlanning).toBe(false);
    draft = setDefaultTempo(draft, { beatUnit: 4, dotted: false, bpm: 96 });
    review = await deriveQuickReview(draft);
    expect(review.state.readyForPlanning).toBe(true);
  });

  it("requires explicit lyric verse authority when multiple verses are ambiguous", async () => {
    const xml = scoreXml({ lyrics: true }).replace(
      "</lyric>",
      "</lyric><lyric number=\"2\"><syllabic>single</syllabic><text>lo</text></lyric>",
    );
    let draft = finishReview(await imported(xml));
    expect((await deriveQuickReview(draft)).state.readyForPlanning).toBe(false);
    const occurrence = draft.sectionOccurrences.find((item) => item.candidateKey === draft.selectedLeadStaffKey);
    expect(occurrence).toBeDefined();
    if (!occurrence) return;
    draft = setSectionOccurrenceLyricVerse(draft, occurrence.key, 2);
    expect((await deriveQuickReview(draft)).state.readyForPlanning).toBe(true);
  });

  it("uses existing performer range validation", async () => {
    const draft = finishReview(await imported(scoreXml()));
    const profile = draft.performerSlots[0].profile;
    expect(profile && validatePerformer(profile)).toBe(true);
  });

  it("requires one canonical validated performer slot for every selected singer", async () => {
    let draft = setSingerCount(finishReview(await imported(scoreXml())), 2);
    let review = await deriveQuickReview(draft);
    expect(review.state.invalidPerformerIds).toEqual(["pf:1"]);
    expect(review.state.readyForPlanning).toBe(false);
    draft = setPerformerRange(draft, 1, {
      displayName: "Singer 2",
      hardRange: { low: { step: "C", alter: 0, octave: 3 }, high: { step: "C", alter: 0, octave: 6 } },
      comfortableRange: { low: { step: "G", alter: 0, octave: 3 }, high: { step: "G", alter: 0, octave: 5 } },
    });
    review = await deriveQuickReview(draft);
    expect(review.state.invalidPerformerIds).toEqual([]);
    expect(review.state.readyForPlanning).toBe(true);
  });

  it("materializes an actual short implicit pickup duration", async () => {
    const draft = await imported(scoreXml({ implicit: true }));
    expect(draft.parts[0].measures[0].duration).toEqual(fraction(1));
  });
});

describe("valid import fixture matrix", () => {
  const fixtures: Readonly<Record<string, string>> = {
    "4/4 C major": scoreXml(),
    "4/4 A minor": scoreXml({ mode: "minor" }),
    "6/8 major": scoreXml({ beats: 6, beatType: 8 }),
    "6/8 minor": scoreXml({ beats: 6, beatType: 8, mode: "minor" }),
    pickup: scoreXml({ implicit: true }),
    "two voices": scoreXml({ twoVoices: true }),
    "two staffs": scoreXml({ twoStaffs: true }),
    lyrics: scoreXml({ lyrics: true }),
    "slash bass": scoreXml({ slashBass: true }),
    repeat: repeatScoreXml(false),
    endings: repeatScoreXml(true),
    "section suggestion": scoreXml({ section: "Chorus 1" }),
    "no chord": scoreXml({ noChord: true }),
    "sus chord": scoreXml({ chordKind: "suspended-fourth", chordKindText: "sus4" }),
    "accent lyric": scoreXml({ lyrics: true, accent: true }),
    "major seventh alias": scoreXml({ chordKind: "major-seventh", chordKindText: "Δ7" }),
  };

  it.each(Object.entries(fixtures))("imports %s", async (_name, xml) => {
    const result = await importMusicXml(encoder.encode(xml), {
      algorithmVersions: TEST_ALGORITHM_VERSIONS,
      identityFactory,
    });
    expect(result.status).toBe("review-required");
  });
});
