import { robinhoodChainTestnet } from "@seenit/shared";

/**
 * Public app config. Only EXPO_PUBLIC_* variables reach the bundle, and they must be read with
 * literal `process.env.EXPO_PUBLIC_X` access so Expo can inline them. Never put secrets here.
 */
export const config = {
  apiUrl: (process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  chainId: Number(process.env.EXPO_PUBLIC_CHAIN_ID ?? robinhoodChainTestnet.id),
  rpcUrl: process.env.EXPO_PUBLIC_RPC_URL ?? robinhoodChainTestnet.rpcUrls.default.http[0],
  explorerUrl: (
    process.env.EXPO_PUBLIC_EXPLORER_URL ?? robinhoodChainTestnet.blockExplorers.default.url
  ).replace(/\/$/, ""),
  /** WalletConnect / Reown project id from https://dashboard.reown.com */
  reownProjectId: process.env.EXPO_PUBLIC_REOWN_PROJECT_ID ?? "",
  tokenSymbol: process.env.EXPO_PUBLIC_REWARD_TOKEN_SYMBOL ?? "USDG",
  tokenDecimals: Number(process.env.EXPO_PUBLIC_REWARD_TOKEN_DECIMALS ?? 6),
};

export const explorer = {
  tx: (hash: string) => `${config.explorerUrl}/tx/${hash}`,
  address: (address: string) => `${config.explorerUrl}/address/${address}`,
};
