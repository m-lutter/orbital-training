import { ENGINE_VERSION, LEGACY_ENGINE_VERSION } from "./contracts";
import type {
  GeneratedWeek,
  ProgramDraftV1,
  ProgramDraftV2,
  ProgramRequestV1,
  ScheduledSession,
} from "./contracts";
import { createGoalSpecificWeek } from "./prescriptions";

export class EngineInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineInputError";
  }
}

function requireIntegerInRange(
  value: number,
  minimum: number,
  maximum: number,
  fieldName: string,
): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new EngineInputError(
      `${fieldName} must be a whole number from ${minimum} to ${maximum}.`,
    );
  }
}

function requireNumberInRange(
  value: number,
  minimum: number,
  maximum: number,
  fieldName: string,
): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new EngineInputError(
      `${fieldName} must be between ${minimum} and ${maximum}.`,
    );
  }
}

function validateRequest(input: ProgramRequestV1): void {
  if (input.questionnaireVersion !== 1)
    throw new EngineInputError("Unsupported questionnaire version.");
  requireIntegerInRange(input.liftingDaysPerWeek, 0, 6, "liftingDaysPerWeek");
  requireIntegerInRange(input.cardioDaysPerWeek, 0, 7, "cardioDaysPerWeek");
  if (input.liftingDaysPerWeek + input.cardioDaysPerWeek === 0)
    throw new EngineInputError(
      "At least one lifting or cardio session is required.",
    );
  if (
    (input.primaryGoal === "powerlifting" ||
      input.primaryGoal === "hypertrophy") &&
    input.liftingDaysPerWeek === 0
  ) {
    throw new EngineInputError(
      `${input.primaryGoal} programming requires at least one lifting day.`,
    );
  }
  if (input.primaryGoal === "cardio" && input.cardioDaysPerWeek === 0)
    throw new EngineInputError(
      "Cardio-focused programming requires at least one cardio day.",
    );
  requireNumberInRange(
    input.liftingSessionMinutes,
    15,
    240,
    "liftingSessionMinutes",
  );
  requireNumberInRange(
    input.cardioSessionMinutes,
    10,
    180,
    "cardioSessionMinutes",
  );
  if (input.programLength.mode === "fixed")
    requireIntegerInRange(
      input.programLength.weeks,
      1,
      52,
      "programLength.weeks",
    );
}

function numberOfWeeks(input: ProgramRequestV1): number {
  return input.programLength.mode === "fixed" ? input.programLength.weeks : 4;
}

function inputSnapshot(input: ProgramRequestV1): ProgramRequestV1 {
  return { ...input, programLength: { ...input.programLength } };
}

// Retained for schema-v1 parser tests and already-saved shell programs.
export function generateProgramShell(input: ProgramRequestV1): ProgramDraftV1 {
  validateRequest(input);
  const createSessions = (weekNumber: number): ScheduledSession[] => [
    ...Array.from({ length: input.liftingDaysPerWeek }, (_, index) => ({
      id: `week-${weekNumber}-lifting-${index + 1}`,
      kind: "lifting" as const,
      targetMinutes: input.liftingSessionMinutes,
    })),
    ...Array.from({ length: input.cardioDaysPerWeek }, (_, index) => ({
      id: `week-${weekNumber}-cardio-${index + 1}`,
      kind: "cardio" as const,
      targetMinutes: input.cardioSessionMinutes,
    })),
  ];
  const weeks: GeneratedWeek[] = Array.from(
    { length: numberOfWeeks(input) },
    (_, index) => ({
      weekNumber: index + 1,
      sessions: createSessions(index + 1),
    }),
  );
  return {
    schemaVersion: 1,
    engineVersion: LEGACY_ENGINE_VERSION,
    strategyId: `v1/${input.primaryGoal}`,
    continuation: input.programLength.mode === "fixed" ? "fixed" : "rolling",
    inputSnapshot: inputSnapshot(input),
    weeks,
    decisions: [
      {
        input: "primaryGoal",
        effect: `Selected the ${input.primaryGoal} programming strategy family.`,
      },
      {
        input: "liftingDaysPerWeek",
        effect: `Created ${input.liftingDaysPerWeek} lifting session slots per week.`,
      },
      {
        input: "cardioDaysPerWeek",
        effect: `Created ${input.cardioDaysPerWeek} cardio session slots per week.`,
      },
      {
        input: "liftingSessionMinutes",
        effect: `Limited each lifting session to approximately ${input.liftingSessionMinutes} minutes.`,
      },
      {
        input: "cardioSessionMinutes",
        effect: `Set each planned cardio session to approximately ${input.cardioSessionMinutes} minutes.`,
      },
      {
        input: "programLength",
        effect:
          input.programLength.mode === "fixed"
            ? `Generated ${input.programLength.weeks} fixed weeks.`
            : "Generated a rolling four-week window for an indefinite program.",
      },
    ],
  };
}

export function generateProgram(input: ProgramRequestV1): ProgramDraftV2 {
  validateRequest(input);
  return {
    schemaVersion: 2,
    engineVersion: ENGINE_VERSION,
    strategyId: `v2/${input.primaryGoal}/${input.liftingDaysPerWeek}l-${input.cardioDaysPerWeek}c`,
    continuation: input.programLength.mode === "fixed" ? "fixed" : "rolling",
    inputSnapshot: inputSnapshot(input),
    weeks: Array.from({ length: numberOfWeeks(input) }, (_, index) =>
      createGoalSpecificWeek(index + 1, input),
    ),
    decisions: [
      {
        input: "primaryGoal",
        effect: `Selected goal-specific ${input.primaryGoal} exercise, volume, effort, and cardio rules.`,
      },
      {
        input: "liftingDaysPerWeek",
        effect: `Selected a ${input.liftingDaysPerWeek}-day lifting structure and distributed movement exposures across it.`,
      },
      {
        input: "cardioDaysPerWeek",
        effect: `Programmed ${input.cardioDaysPerWeek} cardio sessions using an intensity mix appropriate for the primary goal.`,
      },
      {
        input: "liftingSessionMinutes",
        effect: `Capped exercise selection to fit approximately ${input.liftingSessionMinutes} minutes; lower-priority accessories are removed first.`,
      },
      {
        input: "cardioSessionMinutes",
        effect: `Built each cardio prescription around a ${input.cardioSessionMinutes}-minute target.`,
      },
      {
        input: "programLength",
        effect:
          input.programLength.mode === "fixed"
            ? `Generated ${input.programLength.weeks} fixed weeks using repeating three-week loading and one-week recovery waves.`
            : "Generated the next rolling four-week training wave; later waves will use logged performance and recovery.",
      },
    ],
  };
}
