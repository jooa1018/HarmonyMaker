import { parseChord } from "../../domain/chord/parser";
import { fraction } from "../../domain/fraction";
import { pitchRange, type SpelledPitch, type Step, type Alter } from "../../domain/pitch";
import type { ResearchActivitySchedule, ResearchChordSpan, ResearchFixture, ResearchNoteEvent } from "./types";

type NoteSeed = readonly [step: Step, alter: Alter, octave: number, onsetQ: number, durationQ: number, syllable: string];
type ChordSeed = readonly [sourceText: string, onsetQ: number, durationQ: number];

const p = (step: Step, octave: number, alter: Alter = 0): SpelledPitch => ({ step, alter, octave });

function leadEvents(fixtureId: string, seeds: readonly NoteSeed[]): readonly ResearchNoteEvent[] {
  return seeds.map(([step, alter, octave, onsetQ, durationQ, syllable], index) => ({
    id: `${fixtureId}:lead:${index}`,
    onsetQ: fraction(onsetQ),
    durationQ: fraction(durationQ),
    pitch: p(step, octave, alter),
    syllableId: `${fixtureId}:syllable:${index}`,
    lyric: syllable,
    lyricOnset: true,
    attack: true,
    provenance: "SOURCE_LEAD",
  }));
}

function chordSpans(fixtureId: string, seeds: readonly ChordSeed[]): readonly ResearchChordSpan[] {
  return seeds.map(([sourceText, onsetQ, durationQ], index) => {
    const parsed = parseChord(sourceText);
    if (parsed.status !== "ok") throw new Error(`Fixture chord failed to parse: ${sourceText}`);
    return {
      id: `${fixtureId}:chord:${index}`,
      onsetQ: fraction(onsetQ),
      durationQ: fraction(durationQ),
      sourceText,
      chord: parsed.chord,
    };
  });
}

function fixture(
  id: string,
  title: string,
  placement: "upper" | "lower",
  notes: readonly NoteSeed[],
  chords: readonly ChordSeed[],
  tags: readonly string[],
  options: { readonly seedHarmonyPitch?: SpelledPitch; readonly hardLow?: SpelledPitch; readonly hardHigh?: SpelledPitch } = {},
): ResearchFixture {
  const upper = placement === "upper";
  const hardLow = options.hardLow ?? (upper ? p("C", 4) : p("G", 2));
  const hardHigh = options.hardHigh ?? (upper ? p("G", 5) : p("D", 4));
  const comfortableLow = upper ? p("E", 4) : p("B", 2);
  const comfortableHigh = upper ? p("E", 5) : p("B", 3);
  const lead = leadEvents(id, notes);
  const parsedChords = chordSpans(id, chords);
  const rawBoundaries = [
    ...notes.flatMap((note) => [note[3], note[3] + note[4]]),
    ...chords.flatMap((chord) => [chord[1], chord[1] + chord[2]]),
  ];
  const boundaries = [...new Set(rawBoundaries)].sort((left, right) => left - right);
  const matchedActivitySchedule: ResearchActivitySchedule = {
    id: `${id}:activity:matched-v0`,
    policy: "EXPLICIT_MATCHED_V0",
    slots: boundaries.slice(0, -1).flatMap((onsetQ, index) => {
      const endQ = boundaries[index + 1];
      const leadPresent = notes.some((note) => note[3] <= onsetQ && onsetQ < note[3] + note[4]);
      const chordPresent = chords.some((chord) => chord[1] <= onsetQ && onsetQ < chord[1] + chord[2]);
      return leadPresent && chordPresent ? [{
        id: `${id}:activity:slot:${index}`,
        onsetQ: fraction(onsetQ),
        durationQ: fraction(endQ - onsetQ),
        allowHarmony: true,
        allowRest: true,
        source: "EXPLICIT_MATCHED" as const,
      }] : [];
    }),
  };
  return {
    id,
    title,
    authorshipKind: "PROJECT_ORIGINAL",
    rightsNote: "Original synthetic research phrase created for HarmonyMaker; no user score, recording, melody, lyric, or arrangement was transcribed.",
    acceptanceEligibility: tags.includes("negative-control") ? "ENGINEERING_ONLY" : "DEVELOPMENT_LISTENING",
    placement,
    performer: {
      id: `${id}:performer`,
      displayName: upper ? "Original Upper Fixture Singer" : "Original Lower Fixture Singer",
      hardRange: pitchRange(hardLow, hardHigh),
      comfortableRange: pitchRange(comfortableLow, comfortableHigh),
      preferredTessitura: pitchRange(upper ? p("G", 4) : p("D", 3), upper ? p("D", 5) : p("A", 3)),
    },
    preferredLeapSemitones: 5,
    hardLeapSemitones: 12,
    ...(options.seedHarmonyPitch ? { seedHarmonyPitch: options.seedHarmonyPitch } : {}),
    matchedActivitySchedule,
    lead,
    chords: parsedChords,
    tags,
  };
}

const stepwise: readonly NoteSeed[] = [
  ["C", 0, 4, 0, 1, "lu"], ["D", 0, 4, 1, 1, "mi"], ["E", 0, 4, 2, 1, "na"], ["G", 0, 4, 3, 1, "re"],
];

export const RIGHTS_SAFE_FIXTURES: readonly ResearchFixture[] = [
  fixture("hm-original-major-stepwise-v0", "Lantern Steps", "upper", stepwise, [["C", 0, 2], ["F", 2, 2]], ["major", "stepwise"]),
  fixture("hm-original-minor-phrase-v0", "Quiet Current", "lower", [["A",0,4,0,1,"so"],["C",0,5,1,1,"la"],["B",0,4,2,1,"ri"],["A",0,4,3,1,"um"]], [["Am",0,2],["Em7",2,2]], ["minor"]),
  fixture("hm-original-slash-chord-v0", "Bass Lantern", "upper", stepwise, [["C/E",0,2],["F/A",2,2]], ["slash-chord"]),
  fixture("hm-original-sus-omission-v0", "Open Rail", "lower", [["G",0,4,0,1,"o"],["A",0,4,1,1,"pen"],["D",0,5,2,2,"way"]], [["Csus2",0,2],["Gsus4",2,2]], ["sus", "omission"]),
  fixture("hm-original-add9-v0", "Ninth Window", "upper", stepwise, [["Cadd9",0,2],["Fadd9",2,2]], ["explicit-extension", "add9"]),
  fixture("hm-original-lead-nct-passing-v0", "Passing Spark", "upper", [["C",0,4,0,1,"pa"],["D",0,4,1,1,"ss"],["E",0,4,2,1,"ing"],["F",0,4,3,1,"on"]], [["C",0,4]], ["lead-nct", "passing-tone"]),
  fixture("hm-original-held-common-tone-v0", "Held Thread", "upper", [["G",0,4,0,4,"ah"]], [["C",0,2],["Em",2,2]], ["held-lead", "common-tone"]),
  fixture("hm-original-held-no-common-upper-v0", "Turning Vowel Above", "upper", [["C",0,4,0,4,"oo"]], [["C",0,2],["Dm",2,2]], ["held-lead", "chord-boundary", "upper"], { seedHarmonyPitch: p("E",4) }),
  fixture("hm-original-held-no-common-lower-v0", "Turning Vowel Below", "lower", [["E",0,4,0,4,"ah"]], [["C",0,2],["Dm",2,2]], ["held-lead", "chord-boundary", "lower"], { seedHarmonyPitch: p("C",4) }),
  fixture("hm-original-upper-range-v0", "Upper Gate", "upper", [["D",0,5,0,1,"up"],["E",0,5,1,1,"per"],["F",0,5,2,2,"air"]], [["G7",0,2],["C",2,2]], ["upper", "range"]),
  fixture("hm-original-lower-range-v0", "Lower Gate", "lower", [["A",0,3,0,1,"low"],["G",0,3,1,1,"er"],["E",0,3,2,2,"ground"]], [["Am",0,2],["C",2,2]], ["lower", "range"]),
  fixture("hm-original-hard-range-edge-v0", "Range Edge", "upper", [["B",0,4,0,2,"edge"],["C",0,5,2,2,"line"]], [["G7",0,2],["C",2,2]], ["hard-range", "candidate-pruning"], { hardHigh: p("E",5) }),
  fixture("hm-original-lead-only-negative-v0", "Single Line Control", "upper", stepwise, [["C",0,4]], ["negative-control", "lead-only"]),
] as const;

export const RIGHTS_SAFE_FIXTURE_MANIFEST = RIGHTS_SAFE_FIXTURES.map(({ id, title, authorshipKind, rightsNote, acceptanceEligibility, placement, tags }) => ({
  id, title, authorshipKind, rightsNote, acceptanceEligibility, placement, tags,
}));

export function fixtureById(id: string): ResearchFixture {
  const found = RIGHTS_SAFE_FIXTURES.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`UNKNOWN_RESEARCH_FIXTURE:${id}`);
  return found;
}
