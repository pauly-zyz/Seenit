// apps/mobile (Expo / React Native).
import { defineConfig, globalIgnores } from "eslint/config";
import prettier from "eslint-config-prettier/flat";
import expoConfig from "eslint-config-expo/flat.js";

import { sharedIgnores, sharedRules } from "./shared-rules.js";

export default defineConfig([
  ...expoConfig,
  // eslint-config-expo registers the TypeScript plugin for TS files only.
  { files: ["**/*.{ts,tsx,mts,cts}"], rules: sharedRules },
  prettier,
  globalIgnores([...sharedIgnores, ".expo/**", "web-build/**", "android/**", "ios/**"]),
]);
