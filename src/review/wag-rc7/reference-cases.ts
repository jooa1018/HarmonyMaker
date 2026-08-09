import { fraction } from "../../domain/fraction";
import { pitchRange, type KeySignature, type SpelledPitch } from "../../domain/pitch";
import { tempoSpec } from "../../domain/source/model";
import type { Rc7PerformerEntry, Rc7ReferenceCaseDefinition } from "./types";

const C_MAJOR: KeySignature = { tonic: { step: "C", alter: 0 }, mode: "major" };

function pitch(step: SpelledPitch["step"], octave: number, alter: SpelledPitch["alter"] = 0): SpelledPitch {
  return { step, alter, octave };
}

function q(n: number, d = 1) {
  return fraction(n, d);
}

function defaultNotes(duration = 8) {
  const values = [pitch("C", 4), pitch("E", 4), pitch("G", 4), pitch("E", 4), pitch("F", 4), pitch("A", 4), pitch("G", 4), pitch("E", 4)];
  return Array.from({ length: Math.min(duration, values.length) }, (_, index) => ({
    startQ: q(index),
    durationQ: q(1),
    pitch: values[index],
    lyric: `la-${index + 1}`,
    emphasis: "none" as const,
  }));
}

function performerEntries(stressedSecond = false): readonly Rc7PerformerEntry[] {
  return [
    {
      performerOrdinal: 0,
      profile: {
        id: "performer:lead",
        displayName: "Lead",
        hardRange: pitchRange(pitch("C", 3), pitch("C", 6)),
        comfortableRange: pitchRange(pitch("G", 3), pitch("G", 5)),
        preferredTessitura: pitchRange(pitch("C", 4), pitch("C", 5)),
      },
    },
    {
      performerOrdinal: 1,
      profile: {
        id: "performer:h1",
        displayName: "Harmony 1",
        hardRange: pitchRange(pitch("E", 3), pitch("E", 6)),
        comfortableRange: pitchRange(pitch("G", 3), pitch("C", 6)),
        preferredTessitura: pitchRange(pitch("C", 4), pitch("G", 5)),
      },
    },
    {
      performerOrdinal: 2,
      profile: {
        id: "performer:h2",
        displayName: "Harmony 2",
        hardRange: pitchRange(pitch("C", 3), pitch("C", 6)),
        comfortableRange: pitchRange(pitch("C", 3), pitch("G", 5)),
        preferredTessitura: stressedSecond
          ? pitchRange(pitch("F", 5), pitch("G", 5))
          : pitchRange(pitch("E", 3), pitch("C", 5)),
      },
    },
  ];
}

const tempo = tempoSpec(4, false, 92);

const sparseVerse: Rc7ReferenceCaseDefinition = {
  caseId: "A-SPARSE-BASE-VERSE",
  title: "A · Sparse base Verse",
  description: "No direct lift cue; lead-only UNISON remains the canonical winner.",
  meterFamily: "simple-quadruple",
  phraseStartQ: q(4),
  phraseDurationQ: q(8),
  sectionType: "verse",
  sectionVariant: "base",
  presetId: "simple",
  key: C_MAJOR,
  tempo,
  notes: defaultNotes(5),
  chords: [{ startQ: q(0), symbol: "C" }, { startQ: q(4), symbol: "D" }],
  maxHarmonyTracks: 2,
  expectedTexture: "UNISON",
  fixtureTags: ["lead-only", "negative-control"],
};

const activeUnison: Rc7ReferenceCaseDefinition = {
  ...sparseVerse,
  phraseStartQ: undefined,
  caseId: "B-CUE-ACTIVE-UNISON",
  title: "B · Cue-qualified active UNISON",
  description: "A late long Lead note opens one bounded absolute-unison response.",
  presetId: "standard",
  notes: [
    ...defaultNotes(6),
    { startQ: q(6), durationQ: q(2), pitch: pitch("G", 4), lyric: "hold", emphasis: "none" },
  ],
  expectedTexture: "UNISON",
  fixtureTags: ["active-unison", "late-long-note"],
};

const standardTpp: Rc7ReferenceCaseDefinition = {
  ...sparseVerse,
  phraseStartQ: undefined,
  caseId: "C-STANDARD-CHORUS-BOUNDED-TPP",
  title: "C · Standard Chorus bounded TPP",
  description: "Eight Lead attacks produce the canonical four-attack bounded response.",
  sectionType: "chorus",
  presetId: "standard",
  notes: Array.from({ length: 8 }, (_, index) => ({
    startQ: q(index, 2),
    durationQ: q(1, 2),
    pitch: [pitch("C", 4), pitch("E", 4), pitch("G", 4), pitch("E", 4),
      pitch("F", 4), pitch("A", 4), pitch("G", 4), pitch("E", 4)][index],
    lyric: `bounded-${index + 1}`,
    emphasis: "none" as const,
  })),
  expectedTexture: "TWO_PART_PARALLEL",
  fixtureTags: ["bounded-tpp", "eight-attacks"],
};

const busyNotes = Array.from({ length: 6 }, (_, index) => ({
  startQ: q(index, 3),
  durationQ: q(1, 3),
  pitch: [pitch("C", 4), pitch("D", 4), pitch("E", 4), pitch("G", 4), pitch("A", 4), pitch("G", 4)][index],
  lyric: `busy-${index + 1}`,
  emphasis: index === 1 || index === 5 ? "confirmed" as const : "none" as const,
}));

const busyAccent: Rc7ReferenceCaseDefinition = {
  ...standardTpp,
  caseId: "D-BUSY-CHORUS-ACCENT",
  title: "D · Busy Chorus ACCENT_BLOCK",
  description: "Only confirmed short emphasis attacks are harmonized.",
  phraseStartQ: q(4),
  phraseDurationQ: q(2),
  notes: busyNotes,
  chords: [{ startQ: q(0), symbol: "C" }, { startQ: q(1), symbol: "D" }],
  expectedTexture: "ACCENT_BLOCK",
  fixtureTags: ["accent", "busy-lead"],
};

const lateSplit: Rc7ReferenceCaseDefinition = {
  ...standardTpp,
  caseId: "E-LATE-LONG-U2S",
  title: "E · Late-long-note UNISON_TO_SPLIT",
  description: "A deterministic late split enters on a three-quarter phrase tail.",
  notes: [
    ...defaultNotes(5),
    { startQ: q(5), durationQ: q(3), pitch: pitch("A", 4), lyric: "amen", emphasis: "none" },
  ],
  expectedTexture: "UNISON_TO_SPLIT",
  fixtureTags: ["u2s", "late-long-note"],
};

const sustainedPad: Rc7ReferenceCaseDefinition = {
  ...standardTpp,
  caseId: "F-SUSTAINED-PAD",
  title: "F · SUSTAINED_PAD",
  description: "A qualified section entry sustains the longest legal common tone.",
  sectionType: "ending",
  notes: [
    { startQ: q(0), durationQ: q(1), pitch: pitch("C", 5), lyric: "we", emphasis: "none" },
    { startQ: q(2), durationQ: q(1), pitch: pitch("B", 4), lyric: "sing", emphasis: "none" },
    { startQ: q(4), durationQ: q(1), pitch: pitch("A", 4), lyric: "a", emphasis: "none" },
    { startQ: q(6), durationQ: q(1), pitch: pitch("G", 4), lyric: "men", emphasis: "none" },
  ],
  chords: [{ startQ: q(0), symbol: "C" }],
  expectedTexture: "SUSTAINED_PAD",
  fixtureTags: ["pad", "common-tone"],
};

const suspension: Rc7ReferenceCaseDefinition = {
  ...standardTpp,
  caseId: "G-SUSPENSION-RELEASE",
  title: "G · SUSPENSION_RELEASE",
  description: "A late compound chord cue realizes preparation, hold, and bounded resolution.",
  sectionType: "tag",
  notes: [
    { startQ: q(0), durationQ: q(1), pitch: pitch("C", 5), lyric: "prepare", emphasis: "none" },
    { startQ: q(7), durationQ: q(1), pitch: pitch("G", 4), lyric: "release", emphasis: "none" },
  ],
  chords: [
    { startQ: q(0), symbol: "N.C." },
    { startQ: q(4), symbol: "C" },
    { startQ: q(7), symbol: "G7" },
  ],
  expectedTexture: "SUSPENSION_RELEASE",
  fixtureTags: ["suspension", "lead-rest-reentry", "compound-late-chord"],
};

function selectiveThirdVoice(caseId: string, title: string, stressedSecond: boolean, presetId: "standard" | "full"): Rc7ReferenceCaseDefinition {
  return {
    ...standardTpp,
    caseId,
    title,
    description: stressedSecond
      ? "The three-pitch sibling is eligible, but preferred-tessitura stress makes two pitches win."
      : "A missing identity-critical role makes the three-pitch sibling win.",
    phraseDurationQ: q(4),
    presetId,
    notes: [
      { startQ: q(0), durationQ: q(1), pitch: pitch("C", 4), lyric: "all", emphasis: "none" },
      { startQ: q(1), durationQ: q(1), pitch: pitch("E", 4), lyric: "the", emphasis: "none" },
      { startQ: q(2), durationQ: q(2), pitch: pitch("G", 4), lyric: "glory", emphasis: "confirmed" },
    ],
    chords: [{ startQ: q(0), symbol: "C" }],
    performerEntries: performerEntries(stressedSecond),
    expectedTexture: "UNISON_TO_SPLIT",
    fixtureTags: [stressedSecond ? "third-voice-loss" : "third-voice-win", "selective-third-voice"],
  };
}

const thirdPositive = selectiveThirdVoice(
  "H-STANDARD-THIRD-POSITIVE",
  "H · Standard selective 3-pitch positive",
  false,
  "standard",
);

const thirdNegative = selectiveThirdVoice(
  "I-STANDARD-THIRD-NEGATIVE",
  "I · Standard selective 3-pitch negative",
  true,
  "standard",
);

const noCueThird: Rc7ReferenceCaseDefinition = {
  ...standardTpp,
  caseId: "J-NO-CUE-THIRD-NEGATIVE",
  title: "J · No-cue third-track negative",
  description: "A D3 target never creates a second harmony track without a direct value-gate cue.",
  fixtureTags: ["third-voice-ineligible", "no-direct-cue"],
};

const fullExpansion = selectiveThirdVoice(
  "K-FULL-SELECTIVE-EXPANSION",
  "K · Full selective expansion",
  false,
  "full",
);

const fullExpansionWithExpectedTexture: Rc7ReferenceCaseDefinition = {
  ...fullExpansion,
  description: "Full opens a cue-qualified three-pitch ACCENT_BLOCK while preserving the two-pitch sibling.",
  expectedTexture: "ACCENT_BLOCK",
};

const finalNegative: Rc7ReferenceCaseDefinition = {
  ...sparseVerse,
  caseId: "L-FINAL-VERSE-NEGATIVE",
  title: "L · Final Verse negative control",
  description: "Final + late chord + ordinary Lead attack does not activate harmony.",
  presetId: "standard",
  sectionVariant: "final",
  phraseStartQ: q(4),
  notes: [
    ...defaultNotes(5),
    { startQ: q(5), durationQ: q(1, 2), pitch: pitch("A", 4), lyric: "late-one", emphasis: "none" },
    { startQ: q(11, 2), durationQ: q(1, 2), pitch: pitch("G", 4), lyric: "late-two", emphasis: "none" },
    { startQ: q(6), durationQ: q(1, 2), pitch: pitch("E", 4), lyric: "late-three", emphasis: "none" },
    { startQ: q(13, 2), durationQ: q(1, 2), pitch: pitch("F", 4), lyric: "late-four", emphasis: "none" },
    { startQ: q(7), durationQ: q(1, 2), pitch: pitch("G", 4), lyric: "late-five", emphasis: "none" },
    { startQ: q(15, 2), durationQ: q(1, 2), pitch: pitch("E", 4), lyric: "late-six", emphasis: "none" },
  ],
  chords: [{ startQ: q(0), symbol: "C" }, { startQ: q(6), symbol: "G" }],
  expectedTexture: "UNISON",
  fixtureTags: ["final-negative", "bare-late-chord"],
};

const finalPositive: Rc7ReferenceCaseDefinition = {
  ...finalNegative,
  caseId: "M-FINAL-VERSE-REAL-CUE",
  title: "M · Final Verse positive real-cue control",
  description: "A genuine late-long-note cue opens the same path as the base variant.",
  notes: [
    ...defaultNotes(6),
    { startQ: q(6), durationQ: q(2), pitch: pitch("G", 4), lyric: "hold", emphasis: "none" },
  ],
  fixtureTags: ["final-positive", "late-long-note"],
};

const finalPositiveBase: Rc7ReferenceCaseDefinition = {
  ...finalPositive,
  caseId: "M0-BASE-VERSE-REAL-CUE",
  title: "M0 · Base Verse real-cue control",
  sectionVariant: "base",
  fixtureTags: ["base-positive-control", "late-long-note"],
};

const meterNotes = Array.from({ length: 6 }, (_, index) => ({
  startQ: q(index, 2),
  durationQ: q(1, 2),
  pitch: [pitch("C", 4), pitch("E", 4), pitch("G", 4), pitch("D", 4), pitch("F", 4), pitch("A", 4)][index],
  lyric: `meter-${index + 1}`,
  emphasis: "none" as const,
}));

const meter44: Rc7ReferenceCaseDefinition = {
  ...standardTpp,
  caseId: "N-44-NORMALIZED",
  title: "N · 4/4 normalized policy",
  phraseDurationQ: q(6),
  notes: meterNotes,
  fixtureTags: ["meter-parity", "4/4"],
};

const meter68: Rc7ReferenceCaseDefinition = {
  ...meter44,
  caseId: "N-68-NORMALIZED",
  title: "N · 6/8 normalized policy",
  meterFamily: "compound-duple",
  tempo: tempoSpec(8, true, 61),
  fixtureTags: ["meter-parity", "6/8"],
};

const simpleTpp: Rc7ReferenceCaseDefinition = {
  ...standardTpp,
  caseId: "O-SIMPLE-BOUNDED-TPP",
  title: "O · Simple bounded two-part",
  description: "Simple reaches a two-attack bounded TPP response without full-phrase cloning.",
  presetId: "simple",
  notes: [
    { startQ: q(0), durationQ: q(1), pitch: pitch("C", 4), lyric: "one", emphasis: "none" },
    { startQ: q(1), durationQ: q(1), pitch: pitch("E", 4), lyric: "two", emphasis: "none" },
    { startQ: q(2), durationQ: q(1, 2), pitch: pitch("G", 4), lyric: "three", emphasis: "none" },
    { startQ: q(5, 2), durationQ: q(1, 2), pitch: pitch("E", 4), lyric: "four", emphasis: "none" },
    { startQ: q(3), durationQ: q(1, 2), pitch: pitch("F", 4), lyric: "five", emphasis: "none" },
    { startQ: q(7, 2), durationQ: q(1, 2), pitch: pitch("A", 4), lyric: "six", emphasis: "none" },
  ],
  fixtureTags: ["simple", "bounded-tpp"],
};

export const RC7_REFERENCE_CASES: readonly Rc7ReferenceCaseDefinition[] = [
  sparseVerse,
  activeUnison,
  standardTpp,
  busyAccent,
  lateSplit,
  sustainedPad,
  suspension,
  thirdPositive,
  thirdNegative,
  noCueThird,
  fullExpansionWithExpectedTexture,
  finalNegative,
  finalPositive,
  finalPositiveBase,
  meter44,
  meter68,
  simpleTpp,
];

export const RC7_DEFAULT_PERFORMERS = performerEntries(false);

export const RC7_SCENARIO_ASSERTION_MAINTENANCE = Object.freeze({
  scenarioId: "SCN-009",
  staleAssertionRemoved: "full TPP reachable",
  requiredAssertions: [
    "bounded TPP reachable",
    "automatic full TPP selection count = 0",
    "one independent track exact",
  ],
});
