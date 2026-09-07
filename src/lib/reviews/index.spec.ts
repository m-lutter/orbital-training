import type { TrainingProgram } from "$lib/domain";
import type { WorkoutLog } from "$lib/workouts";
import { describe, expect, it } from "vitest";
import {
  nextWeeklyReview,
  reviewDayMarks,
  summarizeWeek,
  toWeekLogs,
  weeklyBreakdown,
} from ".";

const program = {
  loadSettings: {
    units: "lb",
    barbellIncrement: 5,
    dumbbellIncrement: 5,
  },
  weeks: [
    {
      weekNumber: 1,
      sessions: [
        {
          id: "w1-lift-1",
          weekNumber: 1,
          sequence: 1,
          day: "monday",
          kind: "combined",
          title: "Squat and easy cardio",
          exercises: [
            {
              id: "w1-s1-squat",
              sets: 2,
              optional: false,
            },
          ],
          cardio: { minutes: 20, modality: "walking" },
        },
        {
          id: "w1-lift-2",
          weekNumber: 1,
          sequence: 2,
          day: "thursday",
          kind: "lifting",
          title: "Bench",
          exercises: [],
        },
      ],
    },
    {
      weekNumber: 2,
      sessions: [
        {
          id: "w2-lift-1",
          weekNumber: 2,
          sequence: 1,
          day: "monday",
          kind: "lifting",
          title: "Squat",
          exercises: [],
        },
      ],
    },
  ],
} as unknown as TrainingProgram;

function log(
  sessionId: string,
  status: WorkoutLog["status"],
  programVersion = 1,
): WorkoutLog {
  return {
    programId: "program",
    programVersion,
    sessionId,
    weekNumber: sessionId.startsWith("w1") ? 1 : 2,
    sessionSequence: sessionId.endsWith("2") ? 2 : 1,
    status,
    exerciseLogs:
      sessionId === "w1-lift-1"
        ? [
            {
              prescriptionId: "w1-s1-squat",
              prescribedExerciseId: "competition_squat",
              exerciseId: "competition_squat",
              exerciseName: "Competition squat",
              performanceSeriesId: "competition_squat",
              missReason: "too_hard",
              painEvent: {
                impact: "stopped_exercise",
                followUp: "same",
              },
              sets: [
                {
                  setNumber: 1,
                  reps: 5,
                  load: 200,
                  rir: 1,
                  completed: true,
                  techniqueOkay: false,
                  pain: true,
                },
                { setNumber: 2, completed: false },
              ],
            },
          ]
        : [],
    ...(sessionId === "w1-lift-1"
      ? {
          cardioLog: {
            completedMinutes: 15,
            movingMinutes: 13,
            sessionRpe: 7,
            distance: 1.2,
            distanceUnit: "mi",
            steps: 2400,
            averageHeartRate: 151,
            elevationGain: 120,
            elevationUnit: "ft",
            surface: "road",
            source: "watch",
          },
        }
      : {}),
    ...(status === "partial" ? { missReason: "too_hard" } : {}),
  };
}

describe("weekly review preparation", () => {
  it("waits until every formal workout in the first unreviewed week is final", () => {
    expect(
      nextWeeklyReview(program, [log("w1-lift-1", "partial")], []),
    ).toBeUndefined();
    expect(
      nextWeeklyReview(
        program,
        [log("w1-lift-1", "partial"), log("w1-lift-2", "skipped")],
        [],
      ),
    ).toBe(1);
  });

  it("moves to the next week only after the earlier review is recorded", () => {
    const logs = [
      log("w1-lift-1", "completed"),
      log("w1-lift-2", "completed"),
      log("w2-lift-1", "completed", 2),
    ];
    expect(nextWeeklyReview(program, logs, [1])).toBe(2);
  });

  it("converts pain, technique, effort, and reason feedback for the engine", () => {
    const weeks = toWeekLogs(program, [log("w1-lift-1", "partial")], 1);
    expect(weeks[0]?.sessions[0]).toMatchObject({
      missReason: "too_hard",
      cardioCompletedMinutes: 15,
      cardioSessionRpe: 7,
      cardioDistance: 1.2,
      cardioDistanceUnit: "mi",
      cardioSteps: 2400,
      cardioMovingMinutes: 13,
      cardioAverageHeartRate: 151,
      cardioElevationGain: 120,
      cardioSurface: "road",
      cardioSource: "watch",
      exercises: [
        {
          missReason: "too_hard",
          painEvent: {
            impact: "stopped_exercise",
            followUp: "same",
          },
          sets: [
            {
              reps: 5,
              load: 200,
              rir: 1,
              completed: true,
              techniqueOkay: false,
              pain: true,
            },
            { reps: 0, completed: false },
          ],
        },
      ],
    });
  });

  it("preserves actual cardio activity and exercise context into the review engine", () => {
    const saved = log("w1-lift-1", "completed");
    saved.cardioLog = {
      ...saved.cardioLog,
      modality: "cycling",
      prescribedModality: "walking",
    };
    saved.exerciseLogs[0]!.prescriptionContext = {
      purpose: "strength",
      phase: "strength",
      reps: { min: 5, max: 5 },
      targetRir: { min: 2, max: 2 },
      load: 200,
    };
    const [week] = toWeekLogs(program, [saved], 1);
    expect(week?.sessions[0]).toMatchObject({
      cardioModality: "cycling",
      cardioPrescribedModality: "walking",
      exercises: [
        {
          performanceSeriesId: "competition_squat",
          prescriptionContext: saved.exerciseLogs[0]!.prescriptionContext,
        },
      ],
    });
    expect(
      weeklyBreakdown(program, [saved], 1)[0]?.sessions[0]?.cardio?.name,
    ).toBe("cycling cardio");
  });

  it("summarizes planned versus completed lifting and cardio", () => {
    const metrics = summarizeWeek(
      program,
      [log("w1-lift-1", "partial"), log("w1-lift-2", "skipped")],
      1,
    );
    expect(metrics).toMatchObject({
      plannedSessions: 2,
      partialSessions: 1,
      skippedSessions: 1,
      plannedSets: 2,
      completedSets: 1,
      requiredPlannedSets: 2,
      requiredCompletedSets: 1,
      plannedCardioMinutes: 20,
      completedCardioMinutes: 15,
      cardioDistance: 1.2,
      cardioSteps: 2400,
      cardioMovingMinutes: 13,
      cardioElevationGain: 120,
      cardioElevationUnit: "ft",
    });
  });

  it("shows pain-stopped, skipped, and cardio work on the correct days", () => {
    const days = weeklyBreakdown(
      program,
      [log("w1-lift-1", "partial"), log("w1-lift-2", "skipped")],
      1,
    );
    expect(days.find((day) => day.label === "Monday")).toMatchObject({
      sessions: [
        {
          status: "pain",
          exercises: [{ status: "pain", role: "primary" }],
          cardio: { status: "partial", distance: 1.2, steps: 2400 },
        },
      ],
    });
    expect(days.find((day) => day.label === "Thursday")).toMatchObject({
      sessions: [{ status: "skipped" }],
    });

    const monday = days.find((day) => day.label === "Monday");
    expect(monday && reviewDayMarks(monday)).toMatchObject([
      { role: "primary", status: "pain" },
      { role: "cardio", status: "partial" },
    ]);
  });

  it("orders a review from the first scheduled weekday after the chosen date", () => {
    const days = weeklyBreakdown(
      program,
      [log("w1-lift-1", "partial"), log("w1-lift-2", "skipped")],
      1,
      "2026-08-18",
    );

    expect(days).toHaveLength(7);
    expect(days.map((day) => [day.label, day.isoDate])).toEqual([
      ["Monday", "2026-08-24"],
      ["Tuesday", "2026-08-25"],
      ["Wednesday", "2026-08-26"],
      ["Thursday", "2026-08-27"],
      ["Friday", "2026-08-28"],
      ["Saturday", "2026-08-29"],
      ["Sunday", "2026-08-30"],
    ]);
    expect(days[0]?.sessions[0]?.status).toBe("pain");
  });
});
