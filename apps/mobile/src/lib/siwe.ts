import { createSiweMessage } from "viem/siwe";

/** EIP-4361 message the wallet signs. Domain and chain come from the server's nonce response. */
export function buildSiweMessage(input: {
  address: `0x${string}`;
  nonce: string;
  domain: string;
  chainId: number;
  uri: string;
  issuedAt: Date;
}): string {
  return createSiweMessage({
    address: input.address,
    chainId: input.chainId,
    domain: input.domain,
    nonce: input.nonce,
    uri: input.uri,
    version: "1",
    issuedAt: input.issuedAt,
    statement: "Sign in to Seenit. This does not send a transaction or cost gas.",
  });
}
