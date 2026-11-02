/** Shapes the dashboard reads from the API (amounts are token base units as strings). */
import type { Mission, ReviewItem, Template, TxRequest } from "seenit-sdk";

export type { Mission, ReviewItem, Template, TxRequest };

export interface Meta {
  chainId: number;
  escrow: `0x${string}`;
  token: { address: `0x${string}`; symbol: string; decimals: number };
  tier1MaxReward: string;
}

export interface Funder {
  id: string;
  name: string;
  wallet: string;
}

export interface Escrow {
  funded: string;
  paidOut: string;
  paidToContributors: string;
  platformFees: string;
  inReview: string;
  unused: string;
  returned: string;
  held: string;
  expired: boolean;
  refundable: boolean;
}

export interface MissionListItem extends Mission {
  funderWallet: string | null;
  submissions: {
    processing: number;
    ready: number;
    needsReview: number;
    accepted: number;
    rejected: number;
  };
  escrow: Escrow;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface Funding {
  chainId: number;
  escrow: `0x${string}`;
  token: `0x${string}`;
  total: string;
  transactions: TxRequest[];
}
