import type { Database, Json } from "$lib/database.types";
import type {
  WeeklyHeartRateBucket,
  WeeklyHeartRateReviewData,
  WeeklyHeartRateWorkout,
} from "$lib/reviews/heart-rate";
import type { SupabaseClient } from "@supabase/supabase-js";

const MINIMUM_WORKOUT_MS = 5 * 60_000;
const MAXIMUM_WORKOUT_MS = 8 * 60 * 60_000;
const MAXIMUM_BOUNDARY_DRIFT_MS = 45 * 60_000;
const MAXIMUM_REVIEW_WORKOUTS = 10;
const MAXIMUM_PROVIDER_SUMMARIES = 48;
// An eight-hour window that begins between five-minute boundaries overlaps
// both partial edge buckets: 96 full intervals plus one leading partial.
const MAXIMUM_BUCKETS_PER_WORKOUT = 97;
const MAXIMUM_REVIEW_BUCKETS =
  MAXIMUM_REVIEW_WORKOUTS * MAXIMUM_BUCKETS_PER_WORKOUT;

export interface HeartRateReviewWorkoutLog {
  completedAt?: string;
  durationMinutes?: number;
  id: string;
  label: string;
  startedAt?: string;
  status: string;
}

export interface HeartRateReviewSourceLog {
  completedAt?: string;
  durationMinutes?: number;
  id?: string;
  sessionId: string;
  sessionSequence: number;
  startedAt?: string;
  status: string;
  weekNumber: number;
}

export interface HeartRateReviewProgramSession {
  id: string;
  sequence: number;
  title: string;
}

export interface RetrospectiveWorkoutSummary {
  averageBpm?: number | null;
  connectionId: string;
  endedAt: string;
  extensions?: Json;
  id: string;
  maximumBpm?: number | null;
  provider: string;
  startedAt: string;
  workoutType: string;
}

export interface RetrospectiveWorkoutMatch {
  log: HeartRateReviewWorkoutLog;
  summary: RetrospectiveWorkoutSummary;
}

interface WorkoutWindow {
  end: number;
  start: number;
}

interface FitnessConnection {
  id: string;
  lastSyncedAt: string | null;
  provider: string;
}

interface HeartRateBucketRow {
  average_bpm: number;
  bucket_start: string;
  connection_id: string;
  maximum_bpm: number;
  minimum_bpm: number;
  sample_count: number | null;
}

/** Selects only completed logs from the requested week and adds stable labels. */
export function heartRateReviewLogsForWeek(options: {
  logs: readonly HeartRateReviewSourceLog[];
  sessions: readonly HeartRateReviewProgramSession[];
  weekNumber: number;
}): HeartRateReviewWorkoutLog[] {
  return options.logs.flatMap((log) => {
    if (
      log.weekNumber !== options.weekNumber ||
      log.status !== "completed" ||
      log.id === undefined
    ) {
      return [];
    }
    const session =
      options.sessions.find((candidate) => candidate.id === log.sessionId) ??
      options.sessions.find(
        (candidate) => candidate.sequence === log.sessionSequence,
      );
    const sequence = session?.sequence ?? log.sessionSequence;
    const title = session?.title.trim();
    return [
      {
        id: log.id,
        label: title ? `Workout ${sequence} · ${title}` : `Workout ${sequence}`,
        status: log.status,
        startedAt: log.startedAt,
        completedAt: log.completedAt,
        durationMinutes: log.durationMinutes,
      },
    ];
  });
}

function record(value: Json | undefined): Record<string, Json | undefined> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, Json | undefined>)
    : {};
}

function instant(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function finite(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function validBpm(value: unknown): number | undefined {
  const parsed = finite(value);
  return parsed !== undefined && parsed >= 20 && parsed <= 300
    ? parsed
    : undefined;
}

function logWindow(log: HeartRateReviewWorkoutLog): WorkoutWindow | undefined {
  if (log.status !== "completed") return undefined;
  const storedStart = instant(log.startedAt);
  const end = instant(log.completedAt);
  if (storedStart === undefined || end === undefined || end <= storedStart)
    return undefined;

  const storedDuration = end - storedStart;
  if (
    storedDuration >= MINIMUM_WORKOUT_MS &&
    storedDuration <= MAXIMUM_WORKOUT_MS
  ) {
    return { start: storedStart, end };
  }

  const durationMinutes = finite(log.durationMinutes);
  const duration =
    durationMinutes === undefined ? Number.NaN : durationMinutes * 60_000;
  return duration >= MINIMUM_WORKOUT_MS && duration <= MAXIMUM_WORKOUT_MS
    ? { start: end - duration, end }
    : undefined;
}

function summaryWindow(
  summary: RetrospectiveWorkoutSummary,
): WorkoutWindow | undefined {
  const start = instant(summary.startedAt);
  const end = instant(summary.endedAt);
  return start !== undefined &&
    end !== undefined &&
    end - start >= MINIMUM_WORKOUT_MS &&
    end - start <= MAXIMUM_WORKOUT_MS
    ? { start, end }
    : undefined;
}

function explicitWorkoutLogId(summary: RetrospectiveWorkoutSummary) {
  const extensions = record(summary.extensions);
  for (const key of ["workoutLogId", "orbitalWorkoutLogId", "workout_log_id"]) {
    const value = extensions[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function isStrengthWorkoutType(value: string): boolean {
  const normalized = value.toLowerCase().replaceAll(/[^a-z0-9]+/gu, "_");
  return [
    "strength",
    "weightlift",
    "powerlift",
    "resistance",
    "crossfit",
    "circuit_training",
  ].some((token) => normalized.includes(token));
}

function hasConservativeOverlap(
  log: WorkoutWindow,
  summary: WorkoutWindow,
): boolean {
  const overlap = Math.max(
    0,
    Math.min(log.end, summary.end) - Math.max(log.start, summary.start),
  );
  const logDuration = log.end - log.start;
  const summaryDuration = summary.end - summary.start;
  const shorter = Math.min(logDuration, summaryDuration);
  const longer = Math.max(logDuration, summaryDuration);
  return (
    Math.abs(log.start - summary.start) <= MAXIMUM_BOUNDARY_DRIFT_MS &&
    Math.abs(log.end - summary.end) <= MAXIMUM_BOUNDARY_DRIFT_MS &&
    overlap / shorter >= 0.7 &&
    overlap / longer >= 0.55
  );
}

function isCandidate(
  log: HeartRateReviewWorkoutLog,
  summary: RetrospectiveWorkoutSummary,
): boolean {
  const logInterval = logWindow(log);
  const summaryInterval = summaryWindow(summary);
  if (logInterval === undefined || summaryInterval === undefined) return false;

  const explicitId = explicitWorkoutLogId(summary);
  if (explicitId !== undefined) {
    return (
      explicitId === log.id &&
      Math.abs(logInterval.start - summaryInterval.start) <=
        MAXIMUM_WORKOUT_MS &&
      Math.abs(logInterval.end - summaryInterval.end) <= MAXIMUM_WORKOUT_MS
    );
  }
  return (
    isStrengthWorkoutType(summary.workoutType) &&
    hasConservativeOverlap(logInterval, summaryInterval)
  );
}

/**
 * Matches only mutually unique candidates. If two provider records could be
 * the same Orbital workout (or vice versa), neither is exposed in the review.
 */
export function matchRetrospectiveWorkouts(
  logs: readonly HeartRateReviewWorkoutLog[],
  summaries: readonly RetrospectiveWorkoutSummary[],
): RetrospectiveWorkoutMatch[] {
  const candidates = logs.flatMap((log) =>
    summaries.flatMap((summary) =>
      isCandidate(log, summary) ? [{ log, summary }] : [],
    ),
  );
  const byLog = new Map<string, number>();
  const bySummary = new Map<string, number>();
  for (const candidate of candidates) {
    byLog.set(candidate.log.id, (byLog.get(candidate.log.id) ?? 0) + 1);
    bySummary.set(
      candidate.summary.id,
      (bySummary.get(candidate.summary.id) ?? 0) + 1,
    );
  }
  return candidates
    .filter(
      (candidate) =>
        byLog.get(candidate.log.id) === 1 &&
        bySummary.get(candidate.summary.id) === 1,
    )
    .sort(
      (left, right) =>
        (instant(left.summary.startedAt) ?? 0) -
        (instant(right.summary.startedAt) ?? 0),
    );
}

function bucketStartFloor(value: number): string {
  return new Date(Math.floor(value / (5 * 60_000)) * 5 * 60_000).toISOString();
}

function parseBuckets(rows: readonly HeartRateBucketRow[]) {
  return rows.flatMap((row): WeeklyHeartRateBucket[] => {
    const bucketAt = instant(row.bucket_start);
    const averageBpm = validBpm(row.average_bpm);
    const minimumBpm = validBpm(row.minimum_bpm);
    const maximumBpm = validBpm(row.maximum_bpm);
    if (
      bucketAt === undefined ||
      averageBpm === undefined ||
      minimumBpm === undefined ||
      maximumBpm === undefined ||
      minimumBpm > averageBpm ||
      averageBpm > maximumBpm
    ) {
      return [];
    }
    return [
      {
        bucketStart: new Date(bucketAt).toISOString(),
        averageBpm,
        minimumBpm,
        maximumBpm,
        ...(Number.isInteger(row.sample_count) && (row.sample_count ?? 0) > 0
          ? { sampleCount: row.sample_count }
          : {}),
      },
    ];
  });
}

function summarizeBuckets(buckets: readonly WeeklyHeartRateBucket[]): {
  averageBpm?: number;
  maximumBpm?: number;
} {
  if (buckets.length === 0) return {};
  let count = 0;
  let weighted = 0;
  let maximum = 0;
  for (const bucket of buckets) {
    const weight = Math.max(1, bucket.sampleCount ?? 1);
    count += weight;
    weighted += bucket.averageBpm * weight;
    maximum = Math.max(maximum, bucket.maximumBpm ?? bucket.averageBpm);
  }
  return {
    averageBpm: Math.round(weighted / count),
    maximumBpm: Math.round(maximum),
  };
}

function newestSync(connections: readonly FitnessConnection[]) {
  return connections
    .map((connection) => connection.lastSyncedAt)
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1);
}

function emptyReview(
  status: WeeklyHeartRateReviewData["status"],
  lastSyncedAt?: string,
): WeeklyHeartRateReviewData {
  return {
    status,
    ...(lastSyncedAt === undefined ? {} : { lastSyncedAt }),
    workouts: [],
  };
}

/**
 * Loads review-safe five-minute aggregates through the request's RLS client.
 * It never reads the short-lived raw sample table, and every query is bounded.
 */
export async function loadWeeklyHeartRateReview(options: {
  client: SupabaseClient<Database>;
  userId: string;
  workoutLogs: readonly HeartRateReviewWorkoutLog[];
}): Promise<WeeklyHeartRateReviewData> {
  const { data: connectionRows, error: connectionError } = await options.client
    .from("fitness_connections")
    .select("id, provider, status, last_synced_at")
    .eq("user_id", options.userId)
    .eq("provider", "google_health")
    .limit(4);
  if (connectionError) {
    if (!["42P01", "PGRST205"].includes(connectionError.code ?? "")) {
      console.warn("Workout heart-rate connections could not be loaded:", {
        code: connectionError.code,
      });
    }
    return emptyReview("unavailable");
  }

  const connections: FitnessConnection[] = (connectionRows ?? []).flatMap(
    (connection) =>
      connection.status === "active"
        ? [
            {
              id: connection.id,
              provider: connection.provider,
              lastSyncedAt: connection.last_synced_at,
            },
          ]
        : [],
  );
  if (connections.length === 0) return emptyReview("not_connected");
  const lastSyncedAt = newestSync(connections);

  const logs = options.workoutLogs
    .filter((log) => logWindow(log) !== undefined)
    .sort(
      (left, right) =>
        (logWindow(left)?.start ?? 0) - (logWindow(right)?.start ?? 0),
    )
    .slice(0, MAXIMUM_REVIEW_WORKOUTS);
  if (logs.length === 0)
    return emptyReview(
      lastSyncedAt === undefined ? "awaiting_sync" : "ready",
      lastSyncedAt,
    );

  const windows = logs.flatMap((log) => {
    const window = logWindow(log);
    return window === undefined ? [] : [window];
  });
  const earliest = Math.min(...windows.map((window) => window.start));
  const latest = Math.max(...windows.map((window) => window.end));
  const providers = new Map(
    connections.map((connection) => [connection.id, connection.provider]),
  );
  const connectionIds = connections.map((connection) => connection.id);
  const intervalFilter = windows
    .map(
      (window) =>
        `and(bucket_start.gte.${bucketStartFloor(window.start)},bucket_start.lt.${new Date(window.end).toISOString()})`,
    )
    .join(",");
  const [summaryResult, bucketResult] = await Promise.all([
    options.client
      .from("fitness_workout_summaries")
      .select(
        "id, connection_id, workout_type, started_at, ended_at, average_heart_rate, maximum_heart_rate, extensions",
      )
      .eq("user_id", options.userId)
      .in("connection_id", connectionIds)
      .gte(
        "started_at",
        new Date(earliest - MAXIMUM_BOUNDARY_DRIFT_MS).toISOString(),
      )
      .lte(
        "started_at",
        new Date(latest + MAXIMUM_BOUNDARY_DRIFT_MS).toISOString(),
      )
      .order("started_at")
      .limit(MAXIMUM_PROVIDER_SUMMARIES),
    options.client
      .from("fitness_hr_5m")
      .select(
        "connection_id, bucket_start, average_bpm, minimum_bpm, maximum_bpm, sample_count",
      )
      .eq("user_id", options.userId)
      .in("connection_id", connectionIds)
      .or(intervalFilter)
      .order("bucket_start")
      .limit(MAXIMUM_REVIEW_BUCKETS),
  ]);
  if (bucketResult.error) {
    if (!["42P01", "PGRST205"].includes(bucketResult.error.code ?? "")) {
      console.warn("Workout heart-rate buckets could not be loaded:", {
        code: bucketResult.error.code,
      });
    }
    return emptyReview("unavailable", lastSyncedAt);
  }
  if (
    summaryResult.error &&
    !["42P01", "PGRST205"].includes(summaryResult.error.code ?? "")
  ) {
    console.warn("Workout heart-rate summaries could not be loaded:", {
      code: summaryResult.error.code,
    });
  }

  const summaries: RetrospectiveWorkoutSummary[] = summaryResult.error
    ? []
    : (summaryResult.data ?? []).map((summary) => ({
        id: summary.id,
        connectionId: summary.connection_id,
        provider: providers.get(summary.connection_id) ?? "google_health",
        workoutType: summary.workout_type,
        startedAt: summary.started_at,
        endedAt: summary.ended_at,
        averageBpm:
          summary.average_heart_rate === null
            ? null
            : Number(summary.average_heart_rate),
        maximumBpm:
          summary.maximum_heart_rate === null
            ? null
            : Number(summary.maximum_heart_rate),
        extensions: summary.extensions,
      }));
  const summaryByLog = new Map(
    matchRetrospectiveWorkouts(logs, summaries).map((match) => [
      match.log.id,
      match.summary,
    ]),
  );
  const bucketRows = (bucketResult.data ?? []) as HeartRateBucketRow[];

  const workouts = logs.flatMap((log): WeeklyHeartRateWorkout[] => {
    const window = logWindow(log);
    if (window === undefined) return [];
    const summary = summaryByLog.get(log.id);
    const buckets = parseBuckets(
      bucketRows
        .filter((row) => {
          const at = instant(row.bucket_start);
          return (
            at !== undefined &&
            at < window.end &&
            at + 5 * 60_000 > window.start
          );
        })
        .slice(0, MAXIMUM_BUCKETS_PER_WORKOUT),
    );
    const calculated = summarizeBuckets(buckets);
    const averageBpm = validBpm(summary?.averageBpm) ?? calculated.averageBpm;
    const maximumBpm = validBpm(summary?.maximumBpm) ?? calculated.maximumBpm;
    if (
      buckets.length === 0 &&
      averageBpm === undefined &&
      maximumBpm === undefined
    ) {
      return [];
    }
    return [
      {
        id: log.id,
        label: log.label,
        startedAt: new Date(window.start).toISOString(),
        endedAt: new Date(window.end).toISOString(),
        provider:
          summary?.provider ?? connections.at(0)?.provider ?? "google_health",
        ...(averageBpm === undefined ? {} : { averageBpm }),
        ...(maximumBpm === undefined ? {} : { maximumBpm }),
        buckets,
      },
    ];
  });
  return {
    status: workouts.length > 0 ? "ready" : "awaiting_sync",
    ...(lastSyncedAt === undefined ? {} : { lastSyncedAt }),
    workouts,
  };
}
