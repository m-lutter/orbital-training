import { getExercise } from "./exercises.js";
import {
  canonicalizeLoadSettings,
  loadIncrementForExercise,
} from "./load-policy.js";
import { ENGINE_VERSION, POLICY, POLICY_VERSION } from "./policy.js";
import {
  recalculateSessionDuration,
  synchronizeCardioDuration,
} from "./duration.js";
import { refreshWeekDoseLedger } from "./dose.js";
import { sanitizeSessionSetBlocks } from "./set-blocks.js";
import type {
  AdaptationChange,
  AdaptationResult,
  AdaptationSafetySignal,
  EngineWarning,
  ExerciseLog,
  ExercisePrescription,
  CardioPrescription,
  MissReason,
  PainEvent,
  SessionLog,
  TrainingProgram,
  WeekLog,
  WeeklyState,
  WearableAdaptationContext,
  Phase,
} from "./types.js";
import { fingerprint, roundToIncrement, unique } from "./utils.js";

interface Exposure {
  contextKey: string;
  progressionEligible: boolean;
  successful: boolean;
  requiredSuccessfulExposures: number;
  progressionMethod: ExercisePrescription["progression"]["method"];
  exerciseId: string;
  prescriptionId: string;
  weekNumber: number;
  sessionId: string;
  programVersion?: number;
  rirError?: number;
  failure: boolean;
  completedSets: number;
  plannedSets: number;
  latestLoad?: number;
  missReason?: MissReason;
}

interface CardioExposure {
  contextKey: string;
  progressionEligible: boolean;
  weekNumber: number;
  sessionId: string;
  programVersion?: number;
  intensity: CardioPrescription["intensity"];
  role?: CardioPrescription["role"];
  plannedMinutes: number;
  completedMinutes: number;
  plannedIntervals?: number;
  completedIntervals?: number;
  distance?: number;
  movingMinutes?: number;
  rpeError?: number;
  missReason?: MissReason;
}

interface ReviewMetrics {
  plannedSets: number;
  completedSets: number;
  requiredPlannedSets: number;
  requiredCompletedSets: number;
  completionRate?: number;
  reasonCounts: Partial<Record<MissReason, number>>;
  exposures: Exposure[];
  cardioExposures: CardioExposure[];
  painObservations: PainObservation[];
  loggingCompleteness: number;
  plannedCardioMinutes: number;
  completedCardioMinutes: number;
  cardioCompletionRate?: number;
  movementObservations: boolean[];
}

interface PainObservation {
  evidenceKey: string;
  reviewed: boolean;
  exerciseId: string;
  weekNumber: number;
  sessionId: string;
  event: PainEvent;
}

// Exact dose and role are part of a series: a light squat is not a heavy squat.
function exerciseContextKey(
  prescription: Pick<
    ExercisePrescription,
    | "exerciseId"
    | "performanceSeriesId"
    | "purpose"
    | "phase"
    | "contextRole"
    | "reps"
    | "targetRir"
  >,
  phase?: Phase,
): string {
  return JSON.stringify([
    prescription.performanceSeriesId,
    prescription.exerciseId,
    prescription.purpose,
    prescription.phase ?? phase ?? "legacy",
    prescription.contextRole ?? "legacy",
    prescription.reps.min,
    prescription.reps.max,
    prescription.targetRir.min,
    prescription.targetRir.max,
  ]);
}

function cardioContextKey(cardio: CardioPrescription, phase?: Phase): string {
  return JSON.stringify([
    "cardio",
    cardio.modality,
    cardio.role ?? "legacy",
    cardio.eventPhase ?? phase ?? "legacy",
    cardio.intensity,
  ]);
}

function cardioKeyForSession(
  program: TrainingProgram,
  sessionId?: string,
): string | undefined {
  for (const week of program.weeks) {
    const session = week.sessions.find((item) => item.id === sessionId);
    if (session?.cardio !== undefined)
      return cardioContextKey(session.cardio, week.phase);
  }
  return undefined;
}

function plannedPrescriptionMap(
  program: TrainingProgram,
): Map<string, ExercisePrescription> {
  const map = new Map<string, ExercisePrescription>();
  for (const week of program.weeks) {
    for (const session of week.sessions) {
      for (const prescription of session.exercises)
        map.set(prescription.id, prescription);
    }
  }
  return map;
}

function plannedSessionMap(program: TrainingProgram): Map<
  string,
  {
    exercises: ExercisePrescription[];
    cardio?: CardioPrescription;
    targetMinutes: number;
    phase: Phase;
    weekNumber: number;
  }
> {
  const map = new Map<
    string,
    {
      exercises: ExercisePrescription[];
      cardio?: CardioPrescription;
      targetMinutes: number;
      phase: Phase;
      weekNumber: number;
    }
  >();
  for (const week of program.weeks) {
    for (const session of week.sessions)
      map.set(session.id, {
        exercises: session.exercises,
        ...(session.cardio === undefined ? {} : { cardio: session.cardio }),
        targetMinutes: session.targetMinutes,
        phase: week.phase,
        weekNumber: week.weekNumber,
      });
  }
  return map;
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : sorted[middle];
}

function effortValue(set: ExerciseLog["sets"][number]): number | undefined {
  if (set.rir !== undefined) return set.rir;
  if (set.rpe !== undefined) return 10 - set.rpe;
  return undefined;
}

function collectMetrics(
  program: TrainingProgram,
  logs: WeekLog[],
): ReviewMetrics {
  // One occurrence counts once, even when a review includes multiple versions.
  const latestSessions = new Map<string, SessionLog>();
  for (const week of logs)
    for (const session of week.sessions) {
      const prior = latestSessions.get(session.sessionId);
      if (
        prior === undefined ||
        (session.programVersion ?? 0) >= (prior.programVersion ?? 0)
      )
        latestSessions.set(session.sessionId, session);
    }
  const relevantLogs = logs.map((week) => ({
    ...week,
    sessions: week.sessions.filter(
      (session) => latestSessions.get(session.sessionId) === session,
    ),
  }));
  const prescriptionMap = plannedPrescriptionMap(program);
  const sessionMap = plannedSessionMap(program);
  const reasonCounts: Partial<Record<MissReason, number>> = {};
  const exposures: Exposure[] = [];
  const cardioExposures: CardioExposure[] = [];
  const painObservations: PainObservation[] = [];
  let plannedSets = 0;
  let completedSets = 0;
  let requiredPlannedSets = 0;
  let requiredCompletedSets = 0;
  let loggedFormalSessions = 0;
  let expectedLoggedSessions = 0;
  let plannedCardioMinutes = 0;
  let completedCardioMinutes = 0;
  const movementObservations: boolean[] = [];
  const countedSessions = new Set<string>();
  const countedWeeks = new Set<number>();

  const countReason = (reason: MissReason | undefined): void => {
    if (reason === undefined) return;
    reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
  };

  for (const weekLog of relevantLogs) {
    const plannedWeek = program.weeks.find(
      (week) => week.weekNumber === weekLog.weekNumber,
    );
    if (!countedWeeks.has(weekLog.weekNumber)) {
      expectedLoggedSessions +=
        plannedWeek?.sessions.filter((session) => session.kind !== "movement")
          .length ?? 0;
      countedWeeks.add(weekLog.weekNumber);
    }
    for (const sessionLog of weekLog.sessions) {
      const plannedSession = sessionMap.get(sessionLog.sessionId);
      if (
        plannedSession === undefined ||
        plannedSession.weekNumber !== weekLog.weekNumber ||
        countedSessions.has(sessionLog.sessionId) ||
        (sessionLog.programVersion ?? 0) > program.version
      )
        continue;
      countedSessions.add(sessionLog.sessionId);
      const loggedExercises = [
        ...new Map(
          sessionLog.exercises.map((item) => [item.prescriptionId, item]),
        ).values(),
      ];
      const currentVersion =
        sessionLog.programVersion === undefined ||
        sessionLog.programVersion === program.version;
      if (
        sessionLog.movementTargetMet !== undefined &&
        weekLog.weekNumber >
          (program.adaptationEvidenceConsumedThrough?.movement ?? 0)
      )
        movementObservations.push(sessionLog.movementTargetMet);
      loggedFormalSessions += 1;
      const sessionReasons = unique(
        [
          sessionLog.missReason,
          ...loggedExercises.map((exercise) => exercise.missReason),
        ].filter((reason): reason is MissReason => reason !== undefined),
      );
      // Legacy old-version feedback lacks a prescription snapshot; never replay it.
      if (currentVersion)
        for (const reason of sessionReasons) countReason(reason);
      const loggedPrescriptionIds = new Set(
        loggedExercises.map((exercise) => exercise.prescriptionId),
      );
      const missingPrescriptions = plannedSession.exercises.filter(
        (item) => !loggedPrescriptionIds.has(item.id),
      );
      plannedSets += missingPrescriptions.reduce(
        (sum, item) => sum + item.sets,
        0,
      );
      requiredPlannedSets += missingPrescriptions
        .filter((item) => !item.optional)
        .reduce((sum, item) => sum + item.sets, 0);
      if (plannedSession.cardio !== undefined) {
        const plannedCardio = plannedSession.cardio;
        const completedMinutes =
          sessionLog.cardioCompletedMinutes ??
          (plannedCardio.intervals !== undefined &&
          sessionLog.cardioCompletedIntervals !== undefined
            ? plannedCardio.minutes *
              Math.min(
                1,
                sessionLog.cardioCompletedIntervals /
                  plannedCardio.intervals.repeats,
              )
            : 0);
        const targetRpe =
          (plannedCardio.sessionRpe.min + plannedCardio.sessionRpe.max) / 2;
        plannedCardioMinutes += plannedCardio.minutes;
        completedCardioMinutes += completedMinutes;
        cardioExposures.push({
          contextKey: cardioContextKey(plannedCardio, plannedSession.phase),
          progressionEligible:
            (currentVersion ||
              sessionLog.cardioPrescribedModality !== undefined) &&
            (sessionLog.cardioModality ?? plannedCardio.modality) ===
              plannedCardio.modality &&
            (sessionLog.cardioPrescribedModality ?? plannedCardio.modality) ===
              plannedCardio.modality,
          weekNumber: weekLog.weekNumber,
          sessionId: sessionLog.sessionId,
          ...(sessionLog.programVersion === undefined
            ? {}
            : { programVersion: sessionLog.programVersion }),
          intensity: plannedCardio.intensity,
          ...(plannedCardio.role === undefined
            ? {}
            : { role: plannedCardio.role }),
          plannedMinutes: plannedCardio.minutes,
          completedMinutes,
          ...(plannedCardio.intervals === undefined
            ? {}
            : { plannedIntervals: plannedCardio.intervals.repeats }),
          ...(sessionLog.cardioCompletedIntervals === undefined
            ? {}
            : { completedIntervals: sessionLog.cardioCompletedIntervals }),
          ...(sessionLog.cardioDistance === undefined
            ? {}
            : { distance: sessionLog.cardioDistance }),
          ...(sessionLog.cardioMovingMinutes === undefined
            ? {}
            : { movingMinutes: sessionLog.cardioMovingMinutes }),
          ...(sessionLog.cardioSessionRpe === undefined
            ? {}
            : { rpeError: sessionLog.cardioSessionRpe - targetRpe }),
          ...(sessionLog.missReason === undefined
            ? {}
            : { missReason: sessionLog.missReason }),
        });
      }
      for (const exerciseLog of loggedExercises) {
        const prescription = prescriptionMap.get(exerciseLog.prescriptionId);
        if (
          prescription === undefined ||
          !plannedSession.exercises.some((item) => item.id === prescription.id)
        )
          continue;
        const recorded = exerciseLog.prescriptionContext;
        const context =
          recorded === undefined
            ? prescription
            : { ...prescription, ...recorded };
        const lineageMatches =
          exerciseLog.exerciseId === prescription.exerciseId &&
          (exerciseLog.performanceSeriesId ??
            prescription.performanceSeriesId) ===
            prescription.performanceSeriesId;
        const progressionEligible =
          lineageMatches && (currentVersion || recorded !== undefined);
        const contextKey = exerciseContextKey(context, plannedSession.phase);
        plannedSets += prescription.sets;
        if (!prescription.optional) requiredPlannedSets += prescription.sets;
        const completed = exerciseLog.sets
          .filter((set) => set.completed)
          .slice(0, prescription.sets);
        completedSets += completed.length;
        if (!prescription.optional) requiredCompletedSets += completed.length;
        const errors = completed
          .map((set) => effortValue(set))
          .filter((value): value is number => value !== undefined)
          .map(
            (value) =>
              value - (context.targetRir.min + context.targetRir.max) / 2,
          );
        const legacyPain =
          exerciseLog.sets.some((set) => set.pain === true) ||
          exerciseLog.missReason === "pain";
        const painEvent =
          exerciseLog.painEvent ??
          (legacyPain
            ? ({ impact: "modified", followUp: "not_checked" } as const)
            : undefined);
        const painEvidenceKey = `pain:${fingerprint({ sessionId: sessionLog.sessionId, prescriptionId: exerciseLog.prescriptionId, event: painEvent })}`;
        if (
          painEvent !== undefined &&
          (currentVersion || recorded !== undefined)
        )
          painObservations.push({
            evidenceKey: painEvidenceKey,
            reviewed:
              program.adaptationEvidenceConsumedThrough?.[painEvidenceKey] !==
              undefined,
            exerciseId: exerciseLog.exerciseId,
            weekNumber: weekLog.weekNumber,
            sessionId: sessionLog.sessionId,
            event: painEvent,
          });
        const latestLoad = [...completed]
          .reverse()
          .find((set) => set.load !== undefined)?.load;
        const rirError = median(errors);
        const exposureMissReason =
          exerciseLog.missReason ??
          (["equipment", "preference", "pain"].includes(
            String(sessionLog.missReason),
          )
            ? undefined
            : sessionLog.missReason);
        exposures.push({
          contextKey,
          progressionEligible,
          successful:
            completed.length >= prescription.sets &&
            (prescription.progression.method !== "double_progression" ||
              completed.every((set) => set.load === completed[0]?.load)) &&
            completed.every(
              (set) =>
                set.reps >= context.reps.max &&
                set.techniqueOkay !== false &&
                effortValue(set) !== undefined &&
                (effortValue(set) ?? -1) >= context.targetRir.min &&
                (context.load === undefined ||
                  (set.load ?? -1) >= context.load),
            ),
          requiredSuccessfulExposures: Math.max(
            2,
            prescription.progression.requiredSuccessfulExposures ??
              POLICY.training.comparableObservations,
          ),
          progressionMethod: prescription.progression.method,
          exerciseId: exerciseLog.exerciseId,
          prescriptionId: exerciseLog.prescriptionId,
          weekNumber: weekLog.weekNumber,
          sessionId: sessionLog.sessionId,
          ...(sessionLog.programVersion === undefined
            ? {}
            : { programVersion: sessionLog.programVersion }),
          ...(rirError === undefined ? {} : { rirError }),
          failure:
            [sessionLog.missReason, exerciseLog.missReason].some((reason) =>
              ["too_hard", "soreness"].includes(String(reason)),
            ) || exerciseLog.sets.some((set) => set.techniqueOkay === false),
          completedSets: completed.length,
          plannedSets: prescription.sets,
          ...(latestLoad === undefined ? {} : { latestLoad }),
          ...(!currentVersion || exposureMissReason === undefined
            ? {}
            : { missReason: exposureMissReason }),
        });
      }
    }
  }

  return {
    plannedSets,
    completedSets,
    requiredPlannedSets,
    requiredCompletedSets,
    ...((requiredPlannedSets || plannedSets) === 0
      ? {}
      : {
          completionRate:
            requiredPlannedSets > 0
              ? requiredCompletedSets / requiredPlannedSets
              : completedSets / plannedSets,
        }),
    reasonCounts,
    exposures,
    cardioExposures,
    painObservations,
    loggingCompleteness:
      expectedLoggedSessions === 0
        ? 0
        : loggedFormalSessions / expectedLoggedSessions,
    plannedCardioMinutes,
    completedCardioMinutes,
    ...(plannedCardioMinutes === 0
      ? {}
      : {
          cardioCompletionRate: completedCardioMinutes / plannedCardioMinutes,
        }),
    movementObservations,
  };
}

function groupedComparable(exposures: Exposure[]): Map<string, Exposure[]> {
  const grouped = new Map<string, Exposure[]>();
  for (const exposure of exposures) {
    const list = grouped.get(exposure.contextKey) ?? [];
    list.push(exposure);
    grouped.set(exposure.contextKey, list);
  }
  for (const [key, values] of grouped) {
    grouped.set(
      key,
      values.sort(
        (left, right) =>
          left.weekNumber - right.weekNumber ||
          left.sessionId.localeCompare(right.sessionId),
      ),
    );
  }
  return grouped;
}

function evidenceTargets(
  metrics: ReviewMetrics,
  program: TrainingProgram,
): {
  easy: string[];
  hard: string[];
  easyCardio: string[];
  hardCardio: string[];
} {
  const easy: string[] = [];
  const hard: string[] = [];
  const painful = new Set(
    metrics.painObservations
      .filter((observation) => !observation.reviewed)
      .map((observation) => observation.exerciseId),
  );
  for (const [contextKey, values] of groupedComparable(metrics.exposures)) {
    if (values.some((value) => painful.has(value.exerciseId))) continue;
    const required =
      values.at(-1)?.requiredSuccessfulExposures ??
      POLICY.training.comparableObservations;
    const comparable = values
      .filter(
        (value) =>
          value.progressionEligible &&
          value.weekNumber >
            (program.adaptationEvidenceConsumedThrough?.[contextKey] ?? 0),
      )
      .slice(-required);
    if (comparable.length < required) continue;
    if (
      comparable.every(
        (value) =>
          !value.failure &&
          value.successful &&
          (value.progressionMethod === "double_progression"
            ? (value.rirError ?? 0) >= 0 &&
              value.latestLoad === comparable.at(-1)?.latestLoad
            : (value.rirError ?? 0) > 1),
      )
    )
      easy.push(contextKey);
    if (
      comparable.every((value) => value.failure || (value.rirError ?? 0) < -1)
    )
      hard.push(contextKey);
  }
  const easyCardio: string[] = [];
  const hardCardio: string[] = [];
  for (const contextKey of unique(
    metrics.cardioExposures.map((value) => value.contextKey),
  )) {
    const comparable = metrics.cardioExposures
      .filter(
        (value) =>
          value.contextKey === contextKey &&
          value.progressionEligible &&
          value.weekNumber >
            (program.adaptationEvidenceConsumedThrough?.[contextKey] ?? 0),
      )
      .slice(-POLICY.training.comparableObservations);
    if (comparable.length < POLICY.training.comparableObservations) continue;
    if (
      comparable.every(
        (value) =>
          value.completedMinutes >= value.plannedMinutes &&
          value.rpeError !== undefined &&
          value.rpeError <= -1,
      )
    )
      easyCardio.push(contextKey);
    if (
      comparable.every(
        (value) =>
          ["too_hard", "soreness"].includes(String(value.missReason)) ||
          (value.rpeError !== undefined && value.rpeError >= 1),
      )
    )
      hardCardio.push(contextKey);
  }
  return { easy, hard, easyCardio, hardCardio };
}

function repeatedReason(
  metrics: ReviewMetrics,
  reasons: MissReason[],
): boolean {
  return (
    reasons.reduce(
      (sum, reason) => sum + (metrics.reasonCounts[reason] ?? 0),
      0,
    ) >= 2
  );
}

function classify(
  metrics: ReviewMetrics,
  program: TrainingProgram,
): {
  state: WeeklyState;
  easy: string[];
  hard: string[];
  easyCardio: string[];
  hardCardio: string[];
} {
  const evidence = evidenceTargets(metrics, program);
  if (
    metrics.painObservations.some(
      ({ event, reviewed }) =>
        !reviewed &&
        (event.urgentWarningSigns ||
          (event.onset === "accident" && event.impact === "stopped_workout")),
    )
  )
    return { state: "safety_constrained", ...evidence };
  if (repeatedReason(metrics, ["time"]))
    return { state: "time_infeasible", ...evidence };
  if (repeatedReason(metrics, ["schedule", "travel"]))
    return { state: "schedule_infeasible", ...evidence };
  if (repeatedReason(metrics, ["equipment", "preference"]))
    return { state: "exercise_mismatch", ...evidence };
  if (
    evidence.hard.length > 0 ||
    evidence.hardCardio.length > 0 ||
    repeatedReason(metrics, ["too_hard", "soreness"])
  )
    return { state: "physiologically_overloaded", ...evidence };
  if (evidence.easy.length > 0 || evidence.easyCardio.length > 0)
    return { state: "underloaded", ...evidence };
  if (metrics.plannedSets === 0 && metrics.plannedCardioMinutes === 0)
    return { state: "insufficient_data", ...evidence };
  const liftingOnTrack =
    metrics.plannedSets === 0 ||
    (metrics.completionRate ?? 0) >= POLICY.training.onTrackSetCompletion;
  const cardioOnTrack =
    metrics.plannedCardioMinutes === 0 ||
    (metrics.cardioCompletionRate ?? 0) >= POLICY.training.onTrackSetCompletion;
  if (liftingOnTrack && cardioOnTrack)
    return { state: "on_track", ...evidence };
  return { state: "insufficient_data", ...evidence };
}

function confidence(metrics: ReviewMetrics): AdaptationResult["confidence"] {
  const completeExposureCount = metrics.exposures.filter(
    (item) =>
      item.progressionEligible &&
      item.completedSets > 0 &&
      item.rirError !== undefined,
  ).length;
  const completeCardioCount = metrics.cardioExposures.filter(
    (item) =>
      item.progressionEligible &&
      item.completedMinutes > 0 &&
      item.rpeError !== undefined,
  ).length;
  if (
    metrics.loggingCompleteness >= 0.8 &&
    completeExposureCount + completeCardioCount >= 4
  )
    return "high";
  if (
    metrics.loggingCompleteness >= 0.4 &&
    metrics.exposures.length + metrics.cardioExposures.length >= 2
  )
    return "moderate";
  return "low";
}

function futurePrescriptions(
  program: TrainingProgram,
  afterWeek: number,
): ExercisePrescription[] {
  return program.weeks
    .filter((week) => week.weekNumber > afterWeek)
    .flatMap((week) => week.sessions)
    .flatMap((session) => session.exercises);
}

function applyLoadChange(
  program: TrainingProgram,
  contextKey: string,
  afterWeek: number,
  direction: "increase" | "decrease",
  metrics: ReviewMetrics,
  applied: boolean,
): AdaptationChange | undefined {
  const candidates = program.weeks
    .filter((week) => week.weekNumber > afterWeek)
    .flatMap((week) =>
      week.sessions.flatMap((session) =>
        session.exercises.filter(
          (item) =>
            exerciseContextKey(item, week.phase) === contextKey &&
            week.phase !== "taper",
        ),
      ),
    );
  if (candidates.length === 0) return undefined;
  const first = candidates[0];
  if (first === undefined) return undefined;
  const exerciseId = first.exerciseId;
  const floor = Math.max(1, first.progression.repFloor ?? first.reps.min);
  const ceiling = Math.max(
    floor,
    first.progression.repCeiling ?? first.reps.max,
  );
  const latest = [...metrics.exposures]
    .reverse()
    .find((item) => item.contextKey === contextKey && item.progressionEligible);
  const baselineLoad = first.load ?? latest?.latestLoad;
  const repStep =
    first.progression.method !== "percentage_wave" &&
    ((direction === "increase" && first.reps.min < ceiling) ||
      (direction === "decrease" &&
        baselineLoad === undefined &&
        first.reps.min > floor));
  if (repStep) {
    const beforeRep = first.reps.min;
    const nextRep = Math.max(
      floor,
      Math.min(ceiling, first.reps.min + (direction === "increase" ? 1 : -1)),
    );
    if (applied) {
      for (const item of candidates) item.reps = { min: nextRep, max: nextRep };
      program.adaptationEvidenceConsumedThrough = {
        ...program.adaptationEvidenceConsumedThrough,
        [contextKey]: afterWeek,
      };
    }
    return {
      type: "reps",
      target: exerciseId,
      before: `${beforeRep} reps`,
      after: `${nextRep} reps`,
      reason:
        direction === "increase"
          ? "Repeated successful exposures at this exact role, phase and effort support one rep within the prescribed progression bounds. Weight and sets stay unchanged."
          : "Repeated difficulty supports one fewer rep within this exercise's progression bounds. Weight and sets stay unchanged.",
      ruleIds: ["ADAPT-1", "ADAPT-3"],
      applied,
    };
  }
  // Never invent an unlimited rep ladder or a load from a different series.
  if (
    baselineLoad === undefined ||
    !Number.isFinite(baselineLoad) ||
    baselineLoad < 0
  )
    return undefined;
  const fraction =
    direction === "increase"
      ? POLICY.training.easyLoadIncreaseFraction
      : -POLICY.training.hardLoadDecreaseFraction;
  const increment = loadIncrementForExercise(program, exerciseId);
  const doubleProgression = first.progression.method === "double_progression";
  const adjustedLoad = (load: number): number =>
    direction === "increase"
      ? doubleProgression
        ? load + increment
        : Math.max(
            load + increment,
            roundToIncrement(load * (1 + fraction), increment),
          )
      : Math.max(
          0,
          Math.min(
            load - increment,
            roundToIncrement(load * (1 + fraction), increment),
          ),
        );
  const nextLoad = adjustedLoad(baselineLoad);
  if (nextLoad === baselineLoad) return undefined;
  if (applied) {
    for (const item of candidates) {
      const before = item.load ?? baselineLoad;
      item.load = adjustedLoad(before);
      // Each future occurrence keeps its own wave, instead of one absolute load.
      if (item.percentE1rm !== undefined && before > 0)
        item.percentE1rm =
          Math.round(((item.percentE1rm * item.load) / before) * 10000) / 10000;
      if (doubleProgression && direction === "increase") {
        const reset = item.progression.repFloor ?? item.reps.min;
        item.reps = { min: reset, max: reset };
      }
    }
    program.adaptationEvidenceConsumedThrough = {
      ...program.adaptationEvidenceConsumedThrough,
      [contextKey]: afterWeek,
    };
  }
  return {
    type: "load",
    target: exerciseId,
    before: `${baselineLoad} ${program.loadSettings.units}`,
    after: `${nextLoad} ${program.loadSettings.units}${doubleProgression && direction === "increase" ? `; ${floor} reps` : ""}`,
    reason:
      direction === "increase"
        ? "Repeated comparable successes support a local increase. Double progression adds one implement step at the rep ceiling and resets to the rep floor; percentage work retains each future occurrence's wave and percentage relationship."
        : "Repeated comparable difficulty supports a local load reduction. Other roles, phases and the taper remain unchanged, and each percentage prescription stays consistent with its own load.",
    ruleIds: ["ADAPT-1", "ADAPT-3"],
    applied,
  };
}

function sessionSequence(sessionId: string): string | undefined {
  return /-(lift|cardio)-(\d+)$/.exec(sessionId)?.[0];
}

function applyCardioDurationChange(
  program: TrainingProgram,
  afterWeek: number,
  contextKey: string | undefined,
  direction: "increase" | "decrease",
  applied: boolean,
): AdaptationChange | undefined {
  if (contextKey === undefined) return undefined;
  const candidates = program.weeks
    .filter((week) => week.weekNumber > afterWeek)
    .flatMap((week) =>
      week.sessions.filter(
        (session) =>
          session.cardio !== undefined &&
          cardioContextKey(session.cardio, week.phase) === contextKey &&
          session.cardio.eventPhase !== "taper" &&
          week.phase !== "taper",
      ),
    );
  const first = candidates[0]?.cardio;
  if (first === undefined) return undefined;
  if (first.intervals !== undefined) {
    const beforeRepeats = first.intervals.repeats;
    const repeatDelta = direction === "increase" ? 1 : -1;
    const nextRepeats = Math.max(2, first.intervals.repeats + repeatDelta);
    if (nextRepeats === beforeRepeats) return undefined;
    if (applied) {
      for (const session of candidates) {
        const cardio = session.cardio;
        if (cardio?.intervals === undefined) continue;
        const oldRepeats = cardio.intervals.repeats;
        const oldMinutes = cardio.minutes;
        cardio.intervals.repeats = Math.max(
          2,
          cardio.intervals.repeats + repeatDelta,
        );
        synchronizeCardioDuration(cardio);
        if (
          !cardio.segments?.length ||
          cardio.segments.some((segment) => segment.minutes === undefined)
        )
          cardio.minutes =
            Math.round(
              (oldMinutes +
                ((cardio.intervals.repeats - oldRepeats) *
                  (cardio.intervals.workSeconds +
                    cardio.intervals.recoverySeconds)) /
                  60) *
                1000,
            ) / 1000;
        recalculateSessionDuration(session);
      }
      program.adaptationEvidenceConsumedThrough = {
        ...program.adaptationEvidenceConsumedThrough,
        [contextKey]: afterWeek,
      };
    }
    return {
      type: "cardio",
      target: "cardio interval sessions",
      before: `${beforeRepeats} work intervals`,
      after: `${nextRepeats} work intervals`,
      reason:
        direction === "increase"
          ? "You completed comparable interval sessions below the target effort, so the next quality session adds one work interval."
          : "Comparable interval sessions were harder than planned, so the next quality session removes one work interval while keeping the effort target.",
      ruleIds: ["CARDIO-5", "ADAPT-1", "ADAPT-3"],
      applied,
    };
  }
  const delta =
    direction === "increase"
      ? POLICY.cardio.durationProgressionMinutes
      : -POLICY.cardio.durationProgressionMinutes;
  const adjustDuration = (cardio: CardioPrescription): void => {
    const work = cardio.segments?.find((segment) => segment.kind === "work");
    if (work?.minutes !== undefined) {
      const before = work.minutes;
      work.minutes = Math.max(
        1,
        before + delta / Math.max(1, work.repeats ?? 1),
      );
      if (before > 0) {
        if (work.distance !== undefined)
          work.distance =
            Math.round(((work.distance * work.minutes) / before) * 1000) / 1000;
        if (cardio.targetDistance !== undefined)
          cardio.targetDistance.value =
            Math.round(
              ((cardio.targetDistance.value * work.minutes) / before) * 1000,
            ) / 1000;
      }
    } else {
      const before = cardio.minutes;
      cardio.minutes = Math.max(5, before + delta);
      if (cardio.targetDistance !== undefined && before > 0)
        cardio.targetDistance.value =
          Math.round(
            ((cardio.targetDistance.value * cardio.minutes) / before) * 1000,
          ) / 1000;
    }
    synchronizeCardioDuration(cardio);
  };
  const preview = structuredClone(first);
  adjustDuration(preview);
  const firstNext = preview.minutes;
  const beforeMinutes = first.minutes;
  if (firstNext === beforeMinutes) return undefined;
  if (applied) {
    for (const session of candidates) {
      if (session.cardio === undefined) continue;
      adjustDuration(session.cardio);
      recalculateSessionDuration(session);
    }
    program.adaptationEvidenceConsumedThrough = {
      ...program.adaptationEvidenceConsumedThrough,
      [contextKey]: afterWeek,
    };
  }
  return {
    type: "cardio",
    target: `${first.modality} ${first.role ?? first.intensity} cardio sessions`,
    before: `${beforeMinutes} minutes`,
    after: `${firstNext} minutes`,
    reason:
      direction === "increase"
        ? "You completed two comparable sessions below the target effort. The next matching sessions add five minutes and keep the same intensity."
        : "Two comparable sessions landed above the target effort. The next matching sessions are five minutes shorter and keep the same intensity.",
    ruleIds: ["CARDIO-2", "ADAPT-1", "ADAPT-3"],
    applied,
  };
}

function firstLoggedSessionForReason(
  logs: WeekLog[],
  reason: MissReason,
): SessionLog | undefined {
  return logs
    .flatMap((week) => week.sessions)
    .find(
      (session) =>
        session.missReason === reason ||
        session.exercises.some((item) => item.missReason === reason),
    );
}

function applyMovementTargetChange(
  program: TrainingProgram,
  afterWeek: number,
  observations: boolean[],
  state: WeeklyState,
  applied: boolean,
): AdaptationChange | undefined {
  if (observations.length < 2) return undefined;
  const completionRate =
    observations.filter(Boolean).length / observations.length;
  const direction =
    completionRate <= 0.5
      ? "decrease"
      : completionRate >= 0.8 &&
          observations.length >= 3 &&
          (state === "on_track" || state === "underloaded")
        ? "increase"
        : undefined;
  if (direction === undefined) return undefined;

  const futureTargets = program.weeks
    .filter((week) => week.weekNumber > afterWeek)
    .flatMap((week) => week.sessions)
    .filter((session) => session.kind === "movement")
    .flatMap((session) =>
      session.movementTarget === undefined ? [] : [session.movementTarget],
    );
  const first = futureTargets[0];
  if (first === undefined) return undefined;
  if (
    direction === "increase" &&
    ((first.steps !== undefined && first.steps >= 12_000) ||
      (first.walkingMinutes !== undefined && first.walkingMinutes >= 45))
  )
    return undefined;
  const before =
    first.steps !== undefined
      ? `${first.steps} steps`
      : `${first.walkingMinutes ?? 0} minutes`;
  const delta = direction === "increase" ? 1 : -1;
  if (applied) {
    for (const target of futureTargets) {
      if (target.steps !== undefined) {
        target.steps =
          direction === "increase" && target.steps >= 12_000
            ? target.steps
            : Math.max(2_000, target.steps + delta * 500);
      } else if (target.walkingMinutes !== undefined) {
        target.walkingMinutes =
          direction === "increase" && target.walkingMinutes >= 45
            ? target.walkingMinutes
            : Math.max(10, target.walkingMinutes + delta * 5);
      }
      target.explanation =
        direction === "increase"
          ? "Your recent check-ins support one small increase in daily movement."
          : "Your recent check-ins support a slightly easier daily movement target.";
    }
  }
  const after =
    first.steps !== undefined
      ? `${
          applied || (direction === "increase" && first.steps >= 12_000)
            ? first.steps
            : Math.max(2_000, first.steps + delta * 500)
        } steps`
      : `${
          applied ||
          (direction === "increase" && (first.walkingMinutes ?? 0) >= 45)
            ? (first.walkingMinutes ?? 0)
            : Math.max(10, (first.walkingMinutes ?? 0) + delta * 5)
        } minutes`;
  return {
    type: "movement",
    target: "future daily movement targets",
    before,
    after,
    reason:
      direction === "increase"
        ? "You reached the target consistently across several check-ins, so future targets rise by one small step."
        : "Several check-ins came in below the target, so future targets move closer to what is currently repeatable.",
    ruleIds: ["MOVE-1", "ADAPT-1", "ADAPT-3"],
    applied,
  };
}

function applyTimeReduction(
  program: TrainingProgram,
  afterWeek: number,
  logs: WeekLog[],
  applied: boolean,
): AdaptationChange | undefined {
  const source = firstLoggedSessionForReason(logs, "time");
  const sequence =
    source === undefined ? undefined : sessionSequence(source.sessionId);
  const futureSessions = program.weeks
    .filter((week) => week.weekNumber > afterWeek)
    .flatMap((week) => week.sessions)
    .filter(
      (session) =>
        sequence === undefined || sessionSequence(session.id) === sequence,
    );
  const sourcePlanned =
    source === undefined
      ? undefined
      : program.weeks
          .flatMap((week) => week.sessions)
          .find((session) => session.id === source.sessionId);
  const liftingWasComplete =
    sourcePlanned !== undefined &&
    sourcePlanned.exercises.every((prescription) => {
      const logged = source?.exercises.find(
        (exercise) => exercise.prescriptionId === prescription.id,
      );
      return (
        logged !== undefined &&
        logged.sets.filter((set) => set.completed).length >= prescription.sets
      );
    });
  const cardioWasShort =
    sourcePlanned?.cardio !== undefined &&
    (source?.cardioCompletedMinutes ?? 0) < sourcePlanned.cardio.minutes;
  if (liftingWasComplete && cardioWasShort) {
    return applyCardioDurationChange(
      program,
      afterWeek,
      cardioKeyForSession(program, sourcePlanned.id),
      "decrease",
      applied,
    );
  }
  const representative = futureSessions[0];
  const target = representative?.exercises
    .filter((item) => item.optional)
    .sort((left, right) => right.priority - left.priority)[0];
  if (target === undefined) {
    return applyCardioDurationChange(
      program,
      afterWeek,
      cardioKeyForSession(program, representative?.id),
      "decrease",
      applied,
    );
  }
  const beforeSets = target.sets;
  if (beforeSets <= 1) return undefined;
  if (applied) {
    for (const session of futureSessions) {
      const match = session.exercises.find(
        (item) =>
          item.performanceSeriesId === target.performanceSeriesId &&
          item.purpose === target.purpose &&
          item.contextRole === target.contextRole &&
          item.phase === target.phase &&
          item.optional,
      );
      if (match !== undefined) match.sets = Math.max(1, match.sets - 1);
    }
  }
  return {
    type: "sets",
    target: target.exerciseId,
    before: `${beforeSets} sets`,
    after: `${Math.max(1, beforeSets - 1)} sets`,
    reason:
      "You kept useful training momentum even when time was tight. One lower-priority set is removed so the next workout is easier to finish, while the training weights stay the same.",
    ruleIds: ["ADAPT-2", "ADAPT-3", "TIME-1"],
    applied,
  };
}

function applyScheduleResponse(
  program: TrainingProgram,
  afterWeek: number,
  applied: boolean,
): AdaptationChange {
  const reflow =
    program.adaptationSettings.missedWorkoutPolicy === "reflow_week";
  if (reflow && program.integrityVersion !== undefined)
    return {
      type: "hold",
      target: "future schedule",
      applied: false,
      reason:
        "The dated plan needs a new feasible schedule before workouts can move. Keep the current dates and do not double missed work into another day; review availability and regenerate the future schedule.",
      ruleIds: ["ADAPT-2", "ADAPT-4"],
    };
  if (!reflow) {
    return {
      type: "hold",
      target: "future schedule",
      before: "current scheduled workouts",
      after: "current scheduled workouts; no make-up sessions",
      reason:
        "You stayed connected to the plan through schedule changes. Your usual training days remain in place, and missed work will not be piled onto another day.",
      ruleIds: ["ADAPT-2", "ADAPT-4"],
      applied: false,
    };
  }
  if (applied && reflow) {
    for (const week of program.weeks.filter(
      (item) => item.weekNumber > afterWeek,
    )) {
      for (const session of week.sessions) delete session.day;
    }
  }
  return {
    type: "schedule",
    target: "future-week architecture",
    before: "calendar days",
    after: "flexible workout order",
    reason:
      "Your check-ins showed that a flexible order will fit better. Future workouts can move without doubling missed work into a later day.",
    ruleIds: ["ADAPT-2", "ADAPT-4"],
    applied,
  };
}

function mismatchedExercise(metrics: ReviewMetrics): string | undefined {
  const counts = new Map<string, number>();
  for (const exposure of metrics.exposures.filter((item) =>
    ["equipment", "preference"].includes(String(item.missReason)),
  ))
    counts.set(exposure.exerciseId, (counts.get(exposure.exerciseId) ?? 0) + 1);
  return [...counts.entries()].sort(
    (left, right) => right[1] - left[1],
  )[0]?.[0];
}

function applyExerciseReplacement(
  program: TrainingProgram,
  exerciseId: string,
  afterWeek: number,
  applied: boolean,
): AdaptationChange | undefined {
  const candidates = futurePrescriptions(program, afterWeek).filter(
    (item) => item.exerciseId === exerciseId,
  );
  const first = candidates[0];
  const replacement = first?.alternativeChoices[0];
  if (first === undefined || replacement === undefined) return undefined;
  const beforeName = first.name;
  if (applied) {
    for (const item of candidates) {
      item.exerciseId = replacement.exerciseId;
      item.performanceSeriesId = replacement.exerciseId;
      item.name = replacement.name;
      delete item.load;
      delete item.percentE1rm;
      item.progression.method = "calibration";
      item.explanation = `${item.explanation} This replacement starts its own weight history.`;
    }
  }
  return {
    type: "exercise",
    target: exerciseId,
    before: beforeName,
    after: replacement.name,
    reason:
      "Your feedback identified a better-fitting exercise. The next suitable replacement is selected, and its starting weight will be found separately.",
    ruleIds: ["EX-1", "EX-3", "ADAPT-2"],
    applied,
  };
}

function applyPainResponses(
  program: TrainingProgram,
  observations: PainObservation[],
  afterWeek: number,
  applied: boolean,
): {
  changes: AdaptationChange[];
  signals: AdaptationSafetySignal[];
  warnings: EngineWarning[];
} {
  const grouped = new Map<string, PainObservation[]>();
  for (const observation of observations) {
    const values = grouped.get(observation.exerciseId) ?? [];
    values.push(observation);
    grouped.set(observation.exerciseId, values);
  }
  const changes: AdaptationChange[] = [];
  const signals: AdaptationSafetySignal[] = [];
  const warnings: EngineWarning[] = [];

  for (const [exerciseId, values] of grouped) {
    if (values.every((value) => value.reviewed)) continue;
    const name = getExercise(exerciseId)?.name ?? exerciseId;
    const urgent = values.some(
      ({ event }) =>
        event.urgentWarningSigns === true ||
        (event.onset === "accident" && event.impact === "stopped_workout"),
    );
    const persistent =
      values.length >= 2 ||
      values.some(({ event }) =>
        ["same", "worse", "affects_daily_life"].includes(
          String(event.followUp),
        ),
      ) ||
      values.some(({ event }) => event.baseline === "familiar_worse");
    const future = program.weeks
      .filter((week) => week.weekNumber > afterWeek)
      .flatMap((week) =>
        week.sessions.flatMap((session) =>
          session.exercises
            .filter((item) => item.exerciseId === exerciseId)
            .map((prescription) => ({ week, session, prescription })),
        ),
      );
    const first = future[0];

    if (urgent) {
      if (applied) {
        for (const week of program.weeks.filter(
          (item) => item.weekNumber > afterWeek,
        )) {
          for (const session of week.sessions) {
            session.exercises = session.exercises.filter(
              (item) => item.exerciseId !== exerciseId,
            );
          }
        }
      }
      changes.push({
        type: "exercise",
        target: exerciseId,
        before: name,
        after: "Paused until the warning signs are assessed",
        reason:
          "Your check-in included a warning sign that deserves more caution. This movement is paused; unrelated training can remain if it feels normal and does not reproduce the problem.",
        ruleIds: ["SAFE-1", "SAFE-2", "ADAPT-4"],
        applied,
      });
      signals.push({
        exerciseId,
        level: "stop_and_seek_care",
        title: `${name} is paused`,
        message:
          "Do not test this movement again right away. Seek appropriate assessment, especially for a fall or pop, major swelling, numbness or weakness, inability to use the area normally, or symptoms that are severe or worsening.",
      });
      warnings.push({
        code: `pain-warning-${exerciseId}`,
        severity: "blocking",
        message:
          "A reported warning sign paused the affected movement. The app does not diagnose injuries or prescribe rehabilitation.",
        ruleIds: ["SAFE-1", "SAFE-2"],
      });
      continue;
    }

    if (persistent && first !== undefined) {
      const nextWeek = first.week.weekNumber;
      const matches = future.filter(
        (item) => item.week.weekNumber === nextWeek,
      );
      const replacement = first.prescription.alternativeChoices[0];
      if (replacement !== undefined) {
        if (applied) {
          for (const { prescription } of matches) {
            prescription.exerciseId = replacement.exerciseId;
            prescription.performanceSeriesId = `${replacement.exerciseId}:pain-temporary`;
            prescription.name = replacement.name;
            delete prescription.load;
            delete prescription.percentE1rm;
            prescription.progression.method = "calibration";
          }
        }
        changes.push({
          type: "exercise",
          target: exerciseId,
          before: name,
          after: `${replacement.name} for week ${nextWeek}`,
          reason:
            "Because the issue repeated, worsened, or is still affecting you, the next week uses a similar movement that trains the same goal without asking you to push through the same exercise.",
          ruleIds: ["SAFE-1", "SAFE-2", "EX-1", "ADAPT-4"],
          applied,
        });
      } else {
        if (applied) {
          for (const { session, prescription } of matches) {
            session.exercises = session.exercises.filter(
              (item) => item.id !== prescription.id,
            );
          }
        }
        changes.push({
          type: "exercise",
          target: exerciseId,
          before: name,
          after: `Paused for week ${nextWeek}`,
          reason:
            "There is no suitable automatic replacement, so this movement takes one week off instead of asking you to push through it. The rest of the program stays in place.",
          ruleIds: ["SAFE-1", "SAFE-2", "ADAPT-4"],
          applied,
        });
      }
      signals.push({
        exerciseId,
        level: "replace_temporarily",
        title: `${name} needs a temporary change`,
        message:
          "The response is limited to this exercise. Other training stays available unless it causes the same problem.",
      });
      continue;
    }

    if (first !== undefined) {
      const before = `${first.prescription.targetRir.min}–${first.prescription.targetRir.max} RIR`;
      const nextTarget = {
        min: Math.min(6, first.prescription.targetRir.min + 1),
        max: Math.min(6, first.prescription.targetRir.min + 1),
      };
      if (applied) first.prescription.targetRir = nextTarget;
      changes.push({
        type: "effort",
        target: exerciseId,
        before,
        after: `${nextTarget.min}–${nextTarget.max} RIR for the next exposure`,
        reason:
          "One report is enough to be cautious, but not enough to remove the movement indefinitely. The next attempt is easier, and its result will determine whether the exercise returns to normal or needs a temporary replacement.",
        ruleIds: ["SAFE-1", "SAFE-2", "ADAPT-3"],
        applied,
      });
      signals.push({
        exerciseId,
        level: "modify_next",
        title: `${name} gets an easier check-in set next time`,
        message:
          "Use the easier target only if normal daily movement feels okay. Stop the exercise if pain changes your technique, range of motion, or ability to finish the set.",
      });
    } else {
      signals.push({
        exerciseId,
        level: "monitor",
        title: `Keep an eye on ${name}`,
        message:
          "There is no later exposure in this block to change. Do not push through symptoms that alter your movement, and seek appropriate help if they persist or worsen.",
      });
    }
  }
  return { changes, signals, warnings };
}

function recalculateDurations(
  program: TrainingProgram,
  afterWeek: number,
  original: TrainingProgram,
): void {
  for (const week of program.weeks.filter(
    (item) => item.weekNumber > afterWeek,
  )) {
    let changed = false;
    for (const session of week.sessions.filter(
      (item) => item.kind !== "movement",
    )) {
      const before = original.weeks
        .find((item) => item.weekNumber === week.weekNumber)
        ?.sessions.find((item) => item.id === session.id);
      if (JSON.stringify(before) === JSON.stringify(session)) continue;
      changed = true;
      sanitizeSessionSetBlocks(session);
      delete session.durationAlternative;
      recalculateSessionDuration(session);
    }
    if (changed) refreshWeekDoseLedger(week);
  }
}

export function adaptProgram(
  program: TrainingProgram,
  logs: WeekLog[],
  options: {
    applyChanges?: boolean;
    wearable?: WearableAdaptationContext;
    safetyReviewReasons?: string[];
  } = {},
): AdaptationResult {
  const sortedLogs = [...logs].sort(
    (left, right) => left.weekNumber - right.weekNumber,
  );
  const reviewedWeeks = sortedLogs.map((item) => item.weekNumber);
  const afterWeek = reviewedWeeks.at(-1) ?? 0;
  if (options.safetyReviewReasons?.length) {
    const reason = `Programming is on hold pending safety clarification. ${options.safetyReviewReasons.join(" ")} This engine supports adults with reviewed restrictions; it does not replace individualized clearance or youth programming.`;
    return {
      state: "safety_constrained",
      confidence: "low",
      reviewedWeeks,
      program: structuredClone(program),
      safetySignals: [],
      changes: [
        {
          type: "hold",
          target: "program safety scope",
          reason,
          ruleIds: ["SAFE-1", "SAFE-2"],
          applied: false,
          engineVersion: ENGINE_VERSION,
          policyVersion: POLICY_VERSION,
        },
      ],
      explanation: reason,
      warnings: [
        {
          code: "programming-safety-review",
          severity: "blocking",
          message: reason,
          ruleIds: ["SAFE-1", "SAFE-2"],
        },
      ],
      triggeredRuleIds: ["SAFE-1", "SAFE-2"],
    };
  }
  const reviewFingerprint = fingerprint({
    programId: program.id,
    policyVersion: POLICY_VERSION,
    logs: sortedLogs,
    wearable: options.wearable,
  });
  if (program.reviewFingerprints.includes(reviewFingerprint)) {
    return {
      state: "insufficient_data",
      confidence: "low",
      reviewedWeeks,
      program: structuredClone(program),
      changes: [
        {
          type: "hold",
          target: "program",
          reason:
            "This week has already been reviewed, so your saved plan stays consistent and no duplicate change is applied.",
          engineVersion: ENGINE_VERSION,
          policyVersion: POLICY_VERSION,
          ruleIds: ["ADAPT-1", "ADAPT-4"],
          applied: false,
        },
      ],
      safetySignals: [],
      explanation:
        "Idempotence guard: repeated review input returns the existing plan version.",
      warnings: [],
      triggeredRuleIds: ["ADAPT-1", "ADAPT-4"],
    };
  }

  const metrics = collectMetrics(program, sortedLogs);
  const classification = classify(metrics, program);
  const reviewConfidence = confidence(metrics);
  const shouldApply =
    options.applyChanges ??
    program.adaptationSettings.applyChanges === "automatic";
  const next = structuredClone(program);
  const changes: AdaptationChange[] = [];
  const warnings: EngineWarning[] = [];
  const safetySignals: AdaptationSafetySignal[] = [];
  const wearableCaution = options.wearable?.caution === true;
  if (wearableCaution) {
    warnings.push({
      code: "wearable-recovery-trend",
      severity: "info",
      message:
        "A connected wearable shows a meaningful change from its recent recovery baseline. This is secondary evidence: it can pause an increase, but it does not diagnose a problem or reduce training by itself.",
      ruleIds: ["ADAPT-1", "ADAPT-3"],
    });
  }

  if (classification.state === "time_infeasible") {
    const currentFeedback = sortedLogs.map((week) => ({
      ...week,
      sessions: week.sessions.filter(
        (session) =>
          session.programVersion === undefined ||
          session.programVersion === program.version,
      ),
    }));
    const change = applyTimeReduction(
      next,
      afterWeek,
      currentFeedback,
      shouldApply,
    );
    if (change !== undefined) changes.push(change);
  } else if (classification.state === "schedule_infeasible") {
    changes.push(applyScheduleResponse(next, afterWeek, shouldApply));
  } else if (classification.state === "exercise_mismatch") {
    const exerciseId = mismatchedExercise(metrics);
    const change =
      exerciseId === undefined
        ? undefined
        : applyExerciseReplacement(next, exerciseId, afterWeek, shouldApply);
    if (change !== undefined) changes.push(change);
  } else if (classification.state === "physiologically_overloaded") {
    const target = classification.hard[0];
    const change =
      target !== undefined
        ? applyLoadChange(
            next,
            target,
            afterWeek,
            "decrease",
            metrics,
            shouldApply,
          )
        : applyCardioDurationChange(
            next,
            afterWeek,
            classification.hardCardio[0],
            "decrease",
            shouldApply,
          );
    if (change !== undefined) changes.push(change);
  } else if (classification.state === "underloaded") {
    if (wearableCaution) {
      changes.push({
        type: "hold",
        target: "next-week progression",
        reason: `Your training logs support an increase, but ${options.wearable?.source ?? "a connected wearable"} shows a recovery trend that differs from its recent baseline. Keep the current prescription for one more review instead of progressing from device data alone.`,
        ruleIds: ["ADAPT-1", "ADAPT-3"],
        applied: false,
      });
    } else {
      const target = classification.easy[0];
      const change =
        target !== undefined
          ? applyLoadChange(
              next,
              target,
              afterWeek,
              "increase",
              metrics,
              shouldApply,
            )
          : applyCardioDurationChange(
              next,
              afterWeek,
              classification.easyCardio[0],
              "increase",
              shouldApply,
            );
      if (change !== undefined) changes.push(change);
    }
  }

  const painResponse = applyPainResponses(
    next,
    metrics.painObservations,
    afterWeek,
    shouldApply,
  );
  changes.push(...painResponse.changes);
  if (painResponse.changes.some((change) => change.applied)) {
    next.adaptationEvidenceConsumedThrough = {
      ...next.adaptationEvidenceConsumedThrough,
    };
    for (const observation of metrics.painObservations) {
      if (
        painResponse.changes.some(
          (change) =>
            change.applied && change.target === observation.exerciseId,
        )
      )
        next.adaptationEvidenceConsumedThrough[observation.evidenceKey] =
          afterWeek;
    }
  }
  warnings.push(...painResponse.warnings);
  safetySignals.push(...painResponse.signals);

  const movementChange =
    classification.state === "safety_constrained"
      ? undefined
      : applyMovementTargetChange(
          next,
          afterWeek,
          metrics.movementObservations,
          classification.state,
          shouldApply,
        );
  if (movementChange !== undefined) {
    changes.push(movementChange);
    if (movementChange.applied)
      next.adaptationEvidenceConsumedThrough = {
        ...next.adaptationEvidenceConsumedThrough,
        movement: afterWeek,
      };
  }

  if (changes.length === 0) {
    changes.push({
      type: "hold",
      target: "future plan",
      reason:
        classification.state === "on_track"
          ? "You completed the important work near the target effort. Keep following the plan as written."
          : "The logs do not support a specific change yet, so the next week stays as written. Keep recording completed work and effort so the next review has a stronger comparison.",
      ruleIds: ["ADAPT-1", "ADAPT-3"],
      applied: false,
    });
  }

  const anyApplied = changes.some((change) => change.applied);
  for (const change of changes) {
    change.engineVersion = ENGINE_VERSION;
    change.policyVersion = POLICY_VERSION;
  }
  if (anyApplied) {
    next.version = program.version + 1;
    next.loadSettings = canonicalizeLoadSettings(program);
    next.engineVersion = ENGINE_VERSION;
    next.policyVersion = POLICY_VERSION;
    next.originEngineVersion =
      program.originEngineVersion ?? program.engineVersion;
    next.originPolicyVersion =
      program.originPolicyVersion ?? program.policyVersion;
    next.reviewFingerprints = [
      ...program.reviewFingerprints,
      reviewFingerprint,
    ];
    next.triggeredRuleIds = unique([
      ...next.triggeredRuleIds,
      ...changes.flatMap((change) => change.ruleIds),
      "ADAPT-4",
    ]);
    recalculateDurations(next, afterWeek, program);
    next.explanation = `${program.explanation} Version ${next.version} changes only workouts after week ${afterWeek}. Completed workouts stay unchanged.`;
  }

  const stateDescriptions: Record<WeeklyState, string> = {
    on_track: "You completed the important work close to the target effort.",
    underloaded:
      "You exceeded the prescription consistently, so the plan is moving up to meet you.",
    physiologically_overloaded:
      "You put in the work, and your effort logs show that one part of the plan needs to come down a notch.",
    time_infeasible:
      "You kept training when time was tight. The next week protects the important work and trims the part that kept running long.",
    schedule_infeasible:
      "You kept the week moving through schedule changes. The next week avoids piling missed work onto another day.",
    exercise_mismatch:
      "Your feedback found an exercise that is not working for you, so the plan has a specific replacement ready.",
    safety_constrained:
      "Your report includes an urgent safety concern. Progression is paused and the affected exercise is stopped pending appropriate care.",
    insufficient_data:
      "This week still adds useful information. A few more complete set and effort logs will let the next review make a firmer call.",
  };
  const outcomeDescription = anyApplied
    ? "The change shown below was applied to future workouts only."
    : !shouldApply && changes.some((change) => change.type !== "hold")
      ? "Review the specific proposal below before it changes future workouts."
      : "The next week stays as written.";
  const explanation =
    wearableCaution && classification.state === "underloaded"
      ? "Your completed work supports progression, but the connected recovery trend differs enough from its recent baseline to hold the current prescription for one more review. Wearable data is used only as a conservative secondary signal."
      : `${stateDescriptions[classification.state]} ${outcomeDescription}`;
  return {
    state: classification.state,
    confidence: reviewConfidence,
    reviewedWeeks,
    program: anyApplied ? next : program,
    changes,
    safetySignals,
    explanation,
    warnings,
    triggeredRuleIds: unique([
      "ADAPT-1",
      "ADAPT-2",
      "ADAPT-3",
      ...changes.flatMap((change) => change.ruleIds),
    ]),
  };
}
