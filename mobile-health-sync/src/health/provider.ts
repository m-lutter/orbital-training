import { Platform } from "react-native";
import { AndroidHealthConnectProvider } from "./android-health-connect";
import { AppleHealthKitProvider } from "./apple-healthkit";
import type { HealthProvider } from "./types";

export function createHealthProvider(): HealthProvider {
  if (Platform.OS === "ios") return new AppleHealthKitProvider();
  if (Platform.OS === "android") return new AndroidHealthConnectProvider();
  throw new Error(`Health sync is unsupported on ${Platform.OS}.`);
}
