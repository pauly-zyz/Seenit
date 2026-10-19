import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * Native config. Secrets never go here: only EXPO_PUBLIC_* values (which are public anyway)
 * and the Google Maps key, which Google restricts per app signature.
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Seenit",
  slug: "seenit",
  scheme: "seenit",
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "light",
  ios: {
    supportsTablet: false,
    bundleIdentifier: "xyz.seenit.app",
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        "Seenit checks that you are inside a mission area and stamps each capture with your location.",
      // Lets AppKit detect installed wallets.
      LSApplicationQueriesSchemes: ["metamask", "trust", "rainbow", "uniswap", "zerion", "safe"],
    },
  },
  android: {
    package: "xyz.seenit.app",
    adaptiveIcon: {
      backgroundColor: "#0E1116",
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    predictiveBackGestureEnabled: false,
    // No READ_MEDIA_* / storage permissions: the app never reads the gallery.
    blockedPermissions: [
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      "android.permission.READ_MEDIA_IMAGES",
      "android.permission.READ_MEDIA_VIDEO",
    ],
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    [
      "expo-camera",
      {
        cameraPermission: "Seenit uses the camera to capture mission proof inside the app.",
        microphonePermission: "Seenit records audio with video missions.",
        recordAudioAndroid: true,
        barcodeScannerEnabled: false,
      },
    ],
    [
      "expo-location",
      {
        locationWhenInUsePermission:
          "Seenit checks that you are inside a mission area and stamps each capture with your location.",
      },
    ],
    [
      "react-native-maps",
      {
        androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY,
        iosGoogleMapsApiKey: process.env.GOOGLE_MAPS_IOS_API_KEY,
      },
    ],
  ],
  experiments: { typedRoutes: true },
});
