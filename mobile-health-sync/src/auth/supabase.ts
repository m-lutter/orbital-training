import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { createClient, processLock } from "@supabase/supabase-js";
import { mobileConfig } from "../config";

const secureAuthStorage = {
  async getItem(key: string): Promise<string | null> {
    const secured = await SecureStore.getItemAsync(key);
    if (secured !== null) return secured;
    // One-time upgrade for development builds that predate SecureStore.
    const legacy = await AsyncStorage.getItem(key);
    if (legacy === null) return null;
    await SecureStore.setItemAsync(key, legacy, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    await AsyncStorage.removeItem(key);
    return legacy;
  },
  async removeItem(key: string): Promise<void> {
    await Promise.all([
      SecureStore.deleteItemAsync(key),
      AsyncStorage.removeItem(key),
    ]);
  },
  async setItem(key: string, value: string): Promise<void> {
    await SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    await AsyncStorage.removeItem(key);
  },
};

export const supabase = createClient(
  mobileConfig.supabaseUrl,
  mobileConfig.supabasePublishableKey,
  {
    auth: {
      storage: secureAuthStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      lock: processLock,
    },
  },
);
