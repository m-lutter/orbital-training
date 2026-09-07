import { describe, expect, it } from "vitest";
import {
  estimateE1rm,
  generateProgram,
  validateQuestionnaire,
} from "../index.js";
import { baseInput, meetPowerlifterInput } from "./fixtures.js";

describe("input and boundary validation", () => {
  it("blocks an unaccepted disclaimer and a past start date", () => {
    const input = baseInput();
    input.safety.disclaimerAccepted = false;
    input.goals.startDate = "2026-08-01";
    const issues = validateQuestionnaire(input);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "safety.disclaimerAccepted",
          severity: "blocking",
        }),
        expect.objectContaining({
          path: "goals.startDate",
          severity: "blocking",
        }),
      ]),
    );
    expect(generateProgram(input).program).toBeUndefined();
  });

  it("requires contingent goal branches and a secondary goal for a weighted contract", () => {
    const input = baseInput();
    input.goals.primary = "powerlifting";
    input.goals.primaryWeight = 50;
    const issues = validateQuestionnaire(input);
    expect(
      issues.some(
        (issue) =>
          issue.path === "powerlifting" && issue.severity === "blocking",
      ),
    ).toBe(true);
    expect(
      issues.some(
        (issue) =>
          issue.path === "goals.secondary" && issue.severity === "blocking",
      ),
    ).toBe(true);
  });

  it("blocks a contradictory cardio modality answer instead of guessing", () => {
    const input = baseInput();
    input.cardio.avoidRunning = true;
    input.cardio.preferredModalities = ["running"];
    expect(validateQuestionnaire(input)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "cardio.preferredModalities",
          severity: "blocking",
        }),
      ]),
    );
  });

  it("requires enough selected training days in flexible and calendar plans", () => {
    for (const planningStyle of [
      "flexible_sequence",
      "calendar_days",
    ] as const) {
      const input = baseInput();
      input.schedule.planningStyle = planningStyle;
      input.schedule.liftingDaysPerWeek = 4;
      input.schedule.preferredTrainingDays = ["monday", "thursday"];
      expect(validateQuestionnaire(input)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "schedule.preferredTrainingDays",
            severity: "blocking",
          }),
        ]),
      );
    }
  });

  it("accepts a six-day plan when all seven training days are selected", () => {
    const input = baseInput();
    input.schedule.liftingDaysPerWeek = 6;
    input.schedule.preferredTrainingDays = [
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
    ];
    expect(
      validateQuestionnaire(input).some(
        (issue) => issue.path === "schedule.preferredTrainingDays",
      ),
    ).toBe(false);
  });

  it("does not count a selected day that is also unavailable", () => {
    const input = baseInput();
    input.schedule.liftingDaysPerWeek = 2;
    input.schedule.unavailableDays = ["monday"];
    expect(validateQuestionnaire(input)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "schedule.preferredTrainingDays",
          severity: "blocking",
        }),
      ]),
    );
  });

  it("warns on contradictory bodyweight tracking but honors ignore-after-initial", () => {
    const input = baseInput();
    input.weight.ignoreAfterInitial = true;
    input.weight.weeklyCheckIns = true;
    const result = generateProgram(input);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "weight.weeklyCheckIns",
          severity: "warning",
        }),
      ]),
    );
    expect(result.program?.loggingPlan.bodyweightCheckIn).toBe("disabled");
  });

  it("reports infeasible powerlifting specificity when competition equipment is unavailable", () => {
    const input = meetPowerlifterInput();
    input.facility.primaryEquipment = ["dumbbells", "bench"];
    const result = generateProgram(input);
    expect(result.program?.status).toBe("infeasible");
    expect(
      result.program?.warnings.some((warning) =>
        warning.code.startsWith("no-exercise-"),
      ),
    ).toBe(true);
    expect(
      result.program?.warnings.some((warning) =>
        warning.code.startsWith("specificity-unavailable-"),
      ),
    ).toBe(true);
  });

  it("uses the documented effort-adjusted e1RM formula and rejects invalid estimates", () => {
    expect(
      estimateE1rm({
        load: 300,
        reps: 5,
        rir: 2,
        date: "2026-08-01",
        stableTechnique: true,
        completed: true,
      }),
    ).toBeCloseTo(370, 6);
    expect(
      estimateE1rm({
        load: 300,
        reps: 11,
        rir: 1,
        date: "2026-08-01",
        stableTechnique: true,
        completed: true,
      }),
    ).toBeUndefined();
    expect(
      estimateE1rm({
        load: 300,
        reps: 5,
        rir: 1,
        date: "2026-08-01",
        stableTechnique: false,
        completed: true,
      }),
    ).toBeUndefined();
  });
});
