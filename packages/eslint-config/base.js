// Node / library packages (packages/*, apps/mcp).
import js from "@eslint/js";
import prettier from "eslint-config-prettier/flat";
import globals from "globals";
import tseslint from "typescript-eslint";

import { sharedIgnores, sharedRules } from "./shared-rules.js";

export default tseslint.config(
  { ignores: sharedIgnores },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: sharedRules,
  },
  prettier,
);
