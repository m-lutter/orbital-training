import type {
  DailyFitnessMetricInput,
  FitnessProviderSyncResult,
  FitnessWorkoutSummaryInput,
  HeartRateBucketInput,
  HeartRateSampleInput,
} from "./sync-types";
import { FitnessProviderError, providerApiOrigin } from "./provider-clients";

type Fetcher = typeof fetch;
type JsonRecord = Record<string, unknown>;

const GOOGLE_MAX_PAGES = 4;
const WHOOP_MAX_PAGES = 4;
const GOOGLE_RETROSPECTIVE_LOOKBACK_DAYS = 8;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function finiteNumber(value: unknown): number | undefined {
  const result = typeof value === "number" ? value : Number(value);
  return Number.isFinite(result) ? result : undefined;
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): number | undefined {
  const parsed = finiteNumber(value);
  if (parsed === undefined) return undefined;
  const rounded = Math.round(parsed);
  return rounded >= minimum && rounded <= maximum ? rounded : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function validInstant(value: unknown): string | undefined {
  const candidate = stringValue(value);
  if (candidate === undefined || !Number.isFinite(Date.parse(candidate))) {
    return undefined;
  }
  return new Date(candidate).toISOString();
}

function datePart(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const year = boundedInteger(value.year, 1, 9999);
  const month = boundedInteger(value.month, 1, 12);
  const day = boundedInteger(value.day, 1, 31);
  if (year === undefined || month === undefined || day === undefined) {
    return undefined;
  }
  const result = `${String(year).padStart(4, "0")}-${String(month).padStart(
    2,
    "0",
  )}-${String(day).padStart(2, "0")}`;
  return Number.isFinite(Date.parse(`${result}T00:00:00Z`))
    ? result
    : undefined;
}

function civilDate(value: unknown): string | undefined {
  return isRecord(value) ? datePart(value.date) : undefined;
}

function shiftDate(value: string, days: number): string {
  const instant = new Date(`${value}T00:00:00Z`);
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}

function civilDateTime(value: string): JsonRecord {
  const [year, month, day] = value.split("-").map(Number);
  return { date: { year, month, day } };
}

function secondsFromDuration(value: unknown): number | undefined {
  const text = stringValue(value);
  if (text === undefined || !/^-?\d+(?:\.\d+)?s$/u.test(text)) return undefined;
  return finiteNumber(text.slice(0, -1));
}

function millisecondsToMinutes(value: unknown): number | undefined {
  const milliseconds = finiteNumber(value);
  return milliseconds === undefined
    ? undefined
    : Math.max(0, Math.round(milliseconds / 60_000));
}

async function providerJson(
  provider: "google_health" | "whoop",
  url: string,
  accessToken: string,
  init: RequestInit,
  fetcher: Fetcher,
): Promise<JsonRecord> {
  const response = await fetcher(url, {
    ...init,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${accessToken}`,
      ...(init.body === undefined
        ? {}
        : { "content-type": "application/json" }),
      ...init.headers,
    },
    signal: AbortSignal.timeout(20_000),
  });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new FitnessProviderError(
      provider,
      response.status,
      `${provider} data request failed (${response.status}).`,
    );
  }
  if (!isRecord(body)) {
    throw new FitnessProviderError(
      provider,
      502,
      "Provider returned invalid JSON.",
    );
  }
  return body;
}

async function googleList(
  dataType: string,
  filter: string,
  accessToken: string,
  fetcher: Fetcher,
): Promise<JsonRecord[]> {
  const output: JsonRecord[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < GOOGLE_MAX_PAGES; page += 1) {
    const url = new URL(
      `${providerApiOrigin("google_health")}/users/me/dataTypes/${dataType}/dataPoints:reconcile`,
    );
    url.searchParams.set("filter", filter);
    url.searchParams.set(
      "pageSize",
      dataType === "sleep" || dataType === "exercise" ? "25" : "10000",
    );
    if (pageToken !== undefined) url.searchParams.set("pageToken", pageToken);
    const body = await providerJson(
      "google_health",
      url.toString(),
      accessToken,
      { method: "GET" },
      fetcher,
    );
    output.push(...records(body.dataPoints));
    pageToken = stringValue(body.nextPageToken);
    if (pageToken === undefined) break;
  }
  return output;
}

async function googleRollup(
  dataType: string,
  body: JsonRecord,
  accessToken: string,
  fetcher: Fetcher,
): Promise<JsonRecord[]> {
  const output: JsonRecord[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < GOOGLE_MAX_PAGES; page += 1) {
    const response = await providerJson(
      "google_health",
      `${providerApiOrigin("google_health")}/users/me/dataTypes/${dataType}/dataPoints:rollUp`,
      accessToken,
      {
        method: "POST",
        body: JSON.stringify({
          ...body,
          ...(pageToken === undefined ? {} : { pageToken }),
        }),
      },
      fetcher,
    );
    output.push(...records(response.rollupDataPoints));
    pageToken = stringValue(response.nextPageToken);
    if (pageToken === undefined) break;
  }
  return output;
}

async function googleDailyRollup(
  dataType: string,
  startDate: string,
  endDate: string,
  accessToken: string,
  fetcher: Fetcher,
): Promise<JsonRecord[]> {
  const response = await providerJson(
    "google_health",
    `${providerApiOrigin("google_health")}/users/me/dataTypes/${dataType}/dataPoints:dailyRollUp`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        range: {
          start: civilDateTime(startDate),
          end: civilDateTime(endDate),
        },
        windowSizeDays: 1,
        pageSize: 31,
      }),
    },
    fetcher,
  );
  return records(response.rollupDataPoints);
}

function metricFor(
  byDate: Map<string, DailyFitnessMetricInput>,
  date: string,
  timeZone: string,
): DailyFitnessMetricInput {
  const existing = byDate.get(date);
  if (existing !== undefined) return existing;
  const created = { metricDate: date, timeZone };
  byDate.set(date, created);
  return created;
}

function parseGoogleMetrics(options: {
  hrv: JsonRecord[];
  restingHeartRate: JsonRecord[];
  sleep: JsonRecord[];
  steps: JsonRecord[];
  timeZone: string;
}): DailyFitnessMetricInput[] {
  const byDate = new Map<string, DailyFitnessMetricInput>();

  for (const point of options.steps) {
    const date = civilDate(point.civilStartTime);
    const steps = isRecord(point.steps)
      ? boundedInteger(point.steps.countSum, 0, 1_000_000)
      : undefined;
    if (date !== undefined && steps !== undefined) {
      metricFor(byDate, date, options.timeZone).steps = steps;
    }
  }

  for (const point of options.restingHeartRate) {
    if (!isRecord(point.dailyRestingHeartRate)) continue;
    const date = datePart(point.dailyRestingHeartRate.date);
    const bpm = boundedInteger(
      point.dailyRestingHeartRate.beatsPerMinute,
      20,
      260,
    );
    if (date !== undefined && bpm !== undefined) {
      metricFor(byDate, date, options.timeZone).restingHeartRateBpm = bpm;
    }
  }

  for (const point of options.hrv) {
    if (!isRecord(point.dailyHeartRateVariability)) continue;
    const date = datePart(point.dailyHeartRateVariability.date);
    const hrv = finiteNumber(
      point.dailyHeartRateVariability.averageHeartRateVariabilityMilliseconds,
    );
    if (date !== undefined && hrv !== undefined && hrv >= 0 && hrv <= 1000) {
      metricFor(byDate, date, options.timeZone).heartRateVariabilityMs = hrv;
    }
  }

  for (const point of options.sleep) {
    if (!isRecord(point.sleep) || !isRecord(point.sleep.interval)) continue;
    const date = civilDate(point.sleep.interval.civilEndTime);
    const start = validInstant(point.sleep.interval.startTime);
    const end = validInstant(point.sleep.interval.endTime);
    const summary = isRecord(point.sleep.summary) ? point.sleep.summary : {};
    const minutes = boundedInteger(summary.minutesAsleep, 0, 1440);
    if (date === undefined || start === undefined || end === undefined)
      continue;
    const metric = metricFor(byDate, date, options.timeZone);
    if ((metric.sleepMinutes ?? -1) > (minutes ?? 0)) continue;
    metric.sleepStartAt = start;
    metric.sleepEndAt = end;
    if (minutes !== undefined) metric.sleepMinutes = minutes;
    metric.sourceUpdatedAt = validInstant(point.sleep.updateTime);
    const stageValues: DailyFitnessMetricInput["sleepStages"] = {};
    for (const stage of records(summary.stagesSummary)) {
      const type = stringValue(stage.type)?.toLowerCase();
      const stageMinutes = boundedInteger(stage.minutes, 0, 1440);
      if (
        stageMinutes !== undefined &&
        (type === "awake" ||
          type === "light" ||
          type === "deep" ||
          type === "rem")
      ) {
        stageValues[type] = stageMinutes;
      }
    }
    if (Object.keys(stageValues).length > 0) metric.sleepStages = stageValues;
  }

  return [...byDate.values()].sort((left, right) =>
    left.metricDate.localeCompare(right.metricDate),
  );
}

export function parseGoogleHeartRateBuckets(
  points: JsonRecord[],
): HeartRateBucketInput[] {
  return points.flatMap((point) => {
    if (!isRecord(point.heartRate)) return [];
    const bucketStart = validInstant(point.startTime);
    const avgBpm = finiteNumber(point.heartRate.beatsPerMinuteAvg);
    const minBpm = finiteNumber(point.heartRate.beatsPerMinuteMin);
    const maxBpm = finiteNumber(point.heartRate.beatsPerMinuteMax);
    if (
      bucketStart === undefined ||
      avgBpm === undefined ||
      minBpm === undefined ||
      maxBpm === undefined ||
      minBpm < 20 ||
      maxBpm > 260 ||
      minBpm > avgBpm ||
      avgBpm > maxBpm
    ) {
      return [];
    }
    return [{ bucketStart, avgBpm, minBpm, maxBpm }];
  });
}

export function parseGoogleHeartRateSamples(
  points: JsonRecord[],
): HeartRateSampleInput[] {
  const byInstant = new Map<string, HeartRateSampleInput>();
  for (const point of points) {
    if (!isRecord(point.heartRate) || !isRecord(point.heartRate.sampleTime)) {
      continue;
    }
    const sampledAt = validInstant(point.heartRate.sampleTime.physicalTime);
    const bpm = boundedInteger(point.heartRate.beatsPerMinute, 20, 260);
    if (sampledAt === undefined || bpm === undefined) continue;
    const sourceRecordId = stringValue(point.dataPointName);
    byInstant.set(sampledAt, {
      sampledAt,
      bpm,
      ...(sourceRecordId ? { sourceRecordId } : {}),
    });
  }
  // Contiguous, chronological batches keep the database's five-minute
  // recomputation windows bounded during a large catch-up import.
  return [...byInstant.values()].sort((left, right) =>
    left.sampledAt.localeCompare(right.sampledAt),
  );
}

function parseGoogleWorkouts(
  points: JsonRecord[],
): FitnessWorkoutSummaryInput[] {
  return points.flatMap((point, index) => {
    if (!isRecord(point.exercise) || !isRecord(point.exercise.interval))
      return [];
    const startedAt = validInstant(point.exercise.interval.startTime);
    const endedAt = validInstant(point.exercise.interval.endTime);
    if (
      startedAt === undefined ||
      endedAt === undefined ||
      Date.parse(endedAt) < Date.parse(startedAt) ||
      Date.parse(endedAt) - Date.parse(startedAt) > 7 * 24 * 60 * 60 * 1000
    ) {
      return [];
    }
    const metrics = isRecord(point.exercise.metricsSummary)
      ? point.exercise.metricsSummary
      : {};
    const zones = isRecord(metrics.heartRateZoneDurations)
      ? Object.fromEntries(
          Object.entries(metrics.heartRateZoneDurations).flatMap(
            ([key, value]) => {
              const seconds = secondsFromDuration(value);
              return seconds === undefined ? [] : [[key, seconds]];
            },
          ),
        )
      : undefined;
    const sourceWorkoutId =
      stringValue(point.dataPointName)?.split("/").at(-1) ??
      `google-${startedAt}-${index}`;
    const workoutType =
      stringValue(point.exercise.exerciseType)?.toLowerCase().slice(0, 64) ??
      "unknown";
    return [
      {
        sourceWorkoutId: sourceWorkoutId.slice(0, 256),
        startedAt,
        endedAt,
        workoutType,
        averageHeartRateBpm: boundedInteger(
          metrics.averageHeartRateBeatsPerMinute,
          20,
          260,
        ),
        distanceMeters:
          finiteNumber(metrics.distanceMillimeters) === undefined
            ? undefined
            : finiteNumber(metrics.distanceMillimeters)! / 1000,
        activeCalories: finiteNumber(metrics.caloriesKcal),
        ...(zones && Object.keys(zones).length > 0
          ? { heartRateZones: zones }
          : {}),
        sourceUpdatedAt: validInstant(point.exercise.updateTime),
      },
    ];
  });
}

export async function syncGoogleHealth(options: {
  accessToken: string;
  endDate: string;
  fetcher?: Fetcher;
  now?: Date;
  startDate: string;
  timeZone: string;
}): Promise<FitnessProviderSyncResult> {
  const fetcher = options.fetcher ?? fetch;
  const physicalEnd = new Date(options.now ?? Date.now()).toISOString();
  const physicalStart = new Date(
    Date.parse(physicalEnd) -
      GOOGLE_RETROSPECTIVE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const [steps, restingHeartRate, hrv, sleep, exercise, heartRate] =
    await Promise.all([
      googleDailyRollup(
        "steps",
        options.startDate,
        options.endDate,
        options.accessToken,
        fetcher,
      ),
      googleList(
        "daily-resting-heart-rate",
        `daily_resting_heart_rate.date >= "${options.startDate}" AND daily_resting_heart_rate.date < "${options.endDate}"`,
        options.accessToken,
        fetcher,
      ),
      googleList(
        "daily-heart-rate-variability",
        `daily_heart_rate_variability.date >= "${options.startDate}" AND daily_heart_rate_variability.date < "${options.endDate}"`,
        options.accessToken,
        fetcher,
      ),
      googleList(
        "sleep",
        `sleep.interval.civil_end_time >= "${options.startDate}" AND sleep.interval.civil_end_time < "${options.endDate}"`,
        options.accessToken,
        fetcher,
      ),
      googleList(
        "exercise",
        `exercise.interval.civil_start_time >= "${options.startDate}" AND exercise.interval.civil_start_time < "${options.endDate}"`,
        options.accessToken,
        fetcher,
      ),
      googleRollup(
        "heart-rate",
        {
          range: { startTime: physicalStart, endTime: physicalEnd },
          windowSize: "300s",
          pageSize: 1000,
        },
        options.accessToken,
        fetcher,
      ),
    ]);
  return {
    dailyMetrics: parseGoogleMetrics({
      steps,
      restingHeartRate,
      hrv,
      sleep,
      timeZone: options.timeZone,
    }),
    heartRateBuckets: parseGoogleHeartRateBuckets(heartRate),
    workoutSummaries: parseGoogleWorkouts(exercise),
  };
}

export async function fetchGoogleWorkoutHeartRate(options: {
  accessToken: string;
  endTime: string;
  fetcher?: Fetcher;
  startTime: string;
}): Promise<HeartRateSampleInput[]> {
  const points = await googleList(
    "heart-rate",
    `heart_rate.sample_time.physical_time >= "${options.startTime}" AND heart_rate.sample_time.physical_time < "${options.endTime}"`,
    options.accessToken,
    options.fetcher ?? fetch,
  );
  return parseGoogleHeartRateSamples(points);
}

async function whoopCollection(
  path: string,
  startTime: string,
  endTime: string,
  accessToken: string,
  fetcher: Fetcher,
): Promise<JsonRecord[]> {
  const output: JsonRecord[] = [];
  let nextToken: string | undefined;
  for (let page = 0; page < WHOOP_MAX_PAGES; page += 1) {
    const url = new URL(`${providerApiOrigin("whoop")}${path}`);
    url.searchParams.set("limit", "25");
    url.searchParams.set("start", startTime);
    url.searchParams.set("end", endTime);
    if (nextToken !== undefined) url.searchParams.set("nextToken", nextToken);
    const body = await providerJson(
      "whoop",
      url.toString(),
      accessToken,
      { method: "GET" },
      fetcher,
    );
    output.push(...records(body.records));
    nextToken = stringValue(body.next_token);
    if (nextToken === undefined) break;
  }
  return output;
}

function whoopLocalDate(record: JsonRecord): string | undefined {
  const start = validInstant(record.start);
  if (start === undefined) return undefined;
  const offset = stringValue(record.timezone_offset);
  const match = offset?.match(/^([+-])(\d{2}):(\d{2})$/u);
  const offsetMinutes = match
    ? (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]))
    : 0;
  return new Date(Date.parse(start) + offsetMinutes * 60_000)
    .toISOString()
    .slice(0, 10);
}

function parseWhoopMetrics(options: {
  cycles: JsonRecord[];
  recoveries: JsonRecord[];
  sleeps: JsonRecord[];
  timeZone: string;
}): DailyFitnessMetricInput[] {
  const byDate = new Map<string, DailyFitnessMetricInput>();
  for (const sleep of options.sleeps) {
    const date = whoopLocalDate(sleep);
    const start = validInstant(sleep.start);
    const end = validInstant(sleep.end);
    const score = isRecord(sleep.score) ? sleep.score : {};
    const stages = isRecord(score.stage_summary) ? score.stage_summary : {};
    if (date === undefined || start === undefined || end === undefined)
      continue;
    const metric = metricFor(byDate, date, options.timeZone);
    metric.sleepStartAt = start;
    metric.sleepEndAt = end;
    const light = millisecondsToMinutes(stages.total_light_sleep_time_milli);
    const deep = millisecondsToMinutes(stages.total_slow_wave_sleep_time_milli);
    const rem = millisecondsToMinutes(stages.total_rem_sleep_time_milli);
    const awake = millisecondsToMinutes(stages.total_awake_time_milli);
    const sleepMinutes = [light, deep, rem]
      .filter((value): value is number => value !== undefined)
      .reduce((sum, value) => sum + value, 0);
    if (sleepMinutes > 0) metric.sleepMinutes = sleepMinutes;
    metric.sleepStages = { light, deep, rem, awake };
    metric.sourceUpdatedAt = validInstant(sleep.updated_at);
  }
  const cycleDates = new Map(
    options.cycles.flatMap((cycle) => {
      const date = whoopLocalDate(cycle);
      return date === undefined ? [] : [[String(cycle.id), date] as const];
    }),
  );
  for (const recovery of options.recoveries) {
    const date = cycleDates.get(String(recovery.cycle_id));
    const score = isRecord(recovery.score) ? recovery.score : {};
    if (date === undefined) continue;
    const metric = metricFor(byDate, date, options.timeZone);
    metric.restingHeartRateBpm = boundedInteger(
      score.resting_heart_rate,
      20,
      260,
    );
    const hrv = finiteNumber(score.hrv_rmssd_milli);
    if (hrv !== undefined && hrv >= 0 && hrv <= 1000) {
      metric.heartRateVariabilityMs = hrv;
    }
    metric.recoveryScore = boundedInteger(score.recovery_score, 0, 100);
    metric.sourceUpdatedAt = validInstant(recovery.updated_at);
  }
  return [...byDate.values()].sort((left, right) =>
    left.metricDate.localeCompare(right.metricDate),
  );
}

function parseWhoopWorkouts(
  points: JsonRecord[],
): FitnessWorkoutSummaryInput[] {
  return points.flatMap((workout) => {
    const sourceWorkoutId = stringValue(workout.id);
    const startedAt = validInstant(workout.start);
    const endedAt = validInstant(workout.end);
    if (
      sourceWorkoutId === undefined ||
      startedAt === undefined ||
      endedAt === undefined
    ) {
      return [];
    }
    const score = isRecord(workout.score) ? workout.score : {};
    const zoneDurations = isRecord(score.zone_durations)
      ? Object.fromEntries(
          Object.entries(score.zone_durations).flatMap(([key, value]) => {
            const milliseconds = finiteNumber(value);
            return milliseconds === undefined
              ? []
              : [[key, milliseconds / 1000]];
          }),
        )
      : undefined;
    return [
      {
        sourceWorkoutId,
        startedAt,
        endedAt,
        workoutType: stringValue(workout.sport_name),
        averageHeartRateBpm: boundedInteger(score.average_heart_rate, 20, 260),
        maximumHeartRateBpm: boundedInteger(score.max_heart_rate, 20, 260),
        distanceMeters: finiteNumber(score.distance_meter),
        activeCalories:
          finiteNumber(score.kilojoule) === undefined
            ? undefined
            : finiteNumber(score.kilojoule)! / 4.184,
        strainScore: finiteNumber(score.strain),
        ...(zoneDurations && Object.keys(zoneDurations).length > 0
          ? { heartRateZones: zoneDurations }
          : {}),
        sourceUpdatedAt: validInstant(workout.updated_at),
      },
    ];
  });
}

export async function syncWhoop(options: {
  accessToken: string;
  endTime: string;
  fetcher?: Fetcher;
  startTime: string;
  timeZone: string;
}): Promise<FitnessProviderSyncResult> {
  const fetcher = options.fetcher ?? fetch;
  const [cycles, recoveries, sleeps, workouts] = await Promise.all([
    whoopCollection(
      "/cycle",
      options.startTime,
      options.endTime,
      options.accessToken,
      fetcher,
    ),
    whoopCollection(
      "/recovery",
      options.startTime,
      options.endTime,
      options.accessToken,
      fetcher,
    ),
    whoopCollection(
      "/activity/sleep",
      options.startTime,
      options.endTime,
      options.accessToken,
      fetcher,
    ),
    whoopCollection(
      "/activity/workout",
      options.startTime,
      options.endTime,
      options.accessToken,
      fetcher,
    ),
  ]);
  return {
    dailyMetrics: parseWhoopMetrics({
      cycles,
      recoveries,
      sleeps,
      timeZone: options.timeZone,
    }),
    heartRateBuckets: [],
    workoutSummaries: parseWhoopWorkouts(workouts),
  };
}

export const fitnessSyncDateRange = (localDate: string) => ({
  startDate: shiftDate(localDate, -(GOOGLE_RETROSPECTIVE_LOOKBACK_DAYS - 1)),
  endDate: shiftDate(localDate, 1),
});
