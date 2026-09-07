export const PERSISTENCE_LIMITS = {
  programPayloadBytes: 1_048_576,
  questionnaireBytes: 65_536,
  workoutExerciseLogsBytes: 131_072,
  workoutCardioLogBytes: 16_384,
  workoutMovementLogBytes: 4_096,
  weeklyReviewMetricsBytes: 65_536,
  weeklyReviewResultBytes: 65_536,
  programReversePatchBytes: 262_144,
} as const;

export class PersistenceLimitError extends Error {
  constructor(
    readonly field: string,
    readonly actualBytes: number,
    readonly maximumBytes: number,
  ) {
    super(
      `${field} is too large to save safely (${actualBytes} bytes; maximum ${maximumBytes} bytes).`,
    );
    this.name = "PersistenceLimitError";
  }
}

/** UTF-8 JSON size, matching the data PostgreSQL receives closely enough to fail early. */
export function jsonByteLength(value: unknown): number {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return 0;
  return new TextEncoder().encode(serialized).byteLength;
}

export function assertJsonSize(
  field: string,
  value: unknown,
  maximumBytes: number,
): void {
  const actualBytes = jsonByteLength(value);
  if (actualBytes > maximumBytes)
    throw new PersistenceLimitError(field, actualBytes, maximumBytes);
}

export function assertProgramWriteSizes(
  questionnaire: unknown,
  payload: unknown,
): void {
  assertJsonSize(
    "Questionnaire answers",
    questionnaire,
    PERSISTENCE_LIMITS.questionnaireBytes,
  );
  assertJsonSize(
    "Generated program",
    payload,
    PERSISTENCE_LIMITS.programPayloadBytes,
  );
}

export function assertWorkoutWriteSizes(input: {
  exerciseLogs: unknown;
  cardioLog: unknown;
  movementLog: unknown;
  newProgramPayload?: unknown;
  reversePatch?: unknown;
}): void {
  assertJsonSize(
    "Exercise log",
    input.exerciseLogs,
    PERSISTENCE_LIMITS.workoutExerciseLogsBytes,
  );
  assertJsonSize(
    "Cardio log",
    input.cardioLog,
    PERSISTENCE_LIMITS.workoutCardioLogBytes,
  );
  assertJsonSize(
    "Movement check-in",
    input.movementLog,
    PERSISTENCE_LIMITS.workoutMovementLogBytes,
  );
  if (input.newProgramPayload !== undefined)
    assertJsonSize(
      "Updated program",
      input.newProgramPayload,
      PERSISTENCE_LIMITS.programPayloadBytes,
    );
  if (input.reversePatch !== undefined)
    assertJsonSize(
      "Program history patch",
      input.reversePatch,
      PERSISTENCE_LIMITS.programReversePatchBytes,
    );
}

export function assertWeeklyReviewWriteSizes(input: {
  metrics: unknown;
  result: unknown;
  newProgramPayload?: unknown;
  reversePatch?: unknown;
}): void {
  assertJsonSize(
    "Weekly review metrics",
    input.metrics,
    PERSISTENCE_LIMITS.weeklyReviewMetricsBytes,
  );
  assertJsonSize(
    "Weekly review result",
    input.result,
    PERSISTENCE_LIMITS.weeklyReviewResultBytes,
  );
  if (input.newProgramPayload !== undefined)
    assertJsonSize(
      "Updated program",
      input.newProgramPayload,
      PERSISTENCE_LIMITS.programPayloadBytes,
    );
  if (input.reversePatch !== undefined)
    assertJsonSize(
      "Program history patch",
      input.reversePatch,
      PERSISTENCE_LIMITS.programReversePatchBytes,
    );
}
