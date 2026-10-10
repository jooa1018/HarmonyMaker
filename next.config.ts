import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Strict-Transport-Security", value: "max-age=31536000" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        {
          key: "Content-Security-Policy-Report-Only",
          value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; media-src 'self' blob: data:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
        },
      ],
    }];
  },
  // One reusable local verification build folder (".next-local-<name>"), so
  // verification runs no longer add a distDir branch per run.
  ...(/^\.next-local-[a-z0-9-]+$/u.test(process.env.HM_LOCAL_DIST_DIR ?? "") ? { distDir: process.env.HM_LOCAL_DIST_DIR } : {}),
  // Local low-disk validation only. No cache deletion or production change.
  ...(process.env.HM_LOCAL_NO_DISK_CACHE === "1"
    ? { experimental: { turbopackFileSystemCacheForDev: false } }
    : {}),
};
export default nextConfig;
