import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";

import { useSession } from "../providers/session";

/** The contributor's current personhood tier, refreshed whenever the screen gains focus. */
export function useTier() {
  const { api } = useSession();
  const [tier, setTier] = useState(0);
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      api
        .getPersonhoodStatus()
        .then((s) => !cancelled && setTier(s.tier))
        .catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }, [api]),
  );
  return tier;
}
