"use client";

import { useMemo } from "react";
import type { Hex } from "viem";
import { useConfig, useConnection } from "wagmi";
import {
  getChainId,
  readContract,
  sendTransaction,
  switchChain,
  waitForTransactionReceipt,
} from "wagmi/actions";

import { erc20Abi, type WalletActions } from "@/lib/dashboard/funding";

/** The connected wallet as the plain actions the funding flow uses. Null when disconnected. */
export function useWalletActions(): WalletActions | null {
  const config = useConfig();
  const { address } = useConnection();
  return useMemo(() => {
    if (!address) return null;
    return {
      account: address,
      getChainId: async () => getChainId(config),
      switchChain: async (chainId) => {
        await switchChain(config, { chainId: chainId as (typeof config.chains)[number]["id"] });
      },
      readAllowance: (token, owner, spender) =>
        readContract(config, {
          address: token,
          abi: erc20Abi,
          functionName: "allowance",
          args: [owner, spender],
        }),
      sendTransaction: (tx) => sendTransaction(config, { to: tx.to, data: tx.data, value: 0n }),
      waitForReceipt: async (hash: Hex) => {
        const r = await waitForTransactionReceipt(config, { hash });
        return { status: r.status };
      },
    };
  }, [config, address]);
}
