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
import { requireFitnessUser } from "$lib/server/fitness/repository";
import {
  assertOwnedProgram,
  findWorkoutCapture,
  resetWorkoutCapture,
} from "$lib/server/fitness/workout";
import { error, json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

const resetCapture: RequestHandler = async (event) => {
  requireFitnessMutationOrigin(event);
  const { user, userClient } = await requireFitnessUser(event);
  if (!fitnessConfigurationStatus(event).baseConfigured) {
    throw error(503, "Wearable workout capture is not configured yet.");
  }
  const body = await readFitnessObject(event.request);
  const programId = requiredShortString(body.programId, "Program", 64);
  const workoutSessionId = requiredShortString(
    body.workoutSessionId,
    "Workout capture",
    64,
  );
  await assertOwnedProgram(userClient, programId);
  const config = fitnessRuntimeConfig(event);
  let capture = await findWorkoutCapture({
    config,
    programId,
    sessionId: event.params.sessionId,
    userId: user.id,
    workoutSessionId,
  });
  capture ??= await findWorkoutCapture({
    config,
    programId,
    sessionId: event.params.sessionId,
    userId: user.id,
  });
  if (capture === null) {
    return new Response(null, {
      status: 204,
      headers: { "cache-control": "private, no-store" },
    });
  }

  await resetWorkoutCapture({
    config,
    connectionId: capture.connectionId,
    programId,
    sessionId: event.params.sessionId,
    userId: user.id,
  });
  return json(
    { reset: true },
    { headers: { "cache-control": "private, no-store" } },
  );
};

export const POST: RequestHandler = (event) =>
  fitnessJsonErrorBoundary(
    "workout_capture_reset",
    "Workout capture could not reset.",
    () => resetCapture(event),
  );
