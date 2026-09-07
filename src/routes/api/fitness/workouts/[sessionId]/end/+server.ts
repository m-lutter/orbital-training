import {
  fitnessConfigurationStatus,
  fitnessRuntimeConfig,
} from "$lib/server/fitness/config";
import {
  deferFitnessTask,
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
  endWorkoutCapture,
  findWorkoutCapture,
  pollWorkoutHeartRate,
  summarizeWorkoutTelemetry,
  workoutSourceSessionKey,
  workoutTelemetry,
  type WorkoutTelemetryContract,
} from "$lib/server/fitness/workout";
import { error, json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

function captureWithoutSamples(capture: {
  endedAt: string | null;
  id: string;
  startedAt: string;
}): WorkoutTelemetryContract {
  return {
    workoutSessionId: capture.id,
    status: capture.endedAt === null ? "active" : "complete",
    startedAt: capture.startedAt,
    endedAt: capture.endedAt,
    samples: [],
    buckets: [],
  };
}

async function telemetryOrFallback(options: {
  capture: { endedAt: string | null; id: string; startedAt: string };
  config: Parameters<typeof workoutTelemetry>[0]["config"];
  userId: string;
}): Promise<WorkoutTelemetryContract> {
  try {
    return (
      (await workoutTelemetry({
        config: options.config,
        userId: options.userId,
        workoutSessionId: options.capture.id,
      })) ?? captureWithoutSamples(options.capture)
    );
  } catch (caught) {
    console.warn("Workout capture telemetry was unavailable during end:", {
      type: caught instanceof Error ? caught.name : "unknown",
    });
    return captureWithoutSamples(options.capture);
  }
}

async function waitAtMost(task: Promise<unknown>, milliseconds: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      task,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, milliseconds);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

const endCapture: RequestHandler = async (event) => {
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
  // Ending is idempotent. A browser may retain an identifier after a
  // reconnect or after a request whose response was lost. Reconcile against
  // the authoritative capture for this workout before treating it as absent.
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
  if (capture.endedAt !== null) {
    const existing = await telemetryOrFallback({
      capture,
      config,
      userId: user.id,
    });
    return json(existing, {
      headers: { "cache-control": "private, no-store" },
    });
  }

  const connection = (await listFitnessConnections(config, user.id)).find(
    (candidate) => candidate.id === capture.connectionId,
  );
  const endedAt = new Date(
    Math.min(Date.now(), Date.parse(capture.startedAt) + 48 * 60 * 60 * 1000),
  ).toISOString();
  const catchUpTask =
    connection?.provider === "google_health"
      ? pollWorkoutHeartRate({
          config,
          connection,
          endedAt,
          sourceSessionKey: workoutSourceSessionKey(
            programId,
            event.params.sessionId,
          ),
          startedAt: capture.startedAt,
          userId: user.id,
        })
      : undefined;
  if (catchUpTask !== undefined) await waitAtMost(catchUpTask, 2_500);

  const beforeEnd = await telemetryOrFallback({
    capture,
    config,
    userId: user.id,
  });
  const endedCaptureId = await endWorkoutCapture({
    config,
    connectionId: capture.connectionId,
    endedAt,
    programId,
    sessionId: event.params.sessionId,
    summary: summarizeWorkoutTelemetry(beforeEnd),
    userId: user.id,
  });
  const completed: WorkoutTelemetryContract = {
    ...beforeEnd,
    workoutSessionId: endedCaptureId,
    status: "complete",
    endedAt,
  };

  if (connection?.provider === "google_health" && catchUpTask !== undefined) {
    deferFitnessTask(
      event,
      "completed_workout_heart_rate_catch_up",
      (async () => {
        const result = await catchUpTask;
        if (result.status === "skipped") {
          await new Promise((resolve) => setTimeout(resolve, 1_500));
        }
        const refreshed = await workoutTelemetry({
          config,
          userId: user.id,
          workoutSessionId: capture.id,
        });
        if (refreshed === null) return;
        await endWorkoutCapture({
          config,
          connectionId: capture.connectionId,
          endedAt,
          programId,
          sessionId: event.params.sessionId,
          summary: summarizeWorkoutTelemetry(refreshed),
          userId: user.id,
        });
      })(),
    );
  }
  return json(completed, {
    headers: { "cache-control": "private, no-store" },
  });
};

export const POST: RequestHandler = (event) =>
  fitnessJsonErrorBoundary(
    "workout_capture_end",
    "Workout capture could not end.",
    () => endCapture(event),
  );
