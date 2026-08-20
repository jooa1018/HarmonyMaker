import { describe, expect, it } from "vitest";
import { fraction } from "../../domain/fraction";
import {
  clearDefaultKeyOverride,
  confirmChord,
  confirmRights,
  confirmSection,
  deriveQuickReview as deriveQuickReviewWithRegistry,
  importMusicXml,
  replaceChord,
  selectLeadCandidate,
  setDefaultKey,
  setPerformerRange,
  setSectionOccurrenceLyricVerse,
  type MusicXmlImportDraft,
} from "..";

const encoder = new TextEncoder();
const identityFactory = () => "doc:quick-review";
const TEST_ALGORITHM_VERSIONS = {
  performanceExpanderVersion: "repeat-v1",
  chordTimelineResolverVersion: "chord-timeline-v1",
  sourceLeadAtomizerVersion: "source-lead-atomizer-v1",
} as const;
const deriveQuickReview = (draft: MusicXmlImportDraft) =>
  deriveQuickReviewWithRegistry(draft, TEST_ALGORITHM_VERSIONS);

function score(body: string, options: { readonly time?: string; readonly flow?: string; readonly secondMeasure?: string } = {}): string {
  return `<score-partwise><work><work-title>Review</work-title></work><part-list><score-part id="P1"><part-name>Lead</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths><mode>major</mode></key>${options.time ?? "<time><beats>4</beats><beat-type>4</beat-type></time>"}</attributes><direction><sound tempo="100"/></direction><direction><direction-type><rehearsal>Verse</rehearsal></direction-type></direction>${options.flow ? `<direction><direction-type><words>${options.flow}</words></direction-type></direction>` : ""}<harmony><root><root-step>C</root-step></root><kind>major</kind></harmony>${body}</measure>${options.secondMeasure ?? ""}</part></score-partwise>`;
}

const wholeNote = "<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><staff>1</staff></note>";

async function draftFrom(xml = score(wholeNote)): Promise<MusicXmlImportDraft> {
  const result = await importMusicXml(encoder.encode(xml), {
    algorithmVersions: TEST_ALGORITHM_VERSIONS,
    identityFactory,
  });
  expect(result.status).toBe("review-required");
  if (result.status !== "review-required") throw new Error("review fixture blocked");
  return result.draft;
}

function selectAndConfirm(
  draft: MusicXmlImportDraft,
  options: {
    readonly chord?: boolean;
    readonly section?: boolean;
    readonly rights?: boolean;
    readonly performer?: "valid" | "invalid-comfortable" | "invalid-preferred" | "missing";
  } = {},
): MusicXmlImportDraft {
  let next = selectLeadCandidate(draft, draft.leadCandidates[0].key);
  if (options.chord !== false) {
    for (const part of next.parts) for (const measure of part.measures) {
      for (const chord of measure.chords) next = confirmChord(next, chord.key);
    }
  }
  if (options.section !== false) for (const section of next.sections) next = confirmSection(next, section.key);
  if (options.performer !== "missing") {
    const hard = options.performer === "invalid-comfortable"
      ? { low: { step: "C" as const, alter: 0 as const, octave: 4 }, high: { step: "C" as const, alter: 0 as const, octave: 5 } }
      : { low: { step: "C" as const, alter: 0 as const, octave: 3 }, high: { step: "C" as const, alter: 0 as const, octave: 6 } };
    const comfortable = options.performer === "invalid-comfortable"
      ? { low: { step: "C" as const, alter: 0 as const, octave: 3 }, high: { step: "C" as const, alter: 0 as const, octave: 6 } }
      : { low: { step: "G" as const, alter: 0 as const, octave: 3 }, high: { step: "G" as const, alter: 0 as const, octave: 5 } };
    const preferred = options.performer === "invalid-preferred"
      ? { low: { step: "C" as const, alter: 0 as const, octave: 3 }, high: { step: "C" as const, alter: 0 as const, octave: 6 } }
      : { low: { step: "C" as const, alter: 0 as const, octave: 4 }, high: { step: "C" as const, alter: 0 as const, octave: 5 } };
    next = setPerformerRange(next, 0, { displayName: "Lead", hardRange: hard, comfortableRange: comfortable, preferredTessitura: preferred });
  }
  if (options.rights !== false) next = confirmRights(next, { basis: "self-authored", allowedUses: ["generation"] });
  return next;
}

describe("Quick Review blocking completeness", () => {
  it("binds key/modulation analysis to the selected Lead part and preserves explicit override", async () => {
    const keyedPart = (id: string, name: string) =>
      `<score-part id="${id}"><part-name>${name}</part-name></score-part>`;
    const part = (id: string, fifths: number, step: "C" | "D") =>
      `<part id="${id}"><measure number="1"><attributes><divisions>1</divisions><key><fifths>${fifths}</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes><direction><sound tempo="100"/></direction><direction><direction-type><rehearsal>Verse</rehearsal></direction-type></direction><harmony><root><root-step>${step}</root-step></root><kind>major</kind></harmony><note><pitch><step>${step}</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><staff>1</staff></note></measure></part>`;
    const xml = `<score-partwise><part-list>${keyedPart("P1", "D lead")}${keyedPart("P2", "C lead")}</part-list>${part("P1", 2, "D")}${part("P2", 0, "C")}</score-partwise>`;
    const draft = await draftFrom(xml);
    const dLead = draft.leadCandidates.find((candidate) => candidate.partOrdinal === 0)!;
    const cLead = draft.leadCandidates.find((candidate) => candidate.partOrdinal === 1)!;

    const cPartKey = draft.parts.find((part) => part.partOrdinal === cLead.partOrdinal)?.measures[0]?.key;
    const dPartKey = draft.parts.find((part) => part.partOrdinal === dLead.partOrdinal)?.measures[0]?.key;
    expect(cPartKey).toBeDefined();
    expect(dPartKey).toBeDefined();
    const selectedC = selectLeadCandidate(draft, cLead.key);
    expect(selectedC.defaultKey).toEqual(cPartKey);
    expect((await deriveQuickReview(selectedC)).diagnostics.some((item) => item.code === "UNSUPPORTED_MODULATION")).toBe(false);

    const selectedD = selectLeadCandidate(selectedC, dLead.key);
    expect(selectedD.defaultKey).toEqual(dPartKey);
    const selectedCAgain = selectLeadCandidate(selectedD, cLead.key);
    expect(selectedCAgain.defaultKey).toEqual(selectedC.defaultKey);

    const overridden = setDefaultKey(selectedCAgain, { tonic: { step: "G", alter: 0 }, mode: "major" });
    expect(overridden.defaultKey).toEqual({ tonic: { step: "G", alter: 0 }, mode: "major" });
    expect(overridden.defaultKeyOverride).toEqual(overridden.defaultKey);
    const overriddenD = selectLeadCandidate(overridden, dLead.key);
    const overriddenCAgain = selectLeadCandidate(overriddenD, cLead.key);
    expect(overriddenD.defaultKey).toEqual({ tonic: { step: "G", alter: 0 }, mode: "major" });
    expect(overriddenCAgain.defaultKey).toEqual({ tonic: { step: "G", alter: 0 }, mode: "major" });
    const reset = clearDefaultKeyOverride(overriddenCAgain);
    expect(reset.defaultKeyOverride).toBeUndefined();
    expect(reset.defaultKey).toEqual(cPartKey);
  });

  it("does not apply a non-selected part's modulation diagnostic to the selected stable Lead", async () => {
    const partList = `<part-list><score-part id="P1"><part-name>Modulating</part-name></score-part><score-part id="P2"><part-name>Stable</part-name></score-part></part-list>`;
    const note = (step: "C" | "D") => `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><staff>1</staff></note>`;
    const modulating = `<part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes><direction><sound tempo="100"/></direction>${note("C")}</measure><measure number="2"><attributes><key><fifths>2</fifths><mode>major</mode></key></attributes>${note("D")}</measure></part>`;
    const stable = `<part id="P2"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes><direction><sound tempo="100"/></direction>${note("C")}</measure><measure number="2">${note("C")}</measure></part>`;
    const draft = await draftFrom(`<score-partwise>${partList}${modulating}${stable}</score-partwise>`);
    const stableLead = draft.leadCandidates.find((candidate) => candidate.partOrdinal === 1)!;
    const selectedPartKey = draft.parts.find((part) => part.partOrdinal === stableLead.partOrdinal)?.measures[0]?.key;
    expect(selectedPartKey).toBeDefined();
    const selected = selectLeadCandidate(draft, stableLead.key);
    expect(selected.defaultKey).toEqual(selectedPartKey);
    expect((await deriveQuickReview(selected)).diagnostics.some((item) => item.code === "UNSUPPORTED_MODULATION")).toBe(false);
  });

  it("reports no explicit lead selection", async () => {
    const review = await deriveQuickReview(await draftFrom());
    expect(review.state.readyForPlanning).toBe(false);
    expect(review.diagnostics.some((item) => item.details?.issue === "lead-selection")).toBe(true);
  });

  it("reports melody-bearing chord gaps", async () => {
    const noChord = await draftFrom(score(wholeNote).replace(/<harmony>[\s\S]*?<\/harmony>/u, ""));
    const review = await deriveQuickReview(selectAndConfirm(noChord));
    expect(review.state.readyForPlanning).toBe(false);
    expect(review.state.unresolvedChordGapDiagnosticIds.length).toBeGreaterThan(0);
  });

  it("reports unconfirmed chords and clears only after confirmation", async () => {
    const draft = await draftFrom();
    const unconfirmed = await deriveQuickReview(selectAndConfirm(draft, { chord: false }));
    const confirmed = await deriveQuickReview(selectAndConfirm(draft));
    expect(unconfirmed.state.unconfirmedChordEventIds).toHaveLength(1);
    expect(unconfirmed.state.readyForPlanning).toBe(false);
    expect(confirmed.state.unconfirmedChordEventIds).toHaveLength(0);
    expect(confirmed.state.readyForPlanning).toBe(true);
  });

  it("reports unresolved timeline from a failed chord parse", async () => {
    const draft = await draftFrom();
    const failed = replaceChord(draft, draft.parts[0].measures[0].chords[0].key, "H???");
    const review = await deriveQuickReview(selectAndConfirm(failed));
    expect(review.chordTimelineState.status).toBe("blocked");
    expect(review.diagnostics.some((item) => item.code === "SOURCE_CHORD_PARSE_FAILED")).toBe(true);
  });

  it("reports suggested sections and clears them after confirmation", async () => {
    const draft = await draftFrom();
    const suggested = await deriveQuickReview(selectAndConfirm(draft, { section: false }));
    const confirmed = await deriveQuickReview(selectAndConfirm(draft));
    expect(suggested.state.unconfirmedSectionDefinitionIds).toHaveLength(1);
    expect(suggested.state.readyForPlanning).toBe(false);
    expect(confirmed.state.unconfirmedSectionDefinitionIds).toHaveLength(0);
  });

  it.each([
    ["hard/comfortable", "invalid-comfortable" as const],
    ["preferred tessitura", "invalid-preferred" as const],
  ])("reports invalid performer %s", async (_name, performer) => {
    const review = await deriveQuickReview(selectAndConfirm(await draftFrom(), { performer }));
    expect(review.state.invalidPerformerIds).toEqual(["pf:0"]);
    expect(review.diagnostics.some((item) => item.code === "PERFORMER_RANGE_INVALID")).toBe(true);
    expect(review.state.readyForPlanning).toBe(false);
  });

  it("reports missing generation rights", async () => {
    const review = await deriveQuickReview(selectAndConfirm(await draftFrom(), { rights: false }));
    expect(review.state.missingRightsUses).toEqual(["generation"]);
    expect(review.diagnostics.some((item) => item.code === "RIGHTS_GENERATION_NOT_CONFIRMED")).toBe(true);
  });

  it("reports unsupported jump flow", async () => {
    const review = await deriveQuickReview(selectAndConfirm(await draftFrom(score(wholeNote, { flow: "Da Capo al Fine" }))));
    expect(review.state.unsupportedPerformanceFlowIds).toEqual(["flow:0"]);
    expect(review.state.readyForPlanning).toBe(false);
  });

  it("reports malformed canonical source after a draft timing forgery", async () => {
    const draft = await draftFrom();
    const forged: MusicXmlImportDraft = {
      ...draft,
      parts: draft.parts.map((part) => ({
        ...part,
        measures: part.measures.map((measure) => ({ ...measure, duration: fraction(1) })),
      })),
    };
    const review = await deriveQuickReview(selectAndConfirm(forged));
    expect(review.diagnostics.some((item) => item.code === "SOURCE_REVISION_INVALID")).toBe(true);
    expect(review.state.readyForPlanning).toBe(false);
  });

  it("reports mid-song modulation", async () => {
    const second = `<measure number="2"><attributes><key><fifths>1</fifths><mode>major</mode></key></attributes><harmony><root><root-step>G</root-step></root><kind>major</kind></harmony>${wholeNote}</measure>`;
    const review = await deriveQuickReview(selectAndConfirm(await draftFrom(score(wholeNote, { secondMeasure: second }))));
    expect(review.diagnostics.some((item) => item.code === "UNSUPPORTED_MODULATION")).toBe(true);
    expect(review.state.readyForPlanning).toBe(false);
  });

  it("reports planning-unsupported meter/grouping", async () => {
    const threeNotes = Array.from({ length: 3 }, () => "<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>").join("");
    const time = "<time><beats>3</beats><beat-type>4</beat-type></time>";
    const review = await deriveQuickReview(selectAndConfirm(await draftFrom(score(threeNotes, { time }))));
    expect(review.diagnostics.some((item) => item.code === "UNSUPPORTED_METER")).toBe(true);
    expect(review.state.readyForPlanning).toBe(false);
  });

  it("does not silently accept an unsupported third ending", async () => {
    const ending = `<barline location="left"><ending number="3" type="start"/></barline>${wholeNote}<barline location="right"><ending number="3" type="stop"/></barline>`;
    const review = await deriveQuickReview(selectAndConfirm(await draftFrom(score(ending))));
    expect(review.diagnostics.some((item) => item.code === "PERFORMANCE_EXPANSION_FAILED")).toBe(true);
    expect(review.state.readyForPlanning).toBe(false);
  });

  it("delegates nested repeat rejection to the authoritative expander", async () => {
    const repeatedNote = `<harmony><root><root-step>G</root-step></root><kind>major</kind></harmony>${wholeNote}`;
    const second = `<measure number="2"><barline location="left"><repeat direction="forward"/></barline>${repeatedNote}<barline location="right"><repeat direction="backward"/></barline></measure>`;
    const firstWithRepeat = score(wholeNote, { secondMeasure: second }).replace(
      "<harmony>",
      '<barline location="left"><repeat direction="forward"/></barline><harmony>',
    );
    const review = await deriveQuickReview(selectAndConfirm(await draftFrom(firstWithRepeat)));
    expect(review.diagnostics.some((item) => item.code === "PERFORMANCE_REPEAT_NESTED")).toBe(true);
    expect(review.state.readyForPlanning).toBe(false);
  });

  it("reports and resolves lyric verse ambiguity", async () => {
    const lyrics = "<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><staff>1</staff><lyric number=\"1\"><text>one</text></lyric><lyric number=\"2\"><text>two</text></lyric></note>";
    const draft = selectAndConfirm(await draftFrom(score(lyrics)));
    expect((await deriveQuickReview(draft)).diagnostics.some((item) => item.details?.issue === "lyric-verse-ambiguity")).toBe(true);
    const occurrence = draft.sectionOccurrences.find((item) => item.candidateKey === draft.selectedLeadStaffKey);
    expect(occurrence).toBeDefined();
    if (!occurrence) return;
    expect((await deriveQuickReview(setSectionOccurrenceLyricVerse(draft, occurrence.key, 2))).state.readyForPlanning).toBe(true);
  });

  it("reports tie mismatch on the selected voice", async () => {
    const tied = "<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><staff>1</staff><tie type=\"start\"/></note>";
    const second = `<measure number="2"><harmony><root><root-step>G</root-step></root><kind>major</kind></harmony><note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><staff>1</staff><tie type="stop"/></note></measure>`;
    const review = await deriveQuickReview(selectAndConfirm(await draftFrom(score(tied, { secondMeasure: second }))));
    expect(review.diagnostics.some((item) => item.code === "INPUT_INVALID_TIE")).toBe(true);
    expect(review.state.readyForPlanning).toBe(false);
  });

  it("never omits a blocking issue from blockingDiagnosticIds", async () => {
    const review = await deriveQuickReview(await draftFrom());
    const expected = review.diagnostics.filter((item) => item.severity === "blocking").map((item) => item.id);
    expect(review.state.blockingDiagnosticIds).toEqual(expected);
    expect(review.state.blockingDiagnosticIds.length).toBeGreaterThan(0);
  });
});

describe("exact MusicXML cursor and selected-lead validation", () => {
  it("uses exact divisions across a mid-measure divisions change", async () => {
    const xml = `<score-partwise><part-list><score-part id="P1"><part-name>Lead</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>2</divisions><key><fifths>0</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes><direction><sound tempo="100"/></direction><direction><direction-type><rehearsal>Verse</rehearsal></direction-type></direction><harmony><root><root-step>C</root-step></root><kind>major</kind></harmony><note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><staff>1</staff></note><attributes><divisions>4</divisions></attributes><note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><staff>1</staff></note></measure></part></score-partwise>`;
    const draft = await draftFrom(xml);
    const events = draft.parts[0].measures[0].leadEvents;
    expect(events.map((event) => event.onset)).toEqual([fraction(0), fraction(1)]);
    expect(events.map((event) => event.duration)).toEqual([fraction(1), fraction(1)]);
  });

  it("keeps backup/forward voice cursors isolated by candidate", async () => {
    const body = `<note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><staff>1</staff></note><forward><duration>2</duration></forward><backup><duration>4</duration></backup><forward><duration>1</duration></forward><note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><voice>2</voice><staff>1</staff></note><forward><duration>2</duration></forward>`;
    const draft = await draftFrom(score(body));
    expect(draft.leadCandidates).toHaveLength(2);
    const voiceTwo = draft.leadCandidates.find((candidate) => candidate.voiceKey === "2");
    const event = draft.parts[0].measures[0].leadEvents.find((item) => item.candidateKey === voiceTwo?.key);
    expect(event?.onset).toEqual(fraction(1));
  });

  it("blocks negative and overflowing cursors", async () => {
    const negative = await importMusicXml(encoder.encode(score("<backup><duration>1</duration></backup>")), {
      algorithmVersions: TEST_ALGORITHM_VERSIONS,
      identityFactory,
    });
    const overflow = await importMusicXml(encoder.encode(score(`${wholeNote}<forward><duration>1</duration></forward>`)), {
      algorithmVersions: TEST_ALGORITHM_VERSIONS,
      identityFactory,
    });
    expect(negative.status).toBe("blocked");
    expect(overflow.status).toBe("blocked");
  });

  it("blocks selected same-voice chord overlap", async () => {
    const polyphonic = `<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><staff>1</staff></note><note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><staff>1</staff></note>`;
    const review = await deriveQuickReview(selectAndConfirm(await draftFrom(score(polyphonic))));
    expect(review.diagnostics.some((item) => item.code === "INPUT_EVENT_OVERLAP")).toBe(true);
  });
});
