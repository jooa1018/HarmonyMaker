import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the user's running, verified build separate during local image work.
  ...(process.env.HM_LOCAL_IMAGE_BUILD === "1" ? { distDir: ".next-local-image" } : {}),
  ...(process.env.HM_LOCAL_JPEG_BUILD === "1" ? { distDir: ".next-local-jpeg" } : {}),
  ...(process.env.HM_LOCAL_TIMELINE_BUILD === "1" ? { distDir: ".next-local-timeline" } : {}),
  ...(process.env.HM_LOCAL_CHORD_BUILD === "1" ? { distDir: ".next-local-chord" } : {}),
  ...(process.env.HM_LOCAL_LYRICS_BUILD === "1" ? { distDir: ".next-local-lyrics" } : {}),
  ...(process.env.HM_LOCAL_LYRICS_FOLLOWUP_BUILD === "1" ? { distDir: ".next-local-lyrics-followup" } : {}),
  ...(process.env.HM_LOCAL_ENDING_BUILD === "1" ? { distDir: ".next-local-ending" } : {}),
  ...(process.env.HM_LOCAL_ASSISTED_BUILD === "1" ? { distDir: ".next-local-assisted" } : {}),
  // Local low-disk validation only. No cache deletion or production change.
  ...(process.env.HM_LOCAL_NO_DISK_CACHE === "1"
    ? { experimental: { turbopackFileSystemCacheForDev: false } }
    : {}),
};
export default nextConfig;
