import { describe, expect, it } from "vitest";
import { adaptProgram, generateProgram, type WeekLog } from "../index.js";
import {
  cardioPriorityInput,
  logExerciseAcrossWeeks,
  meetPowerlifterInput,
} from "./fixtures.js";

function generatedMeetProgram() {
  const program = generateProgram(meetPowerlifterInput()).program;
  if (program === undefined) throw new Error("Expected generated program");
  return program;
}

function completedMovementCheckIns(
  program: ReturnType<typeof generatedMeetProgram>,
  observations: boolean[],
): WeekLog[] {
  const sessions = program.weeks[0]?.sessions.filter(
    (session) => session.kind !== "movement",
  );
  if (sessions === undefined || sessions.length < observations.length)
    throw new Error("Expected enough formal sessions");
  return [
    {
      weekNumber: 1,
      sessions: sessions
        .slice(0, observations.length)
        .map((session, index) => ({
          sessionId: session.id,
          status: "completed" as const,
          movementTargetMet: observations[index],
          exercises: session.exercises.map((prescription) => ({
            prescriptionId: prescription.id,
            exerciseId: prescription.exerciseId,
            sets: Array.from({ length: prescription.sets }, () => ({
              reps: prescription.reps.min,
              load: prescription.load,
              rir:
                (prescription.targetRir.min + prescription.targetRir.max) / 2,
              completed: true,
              techniqueOkay: true,
            })),
          })),
          ...(session.cardio === undefined
            ? {}
            : {
                cardioCompletedMinutes: session.cardio.minutes,
                cardioSessionRpe:
                  (session.cardio.sessionRpe.min +
                    session.cardio.sessionRpe.max) /
                  2,
              }),
        })),
    },
  ];
}

describe("weekly adaptation invariants", () => {
  it("does not progress future work from one easy exposure", () => {
    const program = generatedMeetProgram();
    const logs = logExerciseAcrossWeeks(program, "competition_squat", [1], 2);
    const result = adaptProgram(program, logs);
    expect(result.state).not.toBe("safety_constrained");
    expect(result.program.version).toBe(program.version);
    expect(result.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "hold", applied: false }),
      ]),
    );
  });

  it("progresses local load after two comparable easy exposures and holds sets", () => {
    const program = generatedMeetProgram();
    const beforeWeek3 = program.weeks[2]?.sessions
      .flatMap((session) => session.exercises)
      .find((item) => item.exerciseId === "competition_squat");
    const logs = logExerciseAcrossWeeks(
      program,
      "competition_squat",
      [1, 2],
      2,
    );
    const result = adaptProgram(program, logs);
    const afterWeek3 = result.program.weeks[2]?.sessions
      .flatMap((session) => session.exercises)
      .find((item) => item.exerciseId === "competition_squat");
    expect(result.state).toBe("underloaded");
    expect(result.program.version).toBe(2);
    expect(afterWeek3?.load).toBeGreaterThan(beforeWeek3?.load ?? 0);
    expect(afterWeek3?.sets).toBe(beforeWeek3?.sets);
    expect(result.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "load", applied: true }),
      ]),
    );
  });

  it("uses a wearable recovery trend only to pause an otherwise supported increase", () => {
    const program = generatedMeetProgram();
    const logs = logExerciseAcrossWeeks(
      program,
      "competition_squat",
      [1, 2],
      2,
    );
    const result = adaptProgram(program, logs, {
      applyChanges: true,
      wearable: {
        source: "Apple Health",
        currentDays: 4,
        baselineDays: 7,
        caution: true,
        reasons: ["Average sleep was below the recent baseline."],
        averageSleepMinutes: 390,
        baselineSleepMinutes: 480,
      },
    });
    expect(result.state).toBe("underloaded");
    expect(result.program.version).toBe(program.version);
    expect(result.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "hold",
          target: "next-week progression",
          applied: false,
        }),
      ]),
    );
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "wearable-recovery-trend" }),
      ]),
    );
  });

  it("promotes canonical 0.10 load settings without doubling them", () => {
    const program = generatedMeetProgram();
    program.engineVersion = "0.10.0";
    program.loadSettings.barbellIncrement = 5;
    const logs = logExerciseAcrossWeeks(
      program,
      "competition_squat",
      [1, 2],
      2,
    );
    const result = adaptProgram(program, logs);
    expect(result.program.version).toBe(2);
    expect(result.program.loadSettings.barbellIncrement).toBe(5);
  });

  it("normalizes a pre-0.10 per-side plate value when adaptation promotes it", () => {
    const program = generatedMeetProgram();
    program.engineVersion = "0.9.0";
    program.loadSettings.barbellIncrement = 2.5;
    const logs = logExerciseAcrossWeeks(
      program,
      "competition_squat",
      [1, 2],
      2,
    );
    const result = adaptProgram(program, logs);
    expect(result.program.version).toBe(2);
    expect(result.program.loadSettings.barbellIncrement).toBe(5);
  });

  it("does not stack another increase from only one exposure at the new program version", () => {
    const program = generatedMeetProgram();
    const firstLogs = logExerciseAcrossWeeks(
      program,
      "competition_squat",
      [1, 2],
      2,
    ).map((week) => ({
      ...week,
      sessions: week.sessions.map((session) => ({
        ...session,
        programVersion: 1,
      })),
    }));
    const first = adaptProgram(program, firstLogs);
    const newExposure = logExerciseAcrossWeeks(
      first.program,
      "competition_squat",
      [3],
      2,
    ).map((week) => ({
      ...week,
      sessions: week.sessions.map((session) => ({
        ...session,
        programVersion: 2,
      })),
    }));
    const second = adaptProgram(first.program, [...firstLogs, ...newExposure]);
    expect(second.program.version).toBe(first.program.version);
    expect(second.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "hold", applied: false }),
      ]),
    );
  });

  it("reduces only the local load after two hard exposures", () => {
    const program = generatedMeetProgram();
    const originalBench = program.weeks[2]?.sessions
      .flatMap((session) => session.exercises)
      .find((item) => item.exerciseId === "competition_bench");
    const originalSquat = program.weeks[2]?.sessions
      .flatMap((session) => session.exercises)
      .find((item) => item.exerciseId === "competition_squat");
    const logs = logExerciseAcrossWeeks(
      program,
      "competition_bench",
      [1, 2],
      -3,
    );
    const result = adaptProgram(program, logs);
    const changedBench = result.program.weeks[2]?.sessions
      .flatMap((session) => session.exercises)
      .find((item) => item.exerciseId === "competition_bench");
    const unchangedSquat = result.program.weeks[2]?.sessions
      .flatMap((session) => session.exercises)
      .find((item) => item.exerciseId === "competition_squat");
    expect(result.state).toBe("physiologically_overloaded");
    expect(changedBench?.load).toBeLessThan(originalBench?.load ?? Infinity);
    expect(unchangedSquat?.load).toBe(originalSquat?.load);
  });

  it("responds to repeated time misses by trimming low-priority sets without changing load", () => {
    const program = generatedMeetProgram();
    const source1 = program.weeks[0]?.sessions.find(
      (session) => session.kind === "lifting",
    );
    const source2 = program.weeks[1]?.sessions.find(
      (session) => session.kind === "lifting",
    );
    if (source1 === undefined || source2 === undefined)
      throw new Error("Expected sessions");
    const logs: WeekLog[] = [
      {
        weekNumber: 1,
        sessions: [
          {
            sessionId: source1.id,
            status: "partial",
            missReason: "time",
            durationMinutes: source1.targetMinutes,
            exercises: [],
          },
        ],
      },
      {
        weekNumber: 2,
        sessions: [
          {
            sessionId: source2.id,
            status: "partial",
            missReason: "time",
            durationMinutes: source2.targetMinutes,
            exercises: [],
          },
        ],
      },
    ];
    const beforeLoads = program.weeks[2]?.sessions
      .flatMap((session) => session.exercises)
      .map((item) => item.load);
    const result = adaptProgram(program, logs);
    const afterLoads = result.program.weeks[2]?.sessions
      .flatMap((session) => session.exercises)
      .map((item) => item.load);
    expect(result.state).toBe("time_infeasible");
    expect(result.changes).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "sets" })]),
    );
    expect(afterLoads).toEqual(beforeLoads);
  });

  it("does not redesign or lower training max after one travel miss", () => {
    const program = generatedMeetProgram();
    const session = program.weeks[0]?.sessions.find(
      (item) => item.kind === "lifting",
    );
    if (session === undefined) throw new Error("Expected session");
    const log: WeekLog = {
      weekNumber: 1,
      sessions: [
        {
          sessionId: session.id,
          status: "skipped",
          missReason: "travel",
          exercises: [],
        },
      ],
    };
    const result = adaptProgram(program, [log]);
    expect(result.program.version).toBe(1);
    expect(result.changes).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "hold" })]),
    );
  });

  it("responds to one pain report locally without removing future training", () => {
    const program = generatedMeetProgram();
    const originalWeek1 = structuredClone(program.weeks[0]);
    const before = program.weeks[1]?.sessions
      .flatMap((session) => session.exercises)
      .find((item) => item.exerciseId === "competition_bench");
    const logs = logExerciseAcrossWeeks(program, "competition_bench", [1], 0, {
      pain: true,
    });
    const result = adaptProgram(program, logs);
    const after = result.program.weeks[1]?.sessions
      .flatMap((session) => session.exercises)
      .find((item) => item.exerciseId === "competition_bench");
    // This fixture intentionally logs only one exercise exposure, so the
    // weekly classification may remain data-limited. The important invariant
    // is that one pain report triggers a local caution response, not a global
    // safety stop or removal of future training.
    expect(result.state).not.toBe("safety_constrained");
    expect(result.program.weeks[0]).toEqual(originalWeek1);
    expect(after?.targetRir.min).toBe((before?.targetRir.min ?? 0) + 1);
    expect(
      result.program.weeks
        .slice(1)
        .flatMap((week) => week.sessions)
        .flatMap((session) => session.exercises)
        .some((item) => item.exerciseId === "competition_squat"),
    ).toBe(true);
    expect(result.safetySignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          exerciseId: "competition_bench",
          level: "modify_next",
        }),
      ]),
    );
  });

  it("temporarily replaces an exercise after worsening pain feedback", () => {
    const program = generatedMeetProgram();
    const source = program.weeks[0]?.sessions
      .flatMap((session) => session.exercises)
      .find((item) => item.exerciseId === "competition_bench");
    const session = program.weeks[0]?.sessions.find((item) =>
      item.exercises.some((exercise) => exercise.id === source?.id),
    );
    if (source === undefined || session === undefined)
      throw new Error("Expected bench exposure");
    const logs: WeekLog[] = [
      {
        weekNumber: 1,
        sessions: [
          {
            sessionId: session.id,
            status: "partial",
            exercises: [
              {
                prescriptionId: source.id,
                exerciseId: source.exerciseId,
                missReason: "pain",
                painEvent: {
                  impact: "stopped_exercise",
                  followUp: "worse",
                  onset: "gradual",
                },
                sets: [],
              },
            ],
          },
        ],
      },
    ];
    const result = adaptProgram(program, logs);
    const week2Bench = result.program.weeks[1]?.sessions
      .flatMap((item) => item.exercises)
      .find((item) => item.id.includes("bench"));
    expect(result.safetySignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ level: "replace_temporarily" }),
      ]),
    );
    expect(week2Bench?.exerciseId).not.toBe("competition_bench");
    expect(
      result.program.weeks
        .slice(2)
        .flatMap((week) => week.sessions)
        .flatMap((item) => item.exercises)
        .some((item) => item.exerciseId === "competition_bench"),
    ).toBe(true);
  });

  it("calls a week on track when required work is complete and one accessory is missing", () => {
    const program = generatedMeetProgram();
    const sessions = program.weeks[0]?.sessions.filter(
      (session) => session.kind !== "movement",
    );
    if (sessions === undefined || sessions.length === 0)
      throw new Error("Expected formal sessions");
    if (
      !sessions.some((session) =>
        session.exercises.some((item) => item.optional),
      )
    )
      throw new Error("Expected at least one accessory");
    const logs: WeekLog[] = [
      {
        weekNumber: 1,
        sessions: sessions.map((session) => {
          const required = session.exercises.filter(
            (exercise) => !exercise.optional,
          );
          return {
            sessionId: session.id,
            status: session.exercises.some((exercise) => exercise.optional)
              ? ("partial" as const)
              : ("completed" as const),
            exercises: required.map((exercise) => ({
              prescriptionId: exercise.id,
              exerciseId: exercise.exerciseId,
              sets: Array.from({ length: exercise.sets }, () => ({
                reps: exercise.reps.min,
                rir: exercise.targetRir.min,
                completed: true,
              })),
            })),
            ...(session.cardio === undefined
              ? {}
              : {
                  cardioCompletedMinutes: session.cardio.minutes,
                  cardioSessionRpe:
                    (session.cardio.sessionRpe.min +
                      session.cardio.sessionRpe.max) /
                    2,
                }),
          };
        }),
      },
    ];
    expect(adaptProgram(program, logs).state).toBe("on_track");
  });

  it("does not reapply an old pain flag after a new program version starts", () => {
    const program = generatedMeetProgram();
    const painLogs = logExerciseAcrossWeeks(
      program,
      "competition_bench",
      [1],
      0,
      { pain: true },
    ).map((week) => ({
      ...week,
      sessions: week.sessions.map((session) => ({
        ...session,
        programVersion: 1,
      })),
    }));
    const first = adaptProgram(program, painLogs);
    const currentLogs = logExerciseAcrossWeeks(
      first.program,
      "competition_squat",
      [2],
      0,
    ).map((week) => ({
      ...week,
      sessions: week.sessions.map((session) => ({
        ...session,
        programVersion: 2,
      })),
    }));
    const second = adaptProgram(first.program, [...painLogs, ...currentLogs]);
    expect(second.state).not.toBe("safety_constrained");
    expect(second.program.version).toBe(first.program.version);
  });

  it("is idempotent for the same frozen observations", () => {
    const program = generatedMeetProgram();
    const logs = logExerciseAcrossWeeks(
      program,
      "competition_squat",
      [1, 2],
      2,
    );
    const first = adaptProgram(program, logs);
    const second = adaptProgram(first.program, logs);
    expect(second.program.version).toBe(first.program.version);
    expect(second.program).toEqual(first.program);
  });

  it("returns proposals without mutation in approval-first mode", () => {
    const program = generatedMeetProgram();
    program.adaptationSettings.applyChanges = "ask_first";
    const logs = logExerciseAcrossWeeks(
      program,
      "competition_squat",
      [1, 2],
      2,
    );
    const result = adaptProgram(program, logs);
    expect(result.state).toBe("underloaded");
    expect(result.program.version).toBe(program.version);
    expect(result.changes.some((change) => change.applied)).toBe(false);
  });

  it("can apply an approved proposal while preserving approval-first mode", () => {
    const program = generatedMeetProgram();
    program.adaptationSettings.applyChanges = "ask_first";
    const logs = logExerciseAcrossWeeks(
      program,
      "competition_squat",
      [1, 2],
      2,
    );
    const result = adaptProgram(program, logs, { applyChanges: true });
    expect(result.program.version).toBe(program.version + 1);
    expect(result.program.adaptationSettings.applyChanges).toBe("ask_first");
    expect(result.changes.some((change) => change.applied)).toBe(true);
  });

  it("adds five minutes after two comparable cardio sessions below target effort", () => {
    const program = generateProgram(cardioPriorityInput()).program;
    if (program === undefined) throw new Error("Expected cardio program");
    // This case tests progression within a phase; phase transitions are held.
    for (const week of program.weeks.slice(0, 3)) {
      week.phase = "base";
      for (const session of week.sessions)
        if (session.cardio) session.cardio.eventPhase = "base";
    }
    const sessions = program.weeks
      .slice(0, 2)
      .map((week) =>
        week.sessions.find(
          (session) =>
            session.cardio?.intensity === "easy" && session.cardio.minutes > 0,
        ),
      );
    if (sessions.some((session) => session?.cardio === undefined))
      throw new Error("Expected easy cardio sessions");
    const logs: WeekLog[] = sessions.map((session, index) => ({
      weekNumber: index + 1,
      sessions: [
        {
          sessionId: session!.id,
          status: "completed",
          exercises: [],
          cardioCompletedMinutes: session!.cardio!.minutes,
          cardioSessionRpe: session!.cardio!.sessionRpe.min - 1,
        },
      ],
    }));
    const before = program.weeks[2]?.sessions.find(
      (session) => session.cardio?.intensity === "easy",
    )?.cardio?.minutes;
    const result = adaptProgram(program, logs);
    const after = result.program.weeks[2]?.sessions.find(
      (session) => session.cardio?.intensity === "easy",
    )?.cardio?.minutes;
    expect(result.state).toBe("underloaded");
    expect(after).toBe((before ?? 0) + 5);
    expect(result.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "cardio", applied: true }),
      ]),
    );
  });

  it("does not call unexplained incomplete cardio a difficulty problem", () => {
    const program = generateProgram(cardioPriorityInput()).program;
    if (program === undefined) throw new Error("Expected cardio program");
    const sessions = program.weeks
      .slice(0, 2)
      .map((week) => week.sessions.find((session) => session.cardio));
    if (sessions.some((session) => session?.cardio === undefined))
      throw new Error("Expected cardio sessions");
    const logs: WeekLog[] = sessions.map((session, index) => ({
      weekNumber: index + 1,
      sessions: [
        {
          sessionId: session!.id,
          status: "partial",
          missReason: "unknown",
          exercises: [],
          cardioCompletedMinutes: Math.floor(session!.cardio!.minutes / 2),
        },
      ],
    }));
    const result = adaptProgram(program, logs);
    expect(result.state).not.toBe("physiologically_overloaded");
    expect(result.program.version).toBe(program.version);
  });

  it("changes VO2max sessions by one interval instead of making every bout longer", () => {
    const input = cardioPriorityInput();
    input.cardio.goal = {
      type: "vo2max",
      vo2max: { modality: "cycling" },
    };
    const program = generateProgram(input).program;
    if (program === undefined) throw new Error("Expected cardio program");
    for (const week of program.weeks.slice(0, 3)) {
      week.phase = "base";
      for (const session of week.sessions)
        if (session.cardio) session.cardio.eventPhase = "base";
    }
    const sessions = program.weeks
      .slice(0, 2)
      .map((week) =>
        week.sessions.find((session) => session.cardio?.role === "intervals"),
      );
    if (sessions.some((session) => session?.cardio?.intervals === undefined))
      throw new Error("Expected interval sessions");
    const logs: WeekLog[] = sessions.map((session, index) => ({
      weekNumber: index + 1,
      sessions: [
        {
          sessionId: session!.id,
          status: "completed",
          exercises: [],
          cardioCompletedMinutes: session!.cardio!.minutes,
          cardioCompletedIntervals: session!.cardio!.intervals!.repeats,
          cardioSessionRpe: session!.cardio!.sessionRpe.min - 1,
        },
      ],
    }));
    const before = program.weeks[2]?.sessions.find(
      (session) => session.cardio?.role === "intervals",
    )?.cardio?.intervals?.repeats;
    const result = adaptProgram(program, logs);
    const after = result.program.weeks[2]?.sessions.find(
      (session) => session.cardio?.role === "intervals",
    )?.cardio?.intervals?.repeats;
    expect(after).toBe((before ?? 0) + 1);
    expect(result.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "cardio",
          before: expect.stringContaining("work intervals"),
          after: expect.stringContaining("work intervals"),
        }),
      ]),
    );
  });

  it("holds with low confidence when no work is logged", () => {
    const program = generatedMeetProgram();
    const result = adaptProgram(program, []);
    expect(result.state).toBe("insufficient_data");
    expect(result.confidence).toBe("low");
    expect(result.program.version).toBe(program.version);
  });

  it("does not adjust daily movement from one missed target", () => {
    const program = generatedMeetProgram();
    const before = program.weeks[1]?.sessions.find(
      (session) => session.kind === "movement",
    )?.movementTarget;
    const result = adaptProgram(
      program,
      completedMovementCheckIns(program, [false]),
    );
    const after = result.program.weeks[1]?.sessions.find(
      (session) => session.kind === "movement",
    )?.movementTarget;
    expect(result.changes.some((change) => change.type === "movement")).toBe(
      false,
    );
    expect(after).toEqual(before);
  });

  it("moves future daily movement closer after repeated misses", () => {
    const program = generatedMeetProgram();
    const before = program.weeks[1]?.sessions.find(
      (session) => session.kind === "movement",
    )?.movementTarget?.steps;
    const result = adaptProgram(
      program,
      completedMovementCheckIns(program, [false, false]),
    );
    const after = result.program.weeks[1]?.sessions.find(
      (session) => session.kind === "movement",
    )?.movementTarget?.steps;
    expect(after).toBe((before ?? 0) - 500);
    expect(result.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "movement", applied: true }),
      ]),
    );
  });

  it("raises future daily movement only after several successful check-ins", () => {
    const program = generatedMeetProgram();
    const before = program.weeks[1]?.sessions.find(
      (session) => session.kind === "movement",
    )?.movementTarget?.steps;
    const result = adaptProgram(
      program,
      completedMovementCheckIns(program, [true, true, true]),
    );
    const after = result.program.weeks[1]?.sessions.find(
      (session) => session.kind === "movement",
    )?.movementTarget?.steps;
    expect(result.state).toBe("on_track");
    expect(after).toBe((before ?? 0) + 500);
  });
});
