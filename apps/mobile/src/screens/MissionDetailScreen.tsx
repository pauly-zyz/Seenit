import { haversineMeters } from "@seenit/shared";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import MapView, { Circle, Marker } from "react-native-maps";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Banner, Button, Card, Eyebrow, Pill, Row } from "../components/ui";
import { config } from "../config";
import type { MissionDetail, SeenitApi } from "../lib/api";
import type { LiveFix } from "../lib/capture-gate";
import { formatDistance, formatReward, formatTimeLeft } from "../lib/format";
import { exampleFromSchema } from "../lib/missions";
import { verificationErrorMessage } from "../lib/messages";
import { colors, radius, space, type } from "../theme";
import { submissionStatusLabel } from "./status";

/** Instructions, reward, area, deadline and the answer the AI will extract. */
export function MissionDetailScreen({
  api,
  missionId,
  fix,
  now = new Date(),
  onStartCapture,
  onVerify,
}: {
  api: Pick<SeenitApi, "getMission">;
  missionId: string;
  fix: LiveFix | null;
  now?: Date;
  onStartCapture: () => void;
  onVerify: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<MissionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .getMission(missionId)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(verificationErrorMessage(e)));
  }, [api, missionId]);

  useEffect(() => {
    let cancelled = false;
    api
      .getMission(missionId)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(verificationErrorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [api, missionId]);

  if (!data) {
    return (
      <View style={[styles.screen, styles.center]}>
        {error ? (
          <>
            <Banner tone="error">{error}</Banner>
            <Button label="Try again" variant="ghost" onPress={load} />
          </>
        ) : (
          <ActivityIndicator accessibilityLabel="Loading mission" color={colors.ink} />
        )}
      </View>
    );
  }

  const { mission: m, access, mySubmission } = data;
  const distance = fix ? haversineMeters(m.location, fix) : null;
  const example = JSON.stringify(exampleFromSchema(m.outputSchema), null, 2);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xl }]}
    >
      <MapView
        style={styles.map}
        initialRegion={{
          latitude: m.location.lat,
          longitude: m.location.lng,
          latitudeDelta: Math.max((m.radiusMeters / 111_000) * 5, 0.004),
          longitudeDelta: Math.max((m.radiusMeters / 111_000) * 5, 0.004),
        }}
        showsUserLocation
        accessibilityLabel={`Mission area, ${m.radiusMeters} meter radius`}
      >
        <Circle
          center={{ latitude: m.location.lat, longitude: m.location.lng }}
          radius={m.radiusMeters}
          strokeColor={colors.limeInk}
          fillColor="rgba(200, 240, 81, 0.25)"
        />
        <Marker
          coordinate={{ latitude: m.location.lat, longitude: m.location.lng }}
          title={m.title}
        />
      </MapView>

      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={[type.h2, styles.flex]}>{m.title}</Text>
          <Text style={styles.reward}>
            {formatReward(m.reward, config.tokenDecimals, config.tokenSymbol)}
          </Text>
        </View>
        <View style={styles.pills}>
          <Pill label={formatTimeLeft(m.deadline, now)} tone={m.open ? "muted" : "danger"} />
          <Pill
            label={m.mediaType === "video" ? `Video, up to ${m.maxVideoSeconds ?? 30}s` : "1 photo"}
          />
          <Pill label={`Tier ${m.minTier}`} tone={access.locked ? "warn" : "verify"} />
          <Pill label={`${m.slotsLeft} of ${m.maxCaptures} slots left`} />
        </View>

        <Card>
          <Eyebrow>What to capture</Eyebrow>
          <Text style={type.body}>{m.instructions}</Text>
        </Card>

        <Card>
          <Eyebrow>Details</Eyebrow>
          <Row label="Area" value={`${m.radiusMeters} m radius`} />
          <Row
            label="You are"
            value={distance === null ? "Locating…" : `${formatDistance(distance)} from the center`}
          />
          <Row label="Deadline" value={new Date(m.deadline).toLocaleString()} />
        </Card>

        <Card>
          <Eyebrow>Answer the AI will extract</Eyebrow>
          <Text style={type.muted}>
            Your capture is turned into this structured answer for the requester.
          </Text>
          <View style={styles.code} accessibilityLabel="Example output">
            <Text style={styles.codeText}>{example}</Text>
          </View>
        </Card>

        {mySubmission ? (
          <Banner
            tone={
              mySubmission.status === "accepted"
                ? "success"
                : mySubmission.status === "rejected"
                  ? "error"
                  : "info"
            }
          >
            {`Your submission: ${submissionStatusLabel(mySubmission.status).label}`}
          </Banner>
        ) : access.locked ? (
          <>
            <Banner tone="warn">{`This mission needs Tier ${access.requiredTier}. You're Tier ${access.yourTier}.`}</Banner>
            <Button label={`Unlock Tier ${access.requiredTier}`} onPress={onVerify} />
          </>
        ) : !m.open ? (
          <Banner tone="info">This mission is closed or full.</Banner>
        ) : (
          <Button
            label="Open camera"
            onPress={onStartCapture}
            accessibilityHint="Recording unlocks inside the mission area"
          />
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  center: { alignItems: "center", justifyContent: "center", padding: space.xl, gap: space.md },
  content: {},
  map: { height: 240 },
  body: { padding: space.xl, gap: space.lg },
  titleRow: { flexDirection: "row", gap: space.md, alignItems: "flex-start" },
  flex: { flex: 1 },
  reward: {
    backgroundColor: colors.lime,
    color: colors.ink,
    fontWeight: "700",
    fontSize: 16,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    overflow: "hidden",
  },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  code: { backgroundColor: colors.ink, borderRadius: radius.md, padding: space.md },
  codeText: { fontFamily: "monospace", fontSize: 12, color: colors.lime, lineHeight: 18 },
});
