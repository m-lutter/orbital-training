import { getExercise } from "$lib/domain";
import type {
  AdaptationResult,
  DayOfWeek,
  GoalDomain,
  QuestionnaireInput,
  TrainingProgram,
  WeeklyState,
} from "$lib/domain";
import {
  latestWorkoutLogs,
  type LoggedExercise,
  type WorkoutLog,
} from "$lib/workouts";
import type {
  ReviewChart,
  ReviewDayBreakdown,
  ReviewExerciseBreakdown,
  ReviewItemStatus,
  ReviewMessage,
  ReviewSessionBreakdown,
  ReviewStatusMark,
  WeeklyReviewMetrics,
} from "./types";
import { scheduledProgramWeekDates } from "$lib/program-dates";

const DAYS: Array<{ key: DayOfWeek; label: string }> = [
  { key: "monday", label: "Monday" },
  { key: "tuesday", label: "Tuesday" },
  { key: "wednesday", label: "Wednesday" },
  { key: "thursday", label: "Thursday" },
  { key: "friday", label: "Friday" },
  { key: "saturday", label: "Saturday" },
  { key: "sunday", label: "Sunday" },
];

function loggedEffort(exercise: LoggedExercise): number[] {
  return exercise.sets.flatMap((set) => {
    if (!set.completed) return [];
    if (set.rir !== undefined) return [set.rir];
    if (set.rpe !== undefined) return [10 - set.rpe];
    if (set.difficulty === "easy") return [4];
    if (set.difficulty === "medium") return [2.5];
    if (set.difficulty === "difficult") return [1];
    if (set.difficulty === "impossible") return [0];
    return [];
  });
}

function exerciseStatus(
  planned: TrainingProgram["weeks"][number]["sessions"][number]["exercises"][number],
  logged: LoggedExercise | undefined,
): ReviewItemStatus {
  if (logged === undefined) return "skipped";
  const completed = logged.sets.filter((set) => set.completed);
  const discontinuedForPain =
    ["stopped_exercise", "stopped_workout"].includes(
      String(logged.painEvent?.impact),
    ) ||
    (completed.length < planned.sets &&
      (logged.missReason === "pain" ||
        logged.sets.some((set) => set.pain === true)));
  if (discontinuedForPain) return "pain";
  if (completed.length === 0) return "skipped";
  if (completed.length < planned.sets) return "partial";
  const targetReps = Math.round((planned.reps.min + planned.reps.max) / 2);
  const efforts = loggedEffort(logged);
  const easierThanPlanned =
    efforts.length > 0 &&
    efforts.every((effort) => effort >= planned.targetRir.max + 1);
  const extraReps = completed.some((set) => (set.reps ?? 0) > targetReps);
  return easierThanPlanned || extraReps ? "overperformed" : "completed";
}

function overallStatus(statuses: ReviewItemStatus[]): ReviewItemStatus {
  if (statuses.length === 0) return "not_planned";
  if (statuses.includes("pain")) return "pain";
  if (statuses.every((status) => status === "skipped")) return "skipped";
  if (statuses.includes("partial") || statuses.includes("skipped"))
    return "partial";
  if (statuses.includes("overperformed")) return "overperformed";
  return "completed";
}

/** Builds the seven-day program block from its chosen start date. */
export function weeklyBreakdown(
  program: TrainingProgram,
  logs: WorkoutLog[],
  weekNumber: number,
  startDate?: QuestionnaireInput["goals"]["startDate"],
): ReviewDayBreakdown[] {
  const week = program.weeks.find((item) => item.weekNumber === weekNumber);
  if (week === undefined) return [];
  const latest = new Map(
    latestWorkoutLogs(logs).map((log) => [log.sessionId, log]),
  );
  const byDay = new Map<
    DayOfWeek | `day-${number}`,
    ReviewSessionBreakdown[]
  >();

  for (const session of week.sessions.filter(
    (item) => item.kind !== "movement",
  )) {
    const log = latest.get(session.id);
    const exercises: ReviewExerciseBreakdown[] = session.exercises.map(
      (planned) => {
        const logged = log?.exerciseLogs.find(
          (item) => item.prescriptionId === planned.id,
        );
        return {
          id: planned.id,
          name: logged?.exerciseName ?? planned.name,
          role: planned.optional ? "accessory" : "primary",
          status: exerciseStatus(planned, logged),
          completedSets:
            logged?.sets.filter((set) => set.completed).length ?? 0,
          plannedSets: planned.sets,
        };
      },
    );
    const cardio =
      session.cardio === undefined
        ? undefined
        : {
            name: `${(log?.cardioLog?.modality ?? session.cardio.modality).replaceAll("_", " ")} cardio`,
            status:
              log === undefined || (log.cardioLog?.completedMinutes ?? 0) === 0
                ? ("skipped" as const)
                : (log.cardioLog?.completedMinutes ?? 0) <
                    session.cardio.minutes
                  ? ("partial" as const)
                  : (log.cardioLog?.completedMinutes ?? 0) >
                      session.cardio.minutes * 1.05
                    ? ("overperformed" as const)
                    : ("completed" as const),
            completedMinutes: log?.cardioLog?.completedMinutes ?? 0,
            plannedMinutes: session.cardio.minutes,
            ...(log?.cardioLog?.distance === undefined
              ? {}
              : { distance: log.cardioLog.distance }),
            ...(log?.cardioLog?.distanceUnit === undefined
              ? {}
              : { distanceUnit: log.cardioLog.distanceUnit }),
            ...(log?.cardioLog?.steps === undefined
              ? {}
              : { steps: log.cardioLog.steps }),
            ...(log?.cardioLog?.movingMinutes === undefined
              ? {}
              : { movingMinutes: log.cardioLog.movingMinutes }),
            ...(log?.cardioLog?.completedIntervals === undefined
              ? {}
              : { completedIntervals: log.cardioLog.completedIntervals }),
            ...(session.cardio.intervals === undefined
              ? {}
              : { plannedIntervals: session.cardio.intervals.repeats }),
            ...(log?.cardioLog?.averageHeartRate === undefined
              ? {}
              : { averageHeartRate: log.cardioLog.averageHeartRate }),
          };
    const statuses = [
      ...exercises.map((exercise) => exercise.status),
      ...(cardio === undefined ? [] : [cardio.status]),
    ];
    const emptySessionStatus: ReviewItemStatus =
      log?.status === "completed"
        ? "completed"
        : log?.status === "partial"
          ? "partial"
          : log?.status === "skipped"
            ? "skipped"
            : "not_planned";
    const sessionView: ReviewSessionBreakdown = {
      id: session.id,
      title: session.title,
      kind: session.kind as ReviewSessionBreakdown["kind"],
      status:
        statuses.length === 0 ? emptySessionStatus : overallStatus(statuses),
      exercises,
      ...(cardio === undefined ? {} : { cardio }),
    };
    const key = session.day ?? (`day-${session.sequence}` as const);
    byDay.set(key, [...(byDay.get(key) ?? []), sessionView]);
  }

  const calendarDays = (
    startDate === undefined
      ? DAYS
      : scheduledProgramWeekDates(program, startDate, weekNumber).map(
          ({ day, isoDate }) => ({
            key: day,
            label: DAYS.find((item) => item.key === day)?.label ?? day,
            isoDate,
          }),
        )
  ).map(({ key, label, ...date }) => ({
    key,
    label,
    ...date,
    sessions: byDay.get(key) ?? [],
  }));
  const flexibleDays = [...byDay.entries()]
    .filter(([key]) => String(key).startsWith("day-"))
    .sort(([left], [right]) => String(left).localeCompare(String(right)))
    .map(([key, sessions]) => ({
      key,
      label: `Day ${String(key).replace("day-", "")}`,
      sessions,
    }));
  return flexibleDays.length > 0 ? flexibleDays : calendarDays;
}

/**
 * Flattens a day's sessions into compact status marks. Exercise names and
 * counts remain available to assistive technology without crowding the grid.
 */
export function reviewDayMarks(day: ReviewDayBreakdown): ReviewStatusMark[] {
  return day.sessions.flatMap((session) => {
    const exerciseMarks = session.exercises.map((exercise) => ({
      id: `${session.id}:${exercise.id}`,
      label: `${exercise.role === "primary" ? "Main" : "Accessory"} movement, ${exercise.name}: ${exercise.completedSets} of ${exercise.plannedSets} sets`,
      role:
        exercise.role === "primary"
          ? ("primary" as const)
          : ("secondary" as const),
      status: exercise.status,
    }));
    const cardioMarks: ReviewStatusMark[] =
      session.cardio === undefined
        ? []
        : [
            {
              id: `${session.id}:cardio`,
              label: `Cardio, ${session.cardio.name}: ${session.cardio.completedMinutes} of ${session.cardio.plannedMinutes} minutes`,
              role: "cardio",
              status: session.cardio.status,
            },
          ];
    if (exerciseMarks.length > 0 || cardioMarks.length > 0)
      return [...exerciseMarks, ...cardioMarks];
    return [
      {
        id: `${session.id}:session`,
        label: session.title,
        role: session.kind === "cardio" ? "cardio" : "primary",
        status: session.status,
      },
    ];
  });
}

function headline(state: WeeklyState): ReviewMessage {
  const messages: Record<WeeklyState, ReviewMessage> = {
    on_track: {
      code: "on-track",
      tone: "celebration",
      title: "You nailed the plan this week!",
      body: "You hit the important work at the intended effort. That consistency is exactly how the program earns its progressions.",
    },
    underloaded: {
      code: "underloaded",
      tone: "celebration",
      title: "Crushing it—you beat the target!",
      body: "You exceeded the prescription consistently, so the next progression is moving up to match your performance.",
    },
    physiologically_overloaded: {
      code: "overloaded",
      tone: "encouragement",
      title: "Solid week—one target ran hotter than planned.",
      body: "You put in useful work and logged the effort honestly. The next prescription eases the specific part that overshot so you can keep building.",
    },
    time_infeasible: {
      code: "time",
      tone: "encouragement",
      title: "You kept showing up when time was tight.",
      body: "The next week keeps the most important work and trims the lower-priority piece that was hardest to finish.",
    },
    schedule_infeasible: {
      code: "schedule",
      tone: "encouragement",
      title: "You kept the week moving.",
      body: "Schedule changes happened, but you stayed connected to the plan. Missed work will not be piled onto another day.",
    },
    exercise_mismatch: {
      code: "exercise-fit",
      tone: "encouragement",
      title: "Good feedback—one exercise needs a better fit.",
      body: "The rest of the plan can stay intact while that movement gets a purpose-matched replacement.",
    },
    safety_constrained: {
      code: "legacy-safety",
      tone: "safety",
      title: "Your safety check-in matters.",
      body: "The affected movement is handled separately so one report does not erase the useful work you completed elsewhere.",
    },
    insufficient_data: {
      code: "more-logs",
      tone: "encouragement",
      title: "Good start—keep the receipts coming.",
      body: "The work you logged still counts. Complete and rate a few more prescribed sets next week so the review can make a more confident change.",
    },
  };
  return messages[state];
}

/** One headline plus independent notes, so pain or missed accessories do not erase success. */
export function weeklyReviewMessages(
  metrics: WeeklyReviewMetrics,
  state: WeeklyState,
  result: Pick<AdaptationResult, "confidence" | "safetySignals">,
  days: ReviewDayBreakdown[],
): { headline: ReviewMessage; notes: ReviewMessage[] } {
  const urgent = result.safetySignals.find(
    (signal) => signal.level === "stop_and_seek_care",
  );
  const mainHeadline =
    urgent === undefined
      ? headline(state)
      : {
          code: "urgent-safety",
          tone: "safety" as const,
          title: "Pause that movement before testing it again.",
          body: urgent.message,
        };
  const notes: ReviewMessage[] = [];
  const requiredRate =
    metrics.requiredPlannedSets === 0
      ? undefined
      : metrics.requiredCompletedSets / metrics.requiredPlannedSets;
  if (requiredRate !== undefined && requiredRate >= 0.95) {
    notes.push({
      code: "required-complete",
      tone: "celebration",
      title: "The main work is in the bank",
      body: "You completed the sets that drive this program. Keep trusting the process.",
    });
  }
  if (
    requiredRate !== undefined &&
    requiredRate >= 0.9 &&
    metrics.accessoryPlannedSets > metrics.accessoryCompletedSets
  ) {
    notes.push({
      code: "accessory-missed",
      tone: "neutral",
      title: "Main work handled; a few accessories were left",
      body: "That does not cancel the week. Accessories still matter, but the engine will not treat one missed accessory as if the whole plan failed.",
    });
  }
  if (
    metrics.plannedCardioMinutes > 0 &&
    metrics.completedCardioMinutes >= metrics.plannedCardioMinutes * 0.9
  ) {
    notes.push({
      code: "cardio-complete",
      tone: "celebration",
      title: "Cardio target: covered",
      body: "You completed the aerobic work without needing to borrow effort from the lifting plan.",
    });
  }
  if (
    days.some((day) =>
      day.sessions.some(
        (session) =>
          session.status === "overperformed" ||
          session.exercises.some(
            (exercise) => exercise.status === "overperformed",
          ),
      ),
    )
  ) {
    notes.push({
      code: "overperformed",
      tone: "celebration",
      title: "You had more in the tank",
      body: "At least one prescription was clearly below your current ability. Repeated results—not one heroic set—will drive the increase.",
    });
  }
  for (const signal of result.safetySignals) {
    if (signal === urgent) continue;
    notes.push({
      code: `pain-${signal.exerciseId}`,
      tone: "safety",
      title: signal.title,
      body: signal.message,
    });
  }
  if (
    result.confidence === "low" &&
    state !== "insufficient_data" &&
    metrics.completedSets + metrics.completedCardioMinutes > 0
  ) {
    notes.push({
      code: "confidence",
      tone: "encouragement",
      title: "One more well-logged week will sharpen the call",
      body: "Keep entering completed sets and effort. You are not being penalized—the plan is simply avoiding a big change from a thin comparison.",
    });
  }
  return { headline: mainHeadline, notes };
}

function weeklyValues(
  weeks: number[],
  logs: WorkoutLog[],
): Map<number, WorkoutLog[]> {
  const latest = latestWorkoutLogs(logs);
  return new Map(
    weeks.map((week) => [
      week,
      latest.filter((log) => log.weekNumber === week),
    ]),
  );
}

function liftingVolume(
  logs: WorkoutLog[],
  lift?: "squat" | "bench" | "deadlift",
  loadMultiplier = 1,
): number {
  return logs.reduce(
    (total, log) =>
      total +
      log.exerciseLogs.reduce((exerciseTotal, exercise) => {
        if (
          lift !== undefined &&
          getExercise(exercise.exerciseId)?.lift !== lift
        )
          return exerciseTotal;
        return (
          exerciseTotal +
          exercise.sets.reduce(
            (setTotal, set) =>
              setTotal +
              (set.completed
                ? (set.load ?? 0) * loadMultiplier * (set.reps ?? 0)
                : 0),
            0,
          )
        );
      }, 0),
    0,
  );
}

function completedSets(logs: WorkoutLog[]): number {
  return logs.reduce(
    (sum, log) =>
      sum +
      log.exerciseLogs.reduce(
        (exerciseSum, exercise) =>
          exerciseSum + exercise.sets.filter((set) => set.completed).length,
        0,
      ),
    0,
  );
}

function completedReps(logs: WorkoutLog[]): number {
  return logs.reduce(
    (sum, log) =>
      sum +
      log.exerciseLogs.reduce(
        (exerciseSum, exercise) =>
          exerciseSum +
          exercise.sets.reduce(
            (setSum, set) => setSum + (set.completed ? (set.reps ?? 0) : 0),
            0,
          ),
        0,
      ),
    0,
  );
}

/** Goal-specific trends use observed work only; zero-load bodyweight work is not fake tonnage. */
export function goalProgressCharts(
  program: TrainingProgram,
  input: QuestionnaireInput,
  logs: WorkoutLog[],
  throughWeek: number,
): ReviewChart[] {
  const weeks = Array.from({ length: throughWeek }, (_, index) => index + 1);
  const values = weeklyValues(weeks, logs);
  const units = program.loadSettings.units;
  // Review tonnage stays in pounds so screenshots and week-to-week comparisons
  // use one familiar unit even when prescriptions are displayed in kilograms.
  const volumeMultiplier =
    program.loadSettings.units === "kg" ? 2.2046226218 : 1;
  const charts: ReviewChart[] = [];
  const goals = [input.goals.primary, input.goals.secondary].filter(
    (goal, index, all): goal is GoalDomain =>
      goal !== undefined && all.indexOf(goal) === index,
  );
  const add = (chart: ReviewChart): void => {
    if (!charts.some((item) => item.id === chart.id)) charts.push(chart);
  };

  for (const goal of goals) {
    if (goal === "powerlifting") {
      add({
        id: "total-volume",
        title: "Total lifting volume",
        unit: "lb × reps",
        weeks,
        goal,
        series: [
          {
            label: "All loaded exercises",
            color: "#3158a6",
            values: weeks.map((week) =>
              liftingVolume(
                values.get(week) ?? [],
                undefined,
                volumeMultiplier,
              ),
            ),
          },
        ],
      });
      add({
        id: "sbd-volume",
        title: "Squat, bench, and deadlift volume",
        unit: "lb × reps",
        weeks,
        goal,
        series: [
          {
            label: "Squat",
            color: "#3158a6",
            values: weeks.map((week) =>
              liftingVolume(values.get(week) ?? [], "squat", volumeMultiplier),
            ),
          },
          {
            label: "Bench",
            color: "#7a4fa3",
            values: weeks.map((week) =>
              liftingVolume(values.get(week) ?? [], "bench", volumeMultiplier),
            ),
          },
          {
            label: "Deadlift",
            color: "#bf6b2c",
            values: weeks.map((week) =>
              liftingVolume(
                values.get(week) ?? [],
                "deadlift",
                volumeMultiplier,
              ),
            ),
          },
        ],
      });
    }
    if (goal === "hypertrophy") {
      add({
        id: "completed-sets",
        title: "Completed lifting sets",
        unit: "sets",
        weeks,
        goal,
        series: [
          {
            label: "Sets",
            color: "#7a4fa3",
            values: weeks.map((week) => completedSets(values.get(week) ?? [])),
          },
        ],
      });
      add({
        id: "completed-reps",
        title: "Completed lifting reps",
        unit: "reps",
        weeks,
        goal,
        series: [
          {
            label: "Reps",
            color: "#3158a6",
            values: weeks.map((week) => completedReps(values.get(week) ?? [])),
          },
        ],
      });
    }
    if (goal === "cardio") {
      add({
        id: "cardio-minutes",
        title: "Cardio minutes",
        unit: "minutes",
        weeks,
        goal,
        series: [
          {
            label: "Minutes",
            color: "#238064",
            values: weeks.map((week) =>
              (values.get(week) ?? []).reduce(
                (sum, log) => sum + (log.cardioLog?.completedMinutes ?? 0),
                0,
              ),
            ),
          },
        ],
      });
      const distanceUnit = units === "kg" ? "km" : "mi";
      const distanceValues = weeks.map((week) =>
        (values.get(week) ?? []).reduce((sum, log) => {
          const distance = log.cardioLog?.distance ?? 0;
          const loggedUnit = log.cardioLog?.distanceUnit ?? distanceUnit;
          if (loggedUnit === distanceUnit) return sum + distance;
          return distanceUnit === "mi"
            ? sum + distance * 0.621371
            : sum + distance * 1.60934;
        }, 0),
      );
      const stepValues = weeks.map((week) =>
        (values.get(week) ?? []).reduce(
          (sum, log) => sum + (log.cardioLog?.steps ?? 0),
          0,
        ),
      );
      if (distanceValues.some((value) => value > 0))
        add({
          id: "cardio-distance",
          title: "Cardio distance",
          unit: distanceUnit,
          weeks,
          goal,
          series: [
            { label: "Distance", color: "#bf6b2c", values: distanceValues },
          ],
        });
      if (stepValues.some((value) => value > 0))
        add({
          id: "steps",
          title: "Logged steps",
          unit: "steps",
          weeks,
          goal,
          series: [{ label: "Steps", color: "#3158a6", values: stepValues }],
        });
      const qualityIntervals = weeks.map((week) =>
        (values.get(week) ?? []).reduce(
          (sum, log) => sum + (log.cardioLog?.completedIntervals ?? 0),
          0,
        ),
      );
      if (qualityIntervals.some((value) => value > 0))
        add({
          id: "quality-intervals",
          title: "Quality intervals completed",
          unit: "intervals",
          weeks,
          goal,
          series: [
            {
              label: "Work intervals",
              color: "#8357ae",
              values: qualityIntervals,
            },
          ],
        });
      const sessionsById = new Map(
        program.weeks.flatMap((week) =>
          week.sessions.map((session) => [session.id, session] as const),
        ),
      );
      const easyPace = weeks.map((week) => {
        let distance = 0;
        let minutes = 0;
        for (const log of values.get(week) ?? []) {
          const role = sessionsById.get(log.sessionId)?.cardio?.role;
          if (!["easy", "steady", "long"].includes(String(role))) continue;
          const rawDistance = log.cardioLog?.distance ?? 0;
          if (rawDistance <= 0) continue;
          const loggedUnit = log.cardioLog?.distanceUnit ?? distanceUnit;
          distance +=
            loggedUnit === distanceUnit
              ? rawDistance
              : distanceUnit === "mi"
                ? rawDistance * 0.621371
                : rawDistance * 1.60934;
          minutes +=
            log.cardioLog?.movingMinutes ??
            log.cardioLog?.completedMinutes ??
            0;
        }
        return distance > 0 ? minutes / distance : 0;
      });
      if (easyPace.some((value) => value > 0))
        add({
          id: "easy-pace",
          title: "Easy/steady pace",
          unit: `min/${distanceUnit} · lower is faster`,
          weeks,
          goal,
          series: [
            {
              label: "Pace at prescribed effort",
              color: "#a93270",
              values: easyPace,
            },
          ],
        });
    }
    if (goal === "health") {
      add({
        id: "health-lifting",
        title: "Strength work completed",
        unit: "sets",
        weeks,
        goal,
        series: [
          {
            label: "Sets",
            color: "#7a4fa3",
            values: weeks.map((week) => completedSets(values.get(week) ?? [])),
          },
        ],
      });
      add({
        id: "health-cardio",
        title: "Aerobic work completed",
        unit: "minutes",
        weeks,
        goal,
        series: [
          {
            label: "Minutes",
            color: "#238064",
            values: weeks.map((week) =>
              (values.get(week) ?? []).reduce(
                (sum, log) => sum + (log.cardioLog?.completedMinutes ?? 0),
                0,
              ),
            ),
          },
        ],
      });
    }
  }
  const cardioPreference =
    input.cardio?.goal?.type === "running_event"
      ? ["cardio-distance", "easy-pace", "cardio-minutes", "quality-intervals"]
      : input.cardio?.goal?.type === "vo2max"
        ? [
            "quality-intervals",
            "cardio-minutes",
            "cardio-distance",
            "easy-pace",
          ]
        : [];
  if (cardioPreference.length > 0) {
    const order = new Map(cardioPreference.map((id, index) => [id, index]));
    charts.sort(
      (left, right) => (order.get(left.id) ?? 99) - (order.get(right.id) ?? 99),
    );
  }
  return charts.slice(0, 4);
}
