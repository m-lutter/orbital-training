import type { Database, Json } from "$lib/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { error, isHttpError } from "@sveltejs/kit";
import type { FitnessRuntimeConfig } from "./config";
import { fetchGoogleWorkoutHeartRate } from "./provider-data";
import { FitnessProviderError } from "./provider-clients";
import {
  claimFitnessSync,
  completeFitnessSync,
  failFitnessSync,
  fitnessServiceClient,
  ingestHeartRateSamples,
  listFitnessConnections,
  loadFitnessTokens,
  type FitnessConnectionRow,
  type FitnessSyncLease,
} from "./repository";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface WorkoutTelemetryContract {
  buckets: Array<{
    avgBpm: number;
    bucketStart: string;
    maxBpm: number;
    minBpm: number;
    sampleCount: number;
  }>;
  endedAt: string | null;
  checkedAt?: string;
  hasMore?: boolean;
  isDelta?: boolean;
  fullAverageHeartRateBpm?: number;
  fullMaximumHeartRateBpm?: number;
  fullSampleCount?: number;
  samples: Array<{ bpm: number; recordedAt: string }>;
  startedAt: string;
  status: "active" | "complete";
  workoutSessionId: string;
}

export const WORKOUT_TELEMETRY_DELTA_LIMIT = 500;

export interface WorkoutTelemetrySummary {
  averageHeartRateBpm?: number;
  detailedSampleCount: number;
  fiveMinuteBucketCount: number;
  maximumHeartRateBpm?: number;
}

export type WorkoutHeartRateImportError =
  | "provider_auth"
  | "provider_rate_limit"
  | "provider_request"
  | "provider_unavailable"
  | "workout_hr_sync_failed";

export type WorkoutHeartRatePollResult =
  | { status: "updated"; sampleCount: number }
  | { status: "skipped"; sampleCount: 0 }
  | {
      status: "failed";
      sampleCount: 0;
      errorCode: WorkoutHeartRateImportError;
    };

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function iso(value: unknown): string | undefined {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : undefined;
}

function number(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseWorkoutTelemetry(
  value: unknown,
): WorkoutTelemetryContract | null {
  const item = record(value);
  const workoutSessionId = item?.workoutSessionId;
  const startedAt = iso(item?.startedAt);
  const endedAt = item?.endedAt === null ? null : iso(item?.endedAt);
  const status = item?.status;
  const rawSummary = record(item?.rawSummary);
  const fullSampleCount = number(rawSummary?.sampleCount);
  const fullAverageHeartRateBpm = number(rawSummary?.averageBpm);
  const fullMaximumHeartRateBpm = number(rawSummary?.maximumBpm);
  if (
    typeof workoutSessionId !== "string" ||
    startedAt === undefined ||
    (status !== "active" && status !== "complete") ||
    (item?.endedAt !== null && endedAt === undefined)
  ) {
    return null;
  }
  const samples = Array.isArray(item?.samples)
    ? item.samples.flatMap((value) => {
        const sample = record(value);
        const recordedAt = iso(sample?.recordedAt);
        const bpm = number(sample?.bpm);
        return recordedAt !== undefined &&
          bpm !== undefined &&
          bpm >= 20 &&
          bpm <= 300
          ? [{ recordedAt, bpm }]
          : [];
      })
    : [];
  const buckets = Array.isArray(item?.buckets)
    ? item.buckets.flatMap((value) => {
        const bucket = record(value);
        const bucketStart = iso(bucket?.bucketStart);
        const avgBpm = number(bucket?.avgBpm);
        const minBpm = number(bucket?.minBpm);
        const maxBpm = number(bucket?.maxBpm);
        const sampleCount = Math.max(
          1,
          Math.round(number(bucket?.sampleCount) ?? 1),
        );
        return bucketStart !== undefined &&
          avgBpm !== undefined &&
          minBpm !== undefined &&
          maxBpm !== undefined
          ? [{ bucketStart, avgBpm, minBpm, maxBpm, sampleCount }]
          : [];
      })
    : [];
  return {
    workoutSessionId,
    status,
    startedAt,
    endedAt: endedAt ?? null,
    ...(fullSampleCount !== undefined && fullSampleCount >= 0
      ? { fullSampleCount: Math.round(fullSampleCount) }
      : {}),
    ...(fullAverageHeartRateBpm !== undefined &&
    fullAverageHeartRateBpm >= 20 &&
    fullAverageHeartRateBpm <= 300
      ? { fullAverageHeartRateBpm }
      : {}),
    ...(fullMaximumHeartRateBpm !== undefined &&
    fullMaximumHeartRateBpm >= 20 &&
    fullMaximumHeartRateBpm <= 300
      ? { fullMaximumHeartRateBpm }
      : {}),
    samples,
    buckets,
  };
}

function sourceSessionKey(programId: string, sessionId: string): string {
  if (
    !UUID_PATTERN.test(programId) ||
    sessionId.length < 1 ||
    sessionId.length > 160
  ) {
    throw error(400, "The workout could not be identified.");
  }
  return `${programId}:${sessionId}`;
}

export async function assertOwnedProgram(
  userClient: SupabaseClient<Database>,
  programId: string,
): Promise<void> {
  if (!UUID_PATTERN.test(programId)) throw error(400, "Invalid program.");
  const { data, error: queryError } = await userClient
    .from("programs")
    .select("id")
    .eq("id", programId)
    .maybeSingle();
  if (queryError) throw error(500, "The program could not be checked.");
  if (data === null) throw error(404, "Program not found.");
}

export async function preferredWorkoutConnection(
  config: FitnessRuntimeConfig,
  userId: string,
): Promise<FitnessConnectionRow | null> {
  const candidates = (await listFitnessConnections(config, userId)).filter(
    (connection) =>
      connection.status === "active" &&
      ["apple_health", "health_connect", "google_health"].includes(
        connection.provider,
      ),
  );
  return (
    candidates.sort((left, right) => {
      const leftSync = Date.parse(left.last_synced_at ?? left.connected_at);
      const rightSync = Date.parse(right.last_synced_at ?? right.connected_at);
      return rightSync - leftSync;
    })[0] ?? null
  );
}

export async function startWorkoutCapture(options: {
  config: FitnessRuntimeConfig;
  connection: FitnessConnectionRow;
  programId: string;
  sessionId: string;
  startedAt?: string;
  userId: string;
}): Promise<{ startedAt: string; workoutSessionId: string }> {
  const startedAt = options.startedAt ?? new Date().toISOString();
  const { data, error: rpcError } = await fitnessServiceClient(
    options.config,
  ).rpc("fitness_start_workout_session", {
    p_user_id: options.userId,
    p_connection_id: options.connection.id,
    p_source_session_key: sourceSessionKey(
      options.programId,
      options.sessionId,
    ),
    p_started_at: startedAt,
    p_workout_type: "strength_training",
    p_metadata: {
      programId: options.programId,
      sessionId: options.sessionId,
      initiatedBy: "web",
    } satisfies Json,
  });
  if (rpcError || data === null) {
    console.error("Unable to start workout capture:", { code: rpcError?.code });
    throw error(500, "Workout capture could not start.");
  }
  return { workoutSessionId: data, startedAt };
}

export async function findWorkoutCapture(options: {
  config: FitnessRuntimeConfig;
  programId: string;
  sessionId: string;
  userId: string;
  workoutSessionId?: string;
}): Promise<{
  connectionId: string;
  endedAt: string | null;
  id: string;
  startedAt: string;
} | null> {
  let query = fitnessServiceClient(options.config)
    .from("fitness_workout_sessions")
    .select("id, connection_id, started_at, ended_at")
    .eq("user_id", options.userId)
    .eq(
      "source_session_key",
      sourceSessionKey(options.programId, options.sessionId),
    );
  if (options.workoutSessionId !== undefined) {
    if (!UUID_PATTERN.test(options.workoutSessionId)) {
      throw error(400, "Invalid workout capture.");
    }
    query = query.eq("id", options.workoutSessionId);
  }
  const { data, error: queryError } = await query
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (queryError) {
    console.error("Unable to find workout capture:", { code: queryError.code });
    throw error(500, "Workout capture could not be loaded.");
  }
  return data === null
    ? null
    : {
        id: data.id,
        connectionId: data.connection_id,
        startedAt: data.started_at,
        endedAt: data.ended_at,
      };
}

export async function workoutTelemetry(options: {
  config: FitnessRuntimeConfig;
  userId: string;
  workoutSessionId: string;
}): Promise<WorkoutTelemetryContract | null> {
  const client = fitnessServiceClient(options.config);
  const rpc = client.rpc as unknown as (
    name: "fitness_get_workout_raw_detail",
    args: {
      p_user_id: string;
      p_workout_session_id: string;
      p_max_samples: number;
    },
  ) => Promise<{ data: Json | null; error: { code?: string } | null }>;
  const { data, error: rpcError } = await rpc(
    "fitness_get_workout_raw_detail",
    {
      p_user_id: options.userId,
      p_workout_session_id: options.workoutSessionId,
      p_max_samples: 5000,
    },
  );
  if (rpcError) {
    console.error("Unable to load workout telemetry:", { code: rpcError.code });
    throw error(500, "Workout telemetry could not be loaded.");
  }
  return parseWorkoutTelemetry(data);
}

/**
 * Read only newly stored raw points for an active chart. Unlike the full
 * detail RPC, this uses an indexed keyset cursor and a hard row cap, so it is
 * safe for the visible page's five-second refresh cadence.
 */
export async function workoutTelemetryDelta(options: {
  after?: string;
  config: FitnessRuntimeConfig;
  connectionId: string;
  endedAt: string | null;
  sourceSessionKey: string;
  startedAt: string;
  userId: string;
  workoutSessionId: string;
}): Promise<WorkoutTelemetryContract> {
  const startedAt = new Date(options.startedAt).toISOString();
  const upperBound = new Date(
    Math.min(
      Date.parse(options.endedAt ?? new Date().toISOString()),
      Date.parse(startedAt) + 48 * 60 * 60 * 1000,
    ),
  ).toISOString();
  const requestedAfter = iso(options.after);
  const after =
    requestedAfter === undefined ||
    Date.parse(requestedAfter) < Date.parse(startedAt)
      ? undefined
      : requestedAfter;
  let query = fitnessServiceClient(options.config)
    .from("fitness_hr_samples")
    .select("sampled_at, bpm")
    .eq("user_id", options.userId)
    .eq("connection_id", options.connectionId)
    .eq("source_session_key", options.sourceSessionKey)
    .lte("sampled_at", upperBound)
    .order("sampled_at", { ascending: true })
    .limit(WORKOUT_TELEMETRY_DELTA_LIMIT + 1);
  query =
    after === undefined
      ? query.gte("sampled_at", startedAt)
      : query.gt("sampled_at", after);
  const { data, error: queryError } = await query;
  if (queryError) {
    console.error("Unable to load live workout telemetry:", {
      code: queryError.code,
    });
    throw error(500, "Live workout telemetry could not be loaded.");
  }
  const rows = (data ?? []).slice(0, WORKOUT_TELEMETRY_DELTA_LIMIT);
  return {
    workoutSessionId: options.workoutSessionId,
    status: options.endedAt === null ? "active" : "complete",
    startedAt,
    endedAt: options.endedAt,
    checkedAt: new Date().toISOString(),
    isDelta: true,
    hasMore: (data?.length ?? 0) > WORKOUT_TELEMETRY_DELTA_LIMIT,
    samples: rows.map((row) => ({
      recordedAt: row.sampled_at,
      bpm: row.bpm,
    })),
    buckets: [],
  };
}

export async function pollWorkoutHeartRate(options: {
  config: FitnessRuntimeConfig;
  connection: FitnessConnectionRow;
  endedAt?: string;
  sourceSessionKey: string;
  startedAt: string;
  userId: string;
}): Promise<WorkoutHeartRatePollResult> {
  if (options.connection.provider !== "google_health") {
    return { status: "skipped", sampleCount: 0 };
  }
  let lease: FitnessSyncLease | null = null;
  try {
    lease = await claimFitnessSync({
      config: options.config,
      userId: options.userId,
      connectionId: options.connection.id,
      minimumIntervalSeconds: 20,
      purpose: "workout",
    });
    if (lease === null) return { status: "skipped", sampleCount: 0 };
    const tokens = await loadFitnessTokens({
      config: options.config,
      userId: options.userId,
      connection: options.connection,
    });
    const { data: latestSample, error: latestError } =
      await fitnessServiceClient(options.config)
        .from("fitness_hr_samples")
        .select("sampled_at")
        .eq("user_id", options.userId)
        .eq("connection_id", options.connection.id)
        .eq("source_session_key", options.sourceSessionKey)
        .order("sampled_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (latestError) throw latestError;
    const latest = latestSample?.sampled_at;
    const overlapStart =
      options.endedAt !== undefined
        ? options.startedAt
        : latest === undefined
          ? options.startedAt
          : new Date(
              Math.max(
                Date.parse(options.startedAt),
                Date.parse(latest) - 60_000,
              ),
            ).toISOString();
    const samples = await fetchGoogleWorkoutHeartRate({
      accessToken: tokens.accessToken,
      startTime: overlapStart,
      endTime: options.endedAt ?? new Date().toISOString(),
    });
    await ingestHeartRateSamples({
      config: options.config,
      userId: options.userId,
      connectionId: options.connection.id,
      expectedGeneration: lease.generation,
      samples: samples.map((sample) => ({
        ...sample,
        sourceSessionKey: options.sourceSessionKey,
      })),
    });
    await completeFitnessSync({
      config: options.config,
      connectionId: options.connection.id,
      leaseToken: lease.leaseToken,
      nextSyncAt: new Date(Date.now() + 20_000).toISOString(),
    });
    return { status: "updated", sampleCount: samples.length };
  } catch (caught) {
    const errorCode: WorkoutHeartRateImportError =
      caught instanceof FitnessProviderError
        ? caught.status === 401 || caught.status === 403
          ? "provider_auth"
          : caught.status === 429
            ? "provider_rate_limit"
            : caught.status >= 500
              ? "provider_unavailable"
              : "provider_request"
        : isHttpError(caught) && caught.status === 409
          ? "provider_auth"
          : "workout_hr_sync_failed";
    if (lease !== null) {
      await failFitnessSync({
        config: options.config,
        connectionId: options.connection.id,
        leaseToken: lease.leaseToken,
        errorCode,
      });
    }
    console.warn("Workout heart-rate catch-up failed:", {
      provider: options.connection.provider,
      code: errorCode,
    });
    return { status: "failed", sampleCount: 0, errorCode };
  }
}

export function summarizeWorkoutTelemetry(
  telemetry: WorkoutTelemetryContract,
): WorkoutTelemetrySummary {
  if (
    (telemetry.fullSampleCount ?? 0) > 0 &&
    telemetry.fullAverageHeartRateBpm !== undefined &&
    telemetry.fullMaximumHeartRateBpm !== undefined
  ) {
    return {
      averageHeartRateBpm: Math.round(telemetry.fullAverageHeartRateBpm),
      maximumHeartRateBpm: Math.round(telemetry.fullMaximumHeartRateBpm),
      detailedSampleCount: telemetry.fullSampleCount as number,
      fiveMinuteBucketCount: telemetry.buckets.length,
    };
  }
  if (telemetry.samples.length > 0) {
    const total = telemetry.samples.reduce(
      (sum, sample) => sum + sample.bpm,
      0,
    );
    return {
      averageHeartRateBpm: Math.round(total / telemetry.samples.length),
      maximumHeartRateBpm: Math.max(
        ...telemetry.samples.map((sample) => sample.bpm),
      ),
      detailedSampleCount: telemetry.samples.length,
      fiveMinuteBucketCount: telemetry.buckets.length,
    };
  }
  const knownCounts = telemetry.buckets.map((bucket) =>
    Math.max(1, bucket.sampleCount),
  );
  const sampleCount = knownCounts.reduce((sum, count) => sum + count, 0);
  return {
    ...(sampleCount > 0
      ? {
          averageHeartRateBpm: Math.round(
            telemetry.buckets.reduce(
              (sum, bucket, index) => sum + bucket.avgBpm * knownCounts[index],
              0,
            ) / sampleCount,
          ),
          maximumHeartRateBpm: Math.max(
            ...telemetry.buckets.map((bucket) => bucket.maxBpm),
          ),
        }
      : {}),
    detailedSampleCount: 0,
    fiveMinuteBucketCount: telemetry.buckets.length,
  };
}

export async function endWorkoutCapture(options: {
  config: FitnessRuntimeConfig;
  connectionId: string;
  endedAt?: string;
  programId: string;
  sessionId: string;
  summary?: WorkoutTelemetrySummary;
  userId: string;
}): Promise<string> {
  const { data, error: rpcError } = await fitnessServiceClient(
    options.config,
  ).rpc("fitness_end_workout_session", {
    p_user_id: options.userId,
    p_connection_id: options.connectionId,
    p_source_session_key: sourceSessionKey(
      options.programId,
      options.sessionId,
    ),
    p_ended_at: options.endedAt ?? new Date().toISOString(),
    p_summary: {
      endedBy: "web",
      ...(options.summary ?? {
        detailedSampleCount: 0,
        fiveMinuteBucketCount: 0,
      }),
      rawHeartRateRetentionDays: 7,
      heartRateBucketMinutes: 5,
    } satisfies Json,
  });
  if (rpcError || data === null) {
    console.error("Unable to end workout capture:", { code: rpcError?.code });
    throw error(500, "Workout capture could not end.");
  }
  return data;
}

export async function resetWorkoutCapture(options: {
  config: FitnessRuntimeConfig;
  connectionId: string;
  programId: string;
  sessionId: string;
  userId: string;
}): Promise<boolean> {
  const { data, error: rpcError } = await fitnessServiceClient(
    options.config,
  ).rpc("fitness_reset_workout_session", {
    p_user_id: options.userId,
    p_connection_id: options.connectionId,
    p_source_session_key: sourceSessionKey(
      options.programId,
      options.sessionId,
    ),
  });
  if (rpcError) {
    console.error("Unable to reset workout capture:", {
      code: rpcError.code,
    });
    throw error(500, "Workout capture could not reset.");
  }
  return data;
}

export const workoutSourceSessionKey = sourceSessionKey;
