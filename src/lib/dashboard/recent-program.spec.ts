import { describe, expect, it } from "vitest";
import type { ProgramDraftV3 } from "$lib/engine";
import type { TrainingProgram, TrainingSession } from "$lib/domain";
import type { WorkoutLog } from "$lib/workouts";
import { summarizeRecentProgram } from "./recent-program";

function fixture(): ProgramDraftV3 {
  const sessions = [
    { id: "lift", kind: "lifting", day: "monday", sequence: 1 },
    { id: "cardio", kind: "cardio", day: "monday", sequence: 2 },
    { id: "lift-2", kind: "lifting", day: "wednesday", sequence: 3 },
  ].map(
    (session) =>
      ({
        ...session,
        weekNumber: 1,
        title: session.id,
        objective: "",
        exercises: [],
        predictedMinutes: 60,
        targetMinutes: 60,
        durationStatus: "fits" as const,
        explanation: "",
      }) as TrainingSession,
  );
  sessions.push({
    id: "movement",
    kind: "movement",
    sequence: 99,
    weekNumber: 1,
    title: "Daily movement",
    objective: "",
    exercises: [],
    predictedMinutes: 0,
    targetMinutes: 0,
    durationStatus: "fits" as const,
    explanation: "",
    movementTarget: {
      steps: 7_500,
      explanation: "A low-fatigue target based on your current activity.",
    },
  });
  return {
    schemaVersion: 3,
    questionnaireFormValues: { programIcon: "launch_vehicle" },
    inputSnapshot: {
      goals: {
        primary: "health",
        secondary: "cardio",
        primaryWeight: 80,
        startDate: "2026-08-18",
      },
      schedule: { planningStyle: "calendar_days" },
    },
    program: {
      horizonWeeks: 1,
      weeks: [
        {
          weekNumber: 1,
          phase: "accumulation",
          hardSetBudget: 1,
          explanation: "",
          sessions,
        },
      ],
    } as unknown as TrainingProgram,
  } as unknown as ProgramDraftV3;
}

function log(
  sessionId: string,
  status: WorkoutLog["status"],
  weekNumber = 1,
): WorkoutLog {
  return {
    programId: "program",
    programVersion: 1,
    sessionId,
    weekNumber,
    sessionSequence: 1,
    status,
    exerciseLogs: [],
  };
}

describe("recent program summary", () => {
  it("treats same-day lifting and cardio as one day and waits for both", () => {
    const partial = summarizeRecentProgram(
      "program",
      fixture(),
      [log("lift", "completed")],
      [],
    );
    expect(partial).toMatchObject({
      totalDays: 2,
      completedDays: 0,
      icon: "launch_vector",
      calendarWeekNumber: 1,
      movementTarget: { headline: "7,500 steps each day" },
    });

    const done = summarizeRecentProgram(
      "program",
      fixture(),
      [log("lift", "completed"), log("cardio", "completed")],
      [],
    );
    expect(done).toMatchObject({
      completedDays: 1,
      highlightSessionId: "lift-2",
    });
  });

  it("moves the dashboard's seven-day calendar to the next released program week", () => {
    const draft = structuredClone(fixture());
    const firstWeek = draft.program.weeks[0];
    if (firstWeek === undefined) throw new Error("Expected week one");
    draft.program.horizonWeeks = 2;
    draft.program.weeks.push({
      ...structuredClone(firstWeek),
      weekNumber: 2,
      sessions: firstWeek.sessions.map((session) => ({
        ...structuredClone(session),
        id: session.id
          .replace("movement", "movement-2")
          .replace("lift", "w2-lift")
          .replace("cardio", "w2-cardio"),
        weekNumber: 2,
      })),
    });
    const summary = summarizeRecentProgram(
      "program",
      draft,
      [
        log("lift", "completed"),
        log("cardio", "completed"),
        log("lift-2", "completed"),
      ],
      [1],
    );

    expect(summary.calendarWeekNumber).toBe(2);
    expect(summary.calendarDays).toHaveLength(7);
    expect(summary.calendarDays[0]?.isoDate).toBe("2026-08-31");
    expect(summary.highlightSessionId).toBe("w2-lift");
  });

  it("places Sunday after the first Monday workout instead of before it", () => {
    const draft = structuredClone(fixture());
    draft.inputSnapshot.goals.startDate = "2026-08-30";
    const firstWeek = draft.program.weeks[0];
    const template = firstWeek?.sessions.find(
      (candidate) => candidate.kind === "lifting",
    );
    if (firstWeek === undefined || template === undefined)
      throw new Error("Expected a lifting session in week one");

    firstWeek.sessions = [
      {
        ...structuredClone(template),
        id: "w1-monday",
        sequence: 1,
        day: "monday",
      },
      {
        ...structuredClone(template),
        id: "w1-sunday",
        sequence: 2,
        day: "sunday",
      },
    ];

    const summary = summarizeRecentProgram("program", draft, [], []);

    expect(summary.calendarDays[0]).toMatchObject({
      isoDate: "2026-08-31",
      day: "monday",
      sessionIds: ["w1-monday"],
    });
    expect(summary.calendarDays.at(-1)).toMatchObject({
      isoDate: "2026-09-06",
      day: "sunday",
      sessionIds: ["w1-sunday"],
    });
    expect(summary.highlightSessionId).toBe("w1-monday");
  });

  it("previews the upcoming week while the previous week's review is due", () => {
    const draft = structuredClone(fixture());
    draft.inputSnapshot.goals.startDate = "2026-08-24";
    const firstWeek = draft.program.weeks[0];
    const session = firstWeek?.sessions.find(
      (candidate) => candidate.kind === "lifting",
    );
    if (firstWeek === undefined || session === undefined)
      throw new Error("Expected a lifting session in week one");

    const firstSunday = {
      ...structuredClone(session),
      id: "w1-sun",
      weekNumber: 1,
      sequence: 1,
      day: "sunday" as const,
    };
    const secondSunday = {
      ...structuredClone(firstSunday),
      id: "w2-sun",
      weekNumber: 2,
    };
    draft.program.horizonWeeks = 2;
    draft.program.weeks = [
      { ...firstWeek, sessions: [firstSunday] },
      {
        ...structuredClone(firstWeek),
        weekNumber: 2,
        sessions: [secondSunday],
      },
    ];

    const summary = summarizeRecentProgram(
      "program",
      draft,
      [log("w1-sun", "completed")],
      [],
    );

    expect(summary.nextAction).toMatchObject({
      kind: "review",
      title: "Review week 1",
    });
    expect(summary.calendarEnabled).toBe(false);
    expect(summary.calendarWeekNumber).toBe(2);
    expect(
      summary.calendarDays.find((day) => day.sessionIds.includes("w2-sun")),
    ).toMatchObject({
      isoDate: "2026-09-06",
      day: "sunday",
      weekNumber: 2,
    });
    expect(
      summary.calendarDays.some((day) => day.sessionIds.includes("w1-sun")),
    ).toBe(false);
    expect(summary.highlightSessionId).toBeUndefined();
  });

  it("gates the next workout behind a due weekly review", () => {
    const summary = summarizeRecentProgram(
      "program",
      fixture(),
      [
        log("lift", "completed"),
        log("cardio", "completed"),
        log("lift-2", "completed"),
      ],
      [],
    );
    expect(summary.nextAction).toMatchObject({
      kind: "review",
      title: "Review week 1",
    });
    expect(summary.calendarDays).toHaveLength(7);
    expect(summary.startDate).toBe("2026-08-18");
    expect(summary.highlightSessionId).toBeUndefined();
  });
});
