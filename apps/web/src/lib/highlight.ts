/**
 * Tiny syntax highlighter for the few snippets on the landing page.
 * Keeps us off a heavy highlighting library. Concatenating token texts
 * always gives back the original source.
 */

export type TokenType = "key" | "string" | "number" | "keyword" | "comment" | "punct" | "plain";
export interface Token {
  type: TokenType;
  text: string;
}
export type Lang = "json" | "ts" | "shell";

const TS_KEYWORDS = new Set([
  "import",
  "from",
  "export",
  "const",
  "let",
  "var",
  "await",
  "async",
  "new",
  "return",
  "function",
  "true",
  "false",
  "null",
  "undefined",
  "if",
  "else",
  "type",
  "interface",
]);

const RULES: Record<Lang, Array<[TokenType | "word" | "jsonString", RegExp]>> = {
  json: [
    ["jsonString", /^"(?:[^"\\]|\\.)*"/],
    ["number", /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/],
    ["keyword", /^(?:true|false|null)\b/],
    ["punct", /^[{}[\],:]/],
  ],
  ts: [
    ["comment", /^\/\/[^\n]*/],
    ["string", /^(?:"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)/],
    ["number", /^\d+(?:\.\d+)?/],
    ["word", /^[A-Za-z_$][\w$]*/],
    ["punct", /^[{}()[\].,;:=<>+\-*/!?&|]/],
  ],
  shell: [
    ["comment", /^#[^\n]*/],
    ["string", /^(?:"(?:[^"\\\n]|\\.)*"|'[^'\n]*')/],
    ["word", /^[^\s"'#]+/],
  ],
};

export function tokenize(code: string, lang: Lang): Token[] {
  const tokens: Token[] = [];
  const push = (type: TokenType, text: string) => {
    const last = tokens[tokens.length - 1];
    if (last && last.type === type) last.text += text;
    else tokens.push({ type, text });
  };

  let rest = code;
  let lineStart = true;
  while (rest.length > 0) {
    let matched = false;
    for (const [kind, re] of RULES[lang]) {
      const m = re.exec(rest);
      if (!m) continue;
      const text = m[0];
      if (kind === "jsonString") {
        push(/^\s*:/.test(rest.slice(text.length)) ? "key" : "string", text);
      } else if (kind === "word") {
        if (lang === "shell") push(lineStart ? "keyword" : "plain", text);
        else push(TS_KEYWORDS.has(text) ? "keyword" : "plain", text);
      } else {
        push(kind, text);
      }
      rest = rest.slice(text.length);
      lineStart = false;
      matched = true;
      break;
    }
    if (!matched) {
      const ch = rest[0] as string;
      push("plain", ch);
      if (ch === "\n") lineStart = true;
      rest = rest.slice(1);
    }
  }
  return tokens;
}
