import {
  fitnessConfigurationStatus,
  fitnessRuntimeConfig,
  type DeviceFitnessProvider,
} from "$lib/server/fitness/config";
import {
  readFitnessObject,
  requireFitnessMutationOrigin,
} from "$lib/server/fitness/http";
import {
  normalizeMobileSync,
  mobileConsentScopes,
  parseMobileSyncEnvelope,
} from "$lib/server/fitness/mobile-sync";
import {
  activeFitnessConnection,
  claimFitnessSync,
  completeFitnessSync,
  deleteMobileFitnessRecords,
  failFitnessSync,
  fitnessServiceClient,
  ingestHeartRateSamples,
  listFitnessConnections,
  persistFitnessSync,
  requireFitnessUser,
} from "$lib/server/fitness/repository";
import {
  endWorkoutCapture,
  summarizeWorkoutTelemetry,
  workoutTelemetry,
} from "$lib/server/fitness/workout";
import { error, json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function providerName(
  provider: "apple_healthkit" | "android_health_connect",
): DeviceFitnessProvider {
  return provider === "apple_healthkit" ? "apple_health" : "health_connect";
}

export const POST: RequestHandler = async (event) => {
  requireFitnessMutationOrigin(event);
  const { user } = await requireFitnessUser(event);
  if (!fitnessConfigurationStatus(event).baseConfigured) {
    throw error(503, "Mobile health synchronization is not configured yet.");
  }
  const body = await readFitnessObject(event.request, 1024 * 1024);
  const envelope = parseMobileSyncEnvelope(body);
  if (envelope === undefined) {
    throw error(400, "The mobile health payload is invalid or unsupported.");
  }
  const config = fitnessRuntimeConfig(event);
  const provider = providerName(envelope.provider);
  const connection = await activeFitnessConnection(config, user.id, provider);
  if (connection === null) {
    const existing = (await listFitnessConnections(config, user.id)).find(
      (candidate) => candidate.provider === provider,
    );
    throw error(
      409,
      existing?.status === "disconnected"
        ? "This device health connection was disconnected. Use Save and request permissions in the companion to reconnect explicitly."
        : "Connect this device from Save and request permissions before syncing.",
    );
  }
  const grantedScopes = new Set(connection.scopes);
  const requestedScopes = mobileConsentScopes(envelope.permissions);
  if (requestedScopes.some((scope) => !grantedScopes.has(scope))) {
    throw error(
      403,
      "The companion requested health categories that were not explicitly saved for this connection.",
    );
  }
  const grantedReadKinds = new Set(envelope.permissions.readScopes);
  const unauthorizedRecord = envelope.records.find((record) => {
    if (record.sourceOrigin === "orbital_companion") return false;
    const requiredKind =
      record.kind === "heart_rate_bucket" ? "heart_rate" : record.kind;
    return !grantedReadKinds.has(requiredKind);
  });
  if (unauthorizedRecord !== undefined) {
    throw error(403, "A mobile health record was outside the granted scope.");
  }

  const service = fitnessServiceClient(config);
  const oldestAllowedStart = new Date(
    Date.now() - 48 * 60 * 60 * 1000,
  ).toISOString();
  let captureQuery = service
    .from("fitness_workout_sessions")
    .select(
      "id, source_session_key, started_at, ended_at, average_heart_rate, maximum_heart_rate",
    )
    .eq("user_id", user.id)
    .eq("connection_id", connection.id)
    .gte("started_at", oldestAllowedStart);
  if (envelope.activeWorkoutSourceSessionKey) {
    captureQuery = captureQuery.eq(
      "source_session_key",
      envelope.activeWorkoutSourceSessionKey,
    );
  }
  const { data: captureWindow, error: captureError } = await captureQuery
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (captureError) {
    console.error("Unable to find a recent mobile workout:", {
      code: captureError.code,
    });
    throw error(500, "The active workout could not be checked.");
  }

  const workoutMode =
    envelope.activeWorkout ||
    envelope.trigger === "workout_started" ||
    envelope.trigger === "workout_stopped" ||
    captureWindow?.ended_at === null;
  const lease = await claimFitnessSync({
    config,
    userId: user.id,
    connectionId: connection.id,
    purpose: workoutMode ? "workout" : "foreground",
    minimumIntervalSeconds: workoutMode ? 25 : 15 * 60,
  });
  if (lease === null) {
    return json(
      {
        accepted: false,
        message: "Health sync is already current or in progress.",
      },
      {
        status: 429,
        headers: {
          "cache-control": "private, no-store",
          "retry-after": workoutMode ? "25" : "900",
        },
      },
    );
  }

  try {
    const normalized = normalizeMobileSync(
      envelope,
      captureWindow === null
        ? undefined
        : {
            id: captureWindow.id,
            sourceSessionKey: captureWindow.source_session_key,
            startedAt: captureWindow.started_at,
            ...(captureWindow.ended_at === null
              ? {}
              : { endedAt: captureWindow.ended_at }),
          },
    );
    await persistFitnessSync({
      config,
      userId: user.id,
      connectionId: connection.id,
      expectedGeneration: lease.generation,
      metrics: normalized.metrics,
      buckets: normalized.buckets,
      summaries: normalized.summaries,
    });
    await ingestHeartRateSamples({
      config,
      userId: user.id,
      connectionId: connection.id,
      expectedGeneration: lease.generation,
      samples: normalized.rawSamples,
    });
    await deleteMobileFitnessRecords({
      config,
      userId: user.id,
      connectionId: connection.id,
      deletions: envelope.deletions,
      expectedGeneration: lease.generation,
    });

    if (captureWindow !== null && captureWindow.ended_at === null) {
      const completion = normalized.completedCompanionWorkouts.find(
        (candidate) =>
          `${candidate.programId}:${candidate.sessionId}` ===
            captureWindow.source_session_key &&
          Date.parse(candidate.endedAt) >=
            Date.parse(captureWindow.started_at) &&
          Date.parse(candidate.endedAt) <=
            Date.parse(captureWindow.started_at) + 48 * 60 * 60 * 1000,
      );
      if (completion !== undefined) {
        const telemetry = await workoutTelemetry({
          config,
          userId: user.id,
          workoutSessionId: captureWindow.id,
        });
        if (telemetry !== null) {
          await endWorkoutCapture({
            config,
            userId: user.id,
            connectionId: connection.id,
            programId: completion.programId,
            sessionId: completion.sessionId,
            endedAt: completion.endedAt,
            summary: summarizeWorkoutTelemetry(telemetry),
          });
        }
      }
    } else if (
      captureWindow !== null &&
      captureWindow.ended_at !== null &&
      normalized.rawSamples.length > 0
    ) {
      const [programId, ...sessionParts] =
        captureWindow.source_session_key.split(":");
      const sessionId = sessionParts.join(":");
      const telemetry = await workoutTelemetry({
        config,
        userId: user.id,
        workoutSessionId: captureWindow.id,
      });
      if (
        telemetry !== null &&
        programId !== undefined &&
        UUID_PATTERN.test(programId) &&
        sessionId.length > 0
      ) {
        const summary = summarizeWorkoutTelemetry(telemetry);
        if (
          summary.averageHeartRateBpm !== captureWindow.average_heart_rate ||
          summary.maximumHeartRateBpm !== captureWindow.maximum_heart_rate
        ) {
          await endWorkoutCapture({
            config,
            userId: user.id,
            connectionId: connection.id,
            programId,
            sessionId,
            endedAt: captureWindow.ended_at,
            summary,
          });
        }
      }
    }
    await completeFitnessSync({
      config,
      connectionId: connection.id,
      leaseToken: lease.leaseToken,
      nextSyncAt: new Date(
        Date.now() + (workoutMode ? 25 : 15 * 60) * 1000,
      ).toISOString(),
    });

    return json(
      {
        accepted: true,
        receivedRecords: envelope.records.length,
        receivedDeletions: envelope.deletions.length,
        storedDailyMetrics: normalized.metrics.length,
        storedHeartRateBuckets: normalized.buckets.length,
        storedDetailedHeartRateSamples: normalized.rawSamples.length,
        ...(captureWindow === null
          ? {}
          : {
              workoutCapture: {
                sourceSessionKey: captureWindow.source_session_key,
                ...(captureWindow.ended_at === null
                  ? {}
                  : { endedAt: captureWindow.ended_at }),
              },
            }),
        deletionPolicy:
          "source-record deletion for detailed HR/workouts; aggregate snapshots plus retention for daily metrics",
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (caught) {
    await failFitnessSync({
      config,
      connectionId: connection.id,
      leaseToken: lease.leaseToken,
      errorCode: "mobile_sync_failed",
    });
    throw caught;
  }
};
