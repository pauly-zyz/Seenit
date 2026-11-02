import base from "@seenit/eslint-config/base";

export default [
  ...base,
  // Examples are scripts meant to print.
  { files: ["examples/**"], rules: { "no-console": "off" } },
];
