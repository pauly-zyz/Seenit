import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:brightness-95",
  secondary: "bg-foreground text-background hover:opacity-90",
  ghost: "border border-line bg-surface text-foreground hover:bg-surface-2",
  danger: "border border-rec/40 bg-surface text-rec hover:bg-rec/10",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  busy,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: "sm" | "md";
  busy?: boolean;
}) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      aria-busy={busy || undefined}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full font-medium transition focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-3 text-sm" : "h-10 px-5 text-[15px]",
        variants[variant],
        className,
      )}
    >
      {busy ? (
        <span
          className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden
        />
      ) : null}
      {children}
    </button>
  );
}

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <section className={cn("rounded-2xl border border-line bg-surface p-5", className)}>
      {children}
    </section>
  );
}

const tones = {
  neutral: "bg-surface-2 text-muted",
  accent: "bg-accent text-accent-fg",
  verify: "bg-verify/12 text-verify",
  warn: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  danger: "bg-rec/12 text-rec",
  ink: "bg-foreground text-background",
} as const;

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: keyof typeof tones;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

export const missionTone = (status: string): keyof typeof tones =>
  status === "active" ? "verify" : status === "pending_funding" ? "warn" : "neutral";

export const missionLabel = (status: string) =>
  ({ pending_funding: "Not funded", active: "Live", cancelled: "Cancelled", refunded: "Refunded" })[
    status
  ] ?? status;

export const submissionTone = (status: string): keyof typeof tones =>
  (({
    accepted: "verify",
    rejected: "danger",
    needs_review: "warn",
    ready: "accent",
    processing: "neutral",
  })[status] as keyof typeof tones | undefined) ?? "neutral";

export const submissionLabel = (status: string) =>
  ({
    processing: "Processing",
    ready: "Ready",
    needs_review: "Needs review",
    accepted: "Accepted",
    rejected: "Rejected",
  })[status] ?? status;

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-sm text-rec">
          {error}
        </p>
      ) : hint ? (
        <p className="text-sm text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export const inputClass =
  "h-10 w-full rounded-xl border border-line bg-background px-3 text-[15px] outline-none focus:border-foreground/40 focus:ring-2 focus:ring-accent/60";

export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "error" | "success" | "warn";
  children: React.ReactNode;
}) {
  const cls = {
    info: "border-line bg-surface-2 text-foreground",
    error: "border-rec/30 bg-rec/10 text-rec",
    success: "border-verify/30 bg-verify/10 text-verify",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200",
  }[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("rounded-xl border px-4 py-3 text-sm", cls)}
    >
      {children}
    </div>
  );
}

export function errorMessage(err: unknown): string {
  if (
    err &&
    typeof err === "object" &&
    "shortMessage" in err &&
    typeof err.shortMessage === "string"
  ) {
    return /rejected|denied/i.test(err.shortMessage)
      ? "You rejected the request in your wallet."
      : err.shortMessage;
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}
