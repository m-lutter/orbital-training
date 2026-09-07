import type {
  DailyFitnessMetricInput,
  FitnessWorkoutSummaryInput,
  HeartRateBucketInput,
  HeartRateSampleInput,
} from "./sync-types";
import { validTimeZone } from "./validation";
import {
  reconcileSleepEpisodes,
  type SleepIntervalInput,
} from "./sleep-episodes";

export type MobileHealthProvider = "apple_healthkit" | "android_health_connect";

export interface MobileDevicePermissions {
  allowBackgroundRead: boolean;
  allowHistoryOlderThan30Days: boolean;
  readScopes: string[];
  writeCompletedWorkouts: boolean;
}

export interface ParsedMobileConnectionRequest {
  permissions: MobileDevicePermissions;
  provider: MobileHealthProvider;
}

export interface MobileHealthRecord {
  activity?: string;
  averageBpm?: number;
  distanceMeters?: number;
  durationSeconds?: number;
  endAt: string;
  energyKcal?: number;
  kind:
    | "steps"
    | "heart_rate"
    | "heart_rate_bucket"
    | "resting_heart_rate"
    | "heart_rate_variability"
    | "sleep"
    | "active_energy"
    | "workout";
  programId?: string;
  maximumBpm?: number;
  minimumBpm?: number;
  sampleCount?: number;
  sessionId?: string;
  sourceOrigin: MobileHealthProvider | "orbital_companion";
  sourceRecordId: string;
  stage?: string;
  startAt: string;
  value?: number;
}

export interface MobileHealthDeletion {
  kind:
    | "steps"
    | "heart_rate"
    | "resting_heart_rate"
    | "heart_rate_variability"
    | "sleep"
    | "active_energy"
    | "workout";
  sourceRecordId: string;
}

export interface ParsedMobileSyncEnvelope {
  activeWorkout: boolean;
  activeWorkoutSourceSessionKey?: string;
  deletions: MobileHealthDeletion[];
  permissions: MobileDevicePermissions;
  provider: MobileHealthProvider;
  records: MobileHealthRecord[];
  syncRunId: string;
  timeZone: string;
  trigger: string;
}

export interface ActiveMobileWorkout {
  endedAt?: string;
  id: string;
  sourceSessionKey: string;
  startedAt: string;
}

export interface MobileSyncNormalization {
  buckets: HeartRateBucketInput[];
  completedCompanionWorkouts: Array<{
    endedAt: string;
    programId: string;
    sessionId: string;
  }>;
  metrics: DailyFitnessMetricInput[];
  rawSamples: HeartRateSampleInput[];
  summaries: FitnessWorkoutSummaryInput[];
}

const READ_SCOPE_KINDS = new Set([
  "steps",
  "heart_rate",
  "resting_heart_rate",
  "heart_rate_variability",
  "sleep",
  "active_energy",
  "workout",
]);
const RECORD_KINDS = new Set([...READ_SCOPE_KINDS, "heart_rate_bucket"]);
const TRIGGERS = new Set([
  "app_open_daily",
  "foreground_catch_up",
  "background_catch_up",
  "workout_started",
  "workout_stopped",
  "manual",
]);

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function shortString(value: unknown, maximum = 256): string | undefined {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maximum
    ? value
    : undefined;
}

function optionalShortString(
  value: unknown,
  maximum = 256,
): string | undefined {
  return value === undefined ? undefined : shortString(value, maximum);
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function iso(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    ? new Date(milliseconds).toISOString()
    : undefined;
}

function boolean(value: unknown): boolean {
  return value === true;
}

function parsePermissions(value: unknown): MobileDevicePermissions | undefined {
  const permissions = object(value);
  if (permissions === undefined) return undefined;
  const read = object(permissions.read);
  const readScopes = Object.entries(read ?? {})
    .filter(([, allowed]) => allowed === true)
    .map(([scope]) => scope)
    .filter((scope) => READ_SCOPE_KINDS.has(scope))
    .slice(0, 16);
  return {
    readScopes,
    writeCompletedWorkouts: boolean(permissions.writeCompletedWorkouts),
    allowBackgroundRead: boolean(permissions.allowBackgroundRead),
    allowHistoryOlderThan30Days: boolean(
      permissions.allowHistoryOlderThan30Days,
    ),
  };
}

export function parseMobileConnectionRequest(
  value: unknown,
): ParsedMobileConnectionRequest | undefined {
  const input = object(value);
  const provider = input?.provider;
  const permissions = parsePermissions(input?.permissions);
  if (
    input?.schemaVersion !== 1 ||
    (provider !== "apple_healthkit" && provider !== "android_health_connect") ||
    permissions === undefined
  ) {
    return undefined;
  }
  return { provider, permissions };
}

export function mobileConsentScopes(
  permissions: MobileDevicePermissions,
): string[] {
  return [
    ...permissions.readScopes.map((scope) => `read:${scope}`),
    ...(permissions.writeCompletedWorkouts ? ["write:completed_workouts"] : []),
    ...(permissions.allowBackgroundRead ? ["read:background"] : []),
    ...(permissions.allowHistoryOlderThan30Days
      ? ["read:extended_history"]
      : []),
  ];
}

function parseRecord(
  value: unknown,
  provider: MobileHealthProvider,
): MobileHealthRecord | undefined {
  const candidate = object(value);
  const source = object(candidate?.source);
  const kind = candidate?.kind;
  const sourceRecordId = shortString(candidate?.sourceRecordId);
  const startAt = iso(candidate?.startAt);
  const endAt = iso(candidate?.endAt);
  const sourceOrigin = source?.origin;
  if (
    candidate?.schemaVersion !== 1 ||
    typeof kind !== "string" ||
    !RECORD_KINDS.has(kind) ||
    sourceRecordId === undefined ||
    startAt === undefined ||
    endAt === undefined ||
    Date.parse(endAt) < Date.parse(startAt) ||
    Date.parse(endAt) - Date.parse(startAt) > 32 * 24 * 60 * 60 * 1000 ||
    (sourceOrigin !== provider && sourceOrigin !== "orbital_companion")
  ) {
    return undefined;
  }

  const base = {
    kind: kind as MobileHealthRecord["kind"],
    sourceRecordId,
    startAt,
    endAt,
    sourceOrigin: sourceOrigin as MobileHealthRecord["sourceOrigin"],
  };
  if (kind === "heart_rate_bucket") {
    const averageBpm = finite(candidate.averageBpm);
    const minimumBpm = finite(candidate.minimumBpm);
    const maximumBpm = finite(candidate.maximumBpm);
    const sampleCount = finite(candidate.sampleCount);
    if (
      averageBpm === undefined ||
      minimumBpm === undefined ||
      maximumBpm === undefined ||
      sampleCount === undefined ||
      !Number.isInteger(sampleCount) ||
      sampleCount < 1 ||
      sampleCount > 100_000 ||
      minimumBpm < 20 ||
      maximumBpm > 300 ||
      minimumBpm > averageBpm ||
      averageBpm > maximumBpm ||
      Date.parse(endAt) - Date.parse(startAt) > 5 * 60_000
    ) {
      return undefined;
    }
    return {
      ...base,
      kind,
      averageBpm,
      minimumBpm,
      maximumBpm,
      sampleCount,
    };
  }
  if (kind === "sleep") {
    const stage = shortString(candidate.stage, 64);
    return stage === undefined ? undefined : { ...base, kind, stage };
  }
  if (kind === "workout") {
    const activity = shortString(candidate.activity, 128);
    const durationSeconds = finite(candidate.durationSeconds);
    if (
      activity === undefined ||
      durationSeconds === undefined ||
      durationSeconds < 0 ||
      durationSeconds > 48 * 60 * 60
    ) {
      return undefined;
    }
    const energyKcal = finite(candidate.energyKcal);
    const distanceMeters = finite(candidate.distanceMeters);
    const programId = optionalShortString(candidate.programId, 64);
    const sessionId = optionalShortString(candidate.sessionId, 160);
    return {
      ...base,
      kind,
      activity,
      durationSeconds,
      ...(energyKcal !== undefined && energyKcal >= 0 && energyKcal <= 1_000_000
        ? { energyKcal }
        : {}),
      ...(distanceMeters !== undefined &&
      distanceMeters >= 0 &&
      distanceMeters <= 10_000_000
        ? { distanceMeters }
        : {}),
      ...(programId === undefined ? {} : { programId }),
      ...(sessionId === undefined ? {} : { sessionId }),
    };
  }

  const recordValue = finite(candidate.value);
  if (recordValue === undefined) return undefined;
  const withinBounds =
    kind === "steps"
      ? recordValue >= 0 && recordValue <= 10_000_000
      : kind === "heart_rate" || kind === "resting_heart_rate"
        ? recordValue >= 20 && recordValue <= 300
        : kind === "heart_rate_variability"
          ? recordValue >= 0 && recordValue <= 2_000
          : recordValue >= 0 && recordValue <= 1_000_000;
  return withinBounds
    ? {
        ...base,
        kind: kind as MobileHealthRecord["kind"],
        value: recordValue,
      }
    : undefined;
}

function parseDeletion(value: unknown): MobileHealthDeletion | undefined {
  const candidate = object(value);
  const kind = candidate?.kind;
  const sourceRecordId = shortString(candidate?.sourceRecordId);
  return typeof kind === "string" &&
    READ_SCOPE_KINDS.has(kind) &&
    sourceRecordId
    ? { kind: kind as MobileHealthDeletion["kind"], sourceRecordId }
    : undefined;
}

export function parseMobileSyncEnvelope(
  value: unknown,
): ParsedMobileSyncEnvelope | undefined {
  const envelope = object(value);
  const provider = envelope?.provider;
  const timeZone = validTimeZone(envelope?.timeZone);
  const syncRunId = shortString(envelope?.syncRunId, 128);
  const trigger = envelope?.trigger;
  const batch = object(envelope?.batch);
  const permissions = parsePermissions(envelope?.permissions);
  if (
    envelope?.schemaVersion !== 1 ||
    (provider !== "apple_healthkit" && provider !== "android_health_connect") ||
    timeZone === undefined ||
    syncRunId === undefined ||
    typeof trigger !== "string" ||
    !TRIGGERS.has(trigger) ||
    batch?.index !== 0 ||
    batch.count !== 1 ||
    !Array.isArray(envelope.records) ||
    envelope.records.length > 2_000 ||
    !Array.isArray(envelope.deletions) ||
    envelope.deletions.length > 2_000 ||
    permissions === undefined
  ) {
    return undefined;
  }
  const records = envelope.records.map((record) =>
    parseRecord(record, provider),
  );
  const deletions = envelope.deletions.map(parseDeletion);
  const activeWorkout = object(envelope.activeWorkout);
  const activeWorkoutStartedAt = iso(activeWorkout?.startedAt);
  const activeWorkoutSourceSessionKey = optionalShortString(
    activeWorkout?.sourceSessionKey,
    256,
  );
  if (
    records.some((record) => record === undefined) ||
    deletions.some((deletion) => deletion === undefined)
  )
    return undefined;
  return {
    provider,
    timeZone,
    syncRunId,
    trigger,
    activeWorkout: activeWorkoutStartedAt !== undefined,
    ...(activeWorkoutStartedAt !== undefined &&
    activeWorkoutSourceSessionKey !== undefined
      ? { activeWorkoutSourceSessionKey }
      : {}),
    records: records as MobileHealthRecord[],
    deletions: deletions as MobileHealthDeletion[],
    permissions,
  };
}

function dateInTimeZone(value: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

interface DailyAccumulator {
  activeCalories: number;
  hasActiveCalories: boolean;
  hasSteps: boolean;
  hrv?: { at: string; value: number };
  latestAt: string;
  resting?: { at: string; value: number };
  sleepEnd?: string;
  sleepMinutes: number;
  sleepStages: Record<string, number>;
  sleepStart?: string;
  steps: number;
}

function daily(
  values: Map<string, DailyAccumulator>,
  date: string,
  at: string,
): DailyAccumulator {
  const existing = values.get(date);
  if (existing !== undefined) {
    if (Date.parse(at) > Date.parse(existing.latestAt)) existing.latestAt = at;
    return existing;
  }
  const created: DailyAccumulator = {
    activeCalories: 0,
    hasActiveCalories: false,
    hasSteps: false,
    latestAt: at,
    sleepMinutes: 0,
    sleepStages: {},
    steps: 0,
  };
  values.set(date, created);
  return created;
}

function bucketStart(value: string): string {
  return new Date(
    Math.floor(Date.parse(value) / 300_000) * 300_000,
  ).toISOString();
}

export function normalizeMobileSync(
  input: ParsedMobileSyncEnvelope,
  activeWorkout?: ActiveMobileWorkout,
): MobileSyncNormalization {
  const dailyValues = new Map<string, DailyAccumulator>();
  const heartRates = new Map<
    string,
    { count: number; maximum: number; minimum: number; weightedSum: number }
  >();
  const rawSamples: HeartRateSampleInput[] = [];
  const summaries: FitnessWorkoutSummaryInput[] = [];
  const completedCompanionWorkouts: MobileSyncNormalization["completedCompanionWorkouts"] =
    [];
  const sleepRecords: SleepIntervalInput[] = [];
  const seen = new Set<string>();

  for (const record of input.records) {
    const identity = `${record.sourceOrigin}:${record.kind}:${record.sourceRecordId}`;
    if (seen.has(identity)) continue;
    seen.add(identity);

    if (record.kind === "heart_rate") {
      const start = bucketStart(record.startAt);
      const bpm = record.value as number;
      const aggregate = heartRates.get(start) ?? {
        count: 0,
        maximum: bpm,
        minimum: bpm,
        weightedSum: 0,
      };
      aggregate.count += 1;
      aggregate.maximum = Math.max(aggregate.maximum, bpm);
      aggregate.minimum = Math.min(aggregate.minimum, bpm);
      aggregate.weightedSum += bpm;
      heartRates.set(start, aggregate);
      if (
        activeWorkout !== undefined &&
        Date.parse(record.startAt) >= Date.parse(activeWorkout.startedAt) &&
        Date.parse(record.startAt) <=
          (activeWorkout.endedAt === undefined
            ? Date.now() + 5 * 60_000
            : Date.parse(activeWorkout.endedAt))
      ) {
        rawSamples.push({
          bpm: Math.round(record.value as number),
          sampledAt: record.startAt,
          sourceRecordId: record.sourceRecordId,
          sourceSessionKey: activeWorkout.sourceSessionKey,
        });
      }
      continue;
    }

    if (record.kind === "heart_rate_bucket") {
      const start = bucketStart(record.startAt);
      const aggregate = heartRates.get(start) ?? {
        count: 0,
        maximum: record.maximumBpm as number,
        minimum: record.minimumBpm as number,
        weightedSum: 0,
      };
      aggregate.count += record.sampleCount as number;
      aggregate.maximum = Math.max(
        aggregate.maximum,
        record.maximumBpm as number,
      );
      aggregate.minimum = Math.min(
        aggregate.minimum,
        record.minimumBpm as number,
      );
      aggregate.weightedSum +=
        (record.averageBpm as number) * (record.sampleCount as number);
      heartRates.set(start, aggregate);
      continue;
    }

    if (record.kind === "workout") {
      summaries.push({
        sourceWorkoutId: record.sourceRecordId,
        startedAt: record.startAt,
        endedAt: record.endAt,
        workoutType: record.activity,
        ...(record.energyKcal === undefined
          ? {}
          : { activeCalories: Math.round(record.energyKcal) }),
        ...(record.distanceMeters === undefined
          ? {}
          : { distanceMeters: Math.round(record.distanceMeters) }),
        sourceUpdatedAt: record.endAt,
      });
      if (
        record.sourceOrigin === "orbital_companion" &&
        record.programId !== undefined &&
        record.sessionId !== undefined
      ) {
        completedCompanionWorkouts.push({
          programId: record.programId,
          sessionId: record.sessionId,
          endedAt: record.endAt,
        });
      }
      continue;
    }

    if (record.kind === "sleep") {
      sleepRecords.push({
        startAt: record.startAt,
        endAt: record.endAt,
        stage: record.stage ?? "unknown",
      });
      continue;
    }

    const date = dateInTimeZone(record.startAt, input.timeZone);
    const value = daily(dailyValues, date, record.endAt);
    if (record.kind === "steps") {
      value.hasSteps = true;
      value.steps += record.value as number;
    } else if (record.kind === "active_energy") {
      value.hasActiveCalories = true;
      value.activeCalories += record.value as number;
    } else if (record.kind === "resting_heart_rate") {
      if (value.resting === undefined || record.endAt >= value.resting.at)
        value.resting = { at: record.endAt, value: record.value as number };
    } else if (record.kind === "heart_rate_variability") {
      if (value.hrv === undefined || record.endAt >= value.hrv.at)
        value.hrv = { at: record.endAt, value: record.value as number };
    }
  }

  for (const episode of reconcileSleepEpisodes(sleepRecords)) {
    const date = dateInTimeZone(episode.endAt, input.timeZone);
    const value = daily(dailyValues, date, episode.endAt);
    value.sleepMinutes += episode.sleepMinutes;
    for (const [stage, minutes] of Object.entries(episode.stages))
      value.sleepStages[stage] = (value.sleepStages[stage] ?? 0) + minutes;
    value.sleepStart =
      value.sleepStart === undefined || episode.startAt < value.sleepStart
        ? episode.startAt
        : value.sleepStart;
    value.sleepEnd =
      value.sleepEnd === undefined || episode.endAt > value.sleepEnd
        ? episode.endAt
        : value.sleepEnd;
  }

  return {
    metrics: [...dailyValues.entries()]
      .map(([metricDate, value]) => ({
        metricDate,
        timeZone: input.timeZone,
        ...(value.hasSteps ? { steps: Math.round(value.steps) } : {}),
        ...(value.hasActiveCalories
          ? { activeCalories: Math.round(value.activeCalories) }
          : {}),
        ...(value.resting === undefined
          ? {}
          : { restingHeartRateBpm: Math.round(value.resting.value) }),
        ...(value.hrv === undefined
          ? {}
          : { heartRateVariabilityMs: value.hrv.value }),
        ...(value.sleepStart === undefined
          ? {}
          : {
              sleepStartAt: value.sleepStart,
              sleepEndAt: value.sleepEnd,
              sleepMinutes: Math.round(value.sleepMinutes),
              sleepStages: Object.fromEntries(
                Object.entries(value.sleepStages).map(([stage, minutes]) => [
                  stage,
                  Math.round(minutes),
                ]),
              ),
            }),
        sourceUpdatedAt: value.latestAt,
        extensions: {
          mobileSnapshot: true,
          syncRunId: input.syncRunId,
        },
      }))
      .sort((left, right) => left.metricDate.localeCompare(right.metricDate)),
    buckets: [...heartRates.entries()]
      .map(([start, value]) => ({
        bucketStart: start,
        minBpm: Math.round(value.minimum),
        maxBpm: Math.round(value.maximum),
        avgBpm: value.weightedSum / value.count,
        sampleCount: value.count,
      }))
      .sort((left, right) => left.bucketStart.localeCompare(right.bucketStart)),
    rawSamples: rawSamples.sort((left, right) =>
      left.sampledAt.localeCompare(right.sampledAt),
    ),
    summaries,
    completedCompanionWorkouts,
  };
}
