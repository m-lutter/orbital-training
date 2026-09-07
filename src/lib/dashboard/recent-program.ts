import type { ProgramDraftV3 } from "$lib/engine";
import type { IsoDate } from "$lib/domain";
import { nextWeeklyReview } from "$lib/reviews";
import {
  nextWorkoutSession,
  prescribedRepTarget,
  type WorkoutLog,
  type WorkoutStatus,
} from "$lib/workouts";
import {
  programIconFromDraft,
  type ProgramIconName,
} from "$lib/ui/program-icons";
import {
  buildProgramCalendar,
  type ProgramCalendarDay,
} from "$lib/ui/program-calendar";

const TERMINAL = new Set<WorkoutStatus>(["completed", "partial", "skipped"]);

export interface RecentProgramSummary {
  icon: ProgramIconName;
  calendarDays: ProgramCalendarDay[];
  calendarWeekNumber: number;
  calendarEnabled: boolean;
  startDate: IsoDate;
  flexible: boolean;
  primaryGoal: string;
  secondaryGoal?: string;
  primaryWeight: number;
  horizonWeeks: number;
  completedDays: number;
  totalDays: number;
  progressPercent: number;
  sessionStatuses: Record<string, WorkoutStatus>;
  highlightSessionId?: string;
  movementTarget?: {
    headline: string;
    detail: string;
  };
  nextAction:
    | {
        kind: "workout";
        href: string;
        title: string;
        label: string;
        detail: string;
      }
    | {
        kind: "review";
        href: string;
        title: string;
        label: string;
        detail: string;
      }
    | { kind: "complete"; title: string; label: string; detail: string };
}

function titleCase(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function sessionDayKey(
  weekNumber: number,
  session: ProgramDraftV3["program"]["weeks"][number]["sessions"][number],
): string {
  return session.day === undefined
    ? `${weekNumber}:sequence:${session.sequence}`
    : `${weekNumber}:day:${session.day}`;
}

export function summarizeRecentProgram(
  programId: string,
  draft: ProgramDraftV3,
  logs: WorkoutLog[],
  reviewedWeeks: number[],
): RecentProgramSummary {
  const statuses = Object.fromEntries(
    logs.map((log) => [log.sessionId, log.status]),
  ) as Record<string, WorkoutStatus>;
  const days = new Map<string, string[]>();
  for (const week of draft.program.weeks) {
    for (const session of week.sessions) {
      if (session.kind === "movement") continue;
      const key = sessionDayKey(week.weekNumber, session);
      days.set(key, [...(days.get(key) ?? []), session.id]);
    }
  }
  const completedDays = [...days.values()].filter(
    (sessionIds) =>
      sessionIds.length > 0 &&
      sessionIds.every((sessionId) => {
        const status = statuses[sessionId];
        return status !== undefined && TERMINAL.has(status);
      }),
  ).length;
  const totalDays = days.size;
  const reviewDue = nextWeeklyReview(draft.program, logs, reviewedWeeks);
  const next = nextWorkoutSession(draft.program, draft.inputSnapshot, logs);
  const goals = draft.inputSnapshot.goals;
  const calendarWeekNumber = Math.min(
    Math.max(
      1,
      next?.session.weekNumber ??
        reviewDue ??
        draft.program.weeks.at(-1)?.weekNumber ??
        1,
    ),
    Math.max(1, draft.program.horizonWeeks),
  );
  const calendarWeek = draft.program.weeks.find(
    (week) => week.weekNumber === calendarWeekNumber,
  );
  const movementTarget = calendarWeek?.sessions.find(
    (session) => session.kind === "movement",
  )?.movementTarget;
  const movementHeadline =
    movementTarget?.steps !== undefined
      ? `${movementTarget.steps.toLocaleString()} steps each day`
      : movementTarget?.walkingMinutes !== undefined
        ? `${movementTarget.walkingMinutes} minutes of walking each day`
        : undefined;

  let nextAction: RecentProgramSummary["nextAction"];
  if (reviewDue !== undefined) {
    nextAction = {
      kind: "review",
      href: `/programs/${programId}/reviews/${reviewDue}`,
      title: `Review week ${reviewDue}`,
      label: "Weekly review ready",
      detail: "Review the week before the next workout is released.",
    };
  } else if (next !== undefined) {
    const session = next.session;
    const exercisePreview = session.exercises
      .slice(0, 3)
      .map(
        (exercise) =>
          `${exercise.name}: ${exercise.sets} × ${prescribedRepTarget(exercise)}`,
      )
      .join(" · ");
    nextAction = {
      kind: "workout",
      href: `/programs/${programId}/workouts/${encodeURIComponent(session.id)}`,
      title: next.label,
      label:
        next.status === "in_progress" ? "Continue workout" : "Next workout",
      detail:
        exercisePreview ||
        (session.cardio
          ? `${session.cardio.minutes} min · ${titleCase(session.cardio.intensity)} effort`
          : `${session.predictedMinutes} min`),
    };
  } else {
    nextAction = {
      kind: "complete",
      title: "Program complete",
      label: "Mission accomplished",
      detail: "Review your results or create your next training block.",
    };
  }

  return {
    icon: programIconFromDraft(draft),
    calendarDays: buildProgramCalendar(
      draft.program,
      goals.startDate,
      programId,
      { startWeek: calendarWeekNumber, dayCount: 7 },
    ),
    calendarWeekNumber,
    calendarEnabled: reviewDue === undefined,
    startDate: goals.startDate,
    flexible:
      draft.inputSnapshot.schedule.planningStyle === "flexible_sequence",
    primaryGoal: titleCase(goals.primary),
    ...(goals.secondary === undefined
      ? {}
      : { secondaryGoal: titleCase(goals.secondary) }),
    primaryWeight: goals.primaryWeight,
    horizonWeeks: draft.program.horizonWeeks,
    completedDays,
    totalDays,
    progressPercent:
      totalDays === 0 ? 0 : Math.round((completedDays / totalDays) * 100),
    sessionStatuses: statuses,
    ...(movementTarget === undefined || movementHeadline === undefined
      ? {}
      : {
          movementTarget: {
            headline: movementHeadline,
            detail: movementTarget.explanation,
          },
        }),
    ...(reviewDue === undefined && next !== undefined
      ? { highlightSessionId: next.session.id }
      : {}),
    nextAction,
  };
}
