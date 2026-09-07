import {
  ExerciseType,
  aggregateGroupByDuration,
  aggregateGroupByPeriod,
  initialize,
  insertRecords,
  openHealthConnectSettings,
  readRecords,
  requestPermission,
  type BackgroundAccessPermission,
  type Permission,
  type ReadHealthDataHistoryPermission,
  type RecordType,
} from "react-native-health-connect";
import { normalizeHealthConnectRecord } from "./normalize";
import { selectedHealthDataTypes } from "./permissions";
import type {
  CompletedWorkout,
  HealthDataType,
  HealthPermissionSelection,
  HealthProvider,
  HealthReadResult,
  NormalizedHealthRecord,
} from "./types";

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

const RECORD_TYPE: Readonly<Record<HealthDataType, RecordType>> = {
  steps: "Steps",
  heart_rate: "HeartRate",
  resting_heart_rate: "RestingHeartRate",
  heart_rate_variability: "HeartRateVariabilityRmssd",
  sleep: "SleepSession",
  active_energy: "ActiveCaloriesBurned",
  workout: "ExerciseSession",
};

export class AndroidHealthConnectProvider implements HealthProvider {
  readonly name = "android_health_connect" as const;

  async getAvailability() {
    try {
      const available = await initialize();
      return available
        ? { available: true }
        : {
            available: false,
            reason: "Health Connect is not installed or needs an update.",
          };
    } catch {
      return {
        available: false,
        reason: "Health Connect is not available on this device.",
      };
    }
  }

  async requestPermissions(
    selection: HealthPermissionSelection,
  ): Promise<void> {
    const permissions: Array<
      Permission | BackgroundAccessPermission | ReadHealthDataHistoryPermission
    > = selectedHealthDataTypes(selection).map((type) => ({
      accessType: "read",
      recordType: RECORD_TYPE[type],
    }));
    if (selection.writeCompletedWorkouts)
      permissions.push({ accessType: "write", recordType: "ExerciseSession" });
    if (selection.allowBackgroundRead)
      permissions.push({
        accessType: "read",
        recordType: "BackgroundAccessPermission",
      });
    if (selection.allowHistoryOlderThan30Days)
      permissions.push({
        accessType: "read",
        recordType: "ReadHealthDataHistory",
      });
    if (permissions.length === 0) return;
    await requestPermission(permissions);
  }

  async read(input: {
    selection: HealthPermissionSelection;
    cursor?: import("./types").HealthCursor;
    window: import("./types").HealthReadWindow;
    limit: number;
    mode: "daily" | "workout";
  }): Promise<HealthReadResult> {
    const normalized: NormalizedHealthRecord[] = [];
    const selected = new Set(selectedHealthDataTypes(input.selection));
    const timeRangeFilter = {
      operator: "between" as const,
      startTime: input.window.startAt,
      endTime: input.window.endAt,
    };

    if (input.mode === "workout") {
      if (!selected.has("heart_rate"))
        return {
          records: [],
          deletions: [],
          truncated: false,
          nextCursor: {
            schemaVersion: 1,
            provider: this.name,
            lastWindowEndAt: input.window.endAt,
          },
        };

      let pageToken: string | undefined;
      let truncated = false;
      let lastProcessedAt: string | undefined;
      do {
        const result = await readRecords("HeartRate", {
          timeRangeFilter,
          pageSize: 500,
          ...(pageToken ? { pageToken } : {}),
          ascendingOrder: true,
        });
        const samples = (result.records ?? [])
          .flatMap((record) =>
            normalizeHealthConnectRecord("heart_rate", record),
          )
          .filter(
            (record) =>
              record.startAt >= input.window.startAt &&
              record.startAt <= input.window.endAt,
          )
          .sort((left, right) => left.startAt.localeCompare(right.startAt));
        const remaining = input.limit - normalized.length;
        normalized.push(...samples.slice(0, Math.max(0, remaining)));
        lastProcessedAt = normalized.at(-1)?.startAt ?? lastProcessedAt;
        pageToken = result.pageToken;
        if (
          samples.length > remaining ||
          (pageToken && remaining <= samples.length)
        )
          truncated = true;
      } while (pageToken && !truncated);

      return {
        records: normalized,
        deletions: [],
        truncated,
        nextCursor: {
          schemaVersion: 1,
          provider: this.name,
          lastWindowEndAt:
            truncated && lastProcessedAt ? lastProcessedAt : input.window.endAt,
        },
      };
    }

    const append = (records: readonly NormalizedHealthRecord[]) => {
      if (normalized.length + records.length > input.limit)
        throw new Error(
          "The Health Connect snapshot exceeded the safe record limit. Sync a shorter history window and retry.",
        );
      normalized.push(...records);
    };

    if (selected.has("steps")) {
      const groups = await aggregateGroupByPeriod({
        recordType: "Steps",
        timeRangeFilter,
        timeRangeSlicer: { period: "DAYS", length: 1 },
      });
      append(
        groups.flatMap(({ result, startTime, endTime }) =>
          Number.isFinite(result.COUNT_TOTAL)
            ? [
                {
                  schemaVersion: 1 as const,
                  kind: "steps" as const,
                  sourceRecordId: `aggregate:steps:${startTime}`,
                  startAt: startTime,
                  endAt: endTime,
                  source: { origin: this.name },
                  unit: "count" as const,
                  value: result.COUNT_TOTAL,
                },
              ]
            : [],
        ),
      );
    }

    if (selected.has("active_energy")) {
      const groups = await aggregateGroupByPeriod({
        recordType: "ActiveCaloriesBurned",
        timeRangeFilter,
        timeRangeSlicer: { period: "DAYS", length: 1 },
      });
      append(
        groups.flatMap(({ result, startTime, endTime }) => {
          const value = result.ACTIVE_CALORIES_TOTAL?.inKilocalories;
          return Number.isFinite(value)
            ? [
                {
                  schemaVersion: 1 as const,
                  kind: "active_energy" as const,
                  sourceRecordId: `aggregate:active-energy:${startTime}`,
                  startAt: startTime,
                  endAt: endTime,
                  source: { origin: this.name },
                  unit: "kcal" as const,
                  value,
                },
              ]
            : [];
        }),
      );
    }

    if (selected.has("heart_rate")) {
      const endMs = Date.parse(input.window.endAt);
      const heartRateStartAt = new Date(
        Math.max(Date.parse(input.window.startAt), endMs - THREE_DAYS_MS),
      ).toISOString();
      const groups = await aggregateGroupByDuration({
        recordType: "HeartRate",
        timeRangeFilter: {
          operator: "between",
          startTime: heartRateStartAt,
          endTime: input.window.endAt,
        },
        timeRangeSlicer: { duration: "MINUTES", length: 5 },
      });
      append(
        groups.flatMap(({ result, startTime, endTime }) =>
          result.MEASUREMENTS_COUNT > 0 &&
          Number.isFinite(result.BPM_AVG) &&
          Number.isFinite(result.BPM_MIN) &&
          Number.isFinite(result.BPM_MAX)
            ? [
                {
                  schemaVersion: 1 as const,
                  kind: "heart_rate_bucket" as const,
                  sourceRecordId: `aggregate:heart-rate:${startTime}`,
                  startAt: startTime,
                  endAt: endTime,
                  source: { origin: this.name },
                  unit: "bpm" as const,
                  averageBpm: result.BPM_AVG,
                  minimumBpm: result.BPM_MIN,
                  maximumBpm: result.BPM_MAX,
                  sampleCount: result.MEASUREMENTS_COUNT,
                },
              ]
            : [],
        ),
      );
    }

    for (const type of selected) {
      if (type === "steps" || type === "active_energy" || type === "heart_rate")
        continue;
      let pageToken: string | undefined;
      do {
        const remaining = input.limit - normalized.length;
        if (remaining <= 0)
          throw new Error(
            "The Health Connect snapshot exceeded the safe record limit.",
          );
        const result = await readRecords(RECORD_TYPE[type], {
          timeRangeFilter,
          pageSize: Math.min(remaining, 500),
          ...(pageToken ? { pageToken } : {}),
          ascendingOrder: true,
        });
        for (const record of result.records ?? []) {
          const next = normalizeHealthConnectRecord(type, record);
          append(next);
        }
        pageToken = result.pageToken;
      } while (pageToken);
    }

    return {
      records: normalized,
      deletions: [],
      truncated: false,
      nextCursor: {
        schemaVersion: 1,
        provider: this.name,
        lastWindowEndAt: input.window.endAt,
      },
    };
  }

  async writeCompletedWorkout(
    workout: CompletedWorkout,
  ): Promise<string | null> {
    const ids = await insertRecords([
      {
        recordType: "ExerciseSession",
        startTime: workout.startedAt,
        endTime: workout.endedAt,
        exerciseType: ExerciseType.WEIGHTLIFTING,
        title: "Orbital Training workout",
        metadata: {
          clientRecordId: workout.id,
          clientRecordVersion: 1,
        },
      },
    ]);
    return ids[0] ?? null;
  }

  async openPermissionSettings(): Promise<void> {
    await openHealthConnectSettings();
  }
}
