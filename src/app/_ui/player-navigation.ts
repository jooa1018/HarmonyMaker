import type { PlaybackPlan } from "../../product/playback-plan";
import type { PracticePlayerController } from "../../product/use-practice-player";
import type { SeekController } from "./SeekBar";

export function playerNavigation(plan: PlaybackPlan, player: Pick<PracticePlayerController, "seek" | "measureAt" | "secondsPerQuarter">): SeekController {
  const toQuarter = (seconds: number) => seconds / player.secondsPerQuarter;
  return {
    seek: seconds => player.seek(toQuarter(seconds)),
    measureAt: seconds => player.measureAt(toQuarter(seconds))?.number,
    stepMeasure(seconds, direction) {
      const current = player.measureAt(toQuarter(seconds)), measures = plan.measures;
      if (!current || !measures?.length) return seconds;
      // Repeated printed numbers are distinct occurrences in performance order.
      const index = measures.findIndex(measure => measure.startQuarter === current.startQuarter);
      if (index < 0) return seconds;
      const next = Math.max(0, Math.min(measures.length - 1, index + direction));
      return measures[next].startQuarter * player.secondsPerQuarter;
    },
  };
}
