import { z } from "zod";

import { PersonhoodTier } from "./personhood.js";

export const geoPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type GeoPoint = z.infer<typeof geoPointSchema>;

export const mediaTypeSchema = z.enum(["photo", "video"]);
export type MediaType = z.infer<typeof mediaTypeSchema>;

const UINT128_MAX = (1n << 128n) - 1n;

/** Positive integer in token base units, as a string (JSON-safe bigint). Fits MissionEscrow's uint128. */
export const baseUnitsSchema = z
  .string()
  .regex(/^[1-9]\d*$/, "must be a positive integer amount in token base units")
  // Zod 4 keeps running checks after a failed regex, so guard before BigInt().
  .refine((v) => !/^[1-9]\d*$/.test(v) || BigInt(v) <= UINT128_MAX, "exceeds uint128");

/**
 * A JSON Schema (object form) describing the structured answer the AI vision
 * step must return, e.g. { type: "object", properties: { open: { type: "boolean" } } }.
 */
export const outputSchemaSchema = z
  .record(z.string(), z.unknown())
  .refine((s) => s.type === "object", 'outputSchema must have type: "object"');

/** Mission spec as created by an AI agent (MCP) or a funder (dashboard). */
export const missionSpecSchema = z
  .object({
    title: z.string().trim().min(3).max(120),
    instructions: z.string().trim().min(10).max(4000),
    mediaType: mediaTypeSchema,
    /** Max video length in seconds. Required for video missions. */
    maxVideoSeconds: z.number().int().min(1).max(120).optional(),
    location: geoPointSchema,
    radiusMeters: z.number().int().min(10).max(5000),
    rewardPerSubmission: baseUnitsSchema,
    maxSubmissions: z.number().int().min(1).max(1000),
    deadline: z.iso.datetime({ offset: true }),
    minTier: z
      .union([z.literal(PersonhoodTier.Passport), z.literal(PersonhoodTier.Self)])
      .default(PersonhoodTier.Passport),
    outputSchema: outputSchemaSchema,
  })
  .refine((m) => m.mediaType !== "video" || m.maxVideoSeconds !== undefined, {
    message: "maxVideoSeconds is required for video missions",
    path: ["maxVideoSeconds"],
  });
export type MissionSpec = z.infer<typeof missionSpecSchema>;
export type MissionSpecInput = z.input<typeof missionSpecSchema>;

/** Mirrors MissionEscrow.MissionStatus. */
export const MissionStatus = { None: 0, Open: 1, Closed: 2 } as const;
/** Mirrors MissionEscrow.SubmissionStatus. */
export const SubmissionStatus = { None: 0, Pending: 1, Approved: 2, Rejected: 3 } as const;

/**
 * Deterministic JSON (sorted keys, no whitespace). Hash this to get the
 * on-chain `specHash`, so anyone can check a spec against the chain.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new Error("Non-finite numbers cannot be canonicalized");
    }
    if (value === undefined) throw new Error("undefined cannot be canonicalized");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}
