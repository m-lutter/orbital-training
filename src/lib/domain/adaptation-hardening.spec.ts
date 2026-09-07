import { describe, expect, it } from "vitest";
import { adaptProgram } from "./adaptation.js";
import { generateProgram } from "./generator.js";
import { validateGeneratedProgram } from "./generation-invariants.js";
import { createStoredProgramV3 } from "../engine/v3.js";
import { parseProgramDraft } from "../engine/parse.js";
import { ENGINE_VERSION, POLICY_VERSION } from "./policy.js";
import {
  estimateSessionMinutes,
  synchronizeCardioDuration,
} from "./duration.js";
import type {
  CardioPrescription,
  ExercisePrescription,
  TrainingProgram,
  WeekLog,
} from "./types.js";
import {
  meetPowerlifterInput,
  logExerciseAcrossWeeks,
} from "./tests/fixtures.js";

function plan(): TrainingProgram {
  const program = generateProgram(meetPowerlifterInput()).program!;
  const source = program.weeks[0]!.sessions.find(
    (session) => session.exercises.length,
  )!;
  const exercise: ExercisePrescription = {
    ...structuredClone(source.exercises[0]!),
    exerciseId: "competition_squat",
    performanceSeriesId: "squat-main",
    phase: "base",
    contextRole: "heavy",
    purpose: "strength",
    sets: 3,
    reps: { min: 5, max: 5 },
    targetRir: { min: 2, max: 2 },
    load: 100,
    percentE1rm: 0.7,
    progression: {
      method: "percentage_wave",
      instruction: "wave",
      requiredSuccessfulExposures: 2,
    },
  };
  program.weeks = Array.from({ length: 6 }, (_, index) => ({
    weekNumber: index + 1,
    phase: "base",
    hardSetBudget: 3,
    explanation: "test",
    sessions: [
      {
        ...structuredClone(source),
        id: `w${index + 1}-lift-1`,
        weekNumber: index + 1,
        exercises: [
          { ...structuredClone(exercise), id: `w${index + 1}-squat` },
        ],
        setBlocks: [],
        cardio: undefined,
      },
    ],
  }));
  return program;
}

function exercise(
  program: TrainingProgram,
  week: number,
): ExercisePrescription {
  return program.weeks[week - 1]!.sessions[0]!.exercises[0]!;
}

function logs(
  program: TrainingProgram,
  weeks = [1, 2],
  rir = 4,
  snapshots = true,
): WeekLog[] {
  return weeks.map((weekNumber) => {
    const item = exercise(program, weekNumber);
    return {
      weekNumber,
      sessions: [
        {
          sessionId: program.weeks[weekNumber - 1]!.sessions[0]!.id,
          programVersion: program.version,
          status: "completed",
          exercises: [
            {
              prescriptionId: item.id,
              exerciseId: item.exerciseId,
              performanceSeriesId: item.performanceSeriesId,
              ...(snapshots
                ? {
                    prescriptionContext: {
                      purpose: item.purpose,
                      phase: item.phase,
                      contextRole: item.contextRole,
                      reps: { ...item.reps },
                      targetRir: { ...item.targetRir },
                      load: item.load,
                      percentE1rm: item.percentE1rm,
                    },
                  }
                : {}),
              sets: Array.from({ length: item.sets }, () => ({
                completed: true,
                reps: item.reps.min,
                load: item.load,
                rir,
                techniqueOkay: true,
              })),
            },
          ],
        },
      ],
    };
  });
}

describe("adaptation lineage and bounded prescriptions", () => {
  it.each(["load", "time", "pain", "persistent_pain", "urgent_pain"] as const)(
    "roundtrips an integrity-versioned %s mutation with matching wrapper provenance",
    (kind) => {
      const input = meetPowerlifterInput();
      const program = generateProgram(input).program!;
      const history = logExerciseAcrossWeeks(
        program,
        "competition_squat",
        [1, 2],
        kind === "load" ? 2 : 0,
      );
      if (kind === "time")
        for (const week of history) week.sessions[0]!.missReason = "time";
      if (kind.includes("pain")) {
        history.splice(0, 1);
        history[0]!.sessions[0]!.exercises[0]!.painEvent = {
          impact: "modified",
          followUp: kind === "persistent_pain" ? "worse" : "not_checked",
          urgentWarningSigns: kind === "urgent_pain",
        };
      }
      const result = adaptProgram(program, history);
      expect(result.program.version).toBe(program.version + 1);
      expect(validateGeneratedProgram(result.program)).toEqual([]);
      const stored = JSON.parse(
        JSON.stringify(createStoredProgramV3(input, result.program)),
      );
      expect(parseProgramDraft(stored)).toEqual(stored);
    },
  );

  it("does not pool heavy and light roles of the same exercise", () => {
    const program = plan();
    exercise(program, 2).contextRole = "light";
    expect(adaptProgram(program, logs(program)).program.version).toBe(
      program.version,
    );
  });

  it("retains distinct future waves, percentages, other phases and completed history", () => {
    const program = plan();
    exercise(program, 3).load = 105;
    exercise(program, 4).load = 115;
    program.weeks[4]!.phase = "strength";
    exercise(program, 5).phase = "strength";
    program.weeks[5]!.phase = "taper";
    exercise(program, 6).phase = "taper";
    const result = adaptProgram(program, logs(program));
    expect(exercise(result.program, 3).load).toBe(110);
    expect(exercise(result.program, 4).load).toBe(120);
    expect(exercise(result.program, 3).percentE1rm).toBeCloseTo(
      (0.7 * 110) / 105,
      4,
    );
    expect(result.program.weeks.slice(0, 2)).toEqual(program.weeks.slice(0, 2));
    expect(result.program.weeks.slice(4)).toEqual(program.weeks.slice(4));
  });

  it("requires complete work and effort rather than selecting only easy completed sets", () => {
    const program = plan();
    const history = logs(program);
    for (const week of history) week.sessions[0]!.exercises[0]!.sets.pop();
    expect(adaptProgram(program, history).program.version).toBe(
      program.version,
    );
  });

  it("cannot manufacture repeated exposure evidence from duplicate sessions or exercises", () => {
    const program = plan();
    const history = logs(program, [1]);
    history[0]!.sessions[0]!.exercises.push(
      structuredClone(history[0]!.sessions[0]!.exercises[0]!),
    );
    history[0]!.sessions.push(history[0]!.sessions[0]!);
    expect(
      adaptProgram(program, [history[0]!, history[0]!]).program.version,
    ).toBe(program.version);
  });

  it("does not treat one difficult exposure in each of two roles as repeated local overload", () => {
    const program = plan();
    exercise(program, 2).contextRole = "light";
    const history = logs(program, [1, 2], 0);
    for (const week of history) week.sessions[0]!.missReason = "too_hard";
    expect(adaptProgram(program, history).program.version).toBe(
      program.version,
    );
  });

  it("advances exact reps within bounds and resets them only with a load increase at the ceiling", () => {
    const program = plan();
    for (const week of program.weeks) {
      const item = week.sessions[0]!.exercises[0]!;
      item.progression = {
        method: "double_progression",
        instruction: "bounded",
        repFloor: 8,
        repCeiling: 10,
      };
      item.reps = { min: 8, max: 8 };
      item.load = 20;
      delete item.percentE1rm;
    }
    const repResult = adaptProgram(program, logs(program, [1, 2], 2));
    expect(exercise(repResult.program, 3)).toMatchObject({
      reps: { min: 9, max: 9 },
      load: 20,
      targetRir: { min: 2, max: 2 },
    });
    expect(repResult.changes[0]).toMatchObject({
      before: "8 reps",
      after: "9 reps",
    });
    for (const week of program.weeks)
      week.sessions[0]!.exercises[0]!.reps = { min: 10, max: 10 };
    const loadResult = adaptProgram(program, logs(program, [1, 2], 2));
    expect(exercise(loadResult.program, 3)).toMatchObject({
      reps: { min: 8, max: 8 },
      load: 25,
    });
  });

  it("holds a legacy unloaded one-point rep target rather than growing it without bound", () => {
    const program = plan();
    for (const week of program.weeks) {
      const item = week.sessions[0]!.exercises[0]!;
      delete item.load;
      delete item.percentE1rm;
      item.progression = { method: "calibration", instruction: "find a load" };
    }
    expect(adaptProgram(program, logs(program)).program.version).toBe(
      program.version,
    );
  });

  it("uses context-proven mixed-version evidence, rejects ambiguous legacy history, and does not replay consumed evidence", () => {
    const program = plan();
    program.version = 2;
    const history = logs(program);
    history[0]!.sessions[0]!.programVersion = 1;
    const result = adaptProgram(program, history);
    expect(result.program.version).toBe(3);
    const unproven = structuredClone(history);
    delete unproven[0]!.sessions[0]!.exercises[0]!.prescriptionContext;
    expect(adaptProgram(program, unproven).program.version).toBe(2);
    expect(
      adaptProgram(result.program, [...history, ...logs(result.program, [3])])
        .program.version,
    ).toBe(3);
  });

  it("records original and mutating provenance separately", () => {
    const program = plan();
    program.engineVersion = "0.11.0";
    program.policyVersion = "old-policy";
    delete program.originEngineVersion;
    delete program.originPolicyVersion;
    const result = adaptProgram(program, logs(program));
    expect(result.program).toMatchObject({
      engineVersion: ENGINE_VERSION,
      policyVersion: POLICY_VERSION,
      originEngineVersion: "0.11.0",
      originPolicyVersion: "old-policy",
    });
    expect(result.changes[0]).toMatchObject({
      engineVersion: ENGINE_VERSION,
      policyVersion: POLICY_VERSION,
    });
  });

  it("reports urgent safety as the primary state and performs no routine progression", () => {
    const program = plan();
    const history = logs(program);
    history[1]!.sessions[0]!.exercises[0]!.painEvent = {
      impact: "stopped_workout",
      urgentWarningSigns: true,
    };
    const result = adaptProgram(program, history);
    expect(result.state).toBe("safety_constrained");
    expect(
      result.changes.some(
        (change) => change.type === "load" || change.type === "reps",
      ),
    ).toBe(false);
    expect(
      result.warnings.some((warning) => warning.severity === "blocking"),
    ).toBe(true);
  });

  it("handles new urgent feedback from a context-proven older version without replaying it", () => {
    const program = plan();
    program.version = 2;
    const history = logs(program, [1]);
    history[0]!.sessions[0]!.programVersion = 1;
    history[0]!.sessions[0]!.exercises[0]!.painEvent = {
      impact: "stopped_workout",
      urgentWarningSigns: true,
    };
    const result = adaptProgram(program, history);
    expect(result.state).toBe("safety_constrained");
    expect(result.program.version).toBe(3);
    // Changing unrelated input cannot make the already-handled pain mutate again.
    history[0]!.sessions[0]!.durationMinutes = 20;
    expect(adaptProgram(result.program, history).program.version).toBe(3);
  });

  it("holds an unsupported safety scope without mutating even future sessions", () => {
    const program = plan();
    const result = adaptProgram(program, logs(program), {
      safetyReviewReasons: ["Restrictions need review."],
    });
    expect(result.state).toBe("safety_constrained");
    expect(result.program).toEqual(program);
    expect(result.program).not.toBe(program);
    expect(result.changes[0]?.applied).toBe(false);
  });
});

function cardioPlan(): TrainingProgram {
  const program = plan();
  const cardio: CardioPrescription = {
    modality: "cycling",
    role: "intervals",
    eventPhase: "base",
    intensity: "hard",
    minutes: 0,
    intervals: { repeats: 4, workSeconds: 60, recoverySeconds: 60 },
    segments: [
      { kind: "warmup", label: "warmup", minutes: 5, intensity: "easy" },
      {
        kind: "work",
        label: "work",
        minutes: 1,
        repeats: 4,
        intensity: "hard",
      },
      {
        kind: "recovery",
        label: "recover",
        minutes: 1,
        repeats: 3,
        intensity: "easy",
      },
      { kind: "cooldown", label: "cooldown", minutes: 5, intensity: "easy" },
    ],
    talkTest: "hard",
    sessionRpe: { min: 7, max: 8 },
    placement: "separate",
    ruleIds: [],
  };
  synchronizeCardioDuration(cardio);
  for (const week of program.weeks) {
    const session = week.sessions[0]!;
    session.exercises = [];
    session.kind = "cardio";
    session.cardio = structuredClone(cardio);
  }
  return program;
}

function cardioLogs(program: TrainingProgram): WeekLog[] {
  return program.weeks.slice(0, 2).map((week) => ({
    weekNumber: week.weekNumber,
    sessions: [
      {
        sessionId: week.sessions[0]!.id,
        programVersion: program.version,
        status: "completed",
        exercises: [],
        cardioModality: "cycling",
        cardioPrescribedModality: "cycling",
        cardioCompletedMinutes: 17,
        cardioCompletedIntervals: 4,
        cardioSessionRpe: 6,
      },
    ],
  }));
}

describe("local cardio adaptation", () => {
  it("preserves warmup and cooldown while reporting the actual bounded work-minute change", () => {
    const program = cardioPlan();
    for (const week of program.weeks) {
      const cardio = week.sessions[0]!.cardio!;
      delete cardio.intervals;
      cardio.role = "easy";
      cardio.intensity = "easy";
      cardio.segments = [
        { kind: "warmup", label: "warmup", minutes: 5, intensity: "easy" },
        { kind: "work", label: "work", minutes: 3, intensity: "easy" },
        { kind: "cooldown", label: "cooldown", minutes: 5, intensity: "easy" },
      ];
      synchronizeCardioDuration(cardio);
    }
    const history = cardioLogs(program);
    for (const week of history) {
      week.sessions[0]!.cardioCompletedMinutes = 13;
      week.sessions[0]!.cardioSessionRpe = 9;
    }
    const result = adaptProgram(program, history);
    expect(result.program.weeks[2]!.sessions[0]!.cardio?.minutes).toBe(11);
    expect(result.changes[0]).toMatchObject({
      before: "13 minutes",
      after: "11 minutes",
    });
  });

  it("updates interval repeats, segments and duration together without touching other phases or modalities", () => {
    const program = cardioPlan();
    program.weeks[3]!.sessions[0]!.cardio!.modality = "running";
    program.weeks[4]!.sessions[0]!.cardio!.eventPhase = "build";
    program.weeks[5]!.sessions[0]!.cardio!.eventPhase = "taper";
    const result = adaptProgram(program, cardioLogs(program));
    const session = result.program.weeks[2]!.sessions[0]!;
    expect(session.cardio).toMatchObject({
      minutes: 19,
      intervals: { repeats: 5 },
    });
    expect(session.predictedMinutes).toBe(estimateSessionMinutes([], 19));
    expect(result.changes[0]).toMatchObject({
      before: "4 work intervals",
      after: "5 work intervals",
    });
    expect(result.program.weeks.slice(3)).toEqual(program.weeks.slice(3));
  });

  it("does not use switched-modality sessions as evidence to progress prescribed cardio", () => {
    const program = cardioPlan();
    const history = cardioLogs(program);
    history[0]!.sessions[0]!.cardioModality = "running";
    expect(adaptProgram(program, history).program.version).toBe(
      program.version,
    );
  });
});
