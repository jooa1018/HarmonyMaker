import { addFractions } from "../domain/fraction";
import type { SourceRhythmTrack } from "../domain/generation/model";
import type { SongSourceDocument } from "../domain/source/model";
import { musicalRange } from "../domain/time";

/** Original rhythm stays separate from both the melody and generated voicings. */
export function sourceRhythmTracks(source: SongSourceDocument): readonly SourceRhythmTrack[] {
  const measures = new Map(source.sourceMeasures.map((measure) => [measure.id, measure]));
  const durations = source.performanceSequence.occurrences.map((occurrence) => occurrence.duration);
  const voices = [...new Set(source.sourceMeasures.flatMap((measure) => measure.rhythmVoices?.map((voice) => voice.voice) ?? []))].sort((a, b) => a - b);
  return voices.map((voice) => ({ voice, atoms: source.performanceSequence.occurrences.flatMap((occurrence) => {
    const events = measures.get(occurrence.sourceMeasureId)?.rhythmVoices?.find((v) => v.voice === voice)?.events ?? [];
    return events.map((event) => ({ id: `ra:${voice}:${occurrence.performanceIndex}:${event.id}`, sourceEventId: event.id,
      range: musicalRange({ performanceMeasureIndex: occurrence.performanceIndex, offset: event.onset }, { performanceMeasureIndex: occurrence.performanceIndex, offset: addFractions(event.onset, event.duration) }, durations),
      pitch: null, ...(event.kind === "rhythm" ? { rhythmOnly: true as const } : {}), tiedFromPrevious: event.kind === "rhythm" && event.tieStop, tiedToNext: event.kind === "rhythm" && event.tieStart, lyricTokenIds: [],
      ...(event.kind === "rhythm" && event.slurs ? { slurs: event.slurs } : {}),
    }));
  }) }));
}
