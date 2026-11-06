"use client";

import { useQuery } from "@tanstack/react-query";
import { Lock, MapPin } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { NearbyMap } from "@/components/dashboard/maps";
import { Badge, Button, Card, Notice, inputClass } from "@/components/dashboard/ui";
import { formatDistance, formatReward, formatTimeLeft } from "@/lib/contributor/format";
import {
  applyFilters,
  DISTANCE_OPTIONS_KM,
  isLocked,
  sortForList,
} from "@/lib/contributor/missions";
import type { NearbyMission, PersonhoodStatus } from "@/lib/contributor/types";

import { useNow } from "@/components/dashboard/use-now";

import { apiErrorMessage, useMeta } from "./gate";
import { useContributorApi } from "./providers";
import { type LiveLocation, useLiveLocation } from "./use-location";

/** Missions near the contributor: map + list, filtered by distance. */
export function MissionsView({
  me,
  location: injected,
  now: fixedNow,
}: {
  me: PersonhoodStatus;
  location?: LiveLocation;
  now?: number;
}) {
  const ticking = useNow();
  const now = fixedNow ?? ticking;
  const live = useLiveLocation(!injected);
  const location = injected ?? live;
  const api = useContributorApi();
  const meta = useMeta();
  const router = useRouter();
  const [maxKm, setMaxKm] = useState<number>(10);
  const token = meta.data?.token ?? { symbol: "USDG", decimals: 6 };

  // Round the query position (~100 m) so small GPS jitter doesn't refetch.
  const q = location.fix
    ? {
        lat: Math.round(location.fix.lat * 1000) / 1000,
        lng: Math.round(location.fix.lng * 1000) / 1000,
      }
    : null;
  const nearby = useQuery({
    queryKey: ["nearby", q?.lat, q?.lng],
    enabled: q !== null,
    queryFn: () => api.nearby({ lat: q!.lat, lng: q!.lng, radiusKm: 25 }),
    refetchInterval: 60_000,
  });

  if (!location.fix) {
    return (
      <Card className="flex flex-col items-center gap-3 py-10 text-center">
        <MapPin className="size-8 text-accent-ink" aria-hidden />
        <h1 className="text-xl font-semibold">Find missions near you</h1>
        <p className="max-w-sm text-sm text-muted">
          Seenit shows paid missions around your current location. Your location is only used to
          find missions and to check captures.
        </p>
        {location.error ? <Notice tone="warn">{location.error}</Notice> : null}
        {location.permission === "denied" ? null : location.error ? null : (
          <p className="text-sm text-muted">Getting your location…</p>
        )}
        <Button onClick={location.start}>Use my location</Button>
      </Card>
    );
  }

  const missions: NearbyMission[] = sortForList(
    applyFilters(nearby.data?.missions ?? [], { maxDistanceKm: maxKm, minReward: 0n }),
    me.tier,
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Missions near you</h1>
          <p className="text-sm text-muted">
            Go to the spot, capture it in the app, get paid when the funder accepts.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted">Within</span>
          <select
            aria-label="Distance"
            className={`${inputClass} h-9 w-auto`}
            value={maxKm}
            onChange={(e) => setMaxKm(Number(e.target.value))}
          >
            {DISTANCE_OPTIONS_KM.map((km) => (
              <option key={km} value={km}>
                {km} km
              </option>
            ))}
          </select>
        </label>
      </div>

      {me.tier === 0 ? (
        <Notice tone="warn">
          Verify that you&apos;re a unique person to take missions.{" "}
          <Link href="/app/verify" className="font-semibold underline">
            Verify now
          </Link>
        </Notice>
      ) : null}

      <NearbyMap
        you={location.fix}
        missions={missions.map((m) => ({
          id: m.id,
          lat: m.location.lat,
          lng: m.location.lng,
          radius: m.radiusMeters,
          label: m.title,
          locked: isLocked(m, me.tier),
        }))}
        onSelect={(id) => router.push(`/app/missions/${id}`)}
      />

      {nearby.isError ? <Notice tone="error">{apiErrorMessage(nearby.error)}</Notice> : null}
      {nearby.isPending ? (
        <p className="py-6 text-center text-sm text-muted">Looking for missions…</p>
      ) : missions.length === 0 && !nearby.isError ? (
        <Card className="py-8 text-center text-sm text-muted">
          No open missions within {maxKm} km right now. Check back later or widen the distance.
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {missions.map((m) => {
            const locked = isLocked(m, me.tier);
            return (
              <li key={m.id}>
                <Link
                  href={`/app/missions/${m.id}`}
                  className="flex items-start justify-between gap-4 rounded-2xl border border-line bg-surface p-4 transition hover:bg-surface-2"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-medium">
                      {locked ? <Lock className="size-4 text-muted" aria-label="Locked" /> : null}
                      <span className="truncate">{m.title}</span>
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      {formatDistance(m.distanceMeters)} away ·{" "}
                      {m.mediaType === "video" ? "Video" : "Photo"} ·{" "}
                      {formatTimeLeft(m.deadline, new Date(now))} · {m.slotsLeft} left
                    </p>
                    {locked ? (
                      <p className="mt-1 text-xs text-muted">Needs Tier {m.minTier}</p>
                    ) : null}
                  </div>
                  <Badge tone={locked ? "neutral" : "accent"}>
                    {formatReward(m.reward, token.decimals, token.symbol)}
                  </Badge>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
