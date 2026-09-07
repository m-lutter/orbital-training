import type {
  CompletedSet,
  ExerciseLog,
  MissReason,
  SessionLog,
  TrainingProgram,
  WeekLog,
  WeeklyState,
} from "$lib/domain";
import {
  isMissReason,
  latestWorkoutLogs,
  type LoggedSet,
  type WorkoutLog,
} from "$lib/workouts";
import type {
  WeeklyReview,
  WeeklyReviewDatabaseRow,
  WeeklyReviewDecision,
  WeeklyReviewMetrics,
  WeeklyReviewSnapshot,
} from "./types";

export * from "./types";
export * from "./presentation";

const TERMINAL_STATUSES = new Set(["completed", "partial", "skipped"]);
const WEEKLY_STATES: WeeklyState[] = [
  "on_track",
  "underloaded",
  "physiologically_overloaded",
  "time_infeasible",
  "schedule_infeasible",
  "exercise_mismatch",
  "safety_constrained",
  "insufficient_data",
];
const REVIEW_DECISIONS: WeeklyReviewDecision[] = [
  "applied",
  "kept",
  "no_change",
];

function completedSet(set: LoggedSet): CompletedSet {
  return {
    reps: set.reps ?? 0,
    ...(set.load === undefined ? {} : { load: set.load }),
    ...(set.rir === undefined ? {} : { rir: set.rir }),
    ...(set.rpe === undefined ? {} : { rpe: set.rpe }),
    completed: set.completed,
    ...(set.techniqueOkay === undefined
      ? {}
      : { techniqueOkay: set.techniqueOkay }),
    ...(set.pain === undefined ? {} : { pain: set.pain }),
  };
}

function missReason(value: unknown): MissReason | undefined {
  return isMissReason(value) ? value : undefined;
}

function reviewExercise(
  exercise: WorkoutLog["exerciseLogs"][number],
): ExerciseLog {
  return {
    prescriptionId: exercise.prescriptionId,
    exerciseId: exercise.exerciseId,
    performanceSeriesId: exercise.performanceSeriesId,
    ...(exercise.prescriptionContext === undefined
      ? {}
      : { prescriptionContext: structuredClone(exercise.prescriptionContext) }),
    sets: exercise.sets.map(completedSet),
    ...(missReason(exercise.missReason) === undefined
      ? {}
      : { missReason: missReason(exercise.missReason) }),
    ...(exercise.painEvent === undefined
      ? {}
      : { painEvent: exercise.painEvent }),
  };
}

function reviewSession(log: WorkoutLog): SessionLog | undefined {
  if (!TERMINAL_STATUSES.has(log.status)) return undefined;
  return {
    sessionId: log.sessionId,
    programVersion: log.programVersion,
    status: log.status as SessionLog["status"],
    ...(log.durationMinutes === undefined
      ? {}
      : { durationMinutes: log.durationMinutes }),
    ...(missReason(log.missReason) === undefined
      ? {}
      : { missReason: missReason(log.missReason) }),
    exercises: log.exerciseLogs.map(reviewExercise),
    ...(log.cardioLog?.modality === undefined
      ? {}
      : { cardioModality: log.cardioLog.modality }),
    ...(log.cardioLog?.prescribedModality === undefined
      ? {}
      : { cardioPrescribedModality: log.cardioLog.prescribedModality }),
    ...(log.cardioLog?.completedMinutes === undefined
      ? {}
      : { cardioCompletedMinutes: log.cardioLog.completedMinutes }),
    ...(log.cardioLog?.sessionRpe === undefined
      ? {}
      : { cardioSessionRpe: log.cardioLog.sessionRpe }),
    ...(log.cardioLog?.distance === undefined
      ? {}
      : { cardioDistance: log.cardioLog.distance }),
    ...(log.cardioLog?.distanceUnit === undefined
      ? {}
      : { cardioDistanceUnit: log.cardioLog.distanceUnit }),
    ...(log.cardioLog?.steps === undefined
      ? {}
      : { cardioSteps: log.cardioLog.steps }),
    ...(log.cardioLog?.movingMinutes === undefined
      ? {}
      : { cardioMovingMinutes: log.cardioLog.movingMinutes }),
    ...(log.cardioLog?.completedIntervals === undefined
      ? {}
      : { cardioCompletedIntervals: log.cardioLog.completedIntervals }),
    ...(log.cardioLog?.averageHeartRate === undefined
      ? {}
      : { cardioAverageHeartRate: log.cardioLog.averageHeartRate }),
    ...(log.cardioLog?.maxHeartRate === undefined
      ? {}
      : { cardioMaxHeartRate: log.cardioLog.maxHeartRate }),
    ...(log.cardioLog?.elevationGain === undefined
      ? {}
      : { cardioElevationGain: log.cardioLog.elevationGain }),
    ...(log.cardioLog?.elevationUnit === undefined
      ? {}
      : { cardioElevationUnit: log.cardioLog.elevationUnit }),
    ...(log.cardioLog?.surface === undefined
      ? {}
      : { cardioSurface: log.cardioLog.surface }),
    ...(log.cardioLog?.source === undefined
      ? {}
      : { cardioSource: log.cardioLog.source }),
    ...(log.movementLog?.met === undefined
      ? {}
      : { movementTargetMet: log.movementLog.met }),
    ...(log.movementLog?.actualSteps === undefined
      ? {}
      : { priorDaySteps: log.movementLog.actualSteps }),
    ...(log.movementLog?.actualWalkingMinutes === undefined
      ? {}
      : { priorDayWalkingMinutes: log.movementLog.actualWalkingMinutes }),
  };
}

/** Converts saved app logs into the frozen observation format used by the engine. */
export function toWeekLogs(
  program: TrainingProgram,
  logs: WorkoutLog[],
  throughWeek: number,
): WeekLog[] {
  const latest = new Map(
    latestWorkoutLogs(logs).map((log) => [log.sessionId, log]),
  );
  return program.weeks
    .filter((week) => week.weekNumber <= throughWeek)
    .map((week) => ({
      weekNumber: week.weekNumber,
      sessions: week.sessions
        .filter((session) => session.kind !== "movement")
        .map((session) => latest.get(session.id))
        .filter((log): log is WorkoutLog => log !== undefined)
        .map(reviewSession)
        .filter((log): log is SessionLog => log !== undefined),
    }));
}

export function summarizeWeek(
  program: TrainingProgram,
  logs: WorkoutLog[],
  weekNumber: number,
): WeeklyReviewMetrics {
  const week = program.weeks.find((item) => item.weekNumber === weekNumber);
  const sessions =
    week?.sessions.filter((session) => session.kind !== "movement") ?? [];
  const latest = new Map(
    latestWorkoutLogs(logs).map((log) => [log.sessionId, log]),
  );
  const weekLogs = sessions
    .map((session) => latest.get(session.id))
    .filter((log): log is WorkoutLog => log !== undefined);
  const plannedExercises = sessions.flatMap((session) => session.exercises);
  const plannedById = new Map(
    plannedExercises.map((exercise) => [exercise.id, exercise]),
  );
  const completedForRole = (accessory: boolean): number =>
    weekLogs.reduce(
      (sum, log) =>
        sum +
        log.exerciseLogs.reduce((exerciseSum, exercise) => {
          const planned = plannedById.get(exercise.prescriptionId);
          if (planned === undefined || planned.optional !== accessory)
            return exerciseSum;
          return (
            exerciseSum + exercise.sets.filter((set) => set.completed).length
          );
        }, 0),
      0,
    );
  const distanceUnit = program.loadSettings.units === "kg" ? "km" : "mi";
  return {
    weekNumber,
    plannedSessions: sessions.length,
    completedSessions: weekLogs.filter((log) => log.status === "completed")
      .length,
    partialSessions: weekLogs.filter((log) => log.status === "partial").length,
    skippedSessions: weekLogs.filter((log) => log.status === "skipped").length,
    plannedSets: sessions.reduce(
      (sum, session) =>
        sum + session.exercises.reduce((sets, item) => sets + item.sets, 0),
      0,
    ),
    completedSets: weekLogs.reduce(
      (sum, log) =>
        sum +
        log.exerciseLogs.reduce(
          (sets, exercise) =>
            sets + exercise.sets.filter((set) => set.completed).length,
          0,
        ),
      0,
    ),
    requiredPlannedSets: plannedExercises
      .filter((exercise) => !exercise.optional)
      .reduce((sum, exercise) => sum + exercise.sets, 0),
    requiredCompletedSets: completedForRole(false),
    accessoryPlannedSets: plannedExercises
      .filter((exercise) => exercise.optional)
      .reduce((sum, exercise) => sum + exercise.sets, 0),
    accessoryCompletedSets: completedForRole(true),
    plannedCardioMinutes: sessions.reduce(
      (sum, session) => sum + (session.cardio?.minutes ?? 0),
      0,
    ),
    completedCardioMinutes: weekLogs.reduce(
      (sum, log) => sum + (log.cardioLog?.completedMinutes ?? 0),
      0,
    ),
    cardioDistance: weekLogs.reduce((sum, log) => {
      const distance = log.cardioLog?.distance ?? 0;
      if (
        log.cardioLog?.distanceUnit === undefined ||
        log.cardioLog.distanceUnit === distanceUnit
      )
        return sum + distance;
      return distanceUnit === "mi"
        ? sum + distance * 0.621371
        : sum + distance * 1.60934;
    }, 0),
    cardioDistanceUnit: distanceUnit,
    cardioSteps: weekLogs.reduce(
      (sum, log) => sum + (log.cardioLog?.steps ?? 0),
      0,
    ),
    cardioMovingMinutes: weekLogs.reduce(
      (sum, log) => sum + (log.cardioLog?.movingMinutes ?? 0),
      0,
    ),
    plannedCardioIntervals: sessions.reduce(
      (sum, session) => sum + (session.cardio?.intervals?.repeats ?? 0),
      0,
    ),
    completedCardioIntervals: weekLogs.reduce(
      (sum, log) => sum + (log.cardioLog?.completedIntervals ?? 0),
      0,
    ),
    qualityCardioMinutes: weekLogs.reduce((sum, log) => {
      const planned = sessions.find((session) => session.id === log.sessionId);
      return planned?.cardio?.role === "intervals" ||
        planned?.cardio?.role === "tempo" ||
        planned?.cardio?.role === "benchmark"
        ? sum +
            (log.cardioLog?.movingMinutes ??
              log.cardioLog?.completedMinutes ??
              0)
        : sum;
    }, 0),
    longestCardioDistance: weekLogs.reduce(
      (maximum, log) => Math.max(maximum, log.cardioLog?.distance ?? 0),
      0,
    ),
    cardioElevationGain: weekLogs.reduce(
      (sum, log) => sum + (log.cardioLog?.elevationGain ?? 0),
      0,
    ),
    cardioElevationUnit: program.loadSettings.units === "kg" ? "m" : "ft",
  };
}

/** Returns only the first unreviewed week, and only after every workout is final. */
export function nextWeeklyReview(
  program: TrainingProgram,
  logs: WorkoutLog[],
  reviewedWeeks: Iterable<number>,
): number | undefined {
  const reviewed = new Set(reviewedWeeks);
  const latest = new Map(
    latestWorkoutLogs(logs).map((log) => [log.sessionId, log]),
  );
  for (const week of [...program.weeks].sort(
    (left, right) => left.weekNumber - right.weekNumber,
  )) {
    if (reviewed.has(week.weekNumber)) continue;
    const sessions = week.sessions.filter(
      (session) => session.kind !== "movement",
    );
    if (sessions.length === 0) continue;
    const ready = sessions.every((session) => {
      const status = latest.get(session.id)?.status;
      return status !== undefined && TERMINAL_STATUSES.has(status);
    });
    return ready ? week.weekNumber : undefined;
  }
  return undefined;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function wearableMetrics(value: unknown): WeeklyReview["metrics"]["wearable"] {
  const wearable = record(value);
  if (
    typeof wearable.source !== "string" ||
    typeof wearable.caution !== "boolean" ||
    !Array.isArray(wearable.reasons)
  ) {
    return undefined;
  }
  const optionalNumber = (candidate: unknown): number | undefined =>
    typeof candidate === "number" && Number.isFinite(candidate)
      ? candidate
      : undefined;
  const averageSleepMinutes = optionalNumber(wearable.averageSleepMinutes);
  const baselineSleepMinutes = optionalNumber(wearable.baselineSleepMinutes);
  const averageRestingHeartRateBpm = optionalNumber(
    wearable.averageRestingHeartRateBpm,
  );
  const baselineRestingHeartRateBpm = optionalNumber(
    wearable.baselineRestingHeartRateBpm,
  );
  const averageHeartRateVariabilityMs = optionalNumber(
    wearable.averageHeartRateVariabilityMs,
  );
  const baselineHeartRateVariabilityMs = optionalNumber(
    wearable.baselineHeartRateVariabilityMs,
  );
  return {
    source: wearable.source,
    caution: wearable.caution,
    currentDays: Math.max(0, Math.round(numeric(wearable.currentDays))),
    baselineDays: Math.max(0, Math.round(numeric(wearable.baselineDays))),
    reasons: wearable.reasons.filter(
      (reason): reason is string => typeof reason === "string",
    ),
    ...(averageSleepMinutes === undefined ? {} : { averageSleepMinutes }),
    ...(baselineSleepMinutes === undefined ? {} : { baselineSleepMinutes }),
    ...(averageRestingHeartRateBpm === undefined
      ? {}
      : { averageRestingHeartRateBpm }),
    ...(baselineRestingHeartRateBpm === undefined
      ? {}
      : { baselineRestingHeartRateBpm }),
    ...(averageHeartRateVariabilityMs === undefined
      ? {}
      : { averageHeartRateVariabilityMs }),
    ...(baselineHeartRateVariabilityMs === undefined
      ? {}
      : { baselineHeartRateVariabilityMs }),
  };
}

export function parseWeeklyReviewRow(
  row: WeeklyReviewDatabaseRow,
): WeeklyReview {
  const metrics = record(row.metrics);
  const result = record(row.result);
  const state = WEEKLY_STATES.includes(row.state as WeeklyState)
    ? (row.state as WeeklyState)
    : "insufficient_data";
  const confidence = ["low", "moderate", "high"].includes(row.confidence)
    ? (row.confidence as WeeklyReview["confidence"])
    : "low";
  const decision = REVIEW_DECISIONS.includes(
    row.decision as WeeklyReviewDecision,
  )
    ? (row.decision as WeeklyReviewDecision)
    : "no_change";
  const snapshot: WeeklyReviewSnapshot = {
    schemaVersion: 1,
    reviewedAt:
      typeof result.reviewedAt === "string"
        ? result.reviewedAt
        : row.created_at,
    state,
    confidence,
    explanation:
      typeof result.explanation === "string" ? result.explanation : "",
    changes: Array.isArray(result.changes)
      ? (result.changes as WeeklyReviewSnapshot["changes"])
      : [],
    safetySignals: Array.isArray(result.safetySignals)
      ? (result.safetySignals as WeeklyReviewSnapshot["safetySignals"])
      : [],
    warnings: Array.isArray(result.warnings)
      ? (result.warnings as WeeklyReviewSnapshot["warnings"])
      : [],
    reviewedWeeks: Array.isArray(result.reviewedWeeks)
      ? result.reviewedWeeks.filter(
          (value): value is number =>
            typeof value === "number" && Number.isInteger(value),
        )
      : [],
    triggeredRuleIds: Array.isArray(result.triggeredRuleIds)
      ? result.triggeredRuleIds.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
  };
  const parsedWearable = wearableMetrics(metrics.wearable);
  return {
    id: row.id,
    programId: row.program_id,
    weekNumber: row.week_number,
    sourceProgramVersion: row.source_program_version,
    resultProgramVersion: row.result_program_version,
    decision,
    state,
    confidence,
    metrics: {
      weekNumber: numeric(metrics.weekNumber) || row.week_number,
      plannedSessions: numeric(metrics.plannedSessions),
      completedSessions: numeric(metrics.completedSessions),
      partialSessions: numeric(metrics.partialSessions),
      skippedSessions: numeric(metrics.skippedSessions),
      plannedSets: numeric(metrics.plannedSets),
      completedSets: numeric(metrics.completedSets),
      requiredPlannedSets: numeric(metrics.requiredPlannedSets),
      requiredCompletedSets: numeric(metrics.requiredCompletedSets),
      accessoryPlannedSets: numeric(metrics.accessoryPlannedSets),
      accessoryCompletedSets: numeric(metrics.accessoryCompletedSets),
      plannedCardioMinutes: numeric(metrics.plannedCardioMinutes),
      completedCardioMinutes: numeric(metrics.completedCardioMinutes),
      cardioDistance: numeric(metrics.cardioDistance),
      cardioDistanceUnit: metrics.cardioDistanceUnit === "km" ? "km" : "mi",
      cardioSteps: numeric(metrics.cardioSteps),
      cardioMovingMinutes: numeric(metrics.cardioMovingMinutes),
      plannedCardioIntervals: numeric(metrics.plannedCardioIntervals),
      completedCardioIntervals: numeric(metrics.completedCardioIntervals),
      qualityCardioMinutes: numeric(metrics.qualityCardioMinutes),
      longestCardioDistance: numeric(metrics.longestCardioDistance),
      cardioElevationGain: numeric(metrics.cardioElevationGain),
      cardioElevationUnit: metrics.cardioElevationUnit === "m" ? "m" : "ft",
      ...(parsedWearable === undefined ? {} : { wearable: parsedWearable }),
    },
    result: snapshot,
    createdAt: row.created_at,
  };
}

/** A kept load/rep proposal holds only the immediately following week. */
export function heldProgressionTargets(
  reviews: WeeklyReview[],
  weekNumber: number,
): Set<string> {
  const review = reviews.find(
    (item) => item.weekNumber === weekNumber - 1 && item.decision === "kept",
  );
  return new Set(
    review?.result.changes
      .filter((change) => change.type === "load" || change.type === "reps")
      .map((change) => change.target) ?? [],
  );
}
