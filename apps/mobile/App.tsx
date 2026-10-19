import { StatusBar } from "expo-status-bar";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { createApi } from "./src/lib/api";
import { VerificationScreen } from "./src/screens/VerificationScreen";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const api = useMemo(() => createApi({ baseUrl: API_URL, getToken: () => token }), [token]);

  return (
    <>
      {token ? <VerificationScreen api={api} /> : <DevSignIn onToken={setToken} />}
      <StatusBar style="dark" />
    </>
  );
}

/**
 * Temporary until Sign-In with Ethereum lands in the app: paste a session token from
 * POST /api/auth/verify. The token lives in memory only (never bundled or stored).
 */
function DevSignIn({ onToken }: { onToken: (t: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Seenit</Text>
      <Text style={styles.tagline}>Eyes on the ground for AI agents.</Text>
      <TextInput
        accessibilityLabel="Session token"
        placeholder="Paste a session token (dev)"
        value={value}
        onChangeText={setValue}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
      />
      <Pressable
        accessibilityRole="button"
        style={styles.button}
        onPress={() => value && onToken(value.trim())}
      >
        <Text style={styles.buttonText}>Continue</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f7f7f2",
    justifyContent: "center",
    padding: 24,
    gap: 12,
  },
  title: { fontSize: 32, fontWeight: "700", color: "#0e1116" },
  tagline: { fontSize: 16, color: "#535a65", marginBottom: 12 },
  input: {
    borderWidth: 1,
    borderColor: "#e2e2d9",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
  },
  button: {
    backgroundColor: "#c8f051",
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonText: { fontWeight: "600", color: "#0e1116", fontSize: 15 },
});
