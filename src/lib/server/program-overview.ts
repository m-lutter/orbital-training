import type { TrainingSession } from "$lib/domain";
import type { ProgramDraftV3 } from "$lib/engine";
import { programScheduleStartDate } from "$lib/program-dates";
import {
  prescribedRepTarget,
  sessionLabel,
  weeklyProgressionSummary,
  type LoadRecommendation,
} from "$lib/workouts";
import {
  programIconFromDraft,
  type ProgramIconName,
} from "$lib/ui/program-icons";

function titleCase(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function pointTarget(minimum: number, maximum: number): number {
  return Math.round(((minimum + maximum) / 2) * 2) / 2;
}

function goalSummary(draft: ProgramDraftV3): string {
  const goals = draft.inputSnapshot.goals;
  const primary = titleCase(goals.primary);
  if (goals.secondary === undefined || goals.primaryWeight === 100)
    return primary;
  return `${goals.primaryWeight}% ${primary} · ${100 - goals.primaryWeight}% ${titleCase(goals.secondary)}`;
}

function effortTarget(
  draft: ProgramDraftV3,
  minimum: number,
  maximum: number,
): string {
  const rir = pointTarget(minimum, maximum);
  const requested = draft.inputSnapshot.history.effortReporting;
  const familiarity = draft.inputSnapshot.history.effortFamiliarity;
  const mode =
    requested === "auto"
      ? familiarity === "none"
        ? "verbal"
        : "rir"
      : requested;
  if (mode === "rpe") return `RPE ${10 - rir}`;
  if (mode === "verbal") {
    const label =
      rir >= 4
        ? "easy"
        : rir >= 2
          ? "medium"
          : rir > 0
            ? "difficult"
            : "maximum";
    return `${titleCase(label)} effort`;
  }
  return `${rir} RIR`;
}

function supersetLabel(
  session: TrainingSession,
  prescriptionId: string,
): string | undefined {
  const block = session.setBlocks?.find(
    (candidate) =>
      candidate.type === "paired_superset" &&
      candidate.sequence.some((item) => item.prescriptionId === prescriptionId),
  );
  return block?.sequence.find((item) => item.prescriptionId === prescriptionId)
    ?.orderLabel;
}

function overviewWeight(
  recommendation: LoadRecommendation | undefined,
): string {
  if (recommendation === undefined) return "";
  if (recommendation.kind !== "calibrate") return recommendation.text;
  return recommendation.text.startsWith("Start with bodyweight")
    ? "Bodyweight"
    : "";
}

function programDetails(draft: ProgramDraftV3): ProgramOverviewView["details"] {
  const { inputSnapshot: input } = draft;
  const weightDescription = input.weight.ignoreAfterInitial
    ? "Your starting body weight is only background context. The app will not ask you to track it."
    : input.weight.weeklyCheckIns
      ? "Optional weekly body-weight check-ins add context when training performance changes. This is not diet coaching."
      : "Body weight is used as background context for exercise selection and training load. It is not a diet target.";
  const effortDescription =
    input.history.effortFamiliarity === "none"
      ? "Workout effort uses plain-language choices so you can report how each set felt without learning a new scale first."
      : `Workout effort uses ${input.history.effortReporting === "auto" ? "the scale that best fits your answers" : input.history.effortReporting.toUpperCase()} so recommendations can respond to how training actually feels.`;

  return [
    {
      title: "Your goals",
      description: `${goalSummary(draft)} guides which work gets the most time and energy.`,
    },
    { title: "Body weight", description: weightDescription },
    {
      title: "Effort",
      description: effortDescription,
    },
    {
      title: "Equipment",
      description:
        input.facility.alternateEquipment === undefined
          ? "Exercises are chosen from the equipment available at your primary gym. You can still replace a movement when needed."
          : "Exercises use your primary gym by default, with a secondary-gym version available for days when equipment changes.",
    },
    {
      title: "Weekly updates",
      description:
        "Completed work and effort help tune future workouts. The goal is steady progress without making you restart the plan.",
    },
  ];
}

export interface ProgramOverviewView {
  icon: ProgramIconName;
  goalSummary: string;
  horizonWeeks: number;
  rolling: boolean;
  startDate: string;
  typicalWeek: string;
  selectedSplit?: string;
  schedulingDescription: string;
  targetLiftMinutes: number;
  details: Array<{ title: string; description: string }>;
  warnings: string[];
  unresolvedChoices: string[];
  baselines: Array<{ lift: string; estimate: string }>;
  weeks: Array<{
    weekNumber: number;
    phase: string;
    workoutCount: number;
    progressionSummary: string;
    sessions: Array<{
      id: string;
      label: string;
      suggestedDay?: string;
      predictedMinutes: number;
      exercises: Array<{
        id: string;
        name: string;
        optional: boolean;
        sets: number;
        reps: number;
        effort: string;
        weight: string;
        supersetLabel?: string;
      }>;
      cardio?: string;
    }>;
    movement?: string;
  }>;
}

/**
 * Build the small, display-only contract consumed by the overview route.
 * Calculation inputs, alternatives, question effects, and explanations stay
 * on the server and in the durable program record.
 */
export function presentProgramOverview(
  draft: ProgramDraftV3,
  recommendations: Record<string, LoadRecommendation>,
): ProgramOverviewView {
  const { program } = draft;
  const firstSessions =
    program.weeks[0]?.sessions.filter(
      (session) => session.kind !== "movement",
    ) ?? [];
  const lifts = firstSessions.filter(
    (session) => session.kind === "lifting" || session.kind === "combined",
  ).length;
  const cardio = firstSessions.filter(
    (session) => session.kind === "cardio" || session.kind === "combined",
  ).length;

  return {
    icon: programIconFromDraft(draft),
    goalSummary: goalSummary(draft),
    horizonWeeks: program.horizonWeeks,
    rolling: program.rolling,
    startDate: programScheduleStartDate(
      program,
      draft.inputSnapshot.goals.startDate,
    ),
    typicalWeek: `${lifts} lifting day${lifts === 1 ? "" : "s"} · ${cardio} cardio session${cardio === 1 ? "" : "s"}`,
    ...(program.selectedSplit === undefined
      ? {}
      : { selectedSplit: titleCase(program.selectedSplit) }),
    schedulingDescription:
      draft.inputSnapshot.schedule.planningStyle === "calendar_days"
        ? "Workouts are placed on your selected days."
        : "Follow the recommended order and recovery rhythm; move a day when life requires it.",
    targetLiftMinutes: draft.inputSnapshot.schedule.targetLiftMinutes,
    details: programDetails(draft),
    warnings: program.warnings.map((warning) => warning.message),
    unresolvedChoices: [...program.unresolvedChoices],
    baselines: program.baselines.some((baseline) => baseline.e1rm !== undefined)
      ? program.baselines.map((baseline) => ({
          lift: titleCase(baseline.lift),
          estimate:
            baseline.e1rm === undefined
              ? "Calibrate in training"
              : `${baseline.e1rm} ${program.loadSettings.units} estimated max`,
        }))
      : [],
    weeks: program.weeks.map((week, weekIndex) => {
      const movement = week.sessions.find(
        (session) => session.kind === "movement",
      )?.movementTarget;
      return {
        weekNumber: week.weekNumber,
        phase: titleCase(week.phase),
        workoutCount: week.sessions.filter(
          (session) => session.kind !== "movement",
        ).length,
        progressionSummary: weeklyProgressionSummary(
          week,
          program.weeks[weekIndex - 1],
        ),
        sessions: week.sessions
          .filter((session) => session.kind !== "movement")
          .map((session) => ({
            id: session.id,
            label: sessionLabel(
              session,
              draft.inputSnapshot.schedule.planningStyle,
            ),
            ...(draft.inputSnapshot.schedule.planningStyle ===
              "flexible_sequence" && session.day !== undefined
              ? { suggestedDay: titleCase(session.day) }
              : {}),
            predictedMinutes: session.predictedMinutes,
            exercises: session.exercises.map((exercise) => ({
              id: exercise.id,
              name: exercise.name,
              optional: exercise.optional,
              sets: exercise.sets,
              reps: prescribedRepTarget(exercise),
              effort: effortTarget(
                draft,
                exercise.targetRir.min,
                exercise.targetRir.max,
              ),
              weight: overviewWeight(recommendations[exercise.id]),
              ...(supersetLabel(session, exercise.id) === undefined
                ? {}
                : { supersetLabel: supersetLabel(session, exercise.id) }),
            })),
            ...(session.cardio === undefined
              ? {}
              : {
                  cardio: `${titleCase(session.cardio.modality)} · ${session.cardio.minutes} min · ${titleCase(session.cardio.intensity)} (target RPE ${pointTarget(session.cardio.sessionRpe.min, session.cardio.sessionRpe.max)})`,
                }),
          })),
        ...(movement === undefined
          ? {}
          : {
              movement:
                movement.steps === undefined
                  ? `Daily movement: ${movement.walkingMinutes} walking minutes`
                  : `Daily movement: ${movement.steps} steps`,
            }),
      };
    }),
  };
}
