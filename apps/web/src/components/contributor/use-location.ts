"use client";

import type { LiveFix } from "@seenit/shared";
import { useEffect, useState } from "react";

export type LocationPermission = "granted" | "denied" | "undetermined";

export interface LiveLocation {
  permission: LocationPermission;
  fix: LiveFix | null;
  /** Shown when the browser can't locate at all (no GPS, insecure origin, ...). */
  error: string | null;
  /** Ask for permission / start watching (browsers only prompt on a user gesture in some cases). */
  start: () => void;
}

/**
 * Watches the device position with high accuracy. The browser has no "mock location" signal, so
 * `mocked` is never set on the web; the server still checks radius, accuracy and timing.
 */
export function useLiveLocation(autoStart = true): LiveLocation {
  const [permission, setPermission] = useState<LocationPermission>("undetermined");
  const [fix, setFix] = useState<LiveFix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [watching, setWatching] = useState(autoStart);
  const supported = typeof navigator === "undefined" || "geolocation" in navigator;

  useEffect(() => {
    if (!watching || !supported) return;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setPermission("granted");
        setError(null);
        setFix({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracyMeters: Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : null,
          timestamp: p.timestamp || Date.now(),
        });
      },
      (e) => {
        if (e.code === e.PERMISSION_DENIED) {
          setPermission("denied");
          setError("Location access is blocked. Allow it for this site in your browser settings.");
        } else {
          setError("Can't get your location yet. Move to open sky and keep this page open.");
        }
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [watching, supported]);

  return {
    permission,
    fix,
    error: supported ? error : "This browser can't share your location.",
    start: () => setWatching(true),
  };
}
