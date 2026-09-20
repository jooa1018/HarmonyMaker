import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  globalIgnores([".next-local-review-persistence-serialized/**"]),
  globalIgnores([".next-local-review-persistence-render/**"]),
  globalIgnores([".next-local-review-persistence-combined/**"]),
  globalIgnores([".next-local-review-persistence-projection/**"]),
  globalIgnores([".next-local-review-persistence-codec/**"]),
  globalIgnores([".next-local-review-persistence-stream/**"]),
  globalIgnores([".next-local-review-persistence-facts/**"]),
  globalIgnores([".next-local-review-persistence-created/**"]),
  globalIgnores([".next-local-review-persistence-deferred/**"]),
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([".next/**", ".next-local-image/**", ".next-local-jpeg/**", ".next-local-timeline/**", ".next-local-chord/**", ".next-local-lyrics/**", ".next-local-lyrics-followup/**", ".next-local-ending/**", ".next-local-assisted/**", ".next-local-assisted-proof/**", ".next-local-review-persistence/**", ".next-local-review-persistence-bytes/**", ".next-local-review-persistence-transfer/**", ".next-local-review-persistence-ui/**", "node_modules/**"]),
]);
