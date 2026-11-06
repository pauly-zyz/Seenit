"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";

import { WalletSignIn } from "@/components/dashboard/auth-gate";
import { Notice } from "@/components/dashboard/ui";
import { ContributorApiError } from "@/lib/contributor/api";
import type { PersonhoodStatus } from "@/lib/contributor/types";

import { useContributorApi } from "./providers";

/** Who is signed in (personhood status doubles as "me"); null when signed out. */
export function useContributor() {
  const api = useContributorApi();
  return useQuery({
    queryKey: ["contributor"],
    queryFn: async () => {
      try {
        return await api.personhood();
      } catch (err) {
        if (err instanceof ContributorApiError && err.status === 401) return null;
        throw err;
      }
    },
  });
}

export function useMeta() {
  const api = useContributorApi();
  return useQuery({ queryKey: ["meta"], queryFn: api.meta, staleTime: 10 * 60_000 });
}

export function apiErrorMessage(err: unknown): string {
  if (err instanceof ContributorApiError) {
    if (err.code === "not_configured") return "Seenit is getting ready. Please check back soon.";
    return err.message;
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

/** Renders children with the signed-in contributor, or the wallet sign-in. */
export function ContributorGate({
  children,
}: {
  children: (me: PersonhoodStatus) => React.ReactNode;
}) {
  const api = useContributorApi();
  const qc = useQueryClient();
  const me = useContributor();
  if (me.isPending) return <p className="py-20 text-center text-muted">Loading…</p>;
  if (me.isError) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-16">
        <Notice
          tone={
            me.error instanceof ContributorApiError && me.error.code === "not_configured"
              ? "warn"
              : "error"
          }
        >
          {apiErrorMessage(me.error)}
        </Notice>
      </div>
    );
  }
  if (!me.data) {
    return (
      <div className="px-4">
        <WalletSignIn
          eyebrow="Seenit app"
          title="Earn by capturing the world"
          body="Sign in with your wallet to see paid photo and video missions near you. Rewards are paid in stablecoins to this wallet."
          statement="Sign in to Seenit. This is free and sends no transaction."
          nonce={api.nonce}
          verify={async (message, signature) => {
            await api.signIn(message, signature);
            await qc.invalidateQueries({ queryKey: ["contributor"] });
          }}
        />
      </div>
    );
  }
  return <>{children(me.data)}</>;
}
