import type {
  HealthDataType,
  HealthRecordOrigin,
  HealthSource,
  NormalizedHealthRecord,
  NormalizedScalarRecord,
  SleepStage,
} from "./types";

type UnknownRecord = Readonly<Record<string, unknown>>;

function object(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null
    ? (value as UnknownRecord)
    : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function iso(value: unknown): string | undefined {
  const date = value instanceof Date ? value : string(value);
  if (date === undefined) return undefined;
  const parsed = date instanceof Date ? date : new Date(date);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined;
}

function sourceForApple(sample: UnknownRecord): HealthSource {
  const revision = object(sample.sourceRevision);
  const source = object(revision?.source);
  const device = object(sample.device);
  const appId = string(source?.bundleIdentifier);
  const appName = string(source?.name);
  const deviceModel = string(device?.model);
  return {
    origin: "apple_healthkit",
    ...(appId ? { appId } : {}),
    ...(appName ? { appName } : {}),
    ...(deviceModel ? { deviceModel } : {}),
  };
}

function sourceForAndroid(record: UnknownRecord): HealthSource {
  const metadata = object(record.metadata);
  const device = object(metadata?.device);
  const appId = string(metadata?.dataOrigin);
  const deviceModel = string(device?.model);
  return {
    origin: "android_health_connect",
    ...(appId ? { appId } : {}),
    ...(deviceModel ? { deviceModel } : {}),
  };
}

function healthConnectId(record: UnknownRecord): string | undefined {
  const metadata = object(record.metadata);
  return string(metadata?.id) ?? string(metadata?.clientRecordId);
}

const APPLE_SCALAR: Readonly<
  Record<
    Exclude<HealthDataType, "sleep" | "workout">,
    {
      kind: NormalizedScalarRecord["kind"];
      unit: NormalizedScalarRecord["unit"];
    }
  >
> = {
  steps: { kind: "steps", unit: "count" },
  heart_rate: { kind: "heart_rate", unit: "bpm" },
  resting_heart_rate: { kind: "resting_heart_rate", unit: "bpm" },
  heart_rate_variability: {
    kind: "heart_rate_variability",
    unit: "ms",
  },
  active_energy: { kind: "active_energy", unit: "kcal" },
};

export function normalizeAppleQuantity(
  type: Exclude<HealthDataType, "sleep" | "workout">,
  input: unknown,
): NormalizedScalarRecord | undefined {
  const sample = object(input);
  if (!sample) return undefined;
  const sourceRecordId = string(sample.uuid);
  const startAt = iso(sample.startDate);
  const endAt = iso(sample.endDate);
  let value = number(sample.quantity);
  if (!sourceRecordId || !startAt || !endAt || value === undefined)
    return undefined;

  // HealthKit's canonical heart-rate unit is count/s. The adapter requests
  // count/min, but keep this guard for older devices or module versions.
  if (
    (type === "heart_rate" || type === "resting_heart_rate") &&
    sample.unit === "count/s"
  )
    value *= 60;

  return {
    schemaVersion: 1,
    sourceRecordId,
    startAt,
    endAt,
    source: sourceForApple(sample),
    ...APPLE_SCALAR[type],
    value,
  };
}

const APPLE_SLEEP_STAGE: Readonly<Record<number, SleepStage>> = {
  0: "in_bed",
  1: "asleep_unspecified",
  2: "awake",
  3: "asleep_core",
  4: "asleep_deep",
  5: "asleep_rem",
};

export function normalizeAppleSleep(
  input: unknown,
): NormalizedHealthRecord | undefined {
  const sample = object(input);
  if (!sample) return undefined;
  const sourceRecordId = string(sample.uuid);
  const startAt = iso(sample.startDate);
  const endAt = iso(sample.endDate);
  if (!sourceRecordId || !startAt || !endAt) return undefined;
  const rawValue = number(sample.value);
  return {
    schemaVersion: 1,
    kind: "sleep",
    sourceRecordId,
    startAt,
    endAt,
    stage:
      rawValue === undefined
        ? "unknown"
        : (APPLE_SLEEP_STAGE[rawValue] ?? "unknown"),
    source: sourceForApple(sample),
  };
}

function quantityValue(value: unknown): number | undefined {
  if (typeof value === "number") return number(value);
  return number(object(value)?.quantity);
}

export function normalizeAppleWorkout(
  input: unknown,
): NormalizedHealthRecord | undefined {
  const proxy = object(input);
  if (!proxy) return undefined;
  const sample =
    typeof proxy.toJSON === "function"
      ? (object((proxy.toJSON as () => unknown)()) ?? proxy)
      : proxy;
  const sourceRecordId = string(sample.uuid);
  const startAt = iso(sample.startDate);
  const endAt = iso(sample.endDate);
  if (!sourceRecordId || !startAt || !endAt) return undefined;
  const fallbackDuration =
    (new Date(endAt).getTime() - new Date(startAt).getTime()) / 1_000;
  const energyKcal = quantityValue(sample.totalEnergyBurned);
  const distanceMeters = quantityValue(sample.totalDistance);
  return {
    schemaVersion: 1,
    kind: "workout",
    sourceRecordId,
    startAt,
    endAt,
    activity: String(sample.workoutActivityType ?? "unknown"),
    durationSeconds: quantityValue(sample.duration) ?? fallbackDuration,
    ...(energyKcal === undefined ? {} : { energyKcal }),
    ...(distanceMeters === undefined ? {} : { distanceMeters }),
    source: sourceForApple(sample),
  };
}

function scalarBase(
  record: UnknownRecord,
  kind: NormalizedScalarRecord["kind"],
  unit: NormalizedScalarRecord["unit"],
  value: number | undefined,
): NormalizedScalarRecord | undefined {
  const sourceRecordId = healthConnectId(record);
  const startAt = iso(record.startTime ?? record.time);
  const endAt = iso(record.endTime ?? record.time);
  if (!sourceRecordId || !startAt || !endAt || value === undefined)
    return undefined;
  return {
    schemaVersion: 1,
    sourceRecordId,
    startAt,
    endAt,
    source: sourceForAndroid(record),
    kind,
    unit,
    value,
  };
}

export function normalizeHealthConnectRecord(
  type: HealthDataType,
  input: unknown,
): NormalizedHealthRecord[] {
  const record = object(input);
  if (!record) return [];

  if (type === "steps") {
    const normalized = scalarBase(
      record,
      "steps",
      "count",
      number(record.count),
    );
    return normalized ? [normalized] : [];
  }
  if (type === "active_energy") {
    const energy = object(record.energy);
    const normalized = scalarBase(
      record,
      "active_energy",
      "kcal",
      number(energy?.inKilocalories),
    );
    return normalized ? [normalized] : [];
  }
  if (type === "resting_heart_rate") {
    const normalized = scalarBase(
      record,
      "resting_heart_rate",
      "bpm",
      number(record.beatsPerMinute),
    );
    return normalized ? [normalized] : [];
  }
  if (type === "heart_rate_variability") {
    const normalized = scalarBase(
      record,
      "heart_rate_variability",
      "ms",
      number(record.heartRateVariabilityMillis),
    );
    return normalized ? [normalized] : [];
  }
  if (type === "heart_rate") {
    const parentId = healthConnectId(record);
    const samples = Array.isArray(record.samples) ? record.samples : [];
    if (!parentId) return [];
    return samples.flatMap((raw, index) => {
      const sample = object(raw);
      const time = iso(sample?.time);
      const value = number(sample?.beatsPerMinute);
      if (!time || value === undefined) return [];
      return [
        {
          schemaVersion: 1 as const,
          kind: "heart_rate" as const,
          sourceRecordId: `${parentId}:${index}:${time}`,
          startAt: time,
          endAt: time,
          source: sourceForAndroid(record),
          unit: "bpm" as const,
          value,
        },
      ];
    });
  }
  if (type === "sleep") {
    const parentId = healthConnectId(record);
    if (!parentId) return [];
    const stages = Array.isArray(record.stages) ? record.stages : [];
    if (stages.length === 0) {
      const startAt = iso(record.startTime);
      const endAt = iso(record.endTime);
      return startAt && endAt
        ? [
            {
              schemaVersion: 1,
              kind: "sleep",
              sourceRecordId: parentId,
              startAt,
              endAt,
              stage: "asleep_unspecified",
              source: sourceForAndroid(record),
            },
          ]
        : [];
    }
    return stages.flatMap((raw, index) => {
      const stage = object(raw);
      const startAt = iso(stage?.startTime);
      const endAt = iso(stage?.endTime);
      if (!startAt || !endAt) return [];
      const stageName = String(stage?.stage ?? "unknown").toLowerCase();
      const mapped: SleepStage = stageName.includes("awake")
        ? "awake"
        : stageName.includes("deep")
          ? "asleep_deep"
          : stageName.includes("rem")
            ? "asleep_rem"
            : stageName.includes("light")
              ? "asleep_core"
              : stageName.includes("out_of_bed")
                ? "in_bed"
                : "asleep_unspecified";
      return [
        {
          schemaVersion: 1 as const,
          kind: "sleep" as const,
          sourceRecordId: `${parentId}:${index}:${startAt}`,
          startAt,
          endAt,
          stage: mapped,
          source: sourceForAndroid(record),
        },
      ];
    });
  }

  const sourceRecordId = healthConnectId(record);
  const startAt = iso(record.startTime);
  const endAt = iso(record.endTime);
  if (!sourceRecordId || !startAt || !endAt) return [];
  const energyKcal = number(object(record.totalEnergyBurned)?.inKilocalories);
  const distanceMeters = number(object(record.distance)?.inMeters);
  return [
    {
      schemaVersion: 1,
      kind: "workout",
      sourceRecordId,
      startAt,
      endAt,
      source: sourceForAndroid(record),
      activity: String(record.exerciseType ?? "unknown"),
      durationSeconds:
        (new Date(endAt).getTime() - new Date(startAt).getTime()) / 1_000,
      ...(energyKcal === undefined ? {} : { energyKcal }),
      ...(distanceMeters === undefined ? {} : { distanceMeters }),
    },
  ];
}

export function companionWorkoutRecord(input: {
  id: string;
  startedAt: string;
  endedAt: string;
  programId?: string;
  sessionId?: string;
  platform: "ios" | "android";
}): NormalizedHealthRecord {
  return {
    schemaVersion: 1,
    kind: "workout",
    sourceRecordId: input.id,
    startAt: input.startedAt,
    endAt: input.endedAt,
    durationSeconds:
      (new Date(input.endedAt).getTime() -
        new Date(input.startedAt).getTime()) /
      1_000,
    activity: "traditional_strength_training",
    source: {
      origin: "orbital_companion" as HealthRecordOrigin,
      appId: `orbital-health-sync:${input.platform}`,
      appName: "Orbital Health Sync",
    },
    ...(input.programId ? { programId: input.programId } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
  };
}

export function deduplicateRecords(
  records: readonly NormalizedHealthRecord[],
): NormalizedHealthRecord[] {
  const byIdentity = new Map<string, NormalizedHealthRecord>();
  for (const record of records)
    byIdentity.set(
      `${record.source.origin}:${record.kind}:${record.sourceRecordId}`,
      record,
    );
  return [...byIdentity.values()].sort(
    (left, right) =>
      left.startAt.localeCompare(right.startAt) ||
      left.sourceRecordId.localeCompare(right.sourceRecordId),
  );
}
