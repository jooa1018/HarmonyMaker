import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "**/*.postgres.test.ts"],
    // Both 101-permutation gates are CPU-heavy. Bound worker contention on
    // developer machines while retaining every case and its existing timeout.
    maxWorkers: 2,
  },
});
