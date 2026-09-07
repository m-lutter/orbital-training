import {
  fitnessConfigurationStatus,
  fitnessRuntimeConfig,
} from "$lib/server/fitness/config";
import {
  deferFitnessTask,
  fitnessJsonErrorBoundary,
  requiredShortString,
  settleFitnessTask,
} from "$lib/server/fitness/http";
import {
  listFitnessConnections,
  requireFitnessUser,
} from "$lib/server/fitness/repository";
import {
  assertOwnedProgram,
  findWorkoutCapture,
  pollWorkoutHeartRate,
  workoutSourceSessionKey,
  workoutTelemetry,
  workoutTelemetryDelta,
  type WorkoutHeartRatePollResult,
} from "$lib/server/fitness/workout";
import { error, json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

const GOOGLE_HEART_RATE_SCOPE =
  "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly";

function exposedProvider(provider: string | undefined) {
  return ["apple_health", "google_health", "health_connect"].includes(
    provider ?? "",
  )
    ? provider
    : undefined;
}

function cursor(value: string | null): string | undefined {
  if (value === null) return undefined;
  if (value.length > 64 || !Number.isFinite(Date.parse(value))) {
    throw error(400, "The live heart-rate cursor is invalid.");
  }
  return new Date(value).toISOString();
}

function providerPollIsDue(connection: {
  last_error_code: string | null;
  last_synced_at: string | null;
  updated_at: string;
}): boolean {
  const reference =
    connection.last_error_code === null
      ? connection.last_synced_at
      : connection.updated_at;
  return (
    reference === null ||
    !Number.isFinite(Date.parse(reference)) ||
    Date.now() - Date.parse(reference) >= 20_000
  );
}

const loadCapture: RequestHandler = async (event) => {
  const { user, userClient } = await requireFitnessUser(event);
  if (!fitnessConfigurationStatus(event).baseConfigured) {
    return new Response(null, { status: 204 });
  }
  const programId = requiredShortString(
    event.url.searchParams.get("programId"),
    "Program",
    64,
  );
  const requestedId =
    event.url.searchParams.get("workoutSessionId") ?? undefined;
  await assertOwnedProgram(userClient, programId);
  const config = fitnessRuntimeConfig(event);
  let capture = await findWorkoutCapture({
    config,
    programId,
    sessionId: event.params.sessionId,
    userId: user.id,
    workoutSessionId: requestedId,
  });
  if (capture === null && requestedId !== undefined) {
    capture = await findWorkoutCapture({
      config,
      programId,
      sessionId: event.params.sessionId,
      userId: user.id,
    });
  }
  if (capture === null) {
    return json(
      { message: "No workout capture has started." },
      { status: 404 },
    );
  }

  let connectionLookupFailed = false;
  let connection:
    Awaited<ReturnType<typeof listFitnessConnections>>[number] | undefined;
  try {
    connection = (await listFitnessConnections(config, user.id)).find(
      (candidate) => candidate.id === capture.connectionId,
    );
  } catch (caught) {
    connectionLookupFailed = true;
    console.warn("Workout capture connection was unavailable during status:", {
      type: caught instanceof Error ? caught.name : "unknown",
    });
  }

  let pollResult: WorkoutHeartRatePollResult | undefined;
  const missingGoogleHeartRateScope =
    connection?.provider === "google_health" &&
    !connection.scopes.includes(GOOGLE_HEART_RATE_SCOPE);
  if (
    connection?.provider === "google_health" &&
    connection.status === "active" &&
    !missingGoogleHeartRateScope &&
    providerPollIsDue(connection)
  ) {
    const sourceSessionKey = workoutSourceSessionKey(
      programId,
      event.params.sessionId,
    );
    const pollTask = pollWorkoutHeartRate({
      config,
      connection,
      ...(capture.endedAt === null ? {} : { endedAt: capture.endedAt }),
      sourceSessionKey,
      startedAt: capture.startedAt,
      userId: user.id,
    });
    if (capture.endedAt === null) {
      deferFitnessTask(event, "active_workout_heart_rate_catch_up", pollTask);
    } else {
      // A completed-capture refresh is an explicit request to check for late
      // provider data. Give that request a bounded opportunity to finish
      // before reading telemetry, rather than always returning the snapshot
      // from immediately before the provider call started.
      const settlement = await settleFitnessTask(pollTask, 5_000);
      if (settlement.settled) pollResult = settlement.value;
      else {
        deferFitnessTask(
          event,
          "completed_workout_heart_rate_refresh",
          pollTask,
        );
      }
    }
  }

  if (capture.endedAt === null) {
    const mobileDeepLink = new URL("orbitalhealth://workout");
    mobileDeepLink.searchParams.set("programId", programId);
    mobileDeepLink.searchParams.set("sessionId", event.params.sessionId);
    mobileDeepLink.searchParams.set("workoutSessionId", capture.id);
    const after = cursor(event.url.searchParams.get("after"));
    const telemetry = await workoutTelemetryDelta({
      ...(after === undefined ? {} : { after }),
      config,
      connectionId: capture.connectionId,
      endedAt: null,
      sourceSessionKey: workoutSourceSessionKey(
        programId,
        event.params.sessionId,
      ),
      startedAt: capture.startedAt,
      userId: user.id,
      workoutSessionId: capture.id,
    });
    const hasHeartRate =
      telemetry.samples.length > 0 ||
      (after !== undefined &&
        Date.parse(after) > Date.parse(capture.startedAt));
    const importStatus = hasHeartRate
      ? "synced"
      : connectionLookupFailed
        ? "temporarily_unavailable"
        : connection === undefined ||
            connection.status !== "active" ||
            missingGoogleHeartRateScope ||
            connection.last_error_code === "provider_auth"
          ? "reconnect_required"
          : connection.last_error_code !== null
            ? "temporarily_unavailable"
            : "checking";
    return json(
      {
        ...telemetry,
        importStatus,
        ...(exposedProvider(connection?.provider) === undefined
          ? {}
          : { provider: exposedProvider(connection?.provider) }),
        ...(connection?.provider === "apple_health" ||
        connection?.provider === "health_connect"
          ? { mobileDeepLink: mobileDeepLink.toString() }
          : {}),
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  }

  const telemetry = await workoutTelemetry({
    config,
    userId: user.id,
    workoutSessionId: capture.id,
  });
  if (telemetry === null) {
    return json({ message: "Workout capture was not found." }, { status: 404 });
  }

  const hasHeartRate =
    telemetry.samples.length > 0 || telemetry.buckets.length > 0;
  const importStatus = hasHeartRate
    ? "synced"
    : connectionLookupFailed
      ? "temporarily_unavailable"
      : connection === undefined || connection.status !== "active"
        ? "reconnect_required"
        : pollResult?.status === "failed"
          ? pollResult.errorCode === "provider_auth"
            ? "reconnect_required"
            : "temporarily_unavailable"
          : pollResult?.status === "updated" && pollResult.sampleCount === 0
            ? "no_provider_samples"
            : "checking";
  return json(
    {
      ...telemetry,
      importStatus,
      checkedAt: new Date().toISOString(),
      ...(exposedProvider(connection?.provider) === undefined
        ? {}
        : { provider: exposedProvider(connection?.provider) }),
    },
    { headers: { "cache-control": "private, no-store" } },
  );
};

export const GET: RequestHandler = (event) =>
  fitnessJsonErrorBoundary(
    "workout_capture_status",
    "Workout capture could not be checked.",
    () => loadCapture(event),
  );
