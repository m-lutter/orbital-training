import type {
  DayOfWeek,
  IsoDate,
  TrainingProgram,
  TrainingSession,
} from "$lib/domain";
import {
  addIsoDateDays,
  formatIsoDate,
  formatProgramDateRange,
  parseIsoDate,
  programScheduleStartDate,
} from "$lib/program-dates";
import type { WorkoutStatus } from "$lib/workouts";

export type CalendarTrainingKind = "lifting" | "cardio" | "combined" | "rest";

export interface ProgramCalendarDay {
  isoDate: string;
  dateNumber: number;
  day: DayOfWeek;
  weekNumber: number;
  kind: CalendarTrainingKind;
  title: string;
  sessionIds: string[];
  href?: string;
}

const TERMINAL_STATUSES = new Set<WorkoutStatus>([
  "completed",
  "partial",
  "skipped",
]);

const DAYS: DayOfWeek[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

function sessionsForDay(
  sessions: TrainingSession[],
  day: DayOfWeek,
): TrainingSession[] {
  return sessions.filter(
    (session) => session.kind !== "movement" && session.day === day,
  );
}

function calendarKind(sessions: TrainingSession[]): CalendarTrainingKind {
  const hasLift = sessions.some(
    (session) => session.kind === "lifting" || session.kind === "combined",
  );
  const hasCardio = sessions.some(
    (session) => session.kind === "cardio" || session.kind === "combined",
  );
  if (hasLift && hasCardio) return "combined";
  if (hasLift) return "lifting";
  if (hasCardio) return "cardio";
  return "rest";
}

function calendarTitle(sessions: TrainingSession[]): string {
  const kind = calendarKind(sessions);
  if (kind === "rest") return "Recovery / daily movement";
  if (kind === "combined") return "Lift + cardio";
  return sessions[0]?.title ?? "Training";
}

export function buildProgramCalendar(
  program: TrainingProgram,
  startDate: IsoDate | string,
  programId: string,
  options: { startWeek?: number; dayCount?: number } = {},
): ProgramCalendarDay[] {
  const startWeek = Math.min(
    Math.max(1, options.startWeek ?? 1),
    Math.max(1, program.horizonWeeks),
  );
  const scheduleStartDate = programScheduleStartDate(program, startDate);
  const beginning = parseIsoDate(
    addIsoDateDays(scheduleStartDate, (startWeek - 1) * 7),
  );
  const remainingDays = Math.max(7, (program.horizonWeeks - startWeek + 1) * 7);
  const dayCount = Math.min(28, Math.max(1, options.dayCount ?? remainingDays));
  const results: ProgramCalendarDay[] = [];

  for (let offset = 0; offset < dayCount; offset += 1) {
    const date = new Date(beginning);
    date.setUTCDate(beginning.getUTCDate() + offset);
    const weekNumber = startWeek + Math.floor(offset / 7);
    const week = program.weeks.find((item) => item.weekNumber === weekNumber);
    const day = DAYS[date.getUTCDay()] ?? "sunday";
    const sessions = week ? sessionsForDay(week.sessions, day) : [];
    const session =
      sessions.find((candidate) => candidate.kind === "lifting") ?? sessions[0];

    results.push({
      isoDate: formatIsoDate(date),
      dateNumber: date.getUTCDate(),
      day,
      weekNumber,
      kind: calendarKind(sessions),
      title: calendarTitle(sessions),
      sessionIds: sessions.map((item) => item.id),
      href: session
        ? `/programs/${programId}/workouts/${encodeURIComponent(session.id)}`
        : `/programs/${programId}/movement/${formatIsoDate(date)}`,
    });
  }

  return results;
}

export function calendarLeadingBlanks(startDate: IsoDate | string): number[] {
  return Array.from(
    { length: parseIsoDate(startDate).getUTCDay() },
    (_, index) => index,
  );
}

export function calendarDateRange(days: ProgramCalendarDay[]): string {
  if (days.length === 0) return "";
  return formatProgramDateRange(
    days[0]?.isoDate ?? "2000-01-01",
    days.at(-1)?.isoDate ?? "2000-01-01",
  );
}

export function calendarDayIsFinished(
  day: ProgramCalendarDay,
  sessionStatuses: Record<string, WorkoutStatus | undefined>,
): boolean {
  return (
    day.sessionIds.length > 0 &&
    day.sessionIds.every((id) => {
      const status = sessionStatuses[id];
      return status !== undefined && TERMINAL_STATUSES.has(status);
    })
  );
}

/**
 * A calendar date can contain both lifting and cardio. When the shared
 * next-workout selector points at one of those sessions, the highlighted date
 * must open that exact session rather than defaulting to the first session on
 * the date.
 */
export function calendarDayHref(
  day: ProgramCalendarDay,
  programId: string,
  nextSessionId?: string,
): string | undefined {
  return nextSessionId !== undefined && day.sessionIds.includes(nextSessionId)
    ? `/programs/${programId}/workouts/${encodeURIComponent(nextSessionId)}`
    : day.href;
}

/**
 * Before training begins, call attention to the first program date. Afterward,
 * advance to the earliest unfinished date that actually contains training.
 */
export function highlightedCalendarDate(
  days: ProgramCalendarDay[],
  sessionStatuses: Record<string, WorkoutStatus | undefined>,
  nextSessionId?: string,
): string | undefined {
  if (nextSessionId !== undefined) {
    const selected = days.find((day) => day.sessionIds.includes(nextSessionId));
    if (selected !== undefined) return selected.isoDate;
  }
  const finishedDays = days.filter((day) =>
    calendarDayIsFinished(day, sessionStatuses),
  );
  if (finishedDays.length === 0) return days[0]?.isoDate;
  return days.find(
    (day) =>
      day.kind !== "rest" &&
      day.sessionIds.length > 0 &&
      !calendarDayIsFinished(day, sessionStatuses),
  )?.isoDate;
}
