import { createAppKit, type AppKitNetwork } from "@reown/appkit-react-native";
import { EthersAdapter } from "@reown/appkit-ethers-react-native";

import { config } from "../config";
import { appKitStorage } from "./storage";

/** Robinhood Chain testnet as an AppKit network (values from the official docs, via packages/shared). */
export const robinhoodNetwork: AppKitNetwork = {
  id: config.chainId,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
  blockExplorers: { default: { name: "Robinhood Chain Explorer", url: config.explorerUrl } },
  chainNamespace: "eip155",
  caipNetworkId: `eip155:${config.chainId}`,
};

export const walletConfigured = config.reownProjectId.length > 0;

/**
 * The AppKit instance (created once). Swaps, on-ramp and social logins are off: contributors only
 * connect a wallet to sign in and receive rewards.
 */
export const appKit = createAppKit({
  projectId: config.reownProjectId || "missing-project-id",
  networks: [robinhoodNetwork],
  defaultNetwork: robinhoodNetwork,
  adapters: [new EthersAdapter()],
  storage: appKitStorage,
  metadata: {
    name: "Seenit",
    description: "Eyes on the ground for AI agents.",
    url: "https://seenit.xyz",
    icons: ["https://seenit.xyz/icon.png"],
    redirect: { native: "seenit://" },
  },
  features: { swaps: false, onramp: false, socials: false },
});
