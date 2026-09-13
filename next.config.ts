import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the user's running, verified build separate during local image work.
  ...(process.env.HM_LOCAL_IMAGE_BUILD === "1" ? { distDir: ".next-local-image" } : {}),
  ...(process.env.HM_LOCAL_JPEG_BUILD === "1" ? { distDir: ".next-local-jpeg" } : {}),
  // Local low-disk validation only. No cache deletion or production change.
  ...(process.env.HM_LOCAL_NO_DISK_CACHE === "1"
    ? { experimental: { turbopackFileSystemCacheForDev: false } }
    : {}),
};
export default nextConfig;
