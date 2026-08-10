export function scaleRc7AbcTempo(abc: string, speedPercent: number): string {
  if (!Number.isSafeInteger(speedPercent) || speedPercent < 50 || speedPercent > 150) {
    throw new RangeError("RC7_PLAYBACK_SPEED_INVALID");
  }
  return abc.replace(/^Q:([^=]+)=(\d+)$/mu, (_line, beat: string, bpm: string) => (
    `Q:${beat}=${Math.max(1, Math.round(Number(bpm) * speedPercent / 100))}`
  ));
}
