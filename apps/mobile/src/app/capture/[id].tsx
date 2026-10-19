import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { Banner, Button } from "../../components/ui";
import type { MissionDetail } from "../../lib/api";
import { verificationErrorMessage } from "../../lib/messages";
import { useLocation } from "../../providers/location";
import { useUploadQueue } from "../../providers/queue";
import { useSession } from "../../providers/session";
import { CaptureScreen } from "../../screens/CaptureScreen";
import { colors, space } from "../../theme";

export default function CaptureRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api } = useSession();
  const { fix, permission } = useLocation();
  const { queue } = useUploadQueue();
  const [mission, setMission] = useState<MissionDetail["mission"] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getMission(id)
      .then((d) => !cancelled && setMission(d.mission))
      .catch((e) => !cancelled && setError(verificationErrorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [api, id]);

  if (!mission) {
    return (
      <View style={styles.center}>
        {error ? (
          <>
            <Banner tone="error">{error}</Banner>
            <Button label="Back" variant="ghost" onPress={() => router.back()} />
          </>
        ) : (
          <ActivityIndicator color={colors.lime} />
        )}
      </View>
    );
  }

  return (
    <CaptureScreen
      mission={mission}
      fix={fix}
      permission={permission}
      onClose={() => router.back()}
      onCaptured={async (item) => {
        await queue.enqueue(item);
        router.dismissAll();
        router.navigate("/history");
      }}
    />
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
    padding: space.xl,
    gap: space.md,
  },
});
