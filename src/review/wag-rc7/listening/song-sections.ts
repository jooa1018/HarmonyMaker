import { fraction } from "../../../domain/fraction";
import type { ArrangementPresetId } from "../../../domain/config";
import type { KeySignature, SpelledPitch } from "../../../domain/pitch";
import { tempoSpec } from "../../../domain/source/model";
import { runPreparedRc7ReviewInput } from "../harness";
import { prepareRc7ReferenceCase } from "../prepare";
import type {
  Rc7FixtureNoteSpec,
  Rc7PlaybackArtifact,
  Rc7ReferenceCaseDefinition,
  Rc7ReviewOutput,
} from "../types";

const C_MAJOR: KeySignature = { tonic: { step: "C", alter: 0 }, mode: "major" };

function q(n: number, d = 1) {
  return fraction(n, d);
}

function pitch(step: SpelledPitch["step"], octave: number): SpelledPitch {
  return { step, alter: 0, octave };
}

function note(
  startN: number,
  startD: number,
  durationN: number,
  durationD: number,
  step: SpelledPitch["step"],
  octave: number,
  lyric: string,
  emphasis: Rc7FixtureNoteSpec["emphasis"] = "none",
): Rc7FixtureNoteSpec {
  return {
    startQ: q(startN, startD),
    durationQ: q(durationN, durationD),
    pitch: pitch(step, octave),
    lyric,
    emphasis,
  };
}

function definition(
  value: Omit<Rc7ReferenceCaseDefinition, "key" | "maxHarmonyTracks">,
): Rc7ReferenceCaseDefinition {
  return { ...value, key: C_MAJOR, maxHarmonyTracks: 2 };
}

export interface Rc7SongSectionDefinition {
  readonly sectionId: string;
  readonly bars: number;
  readonly intendedPreset: ArrangementPresetId;
  readonly phrases: readonly Rc7ReferenceCaseDefinition[];
}

export interface Rc7SongSectionOutput {
  readonly sectionId: string;
  readonly bars: number;
  readonly preset: ArrangementPresetId;
  readonly phraseOutputs: readonly Rc7ReviewOutput[];
  readonly playback: Rc7PlaybackArtifact;
}

const sparseVerseLift: Rc7SongSectionDefinition = {
  sectionId: "S1-SPARSE-VERSE-LIFT",
  bars: 9,
  intendedPreset: "standard",
  phrases: [
    definition({
      caseId: "S1-P1-SPARSE-OPEN",
      title: "Synthetic section one, sparse opening",
      description: "Original sparse verse phrase with no direct lift cue.",
      meterFamily: "simple-quadruple",
      phraseStartQ: q(4),
      phraseDurationQ: q(16),
      sectionType: "verse",
      sectionVariant: "base",
      presetId: "standard",
      tempo: tempoSpec(4, false, 84),
      notes: [
        note(0, 1, 2, 1, "C", 4, "open"),
        note(3, 1, 1, 1, "E", 4, "air"),
        note(5, 1, 2, 1, "G", 4, "gently"),
        note(8, 1, 1, 1, "E", 4, "moving"),
        note(10, 1, 2, 1, "F", 4, "near"),
        note(13, 1, 1, 1, "E", 4, "home"),
        note(15, 1, 1, 1, "D", 4, "now"),
      ],
      chords: [
        { startQ: q(0), symbol: "C" },
        { startQ: q(4), symbol: "Am" },
        { startQ: q(8), symbol: "F" },
        { startQ: q(12), symbol: "G" },
      ],
      fixtureTags: ["song-like", "sparse-opening"],
    }),
    definition({
      caseId: "S1-P2-REAL-LIFT",
      title: "Synthetic section one, real lift",
      description: "Original second verse phrase with a genuine late lift cue.",
      meterFamily: "simple-quadruple",
      phraseDurationQ: q(16),
      sectionType: "verse",
      sectionVariant: "base",
      presetId: "standard",
      tempo: tempoSpec(4, false, 84),
      notes: [
        note(0, 1, 1, 1, "E", 4, "steady"),
        note(2, 1, 1, 1, "G", 4, "steps"),
        note(4, 1, 1, 1, "A", 4, "carry"),
        note(5, 1, 1, 1, "G", 4, "on"),
        note(7, 1, 1, 1, "E", 4, "through"),
        note(9, 1, 1, 1, "F", 4, "new"),
        note(10, 1, 1, 1, "G", 4, "light"),
        note(12, 1, 1, 1, "A", 4, "we"),
        note(13, 1, 3, 1, "G", 4, "rise"),
      ],
      chords: [
        { startQ: q(0), symbol: "Am" },
        { startQ: q(4), symbol: "F" },
        { startQ: q(8), symbol: "C" },
        { startQ: q(12), symbol: "G" },
      ],
      fixtureTags: ["song-like", "late-long-note", "lift"],
    }),
  ],
};

const mediumChorus: Rc7SongSectionDefinition = {
  sectionId: "S2-MEDIUM-CHORUS",
  bars: 8,
  intendedPreset: "standard",
  phrases: [
    definition({
      caseId: "S2-P1-RHYTHMIC-CHORUS",
      title: "Synthetic section two, rhythmic chorus",
      description: "Original medium-density chorus with bounded responses and accents.",
      meterFamily: "simple-quadruple",
      phraseDurationQ: q(16),
      sectionType: "chorus",
      sectionVariant: "base",
      presetId: "standard",
      tempo: tempoSpec(4, false, 98),
      notes: [
        note(0, 1, 1, 2, "C", 4, "bright"),
        note(1, 2, 1, 2, "E", 4, "and"),
        note(1, 1, 1, 1, "G", 4, "clear"),
        note(2, 1, 1, 2, "E", 4, "we"),
        note(5, 2, 1, 2, "G", 4, "move"),
        note(3, 1, 1, 1, "C", 4, "as", "confirmed"),
        note(4, 1, 1, 1, "G", 4, "open"),
        note(5, 1, 1, 2, "B", 4, "the"),
        note(11, 2, 1, 2, "D", 4, "wide"),
        note(6, 1, 1, 1, "G", 4, "way"),
        note(7, 1, 1, 1, "B", 4, "ahead"),
        note(8, 1, 1, 2, "A", 4, "sing"),
        note(17, 2, 1, 2, "C", 5, "it"),
        note(9, 1, 1, 1, "E", 4, "out"),
        note(10, 1, 1, 1, "A", 4, "together"),
        note(11, 1, 1, 1, "C", 5, "now"),
        note(12, 1, 1, 1, "F", 4, "rise"),
        note(13, 1, 1, 2, "A", 4, "again"),
        note(27, 2, 1, 2, "C", 5, "with", "confirmed"),
        note(14, 1, 1, 1, "A", 4, "open"),
        note(15, 1, 1, 1, "F", 4, "sound"),
      ],
      chords: [
        { startQ: q(0), symbol: "C" },
        { startQ: q(4), symbol: "G" },
        { startQ: q(8), symbol: "Am" },
        { startQ: q(12), symbol: "F" },
      ],
      fixtureTags: ["song-like", "bounded-tpp", "accent"],
    }),
    definition({
      caseId: "S2-P2-LATE-CHORUS-LIFT",
      title: "Synthetic section two, late chorus lift",
      description: "Original chorus continuation with a late-long split window.",
      meterFamily: "simple-quadruple",
      phraseDurationQ: q(16),
      sectionType: "chorus",
      sectionVariant: "base",
      presetId: "standard",
      tempo: tempoSpec(4, false, 98),
      notes: [
        note(0, 1, 1, 1, "F", 4, "carry"),
        note(1, 1, 1, 2, "A", 4, "the"),
        note(3, 2, 1, 2, "C", 5, "line"),
        note(2, 1, 1, 1, "A", 4, "forward"),
        note(4, 1, 1, 2, "G", 4, "hold"),
        note(9, 2, 1, 2, "B", 4, "the"),
        note(5, 1, 1, 1, "D", 5, "center"),
        note(7, 1, 1, 1, "G", 4, "steady"),
        note(8, 1, 1, 1, "A", 4, "all", "confirmed"),
        note(9, 1, 1, 1, "C", 5, "voices"),
        note(10, 1, 1, 1, "E", 5, "turn"),
        note(11, 1, 1, 1, "A", 4, "home"),
        note(12, 1, 1, 1, "G", 4, "and"),
        note(13, 1, 3, 1, "G", 4, "stay"),
      ],
      chords: [
        { startQ: q(0), symbol: "F" },
        { startQ: q(4), symbol: "G" },
        { startQ: q(8), symbol: "Am" },
        { startQ: q(12), symbol: "G" },
      ],
      fixtureTags: ["song-like", "u2s", "selective-third-voice"],
    }),
  ],
};

const bridgeEnding: Rc7SongSectionDefinition = {
  sectionId: "S3-BRIDGE-ENDING",
  bars: 8,
  intendedPreset: "full",
  phrases: [
    definition({
      caseId: "S3-P1-LONG-BRIDGE",
      title: "Synthetic section three, long bridge",
      description: "Original six-eight long-note region for Pad register review.",
      meterFamily: "compound-duple",
      phraseDurationQ: q(12),
      sectionType: "bridge",
      sectionVariant: "base",
      presetId: "full",
      tempo: tempoSpec(8, true, 64),
      notes: [
        note(0, 1, 3, 1, "C", 5, "over"),
        note(3, 1, 3, 2, "E", 5, "still"),
        note(9, 2, 3, 2, "G", 4, "water"),
        note(6, 1, 3, 1, "A", 4, "we"),
        note(9, 1, 3, 1, "G", 4, "wait"),
      ],
      chords: [
        { startQ: q(0), symbol: "C" },
        { startQ: q(3), symbol: "Am" },
        { startQ: q(6), symbol: "F" },
        { startQ: q(9), symbol: "G" },
      ],
      fixtureTags: ["song-like", "pad", "long-note-region"],
    }),
    definition({
      caseId: "S3-P2-PREPARED-ENDING",
      title: "Synthetic section three, prepared ending",
      description: "Original prepared release over a late harmonic turn.",
      meterFamily: "compound-duple",
      phraseDurationQ: q(12),
      sectionType: "bridge",
      sectionVariant: "final",
      presetId: "full",
      tempo: tempoSpec(8, true, 64),
      notes: [
        note(0, 1, 1, 1, "C", 5, "prepare"),
        note(11, 1, 1, 1, "G", 4, "release"),
      ],
      chords: [
        { startQ: q(0), symbol: "N.C." },
        { startQ: q(6), symbol: "C" },
        { startQ: q(11), symbol: "G7" },
      ],
      fixtureTags: ["song-like", "prepared-suspension", "ending"],
    }),
  ],
};

export const RC7_SONG_SECTION_DEFINITIONS: readonly Rc7SongSectionDefinition[] = [
  sparseVerseLift,
  mediumChorus,
  bridgeEnding,
];

function voiceLine(abc: string, voice: "lead" | "h1" | "h2"): string {
  const match = abc.match(new RegExp(`^\\[V:${voice}\\]\\s*(.*)$`, "mu"));
  if (!match?.[1]) throw new RangeError(`RC7_SECTION_PLAYBACK_VOICE_MISSING:${voice}`);
  return match[1].trim();
}

function mergeAbc(
  title: string,
  sources: readonly string[],
  voices: readonly ("lead" | "h1" | "h2")[],
): string {
  const header = sources[0].split(/\r?\n/u)
    .filter((line) => !line.startsWith("[V:"))
    .join("\n")
    .replace(/^T:.*$/mu, `T:${title}`);
  const body = voices.map((voice) => (
    `[V:${voice}] ${sources.map((source) => voiceLine(source, voice)).join(" ")}`
  ));
  return `${header}\n${body.join("\n")}\n`;
}

function mergePlayback(sectionId: string, outputs: readonly Rc7ReviewOutput[]): Rc7PlaybackArtifact {
  if (outputs.length === 0) throw new RangeError("RC7_SECTION_PLAYBACK_EMPTY");
  return {
    renderer: "abcjs-6.7.0",
    soundSource: "browser-synth-no-voicebank",
    licenseProvenance: "synthetic-original-fixtures",
    fullArrangementAbc: mergeAbc(
      sectionId,
      outputs.map((output) => output.playback.fullArrangementAbc),
      ["lead", "h1", "h2"],
    ),
    leadOnlyAbc: mergeAbc(
      sectionId,
      outputs.map((output) => output.playback.leadOnlyAbc),
      ["lead"],
    ),
    voiceLabels: ["Lead", "Harmony 1", "Harmony 2"],
  };
}

export async function runRc7SongSection(
  section: Rc7SongSectionDefinition,
  preset: ArrangementPresetId = section.intendedPreset,
): Promise<Rc7SongSectionOutput> {
  const outputs: Rc7ReviewOutput[] = [];
  let priorIntent: Rc7ReviewOutput["intent"]["plan"]["phraseIntents"][number] | null = null;
  for (const [index, phrase] of section.phrases.entries()) {
    const prepared = await prepareRc7ReferenceCase(phrase, {
      idNamespace: `${section.sectionId}:phrase:${index + 1}`,
      runtimeTrackPrefix: `${section.sectionId}:track`,
      runtimePerformerPrefix: `${section.sectionId}:performer`,
      presetOverride: preset,
    });
    const output = await runPreparedRc7ReviewInput({
      ...prepared,
      priorPersistedPhraseIntent: priorIntent,
    });
    outputs.push(output);
    priorIntent = output.intent.plan.phraseIntents[0] ?? null;
  }
  return {
    sectionId: section.sectionId,
    bars: section.bars,
    preset,
    phraseOutputs: outputs,
    playback: mergePlayback(section.sectionId, outputs),
  };
}
