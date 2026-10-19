import { describe, expect, it } from "vitest";

import { mcpConfig, sdkExample, sdkInstall } from "@/content/developers";

import { tokenize, type Lang } from "./highlight";

const join = (code: string, lang: Lang) =>
  tokenize(code, lang)
    .map((t) => t.text)
    .join("");

describe("tokenize", () => {
  it("never changes the source text", () => {
    expect(join(mcpConfig, "json")).toBe(mcpConfig);
    expect(join(sdkExample, "ts")).toBe(sdkExample);
    expect(join(sdkInstall, "shell")).toBe(sdkInstall);
    const json = JSON.stringify({ a: [1, -2.5e3, true, null], 'b"c': "x" }, null, 2);
    expect(join(json, "json")).toBe(json);
  });

  it("tells JSON keys from string values", () => {
    const tokens = tokenize('{ "is_open": "no" }', "json");
    expect(tokens.find((t) => t.text === '"is_open"')?.type).toBe("key");
    expect(tokens.find((t) => t.text === '"no"')?.type).toBe("string");
  });

  it("marks JSON literals and numbers", () => {
    const tokens = tokenize('{"a":true,"b":0.94}', "json");
    expect(tokens.find((t) => t.text === "true")?.type).toBe("keyword");
    expect(tokens.find((t) => t.text === "0.94")?.type).toBe("number");
  });

  it("highlights TS keywords, strings and comments", () => {
    const tokens = tokenize('const x = await f("hi"); // note', "ts");
    expect(tokens.filter((t) => t.type === "keyword").map((t) => t.text)).toEqual([
      "const",
      "await",
    ]);
    expect(tokens.find((t) => t.type === "string")?.text).toBe('"hi"');
    expect(tokens.find((t) => t.type === "comment")?.text).toBe("// note");
  });

  it("treats the first word of a shell line as the command", () => {
    const tokens = tokenize("npm install @seenit/sdk", "shell");
    expect(tokens[0]).toEqual({ type: "keyword", text: "npm" });
  });
});
