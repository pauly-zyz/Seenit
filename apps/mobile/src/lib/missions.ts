import type { NearbyMission } from "./api";

export interface MissionFilters {
  /** Show missions within this many km. */
  maxDistanceKm: number;
  /** Minimum reward per capture, in token base units. */
  minReward: bigint;
}

export const DISTANCE_OPTIONS_KM = [1, 5, 10, 25] as const;

export function applyFilters(missions: NearbyMission[], f: MissionFilters): NearbyMission[] {
  return missions.filter(
    (m) => m.distanceMeters <= f.maxDistanceKm * 1000 && BigInt(m.reward) >= f.minReward,
  );
}

/** A mission is locked when it needs a higher personhood tier than the user has. */
export function isLocked(mission: Pick<NearbyMission, "minTier">, tier: number): boolean {
  return tier < mission.minTier;
}

/** Unlocked first, then by distance. */
export function sortForList(missions: NearbyMission[], tier: number): NearbyMission[] {
  return [...missions].sort((a, b) => {
    const la = isLocked(a, tier) ? 1 : 0;
    const lb = isLocked(b, tier) ? 1 : 0;
    return la - lb || a.distanceMeters - b.distanceMeters;
  });
}

/**
 * Builds an example answer from the mission's JSON Schema so contributors see what the AI will
 * extract from their capture (e.g. { "is_open": true, "sign_text": "…" }).
 */
export function exampleFromSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") return null;
  const s = schema as Record<string, unknown>;
  if ("example" in s) return s.example;
  if (Array.isArray(s.enum) && s.enum.length > 0) return s.enum[0];
  switch (s.type) {
    case "object": {
      const props = (s.properties ?? {}) as Record<string, unknown>;
      return Object.fromEntries(Object.entries(props).map(([k, v]) => [k, exampleFromSchema(v)]));
    }
    case "array":
      return [exampleFromSchema(s.items)];
    case "boolean":
      return true;
    case "integer":
      return 3;
    case "number":
      return 4.29;
    case "string":
      return typeof s.description === "string" ? `<${s.description}>` : "…";
    default:
      return null;
  }
}
