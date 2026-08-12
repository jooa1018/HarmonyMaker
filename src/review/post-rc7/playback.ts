import { addFractions, compareFractions, equalFractions, fraction, multiplyFractions, subtractFractions, type Fraction } from "../../domain/fraction";
import { pitchMidiNumber, type SpelledPitch } from "../../domain/pitch";
import type { ResearchArrangement, ResearchNoteEvent, PlaybackMix, RendererTier } from "./types";

export interface PlaybackProjectionEvent {
  readonly onsetQ: Fraction;
  readonly durationQ: Fraction;
  readonly pitch: SpelledPitch;
  readonly syllableId: string;
  readonly attack: boolean;
  readonly lyricOnset: boolean;
  readonly sourceEventIds: readonly string[];
}

export interface ResearchPlaybackArtifact {
  readonly mix: PlaybackMix;
  readonly rendererTier: RendererTier;
  readonly renderer: "abcjs-6.7.0";
  readonly soundSource: "browser-synth-no-voicebank";
  readonly licenseProvenance: "synthetic-original-fixtures";
  readonly abc: string;
  readonly sourceEventIds: readonly string[];
  readonly playbackProjection: {
    readonly lead: readonly PlaybackProjectionEvent[];
    readonly harmony: readonly PlaybackProjectionEvent[];
  };
}

function accidental(pitch: ResearchNoteEvent["pitch"]): string {
  if (pitch.alter === 0) return "=";
  return pitch.alter > 0 ? "^".repeat(pitch.alter) : "_".repeat(-pitch.alter);
}

function abcPitch(pitch: ResearchNoteEvent["pitch"]): string {
  if (pitch.octave >= 5) return `${accidental(pitch)}${pitch.step.toLowerCase()}${"'".repeat(pitch.octave - 5)}`;
  return `${accidental(pitch)}${pitch.step}${",".repeat(Math.max(0, 4 - pitch.octave))}`;
}

function abcLength(durationQ: Fraction): string {
  const eighthUnits = multiplyFractions(durationQ, fraction(2));
  if (eighthUnits.n === eighthUnits.d) return "";
  if (eighthUnits.d === 1) return String(eighthUnits.n);
  if (eighthUnits.n === 1) return `/${eighthUnits.d}`;
  return `${eighthUnits.n}/${eighthUnits.d}`;
}

function sameSoundingPitch(left: SpelledPitch, right: SpelledPitch): boolean {
  return pitchMidiNumber(left) === pitchMidiNumber(right);
}

export function coalescePlaybackEvents(events: readonly ResearchNoteEvent[]): readonly PlaybackProjectionEvent[] {
  const ordered = [...events].sort((left, right) => compareFractions(left.onsetQ, right.onsetQ));
  const projected: PlaybackProjectionEvent[] = [];
  for (const event of ordered) {
    const previous = projected[projected.length - 1];
    const contiguous = previous && equalFractions(addFractions(previous.onsetQ, previous.durationQ), event.onsetQ);
    if (
      previous
      && contiguous
      && sameSoundingPitch(previous.pitch, event.pitch)
      && previous.syllableId === event.syllableId
      && event.attack === false
    ) {
      projected[projected.length - 1] = {
        ...previous,
        durationQ: addFractions(previous.durationQ, event.durationQ),
        sourceEventIds: [...previous.sourceEventIds, event.id],
      };
      continue;
    }
    projected.push({
      onsetQ: event.onsetQ,
      durationQ: event.durationQ,
      pitch: event.pitch,
      syllableId: event.syllableId,
      attack: event.attack,
      lyricOnset: event.lyricOnset,
      sourceEventIds: [event.id],
    });
  }
  return projected;
}

function voiceAbc(events: readonly PlaybackProjectionEvent[], totalDurationQ: Fraction): string {
  const tokens: string[] = [];
  let cursor = fraction(0);
  for (const event of events) {
    if (compareFractions(cursor, event.onsetQ) < 0) tokens.push(`z${abcLength(subtractFractions(event.onsetQ, cursor))}`);
    tokens.push(`${abcPitch(event.pitch)}${abcLength(event.durationQ)}`);
    cursor = addFractions(event.onsetQ, event.durationQ);
  }
  if (compareFractions(cursor, totalDurationQ) < 0) tokens.push(`z${abcLength(subtractFractions(totalDurationQ, cursor))}`);
  return `${tokens.join(" ")} |`;
}

function maxEnd(events: readonly ResearchNoteEvent[]): Fraction {
  return events.reduce((max, event) => {
    const end = addFractions(event.onsetQ, event.durationQ);
    return compareFractions(end, max) > 0 ? end : max;
  }, fraction(0));
}

export function createPlaybackArtifact(arrangement: ResearchArrangement, mix: PlaybackMix, rendererTier: RendererTier = "COMPETENT_PLAIN"): ResearchPlaybackArtifact {
  const includeLead = mix !== "HARMONY_ONLY";
  const includeHarmony = mix !== "LEAD_ONLY";
  const totalDurationQ = maxEnd([...arrangement.lead, ...arrangement.harmony]);
  const projectedLead = coalescePlaybackEvents(arrangement.lead);
  const projectedHarmony = coalescePlaybackEvents(arrangement.harmony);
  const voices = [includeLead ? "lead" : null, includeHarmony ? "harmony" : null].filter((voice): voice is string => voice !== null);
  const program = rendererTier === "POOR" ? 80 : 53;
  const headers = [
    "X:1", `T:${arrangement.fixtureId} · ${arrangement.baselineId} · ${mix}`,
    "M:4/4", "L:1/8", "Q:1/4=88", "K:C", `%%score (${voices.join(" ")})`,
    ...(includeLead ? ['V:lead name="Lead" clef=treble'] : []),
    ...(includeHarmony ? ['V:harmony name="Harmony 1" clef=treble'] : []),
  ];
  const body = [
    ...(includeLead ? [`[V:lead] %%MIDI program ${program}\n${voiceAbc(projectedLead, totalDurationQ)}`] : []),
    ...(includeHarmony ? [`[V:harmony] %%MIDI program ${program}\n${voiceAbc(projectedHarmony, totalDurationQ)}`] : []),
  ];
  const sourceEvents = [...(includeLead ? arrangement.lead : []), ...(includeHarmony ? arrangement.harmony : [])];
  return {
    mix,
    rendererTier,
    renderer: "abcjs-6.7.0",
    soundSource: "browser-synth-no-voicebank",
    licenseProvenance: "synthetic-original-fixtures",
    abc: `${headers.join("\n")}\n${body.join("\n")}\n`,
    sourceEventIds: sourceEvents.map((event) => event.id),
    playbackProjection: {
      lead: includeLead ? projectedLead : [],
      harmony: includeHarmony ? projectedHarmony : [],
    },
  };
}
