import { Linking } from "react-native";
import {
  WorkoutActivityType,
  isHealthDataAvailable,
  queryCategorySamplesWithAnchor,
  queryQuantitySamplesWithAnchor,
  queryStatisticsCollectionForQuantity,
  queryWorkoutSamplesWithAnchor,
  requestAuthorization,
  saveWorkoutSample,
} from "@kingstinct/react-native-healthkit";
import {
  normalizeAppleQuantity,
  normalizeAppleSleep,
  normalizeAppleWorkout,
} from "./normalize";
import { selectedHealthDataTypes } from "./permissions";
import type {
  CompletedWorkout,
  HealthDataType,
  HealthDeletion,
  HealthPermissionSelection,
  HealthProvider,
  HealthReadResult,
  NormalizedHealthRecord,
} from "./types";

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

type AnchorResponse = {
  readonly samples?: readonly unknown[];
  readonly workouts?: readonly unknown[];
  readonly deletedSamples?: readonly { readonly uuid?: string }[];
  readonly newAnchor?: string;
};

type AnchorQuery = (
  identifierOrOptions: string | Record<string, unknown>,
  maybeOptions?: Record<string, unknown>,
) => Promise<AnchorResponse>;

const quantityQuery = queryQuantitySamplesWithAnchor as unknown as AnchorQuery;
const categoryQuery = queryCategorySamplesWithAnchor as unknown as AnchorQuery;
const workoutQuery = queryWorkoutSamplesWithAnchor as unknown as AnchorQuery;

const QUANTITY_TYPES = {
  steps: {
    identifier: "HKQuantityTypeIdentifierStepCount",
    unit: "count",
  },
  heart_rate: {
    identifier: "HKQuantityTypeIdentifierHeartRate",
    unit: "count/min",
  },
  resting_heart_rate: {
    identifier: "HKQuantityTypeIdentifierRestingHeartRate",
    unit: "count/min",
  },
  heart_rate_variability: {
    identifier: "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
    unit: "ms",
  },
  active_energy: {
    identifier: "HKQuantityTypeIdentifierActiveEnergyBurned",
    unit: "kcal",
  },
} as const;

/**
 * The Worker replaces provider/day aggregates, so these categories must be a
 * complete bounded-window snapshot on every sync. Persisted anchors are safe
 * only for raw/event data that the backend stores idempotently.
 */
const SNAPSHOT_TYPES = new Set<HealthDataType>([
  "steps",
  "resting_heart_rate",
  "heart_rate_variability",
  "sleep",
  "active_energy",
]);

function readIdentifiers(selection: HealthPermissionSelection): string[] {
  const identifiers = selectedHealthDataTypes(selection).map((type) => {
    if (type === "sleep") return "HKCategoryTypeIdentifierSleepAnalysis";
    if (type === "workout") return "HKWorkoutTypeIdentifier";
    return QUANTITY_TYPES[type].identifier;
  });
  return [...new Set(identifiers)];
}

function queryOptions(input: {
  anchor?: string;
  startAt: string;
  endAt: string;
  limit: number;
  unit?: string;
}): Record<string, unknown> {
  return {
    limit: input.limit,
    ...(input.anchor ? { anchor: input.anchor } : {}),
    ...(input.unit ? { unit: input.unit } : {}),
    filter: {
      date: {
        startDate: new Date(input.startAt),
        endDate: new Date(input.endAt),
      },
    },
  };
}

export class AppleHealthKitProvider implements HealthProvider {
  readonly name = "apple_healthkit" as const;

  async getAvailability() {
    const available = await Promise.resolve(isHealthDataAvailable());
    return available
      ? { available: true }
      : {
          available: false,
          reason: "HealthKit is unavailable on this device.",
        };
  }

  async requestPermissions(
    selection: HealthPermissionSelection,
  ): Promise<void> {
    const toRead = readIdentifiers(selection);
    const toShare = selection.writeCompletedWorkouts
      ? ["HKWorkoutTypeIdentifier"]
      : [];
    if (toRead.length === 0 && toShare.length === 0) return;
    await requestAuthorization({
      toRead: toRead as NonNullable<
        Parameters<typeof requestAuthorization>[0]["toRead"]
      >,
      toShare: toShare as NonNullable<
        Parameters<typeof requestAuthorization>[0]["toShare"]
      >,
    });
  }

  async read(input: {
    selection: HealthPermissionSelection;
    cursor?: import("./types").HealthCursor;
    window: import("./types").HealthReadWindow;
    limit: number;
    mode: "daily" | "workout";
  }): Promise<HealthReadResult> {
    const records: NormalizedHealthRecord[] = [];
    const deletions: HealthDeletion[] = [];
    const anchors: Partial<Record<HealthDataType, string>> = {
      ...(input.cursor?.anchors ?? {}),
    };
    let truncated = false;
    const selected = new Set(selectedHealthDataTypes(input.selection));
    const append = (values: readonly NormalizedHealthRecord[]) => {
      if (records.length + values.length > input.limit)
        throw new Error(
          "The Apple Health snapshot exceeded the safe record limit. Sync a shorter history window and retry.",
        );
      records.push(...values);
    };

    if (input.mode === "daily" && selected.has("steps")) {
      const statistics = await queryStatisticsCollectionForQuantity(
        QUANTITY_TYPES.steps.identifier,
        ["cumulativeSum"],
        new Date(input.window.startAt),
        { day: 1 },
        {
          unit: QUANTITY_TYPES.steps.unit,
          filter: {
            date: {
              startDate: new Date(input.window.startAt),
              endDate: new Date(input.window.endAt),
            },
          },
        },
      );
      append(
        statistics.flatMap((value) => {
          const startAt = value.startDate?.toISOString();
          const endAt = value.endDate?.toISOString();
          const quantity = value.sumQuantity?.quantity;
          return startAt && endAt && Number.isFinite(quantity)
            ? [
                {
                  schemaVersion: 1 as const,
                  kind: "steps" as const,
                  sourceRecordId: `aggregate:steps:${startAt}`,
                  startAt,
                  endAt,
                  source: { origin: this.name },
                  unit: "count" as const,
                  value: quantity as number,
                },
              ]
            : [];
        }),
      );
    }

    if (input.mode === "daily" && selected.has("active_energy")) {
      const statistics = await queryStatisticsCollectionForQuantity(
        QUANTITY_TYPES.active_energy.identifier,
        ["cumulativeSum"],
        new Date(input.window.startAt),
        { day: 1 },
        {
          unit: QUANTITY_TYPES.active_energy.unit,
          filter: {
            date: {
              startDate: new Date(input.window.startAt),
              endDate: new Date(input.window.endAt),
            },
          },
        },
      );
      append(
        statistics.flatMap((value) => {
          const startAt = value.startDate?.toISOString();
          const endAt = value.endDate?.toISOString();
          const quantity = value.sumQuantity?.quantity;
          return startAt && endAt && Number.isFinite(quantity)
            ? [
                {
                  schemaVersion: 1 as const,
                  kind: "active_energy" as const,
                  sourceRecordId: `aggregate:active-energy:${startAt}`,
                  startAt,
                  endAt,
                  source: { origin: this.name },
                  unit: "kcal" as const,
                  value: quantity as number,
                },
              ]
            : [];
        }),
      );
    }

    if (input.mode === "daily" && selected.has("heart_rate")) {
      const endMs = Date.parse(input.window.endAt);
      const startAt = new Date(
        Math.max(Date.parse(input.window.startAt), endMs - THREE_DAYS_MS),
      );
      const statistics = await queryStatisticsCollectionForQuantity(
        QUANTITY_TYPES.heart_rate.identifier,
        ["discreteAverage", "discreteMin", "discreteMax"],
        startAt,
        { minute: 5 },
        {
          unit: QUANTITY_TYPES.heart_rate.unit,
          filter: {
            date: {
              startDate: startAt,
              endDate: new Date(input.window.endAt),
            },
          },
        },
      );
      append(
        statistics.flatMap((value) => {
          const bucketStart = value.startDate?.toISOString();
          const bucketEnd = value.endDate?.toISOString();
          const averageBpm = value.averageQuantity?.quantity;
          const minimumBpm = value.minimumQuantity?.quantity;
          const maximumBpm = value.maximumQuantity?.quantity;
          return bucketStart &&
            bucketEnd &&
            Number.isFinite(averageBpm) &&
            Number.isFinite(minimumBpm) &&
            Number.isFinite(maximumBpm)
            ? [
                {
                  schemaVersion: 1 as const,
                  kind: "heart_rate_bucket" as const,
                  sourceRecordId: `aggregate:heart-rate:${bucketStart}`,
                  startAt: bucketStart,
                  endAt: bucketEnd,
                  source: { origin: this.name },
                  unit: "bpm" as const,
                  averageBpm: averageBpm as number,
                  minimumBpm: minimumBpm as number,
                  maximumBpm: maximumBpm as number,
                  // HealthKit exposes the merged statistics but not its
                  // contributing sample count through this bridge.
                  sampleCount: 1,
                },
              ]
            : [];
        }),
      );
    }

    const types =
      input.mode === "workout"
        ? (["heart_rate"] as const).filter((type) => selected.has(type))
        : [...selected].filter(
            (type) =>
              type !== "steps" &&
              type !== "heart_rate" &&
              type !== "active_energy",
          );
    for (const type of types) {
      const snapshot = SNAPSHOT_TYPES.has(type);
      let pageAnchor = snapshot ? undefined : anchors[type];
      if (snapshot) delete anchors[type];

      while (true) {
        const remaining = input.limit - records.length;
        if (remaining <= 0) {
          truncated = true;
          break;
        }
        const pageLimit = Math.min(remaining, 500);
        let response: AnchorResponse;
        if (type === "sleep") {
          response = await categoryQuery(
            "HKCategoryTypeIdentifierSleepAnalysis",
            queryOptions({
              ...(pageAnchor ? { anchor: pageAnchor } : {}),
              startAt: input.window.startAt,
              endAt: input.window.endAt,
              limit: pageLimit,
            }),
          );
          append(
            (response.samples ?? []).flatMap((sample) => {
              const normalized = normalizeAppleSleep(sample);
              return normalized ? [normalized] : [];
            }),
          );
        } else if (type === "workout") {
          response = await workoutQuery(
            queryOptions({
              ...(pageAnchor ? { anchor: pageAnchor } : {}),
              startAt: input.window.startAt,
              endAt: input.window.endAt,
              limit: pageLimit,
            }),
          );
          append(
            (response.workouts ?? []).flatMap((sample) => {
              const normalized = normalizeAppleWorkout(sample);
              return normalized ? [normalized] : [];
            }),
          );
        } else {
          const definition = QUANTITY_TYPES[type];
          response = await quantityQuery(
            definition.identifier,
            queryOptions({
              ...(pageAnchor ? { anchor: pageAnchor } : {}),
              startAt: input.window.startAt,
              endAt: input.window.endAt,
              limit: pageLimit,
              unit: definition.unit,
            }),
          );
          append(
            (response.samples ?? []).flatMap((sample) => {
              const normalized = normalizeAppleQuantity(type, sample);
              return normalized ? [normalized] : [];
            }),
          );
        }

        for (const deleted of response.deletedSamples ?? [])
          if (deleted.uuid)
            deletions.push({ kind: type, sourceRecordId: deleted.uuid });
        const returned =
          type === "workout"
            ? (response.workouts?.length ?? 0)
            : (response.samples?.length ?? 0);
        const hasAnotherPage =
          returned >= pageLimit && typeof response.newAnchor === "string";

        if (!snapshot) {
          if (response.newAnchor) anchors[type] = response.newAnchor;
          if (hasAnotherPage) truncated = true;
          break;
        }
        if (!hasAnotherPage) break;
        pageAnchor = response.newAnchor;
      }
      if (truncated) break;
    }

    return {
      records,
      deletions,
      truncated,
      nextCursor: {
        schemaVersion: 1,
        provider: this.name,
        ...(truncated
          ? input.cursor?.lastWindowEndAt
            ? { lastWindowEndAt: input.cursor.lastWindowEndAt }
            : {}
          : { lastWindowEndAt: input.window.endAt }),
        anchors,
      },
    };
  }

  async writeCompletedWorkout(
    workout: CompletedWorkout,
  ): Promise<string | null> {
    const saved = await saveWorkoutSample(
      WorkoutActivityType.traditionalStrengthTraining,
      [],
      new Date(workout.startedAt),
      new Date(workout.endedAt),
      undefined,
      {
        HKExternalUUID: workout.id,
        HKSyncIdentifier: workout.id,
        HKSyncVersion: 1,
      },
    );
    return saved?.uuid ?? null;
  }

  async openPermissionSettings(): Promise<void> {
    await Linking.openSettings();
  }
}
