import {
  fitnessConfigurationStatus,
  fitnessRuntimeConfig,
} from "$lib/server/fitness/config";
import {
  fitnessJsonErrorBoundary,
  readFitnessObject,
  requiredShortString,
  requireFitnessMutationOrigin,
} from "$lib/server/fitness/http";
import {
  listFitnessConnections,
  requireFitnessUser,
} from "$lib/server/fitness/repository";
import {
  assertOwnedProgram,
  findWorkoutCapture,
  preferredWorkoutConnection,
  startWorkoutCapture,
} from "$lib/server/fitness/workout";
import { error, json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

const startCapture: RequestHandler = async (event) => {
  requireFitnessMutationOrigin(event);
  const { user, userClient } = await requireFitnessUser(event);
  if (!fitnessConfigurationStatus(event).baseConfigured) {
    throw error(503, "Wearable workout capture is not configured yet.");
  }
  const body = await readFitnessObject(event.request);
  const programId = requiredShortString(body.programId, "Program", 64);
  await assertOwnedProgram(userClient, programId);
  const config = fitnessRuntimeConfig(event);

  const existing = await findWorkoutCapture({
    config,
    programId,
    sessionId: event.params.sessionId,
    userId: user.id,
  });
  const deepLink = new URL("orbitalhealth://workout");
  deepLink.searchParams.set("programId", programId);
  deepLink.searchParams.set("sessionId", event.params.sessionId);
  if (existing !== null) {
    deepLink.searchParams.set("workoutSessionId", existing.id);
    const existingConnection = (
      await listFitnessConnections(config, user.id)
    ).find((candidate) => candidate.id === existing.connectionId);
    return json(
      {
        workoutSessionId: existing.id,
        status: existing.endedAt === null ? "active" : "complete",
        startedAt: existing.startedAt,
        ...(existingConnection?.provider === "google_health" ||
        existingConnection?.provider === "apple_health" ||
        existingConnection?.provider === "health_connect"
          ? { provider: existingConnection.provider }
          : {}),
        ...(existing.endedAt === null &&
        (existingConnection?.provider === "apple_health" ||
          existingConnection?.provider === "health_connect")
          ? { mobileDeepLink: deepLink.toString() }
          : {}),
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  }

  const connection = await preferredWorkoutConnection(config, user.id);
  if (connection === null) {
    throw error(
      409,
      "Connect Google Health, Apple Health, or Health Connect before starting wearable capture.",
    );
  }
  const capture = await startWorkoutCapture({
    config,
    connection,
    programId,
    sessionId: event.params.sessionId,
    userId: user.id,
  });
  deepLink.searchParams.set("workoutSessionId", capture.workoutSessionId);
  return json(
    {
      ...capture,
      status: "active",
      provider: connection.provider,
      ...(connection.provider === "apple_health" ||
      connection.provider === "health_connect"
        ? { mobileDeepLink: deepLink.toString() }
        : {}),
    },
    { headers: { "cache-control": "private, no-store" } },
  );
};

export const POST: RequestHandler = (event) =>
  fitnessJsonErrorBoundary(
    "workout_capture_start",
    "Workout capture could not start.",
    () => startCapture(event),
  );
