"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useState } from "react";
import { WagmiProvider } from "wagmi";

import { createDashboardApi, type DashboardApi } from "@/lib/dashboard/api";
import { getWagmiConfig } from "@/lib/dashboard/wagmi";

const ApiContext = createContext<DashboardApi | null>(null);

/** wagmi + react-query + the dashboard API client (tests inject a fake API). */
export function DashboardProviders({
  children,
  api,
}: {
  children: React.ReactNode;
  api?: DashboardApi;
}) {
  const [config] = useState(() => getWagmiConfig());
  const [queryClient] = useState(
    () =>
      new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }),
  );
  const [client] = useState(() => api ?? createDashboardApi());
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ApiContext.Provider value={client}>{children}</ApiContext.Provider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

export function useDashboardApi(): DashboardApi {
  const api = useContext(ApiContext);
  if (!api) throw new Error("useDashboardApi must be used inside DashboardProviders");
  return api;
}
