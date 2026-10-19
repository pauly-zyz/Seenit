import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { personhoodProvider, verificationSessionStatus } from "./enums.js";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/** Contributors, identified by wallet (lowercase 0x address). */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    wallet: text("wallet").notNull(),
    /** Cached highest valid personhood tier (source of truth: personhood_attestations). */
    tier: smallint("tier").notNull().default(0),
    reputation: integer("reputation").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_wallet_key").on(t.wallet)],
);

export const personhoodAttestations = pgTable(
  "personhood_attestations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: personhoodProvider("provider").notNull(),
    tier: smallint("tier").notNull(),
    /**
     * keccak256 of the provider-scoped nullifier (0x hex). Same value is written on-chain.
     * The raw nullifier is never stored. One identity, one account.
     */
    nullifierHash: text("nullifier_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull().defaultNow(),
    /** Non-personal verification summary (e.g. score/threshold). Never passport data. */
    result: jsonb("result").$type<Record<string, unknown>>().notNull().default({}),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /** PersonhoodRegistry.attest transaction. Null until the attestation is on-chain. */
    txHash: text("tx_hash"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("personhood_nullifier_key").on(t.nullifierHash),
    uniqueIndex("personhood_user_provider_key").on(t.userId, t.provider),
  ],
);

/** Login nonces for Sign-In with Ethereum (single use). */
export const authNonces = pgTable("auth_nonces", {
  nonce: text("nonce").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/** Contributor sessions. Only the SHA-256 of the token is stored. */
export const sessions = pgTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/** Funders: agents or teams that post missions. */
export const funders = pgTable(
  "funders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** Wallet that funds the escrow (lowercase). */
    wallet: text("wallet").notNull(),
    /** Optional https endpoint notified when a submission has an AI result. */
    webhookUrl: text("webhook_url"),
    /** Webhook signing secret, encrypted with the server's media key (never stored in plain). */
    webhookSecretEnc: text("webhook_secret_enc"),
    createdAt: createdAt(),
  },
  (t) => [index("funders_wallet_idx").on(t.wallet)],
);

/** API keys for funders/agents. Only the SHA-256 hash is stored, plus a display prefix. */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    funderId: uuid("funder_id")
      .notNull()
      .references(() => funders.id, { onDelete: "cascade" }),
    name: text("name").notNull().default("default"),
    keyHash: text("key_hash").notNull(),
    prefix: text("prefix").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("api_keys_hash_key").on(t.keyHash),
    index("api_keys_active_idx")
      .on(t.funderId)
      .where(sql`${t.revokedAt} is null`),
  ],
);

/** Verification flows that finish out-of-band (e.g. Self app posts the proof to our callback). */
export const verificationSessions = pgTable(
  "verification_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: personhoodProvider("provider").notNull(),
    status: verificationSessionStatus("status").notNull().default("pending"),
    /** Short machine-readable failure reason (never personal data). */
    error: text("error"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("verification_sessions_user_idx").on(t.userId, t.provider, t.status)],
);
