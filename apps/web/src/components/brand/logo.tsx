import { cn } from "@/lib/cn";

/** Seenit mark: an aperture ring with a check-shaped glint. Original artwork. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-7", className)}>
      <rect width="32" height="32" rx="9" className="fill-foreground" />
      <circle cx="16" cy="16" r="8.5" fill="none" strokeWidth="3" className="stroke-accent" />
      <path
        d="M12.4 16.2l2.6 2.5 4.8-5.2"
        fill="none"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-background"
      />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark />
      <span className="text-[1.35rem] leading-none font-semibold tracking-[-0.04em]">
        seen<span className="text-accent-ink">it</span>
      </span>
    </span>
  );
}
