import { haversineMeters } from "@seenit/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import MapView, { Marker } from "react-native-maps";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Banner, Icon, Pill } from "../components/ui";
import { config } from "../config";
import type { NearbyMission, SeenitApi } from "../lib/api";
import type { LiveFix } from "../lib/capture-gate";
import { formatDistance, formatReward, formatTimeLeft } from "../lib/format";
import { applyFilters, DISTANCE_OPTIONS_KM, isLocked, sortForList } from "../lib/missions";
import { verificationErrorMessage } from "../lib/messages";
import { colors, radius, space, type } from "../theme";

/** Minimum reward filter options, in whole tokens. */
const REWARD_OPTIONS = [0, 1, 3, 5] as const;
const MAX_RADIUS_KM = Math.max(...DISTANCE_OPTIONS_KM);
const unit = (n: number) => BigInt(n) * 10n ** BigInt(config.tokenDecimals);

export function MissionsScreen({
  api,
  tier,
  fix,
  permission,
  now = new Date(),
  onOpenMission,
  onVerify,
}: {
  api: Pick<SeenitApi, "getNearby">;
  tier: number;
  fix: LiveFix | null;
  permission: "granted" | "denied" | "undetermined";
  now?: Date;
  onOpenMission: (id: string) => void;
  onVerify: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [view, setView] = useState<"map" | "list">("list");
  const [maxDistanceKm, setMaxDistanceKm] = useState<number>(5);
  const [minReward, setMinReward] = useState<number>(0);
  const [missions, setMissions] = useState<NearbyMission[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const center = fix ? { lat: fix.lat, lng: fix.lng } : null;
  // Query on a ~1 km grid so walking around doesn't refetch constantly; distances are recomputed
  // live from the current fix below. The widest radius is fetched once and filtered on the device.
  const gridLat = fix ? Math.round(fix.lat * 100) / 100 : null;
  const gridLng = fix ? Math.round(fix.lng * 100) / 100 : null;
  const fetchNearby = useCallback(
    (lat: number, lng: number) => api.getNearby({ lat, lng, radiusKm: MAX_RADIUS_KM + 1 }),
    [api],
  );

  useEffect(() => {
    if (gridLat === null || gridLng === null) return;
    let cancelled = false;
    fetchNearby(gridLat, gridLng).then(
      (res) => {
        if (cancelled) return;
        setMissions(res.missions);
        setError(null);
      },
      (err) => !cancelled && setError(verificationErrorMessage(err)),
    );
    return () => {
      cancelled = true;
    };
  }, [fetchNearby, gridLat, gridLng]);

  async function refresh() {
    if (!center) return;
    setRefreshing(true);
    try {
      setMissions((await fetchNearby(center.lat, center.lng)).missions);
      setError(null);
    } catch (err) {
      setError(verificationErrorMessage(err));
    } finally {
      setRefreshing(false);
    }
  }

  const visible = useMemo(() => {
    const live = missions.map((m) => {
      if (!center) return m;
      const distanceMeters = haversineMeters(m.location, center);
      return { ...m, distanceMeters, withinMissionRadius: distanceMeters <= m.radiusMeters };
    });
    return sortForList(applyFilters(live, { maxDistanceKm, minReward: unit(minReward) }), tier);
    // center is derived from fix
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missions, fix, maxDistanceKm, minReward, tier]);
  const lockedCount = visible.filter((m) => isLocked(m, tier)).length;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + space.md }]}>
      <View style={styles.header}>
        <Text style={type.title}>Nearby</Text>
        <View style={styles.segment} accessibilityRole="tablist">
          {(["list", "map"] as const).map((v) => (
            <Pressable
              key={v}
              accessibilityRole="tab"
              accessibilityState={{ selected: view === v }}
              onPress={() => setView(v)}
              style={[styles.segmentItem, view === v && styles.segmentOn]}
            >
              <Text style={[styles.segmentText, view === v && styles.segmentTextOn]}>
                {v === "list" ? "List" : "Map"}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.filters}>
        <ChipRow
          label="Distance"
          options={DISTANCE_OPTIONS_KM.map((km) => ({ value: km, label: `${km} km` }))}
          value={maxDistanceKm}
          onChange={setMaxDistanceKm}
        />
        <ChipRow
          label="Reward"
          options={REWARD_OPTIONS.map((r) => ({
            value: r,
            label: r === 0 ? "Any" : `${r}+ ${config.tokenSymbol}`,
          }))}
          value={minReward}
          onChange={setMinReward}
        />
      </View>

      {permission === "denied" ? (
        <View style={styles.pad}>
          <Banner tone="warn">Allow location access to see missions around you.</Banner>
        </View>
      ) : !center ? (
        <View style={styles.pad}>
          <Banner tone="info">Finding your location…</Banner>
        </View>
      ) : null}
      {error ? (
        <View style={styles.pad}>
          <Banner tone="error">{error}</Banner>
        </View>
      ) : null}
      {lockedCount > 0 ? (
        <Pressable accessibilityRole="button" onPress={onVerify} style={styles.pad}>
          <Banner tone="info">{`${lockedCount} locked ${lockedCount === 1 ? "mission needs" : "missions need"} a higher verification tier. Tap to verify.`}</Banner>
        </Pressable>
      ) : null}

      {view === "map" && center ? (
        <MapView
          style={styles.map}
          showsUserLocation
          initialRegion={{
            latitude: center.lat,
            longitude: center.lng,
            latitudeDelta: 0.05,
            longitudeDelta: 0.05,
          }}
          accessibilityLabel="Map of nearby missions"
        >
          {visible.map((m) => (
            <Marker
              key={m.id}
              testID={`marker-${m.id}`}
              coordinate={{ latitude: m.location.lat, longitude: m.location.lng }}
              title={m.title}
              description={`${formatReward(m.reward, config.tokenDecimals, config.tokenSymbol)}${isLocked(m, tier) ? " · locked" : ""}`}
              pinColor={isLocked(m, tier) ? colors.muted : colors.lime}
              onCalloutPress={() => onOpenMission(m.id)}
            />
          ))}
        </MapView>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(m) => m.id}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
          ListEmptyComponent={
            center && !refreshing ? (
              <Text style={[type.muted, styles.empty]}>
                No missions match these filters yet. Try a wider distance.
              </Text>
            ) : undefined
          }
          renderItem={({ item }) => (
            <MissionRow
              mission={item}
              locked={isLocked(item, tier)}
              now={now}
              onPress={() => onOpenMission(item.id)}
            />
          )}
        />
      )}
    </View>
  );
}

function MissionRow({
  mission: m,
  locked,
  now,
  onPress,
}: {
  mission: NearbyMission;
  locked: boolean;
  now: Date;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${m.title}${locked ? ", locked" : ""}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, locked && styles.rowLocked, pressed && styles.pressed]}
    >
      <View style={styles.rowTop}>
        <Text style={[type.body, styles.rowTitle]} numberOfLines={2}>
          {m.title}
        </Text>
        <Text style={[styles.reward, locked && styles.rewardLocked]}>
          {formatReward(m.reward, config.tokenDecimals, config.tokenSymbol)}
        </Text>
      </View>
      <View style={styles.meta}>
        <Icon name="pin" size={14} color={colors.muted} />
        <Text style={type.small}>{formatDistance(m.distanceMeters)}</Text>
        <Text style={type.small}>·</Text>
        <Text style={type.small}>{formatTimeLeft(m.deadline, now)}</Text>
        <Text style={type.small}>·</Text>
        <Text style={type.small}>{m.mediaType === "video" ? "Video" : "Photo"}</Text>
      </View>
      <View style={styles.meta}>
        {locked ? (
          <View style={styles.lockRow}>
            <Icon name="lock" size={14} color={colors.muted} />
            <Text style={type.small}>{`Tier ${m.minTier} needed`}</Text>
          </View>
        ) : m.withinMissionRadius ? (
          <Pill label="You're in range" tone="verify" />
        ) : null}
        <Pill label={`${m.slotsLeft} ${m.slotsLeft === 1 ? "slot" : "slots"} left`} />
      </View>
    </Pressable>
  );
}

function ChipRow<T extends number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.chipRow} accessibilityLabel={`${label} filter`}>
      <Text style={[type.small, styles.chipLabel]}>{label}</Text>
      {options.map((o) => (
        <Pressable
          key={o.value}
          accessibilityRole="radio"
          accessibilityState={{ checked: o.value === value }}
          onPress={() => onChange(o.value)}
          style={[styles.chip, o.value === value && styles.chipOn]}
        >
          <Text style={[styles.chipText, o.value === value && styles.chipTextOn]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: space.xl,
  },
  segment: {
    flexDirection: "row",
    backgroundColor: colors.surface2,
    borderRadius: radius.pill,
    padding: 3,
  },
  segmentItem: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: radius.pill },
  segmentOn: { backgroundColor: colors.ink },
  segmentText: { fontWeight: "600", color: colors.muted },
  segmentTextOn: { color: colors.paper },
  filters: { paddingHorizontal: space.xl, paddingVertical: space.md, gap: space.sm },
  chipRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  chipLabel: { width: 60 },
  chip: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontSize: 13, color: colors.ink },
  chipTextOn: { color: colors.paper, fontWeight: "600" },
  pad: { paddingHorizontal: space.xl, paddingBottom: space.sm },
  map: { flex: 1 },
  list: { paddingHorizontal: space.xl, gap: space.md },
  empty: { textAlign: "center", marginTop: space.xl },
  row: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.lg,
    gap: space.sm,
  },
  rowLocked: { opacity: 0.6 },
  pressed: { opacity: 0.8 },
  rowTop: { flexDirection: "row", justifyContent: "space-between", gap: space.md },
  rowTitle: { fontWeight: "600", flex: 1 },
  reward: {
    backgroundColor: colors.lime,
    color: colors.ink,
    fontWeight: "700",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: "hidden",
    alignSelf: "flex-start",
  },
  rewardLocked: { backgroundColor: colors.surface2, color: colors.muted },
  meta: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  lockRow: { flexDirection: "row", alignItems: "center", gap: 4 },
});
