import type {
  ExercisePrescription,
  QuestionnaireInput,
  TrainingProgram,
  TrainingSession,
} from "$lib/domain";
import { sanitizeSessionSetBlocks } from "$lib/domain";
import { describe, expect, it } from "vitest";
import {
  estimatedOneRepMax,
  loadRecommendation,
  nextWorkoutSession,
  latestWorkoutLogs,
  parseWorkoutLogRow,
  sessionLabel,
  sessionSetBlocks,
  suspiciousRirEstimate,
  type WorkoutLog,
} from ".";

describe("RIR entry checks", () => {
  it("calculates an estimated one-rep max from load, reps, and RIR", () => {
    expect(estimatedOneRepMax(300, 5, 2)).toBe(370);
  });

  it("flags a value more than twenty percent above the current estimate", () => {
    expect(suspiciousRirEstimate(300, 5, 12, 350)).toMatchObject({
      enteredEstimate: 470,
      referenceEstimate: 350,
    });
  });

  it("does not block a plausible entry or treat values above the hard ceiling as overridable warnings", () => {
    expect(suspiciousRirEstimate(300, 5, 2, 350)).toBeUndefined();
    expect(suspiciousRirEstimate(300, 5, 13, 350)).toBeUndefined();
  });
});

const prescription: ExercisePrescription = {
  id: "w2-session-1-dumbbell_bench",
  exerciseId: "dumbbell_bench",
  performanceSeriesId: "dumbbell_bench:hypertrophy",
  name: "Dumbbell bench press",
  purpose: "hypertrophy",
  sets: 3,
  reps: { min: 10, max: 10 },
  targetRir: { min: 2, max: 3 },
  restSeconds: 120,
  priority: 2,
  optional: false,
  progression: { method: "double_progression", instruction: "" },
  alternativeChoices: [],
  explanation: "",
  ruleIds: [],
};

const program = {
  loadSettings: { units: "lb", barbellIncrement: 5, dumbbellIncrement: 5 },
  weeks: [],
} as unknown as TrainingProgram;

function log(
  sets: WorkoutLog["exerciseLogs"][number]["sets"],
  weekNumber = 1,
): WorkoutLog {
  return {
    programId: "program",
    programVersion: 1,
    sessionId: `w${weekNumber}-session-1`,
    weekNumber,
    sessionSequence: 1,
    status: "completed",
    exerciseLogs: [
      {
        prescriptionId: "w1-session-1-dumbbell_bench",
        prescribedExerciseId: "dumbbell_bench",
        exerciseId: "dumbbell_bench",
        exerciseName: "Dumbbell bench press",
        performanceSeriesId: "dumbbell_bench:hypertrophy",
        prescriptionContext: {
          purpose: prescription.purpose,
          reps: { ...prescription.reps },
          targetRir: { ...prescription.targetRir },
        },
        sets,
      },
    ],
  };
}

describe("loadRecommendation", () => {
  it("carries weight forward when the bounded prescription adds a rep", () => {
    const next = {
      ...prescription,
      reps: { min: 11, max: 11 },
      progression: { ...prescription.progression, repFloor: 8, repCeiling: 12 },
    };
    const sets = Array.from({ length: 3 }, (_, index) => ({
      setNumber: index + 1,
      load: 40,
      reps: 10,
      rir: 2,
      completed: true,
    }));
    expect(loadRecommendation(next, program, [log(sets)], 2)).toMatchObject({
      kind: "repeat",
      load: 40,
    });
  });

  it("does not advance display-only weight for a bounded rep ladder", () => {
    const bounded = {
      ...prescription,
      progression: { ...prescription.progression, repFloor: 8, repCeiling: 10 },
    };
    const sets = Array.from({ length: 3 }, (_, index) => ({
      setNumber: index + 1,
      load: 40,
      reps: 10,
      rir: 2,
      completed: true,
    }));
    expect(
      loadRecommendation(bounded, program, [log(sets, 1), log(sets, 2)], 3),
    ).toMatchObject({ kind: "repeat", load: 40 });
  });

  it("calibrates rather than borrowing another role's weight", () => {
    const history = log([
      { setNumber: 1, load: 40, reps: 10, rir: 2, completed: true },
    ]);
    history.exerciseLogs[0]!.prescriptionContext!.contextRole = "light";
    expect(
      loadRecommendation(
        { ...prescription, contextRole: "heavy" },
        program,
        [history],
        2,
      ).kind,
    ).toBe("calibrate");
  });

  it("holds ambiguous legacy history without a recoverable occurrence context", () => {
    const history = log([
      { setNumber: 1, load: 40, reps: 10, rir: 2, completed: true },
    ]);
    delete history.exerciseLogs[0]!.prescriptionContext;
    expect(loadRecommendation(prescription, program, [history], 2).kind).toBe(
      "calibrate",
    );
  });

  it("calibrates an exercise without earlier logged load", () => {
    expect(loadRecommendation(prescription, program, [], 1).kind).toBe(
      "calibrate",
    );
  });

  it("adds the dumbbell increment after two successful exposures", () => {
    const result = loadRecommendation(
      prescription,
      program,
      [
        log(
          [
            { setNumber: 1, load: 40, reps: 10, rir: 2, completed: true },
            { setNumber: 2, load: 40, reps: 10, rir: 2, completed: true },
            { setNumber: 3, load: 40, reps: 10, rir: 2, completed: true },
          ],
          1,
        ),
        log(
          [
            { setNumber: 1, load: 40, reps: 10, rir: 2, completed: true },
            { setNumber: 2, load: 40, reps: 10, rir: 2, completed: true },
            { setNumber: 3, load: 40, reps: 10, rir: 2, completed: true },
          ],
          2,
        ),
      ],
      3,
    );
    expect(result).toMatchObject({ kind: "increase", load: 45 });
  });

  it("repeats the load for one week after the user keeps an ask-first proposal", () => {
    const result = loadRecommendation(
      prescription,
      program,
      [
        log(
          [
            { setNumber: 1, load: 40, reps: 10, rir: 2, completed: true },
            { setNumber: 2, load: 40, reps: 10, rir: 2, completed: true },
            { setNumber: 3, load: 40, reps: 10, rir: 2, completed: true },
          ],
          1,
        ),
        log(
          [
            { setNumber: 1, load: 40, reps: 10, rir: 2, completed: true },
            { setNumber: 2, load: 40, reps: 10, rir: 2, completed: true },
            { setNumber: 3, load: 40, reps: 10, rir: 2, completed: true },
          ],
          2,
        ),
      ],
      3,
      { holdProgression: true },
    );
    expect(result).toMatchObject({ kind: "repeat", load: 40 });
    expect(result.text).toContain("kept the current plan");
  });

  it("repeats after one successful exposure before progressing", () => {
    const result = loadRecommendation(
      prescription,
      program,
      [
        log([
          { setNumber: 1, load: 40, reps: 10, rir: 2, completed: true },
          { setNumber: 2, load: 40, reps: 10, rir: 2, completed: true },
          { setNumber: 3, load: 40, reps: 10, rir: 2, completed: true },
        ]),
      ],
      2,
    );
    expect(result).toMatchObject({ kind: "repeat", load: 40 });
  });

  it("preserves an actual load between configured recommendation increments", () => {
    const result = loadRecommendation(
      { ...prescription, sets: 4 },
      program,
      [
        log([
          { setNumber: 1, load: 10, reps: 10, rir: 2, completed: true },
          { setNumber: 2, load: 10, reps: 10, rir: 2, completed: true },
          { setNumber: 3, load: 15, reps: 10, rir: 2, completed: true },
          { setNumber: 4, load: 15, reps: 10, rir: 2, completed: true },
        ]),
      ],
      2,
    );

    expect(result).toMatchObject({ kind: "repeat", load: 12.5 });
  });

  it("repeats a load when prescribed reps are met but effort is slightly above target", () => {
    const result = loadRecommendation(
      prescription,
      program,
      [
        log([
          { setNumber: 1, load: 40, reps: 10, rir: 1.5, completed: true },
          { setNumber: 2, load: 40, reps: 10, rir: 1.5, completed: true },
          { setNumber: 3, load: 40, reps: 10, rir: 1.5, completed: true },
        ]),
      ],
      2,
    );
    expect(result).toMatchObject({ kind: "repeat", load: 40 });
  });

  it("does not increase a load when effort was not logged", () => {
    const result = loadRecommendation(
      prescription,
      program,
      [
        log([
          { setNumber: 1, load: 40, reps: 10, completed: true },
          { setNumber: 2, load: 40, reps: 10, completed: true },
          { setNumber: 3, load: 40, reps: 10, completed: true },
        ]),
      ],
      2,
    );
    expect(result).toMatchObject({ kind: "repeat", load: 40 });
  });

  it("reduces a load after missed work", () => {
    const result = loadRecommendation(
      prescription,
      program,
      [
        log([
          { setNumber: 1, load: 40, reps: 8, rir: 1, completed: true },
          { setNumber: 2, load: 40, reps: 6, rir: 0, completed: true },
          { setNumber: 3, load: 40, reps: 0, completed: false },
        ]),
      ],
      2,
    );
    expect(result).toMatchObject({ kind: "reduce", load: 35 });
  });
});

describe("workout navigation", () => {
  const input = {
    schedule: { planningStyle: "flexible_sequence" },
  } as QuestionnaireInput;
  const sessions = [
    {
      id: "one",
      weekNumber: 1,
      sequence: 1,
      kind: "lifting",
      title: "Full body A",
      exercises: [],
    },
    {
      id: "two",
      weekNumber: 1,
      sequence: 2,
      kind: "lifting",
      title: "Full body B",
      exercises: [],
    },
  ] as unknown as TrainingProgram["weeks"][number]["sessions"];
  const navigationProgram = {
    weeks: [
      {
        weekNumber: 1,
        phase: "base",
        sessions,
        hardSetBudget: 0,
        explanation: "",
      },
    ],
  } as TrainingProgram;

  it("labels flexible sessions by sequence", () => {
    expect(sessionLabel(sessions[0], "flexible_sequence")).toBe(
      "Day 1: Full body A",
    );
  });

  it("returns an in-progress workout before a new one", () => {
    const current = nextWorkoutSession(navigationProgram, input, [
      {
        programId: "program",
        programVersion: 1,
        sessionId: "one",
        weekNumber: 1,
        sessionSequence: 1,
        status: "in_progress",
        exerciseLogs: [],
      },
    ]);
    expect(current?.session.id).toBe("one");
  });

  it("advances after a workout is finished as partial", () => {
    const current = nextWorkoutSession(navigationProgram, input, [
      {
        programId: "program",
        programVersion: 1,
        sessionId: "one",
        weekNumber: 1,
        sessionSequence: 1,
        status: "partial",
        exerciseLogs: [],
      },
    ]);
    expect(current?.session.id).toBe("two");
  });
});

describe("workout set blocks", () => {
  function pairedSession(rounds: number): TrainingSession {
    const first = { ...prescription, id: "session-first" };
    const second = {
      ...prescription,
      id: "session-second",
      exerciseId: "one_arm_dumbbell_row",
      performanceSeriesId: "one_arm_dumbbell_row",
      name: "One-arm dumbbell row",
    };
    return {
      id: "session",
      weekNumber: 1,
      sequence: 1,
      kind: "lifting",
      title: "Upper body",
      objective: "Complete the planned work.",
      exercises: [first, second],
      setBlocks: [
        {
          id: "session-superset-a",
          type: "paired_superset",
          sequence: [
            { prescriptionId: first.id, orderLabel: "A1" },
            { prescriptionId: second.id, orderLabel: "A2" },
          ],
          rounds,
          transitionSeconds: 20,
          interRoundRestSeconds: 90,
          sameExerciseRecoveryMinimumSeconds: 120,
          fallback: "unpair",
          methodPolicyVersion: "test",
          rationaleCode: "antagonist_accessory",
          evidenceTag: "supported",
          estimatedTimeSavedMinutes: 2,
          instruction: "Alternate both exercises for the planned rounds.",
        },
      ],
      predictedMinutes: 30,
      targetMinutes: 45,
      durationStatus: "fits",
      explanation: "Test session.",
    };
  }

  it("keeps a valid superset whose rounds match both prescriptions", () => {
    expect(sessionSetBlocks(pairedSession(3))).toMatchObject([
      { type: "paired_superset", rounds: 3 },
    ]);
  });

  it("degrades a stale superset instead of hiding required set inputs", () => {
    expect(sessionSetBlocks(pairedSession(2))).toMatchObject([
      {
        type: "straight",
        rounds: 3,
        sequence: [{ prescriptionId: "session-first" }],
      },
      {
        type: "straight",
        rounds: 3,
        sequence: [{ prescriptionId: "session-second" }],
      },
    ]);
  });

  it("repairs stale superset metadata before future sessions are stored", () => {
    const session = pairedSession(2);

    sanitizeSessionSetBlocks(session);

    expect(session.setBlocks).toMatchObject([
      { type: "straight", rounds: 3 },
      { type: "straight", rounds: 3 },
    ]);
  });
});

describe("parseWorkoutLogRow", () => {
  it("ignores malformed nested exercise entries", () => {
    const parsed = parseWorkoutLogRow({
      id: "log",
      program_id: "program",
      program_version: 1,
      session_id: "session",
      week_number: 1,
      session_sequence: 1,
      status: "completed",
      exercise_logs: [{ invalid: true }],
      cardio_log: {},
      duration_minutes: null,
      miss_reason: null,
      started_at: "2026-08-07T00:00:00Z",
      completed_at: null,
      updated_at: "2026-08-07T00:00:00Z",
    });
    expect(parsed.exerciseLogs).toEqual([]);
  });

  it("keeps structured technique, pain, and miss-reason feedback", () => {
    const parsed = parseWorkoutLogRow({
      id: "log",
      program_id: "program",
      program_version: 1,
      session_id: "session",
      week_number: 1,
      session_sequence: 1,
      status: "partial",
      exercise_logs: [
        {
          prescriptionId: "prescription",
          prescribedExerciseId: "squat",
          exerciseId: "squat",
          exerciseName: "Squat",
          performanceSeriesId: "squat",
          prescriptionContext: {
            purpose: "strength",
            reps: { min: 5, max: 5 },
            targetRir: { min: 2, max: 2 },
            load: 200,
          },
          setBlockId: "session-superset-a",
          setBlockMode: "unpaired",
          missReason: "too_hard",
          painEvent: {
            impact: "stopped_exercise",
            severity: 5,
            onset: "gradual",
            baseline: "new",
            bodyArea: "right knee",
            followUp: "better",
          },
          sets: [
            {
              setNumber: 1,
              reps: 5,
              completed: true,
              techniqueOkay: false,
              pain: true,
            },
          ],
        },
      ],
      cardio_log: {
        modality: "cycling",
        prescribedModality: "running",
        completedMinutes: 30,
        movingMinutes: 27.5,
        sessionRpe: 5,
        distance: 2.5,
        distanceUnit: "mi",
        steps: 4800,
        completedIntervals: 6,
        averageHeartRate: 148,
        maxHeartRate: 172,
        elevationGain: 310,
        elevationUnit: "ft",
        surface: "trail",
        source: "watch",
      },
      movement_log: {
        targetType: "steps",
        target: 7000,
        met: true,
        actualSteps: 7350,
        checkInDate: "2026-08-07",
      },
      duration_minutes: 60,
      miss_reason: "too_hard",
      started_at: "2026-08-07T00:00:00Z",
      completed_at: "2026-08-07T01:00:00Z",
      updated_at: "2026-08-07T01:00:00Z",
    });
    expect(parsed).toMatchObject({
      missReason: "too_hard",
      exerciseLogs: [
        {
          missReason: "too_hard",
          painEvent: {
            impact: "stopped_exercise",
            severity: 5,
            followUp: "better",
          },
          setBlockId: "session-superset-a",
          setBlockMode: "unpaired",
          prescriptionContext: {
            purpose: "strength",
            reps: { min: 5, max: 5 },
            targetRir: { min: 2, max: 2 },
            load: 200,
          },
          sets: [{ techniqueOkay: false, pain: true, completed: true }],
        },
      ],
      cardioLog: {
        modality: "cycling",
        prescribedModality: "running",
        completedMinutes: 30,
        movingMinutes: 27.5,
        sessionRpe: 5,
        distance: 2.5,
        distanceUnit: "mi",
        steps: 4800,
        completedIntervals: 6,
        averageHeartRate: 148,
        maxHeartRate: 172,
        elevationGain: 310,
        elevationUnit: "ft",
        surface: "trail",
        source: "watch",
      },
      movementLog: {
        targetType: "steps",
        target: 7000,
        met: true,
        actualSteps: 7350,
        checkInDate: "2026-08-07",
      },
    });
  });

  it("uses the newest program-version log for a stable session id", () => {
    const older = log([], 1);
    const newer = { ...older, programVersion: 2, status: "partial" as const };
    expect(latestWorkoutLogs([newer, older])).toEqual([newer]);
  });
});
