import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import { nonceManager, privateKeyToAccount } from "viem/accounts";

import { ChainRevertError } from "./types";

export function createClients(opts: { chainId: number; rpcUrl: string; privateKey: Hex }) {
  const chain = defineChain({
    id: opts.chainId,
    name: `chain-${opts.chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [opts.rpcUrl] } },
  });
  const transport = http(opts.rpcUrl, { retryCount: 2, timeout: 20_000 });
  const publicClient = createPublicClient({ chain, transport }) as PublicClient;
  // nonceManager keeps nonces straight when several requests send transactions at once.
  const account = privateKeyToAccount(opts.privateKey, { nonceManager });
  const walletClient = createWalletClient({ account, chain, transport });
  return { publicClient, walletClient };
}

export type Clients = ReturnType<typeof createClients>;

/** Simulate (to surface revert reasons), send, wait for the receipt. Reverts become ChainRevertError. */
export async function writeAndWait(
  { publicClient, walletClient }: Clients,
  call: { address: Address; abi: Abi; functionName: string; args: readonly unknown[] },
): Promise<TransactionReceipt> {
  try {
    const { request } = await publicClient.simulateContract({
      address: call.address,
      abi: call.abi,
      functionName: call.functionName,
      args: call.args,
      account: walletClient.account,
    } as never);
    const hash = await walletClient.writeContract(request as never);
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
    if (receipt.status !== "success") throw new ChainRevertError(`${call.functionName} reverted`);
    return receipt;
  } catch (err) {
    if (err instanceof ChainRevertError) throw err;
    if (err instanceof BaseError) {
      const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
      if (revert instanceof ContractFunctionRevertedError) {
        throw new ChainRevertError(`${call.functionName} reverted`, revert.data?.errorName);
      }
      throw new ChainRevertError(`${call.functionName} failed: ${err.shortMessage}`);
    }
    throw err;
  }
}
