import { personhoodRegistryAbi } from "@seenit/shared";
import type { Abi, Address, Hex } from "viem";

import { createClients, writeAndWait, type Clients } from "./client";

/** Writes to PersonhoodRegistry with the backend attester key. */
export interface RegistryGateway {
  attest(
    wallet: Address,
    provider: number,
    nullifierHash: Hex,
    expiresAt: bigint,
  ): Promise<{ txHash: Hex }>;
}

export class ViemRegistryGateway implements RegistryGateway {
  private readonly clients: Clients;

  constructor(
    private readonly opts: {
      chainId: number;
      rpcUrl: string;
      registryAddress: Address;
      attesterPrivateKey: Hex;
    },
  ) {
    this.clients = createClients({
      chainId: opts.chainId,
      rpcUrl: opts.rpcUrl,
      privateKey: opts.attesterPrivateKey,
    });
  }

  async attest(wallet: Address, provider: number, nullifierHash: Hex, expiresAt: bigint) {
    const receipt = await writeAndWait(this.clients, {
      address: this.opts.registryAddress,
      abi: personhoodRegistryAbi as Abi,
      functionName: "attest",
      args: [wallet, provider, nullifierHash, expiresAt],
    });
    return { txHash: receipt.transactionHash };
  }
}
