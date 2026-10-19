import { and, authNonces, eq, gt, isNull, users, type Database } from "@seenit/db";
import { getAddress, isAddressEqual, recoverMessageAddress, type Hex } from "viem";
import { generateSiweNonce, parseSiweMessage, validateSiweMessage } from "viem/siwe";

import type { EscrowGateway } from "../chain/types";
import { AppError } from "../errors";

const NONCE_TTL_MS = 10 * 60 * 1000;

export async function issueNonce(db: Database, now: Date) {
  const nonce = generateSiweNonce();
  const expiresAt = new Date(now.getTime() + NONCE_TTL_MS);
  await db.insert(authNonces).values({ nonce, expiresAt });
  return { nonce, expiresAt };
}

/**
 * Verifies an EIP-4361 message + signature and returns the (created on first login) user.
 * Checks domain, chain, time bounds, single-use nonce, then the signature (EOA via ecrecover,
 * smart-contract wallets via ERC-1271/6492 on-chain).
 */
export async function verifySiwe(
  deps: { db: Database; chain: EscrowGateway; domain: string; chainId: number; now: Date },
  input: { message: string; signature: Hex },
) {
  const fields = parseSiweMessage(input.message);
  if (!fields.address || !fields.nonce)
    throw new AppError("unauthorized", "Malformed SIWE message");

  const valid = validateSiweMessage({
    message: fields,
    domain: deps.domain,
    time: deps.now,
  });
  if (!valid)
    throw new AppError("unauthorized", "SIWE message is not valid for this site or has expired");
  if (fields.chainId !== deps.chainId) {
    throw new AppError("unauthorized", `SIWE message must be for chain ${deps.chainId}`);
  }

  // Burn the nonce first (single use, even if the signature turns out bad).
  const burned = await deps.db
    .update(authNonces)
    .set({ usedAt: deps.now })
    .where(
      and(
        eq(authNonces.nonce, fields.nonce),
        isNull(authNonces.usedAt),
        gt(authNonces.expiresAt, deps.now),
      ),
    )
    .returning({ nonce: authNonces.nonce });
  if (burned.length === 0) throw new AppError("unauthorized", "Unknown, used or expired nonce");

  const address = getAddress(fields.address);
  let signer: string | null = null;
  try {
    signer = await recoverMessageAddress({ message: input.message, signature: input.signature });
  } catch {
    signer = null;
  }
  const ok =
    (signer !== null && isAddressEqual(signer as Hex, address)) ||
    (await deps.chain.verifyContractSignature(address, input.message, input.signature));
  if (!ok) throw new AppError("unauthorized", "Signature does not match the address");

  const wallet = address.toLowerCase();
  const [user] = await deps.db
    .insert(users)
    .values({ wallet })
    .onConflictDoUpdate({ target: users.wallet, set: { wallet } })
    .returning();
  return user!;
}
