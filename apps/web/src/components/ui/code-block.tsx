import { type Lang, tokenize, type TokenType } from "@/lib/highlight";
import { cn } from "@/lib/cn";

import { CopyButton } from "./copy-button";

const tokenClass: Record<TokenType, string> = {
  key: "text-tok-key",
  string: "text-tok-string",
  number: "text-tok-number",
  keyword: "text-tok-keyword",
  comment: "text-tok-comment italic",
  punct: "text-tok-punct",
  plain: "text-tok-plain",
};

/** Dark code panel with lightweight highlighting, rendered on the server. */
export function CodeBlock({
  code,
  lang,
  title,
  copy = true,
  className,
}: {
  code: string;
  lang: Lang;
  title?: string;
  copy?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-code-line bg-code shadow-[0_20px_50px_-30px_rgba(0,0,0,0.6)]",
        className,
      )}
    >
      {title || copy ? (
        <div className="flex items-center justify-between gap-3 border-b border-code-line px-4 py-2.5">
          <span className="font-mono text-xs text-tok-comment">{title}</span>
          {copy ? <CopyButton text={code} /> : null}
        </div>
      ) : null}
      <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-6 sm:text-sm">
        <code>
          {tokenize(code, lang).map((t, i) => (
            <span key={i} className={tokenClass[t.type]}>
              {t.text}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
