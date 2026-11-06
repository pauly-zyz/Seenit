"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useState } from "react";
import { WagmiProvider } from "wagmi";

import {
  type ContributorApi,
  ContributorApiError,
  createContributorApi,
} from "@/lib/contributor/api";
import { getWagmiConfig } from "@/lib/dashboard/wagmi";

/** Retry once on network/server trouble; never on client errors or an unconfigured server. */
export function retry(failures: number, err: unknown): boolean {
  if (failures >= 1) return false;
  if (!(err instanceof ContributorApiError)) return true;
  return err.status === 0 || (err.status >= 500 && err.code !== "not_configured");
}

const ApiContext = createContext<ContributorApi | null>(null);

/** wagmi + react-query + the contributor API client (tests inject a fake API). */
export function ContributorProviders({
  children,
  api,
}: {
  children: React.ReactNode;
  api?: ContributorApi;
}) {
  const [config] = useState(() => getWagmiConfig());
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry, refetchOnWindowFocus: false } } }),
  );
  const [client] = useState(() => api ?? createContributorApi());
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ApiContext.Provider value={client}>{children}</ApiContext.Provider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

export function useContributorApi(): ContributorApi {
  const api = useContext(ApiContext);
  if (!api) throw new Error("useContributorApi must be used inside ContributorProviders");
  return api;
}
