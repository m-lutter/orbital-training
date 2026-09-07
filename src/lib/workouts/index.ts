import type {
  ExercisePrescription,
  MissReason,
  ProgramWeek,
  QuestionnaireInput,
  SetBlock,
  TrainingProgram,
  TrainingSession,
} from "$lib/domain";
import {
  displayExerciseName,
  isCardioModality,
  loadIncrementForExercise,
  usesAddedBodyweightLoad,
} from "$lib/domain";
import type {
  LoadRecommendation,
  LoggedExercise,
  LoggedSet,
  SessionReference,
  VerbalEffort,
  WorkoutLog,
  WorkoutLogDatabaseRow,
  WorkoutStatus,
} from "./types";
import type {
  PainBaseline,
  PainEvent,
  PainFollowUp,
  PainImpact,
  PainOnset,
} from "$lib/domain";

export * from "./types";
export * from "./timers";
export * from "./form-state";

const DAYS: Record<string, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

function isStatus(value: string): value is WorkoutStatus {
  return ["in_progress", "completed", "partial", "skipped"].includes(value);
}

export const MISS_REASON_OPTIONS: ReadonlyArray<{
  value: MissReason;
  label: string;
}> = [
  { value: "time", label: "I ran out of time" },
  { value: "schedule", label: "A schedule conflict got in the way" },
  { value: "travel", label: "Travel disrupted the workout" },
  { value: "too_hard", label: "The prescribed work was too hard" },
  { value: "soreness", label: "Fatigue or soreness limited me" },
  { value: "pain", label: "Pain changed or stopped the exercise" },
  { value: "equipment", label: "The equipment was not available" },
  { value: "preference", label: "I need a different exercise" },
  { value: "unknown", label: "Another reason / not sure" },
];

export function isMissReason(value: unknown): value is MissReason {
  return MISS_REASON_OPTIONS.some((option) => option.value === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function parsePainEvent(value: unknown): PainEvent | undefined {
  if (!isRecord(value)) return undefined;
  const impacts: PainImpact[] = [
    "noticed",
    "modified",
    "stopped_exercise",
    "stopped_workout",
  ];
  if (!impacts.includes(value.impact as PainImpact)) return undefined;
  const onsets: PainOnset[] = ["gradual", "sudden", "accident", "unsure"];
  const baselines: PainBaseline[] = [
    "new",
    "familiar",
    "familiar_worse",
    "unsure",
  ];
  const followUps: PainFollowUp[] = [
    "not_checked",
    "normal",
    "better",
    "same",
    "worse",
    "affects_daily_life",
  ];
  const severity = finiteNumber(value.severity);
  return {
    impact: value.impact as PainImpact,
    ...(severity === undefined || severity < 0 || severity > 10
      ? {}
      : { severity }),
    ...(onsets.includes(value.onset as PainOnset)
      ? { onset: value.onset as PainOnset }
      : {}),
    ...(baselines.includes(value.baseline as PainBaseline)
      ? { baseline: value.baseline as PainBaseline }
      : {}),
    ...(typeof value.bodyArea === "string" && value.bodyArea.trim() !== ""
      ? { bodyArea: value.bodyArea.trim().slice(0, 120) }
      : {}),
    ...(followUps.includes(value.followUp as PainFollowUp)
      ? { followUp: value.followUp as PainFollowUp }
      : {}),
    ...(value.urgentWarningSigns === true ? { urgentWarningSigns: true } : {}),
  };
}

function parseSet(value: unknown): LoggedSet | undefined {
  if (!isRecord(value) || !Number.isInteger(value.setNumber)) return undefined;
  const difficulty = ["easy", "medium", "difficult", "impossible"].includes(
    String(value.difficulty),
  )
    ? (value.difficulty as VerbalEffort)
    : undefined;
  return {
    setNumber: Number(value.setNumber),
    ...(finiteNumber(value.reps) === undefined
      ? {}
      : { reps: finiteNumber(value.reps) }),
    ...(finiteNumber(value.load) === undefined
      ? {}
      : { load: finiteNumber(value.load) }),
    ...(finiteNumber(value.rir) === undefined
      ? {}
      : { rir: finiteNumber(value.rir) }),
    ...(finiteNumber(value.rpe) === undefined
      ? {}
      : { rpe: finiteNumber(value.rpe) }),
    ...(difficulty === undefined ? {} : { difficulty }),
    completed: value.completed === true,
    ...(typeof value.techniqueOkay === "boolean"
      ? { techniqueOkay: value.techniqueOkay }
      : {}),
    ...(typeof value.pain === "boolean" ? { pain: value.pain } : {}),
  };
}

function parsePrescriptionContext(
  value: unknown,
): LoggedExercise["prescriptionContext"] {
  if (!isRecord(value) || !isRecord(value.reps) || !isRecord(value.targetRir))
    return undefined;
  const purposes = [
    "competition_skill",
    "strength",
    "hypertrophy",
    "low_fatigue_volume",
    "general_function",
    "trunk",
  ];
  const phases = [
    "reentry",
    "base",
    "hypertrophy",
    "work_capacity",
    "strength",
    "specificity",
    "peak",
    "taper",
    "aerobic_base",
    "cardio_build",
    "review",
  ];
  const minReps = finiteNumber(value.reps.min);
  const maxReps = finiteNumber(value.reps.max);
  const minRir = finiteNumber(value.targetRir.min);
  const maxRir = finiteNumber(value.targetRir.max);
  if (
    !purposes.includes(String(value.purpose)) ||
    (value.phase !== undefined && !phases.includes(String(value.phase))) ||
    minReps === undefined ||
    maxReps === undefined ||
    minReps < 1 ||
    maxReps < minReps ||
    maxReps > 1000 ||
    minRir === undefined ||
    maxRir === undefined ||
    minRir < 0 ||
    maxRir < minRir ||
    maxRir > 10
  )
    return undefined;
  type Context = NonNullable<LoggedExercise["prescriptionContext"]>;
  return {
    purpose: value.purpose as Context["purpose"],
    ...(value.phase === undefined
      ? {}
      : { phase: value.phase as Context["phase"] }),
    ...(typeof value.contextRole === "string"
      ? { contextRole: value.contextRole.slice(0, 200) }
      : {}),
    reps: { min: minReps, max: maxReps },
    targetRir: { min: minRir, max: maxRir },
    ...(finiteNumber(value.load) === undefined || Number(value.load) < 0
      ? {}
      : { load: Number(value.load) }),
    ...(finiteNumber(value.percentE1rm) === undefined ||
    Number(value.percentE1rm) < 0
      ? {}
      : { percentE1rm: Number(value.percentE1rm) }),
  };
}

function parseExercise(value: unknown): LoggedExercise | undefined {
  if (
    !isRecord(value) ||
    typeof value.prescriptionId !== "string" ||
    typeof value.prescribedExerciseId !== "string" ||
    typeof value.exerciseId !== "string" ||
    typeof value.exerciseName !== "string" ||
    typeof value.performanceSeriesId !== "string" ||
    !Array.isArray(value.sets)
  )
    return undefined;
  const painEvent = parsePainEvent(value.painEvent);
  const prescriptionContext = parsePrescriptionContext(
    value.prescriptionContext,
  );
  return {
    prescriptionId: value.prescriptionId,
    prescribedExerciseId: value.prescribedExerciseId,
    exerciseId: value.exerciseId,
    exerciseName: displayExerciseName(value.exerciseId, value.exerciseName),
    performanceSeriesId: value.performanceSeriesId,
    ...(prescriptionContext === undefined ? {} : { prescriptionContext }),
    ...(typeof value.setBlockId === "string"
      ? { setBlockId: value.setBlockId }
      : {}),
    ...(value.setBlockMode === "paired" || value.setBlockMode === "unpaired"
      ? { setBlockMode: value.setBlockMode }
      : {}),
    sets: value.sets
      .map(parseSet)
      .filter((set): set is LoggedSet => set !== undefined),
    ...(isMissReason(value.missReason) ? { missReason: value.missReason } : {}),
    ...(painEvent === undefined ? {} : { painEvent }),
  };
}

export function parseWorkoutLogRow(row: WorkoutLogDatabaseRow): WorkoutLog {
  const exerciseLogs = Array.isArray(row.exercise_logs)
    ? row.exercise_logs
        .map(parseExercise)
        .filter(
          (exercise): exercise is LoggedExercise => exercise !== undefined,
        )
    : [];
  const cardio = isRecord(row.cardio_log) ? row.cardio_log : {};
  const movement = isRecord(row.movement_log) ? row.movement_log : {};
  const movementTargetType =
    movement.targetType === "steps" || movement.targetType === "walking_minutes"
      ? movement.targetType
      : undefined;
  const movementTarget = finiteNumber(movement.target);
  return {
    id: row.id,
    programId: row.program_id,
    programVersion: row.program_version,
    sessionId: row.session_id,
    weekNumber: row.week_number,
    sessionSequence: row.session_sequence,
    status: isStatus(row.status) ? row.status : "in_progress",
    exerciseLogs,
    cardioLog: {
      ...(isCardioModality(cardio.modality)
        ? { modality: cardio.modality }
        : {}),
      ...(isCardioModality(cardio.prescribedModality)
        ? { prescribedModality: cardio.prescribedModality }
        : {}),
      ...(finiteNumber(cardio.completedMinutes) === undefined
        ? {}
        : { completedMinutes: finiteNumber(cardio.completedMinutes) }),
      ...(finiteNumber(cardio.sessionRpe) === undefined
        ? {}
        : { sessionRpe: finiteNumber(cardio.sessionRpe) }),
      ...(finiteNumber(cardio.distance) === undefined
        ? {}
        : { distance: finiteNumber(cardio.distance) }),
      ...(cardio.distanceUnit === "mi" || cardio.distanceUnit === "km"
        ? { distanceUnit: cardio.distanceUnit }
        : {}),
      ...(finiteNumber(cardio.steps) === undefined
        ? {}
        : { steps: finiteNumber(cardio.steps) }),
      ...(finiteNumber(cardio.movingMinutes) === undefined
        ? {}
        : { movingMinutes: finiteNumber(cardio.movingMinutes) }),
      ...(finiteNumber(cardio.completedIntervals) === undefined
        ? {}
        : { completedIntervals: finiteNumber(cardio.completedIntervals) }),
      ...(finiteNumber(cardio.averageHeartRate) === undefined
        ? {}
        : { averageHeartRate: finiteNumber(cardio.averageHeartRate) }),
      ...(finiteNumber(cardio.maxHeartRate) === undefined
        ? {}
        : { maxHeartRate: finiteNumber(cardio.maxHeartRate) }),
      ...(finiteNumber(cardio.elevationGain) === undefined
        ? {}
        : { elevationGain: finiteNumber(cardio.elevationGain) }),
      ...(cardio.elevationUnit === "ft" || cardio.elevationUnit === "m"
        ? { elevationUnit: cardio.elevationUnit }
        : {}),
      ...(["road", "track", "trail", "treadmill", "mixed", "other"].includes(
        String(cardio.surface),
      )
        ? {
            surface: cardio.surface as
              "road" | "track" | "trail" | "treadmill" | "mixed" | "other",
          }
        : {}),
      ...(["manual", "watch", "treadmill", "bike", "other"].includes(
        String(cardio.source),
      )
        ? {
            source: cardio.source as
              "manual" | "watch" | "treadmill" | "bike" | "other",
          }
        : {}),
    },
    ...(movementTargetType === undefined || movementTarget === undefined
      ? {}
      : {
          movementLog: {
            targetType: movementTargetType,
            target: movementTarget,
            ...(typeof movement.met === "boolean" ? { met: movement.met } : {}),
            ...(finiteNumber(movement.actualSteps) === undefined
              ? {}
              : { actualSteps: finiteNumber(movement.actualSteps) }),
            ...(finiteNumber(movement.actualWalkingMinutes) === undefined
              ? {}
              : {
                  actualWalkingMinutes: finiteNumber(
                    movement.actualWalkingMinutes,
                  ),
                }),
            ...(typeof movement.checkInDate === "string"
              ? { checkInDate: movement.checkInDate.slice(0, 10) }
              : {}),
          },
        }),
    ...(row.duration_minutes === null
      ? {}
      : { durationMinutes: row.duration_minutes }),
    ...(isMissReason(row.miss_reason) ? { missReason: row.miss_reason } : {}),
    startedAt: row.started_at,
    ...(row.completed_at === null ? {} : { completedAt: row.completed_at }),
    updatedAt: row.updated_at,
  };
}

/**
 * A program version may change after a weekly review. Session ids stay stable,
 * so choose the newest saved observation for each session while retaining all
 * earlier sessions as immutable history.
 */
export function latestWorkoutLogs(logs: WorkoutLog[]): WorkoutLog[] {
  const latest = new Map<string, WorkoutLog>();
  for (const log of logs) {
    const current = latest.get(log.sessionId);
    const newerVersion =
      current === undefined || log.programVersion > current.programVersion;
    const newerSave =
      current !== undefined &&
      log.programVersion === current.programVersion &&
      (log.updatedAt ?? "") > (current.updatedAt ?? "");
    if (newerVersion || newerSave) latest.set(log.sessionId, log);
  }
  return [...latest.values()].sort(
    (left, right) =>
      left.weekNumber - right.weekNumber ||
      left.sessionSequence - right.sessionSequence,
  );
}

export function sessionLabel(
  session: TrainingSession,
  planningStyle: QuestionnaireInput["schedule"]["planningStyle"],
): string {
  const prefix =
    planningStyle === "calendar_days" && session.day !== undefined
      ? DAYS[session.day]
      : `Day ${session.sequence}`;
  return `${prefix}: ${session.title}`;
}

function straightSessionSetBlocks(session: TrainingSession): SetBlock[] {
  return session.exercises.map((exercise) => ({
    id: `${session.id}-legacy-block-${exercise.id}`,
    type: "straight",
    sequence: [{ prescriptionId: exercise.id, orderLabel: "" }],
    rounds: exercise.sets,
    transitionSeconds: 0,
    interRoundRestSeconds: exercise.restSeconds,
    sameExerciseRecoveryMinimumSeconds: exercise.restSeconds,
    fallback: "unpair",
    methodPolicyVersion: "legacy-straight",
    rationaleCode: "straight_default",
    evidenceTag: "supported",
    estimatedTimeSavedMinutes: 0,
    instruction: `Complete all ${exercise.sets} sets, resting as prescribed between sets.`,
  }));
}

function setBlocksMatchLoggedSets(session: TrainingSession): boolean {
  if (session.setBlocks === undefined) return false;
  const prescriptions = new Map(
    session.exercises.map((exercise) => [exercise.id, exercise]),
  );
  const seen = new Set<string>();

  for (const block of session.setBlocks) {
    const expectedSequenceLength = block.type === "paired_superset" ? 2 : 1;
    if (block.sequence.length !== expectedSequenceLength) return false;
    for (const item of block.sequence) {
      const prescription = prescriptions.get(item.prescriptionId);
      if (
        prescription === undefined ||
        seen.has(item.prescriptionId) ||
        block.rounds !== prescription.sets
      )
        return false;
      seen.add(item.prescriptionId);
    }
  }

  return seen.size === session.exercises.length;
}

/**
 * Old programs had only a flat exercise list. A stale paired block can also
 * claim fewer rounds than its prescriptions contain, which would hide required
 * set inputs and make a completed-looking workout impossible to finish. In
 * either case, render and parse every prescribed set as safe straight work.
 */
export function sessionSetBlocks(session: TrainingSession): SetBlock[] {
  const blocks = session.setBlocks;
  if (blocks !== undefined && setBlocksMatchLoggedSets(session)) return blocks;
  return straightSessionSetBlocks(session);
}

export function prescribedRepTarget(
  prescription: Pick<ExercisePrescription, "reps">,
): number {
  return prescription.reps.min === prescription.reps.max
    ? prescription.reps.min
    : Math.round((prescription.reps.min + prescription.reps.max) / 2);
}

export function estimatedOneRepMax(
  load: number,
  reps: number,
  rir: number,
): number {
  return load * (1 + (reps + rir) / 30);
}

export function suspiciousRirEstimate(
  load: number,
  reps: number,
  rir: number,
  referenceEstimatedMax: number | undefined,
): { enteredEstimate: number; referenceEstimate: number } | undefined {
  if (
    referenceEstimatedMax === undefined ||
    referenceEstimatedMax <= 0 ||
    load <= 0 ||
    reps <= 0 ||
    rir < 0 ||
    rir > 12
  )
    return undefined;
  const enteredEstimate = estimatedOneRepMax(load, reps, rir);
  return enteredEstimate > referenceEstimatedMax * 1.2
    ? { enteredEstimate, referenceEstimate: referenceEstimatedMax }
    : undefined;
}

export function workoutSessions(
  program: TrainingProgram,
  input: QuestionnaireInput,
  logs: WorkoutLog[] = [],
): SessionReference[] {
  const bySession = new Map(
    latestWorkoutLogs(logs).map((log) => [log.sessionId, log.status]),
  );
  return program.weeks.flatMap((week) =>
    week.sessions
      .filter((session) => session.kind !== "movement")
      .map((session) => ({
        session,
        label: sessionLabel(session, input.schedule.planningStyle),
        status: bySession.get(session.id),
      })),
  );
}

export function nextWorkoutSession(
  program: TrainingProgram,
  input: QuestionnaireInput,
  logs: WorkoutLog[],
): SessionReference | undefined {
  const sessions = workoutSessions(program, input, logs);
  return (
    sessions.find((item) => item.status === "in_progress") ??
    sessions.find(
      (item) =>
        item.status !== "completed" &&
        item.status !== "partial" &&
        item.status !== "skipped",
    )
  );
}

function roundToIncrement(value: number, increment: number): number {
  const rounded = Math.round(value / increment) * increment;
  return Number(rounded.toFixed(3));
}

function estimatedRir(set: LoggedSet): number | undefined {
  if (set.rir !== undefined) return set.rir;
  if (set.rpe !== undefined) return 10 - set.rpe;
  const verbal: Record<VerbalEffort, number> = {
    easy: 4,
    medium: 2.5,
    difficult: 1,
    impossible: 0,
  };
  return set.difficulty === undefined ? undefined : verbal[set.difficulty];
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function loadRecommendation(
  prescription: ExercisePrescription,
  program: TrainingProgram,
  logs: WorkoutLog[],
  currentWeek: number,
  options: { holdProgression?: boolean } = {},
): LoadRecommendation {
  const units = program.loadSettings.units;
  const addedToBodyweight = usesAddedBodyweightLoad(prescription.exerciseId);
  const describeLoad = (load: number): string =>
    addedToBodyweight
      ? `${load} ${units} added to bodyweight`
      : `${load} ${units}`;
  if (prescription.load !== undefined) {
    return {
      kind: "prescribed",
      load: prescription.load,
      text: describeLoad(prescription.load),
    };
  }
  const storedPrescriptions = new Map(
    program.weeks
      .flatMap((week) => week.sessions)
      .flatMap((session) => session.exercises)
      .map((item) => [item.id, item]),
  );
  const priors = latestWorkoutLogs(logs)
    .filter(
      (log) =>
        log.weekNumber < currentWeek &&
        (log.status === "completed" || log.status === "partial"),
    )
    .flatMap((log) =>
      log.exerciseLogs.map((exercise) => ({
        exercise,
        week: log.weekNumber,
        version: log.programVersion,
      })),
    )
    .filter((item) => {
      if (
        item.exercise.performanceSeriesId !==
          prescription.performanceSeriesId ||
        item.exercise.exerciseId !== prescription.exerciseId
      )
        return false;
      const stored = storedPrescriptions.get(item.exercise.prescriptionId);
      const context =
        item.exercise.prescriptionContext ??
        (item.version === program.version ? stored : undefined);
      if (context === undefined) return false;
      return (
        context.purpose === prescription.purpose &&
        context.phase === prescription.phase &&
        context.contextRole === prescription.contextRole &&
        context.targetRir.min === prescription.targetRir.min &&
        context.targetRir.max === prescription.targetRir.max
      );
    })
    .sort((left, right) => right.week - left.week);
  const prior = priors[0];

  if (prior === undefined) {
    return {
      kind: "calibrate",
      text: addedToBodyweight
        ? "Start with bodyweight. Add resistance only if needed to reach the target effort."
        : "Find your starting weight today—open the step-by-step guide below.",
    };
  }

  const attemptedSets = prior.exercise.sets.filter(
    (set) =>
      set.completed &&
      set.load !== undefined &&
      Number.isFinite(set.load) &&
      set.load >= 0 &&
      set.reps !== undefined,
  );
  if (attemptedSets.length === 0) {
    return {
      kind: "calibrate",
      text: addedToBodyweight
        ? "Start with bodyweight. Add resistance only if needed to reach the target effort."
        : "Find your starting weight today—open the step-by-step guide below.",
      basedOnWeek: prior.week,
    };
  }

  const lastLoad = median(attemptedSets.map((set) => set.load as number));
  const priorPrescription = storedPrescriptions.get(
    prior.exercise.prescriptionId,
  );
  const priorContext = prior.exercise.prescriptionContext ?? priorPrescription;
  if (
    priorContext !== undefined &&
    (priorContext.reps.min !== prescription.reps.min ||
      priorContext.reps.max !== prescription.reps.max)
  )
    return {
      kind: "repeat",
      load: lastLoad,
      text: `${describeLoad(lastLoad)} — carry this weight into the new exact rep target; the prior target is not treated as missed work.`,
      basedOnWeek: prior.week,
    };
  const progressionFloor =
    prescription.progression.repFloor ?? prescription.reps.min;
  const progressionCeiling =
    prescription.progression.repCeiling ?? prescription.reps.max;
  // Weekly adaptation owns the paired rep/load change. A display-only load hint
  // must not silently add weight while still showing the old rep ceiling.
  const boundedDoubleProgression =
    prescription.progression.method === "double_progression" &&
    progressionFloor < progressionCeiling;
  const effortValues = attemptedSets
    .map(estimatedRir)
    .filter((value): value is number => value !== undefined);
  const averageRir =
    effortValues.length === 0
      ? undefined
      : effortValues.reduce((sum, value) => sum + value, 0) /
        effortValues.length;
  const requiredSetsCompleted = attemptedSets.length >= prescription.sets;
  const missedTarget =
    attemptedSets.length < (priorPrescription?.sets ?? prescription.sets) ||
    attemptedSets.some((set) => (set.reps ?? 0) < prescription.reps.min) ||
    (averageRir !== undefined && averageRir < prescription.targetRir.min - 0.5);
  const reachedTop =
    !boundedDoubleProgression &&
    prescription.reps.min >= progressionCeiling &&
    requiredSetsCompleted &&
    attemptedSets
      .slice(0, prescription.sets)
      .every((set) => (set.reps ?? 0) >= prescribedRepTarget(prescription)) &&
    averageRir !== undefined &&
    averageRir >= prescription.targetRir.min &&
    priors
      .slice(0, prescription.progression.requiredSuccessfulExposures ?? 2)
      .filter((item) => {
        const stored = storedPrescriptions.get(item.exercise.prescriptionId);
        const context = item.exercise.prescriptionContext ?? stored;
        if (
          context === undefined ||
          context.reps.min !== prescription.reps.min ||
          context.reps.max !== prescription.reps.max
        )
          return false;
        const sets = item.exercise.sets.filter(
          (set) =>
            set.completed && set.load !== undefined && set.reps !== undefined,
        );
        const efforts = sets
          .map(estimatedRir)
          .filter((value): value is number => value !== undefined);
        const exposureEffort =
          efforts.length === 0
            ? undefined
            : efforts.reduce((sum, value) => sum + value, 0) / efforts.length;
        return (
          sets.length >= prescription.sets &&
          sets
            .slice(0, prescription.sets)
            .every(
              (set) =>
                (set.reps ?? 0) >= progressionCeiling &&
                set.load === lastLoad &&
                set.techniqueOkay !== false,
            ) &&
          exposureEffort !== undefined &&
          exposureEffort >= prescription.targetRir.min
        );
      }).length >=
      Math.max(2, prescription.progression.requiredSuccessfulExposures ?? 2);
  const increment = loadIncrementForExercise(
    program,
    prior.exercise.exerciseId,
  );

  if (missedTarget) {
    const reduced = Math.min(
      lastLoad - increment,
      roundToIncrement(lastLoad * 0.95, increment),
    );
    const load = Math.max(addedToBodyweight ? 0 : increment, reduced);
    return {
      kind: "reduce",
      load,
      text: `${describeLoad(load)} — reduced after the last attempt exceeded the target effort or missed prescribed work.`,
      basedOnWeek: prior.week,
    };
  }
  if (reachedTop) {
    if (options.holdProgression) {
      return {
        kind: "repeat",
        load: lastLoad,
        text: `${describeLoad(lastLoad)} — repeat this weight because you kept the current plan at the latest weekly review.`,
        basedOnWeek: prior.week,
      };
    }
    const load = roundToIncrement(lastLoad + increment, increment);
    return {
      kind: "increase",
      load,
      text: `${describeLoad(load)} — increase by the smallest available increment.`,
      basedOnWeek: prior.week,
    };
  }
  return {
    kind: "repeat",
    load: lastLoad,
    text: `${describeLoad(lastLoad)} — repeat this weight for the prescribed reps.${boundedDoubleProgression ? " The weekly review updates reps within their bounds, then weight and reps together." : ""}`,
    basedOnWeek: prior.week,
  };
}

export function weeklyProgressionSummary(
  week: ProgramWeek,
  previousWeek: ProgramWeek | undefined,
): string {
  const phase: Record<string, string> = {
    reentry: "Rebuild consistency and finish each session with room to spare.",
    base: "Build repeatable work at controlled effort.",
    hypertrophy: "Accumulate quality sets at the prescribed reps and effort.",
    work_capacity:
      "Add sustainable work without turning every set into a test.",
    strength:
      "Use heavier main-lift work while keeping accessory effort controlled.",
    specificity:
      "Practice the competition lifts with heavier, more specific work.",
    peak: "Reduce extra work and prioritize high-quality heavy attempts.",
    taper:
      "Let fatigue fall while keeping a small amount of precise lift practice.",
    aerobic_base: "Build comfortable aerobic work at a conversational pace.",
    cardio_build: "Progress cardio gradually while protecting lifting quality.",
    review: "Use this week to assess performance and prepare the next block.",
  };
  const calibration =
    previousWeek === undefined &&
    week.sessions.some((session) =>
      session.exercises.some((exercise) => exercise.load === undefined),
    );
  const setChange =
    previousWeek === undefined
      ? ""
      : week.hardSetBudget > previousWeek.hardSetBudget
        ? " Planned lifting volume increases slightly from last week."
        : week.hardSetBudget < previousWeek.hardSetBudget
          ? " Planned lifting volume is lower than last week to manage fatigue."
          : " Planned lifting volume stays steady from last week.";
  const accessory = calibration
    ? " Exercises without a prescribed weight include a step-by-step calibration. Log the work-set load and effort so the next exposure can give one weight recommendation."
    : "";
  return `${phase[week.phase] ?? "Complete the planned work at the prescribed effort."}${setChange}${accessory}`;
}
