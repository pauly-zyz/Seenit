"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useDisconnect } from "wagmi";

import { Badge, Button } from "@/components/dashboard/ui";
import { cn } from "@/lib/cn";
import { shortHex } from "@/lib/dashboard/format";
import type { PersonhoodStatus } from "@/lib/contributor/types";

import { useContributorApi } from "./providers";

const NAV = [
  { href: "/app", label: "Missions" },
  { href: "/app/verify", label: "Verify" },
  { href: "/app/history", label: "Earnings" },
];

export function isActive(href: string, path: string) {
  if (href === "/app") return path === "/app" || path.startsWith("/app/missions/");
  return path === href;
}

export function ContributorShell({
  me,
  children,
}: {
  me: PersonhoodStatus;
  children: React.ReactNode;
}) {
  const path = usePathname() ?? "";
  const api = useContributorApi();
  const qc = useQueryClient();
  const disconnect = useDisconnect();

  async function signOut() {
    await api.signOut().catch(() => undefined);
    disconnect.mutate();
    qc.clear();
    await qc.invalidateQueries({ queryKey: ["contributor"] });
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
        <nav aria-label="Seenit app" className="flex flex-wrap gap-1">
          {NAV.map((n) => {
            const on = isActive(n.href, path);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-sm font-medium transition",
                  on ? "bg-foreground text-background" : "text-muted hover:text-foreground",
                )}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-2">
          <Badge tone={me.tier > 0 ? "verify" : "warn"}>
            {me.tier > 0 ? `Tier ${me.tier}` : "Not verified"}
          </Badge>
          <span className="font-mono text-sm text-muted">{shortHex(me.wallet)}</span>
          <Button size="sm" variant="ghost" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </div>
      {children}
    </div>
  );
}
