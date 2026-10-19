import { AppKit, AppKitProvider } from "@reown/appkit-react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { appKit } from "../lib/wallet";
import { LocationProvider } from "../providers/location";
import { UploadQueueProvider } from "../providers/queue";
import { SessionProvider, useSession } from "../providers/session";
import { colors } from "../theme";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppKitProvider instance={appKit}>
        <SessionProvider>
          <UploadQueueProvider>
            <StatusBar style="dark" />
            <Routes />
            {/* AppKit's modal must sit above the router; an absolute wrapper keeps it visible on Android. */}
            <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
              <AppKit />
            </View>
          </UploadQueueProvider>
        </SessionProvider>
      </AppKitProvider>
    </SafeAreaProvider>
  );
}

function Routes() {
  const { status } = useSession();
  if (status === "loading") {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.ink} />
      </View>
    );
  }
  const signedIn = status === "signedIn";
  return (
    <LocationProvider enabled={signedIn}>
      <Stack
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.paper } }}
      >
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="onboarding" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="mission/[id]"
            options={{
              headerShown: true,
              title: "Mission",
              headerTintColor: colors.ink,
              headerBackTitle: "Back",
            }}
          />
          <Stack.Screen
            name="capture/[id]"
            options={{ presentation: "fullScreenModal", animation: "fade" }}
          />
        </Stack.Protected>
      </Stack>
    </LocationProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.paper,
  },
});
