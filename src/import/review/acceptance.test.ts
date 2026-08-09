import { describe, expect, it } from "vitest";
import { validateSongSourceDocumentIntegrity } from "../../domain/source/validation";
import {
  confirmChord,
  confirmRights,
  confirmSection,
  deriveQuickReview,
  importMusicXml,
  normalizeImportedSource,
  selectLeadCandidate,
  setPerformerRange,
  setSectionOccurrenceLyricVerse,
  type MusicXmlImportDraft,
  type Step3ImportVersions,
} from "..";

const encoder = new TextEncoder();
const VERSIONS: Step3ImportVersions = {
  performanceExpanderVersion: "repeat-v1",
  chordTimelineResolverVersion: "chord-timeline-v1",
  sourceLeadAtomizerVersion: "source-lead-atomizer-v1",
};

function note(step = "C", extra = "", duration = 4): string {
  return `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>${duration}</duration><voice>1</voice><staff>1</staff>${extra}</note>`;
}

function attributes(divisions = "1"): string {
  return `<attributes><divisions>${divisions}</divisions><key><fifths>0</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>`;
}

function harmony(root = "C", extra = ""): string {
  return `<harmony>${extra}<root><root-step>${root}</root-step></root><kind>major</kind></harmony>`;
}

function onePartScore(body: string, options: { readonly harmony?: string; readonly directions?: string; readonly divisions?: string } = {}): string {
  return `<score-partwise><work><work-title>Acceptance</work-title></work><part-list><score-part id="P1"><part-name>Lead</part-name></score-part></part-list><part id="P1"><measure number="1">${attributes(options.divisions)}${options.directions ?? '<direction><sound tempo="100"/></direction><direction><direction-type><rehearsal>Verse</rehearsal></direction-type></direction>'}${options.harmony ?? harmony()}${body}</measure></part></score-partwise>`;
}

async function imported(xml: string, versions: Step3ImportVersions = VERSIONS): Promise<MusicXmlImportDraft> {
  const result = await importMusicXml(encoder.encode(xml), {
    algorithmVersions: versions,
    identityFactory: () => "doc:acceptance",
  });
  expect(result.status).toBe("review-required");
  if (result.status !== "review-required") throw new Error("acceptance fixture unexpectedly blocked");
  return result.draft;
}

function completeReview(draft: MusicXmlImportDraft): MusicXmlImportDraft {
  let next = draft.selectedLeadStaffKey
    ? draft
    : selectLeadCandidate(draft, draft.leadCandidates[0].key);
  for (const part of next.parts) for (const measure of part.measures) {
    for (const chord of measure.chords) next = confirmChord(next, chord.key);
  }
  for (const section of next.sections) next = confirmSection(next, section.key);
  next = setPerformerRange(next, 0, {
    displayName: "Lead",
    hardRange: { low: { step: "C", alter: 0, octave: 3 }, high: { step: "C", alter: 0, octave: 6 } },
    comfortableRange: { low: { step: "G", alter: 0, octave: 3 }, high: { step: "G", alter: 0, octave: 5 } },
  });
  return confirmRights(next, { basis: "self-authored", allowedUses: ["generation"] });
}

describe("Step 3 acceptance blocker closure", () => {
  it("keeps every Quick Review blocker visible before rights materialization and clears only the edited blocker", async () => {
    const xml = onePartScore(note(), {
      harmony: '<harmony><offset>1</offset><root><root-step>C</root-step></root><kind>major</kind></harmony>',
      directions: '<direction><sound tempo="100"/></direction><direction><direction-type><rehearsal>Verse</rehearsal><words>D.S. al Coda</words></direction-type></direction>',
    });
    let draft = await imported(xml);
    draft = selectLeadCandidate(draft, draft.leadCandidates[0].key);
    const initial = await deriveQuickReview(draft, VERSIONS);
    expect(initial.source).toBeUndefined();
    expect(initial.normalization).toBeDefined();
    expect(initial.normalization?.unsupportedPerformanceFlows).toHaveLength(1);
    expect(initial.state.unconfirmedChordEventIds).toHaveLength(1);
    expect(initial.state.unconfirmedSectionDefinitionIds).toHaveLength(1);
    expect(initial.state.unresolvedChordGapDiagnosticIds.length).toBeGreaterThan(0);
    expect(initial.state.invalidPerformerIds).toEqual(["pf:0"]);
    expect(initial.state.missingRightsUses).toEqual(["generation"]);
    expect(initial.state.unsupportedPerformanceFlowIds).toEqual(["flow:0"]);

    draft = confirmChord(draft, draft.parts[0].measures[0].chords[0].key);
    const chordFixed = await deriveQuickReview(draft, VERSIONS);
    expect(chordFixed.state.unconfirmedChordEventIds).toEqual([]);
    expect(chordFixed.state.unconfirmedSectionDefinitionIds).toHaveLength(1);
    expect(chordFixed.state.unresolvedChordGapDiagnosticIds.length).toBeGreaterThan(0);
    expect(chordFixed.state.invalidPerformerIds).toEqual(["pf:0"]);
    expect(chordFixed.state.missingRightsUses).toEqual(["generation"]);
    expect(chordFixed.state.unsupportedPerformanceFlowIds).toEqual(["flow:0"]);
  });

  it("keeps structural Quick Review available while key and tempo materialization prerequisites are absent", async () => {
    const parsed = await imported(onePartScore(note()));
    const draft: MusicXmlImportDraft = {
      ...selectLeadCandidate(parsed, parsed.leadCandidates[0].key),
      defaultKey: undefined,
      defaultTempo: undefined,
    };
    const review = await deriveQuickReview(draft, VERSIONS);
    expect(review.source).toBeUndefined();
    expect(review.normalization).toBeDefined();
    expect(review.state.unconfirmedChordEventIds).toHaveLength(1);
    expect(review.state.unconfirmedSectionDefinitionIds).toHaveLength(1);
    expect(review.diagnostics.some((diagnostic) => diagnostic.details?.issue === "missing-key")).toBe(true);
    expect(review.diagnostics.some((diagnostic) => diagnostic.details?.issue === "missing-tempo")).toBe(true);
  });

  it.each([
    ["note alter", onePartScore(`<note><pitch><step>C</step><alter>abc</alter><octave>4</octave></pitch><duration>2</duration><voice>1</voice><staff>1</staff></note>${note("D", "", 2)}`), "invalid-pitch"],
    ["staff", onePartScore(`<note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><staff>abc</staff></note>${note("D", "", 2)}`), "invalid-staff"],
    ["harmony offset", onePartScore(note(), { harmony: '<harmony><offset>abc</offset><root><root-step>C</root-step></root><kind>major</kind></harmony>' }), "invalid-harmony-offset"],
    ["direction offset", onePartScore(note(), { directions: '<direction><sound tempo="100"/></direction><direction><offset>abc</offset><direction-type><rehearsal>Verse</rehearsal></direction-type></direction>' }), "invalid-direction-offset"],
    ["divisions", onePartScore(note(), { divisions: "abc" }), "invalid-divisions"],
    ["nonpositive divisions", onePartScore(note(), { divisions: "0" }), "invalid-divisions"],
  ])("does not default a present malformed %s", async (_name, xml, issue) => {
    const draft = await imported(xml);
    expect(draft.diagnostics.some((diagnostic) => diagnostic.details?.issue === issue)).toBe(true);
    expect(draft.leadCandidates.length).toBeGreaterThan(0);
    const review = await deriveQuickReview(completeReview(draft), VERSIONS);
    expect(review.state.readyForPlanning).toBe(false);
    expect(review.diagnostics.some((diagnostic) => diagnostic.details?.issue === issue)).toBe(true);
  });

  it.each([
    ["root-alter", '<root><root-step>C</root-step><root-alter>abc</root-alter></root><kind>major</kind>'],
    ["bass-alter", '<root><root-step>C</root-step></root><kind>major</kind><bass><bass-step>G</bass-step><bass-alter>abc</bass-alter></bass>'],
    ["degree-alter", '<root><root-step>C</root-step></root><kind>major</kind><degree><degree-value>9</degree-value><degree-alter>abc</degree-alter><degree-type>add</degree-type></degree>'],
  ])("preserves a present malformed %s as a blocking failed chord", async (_name, content) => {
    const draft = await imported(onePartScore(note(), { harmony: `<harmony>${content}</harmony>` }));
    expect(draft.parts[0].measures[0].chords[0].parseResult.status).toBe("failed");
    const review = await deriveQuickReview(completeReview(draft), VERSIONS);
    expect(review.state.readyForPlanning).toBe(false);
    expect(review.diagnostics.some((diagnostic) => diagnostic.code === "SOURCE_CHORD_PARSE_FAILED")).toBe(true);
  });

  it("groups first/second endings by increasing source order and stores lyric verse per occurrence", async () => {
    const lyrics = '<lyric number="1"><text>one</text></lyric><lyric number="2"><text>two</text></lyric>';
    const notes = (withLyrics = false) => `${note("C", withLyrics ? lyrics : "", 1)}${note("D", "", 1)}${note("E", "", 1)}${note("F", "", 1)}`;
    const xml = `<score-partwise><work><work-title>Endings</work-title></work><part-list><score-part id="P1"><part-name>Lead</part-name></score-part></part-list><part id="P1">
      <measure number="1">${attributes()}<direction><sound tempo="100"/></direction><direction><direction-type><rehearsal>Verse</rehearsal></direction-type></direction><barline location="left"><repeat direction="forward"/></barline>${harmony("C")}${notes(true)}</measure>
      <measure number="2"><barline location="left"><ending number="1" type="start"/></barline>${harmony("F")}${notes()}<barline location="right"><ending number="1" type="stop"/><repeat direction="backward"/></barline></measure>
      <measure number="3"><barline location="left"><ending number="2" type="start"/></barline>${harmony("G")}${notes()}<barline location="right"><ending number="2" type="stop"/></barline></measure>
    </part></score-partwise>`;
    let draft = await imported(xml);
    draft = selectLeadCandidate(draft, draft.leadCandidates[0].key);
    const occurrences = draft.sectionOccurrences.filter((item) => item.candidateKey === draft.selectedLeadStaffKey);
    expect(occurrences.map((item) => [item.startPerformanceMeasureIndex, item.endPerformanceMeasureIndexExclusive])).toEqual([[0, 2], [2, 4]]);
    expect(occurrences.map((item) => item.availableLyricVerses)).toEqual([[1, 2], [1, 2]]);
    draft = setSectionOccurrenceLyricVerse(draft, occurrences[0].key, 1);
    draft = setSectionOccurrenceLyricVerse(draft, occurrences[1].key, 2);
    const review = await deriveQuickReview(completeReview(draft), VERSIONS);
    expect(review.state.readyForPlanning).toBe(true);
    expect(review.source?.performanceSequence.occurrences.map((item) => item.sourceMeasureNumber)).toEqual([1, 2, 1, 3]);
    expect(review.source?.sectionOccurrences.map((item) => item.lyricVerseIndex)).toEqual([1, 2]);
    expect(review.source && await validateSongSourceDocumentIntegrity(review.source, VERSIONS.performanceExpanderVersion)).toBe(true);
    expect(review.atomization?.atoms.length).toBeGreaterThan(0);
  });

  it.each([
    "performanceExpanderVersion",
    "chordTimelineResolverVersion",
    "sourceLeadAtomizerVersion",
  ] as const)("blocks fresh execution when stored %s diverges from the current registry", async (field) => {
    const draft = completeReview(await imported(onePartScore(note())));
    expect(draft.algorithmVersions).toEqual(VERSIONS);
    expect((await normalizeImportedSource(draft, VERSIONS)).status).toBe("complete");
    const upgraded = { ...VERSIONS, [field]: `${VERSIONS[field]}-v2` };
    const review = await deriveQuickReview(draft, upgraded);
    expect(review.normalization).toBeUndefined();
    expect(review.state.readyForPlanning).toBe(false);
    expect(review.diagnostics.some((diagnostic) => diagnostic.code === "ALGORITHM_CONFIG_MISMATCH"
      && diagnostic.details?.issue === `version:${field}`)).toBe(true);
  });

  it("blocks a non-lead chord authority part whose measure identity/timing structure is not exact", async () => {
    const xml = `<score-partwise><part-list><score-part id="P1"><part-name>Lead</part-name></score-part><score-part id="P2"><part-name>Chords</part-name></score-part></part-list>
      <part id="P1"><measure number="1">${attributes()}<direction><sound tempo="100"/></direction>${note()}</measure></part>
      <part id="P2"><measure number="2">${attributes()}${harmony()}${note("G")}</measure></part>
    </score-partwise>`;
    const review = await deriveQuickReview(completeReview(await imported(xml)), VERSIONS);
    expect(review.normalization).toBeUndefined();
    expect(review.state.readyForPlanning).toBe(false);
    expect(review.diagnostics.some((diagnostic) => String(diagnostic.details?.issue).startsWith("chord-authority-part-misaligned"))).toBe(true);
  });

  it("does not let an unsupported note in an unselected accompaniment candidate block a clean selected lead", async () => {
    const ornament = '<notations><ornaments><trill-mark/></ornaments></notations>';
    const xml = `<score-partwise><part-list><score-part id="P1"><part-name>Lead</part-name></score-part><score-part id="P2"><part-name>Accompaniment</part-name></score-part></part-list>
      <part id="P1"><measure number="1">${attributes()}<direction><sound tempo="100"/></direction>${harmony()}${note()}</measure></part>
      <part id="P2"><measure number="1">${attributes()}${note("G", ornament)}</measure></part>
    </score-partwise>`;
    const draft = await imported(xml);
    expect(draft.diagnostics.some((diagnostic) => diagnostic.details?.diagnosticScope === "lead-candidate")).toBe(true);
    const review = await deriveQuickReview(completeReview(draft), VERSIONS);
    expect(review.diagnostics.some((diagnostic) => diagnostic.details?.issue === "unsupported-lead-note")).toBe(false);
    expect(review.state.readyForPlanning).toBe(true);
  });

  it("blocks a structurally valid Lead performer when the actual selected melody leaves hardRange", async () => {
    let draft = completeReview(await imported(onePartScore(note("C"))));
    draft = setPerformerRange(draft, 0, {
      displayName: "Too high",
      hardRange: { low: { step: "C", alter: 0, octave: 5 }, high: { step: "C", alter: 0, octave: 6 } },
      comfortableRange: { low: { step: "D", alter: 0, octave: 5 }, high: { step: "G", alter: 0, octave: 5 } },
    });
    const review = await deriveQuickReview(draft, VERSIONS);
    expect(review.state.invalidPerformerIds).toEqual(["pf:0"]);
    expect(review.diagnostics.some((diagnostic) => diagnostic.code === "PERFORMER_RANGE_INVALID"
      && diagnostic.details?.issue === "selected-lead-outside-hard-range")).toBe(true);
  });
});

function linearScore(measureCount: number, repeat = false): string {
  const measures = Array.from({ length: measureCount }, (_, ordinal) => {
    const start = ordinal === 0 ? `${attributes()}<direction><sound tempo="100"/></direction>${repeat ? '<barline location="left"><repeat direction="forward"/></barline>' : ""}` : "";
    const end = repeat && ordinal === measureCount - 1 ? '<barline location="right"><repeat direction="backward"/></barline>' : "";
    return `<measure number="${ordinal + 1}">${start}${note()}${end}</measure>`;
  }).join("");
  return `<score-partwise><part-list><score-part id="P1"><part-name>Lead</part-name></score-part></part-list><part id="P1">${measures}</part></score-partwise>`;
}

describe("Step 3 CoreInputLimits integration", () => {
  it("accepts 160 source measures and blocks source measure 161 during import", async () => {
    expect((await importMusicXml(encoder.encode(linearScore(160)), {
      algorithmVersions: VERSIONS,
      identityFactory: () => "doc:source-limit",
    })).status).toBe("review-required");
    const exceeded = await importMusicXml(encoder.encode(linearScore(161)), {
      algorithmVersions: VERSIONS,
      identityFactory: () => "doc:source-limit",
    });
    expect(exceeded.status).toBe("blocked");
    if (exceeded.status === "blocked") expect(exceeded.diagnostics.some((diagnostic) => diagnostic.code === "INPUT_LIMIT_EXCEEDED")).toBe(true);
  });

  it("accepts 160 expanded performance measures and blocks 162", async () => {
    const boundaryDraft = selectLeadCandidate(await imported(linearScore(80, true)), "lead:p:0:s:1:v:1:1");
    const boundary = await normalizeImportedSource(boundaryDraft, VERSIONS);
    expect(boundary.status).toBe("complete");
    if (boundary.status === "complete") expect(boundary.normalization.performanceSequence.occurrences).toHaveLength(160);

    const exceededDraft = selectLeadCandidate(await imported(linearScore(81, true)), "lead:p:0:s:1:v:1:1");
    const exceeded = await normalizeImportedSource(exceededDraft, VERSIONS);
    expect(exceeded.status).toBe("blocked");
    if (exceeded.status === "blocked") expect(exceeded.diagnostics.some((diagnostic) => diagnostic.code === "INPUT_LIMIT_EXCEEDED")).toBe(true);
  });
});
