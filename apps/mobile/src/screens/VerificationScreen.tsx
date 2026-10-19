import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  ApiError,
  type AttestationInfo,
  type PersonhoodStatus,
  type ProviderId,
  type SeenitApi,
  type TierInfo,
} from "../lib/api";
import { verificationErrorMessage } from "../lib/messages";

const C = {
  ink: "#0e1116",
  paper: "#f7f7f2",
  surface: "#ffffff",
  line: "#e2e2d9",
  muted: "#535a65",
  lime: "#c8f051",
  verify: "#0b7a6e",
  danger: "#b42318",
};

type Busy = { provider: ProviderId; phase: "starting" | "waiting" } | null;

export interface VerificationScreenProps {
  api: SeenitApi;
  /** Opens the provider app (Self). Defaults to Linking.openURL. */
  openUrl?: (url: string) => Promise<unknown>;
  pollIntervalMs?: number;
}

/**
 * Personhood status: current tier, what each tier unlocks, and buttons to verify.
 * Tier 1 checks the Human Passport score in place; Tier 2 hands off to the Self app and polls
 * the session until the proof arrives.
 */
export function VerificationScreen({
  api,
  openUrl = Linking.openURL,
  pollIntervalMs = 3000,
}: VerificationScreenProps) {
  const [status, setStatus] = useState<PersonhoodStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.getPersonhoodStatus());
      setLoadError(null);
    } catch (err) {
      setLoadError(verificationErrorMessage(err));
    }
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    api
      .getPersonhoodStatus()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(verificationErrorMessage(err));
      });
    return () => {
      cancelled = true;
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [api]);

  const pollSession = useCallback(
    (sessionId: string) => {
      const tick = async () => {
        try {
          const s = await api.getSession(sessionId);
          if (s.status === "pending") {
            pollTimer.current = setTimeout(tick, pollIntervalMs);
            return;
          }
          setBusy(null);
          if (s.status === "verified") {
            setMessage({ tone: "success", text: "Passport verified. Tier 2 is unlocked." });
          } else if (s.status === "expired") {
            setMessage({
              tone: "error",
              text: "The verification timed out. Start again when you're ready.",
            });
          } else {
            setMessage({
              tone: "error",
              text: verificationErrorMessage(
                new ApiError(400, s.error ?? "error", "Verification failed", { reason: s.error }),
              ),
            });
          }
          await refresh();
        } catch (err) {
          setBusy(null);
          setMessage({ tone: "error", text: verificationErrorMessage(err) });
        }
      };
      pollTimer.current = setTimeout(tick, pollIntervalMs);
    },
    [api, pollIntervalMs, refresh],
  );

  const verify = useCallback(
    async (provider: ProviderId) => {
      setMessage(null);
      setBusy({ provider, phase: "starting" });
      try {
        const res = await api.startVerification(provider);
        if (res.status === "verified") {
          setBusy(null);
          setMessage({ tone: "success", text: `Verified. You're now Tier ${res.tier}.` });
          await refresh();
          return;
        }
        setBusy({ provider, phase: "waiting" });
        await openUrl(res.url);
        pollSession(res.sessionId);
      } catch (err) {
        setBusy(null);
        setMessage({ tone: "error", text: verificationErrorMessage(err) });
      }
    },
    [api, openUrl, pollSession, refresh],
  );

  if (!status) {
    return (
      <View style={[styles.screen, styles.center]}>
        {loadError ? (
          <>
            <Text style={styles.error}>{loadError}</Text>
            <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={refresh}>
              <Text style={styles.secondaryButtonText}>Try again</Text>
            </Pressable>
          </>
        ) : (
          <ActivityIndicator accessibilityLabel="Loading verification status" color={C.ink} />
        )}
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>VERIFICATION</Text>
      <Text style={styles.title} accessibilityRole="header">
        {status.tier === 0 ? "Not verified yet" : `You're Tier ${status.tier}`}
      </Text>
      <Text style={styles.subtitle}>
        {status.tier === 0
          ? "Verify that you're a unique person to start taking missions."
          : `${status.missionsOpenToYou} active ${status.missionsOpenToYou === 1 ? "mission is" : "missions are"} open to you right now.`}
      </Text>

      {message ? (
        <View
          accessibilityLiveRegion="polite"
          style={[
            styles.banner,
            message.tone === "error" ? styles.bannerError : styles.bannerSuccess,
          ]}
        >
          <Text style={message.tone === "error" ? styles.error : styles.success}>
            {message.text}
          </Text>
        </View>
      ) : null}

      {status.tiers.map((t) => (
        <TierCard
          key={t.tier}
          tier={t}
          attestation={status.attestations.find((a) => a.tier === t.tier)}
          enabled={status.providers.some((p) => p.id === t.provider)}
          busy={busy}
          canStart={t.tier === 1 || status.tier >= 1}
          onVerify={verify}
        />
      ))}

      <Text style={styles.privacy}>
        {
          "Seenit only stores a one-way hash proving you're a unique person, plus the result of the check. Your passport data stays in the Self app and is never sent to us."
        }
      </Text>
    </ScrollView>
  );
}

function TierCard({
  tier,
  attestation,
  enabled,
  busy,
  canStart,
  onVerify,
}: {
  tier: TierInfo;
  attestation?: AttestationInfo;
  enabled: boolean;
  busy: Busy;
  canStart: boolean;
  onVerify: (p: ProviderId) => void;
}) {
  const provider = tier.provider;
  const isBusy = busy !== null && busy.provider === provider;
  const label = tier.tier === 1 ? "Check my Human Passport score" : "Verify with Self";
  const renew = attestation?.state === "expired" || attestation?.state === "pending_onchain";

  return (
    <View style={styles.card} accessibilityLabel={`Tier ${tier.tier}: ${tier.name}`}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>
          Tier {tier.tier} · {tier.name}
        </Text>
        <Text style={[styles.pill, tier.unlocked ? styles.pillOn : styles.pillOff]}>
          {tier.unlocked ? "Unlocked" : "Locked"}
        </Text>
      </View>
      <Text style={styles.unlocks}>{tier.unlocks}</Text>
      <Text style={styles.meta}>
        {tier.activeMissions} active {tier.activeMissions === 1 ? "mission" : "missions"} at this
        tier
      </Text>

      {attestation ? <AttestationLine a={attestation} /> : null}

      {!tier.unlocked || renew ? (
        <>
          <Text style={styles.how}>{tier.howToVerify}</Text>
          {!enabled || !provider ? (
            <Text style={styles.meta}>Not available yet.</Text>
          ) : !canStart ? (
            <Text style={styles.meta}>Unlock Tier 1 first.</Text>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: busy !== null, busy: isBusy }}
              disabled={busy !== null}
              onPress={() => onVerify(provider)}
              style={({ pressed }) => [
                styles.button,
                (pressed || busy !== null) && styles.buttonDim,
              ]}
            >
              {isBusy ? (
                <View style={styles.row}>
                  <ActivityIndicator color={C.ink} />
                  <Text style={styles.buttonText}>
                    {busy?.phase === "waiting" ? "Waiting for the Self app…" : "Checking…"}
                  </Text>
                </View>
              ) : (
                <Text style={styles.buttonText}>{renew ? `${label} again` : label}</Text>
              )}
            </Pressable>
          )}
        </>
      ) : null}
    </View>
  );
}

function AttestationLine({ a }: { a: AttestationInfo }) {
  const date = new Date(a.expiresAt).toISOString().slice(0, 10);
  const text =
    a.state === "active"
      ? `Verified · valid until ${date}`
      : a.state === "pending_onchain"
        ? "Verified · saving on-chain did not finish"
        : a.state === "expired"
          ? `Expired on ${date}`
          : "Revoked";
  return (
    <Text style={[styles.meta, a.state === "active" ? styles.success : styles.error]}>{text}</Text>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.paper },
  center: { alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  content: { padding: 20, paddingTop: 64, gap: 14 },
  eyebrow: { fontSize: 12, letterSpacing: 1.5, color: C.verify, fontWeight: "600" },
  title: { fontSize: 28, fontWeight: "700", color: C.ink },
  subtitle: { fontSize: 16, color: C.muted, lineHeight: 22 },
  banner: { borderRadius: 14, padding: 12, borderWidth: 1 },
  bannerError: { backgroundColor: "#fdecea", borderColor: "#f5c2bd" },
  bannerSuccess: { backgroundColor: "#e6f5f2", borderColor: "#b5e2da" },
  card: {
    backgroundColor: C.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.line,
    padding: 16,
    gap: 8,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  cardTitle: { fontSize: 17, fontWeight: "600", color: C.ink, flexShrink: 1 },
  pill: {
    fontSize: 12,
    fontWeight: "600",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: "hidden",
  },
  pillOn: { backgroundColor: C.lime, color: C.ink },
  pillOff: { backgroundColor: "#efefe8", color: C.muted },
  unlocks: { fontSize: 15, color: C.ink, lineHeight: 21 },
  how: { fontSize: 14, color: C.muted, lineHeight: 20 },
  meta: { fontSize: 13, color: C.muted },
  button: {
    marginTop: 4,
    backgroundColor: C.lime,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonDim: { opacity: 0.6 },
  buttonText: { fontSize: 15, fontWeight: "600", color: C.ink },
  secondaryButton: {
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  secondaryButtonText: { color: C.ink, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  error: { color: C.danger, fontSize: 14, lineHeight: 20 },
  success: { color: C.verify, fontSize: 14, lineHeight: 20 },
  privacy: { fontSize: 12, color: C.muted, lineHeight: 18, marginTop: 8 },
});
