import { getExercise } from "./exercises.js";
import type { DayOfWeek, IsoDate, TrainingSession } from "./types.js";
import { DAYS } from "./utils.js";

export function addScheduleDays(start: IsoDate, days: number): IsoDate {
  const date = new Date(`${start}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10) as IsoDate;
}

export function weekdayOffset(start: IsoDate, day: DayOfWeek): number {
  const startIndex = (new Date(`${start}T00:00:00Z`).getUTCDay() + 6) % 7;
  return (DAYS.indexOf(day) - startIndex + 7) % 7;
}

export function effectiveScheduleStart(
  start: IsoDate,
  sessions: TrainingSession[],
): IsoDate {
  const days = [...sessions]
    .filter(
      (session) => session.kind !== "movement" && session.day !== undefined,
    )
    .sort((a, b) => a.sequence - b.sequence)
    .map((session) => session.day as DayOfWeek);
  const offsets = days.map((day) => weekdayOffset(start, day));
  const ordered = offsets.every(
    (offset, index) => index === 0 || offset >= (offsets[index - 1] ?? 0),
  );
  return ordered ? start : addScheduleDays(start, offsets[0] ?? 0);
}

export function isHeavyLowerSession(session: TrainingSession): boolean {
  return session.exercises.some((item) => {
    const definition = getExercise(item.exerciseId);
    return (
      definition !== undefined &&
      definition.fatigue === 3 &&
      definition.primaryMuscles.some((muscle) =>
        ["quads", "hamstrings", "glutes"].includes(muscle),
      ) &&
      (item.reps.min <= 5 ||
        item.purpose === "strength" ||
        item.purpose === "competition_skill")
    );
  });
}

export function hardCardioDayIsCompatible(
  day: DayOfWeek,
  lifting: TrainingSession[],
): boolean {
  const index = DAYS.indexOf(day);
  return lifting.every((session) => {
    if (!session.day || !isHeavyLowerSession(session)) return true;
    const distance = Math.abs(index - DAYS.indexOf(session.day));
    return Math.min(distance, 7 - distance) >= 2;
  });
}
