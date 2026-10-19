/** Rules every Seenit package shares, on top of each framework's preset. */
export const sharedRules = {
  "no-console": ["warn", { allow: ["warn", "error"] }],
  eqeqeq: ["error", "always", { null: "ignore" }],
  "@typescript-eslint/no-unused-vars": [
    "error",
    { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
  ],
  "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
};

export const sharedIgnores = ["**/node_modules/**", "**/dist/**", "**/.turbo/**", "**/coverage/**"];
