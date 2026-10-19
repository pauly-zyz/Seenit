import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { mediaType, missionStatus, submissionStatus } from "./enums.js";
import { funders, users } from "./users.js";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
/** Token amounts in base units (uint256-safe), read back as strings. */
const amount = (name: string) => numeric(name, { precision: 78, scale: 0 });

export const missions = pgTable(
  "missions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    funderId: uuid("funder_id")
      .notNull()
      .references(() => funders.id),
    title: text("title").notNull(),
    instructions: text("instructions").notNull(),
    mediaType: mediaType("media_type").notNull(),
    maxVideoSeconds: integer("max_video_seconds"),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    radiusMeters: integer("radius_meters").notNull(),
    /** Reward per capture, token base units. */
    reward: amount("reward").notNull(),
    maxCaptures: integer("max_captures").notNull(),
    minTier: smallint("min_tier").notNull(),
    deadline: timestamp("deadline", { withTimezone: true }).notNull(),
    status: missionStatus("status").notNull().default("pending_funding"),
    outputSchema: jsonb("output_schema").$type<Record<string, unknown>>().notNull(),
    /** keccak256 of the canonical spec, stored on-chain in MissionEscrow. */
    specHash: text("spec_hash").notNull(),
    onchainId: bigint("onchain_id", { mode: "bigint" }),
    chainTxHash: text("chain_tx_hash"),
    funderWallet: text("funder_wallet"),
    feeBps: integer("fee_bps"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("missions_spec_hash_key").on(t.specHash),
    uniqueIndex("missions_onchain_id_key").on(t.onchainId),
    index("missions_status_deadline_idx").on(t.status, t.deadline),
    index("missions_geo_idx").on(t.lat, t.lng),
    index("missions_funder_idx").on(t.funderId),
  ],
);

export const submissions = pgTable(
  "submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    missionId: uuid("mission_id")
      .notNull()
      .references(() => missions.id),
    contributorId: uuid("contributor_id")
      .notNull()
      .references(() => users.id),
    /** Object key of the original upload (never shared with funders). */
    mediaKey: text("media_key").notNull(),
    /** Object key of the face/plate-blurred copy produced by the AI pipeline (first frame). */
    blurredMediaKey: text("blurred_media_key"),
    /** All blurred frames shared with the funder (videos are delivered as key frames). */
    blurredFrameKeys: jsonb("blurred_frame_keys").$type<string[]>(),
    /** Encrypted original kept only for disputes (AES-256-GCM envelope). */
    originalArchiveKey: text("original_archive_key"),
    /** When the encrypted original is deleted. */
    originalPurgeAt: timestamp("original_purge_at", { withTimezone: true }),
    originalPurgedAt: timestamp("original_purged_at", { withTimezone: true }),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    /** SHA-256 hex of the original media, anchored on-chain. */
    mediaHash: text("media_hash"),
    mediaType: mediaType("media_type").notNull(),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    gpsAccuracyMeters: real("gps_accuracy_meters"),
    capturedAt: timestamp("captured_at", { withTimezone: true }),
    deviceInfo: jsonb("device_info").$type<Record<string, unknown>>(),
    status: submissionStatus("status").notNull().default("awaiting_upload"),
    /** Failed checks (precheck) or reject reason. */
    rejectionReasons: jsonb("rejection_reasons").$type<string[]>(),
    aiResult: jsonb("ai_result").$type<Record<string, unknown>>(),
    aiConfidence: real("ai_confidence"),
    onchainId: bigint("onchain_id", { mode: "bigint" }),
    recordTxHash: text("record_tx_hash"),
    resolveTxHash: text("resolve_tx_hash"),
    reviewDeadline: timestamp("review_deadline", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("submissions_media_hash_key").on(t.mediaHash),
    uniqueIndex("submissions_onchain_id_key").on(t.onchainId),
    uniqueIndex("submissions_mission_contributor_key").on(t.missionId, t.contributorId),
    index("submissions_mission_status_idx").on(t.missionId, t.status),
  ],
);

export const payouts = pgTable(
  "payouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id),
    contributorId: uuid("contributor_id")
      .notNull()
      .references(() => users.id),
    amount: amount("amount").notNull(),
    fee: amount("fee").notNull(),
    txHash: text("tx_hash").notNull(),
    /** True when paid via permissionless finalize() rather than accept. */
    finalized: boolean("finalized").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("payouts_submission_key").on(t.submissionId)],
);
