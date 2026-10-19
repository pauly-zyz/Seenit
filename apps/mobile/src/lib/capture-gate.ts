import { CAPTURE_RULES, haversineMeters } from "@seenit/shared";

export type GateReason =
  "no_permission" | "locating" | "mocked" | "inaccurate" | "outside_radius" | "mission_closed";

export interface LiveFix {
  lat: number;
  lng: number;
  accuracyMeters: number | null;
  timestamp: number;
  mocked?: boolean;
}

export interface GateResult {
  canRecord: boolean;
  reason?: GateReason;
  message: string;
  distanceMeters?: number;
}

/** A fix older than this is treated as "still locating". */
export const MAX_FIX_AGE_MS = 30_000;

/**
 * Decides whether the record button is enabled. Mirrors the server's checks so contributors
 * aren't surprised later: in-radius, accurate, fresh, and not a mocked location.
 */
export function evaluateCaptureGate(input: {
  permission: "granted" | "denied" | "undetermined";
  fix: LiveFix | null;
  mission: {
    location: { lat: number; lng: number };
    radiusMeters: number;
    deadline: string;
    open?: boolean;
  };
  now: number;
}): GateResult {
  const { permission, fix, mission, now } = input;
  if (mission.open === false || new Date(mission.deadline).getTime() <= now) {
    return {
      canRecord: false,
      reason: "mission_closed",
      message: "This mission is no longer open.",
    };
  }
  if (permission !== "granted") {
    return {
      canRecord: false,
      reason: "no_permission",
      message: "Allow location access to record.",
    };
  }
  if (!fix || now - fix.timestamp > MAX_FIX_AGE_MS) {
    return { canRecord: false, reason: "locating", message: "Getting a precise GPS fix…" };
  }
  if (fix.mocked) {
    return {
      canRecord: false,
      reason: "mocked",
      message: "Your location looks simulated. Turn off mock location apps to record.",
    };
  }
  const distance = haversineMeters(mission.location, fix);
  if (fix.accuracyMeters === null || fix.accuracyMeters > CAPTURE_RULES.maxGpsAccuracyMeters) {
    return {
      canRecord: false,
      reason: "inaccurate",
      distanceMeters: distance,
      message: "GPS is not precise enough yet. Move to open sky.",
    };
  }
  if (distance > mission.radiusMeters) {
    return {
      canRecord: false,
      reason: "outside_radius",
      distanceMeters: distance,
      message: `You're ${Math.round(distance - mission.radiusMeters)} m outside the mission area.`,
    };
  }
  return { canRecord: true, distanceMeters: distance, message: "You're in the mission area." };
}
