import { availableCardioModalities } from "./cardio-substitutions.js";
import { cardioSegmentMinutes } from "./duration.js";
import { getExercise, isExerciseEligible } from "./exercises.js";
import {
  addScheduleDays,
  hardCardioDayIsCompatible,
  weekdayOffset,
} from "./schedule.js";
import type {
  EngineWarning,
  QuestionnaireInput,
  TrainingProgram,
} from "./types.js";

/** New-output invariants; callers reading historical programs may use diagnostic mode. */
export function validateGeneratedProgram(
  program: TrainingProgram,
  input?: QuestionnaireInput,
): EngineWarning[] {
  const warnings: EngineWarning[] = [];
  const fail = (code: string, message: string) =>
    warnings.push({
      code: `invariant-${code}`,
      severity: "blocking",
      message,
      ruleIds: ["SAFE-1", "SCHED-1"],
    });
  if (program.horizonWeeks !== program.weeks.length)
    fail("horizon", "Program horizon does not match its generated weeks.");
  const sessionIds = new Set<string>();
  const prescriptionIds = new Set<string>();
  for (const [weekIndex, week] of program.weeks.entries()) {
    if (week.weekNumber !== weekIndex + 1)
      fail(`week-${weekIndex}`, "Week numbers must be ordered and contiguous.");
    for (const session of week.sessions) {
      if (sessionIds.has(session.id))
        fail(
          `duplicate-${session.id}`,
          "Session identifiers must be globally unique, including movement targets.",
        );
      sessionIds.add(session.id);
    }
    const formal = week.sessions.filter(
      (session) => session.kind !== "movement",
    );
    const scheduledDays = new Set<string>();
    let previousDate = "";
    for (const [sessionIndex, session] of formal.entries()) {
      if (
        session.weekNumber !== week.weekNumber ||
        session.sequence !== sessionIndex + 1
      )
        fail(
          `sequence-${session.id}`,
          "Sessions must have ordered, unique, contiguous sequences in their week.",
        );
      if (!session.day || scheduledDays.has(session.day))
        fail(
          `day-${session.id}`,
          "Every formal session needs a unique scheduled day.",
        );
      if (session.day) scheduledDays.add(session.day);
      if (session.occurrenceDate) {
        if (session.occurrenceDate < previousDate)
          fail(
            `order-${session.id}`,
            "Session occurrences must be chronological.",
          );
        previousDate = session.occurrenceDate;
        if (
          input?.goals.event &&
          session.occurrenceDate >= input.goals.event.date
        )
          fail(
            `event-${session.id}`,
            "Training must finish before the event date.",
          );
        if (program.effectiveScheduleStartDate && session.day) {
          const expected = addScheduleDays(
            program.effectiveScheduleStartDate,
            (week.weekNumber - 1) * 7 +
              weekdayOffset(program.effectiveScheduleStartDate, session.day),
          );
          if (expected !== session.occurrenceDate)
            fail(
              `date-${session.id}`,
              "Stored occurrence does not match the authoritative schedule anchor.",
            );
        }
      } else if (program.effectiveScheduleStartDate)
        fail(
          `missing-date-${session.id}`,
          "New dated programs must store every formal session occurrence.",
        );
      if (
        input &&
        session.day &&
        input.schedule.unavailableDays.includes(session.day)
      )
        fail(`unavailable-${session.id}`, "A session uses an unavailable day.");
      if (
        input &&
        session.exercises.length > 0 &&
        session.day &&
        !input.schedule.preferredTrainingDays.includes(session.day)
      )
        fail(
          `lifting-day-${session.id}`,
          "Lifting must remain on a selected training day.",
        );
      for (const item of session.exercises) {
        if (prescriptionIds.has(item.id))
          fail(
            `prescription-${item.id}`,
            "Prescription identifiers must be globally unique.",
          );
        prescriptionIds.add(item.id);
        if (
          item.sets < 1 ||
          !Number.isInteger(item.sets) ||
          item.reps.min < 1 ||
          !Number.isInteger(item.reps.min) ||
          item.reps.min !== item.reps.max ||
          item.targetRir.min !== item.targetRir.max
        )
          fail(
            `specific-${item.id}`,
            "Every displayed lifting prescription must have exact positive sets, reps, and RIR.",
          );
        const definition = getExercise(item.exerciseId);
        if (!definition || (input && !isExerciseEligible(definition, input)))
          fail(
            `eligibility-${item.id}`,
            "A prescription is not eligible for the stated equipment and exclusions.",
          );
        if (
          item.progression.repFloor !== undefined &&
          item.progression.repCeiling !== undefined &&
          (item.reps.min < item.progression.repFloor ||
            item.reps.min > item.progression.repCeiling)
        )
          fail(
            `bounds-${item.id}`,
            "The exact rep prescription falls outside its progression bounds.",
          );
      }
      if (session.cardio) {
        const sum = cardioSegmentMinutes(session.cardio);
        if (sum !== undefined && Math.abs(sum - session.cardio.minutes) > 0.01)
          fail(
            `cardio-duration-${session.id}`,
            "Cardio segments must add up to the prescribed duration.",
          );
        if (
          input &&
          !availableCardioModalities(input).includes(session.cardio.modality)
        )
          fail(
            `modality-${session.id}`,
            "Cardio modality is not among the user's available options.",
          );
        if (
          session.cardio.intensity === "hard" &&
          session.day &&
          !hardCardioDayIsCompatible(session.day, formal)
        )
          fail(
            `cardio-stress-${session.id}`,
            "Hard cardio conflicts with heavy lower-body recovery.",
          );
      }
    }
    const fullWeek =
      !input?.goals.event ||
      !program.effectiveScheduleStartDate ||
      addScheduleDays(
        program.effectiveScheduleStartDate,
        week.weekNumber * 7,
      ) <= input.goals.event.date;
    if (input?.goals.primary === "powerlifting" && fullWeek) {
      const lifts = new Set(
        formal.flatMap((session) =>
          session.exercises.map((item) => getExercise(item.exerciseId)?.lift),
        ),
      );
      for (const lift of ["squat", "bench", "deadlift"] as const)
        if (!lifts.has(lift))
          fail(
            `coverage-${week.weekNumber}-${lift}`,
            `Week ${week.weekNumber} is missing required ${lift} practice.`,
          );
    }
  }
  return warnings;
}
