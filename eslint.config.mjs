import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  globalIgnores([".next-local-review-persistence-serialized/**"]),
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([".next/**", ".next-local-image/**", ".next-local-jpeg/**", ".next-local-timeline/**", ".next-local-chord/**", ".next-local-lyrics/**", ".next-local-lyrics-followup/**", ".next-local-ending/**", ".next-local-assisted/**", ".next-local-assisted-proof/**", ".next-local-review-persistence/**", ".next-local-review-persistence-bytes/**", ".next-local-review-persistence-transfer/**", ".next-local-review-persistence-ui/**", "node_modules/**"]),
]);
