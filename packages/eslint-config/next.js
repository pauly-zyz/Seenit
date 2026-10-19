// apps/web (Next.js App Router).
import { defineConfig, globalIgnores } from "eslint/config";
import prettier from "eslint-config-prettier/flat";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

import { sharedIgnores, sharedRules } from "./shared-rules.js";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  { rules: sharedRules },
  prettier,
  globalIgnores([...sharedIgnores, ".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
