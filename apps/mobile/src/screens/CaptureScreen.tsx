import type { CaptureMetadata } from "@seenit/shared";
import { CameraView, useCameraPermissions, useMicrophonePermissions } from "expo-camera";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Banner, Button, Icon } from "../components/ui";
import type { MissionDetail } from "../lib/api";
import { evaluateCaptureGate, type LiveFix } from "../lib/capture-gate";
import { deviceInfo as realDeviceInfo } from "../lib/device";
import { persistCapture as realPersist, sha256File as realSha256 } from "../lib/files";
import { formatDistance } from "../lib/format";
import type { QueueItem } from "../lib/upload-queue";
import { colors, radius, space } from "../theme";

export type CaptureEnqueue = Omit<
  QueueItem,
  "state" | "progress" | "attempts" | "nextAttemptAt" | "uploaded" | "createdAt"
>;

export interface CaptureDeps {
  persistCapture: typeof realPersist;
  sha256File: typeof realSha256;
  deviceInfo: typeof realDeviceInfo;
  newId: () => string;
}

const defaultDeps: CaptureDeps = {
  persistCapture: realPersist,
  sha256File: realSha256,
  deviceInfo: realDeviceInfo,
  newId: () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
};

type Phase = "idle" | "recording" | "securing" | "error";

/**
 * In-app camera. There is deliberately no gallery/library picker: only media shot here, inside the
 * mission area, can be submitted. GPS, time and device facts are captured at the shutter and the
 * file's SHA-256 is computed on the device before it enters the upload queue.
 */
export function CaptureScreen({
  mission,
  fix,
  permission,
  now: fixedNow,
  onCaptured,
  onClose,
  deps: depsOverride,
}: {
  mission: MissionDetail["mission"];
  fix: LiveFix | null;
  permission: "granted" | "denied" | "undetermined";
  /** Tests pin the clock; the app ticks every second. */
  now?: number;
  onCaptured: (item: CaptureEnqueue) => Promise<void>;
  onClose: () => void;
  deps?: Partial<CaptureDeps>;
}) {
  const deps = { ...defaultDeps, ...depsOverride };
  const insets = useSafeAreaInsets();
  const camera = useRef<CameraView>(null);
  const [camPerm, requestCam] = useCameraPermissions();
  const [micPerm, requestMic] = useMicrophonePermissions();
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);
  const recordStart = useRef<{ at: number; fix: LiveFix } | null>(null);

  const isVideo = mission.mediaType === "video";
  const maxSeconds = mission.maxVideoSeconds ?? 30;

  useEffect(() => {
    if (fixedNow !== undefined) return;
    const t = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [fixedNow]);

  const now = fixedNow ?? tick;
  const gate = evaluateCaptureGate({ permission, fix, mission, now });

  useEffect(() => {
    if (phase !== "recording" || !recordStart.current) return;
    const t = setInterval(
      () => setElapsed(Math.floor((Date.now() - recordStart.current!.at) / 1000)),
      250,
    );
    return () => clearInterval(t);
  }, [phase]);

  const needsMic = isVideo && !micPerm?.granted;
  if (!camPerm?.granted || needsMic) {
    const denied = camPerm?.canAskAgain === false || (isVideo && micPerm?.canAskAgain === false);
    return (
      <View style={[styles.permission, { paddingTop: insets.top + space.xl }]}>
        <Icon name="camera" size={40} color={colors.lime} />
        <Text style={styles.permTitle}>Camera access needed</Text>
        <Text style={styles.permBody}>
          {isVideo
            ? "Seenit records video in the app so your capture can be verified. Allow camera and microphone."
            : "Seenit takes photos in the app so your capture can be verified. Allow camera access."}
        </Text>
        {denied ? (
          <Banner tone="warn">
            Access was denied. Enable it for Seenit in your device settings.
          </Banner>
        ) : null}
        <Button
          label="Allow access"
          onPress={async () => {
            if (!camPerm?.granted) await requestCam();
            if (isVideo && !micPerm?.granted) await requestMic();
          }}
        />
        <Button label="Back" variant="ghost" onPress={onClose} />
      </View>
    );
  }

  /** Persist, hash and queue a finished capture. */
  async function secure(
    uri: string,
    shutterAt: number,
    shutterFix: LiveFix,
    durationSeconds?: number,
  ) {
    setPhase("securing");
    try {
      const id = deps.newId();
      const ext = isVideo ? "mp4" : "jpg";
      const saved = await deps.persistCapture(uri, id, ext);
      const mediaSha256 = await deps.sha256File(saved.uri);
      const capture: CaptureMetadata = {
        missionId: mission.id,
        source: "in_app_camera",
        mediaType: mission.mediaType,
        mediaSha256,
        capturedAt: new Date(shutterAt).toISOString(),
        gps: {
          lat: shutterFix.lat,
          lng: shutterFix.lng,
          accuracyMeters: shutterFix.accuracyMeters ?? 9999,
          fixAt: new Date(shutterFix.timestamp).toISOString(),
          isMocked: shutterFix.mocked === true,
        },
        ...(durationSeconds !== undefined
          ? { videoDurationSeconds: Math.max(durationSeconds, 0.1) }
          : {}),
        device: deps.deviceInfo(),
      };
      await onCaptured({
        id,
        missionId: mission.id,
        missionTitle: mission.title,
        fileUri: saved.uri,
        contentType: isVideo ? "video/mp4" : "image/jpeg",
        size: saved.size,
        capture,
      });
    } catch {
      setPhase("error");
      setError("Couldn't save the capture. Please try again.");
    }
  }

  async function takePhoto() {
    if (!gate.canRecord || !fix || !camera.current) return;
    const shutterAt = Date.now();
    const shutterFix = fix;
    setError(null);
    try {
      const photo = await camera.current.takePictureAsync({
        quality: 0.9,
        exif: false,
        skipProcessing: false,
      });
      if (!photo?.uri) throw new Error("no photo");
      await secure(photo.uri, shutterAt, shutterFix);
    } catch {
      setPhase("error");
      setError("The camera didn't return a photo. Please try again.");
    }
  }

  async function startVideo() {
    if (!gate.canRecord || !fix || !camera.current) return;
    setError(null);
    recordStart.current = { at: Date.now(), fix };
    setElapsed(0);
    setPhase("recording");
    try {
      const video = await camera.current.recordAsync({ maxDuration: maxSeconds });
      const start = recordStart.current;
      if (!video?.uri || !start) throw new Error("no video");
      await secure(video.uri, start.at, start.fix, (Date.now() - start.at) / 1000);
    } catch {
      setPhase("error");
      setError("Recording stopped unexpectedly. Please try again.");
    }
  }

  const busy = phase === "securing";
  const recording = phase === "recording";
  // While recording the button stops; otherwise it is gated on location.
  const shutterEnabled = ready && !busy && (recording || gate.canRecord);

  return (
    <View style={styles.screen}>
      <CameraView
        ref={camera}
        style={StyleSheet.absoluteFill}
        facing="back"
        mode={isVideo ? "video" : "picture"}
        mute={false}
        onCameraReady={() => setReady(true)}
        testID="camera"
      />

      <View style={[styles.top, { paddingTop: insets.top + space.sm }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close camera"
          onPress={onClose}
          disabled={recording || busy}
          style={styles.iconButton}
        >
          <Icon name="close" color={colors.paper} />
        </Pressable>
        <Text style={styles.missionTitle} numberOfLines={1}>
          {mission.title}
        </Text>
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + space.lg }]}>
        <View
          accessibilityLiveRegion="polite"
          testID="gate-status"
          style={[styles.status, gate.canRecord ? styles.statusOk : styles.statusBlocked]}
        >
          <View
            style={[styles.dot, { backgroundColor: gate.canRecord ? colors.lime : colors.warn }]}
          />
          <Text style={styles.statusText}>
            {gate.message}
            {gate.distanceMeters !== undefined
              ? ` · ${formatDistance(gate.distanceMeters)} from center`
              : ""}
            {fix?.accuracyMeters ? ` · ±${Math.round(fix.accuracyMeters)} m` : ""}
          </Text>
        </View>
        {error ? <Banner tone="error">{error}</Banner> : null}

        <View style={styles.controls}>
          <Text style={styles.hint}>
            {isVideo
              ? recording
                ? `${elapsed}s / ${maxSeconds}s`
                : `Video · up to ${maxSeconds}s`
              : "Photo"}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              isVideo ? (recording ? "Stop recording" : "Start recording") : "Take photo"
            }
            accessibilityState={{ disabled: !shutterEnabled, busy }}
            disabled={!shutterEnabled}
            onPress={() => {
              if (!isVideo) void takePhoto();
              else if (recording) camera.current?.stopRecording();
              else void startVideo();
            }}
            style={[styles.shutter, !shutterEnabled && styles.shutterOff]}
            testID="shutter"
          >
            {busy ? (
              <ActivityIndicator color={colors.ink} />
            ) : (
              <View
                style={[
                  styles.shutterInner,
                  isVideo && styles.recInner,
                  recording && styles.recStop,
                ]}
              />
            )}
          </Pressable>
          <Text style={styles.hint}>{busy ? "Securing…" : "In-app only"}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000" },
  permission: {
    flex: 1,
    backgroundColor: colors.ink,
    padding: space.xl,
    gap: space.lg,
    alignItems: "stretch",
  },
  permTitle: { color: colors.paper, fontSize: 24, fontWeight: "700" },
  permBody: { color: "#c9ccd1", fontSize: 15, lineHeight: 21 },
  top: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(14,17,22,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  missionTitle: { flex: 1, color: colors.paper, fontWeight: "600", fontSize: 16 },
  bottom: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space.lg,
    gap: space.md,
  },
  status: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
  },
  statusOk: { backgroundColor: "rgba(14,17,22,0.75)" },
  statusBlocked: { backgroundColor: "rgba(14,17,22,0.85)" },
  dot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { color: colors.paper, flex: 1, fontSize: 14 },
  controls: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  hint: { color: colors.paper, width: 96, textAlign: "center", fontSize: 13 },
  shutter: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 4,
    borderColor: colors.paper,
    alignItems: "center",
    justifyContent: "center",
  },
  shutterOff: { opacity: 0.35 },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.lime },
  recInner: { backgroundColor: colors.rec },
  recStop: { width: 30, height: 30, borderRadius: 6 },
});
