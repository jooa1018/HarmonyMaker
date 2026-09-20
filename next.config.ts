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
  ...(process.env.HM_LOCAL_ASSISTED_PROOF_BUILD === "1" ? { distDir: ".next-local-assisted-proof" } : {}),
  ...(process.env.HM_LOCAL_REVIEW_PERSISTENCE_BUILD === "1" ? { distDir: ".next-local-review-persistence" } : {}),
  ...(process.env.HM_LOCAL_REVIEW_PERSISTENCE_BUILD === "bytes" ? { distDir: ".next-local-review-persistence-bytes" } : {}),
  ...(process.env.HM_LOCAL_REVIEW_PERSISTENCE_BUILD === "transfer" ? { distDir: ".next-local-review-persistence-transfer" } : {}),
  ...(process.env.HM_LOCAL_REVIEW_PERSISTENCE_BUILD === "ui" ? { distDir: ".next-local-review-persistence-ui" } : {}),
  ...(process.env.HM_LOCAL_REVIEW_PERSISTENCE_BUILD === "serialized" ? { distDir: ".next-local-review-persistence-serialized" } : {}),
  ...(process.env.HM_LOCAL_REVIEW_PERSISTENCE_BUILD === "render" ? { distDir: ".next-local-review-persistence-render" } : {}),
  ...(process.env.HM_LOCAL_REVIEW_PERSISTENCE_BUILD === "combined" ? { distDir: ".next-local-review-persistence-combined" } : {}),
  ...(process.env.HM_LOCAL_REVIEW_PERSISTENCE_BUILD === "projection" ? { distDir: ".next-local-review-persistence-projection" } : {}),
  ...(process.env.HM_LOCAL_REVIEW_PERSISTENCE_BUILD === "codec" ? { distDir: ".next-local-review-persistence-codec" } : {}),
  ...(process.env.HM_LOCAL_REVIEW_PERSISTENCE_BUILD === "stream" ? { distDir: ".next-local-review-persistence-stream" } : {}),
  // Local low-disk validation only. No cache deletion or production change.
  ...(process.env.HM_LOCAL_NO_DISK_CACHE === "1"
    ? { experimental: { turbopackFileSystemCacheForDev: false } }
    : {}),
};
export default nextConfig;
