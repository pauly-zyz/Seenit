import * as Location from "expo-location";
import { useEffect, useState } from "react";

import type { LiveFix } from "../lib/capture-gate";

/**
 * High-accuracy location updates while mounted. Includes `mocked` (Android mock provider /
 * iOS simulated location) so the UI can refuse spoofed positions.
 */
export function useLiveLocation(enabled = true) {
  const [permission, setPermission] = useState<"granted" | "denied" | "undetermined">(
    "undetermined",
  );
  const [fix, setFix] = useState<LiveFix | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      setPermission(status === "granted" ? "granted" : "denied");
      if (status !== "granted") return;
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Highest, timeInterval: 2000, distanceInterval: 1 },
        (loc) =>
          setFix({
            lat: loc.coords.latitude,
            lng: loc.coords.longitude,
            accuracyMeters: loc.coords.accuracy,
            timestamp: loc.timestamp,
            mocked: loc.mocked === true,
          }),
      );
      if (cancelled) sub.remove();
    })().catch(() => !cancelled && setPermission("denied"));
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [enabled]);

  return { permission, fix };
}
