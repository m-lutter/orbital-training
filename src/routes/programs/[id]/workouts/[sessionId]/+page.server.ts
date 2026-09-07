import type { Json } from "$lib/database.types";
import type { WearableDay } from "$lib/fitness/contracts";
import {
  applyPermanentExerciseSubstitutions,
  availableCardioModalities,
  createSessionEquipmentVariant,
  getExercise,
  isCardioModality,
  usesAddedBodyweightLoad,
  type ExercisePrescription,
  type PainBaseline,
  type PainEvent,
  type PainFollowUp,
  type PainImpact,
  type PainOnset,
  type PermanentSubstitutionRequest,
  type SessionEquipmentVariant,
  type SetBlock,
  type TrainingSession,
} from "$lib/domain";
import { readProgramDraft, type ProgramDraftV3 } from "$lib/engine";
import {
  PersistenceLimitError,
  assertWorkoutWriteSizes,
} from "$lib/persistence/limits";
import { programReversePatchForWrite } from "$lib/persistence/program-history";
import {
  heldProgressionTargets,
  nextWeeklyReview,
  parseWeeklyReviewRow,
  type WeeklyReviewDatabaseRow,
} from "$lib/reviews";
import {
  loadRecommendation,
  isMissReason,
  isWorkoutSetTouched,
  latestWorkoutLogs,
  parseWorkoutLogRow,
  sessionLabel,
  sessionSetBlocks,
  shouldPersistWorkoutExercise,
  type LoggedExercise,
  type LoggedCardio,
  type LoggedMovement,
  type LoggedSet,
  type VerbalEffort,
  type WorkoutLog,
  type WorkoutStatus,
} from "$lib/workouts";
import { error, fail, redirect } from "@sveltejs/kit";
import { rememberRecentProgram } from "$lib/server/recent-program";
import {
  acquireWorkoutSaveSlot,
  checkWorkoutSaveLimit,
} from "$lib/server/workout-save-guard";
import type { Actions, PageServerLoad } from "./$types";

interface WorkoutContext {
  programId: string;
  programName: string;
  draft: ProgramDraftV3;
  session: ProgramDraftV3["program"]["weeks"][number]["sessions"][number];
  facilityMode: "primary" | "secondary";
  facilityVariant?: SessionEquipmentVariant;
}

interface WorkoutPersistContext {
  programId: string;
  programVersion: number;
  session: TrainingSession;
  effortMode: "rpe" | "rir" | "verbal";
  units: "kg" | "lb";
  movementTarget?: TrainingSession["movementTarget"];
  firstFormalSessionId?: string;
  draft?: ProgramDraftV3;
}

async function context(
  locals: App.Locals,
  programId: string,
  sessionId: string,
  facilityMode: "primary" | "secondary" = "primary",
  authenticatedUserId?: string,
): Promise<WorkoutContext> {
  if (authenticatedUserId === undefined) {
    const {
      data: { user },
    } = await locals.getUser();
    if (!user) redirect(303, "/login");
  }

  const { data: row, error: queryError } = await locals.supabase
    .from("programs")
    .select("id, name, payload")
    .eq("id", programId)
    .maybeSingle();
  if (queryError) error(500, "The program could not be loaded.");
  if (!row) error(404, "Program not found.");

  const draft = readProgramDraft(row.payload);
  if (draft.schemaVersion !== 3) error(400, "This program cannot be logged.");
  const plannedSession = draft.program.weeks
    .flatMap((week) => week.sessions)
    .find((candidate) => candidate.id === sessionId);
  if (!plannedSession || plannedSession.kind === "movement") {
    error(404, "Workout not found.");
  }
  const facilityVariant =
    facilityMode === "secondary"
      ? createSessionEquipmentVariant(
          draft.program,
          draft.inputSnapshot,
          plannedSession.id,
        )
      : undefined;
  const session = facilityVariant?.session ?? plannedSession;
  return {
    programId: row.id,
    programName: row.name,
    draft,
    session,
    facilityMode,
    facilityVariant,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fullPersistContext(workout: WorkoutContext): WorkoutPersistContext {
  const reporting = workout.draft.inputSnapshot.history.effortReporting;
  return {
    programId: workout.programId,
    programVersion: workout.draft.program.version,
    session: workout.session,
    effortMode:
      reporting === "auto"
        ? workout.draft.inputSnapshot.history.effortFamiliarity === "none"
          ? "verbal"
          : "rir"
        : reporting,
    units: workout.draft.program.loadSettings.units,
    movementTarget: workout.draft.program.weeks
      .find((week) => week.weekNumber === workout.session.weekNumber)
      ?.sessions.find((session) => session.kind === "movement")?.movementTarget,
    firstFormalSessionId: workout.draft.program.weeks.flatMap((week) =>
      week.sessions.filter((session) => session.kind !== "movement"),
    )[0]?.id,
    draft: workout.draft,
  };
}

function parsePersistContext(value: unknown): WorkoutPersistContext {
  if (!isRecord(value) || !isRecord(value.session))
    error(500, "The workout save context could not be read.");
  const programId = value.programId;
  const programVersion = value.programVersion;
  const effortReporting = value.effortReporting;
  const effortFamiliarity = value.effortFamiliarity;
  const units = value.units;
  const session = value.session;
  if (
    typeof programId !== "string" ||
    !Number.isInteger(programVersion) ||
    typeof session.id !== "string" ||
    !Number.isInteger(session.weekNumber) ||
    !Number.isInteger(session.sequence) ||
    !Array.isArray(session.exercises) ||
    !["rpe", "rir", "verbal", "auto"].includes(String(effortReporting)) ||
    !["none", "basic", "confident"].includes(String(effortFamiliarity)) ||
    (units !== "kg" && units !== "lb")
  )
    error(500, "The workout save context could not be read.");
  return {
    programId,
    programVersion: programVersion as number,
    session: session as unknown as TrainingSession,
    effortMode:
      effortReporting === "auto"
        ? effortFamiliarity === "none"
          ? "verbal"
          : "rir"
        : (effortReporting as "rpe" | "rir" | "verbal"),
    units,
    ...(isRecord(value.movementTarget)
      ? {
          movementTarget:
            value.movementTarget as TrainingSession["movementTarget"],
        }
      : {}),
    ...(typeof value.firstFormalSessionId === "string"
      ? { firstFormalSessionId: value.firstFormalSessionId }
      : {}),
  };
}

async function contextForPersist(
  locals: App.Locals,
  programId: string,
  sessionId: string,
  facilityMode: "primary" | "secondary",
  needsFullProgram: boolean,
  authenticatedUserId?: string,
): Promise<WorkoutPersistContext> {
  if (facilityMode === "secondary" || needsFullProgram)
    return fullPersistContext(
      await context(
        locals,
        programId,
        sessionId,
        facilityMode,
        authenticatedUserId,
      ),
    );

  if (authenticatedUserId === undefined) {
    const {
      data: { user },
    } = await locals.getUser();
    if (!user) redirect(303, "/login");
  }
  const { data, error: queryError } = await locals.supabase.rpc(
    "workout_session_context",
    { p_program_id: programId, p_session_id: sessionId },
  );
  if (queryError) {
    const migrationMissing = ["42883", "PGRST202"].includes(
      queryError.code ?? "",
    );
    error(
      migrationMissing ? 503 : 500,
      migrationMissing
        ? "Apply the latest Supabase migration before saving this workout."
        : "The workout save context could not be loaded.",
    );
  }
  if (data === null) error(404, "Workout not found.");
  return parsePersistContext(data);
}

async function loadLogs(
  locals: App.Locals,
  workout: WorkoutContext,
): Promise<{ logs: WorkoutLog[]; errorCode?: string }> {
  const { data, error: queryError } = await locals.supabase
    .from("workout_logs")
    .select(
      "id, program_id, program_version, session_id, week_number, session_sequence, status, exercise_logs, cardio_log, movement_log, duration_minutes, miss_reason, started_at, completed_at, updated_at",
    )
    .eq("program_id", workout.programId)
    .lte("week_number", workout.session.weekNumber)
    .order("week_number")
    .order("session_sequence")
    .order("program_version");
  return queryError
    ? { logs: [], errorCode: queryError.code ?? "WORKOUT_LOGGING_UNAVAILABLE" }
    : {
        logs: latestWorkoutLogs(
          (data ?? []).map((row) => parseWorkoutLogRow(row)),
        ),
      };
}

async function workoutReviewState(
  locals: App.Locals,
  programId: string,
  weekNumber: number,
): Promise<{
  historyFrozen: boolean;
  heldTargets: Set<string>;
  reviewedWeeks?: number[];
}> {
  const { data, error: queryError } = await locals.supabase
    .from("weekly_reviews")
    .select(
      "id, program_id, week_number, source_program_version, result_program_version, decision, state, confidence, metrics, result, created_at",
    )
    .eq("program_id", programId)
    .lte("week_number", weekNumber);
  if (queryError) return { historyFrozen: false, heldTargets: new Set() };
  const reviews = (data ?? []).map((row) =>
    parseWeeklyReviewRow(row as WeeklyReviewDatabaseRow),
  );
  return {
    historyFrozen: reviews.some((review) => review.weekNumber === weekNumber),
    heldTargets: heldProgressionTargets(reviews, weekNumber),
    reviewedWeeks: reviews.map((review) => review.weekNumber),
  };
}

function previousLocalDate(value: string | undefined): string {
  const today =
    value !== undefined && /^\d{4}-\d{2}-\d{2}$/u.test(value)
      ? value
      : new Date().toISOString().slice(0, 10);
  const date = new Date(`${today}T12:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) {
    return new Date(Date.now() - 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
  }
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

async function loadWearableDay(
  locals: App.Locals,
  date: string,
  stepGoal: number | undefined,
): Promise<WearableDay | undefined> {
  if (stepGoal === undefined) return undefined;
  const { data: metric, error: metricError } = await locals.supabase
    .from("fitness_daily_metrics")
    .select("connection_id, metric_date, steps, updated_at")
    .eq("metric_date", date)
    .not("steps", "is", null)
    .order("steps", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (metricError || metric?.steps === null || metric === null)
    return undefined;
  const { data: connection } = await locals.supabase
    .from("fitness_connections")
    .select("provider")
    .eq("id", metric.connection_id)
    .maybeSingle();
  return {
    date: metric.metric_date,
    steps: metric.steps,
    stepGoal,
    goalMet: metric.steps >= stepGoal,
    source: connection?.provider ?? null,
    syncedAt: metric.updated_at,
  };
}

export const load: PageServerLoad = async ({
  locals,
  params,
  cookies,
  url,
}) => {
  const {
    data: { user },
  } = await locals.getUser();
  if (!user) redirect(303, "/login");
  const facilityMode =
    url.searchParams.get("gym") === "secondary" ? "secondary" : "primary";
  const workout = await context(
    locals,
    params.id,
    params.sessionId,
    facilityMode,
    user.id,
  );
  rememberRecentProgram(cookies, workout.programId, url.protocol === "https:");
  const [loaded, reviewState] = await Promise.all([
    loadLogs(locals, workout),
    workoutReviewState(locals, workout.programId, workout.session.weekNumber),
  ]);
  const reviewDue =
    loaded.errorCode === undefined && reviewState.reviewedWeeks !== undefined
      ? nextWeeklyReview(
          workout.draft.program,
          loaded.logs,
          reviewState.reviewedWeeks,
        )
      : undefined;
  if (reviewDue !== undefined && workout.session.weekNumber > reviewDue) {
    redirect(303, `/programs/${workout.programId}/reviews/${reviewDue}`);
  }
  const existing = loaded.logs.find(
    (log) => log.sessionId === workout.session.id,
  );
  const formalSessions = workout.draft.program.weeks.flatMap((week) =>
    week.sessions.filter((session) => session.kind !== "movement"),
  );
  const firstFormalSessionId = formalSessions[0]?.id;
  const movementTarget = workout.draft.program.weeks
    .find((week) => week.weekNumber === workout.session.weekNumber)
    ?.sessions.find((session) => session.kind === "movement")?.movementTarget;
  const wearableDay = await loadWearableDay(
    locals,
    previousLocalDate(cookies.get("orbital-local-date")),
    movementTarget?.steps,
  );
  const requiresMovementCheckIn =
    workout.session.id !== firstFormalSessionId &&
    existing?.movementLog === undefined;
  const reporting = workout.draft.inputSnapshot.history.effortReporting;
  const { historyFrozen, heldTargets } = reviewState;
  const effortMode =
    reporting === "auto"
      ? workout.draft.inputSnapshot.history.effortFamiliarity === "none"
        ? "verbal"
        : "rir"
      : reporting;

  const exerciseViews = workout.session.exercises.map((prescription) => {
    const logged = existing?.exerciseLogs.find(
      (item) => item.prescriptionId === prescription.id,
    );
    const loggedDefinition = getExercise(logged?.exerciseId ?? "");
    if (
      loggedDefinition !== undefined &&
      loggedDefinition.id !== prescription.exerciseId &&
      !prescription.alternativeChoices.some(
        (choice) => choice.exerciseId === loggedDefinition.id,
      )
    ) {
      prescription.alternativeChoices.push({
        exerciseId: loggedDefinition.id,
        name: loggedDefinition.name,
        score: 100,
        tradeoff:
          "Previously used for this workout; it keeps a separate weight history.",
      });
    }
    const recommendationInputs = [
      {
        exerciseId: prescription.exerciseId,
        performanceSeriesId: prescription.performanceSeriesId,
        load: prescription.load,
      },
      ...prescription.alternativeChoices.map((alternative) => ({
        exerciseId: alternative.exerciseId,
        performanceSeriesId:
          logged?.exerciseId === alternative.exerciseId
            ? logged.performanceSeriesId
            : `${alternative.exerciseId}:substitution`,
        load: undefined,
      })),
      ...(logged !== undefined &&
      logged.exerciseId !== prescription.exerciseId &&
      !prescription.alternativeChoices.some(
        (choice) => choice.exerciseId === logged.exerciseId,
      )
        ? [
            {
              exerciseId: logged.exerciseId,
              performanceSeriesId: logged.performanceSeriesId,
              load: undefined,
            },
          ]
        : []),
    ];
    const lift = getExercise(prescription.exerciseId)?.lift;
    const baselineEstimatedMax =
      lift === undefined
        ? undefined
        : workout.draft.program.baselines.find(
            (baseline) => baseline.lift === lift,
          )?.e1rm;
    return {
      prescription,
      baselineEstimatedMax,
      addedBodyweightLoads: Object.fromEntries(
        recommendationInputs.map((item) => [
          item.exerciseId,
          usesAddedBodyweightLoad(item.exerciseId),
        ]),
      ),
      recommendations: Object.fromEntries(
        recommendationInputs.map((item) => [
          item.exerciseId,
          loadRecommendation(
            { ...prescription, ...item },
            workout.draft.program,
            loaded.logs,
            workout.session.weekNumber,
            { holdProgression: heldTargets.has(item.exerciseId) },
          ),
        ]),
      ),
      logged,
    };
  });
  const exerciseViewById = new Map(
    exerciseViews.map((view) => [view.prescription.id, view]),
  );
  const setBlockViews = sessionSetBlocks(workout.session).map((block) => ({
    block,
    exercises: block.sequence.flatMap((item) => {
      const view = exerciseViewById.get(item.prescriptionId);
      return view === undefined ? [] : [{ ...item, view }];
    }),
  }));

  return {
    program: { id: workout.programId, name: workout.programName },
    session: workout.session,
    label: sessionLabel(
      workout.session,
      workout.draft.inputSnapshot.schedule.planningStyle,
    ),
    units: workout.draft.program.loadSettings.units,
    effortMode,
    loggingReady: loaded.errorCode === undefined,
    loggingErrorCode: loaded.errorCode,
    existing,
    expectedRevision: existing?.updatedAt ?? "new",
    movementTarget,
    wearableDay,
    cardioTracking: {
      availableModalities: availableCardioModalities(
        workout.draft.inputSnapshot,
        workout.facilityMode,
      ),
      runningEvent:
        workout.draft.inputSnapshot.cardio.goal?.type === "running_event",
      distanceUnit:
        workout.draft.program.loadSettings.units === "kg" ? "km" : "mi",
      elevationUnit:
        workout.draft.program.loadSettings.units === "kg" ? "m" : "ft",
      surface:
        workout.draft.inputSnapshot.cardio.goal?.runningEvent?.surface ?? "",
      hasHeartRateDevice:
        workout.draft.inputSnapshot.cardio.heartRateDevice !== "none",
    },
    requiresMovementCheckIn,
    facilityMode: workout.facilityMode,
    facilityVariant: workout.facilityVariant,
    hasAlternateGym:
      (workout.draft.inputSnapshot.facility.alternateEquipment?.length ?? 0) >
      0,
    historyFrozen,
    exerciseViews,
    setBlockViews,
  };
};

function optionalNumber(
  formData: FormData,
  key: string,
  minimum: number,
  maximum: number,
): number | undefined {
  const raw = String(formData.get(key) ?? "").trim();
  if (raw === "") return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`Check the value entered for ${key}.`);
  }
  return value;
}

function formChoice<T extends string>(
  formData: FormData,
  key: string,
  choices: readonly T[],
  fallback: T,
): T {
  const value = String(formData.get(key) ?? "");
  return choices.includes(value as T) ? (value as T) : fallback;
}

function optionalText(formData: FormData, key: string): string | undefined {
  const value = String(formData.get(key) ?? "").trim();
  return value === "" ? undefined : value.slice(0, 120);
}

function selectedExercise(
  formData: FormData,
  prescription: ExercisePrescription,
): {
  id: string;
  name: string;
  performanceSeriesId: string;
} {
  const selected = String(
    formData.get(`exercise.${prescription.id}.choice`) ??
      prescription.exerciseId,
  );
  if (selected === prescription.exerciseId) {
    return {
      id: selected,
      name: prescription.name,
      performanceSeriesId: prescription.performanceSeriesId,
    };
  }
  const alternative = prescription.alternativeChoices.find(
    (choice) => choice.exerciseId === selected,
  );
  const knownExercise = getExercise(selected);
  if (!alternative && knownExercise === undefined)
    throw new Error("Select one of the available exercises.");
  const permanent =
    String(formData.get(`exercise.${prescription.id}.scope`) ?? "today") ===
    "permanent";
  return {
    id: selected,
    name: knownExercise?.name ?? alternative?.name ?? "Replacement exercise",
    performanceSeriesId: `${selected}:${permanent ? "permanent-substitution" : "substitution"}`,
  };
}

function exerciseLogsFromForm(
  formData: FormData,
  prescriptions: ExercisePrescription[],
  setBlocks: SetBlock[],
  effortMode: "rpe" | "rir" | "verbal",
  validateCompletedSets: boolean,
): LoggedExercise[] {
  return prescriptions.flatMap((prescription) => {
    const setBlock = setBlocks.find((block) =>
      block.sequence.some((item) => item.prescriptionId === prescription.id),
    );
    const requestedBlockMode =
      setBlock?.type === "paired_superset"
        ? String(formData.get(`block.${setBlock.id}.mode`) ?? "paired")
        : "unpaired";
    const setBlockMode =
      requestedBlockMode === "unpaired" ? "unpaired" : "paired";
    const selected = selectedExercise(formData, prescription);
    const techniqueOkay =
      String(formData.get(`exercise.${prescription.id}.technique`) ?? "yes") !==
      "no";
    const pain =
      String(formData.get(`exercise.${prescription.id}.pain`) ?? "no") ===
      "yes";
    const painPrefix = `exercise.${prescription.id}.painEvent`;
    const painSeverity = pain
      ? optionalNumber(formData, `${painPrefix}.severity`, 0, 10)
      : undefined;
    const painBodyArea = pain
      ? optionalText(formData, `${painPrefix}.bodyArea`)
      : undefined;
    const painEvent: PainEvent | undefined = pain
      ? {
          impact: formChoice<PainImpact>(
            formData,
            `${painPrefix}.impact`,
            ["noticed", "modified", "stopped_exercise", "stopped_workout"],
            "modified",
          ),
          ...(painSeverity === undefined ? {} : { severity: painSeverity }),
          onset: formChoice<PainOnset>(
            formData,
            `${painPrefix}.onset`,
            ["gradual", "sudden", "accident", "unsure"],
            "unsure",
          ),
          baseline: formChoice<PainBaseline>(
            formData,
            `${painPrefix}.baseline`,
            ["new", "familiar", "familiar_worse", "unsure"],
            "unsure",
          ),
          followUp: formChoice<PainFollowUp>(
            formData,
            `${painPrefix}.followUp`,
            [
              "not_checked",
              "normal",
              "better",
              "same",
              "worse",
              "affects_daily_life",
            ],
            "not_checked",
          ),
          ...(painBodyArea === undefined ? {} : { bodyArea: painBodyArea }),
          ...(formData.has(`${painPrefix}.urgentWarningSigns`)
            ? { urgentWarningSigns: true }
            : {}),
        }
      : undefined;
    const reasonValue = formData.get(`exercise.${prescription.id}.missReason`);
    const missReason = isMissReason(reasonValue)
      ? reasonValue
      : painEvent?.impact === "stopped_exercise" ||
          painEvent?.impact === "stopped_workout"
        ? "pain"
        : undefined;
    const sets: LoggedSet[] = Array.from(
      { length: prescription.sets },
      (_, index): LoggedSet | undefined => {
        const prefix = `exercise.${prescription.id}.set.${index + 1}`;
        const reps = optionalNumber(formData, `${prefix}.reps`, 0, 100);
        const load = optionalNumber(formData, `${prefix}.load`, 0, 5000);
        const checked = formData.has(`${prefix}.completed`);
        const completed = checked;
        const touched = isWorkoutSetTouched(formData, prefix, completed);
        const rpe =
          effortMode === "rpe"
            ? optionalNumber(formData, `${prefix}.rpe`, 1, 10)
            : undefined;
        const rir =
          effortMode === "rir"
            ? optionalNumber(formData, `${prefix}.rir`, 0, 12)
            : undefined;
        const difficultyRaw = String(
          formData.get(`${prefix}.difficulty`) ?? "",
        );
        const difficulty = [
          "easy",
          "medium",
          "difficult",
          "impossible",
        ].includes(difficultyRaw)
          ? (difficultyRaw as VerbalEffort)
          : undefined;
        if (
          validateCompletedSets &&
          completed &&
          (reps === undefined ||
            (effortMode === "rpe" && rpe === undefined) ||
            (effortMode === "rir" && rir === undefined) ||
            (effortMode === "verbal" && difficulty === undefined))
        ) {
          throw new Error(
            `Enter reps and effort for completed ${prescription.name} sets.`,
          );
        }
        if (!touched) return undefined;
        return {
          setNumber: index + 1,
          ...(reps === undefined ? {} : { reps }),
          ...(load === undefined ? {} : { load }),
          ...(rir === undefined ? {} : { rir }),
          ...(rpe === undefined ? {} : { rpe }),
          ...(difficulty === undefined ? {} : { difficulty }),
          completed,
          ...(completed ? { techniqueOkay, pain } : {}),
        };
      },
    ).filter((set): set is LoggedSet => set !== undefined);
    const changedExercise = selected.id !== prescription.exerciseId;
    const changedBlockMode =
      setBlock?.type === "paired_superset" && setBlockMode === "unpaired";
    if (
      !shouldPersistWorkoutExercise({
        touchedSetCount: sets.length,
        changedExercise,
        changedBlockMode,
        hasMissReason: missReason !== undefined,
        hasPainEvent: painEvent !== undefined,
      })
    )
      return [];
    return [
      {
        prescriptionId: prescription.id,
        prescribedExerciseId: prescription.exerciseId,
        exerciseId: selected.id,
        exerciseName: selected.name,
        performanceSeriesId: selected.performanceSeriesId,
        prescriptionContext: {
          purpose: prescription.purpose,
          ...(prescription.phase === undefined
            ? {}
            : { phase: prescription.phase }),
          ...(prescription.contextRole === undefined
            ? {}
            : { contextRole: prescription.contextRole }),
          reps: { ...prescription.reps },
          targetRir: { ...prescription.targetRir },
          ...(!changedExercise && prescription.load !== undefined
            ? { load: prescription.load }
            : {}),
          ...(!changedExercise && prescription.percentE1rm !== undefined
            ? { percentE1rm: prescription.percentE1rm }
            : {}),
        },
        ...(setBlock === undefined ? {} : { setBlockId: setBlock.id }),
        ...(setBlock?.type === "paired_superset" ? { setBlockMode } : {}),
        sets,
        ...(missReason === undefined ? {} : { missReason }),
        ...(painEvent === undefined ? {} : { painEvent }),
      },
    ];
  });
}

function allRequiredWorkComplete(
  prescriptions: ExercisePrescription[],
  logs: LoggedExercise[],
): boolean {
  return prescriptions
    .filter((prescription) => !prescription.optional)
    .every((prescription) => {
      const log = logs.find(
        (candidate) => candidate.prescriptionId === prescription.id,
      );
      return (
        log !== undefined &&
        log.sets.length >= prescription.sets &&
        log.sets.slice(0, prescription.sets).every((set) => set.completed)
      );
    });
}

async function persist(
  locals: App.Locals,
  params: { id: string; sessionId: string },
  request: Request,
  intent: "save" | "complete" | "skip",
) {
  const {
    data: { user },
  } = await locals.getUser();
  if (!user) redirect(303, "/login");

  const saveKey = `${user.id}:${params.id}:${params.sessionId}`;
  const saveLimit = checkWorkoutSaveLimit(saveKey);
  if (!saveLimit.allowed) {
    return fail(429, {
      message: `Too many workout saves arrived together. Wait ${saveLimit.retryAfterSeconds ?? 60} seconds, then reload this workout before trying again.`,
      conflict: true,
      conflictReason: "rate_limited",
      retryAfterSeconds: saveLimit.retryAfterSeconds ?? 60,
    });
  }

  const admission = acquireWorkoutSaveSlot(saveKey);
  if (admission === undefined) {
    return fail(409, {
      message:
        "Another save for this workout is already being processed. Wait for it to finish, then reload if your latest entry is not shown.",
      conflict: true,
      conflictReason: "save_in_progress",
      retryAfterSeconds: 1,
    });
  }

  try {
    return await persistAdmitted(locals, params, request, intent, user.id);
  } finally {
    admission.release();
  }
}

async function persistAdmitted(
  locals: App.Locals,
  params: { id: string; sessionId: string },
  request: Request,
  intent: "save" | "complete" | "skip",
  authenticatedUserId: string,
) {
  const formData = await request.formData();
  const facilityMode =
    String(formData.get("facilityMode") ?? "primary") === "secondary"
      ? "secondary"
      : "primary";
  // Old pages did not mark background requests. During a rolling deployment,
  // only a newly marked explicit Save (or a Finish action) may mutate the
  // program. Autosave still records today's selected replacement.
  const submissionMode = String(formData.get("submissionMode") ?? "legacy");
  const mayApplyPermanentSubstitution =
    intent !== "save" || submissionMode === "explicit";
  const needsFullProgram =
    mayApplyPermanentSubstitution &&
    [...formData.entries()].some(
      ([name, value]) => name.endsWith(".scope") && value === "permanent",
    );
  let workout = await contextForPersist(
    locals,
    params.id,
    params.sessionId,
    facilityMode,
    needsFullProgram,
    authenticatedUserId,
  );
  const effortMode = workout.effortMode;
  let exerciseLogs: LoggedExercise[];
  let durationMinutes: number | undefined;
  let cardioLog: LoggedCardio;
  let movementLog: LoggedMovement | undefined;
  let missReason: WorkoutLog["missReason"];
  let permanentSubstitutions: PermanentSubstitutionRequest[];
  try {
    const selectedModality = formData.get("cardio.modality");
    const originalModality = workout.session.cardio?.modality;
    let actualModality = originalModality;
    const savedCardioModality = async () => {
      const { data: previous, error: previousError } = await locals.supabase
        .from("workout_logs")
        .select("cardio_log")
        .eq("program_id", params.id)
        .eq("session_id", params.sessionId)
        .order("program_version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (previousError)
        throw new Error(
          "The saved cardio activity could not be checked. Reload and try again.",
        );
      const prior = isRecord(previous?.cardio_log)
        ? previous.cardio_log.modality
        : undefined;
      return isCardioModality(prior) ? prior : undefined;
    };
    if (selectedModality !== null && selectedModality !== "") {
      if (originalModality === undefined || !isCardioModality(selectedModality))
        throw new Error("Choose a valid cardio activity for this workout.");
      actualModality = selectedModality;
      if (actualModality !== originalModality) {
        // The lean RPC context intentionally omits questionnaire preferences.
        // Only a requested change needs the authoritative full snapshot.
        if (workout.draft === undefined)
          workout = fullPersistContext(
            await context(
              locals,
              params.id,
              params.sessionId,
              facilityMode,
              authenticatedUserId,
            ),
          );
        const available = availableCardioModalities(
          workout.draft!.inputSnapshot,
          facilityMode,
        );
        if (!available.includes(actualModality)) {
          // A stored alternate remains editable after preferences/equipment
          // change. This exception comes from the user's row, never the form.
          const priorModality = await savedCardioModality();
          if (priorModality !== actualModality)
            throw new Error(
              "That cardio activity is not among your available options at this facility. Choose one of the listed activities.",
            );
        }
      }
    } else if (originalModality !== undefined) {
      // An older open page cannot explicitly choose an activity. Preserve a
      // stored alternate instead of silently relabelling its measurements.
      actualModality = (await savedCardioModality()) ?? originalModality;
    }
    exerciseLogs = exerciseLogsFromForm(
      formData,
      workout.session.exercises,
      sessionSetBlocks(workout.session),
      effortMode,
      intent !== "skip",
    );
    durationMinutes = optionalNumber(formData, "durationMinutes", 0, 1440);
    const completedMinutes = optionalNumber(
      formData,
      "cardio.completedMinutes",
      0,
      1440,
    );
    const sessionRpe = optionalNumber(formData, "cardio.sessionRpe", 1, 10);
    const distance = optionalNumber(formData, "cardio.distance", 0, 1000);
    const steps = optionalNumber(formData, "cardio.steps", 0, 250000);
    const movingMinutes = optionalNumber(
      formData,
      "cardio.movingMinutes",
      0,
      1440,
    );
    const completedIntervals = optionalNumber(
      formData,
      "cardio.completedIntervals",
      0,
      1000,
    );
    const averageHeartRate = optionalNumber(
      formData,
      "cardio.averageHeartRate",
      25,
      240,
    );
    const maxHeartRate = optionalNumber(
      formData,
      "cardio.maxHeartRate",
      25,
      250,
    );
    if (
      averageHeartRate !== undefined &&
      maxHeartRate !== undefined &&
      maxHeartRate < averageHeartRate
    )
      throw new Error("Maximum heart rate cannot be below average heart rate.");
    const elevationGain = optionalNumber(
      formData,
      "cardio.elevationGain",
      0,
      100000,
    );
    const surfaceRaw = String(formData.get("cardio.surface") ?? "");
    const sourceRaw = String(formData.get("cardio.source") ?? "manual");
    const surface = [
      "road",
      "track",
      "trail",
      "treadmill",
      "mixed",
      "other",
    ].includes(surfaceRaw)
      ? (surfaceRaw as NonNullable<LoggedCardio["surface"]>)
      : undefined;
    const source = ["manual", "watch", "treadmill", "bike", "other"].includes(
      sourceRaw,
    )
      ? (sourceRaw as NonNullable<LoggedCardio["source"]>)
      : "manual";
    cardioLog = {
      ...(actualModality === undefined
        ? {}
        : { modality: actualModality, prescribedModality: originalModality }),
      ...(completedMinutes === undefined ? {} : { completedMinutes }),
      ...(movingMinutes === undefined ? {} : { movingMinutes }),
      ...(sessionRpe === undefined ? {} : { sessionRpe }),
      ...(distance === undefined ? {} : { distance }),
      ...(distance === undefined
        ? {}
        : {
            distanceUnit:
              workout.units === "kg" ? ("km" as const) : ("mi" as const),
          }),
      ...(steps === undefined ? {} : { steps: Math.round(steps) }),
      ...(completedIntervals === undefined
        ? {}
        : { completedIntervals: Math.round(completedIntervals) }),
      ...(averageHeartRate === undefined ? {} : { averageHeartRate }),
      ...(maxHeartRate === undefined ? {} : { maxHeartRate }),
      ...(elevationGain === undefined ? {} : { elevationGain }),
      ...(elevationGain === undefined
        ? {}
        : {
            elevationUnit:
              workout.units === "kg" ? ("m" as const) : ("ft" as const),
          }),
      ...(surface === undefined ? {} : { surface }),
      source,
    };
    const movementTarget = workout.movementTarget;
    const firstFormalSessionId = workout.firstFormalSessionId;
    const movementAnswer = String(formData.get("movement.answer") ?? "");
    if (
      intent !== "save" &&
      workout.session.id !== firstFormalSessionId &&
      movementTarget !== undefined &&
      !["yes", "no", "untracked"].includes(movementAnswer)
    ) {
      throw new Error(
        "Answer the quick daily-movement check-in before saving this workout.",
      );
    }
    const actualSteps = optionalNumber(
      formData,
      "movement.actualSteps",
      0,
      250000,
    );
    const actualWalkingMinutes = optionalNumber(
      formData,
      "movement.actualWalkingMinutes",
      0,
      1440,
    );
    if (movementTarget !== undefined && movementAnswer !== "") {
      const targetType =
        movementTarget.steps !== undefined
          ? ("steps" as const)
          : ("walking_minutes" as const);
      const target = movementTarget.steps ?? movementTarget.walkingMinutes ?? 0;
      movementLog = {
        targetType,
        target,
        ...(movementAnswer === "untracked"
          ? {}
          : { met: movementAnswer === "yes" }),
        ...(actualSteps === undefined
          ? {}
          : { actualSteps: Math.round(actualSteps) }),
        ...(actualWalkingMinutes === undefined
          ? {}
          : { actualWalkingMinutes: Math.round(actualWalkingMinutes) }),
        checkInDate: new Date().toISOString().slice(0, 10),
      };
    }
    if (
      durationMinutes === undefined &&
      workout.session.exercises.length === 0 &&
      workout.session.cardio !== undefined
    ) {
      durationMinutes = completedMinutes;
    }
    const reasonValue = formData.get("missReason");
    missReason = isMissReason(reasonValue) ? reasonValue : undefined;
    permanentSubstitutions = mayApplyPermanentSubstitution
      ? workout.session.exercises.flatMap((prescription) => {
          const selected = selectedExercise(formData, prescription);
          const scope = String(
            formData.get(`exercise.${prescription.id}.scope`) ?? "today",
          );
          return scope === "permanent" &&
            selected.id !== prescription.exerciseId
            ? [
                {
                  originalExerciseId: prescription.exerciseId,
                  replacementExerciseId: selected.id,
                },
              ]
            : [];
        })
      : [];
  } catch (caughtError) {
    return fail(400, {
      message:
        caughtError instanceof Error
          ? caughtError.message
          : "The workout log could not be read.",
    });
  }

  let status: WorkoutStatus = "in_progress";
  if (intent === "skip") status = "skipped";
  if (intent === "complete") {
    const liftingComplete = allRequiredWorkComplete(
      workout.session.exercises,
      exerciseLogs,
    );
    const cardioComplete =
      workout.session.cardio === undefined ||
      ((cardioLog.completedMinutes ?? 0) >=
        Math.max(1, workout.session.cardio.minutes * 0.8) &&
        (workout.session.cardio.intervals === undefined ||
          (cardioLog.completedIntervals ?? 0) >=
            workout.session.cardio.intervals.repeats));
    status = liftingComplete && cardioComplete ? "completed" : "partial";
  }

  if (
    (status === "partial" || status === "skipped") &&
    missReason === undefined
  ) {
    return fail(400, {
      message:
        "Choose the main reason this workout was unfinished so next week's plan can respond correctly.",
    });
  }

  let newPayload: ProgramDraftV3 | undefined;
  if (permanentSubstitutions.length > 0 && intent !== "skip") {
    if (workout.draft === undefined)
      error(500, "The program could not be prepared for substitution.");
    const substituted = applyPermanentExerciseSubstitutions(
      workout.draft.program,
      permanentSubstitutions,
      workout.session.weekNumber,
      workout.session.sequence,
      workout.draft.inputSnapshot,
    );
    if (substituted.changedPrescriptionCount > 0) {
      newPayload = {
        ...workout.draft,
        engineVersion: substituted.program.engineVersion,
        policyVersion: substituted.program.policyVersion,
        program: substituted.program,
      };
    }
  }
  const reversePatch =
    newPayload === undefined || workout.draft === undefined
      ? null
      : programReversePatchForWrite(workout.draft, newPayload);

  try {
    assertWorkoutWriteSizes({
      exerciseLogs,
      cardioLog,
      movementLog: movementLog ?? {},
      ...(newPayload === undefined ? {} : { newProgramPayload: newPayload }),
      ...(reversePatch === null ? {} : { reversePatch }),
    });
  } catch (caughtError) {
    if (caughtError instanceof PersistenceLimitError) {
      return fail(413, {
        message:
          "This workout contains more saved detail than the app can safely store. Reload the page and try again; if it continues, send a beta report.",
      });
    }
    throw caughtError;
  }

  const expectedRevision = String(
    formData.get("expectedRevision") ?? "new",
  ).slice(0, 64);
  const { data: saveData, error: saveError } = await locals.supabase.rpc(
    "save_workout_log_v6",
    {
      p_program_id: workout.programId,
      p_program_version: workout.programVersion,
      p_session_id: workout.session.id,
      p_week_number: workout.session.weekNumber,
      p_session_sequence: workout.session.sequence,
      p_status: status,
      p_exercise_logs: exerciseLogs as unknown as Json,
      p_cardio_log: cardioLog as unknown as Json,
      p_movement_log: (movementLog ?? {}) as unknown as Json,
      p_duration_minutes: durationMinutes,
      p_miss_reason: missReason,
      p_new_program_payload:
        (newPayload as unknown as Json | undefined) ?? null,
      p_reverse_patch: (reversePatch as unknown as Json | null) ?? null,
      p_expected_revision: expectedRevision,
    },
  );
  if (saveError) {
    console.error("Unable to save workout:", { code: saveError.code });
    const migrationMissing = [
      "42P01",
      "42883",
      "PGRST202",
      "PGRST205",
    ].includes(saveError.code ?? "");
    const reviewedHistory = saveError.code === "55000";
    const revisionConflict = saveError.code === "40001";
    return fail(
      migrationMissing ? 503 : reviewedHistory || revisionConflict ? 409 : 500,
      {
        message: migrationMissing
          ? "Apply the latest Supabase migrations, then reload this page."
          : revisionConflict
            ? "This workout changed in another tab or device. Reload before saving so newer entries are not overwritten."
            : reviewedHistory
              ? "This week has already been reviewed, so its workout history cannot be changed."
              : "The workout could not be saved. Your program was not changed.",
      },
    );
  }

  const saved = isRecord(saveData) ? saveData : {};
  if (saved.ok === false || typeof saved.conflict === "string") {
    const conflictReason =
      typeof saved.conflict === "string" ? saved.conflict : "workout_revision";
    const retryAfterSeconds =
      typeof saved.retryAfterSeconds === "number" &&
      Number.isFinite(saved.retryAfterSeconds)
        ? Math.max(1, Math.ceil(saved.retryAfterSeconds))
        : undefined;
    const currentRevision =
      typeof saved.currentRevision === "string" &&
      saved.currentRevision.trim() !== ""
        ? saved.currentRevision
        : undefined;
    const currentProgramVersion =
      typeof saved.currentProgramVersion === "number" &&
      Number.isInteger(saved.currentProgramVersion)
        ? saved.currentProgramVersion
        : undefined;
    const message =
      conflictReason === "save_in_progress"
        ? "Another save for this workout is already being processed. Reload before trying again so the latest entry is not overwritten."
        : conflictReason === "program_revision"
          ? "Your program changed while this workout was saving. Reload this workout before trying again."
          : "This workout changed in another tab or request. Reload before saving so newer entries are not overwritten.";
    return fail(409, {
      message,
      conflict: true,
      conflictReason,
      ...(currentRevision === undefined ? {} : { currentRevision }),
      ...(currentProgramVersion === undefined ? {} : { currentProgramVersion }),
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    });
  }

  if (intent === "complete" || intent === "skip") {
    redirect(303, `/programs/${workout.programId}/workout`);
  }
  if (newPayload !== undefined) {
    redirect(
      303,
      `/programs/${workout.programId}/workouts/${workout.session.id}`,
    );
  }
  return {
    message: "Workout saved.",
    updatedAt:
      typeof saved.updatedAt === "string" ? saved.updatedAt : expectedRevision,
  };
}

export const actions: Actions = {
  save: ({ locals, params, request }) =>
    persist(locals, params, request, "save"),
  complete: ({ locals, params, request }) =>
    persist(locals, params, request, "complete"),
  skip: ({ locals, params, request }) =>
    persist(locals, params, request, "skip"),
};
