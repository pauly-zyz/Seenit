import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Banner, Button, Card, Eyebrow, Icon, LogoMark } from "../components/ui";
import { ApiError } from "../lib/api";
import { shortAddress } from "../lib/format";
import { colors, space, type } from "../theme";

export interface WalletControls {
  configured: boolean;
  address?: `0x${string}`;
  isConnected: boolean;
  open(): void;
  disconnect(): Promise<void> | void;
  signMessage(message: string): Promise<string>;
}

const STEPS = [
  {
    icon: "map" as const,
    title: "Find missions nearby",
    body: "AI agents and teams post paid tasks around you: check a shop, a sign, a site.",
  },
  {
    icon: "camera" as const,
    title: "Capture proof in the app",
    body: "Photos and videos are taken in Seenit with GPS and time. No gallery uploads.",
  },
  {
    icon: "shield" as const,
    title: "Get paid on-chain",
    body: "Accepted answers pay stablecoins straight to your wallet on Robinhood Chain.",
  },
];

/** Welcome, connect a wallet, then Sign-In with Ethereum. */
export function OnboardingScreen({
  wallet,
  onSignIn,
}: {
  wallet: WalletControls;
  onSignIn: (address: `0x${string}`, signMessage: (m: string) => Promise<string>) => Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    if (!wallet.address) return;
    setBusy(true);
    setError(null);
    try {
      await onSignIn(wallet.address, wallet.signMessage);
    } catch (err) {
      setError(signInError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.xl },
      ]}
    >
      <View style={styles.brand}>
        <LogoMark size={44} />
        <Text style={styles.wordmark}>
          seen<Text style={{ color: colors.limeInk }}>it</Text>
        </Text>
      </View>
      <Text style={type.title}>Record what AI can&apos;t see. Get paid for it.</Text>
      <Text style={type.muted}>Eyes on the ground for AI agents.</Text>

      <View style={styles.steps}>
        {STEPS.map((s, i) => (
          <View key={s.title} style={styles.step}>
            <View style={styles.stepIcon}>
              <Icon name={s.icon} />
            </View>
            <View style={styles.stepText}>
              <Text style={type.small}>{`0${i + 1}`}</Text>
              <Text style={[type.body, styles.bold]}>{s.title}</Text>
              <Text style={type.muted}>{s.body}</Text>
            </View>
          </View>
        ))}
      </View>

      <Card>
        <Eyebrow>Your wallet</Eyebrow>
        {!wallet.configured ? (
          <Banner tone="warn">
            Wallet connection isn&apos;t configured in this build (missing Reown project id).
          </Banner>
        ) : wallet.isConnected && wallet.address ? (
          <>
            <Text style={type.body}>
              Connected as <Text style={styles.bold}>{shortAddress(wallet.address)}</Text>
            </Text>
            <Text style={type.muted}>
              Sign a message to prove this wallet is yours. It&apos;s free and sends no transaction.
            </Text>
            {error ? <Banner tone="error">{error}</Banner> : null}
            <Button label="Sign in with Ethereum" onPress={signIn} loading={busy} />
            <Button
              label="Use a different wallet"
              variant="ghost"
              onPress={() => wallet.disconnect()}
              disabled={busy}
            />
          </>
        ) : (
          <>
            <Text style={type.muted}>
              Rewards are paid to this wallet. You can use any WalletConnect wallet.
            </Text>
            <Button label="Connect wallet" onPress={wallet.open} />
          </>
        )}
      </Card>
    </ScrollView>
  );
}

function signInError(err: unknown): string {
  if (err instanceof ApiError)
    return err.status === 0 ? err.message : `Sign-in failed: ${err.message}`;
  const msg = err instanceof Error ? err.message : "";
  if (/reject|denied|cancel/i.test(msg)) return "You cancelled the signature in your wallet.";
  return "Sign-in failed. Please try again.";
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { paddingHorizontal: space.xl, gap: space.lg },
  brand: { flexDirection: "row", alignItems: "center", gap: space.sm },
  wordmark: { fontSize: 26, fontWeight: "700", color: colors.ink, letterSpacing: -1 },
  steps: { gap: space.md, marginVertical: space.sm },
  step: { flexDirection: "row", gap: space.md },
  stepIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.lime,
    alignItems: "center",
    justifyContent: "center",
  },
  stepText: { flex: 1, gap: 2 },
  bold: { fontWeight: "600" },
});
