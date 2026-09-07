import {
  isEnabledCloudFitnessProvider,
  type FitnessRuntimeConfig,
} from "./config";
import {
  claimFitnessSync,
  completeFitnessSync,
  failFitnessSync,
  listFitnessConnections,
  loadFitnessTokens,
  persistFitnessSync,
} from "./repository";
import { fitnessSyncDateRange, syncGoogleHealth } from "./provider-data";
import { FitnessProviderError } from "./provider-clients";
import {
  foregroundSyncMinimumIntervalSeconds,
  type FitnessSyncTrigger,
} from "./validation";
export {
  foregroundSyncMinimumIntervalSeconds,
  validFitnessSyncTrigger,
  validLocalDate,
  validTimeZone,
} from "./validation";

const FOREGROUND_SYNC_INTERVAL_SECONDS = 6 * 60 * 60;

export interface ForegroundSyncOutcome {
  attempted: number;
  failed: number;
  partial: number;
  skipped: number;
  succeeded: number;
  warnings: Array<{
    provider: string;
    stage: "workout_summaries";
  }>;
}

function errorCode(caught: unknown): string {
  if (caught instanceof FitnessProviderError) {
    if (caught.status === 401 || caught.status === 403) return "provider_auth";
    if (caught.status === 429) return "provider_rate_limit";
    if (caught.status >= 500) return "provider_unavailable";
    return "provider_request";
  }
  return "sync_failed";
}

export async function foregroundFitnessSync(options: {
  config: FitnessRuntimeConfig;
  localDate: string;
  timeZone: string;
  trigger?: FitnessSyncTrigger;
  userId: string;
}): Promise<ForegroundSyncOutcome> {
  const outcome: ForegroundSyncOutcome = {
    attempted: 0,
    failed: 0,
    partial: 0,
    skipped: 0,
    succeeded: 0,
    warnings: [],
  };
  const connections = await listFitnessConnections(
    options.config,
    options.userId,
  );
  const cloudConnections = connections.filter(
    (connection) =>
      connection.status === "active" &&
      isEnabledCloudFitnessProvider(connection.provider),
  );
  const { startDate, endDate } = fitnessSyncDateRange(options.localDate);
  const minimumIntervalSeconds = foregroundSyncMinimumIntervalSeconds(
    options.trigger ?? "automatic",
  );

  for (const connection of cloudConnections) {
    const lease = await claimFitnessSync({
      config: options.config,
      userId: options.userId,
      connectionId: connection.id,
      minimumIntervalSeconds,
      purpose: "foreground",
    });
    if (lease === null) {
      outcome.skipped += 1;
      continue;
    }
    outcome.attempted += 1;
    try {
      const tokens = await loadFitnessTokens({
        config: options.config,
        userId: options.userId,
        connection,
      });
      if (tokens.provider !== "google_health") {
        throw new Error("Disabled fitness provider reached foreground sync.");
      }
      const normalized = await syncGoogleHealth({
        accessToken: tokens.accessToken,
        startDate,
        endDate,
        timeZone: options.timeZone,
      });
      const persistence = await persistFitnessSync({
        config: options.config,
        userId: options.userId,
        connectionId: connection.id,
        expectedGeneration: lease.generation,
        metrics: normalized.dailyMetrics,
        buckets: normalized.heartRateBuckets,
        summaries: normalized.workoutSummaries,
        tolerateWorkoutSummaryFailure: true,
      });
      if (persistence.workoutSummaries === "failed") {
        outcome.partial += 1;
        outcome.warnings.push({
          provider: connection.provider,
          stage: "workout_summaries",
        });
        console.warn("Fitness foreground sync completed with a warning:", {
          provider: connection.provider,
          stage: "workout_summaries",
        });
      }
      await completeFitnessSync({
        config: options.config,
        connectionId: connection.id,
        leaseToken: lease.leaseToken,
        cursor: options.localDate,
        nextSyncAt: new Date(
          Date.now() + FOREGROUND_SYNC_INTERVAL_SECONDS * 1000,
        ).toISOString(),
      });
      outcome.succeeded += 1;
    } catch (caught) {
      outcome.failed += 1;
      const code = errorCode(caught);
      console.error("Fitness foreground sync failed:", {
        provider: connection.provider,
        code,
      });
      await failFitnessSync({
        config: options.config,
        connectionId: connection.id,
        leaseToken: lease.leaseToken,
        errorCode: code,
      });
    }
  }
  return outcome;
}
