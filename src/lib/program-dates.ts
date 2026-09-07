import type { DayOfWeek, IsoDate, TrainingProgram } from "$lib/domain";

const DAYS: DayOfWeek[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

export interface ProgramDate {
  isoDate: IsoDate;
  dateNumber: number;
  day: DayOfWeek;
}

export function parseIsoDate(value: IsoDate | string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year ?? 2000, (month ?? 1) - 1, day ?? 1));
}

export function formatIsoDate(date: Date): IsoDate {
  return date.toISOString().slice(0, 10) as IsoDate;
}

export function addIsoDateDays(
  value: IsoDate | string,
  offset: number,
): IsoDate {
  const date = parseIsoDate(value);
  date.setUTCDate(date.getUTCDate() + offset);
  return formatIsoDate(date);
}

function orderedScheduledProgramDays(
  program: TrainingProgram,
): DayOfWeek[] | undefined {
  const firstWeek = [...program.weeks].sort(
    (left, right) => left.weekNumber - right.weekNumber,
  )[0];
  if (firstWeek === undefined) return undefined;
  const sessions = [...firstWeek.sessions]
    .filter((session) => session.kind !== "movement")
    .sort((left, right) => left.sequence - right.sequence);
  if (
    sessions.length === 0 ||
    sessions.some((session) => session.day === undefined)
  )
    return undefined;
  return sessions.map((session) => session.day as DayOfWeek);
}

function weekdayOffsets(
  startDate: IsoDate | string,
  days: DayOfWeek[],
): number[] {
  const startDay = parseIsoDate(startDate).getUTCDay();
  return days.map(
    (day) => (DAYS.indexOf(day) - startDay + DAYS.length) % DAYS.length,
  );
}

function offsetsAreOrdered(offsets: number[]): boolean {
  return offsets.every(
    (offset, index) => index === 0 || offset >= (offsets[index - 1] ?? 0),
  );
}

/**
 * Preserve the chosen seven-day boundary whenever its scheduled weekdays are
 * already chronological. If that boundary wraps a later-sequence workout in
 * front of workout one, advance to workout one's next weekday occurrence.
 */
export function programScheduleStartDate(
  program: TrainingProgram,
  startDate: IsoDate | string,
): IsoDate {
  if (program.effectiveScheduleStartDate !== undefined)
    return program.effectiveScheduleStartDate;
  const normalizedStart = formatIsoDate(parseIsoDate(startDate));
  const scheduledDays = orderedScheduledProgramDays(program);
  if (scheduledDays === undefined) return normalizedStart;
  const originalOffsets = weekdayOffsets(normalizedStart, scheduledDays);
  if (offsetsAreOrdered(originalOffsets)) return normalizedStart;

  const alignedStart = addIsoDateDays(normalizedStart, originalOffsets[0] ?? 0);
  return offsetsAreOrdered(weekdayOffsets(alignedStart, scheduledDays))
    ? alignedStart
    : normalizedStart;
}

export function programScheduleDateOffset(
  program: TrainingProgram,
  startDate: IsoDate | string,
  currentDate: IsoDate | string,
): number {
  const scheduleStart = parseIsoDate(
    programScheduleStartDate(program, startDate),
  );
  const current = parseIsoDate(currentDate);
  return Math.floor((current.getTime() - scheduleStart.getTime()) / 86_400_000);
}

/** A program week is always seven dates beginning from the chosen start date. */
export function programWeekDates(
  startDate: IsoDate | string,
  weekNumber: number,
): ProgramDate[] {
  const firstDate = addIsoDateDays(startDate, (weekNumber - 1) * 7);
  return Array.from({ length: 7 }, (_, offset) => {
    const isoDate = addIsoDateDays(firstDate, offset);
    const date = parseIsoDate(isoDate);
    return {
      isoDate,
      dateNumber: date.getUTCDate(),
      day: DAYS[date.getUTCDay()] ?? "sunday",
    };
  });
}

export function scheduledProgramWeekDates(
  program: TrainingProgram,
  startDate: IsoDate | string,
  weekNumber: number,
): ProgramDate[] {
  return programWeekDates(
    programScheduleStartDate(program, startDate),
    weekNumber,
  );
}

export function formatProgramDateRange(
  firstDate: IsoDate | string,
  lastDate: IsoDate | string,
): string {
  const format = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return `${format.format(parseIsoDate(firstDate))} – ${format.format(
    parseIsoDate(lastDate),
  )}`;
}
