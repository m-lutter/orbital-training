import type { QuestionnaireInput, TrainingProgram } from "$lib/domain";
import type { WorkoutLog } from "$lib/workouts";
import { describe, expect, it } from "vitest";
import { goalProgressCharts } from "./presentation";

describe("review chart presentation", () => {
  it("reports powerlifting volume in pounds even for a kilogram program", () => {
    const program = {
      loadSettings: { units: "kg" },
    } as unknown as TrainingProgram;
    const input = {
      goals: { primary: "powerlifting" },
    } as unknown as QuestionnaireInput;
    const logs = [
      {
        weekNumber: 1,
        programVersion: 1,
        sessionId: "s1",
        updatedAt: "2026-08-18T00:00:00Z",
        exerciseLogs: [
          {
            exerciseId: "competition_squat",
            sets: [{ setNumber: 1, load: 100, reps: 5, completed: true }],
          },
        ],
      },
    ] as unknown as WorkoutLog[];
    const chart = goalProgressCharts(program, input, logs, 1).find(
      (item) => item.id === "total-volume",
    );
    expect(chart?.unit).toBe("lb × reps");
    expect(chart?.series[0]?.values[0]).toBeCloseTo(1102.31, 1);
  });
});
