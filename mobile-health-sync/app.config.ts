import type { ConfigContext, ExpoConfig } from "expo/config";

const IOS_BUNDLE_IDENTIFIER =
  process.env.IOS_BUNDLE_IDENTIFIER ?? "com.example.orbital.healthsync";
const ANDROID_PACKAGE =
  process.env.ANDROID_PACKAGE ?? "com.example.orbital.healthsync";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Orbital Health Sync",
  slug: "orbital-health-sync",
  version: "0.1.0",
  orientation: "portrait",
  scheme: "orbitalhealth",
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier: IOS_BUNDLE_IDENTIFIER,
    supportsTablet: false,
    entitlements: {
      "com.apple.developer.healthkit": true,
    },
    infoPlist: {
      NSHealthShareUsageDescription:
        "Orbital Training reads only the fitness categories you choose so it can personalize training and recovery guidance.",
      NSHealthUpdateUsageDescription:
        "If you opt in, Orbital Training saves completed lifting sessions to Apple Health.",
    },
  },
  android: {
    package: ANDROID_PACKAGE,
    permissions: [
      "android.permission.health.READ_STEPS",
      "android.permission.health.READ_HEART_RATE",
      "android.permission.health.READ_RESTING_HEART_RATE",
      "android.permission.health.READ_HEART_RATE_VARIABILITY",
      "android.permission.health.READ_SLEEP",
      "android.permission.health.READ_ACTIVE_CALORIES_BURNED",
      "android.permission.health.READ_EXERCISE",
      "android.permission.health.WRITE_EXERCISE",
    ],
  },
  plugins: [
    "expo-secure-store",
    [
      "@kingstinct/react-native-healthkit",
      {
        NSHealthShareUsageDescription:
          "Orbital Training reads only the fitness categories you choose so it can personalize training and recovery guidance.",
        NSHealthUpdateUsageDescription:
          "If you opt in, Orbital Training saves completed lifting sessions to Apple Health.",
      },
    ],
    "react-native-health-connect",
    [
      "expo-build-properties",
      {
        android: {
          compileSdkVersion: 36,
          targetSdkVersion: 36,
          minSdkVersion: 26,
        },
      },
    ],
  ],
});
