import AsyncStorage from "@react-native-async-storage/async-storage";
import type {
  HealthCursor,
  HealthPermissionSelection,
  HealthProviderName,
} from "../health/types";
import { DEFAULT_PERMISSION_SELECTION } from "../health/permissions";

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export const deviceStorage: KeyValueStorage = AsyncStorage;

const key = {
  permissions: (userId: string, provider: HealthProviderName) =>
    `health:v1:${userId}:${provider}:permissions`,
  cursor: (userId: string, provider: HealthProviderName) =>
    `health:v1:${userId}:${provider}:cursor`,
  lastSuccess: (userId: string, provider: HealthProviderName) =>
    `health:v1:${userId}:${provider}:last-success`,
  catchUpNeeded: (userId: string, provider: HealthProviderName) =>
    `health:v1:${userId}:${provider}:catch-up-needed`,
  activeWorkout: (userId: string) => `health:v1:${userId}:active-workout`,
};

function parseObject<T>(value: string | null): T | undefined {
  if (value === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as T)
      : undefined;
  } catch {
    return undefined;
  }
}

export class HealthStateStore {
  constructor(private readonly storage: KeyValueStorage = deviceStorage) {}

  async getPermissions(
    userId: string,
    provider: HealthProviderName,
  ): Promise<HealthPermissionSelection> {
    return (
      parseObject<HealthPermissionSelection>(
        await this.storage.getItem(key.permissions(userId, provider)),
      ) ?? DEFAULT_PERMISSION_SELECTION
    );
  }

  async setPermissions(
    userId: string,
    provider: HealthProviderName,
    value: HealthPermissionSelection,
  ): Promise<void> {
    await this.storage.setItem(
      key.permissions(userId, provider),
      JSON.stringify(value),
    );
  }

  async getCursor(
    userId: string,
    provider: HealthProviderName,
  ): Promise<HealthCursor | undefined> {
    return parseObject<HealthCursor>(
      await this.storage.getItem(key.cursor(userId, provider)),
    );
  }

  async commitSuccess(input: {
    userId: string;
    provider: HealthProviderName;
    cursor: HealthCursor;
    at: string;
  }): Promise<void> {
    await this.storage.setItem(
      key.cursor(input.userId, input.provider),
      JSON.stringify(input.cursor),
    );
    await this.storage.setItem(
      key.lastSuccess(input.userId, input.provider),
      input.at,
    );
    await this.storage.removeItem(
      key.catchUpNeeded(input.userId, input.provider),
    );
  }

  getLastSuccess(
    userId: string,
    provider: HealthProviderName,
  ): Promise<string | null> {
    return this.storage.getItem(key.lastSuccess(userId, provider));
  }

  async markCatchUpNeeded(
    userId: string,
    provider: HealthProviderName,
  ): Promise<void> {
    await this.storage.setItem(
      key.catchUpNeeded(userId, provider),
      new Date().toISOString(),
    );
  }

  getCatchUpNeeded(
    userId: string,
    provider: HealthProviderName,
  ): Promise<string | null> {
    return this.storage.getItem(key.catchUpNeeded(userId, provider));
  }

  getActiveWorkout(userId: string): Promise<string | null> {
    return this.storage.getItem(key.activeWorkout(userId));
  }

  setActiveWorkout(userId: string, value: string): Promise<void> {
    return this.storage.setItem(key.activeWorkout(userId), value);
  }

  clearActiveWorkout(userId: string): Promise<void> {
    return this.storage.removeItem(key.activeWorkout(userId));
  }
}
