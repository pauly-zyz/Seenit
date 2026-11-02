"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useConnection, useDisconnect } from "wagmi";

import { cn } from "@/lib/cn";
import { explorerAddress, shortHex } from "@/lib/dashboard/format";
import type { Funder } from "@/lib/dashboard/types";

import { useDashboardApi } from "./providers";
import { Badge, Button } from "./ui";

const NAV = [
  { href: "/dashboard", label: "Missions" },
  { href: "/dashboard/missions/new", label: "New mission" },
  { href: "/dashboard/keys", label: "API keys" },
];

/** Missions stays highlighted on a mission's own page; "New mission" only on the form. */
export function isActive(href: string, path: string) {
  if (href !== "/dashboard") return path === href;
  return (
    path === "/dashboard" ||
    (path.startsWith("/dashboard/missions/") && path !== "/dashboard/missions/new")
  );
}

export function DashboardShell({
  funder,
  children,
}: {
  funder: Funder;
  children: React.ReactNode;
}) {
  const path = usePathname();
  const api = useDashboardApi();
  const qc = useQueryClient();
  const { address } = useConnection();
  const disconnect = useDisconnect();
  const mismatch = address && address.toLowerCase() !== funder.wallet;

  async function signOut() {
    await api.signOut().catch(() => undefined);
    disconnect.mutate();
    qc.clear();
    await qc.invalidateQueries({ queryKey: ["me"] });
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
        <nav aria-label="Dashboard" className="flex flex-wrap gap-1">
          {NAV.map((n) => {
            const on = isActive(n.href, path ?? "");
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "rounded-full px-4 py-1.5 text-sm font-medium transition",
                  on
                    ? "bg-foreground text-background"
                    : "text-muted hover:bg-surface-2 hover:text-foreground",
                )}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-3 text-sm">
          <a
            href={explorerAddress(funder.wallet)}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-muted hover:text-foreground"
          >
            {shortHex(funder.wallet)}
          </a>
          {mismatch ? <Badge tone="warn">Wallet switched</Badge> : null}
          <Button variant="ghost" size="sm" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </div>
      {mismatch ? (
        <p className="text-sm text-muted">
          Your wallet is now on {shortHex(address!)}, but you are signed in as{" "}
          {shortHex(funder.wallet)}. Funding and refunds go from/to the signed-in wallet: switch
          back, or sign out and sign in again.
        </p>
      ) : null}
      {children}
    </div>
  );
}
