import * as Application from "expo-application";
import * as Device from "expo-device";
import { Platform } from "react-native";

/** Device facts attached to every capture (no identifiers). */
export function deviceInfo() {
  return {
    platform: Platform.OS === "ios" ? ("ios" as const) : ("android" as const),
    appVersion: Application.nativeApplicationVersion ?? "dev",
    model: Device.modelName ?? undefined,
    osVersion: Device.osVersion ?? undefined,
  };
}
