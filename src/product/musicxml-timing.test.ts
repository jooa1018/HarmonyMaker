import { describe, expect, it } from "vitest";
import { parseChord } from "../domain/chord/parser";
import type { SemanticDigest } from "../domain/digest/canonical";
import { fraction } from "../domain/fraction";
import type { ArrangementRenderDocument } from "../domain/generation/model";
import { COMMON_TIME, COMPOUND_DUPLE, type TimeSignature } from "../domain/meter";
import type { TempoSpec } from "../domain/source/model";
import { musicalRange } from "../domain/time";
import { importMusicXml } from "../import/musicxml/parser";
import { confirmChord, confirmRights, confirmSection, deriveQuickReview, selectLeadCandidate, setPerformerRange } from "../import";
import { MemoryLocalProjectStore } from "./local-project-store";
import { exportArrangementMusicXml } from "./musicxml-export";
import { buildPlaybackPlan } from "./playback-plan";
import { arrangementRenderDocumentToAbc, arrangementRenderDocumentToAbcSafely, encodeAbcFreeText } from "./score-adapter";
import { createProjectFromQuickReview } from "./workspace";

const digest = "0".repeat(64) as SemanticDigest;
const roles = { generatedTracks: [], byTrackPlanId: {} } as const;
const versions = {
  performanceExpanderVersion: "repeat-v1",
  chordTimelineResolverVersion: "chord-timeline-v1",
  sourceLeadAtomizerVersion: "source-lead-atomizer-v1",
} as const;

interface MeasureSpec {
  readonly time: TimeSignature;
  readonly duration: number;
}

function renderDocument(specs: readonly MeasureSpec[]): ArrangementRenderDocument {
  const chord = parseChord("C");
  if (chord.status !== "ok") throw new Error("timing chord fixture failed");
  const measures = specs.map((spec, index) => ({
    occurrenceId: `pm:${index}:${index}:0`,
    sourceMeasureId: `sm:${index}`,
    sourceMeasureNumber: index + 1,
    occurrenceIndexForSource: 0,
    performanceIndex: index,
    time: spec.time,
    duration: fraction(spec.duration),
  }));
  const atoms = specs.map((spec, index) => ({
    id: `ta:${index}`,
    sourceEventId: `le:${index}`,
    range: musicalRange(
      { performanceMeasureIndex: index, offset: fraction(0) },
      { performanceMeasureIndex: index + 1, offset: fraction(0) },
      specs.map((item) => fraction(item.duration)),
    ),
    pitch: { step: index % 2 === 0 ? "C" as const : "D" as const, alter: 0 as const, octave: 4 },
    tiedFromPrevious: false,
    tiedToNext: false,
    lyricTokenIds: [],
  }));
  return {
    measures,
    sourceLeadTrack: { trackPlanId: "track:source-lead", atomizationDigest: digest, atoms },
    generatedHarmonyTracks: [],
    effectiveChordTimeline: {
      sourceChordProjectionDigest: digest,
      performanceSequenceDigest: digest,
      resolutionPolicy: { gapPolicy: "carry-until-next" },
      chordTimelineResolverVersion: "chord-timeline-v1",
      spans: [{
        id: "pcs:timing:0",
        range: musicalRange(
          { performanceMeasureIndex: 0, offset: fraction(0) },
          { performanceMeasureIndex: specs.length, offset: fraction(0) },
          specs.map((item) => fraction(item.duration)),
        ),
        parseResult: chord,
        origin: { kind: "source-event", sourceChordEventId: "ch:timing:0" },
      }],
      digest,
    },
    lyricTokens: [],
  };
}

function fullDuration(time: TimeSignature): number {
  return time.numerator * 4 / time.denominator;
}

async function exportAndReimport(specs: readonly MeasureSpec[], tempo: TempoSpec = { beatUnit: 4, dotted: false, bpm: 96 }) {
  const document = renderDocument(specs);
  const encoded = exportArrangementMusicXml(document, roles, {
    title: "Timing",
    key: { tonic: { step: "C", alter: 0 }, mode: "major" },
    tempo,
  });
  const imported = await importMusicXml(new TextEncoder().encode(encoded), {
    algorithmVersions: versions,
    identityFactory: () => "doc:timing-roundtrip",
  });
  expect(imported.status).toBe("review-required");
  if (imported.status !== "review-required") throw new Error("timing import blocked");
  return { document, encoded, draft: imported.draft };
}

describe("MusicXML timing authority round-trip campaign", () => {
  it.each([
    ["uniform 4/4", [{ time: COMMON_TIME, duration: 4 }, { time: COMMON_TIME, duration: 4 }]],
    ["one-quarter pickup", [{ time: COMMON_TIME, duration: 1 }, { time: COMMON_TIME, duration: 4 }]],
    ["incomplete final", [{ time: COMMON_TIME, duration: 4 }, { time: COMMON_TIME, duration: 3 }]],
    ["4/4 to 6/8", [{ time: COMMON_TIME, duration: 4 }, { time: COMPOUND_DUPLE, duration: 3 }]],
    ["6/8 to 4/4", [{ time: COMPOUND_DUPLE, duration: 3 }, { time: COMMON_TIME, duration: 4 }]],
    ["multiple transitions", [
      { time: COMMON_TIME, duration: 4 },
      { time: COMPOUND_DUPLE, duration: 3 },
      { time: COMMON_TIME, duration: 4 },
      { time: COMPOUND_DUPLE, duration: 3 },
    ]],
  ] as const)("preserves %s measure meter, duration, implicit authority, playback, and ABC boundaries", async (_caseName, specs) => {
    const { document, encoded, draft } = await exportAndReimport(specs);
    const importedMeasures = draft.parts[0].measures;
    expect(importedMeasures.map((measure) => measure.time)).toEqual(specs.map((spec) => spec.time));
    expect(importedMeasures.map((measure) => measure.duration)).toEqual(specs.map((spec) => fraction(spec.duration)));
    expect(importedMeasures.map((measure) => measure.implicit)).toEqual(
      specs.map((spec) => spec.duration !== fullDuration(spec.time)),
    );

    const expectedTimeElementCount = specs.filter((spec, index) => index === 0
      || spec.time.numerator !== specs[index - 1].time.numerator
      || spec.time.denominator !== specs[index - 1].time.denominator).length;
    expect(encoded.match(/<time>/gu) ?? []).toHaveLength(expectedTimeElementCount);

    const playback = buildPlaybackPlan(document, roles);
    expect(playback.totalQuarter).toBe(specs.reduce((sum, spec) => sum + spec.duration, 0));
    expect(playback.events.map((event) => event.durationQuarter)).toEqual(specs.map((spec) => spec.duration));

    const abc = arrangementRenderDocumentToAbc(document, roles, {
      title: "Timing",
      key: { tonic: { step: "C", alter: 0 }, mode: "major" },
      tempo: { beatUnit: 4, dotted: false, bpm: 96 },
    });
    const transitions = specs.slice(1).filter((spec, index) =>
      spec.time.numerator !== specs[index].time.numerator
      || spec.time.denominator !== specs[index].time.denominator);
    for (const transition of transitions) {
      expect(abc).toContain(`[M:${transition.time.numerator}/${transition.time.denominator}]`);
    }
    if (specs[0].duration === 1) expect(abc).not.toContain("=C z3 |");
  });

  it("preserves exact dotted-eighth tempo authority", async () => {
    const tempo = { beatUnit: 8 as const, dotted: true, bpm: 72 };
    const { encoded, draft } = await exportAndReimport([{ time: COMPOUND_DUPLE, duration: 3 }], tempo);
    expect(encoded).toContain("<beat-unit>eighth</beat-unit><beat-unit-dot/><per-minute>72</per-minute>");
    expect(draft.defaultTempo).toEqual(tempo);
  });

  it("hands mixed-meter timing through Quick Review into an exact durable project reload", async () => {
    const specs = [
      { time: COMMON_TIME, duration: 1 },
      { time: COMMON_TIME, duration: 4 },
      { time: COMPOUND_DUPLE, duration: 3 },
      { time: COMMON_TIME, duration: 2 },
    ];
    const { draft } = await exportAndReimport(specs);
    let reviewed = selectLeadCandidate(draft, draft.leadCandidates[0].key);
    for (const part of reviewed.parts) for (const measure of part.measures) {
      for (const chord of measure.chords) reviewed = confirmChord(reviewed, chord.key);
    }
    for (const section of reviewed.sections) reviewed = confirmSection(reviewed, section.key);
    reviewed = setPerformerRange(reviewed, 0, {
      displayName: "Lead",
      hardRange: { low: { step: "C", alter: 0, octave: 3 }, high: { step: "C", alter: 0, octave: 6 } },
      comfortableRange: { low: { step: "G", alter: 0, octave: 3 }, high: { step: "G", alter: 0, octave: 5 } },
      preferredTessitura: { low: { step: "C", alter: 0, octave: 4 }, high: { step: "C", alter: 0, octave: 5 } },
    });
    reviewed = confirmRights(reviewed, { basis: "self-authored", allowedUses: ["generation"] });
    const analysis = await deriveQuickReview(reviewed, versions);
    expect(analysis.state.readyForPlanning).toBe(true);
    const project = await createProjectFromQuickReview(reviewed, analysis);
    const store = new MemoryLocalProjectStore();
    await store.save({ projectId: "timing-project", updatedAt: "2026-08-19T00:00:00.000Z", project });
    const reloaded = await store.load("timing-project");
    expect(reloaded?.project.source.sourceMeasures.map((measure) => measure.time)).toEqual(specs.map((spec) => spec.time));
    expect(reloaded?.project.source.sourceMeasures.map((measure) => measure.duration)).toEqual(specs.map((spec) => fraction(spec.duration)));
    expect(reloaded?.project.source.sourceMeasures.map((measure) => measure.implicit)).toEqual([true, false, false, true]);
  });
});

describe("ABC free-text serialization boundary", () => {
  it.each([
    "line\rbreak",
    "line\nbreak",
    "line\r\nbreak",
    "line\u2028break",
    "line\u2029break",
    "control\u0000\u001f\u007fbreak",
    "back\\slash",
    "quoted \"V:evil\" metadata",
    "e\u0301\nM:9/8",
  ])("cannot create an ABC structural line from %j", (value) => {
    const encoded = encodeAbcFreeText(value);
    expect(encoded).not.toMatch(/[\r\n\u2028\u2029\u0000-\u001f\u007f-\u009f\\]/u);
    expect(encoded).not.toContain('"');
    expect(encoded).toBe(encoded.normalize("NFC"));
  });

  it("encodes title metadata at the format boundary without mutating the input", () => {
    const title = "Original\r\nM:9/8\\\"";
    const document = renderDocument([{ time: COMMON_TIME, duration: 4 }]);
    const abc = arrangementRenderDocumentToAbc(document, roles, {
      title,
      key: { tonic: { step: "C", alter: 0 }, mode: "major" },
      tempo: { beatUnit: 4, dotted: false, bpm: 96 },
    });
    expect(title).toBe("Original\r\nM:9/8\\\"");
    expect(abc.split("\n").filter((line) => line.startsWith("M:"))).toEqual(["M:4/4"]);
    expect(abc).toContain("T:Original M:9/8/'");
  });

  it("turns an out-of-bound pitch into a controlled ABC unavailable outcome", () => {
    const document = renderDocument([{ time: COMMON_TIME, duration: 4 }]);
    const invalid = {
      ...document,
      sourceLeadTrack: {
        ...document.sourceLeadTrack,
        atoms: document.sourceLeadTrack.atoms.map((atom) => ({ ...atom, pitch: { ...atom.pitch!, octave: Number.MAX_SAFE_INTEGER } })),
      },
    } as ArrangementRenderDocument;
    expect(arrangementRenderDocumentToAbcSafely(invalid, roles, {
      title: "Unavailable",
      key: { tonic: { step: "C", alter: 0 }, mode: "major" },
      tempo: { beatUnit: 4, dotted: false, bpm: 96 },
    })).toEqual({ status: "unavailable", code: "ABC_SERIALIZATION_UNAVAILABLE" });
  });
});
