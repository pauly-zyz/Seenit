/**
 * Robinhood Chain network constants.
 *
 * Source: official docs, https://docs.robinhood.com/chain/connecting
 * Only the testnet is defined for now. Add mainnet from the same docs page
 * when we are ready to launch; never guess values.
 *
 * The object shape is compatible with viem's `defineChain`.
 */
export const robinhoodChainTestnet = {
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.chain.robinhood.com"] },
  },
  blockExplorers: {
    default: {
      name: "Robinhood Chain Explorer",
      url: "https://explorer.testnet.chain.robinhood.com",
    },
  },
  testnet: true,
} as const;

export const supportedChains = [robinhoodChainTestnet] as const;
export type SupportedChainId = (typeof supportedChains)[number]["id"];

export function getChain(chainId: number) {
  const chain = supportedChains.find((c) => c.id === chainId);
  if (!chain) throw new Error(`Unsupported chain id ${chainId}`);
  return chain;
}

export function explorerTxUrl(chainId: number, txHash: string): string {
  return `${getChain(chainId).blockExplorers.default.url}/tx/${txHash}`;
}

export function explorerAddressUrl(chainId: number, address: string): string {
  return `${getChain(chainId).blockExplorers.default.url}/address/${address}`;
}
