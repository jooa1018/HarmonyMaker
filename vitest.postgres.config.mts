import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.postgres.test.ts"],
    fileParallelism: false,
    maxWorkers: 1,
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
