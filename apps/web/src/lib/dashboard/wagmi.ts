import { getChain } from "@seenit/shared";
import { defineChain } from "viem";
import { cookieStorage, createConfig, createStorage, http } from "wagmi";
import { injected } from "wagmi/connectors";

/**
 * Robinhood Chain (values from the official docs, via packages/shared). Browser wallets are found
 * through EIP-6963 (MetaMask, Rabby, Coinbase Wallet extension, ...).
 */
export const dashboardChain = defineChain(
  getChain(Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 46630)),
);

export function getWagmiConfig() {
  return createConfig({
    chains: [dashboardChain],
    connectors: [injected()],
    ssr: true,
    storage: createStorage({ storage: cookieStorage }),
    transports: {
      [dashboardChain.id]: http(process.env.NEXT_PUBLIC_RPC_URL || undefined),
    },
  });
}

declare module "wagmi" {
  interface Register {
    config: ReturnType<typeof getWagmiConfig>;
  }
}
