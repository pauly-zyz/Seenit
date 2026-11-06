"use client";

import dynamic from "next/dynamic";

/** Leaflet needs `window`: load the maps on the client only. */
const placeholder = (h: string) =>
  function MapLoading() {
    return (
      <div
        className={`${h} w-full animate-pulse rounded-xl bg-surface-2`}
        aria-label="Loading map"
      />
    );
  };

export const LocationPickerMap = dynamic(
  () => import("./leaflet-maps").then((m) => m.LocationPickerMap),
  {
    ssr: false,
    loading: placeholder("h-80"),
  },
);

export const SubmissionsMap = dynamic(
  () => import("./leaflet-maps").then((m) => m.SubmissionsMap),
  {
    ssr: false,
    loading: placeholder("h-72"),
  },
);

export const NearbyMap = dynamic(() => import("./leaflet-maps").then((m) => m.NearbyMap), {
  ssr: false,
  loading: placeholder("h-72"),
});

export type { CapturePoint, MissionPin, Point } from "./leaflet-maps";
