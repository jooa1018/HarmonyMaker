export function needsSilentModeHint(device: Pick<Navigator, "userAgent" | "platform" | "maxTouchPoints"> & { audioSession?: unknown }): boolean {
  // iPad desktop browsing identifies as Mac; touch points distinguish it from a Mac.
  const ios = /iPhone|iPad|iPod/i.test(device.userAgent)
    || (device.platform === "MacIntel" && device.maxTouchPoints > 1);
  return ios && device.audioSession == null;
}
