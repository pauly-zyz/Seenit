import { getChain } from "@seenit/shared";
import type { Hex, Mission, Seenit } from "seenit-sdk";
import { cancelMission, fundMission, type FunderWallet } from "seenit-sdk/viem";
import { createPublicClient, createWalletClient, defineChain, http, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/** Signs the funder's on-chain transactions. */
export interface Funder {
  readonly address: Hex;
  fund(
    missionId: string,
    maxTotal: bigint | null,
  ): Promise<{ mission: Mission; txHash: Hex | null }>;
  cancel(missionId: string): Promise<{ mission: Mission; txHash: Hex | null; refunded?: string }>;
}

/** viem-backed funder wallet. Remembers mined createMission txs so a retry never funds twice. */
export class ViemFunder implements Funder {
  readonly address: Hex;
  private readonly funded = new Map<string, Hex>();
  private readonly inFlight = new Map<string, Promise<{ mission: Mission; txHash: Hex | null }>>();

  constructor(
    private readonly seenit: Seenit,
    private readonly wallet: FunderWallet,
    private readonly publicClient: PublicClient,
  ) {
    this.address = wallet.account.address;
  }

  static async create(seenit: Seenit, privateKey: Hex, rpcUrl?: string): Promise<ViemFunder> {
    const meta = await seenit.meta();
    const chain = defineChain(getChain(meta.chainId));
    const transport = http(rpcUrl ?? chain.rpcUrls.default.http[0]);
    const wallet = createWalletClient({
      account: privateKeyToAccount(privateKey),
      chain,
      transport,
    });
    return new ViemFunder(seenit, wallet, createPublicClient({ chain, transport }) as PublicClient);
  }

  fund(missionId: string, maxTotal: bigint | null) {
    const running = this.inFlight.get(missionId);
    if (running) return running;
    const p = this.doFund(missionId, maxTotal).finally(() => this.inFlight.delete(missionId));
    this.inFlight.set(missionId, p);
    return p;
  }

  private async doFund(missionId: string, maxTotal: bigint | null) {
    const already = this.funded.get(missionId);
    if (already) {
      // Funded on-chain earlier but the API confirm failed: only confirm again.
      return { mission: await this.seenit.missions.confirm(missionId, already), txHash: already };
    }
    const out = await fundMission({
      seenit: this.seenit,
      missionId,
      walletClient: this.wallet,
      publicClient: this.publicClient,
      maxTotal: maxTotal ?? undefined,
      onTransaction: ({ hash, kind }) => {
        if (kind === "create") this.funded.set(missionId, hash);
      },
    });
    return { mission: out.mission, txHash: out.createTxHash };
  }

  cancel(missionId: string) {
    return cancelMission({
      seenit: this.seenit,
      missionId,
      walletClient: this.wallet,
      publicClient: this.publicClient,
    });
  }
}
