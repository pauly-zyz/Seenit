import base from "@seenit/eslint-config/base";

export default [
  ...base,
  // A CLI rehearsal: it reports progress on the console.
  { rules: { "no-console": "off" } },
];
