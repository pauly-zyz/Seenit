import { createContext, useContext } from "react";

import { useLiveLocation } from "../hooks/useLiveLocation";

type LocationValue = ReturnType<typeof useLiveLocation>;

const LocationContext = createContext<LocationValue>({ permission: "undetermined", fix: null });

/** One high-accuracy location watcher shared by the map, mission detail and camera. */
export function LocationProvider({
  children,
  enabled = true,
}: {
  children: React.ReactNode;
  enabled?: boolean;
}) {
  const value = useLiveLocation(enabled);
  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

export const useLocation = () => useContext(LocationContext);
