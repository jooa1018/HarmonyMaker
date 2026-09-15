import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([".next/**", ".next-local-image/**", ".next-local-jpeg/**", ".next-local-timeline/**", ".next-local-chord/**", ".next-local-lyrics/**", "node_modules/**"]),
]);
