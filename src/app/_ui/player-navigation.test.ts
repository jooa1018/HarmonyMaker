import { expect, it, vi } from "vitest";
import type { PlaybackPlan } from "../../product/playback-plan";
import { playerNavigation } from "./player-navigation";
const plan: PlaybackPlan = { events: [], trackIds: [], totalQuarter: 11, trackLabels: {}, effectiveChordTimelineDigest: "test", measures: [
  { number: 0, startQuarter: 0, durationQuarter: 1, beatStarts: [0] },
  { number: 1, startQuarter: 1, durationQuarter: 4, beatStarts: [1, 2, 3, 4] },
  { number: 2, startQuarter: 5, durationQuarter: 3, beatStarts: [5, 6.5] },
  { number: 1, startQuarter: 8, durationQuarter: 3, beatStarts: [8, 9.5] },
] };
it.each([0.5, 1, 1.5])("adapts seconds at %s seconds/quarter while keeping pickups, mixed meters and repeats", secondsPerQuarter => {
  const seek = vi.fn(), measureAt = vi.fn((quarter: number) => plan.measures!.find(m => quarter >= m.startQuarter && quarter < m.startQuarter + m.durationQuarter));
  const controls = playerNavigation(plan, { seek, measureAt, secondsPerQuarter });
  controls.seek(7 * secondsPerQuarter); expect(seek).toHaveBeenCalledExactlyOnceWith(7);
  expect(controls.measureAt(0)).toBe(0); expect(controls.measureAt(8.5 * secondsPerQuarter)).toBe(1);
  expect(controls.stepMeasure(0, 1)).toBe(secondsPerQuarter);
  expect(controls.stepMeasure(6 * secondsPerQuarter, 1)).toBe(8 * secondsPerQuarter);
  expect(controls.stepMeasure(8.5 * secondsPerQuarter, -1)).toBe(5 * secondsPerQuarter);
  expect(controls.stepMeasure(0, -1)).toBe(0);
  expect(controls.stepMeasure(10 * secondsPerQuarter, 1)).toBe(8 * secondsPerQuarter);
});
it("does not invent a printed measure number for a legacy plan without navigation metadata", () => {
  const controls = playerNavigation({ ...plan, measures: undefined }, { seek: vi.fn(), measureAt: () => undefined, secondsPerQuarter: 0.75 });
  expect(controls.measureAt(3)).toBeUndefined(); expect(controls.stepMeasure(3, 1)).toBe(3);
});
