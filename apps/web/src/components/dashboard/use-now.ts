"use client";

import { useEffect, useState } from "react";

/** Current time, refreshed every `intervalMs` (keeps "expired" / countdowns honest). */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
