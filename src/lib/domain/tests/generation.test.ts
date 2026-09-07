import { describe, expect, it } from "vitest";
import {
  EXERCISES,
  QUESTION_EFFECT_DEFINITIONS,
  applyPermanentExerciseSubstitutions,
  createEquipmentVariant,
  createSessionEquipmentVariant,
  generateProgram,
  isExerciseEligible,
} from "../index.js";
import {
  baseInput,
  cardioPriorityInput,
  limitedEquipmentHypertrophyInput,
  meetPowerlifterInput,
  noviceOlderHealthInput,
} from "./fixtures.js";

describe("deterministic program generation", () => {
  it("returns identical output for identical input and policy", () => {
    const input = meetPowerlifterInput();
    expect(generateProgram(input)).toEqual(
      generateProgram(structuredClone(input)),
    );
  });

  it("does not mutate or retain mutable references to questionnaire input", () => {
    const input = meetPowerlifterInput();
    const before = structuredClone(input);
    const program = generateProgram(input).program;
    expect(input).toEqual(before);
    expect(program).toBeDefined();
    if (program === undefined) return;
    program.adaptationSettings.applyChanges = "ask_first";
    expect(input).toEqual(before);
  });

  it("treats the smallest barbell plate as a per-side increment", () => {
    const input = meetPowerlifterInput();
    input.facility.barbellIncrement = 2.5;
    const program = generateProgram(input).program;
    expect(program?.loadSettings.barbellIncrement).toBe(5);
  });

  it("publishes a supported effect for every accepted questionnaire field definition", () => {
    const result = generateProgram(meetPowerlifterInput());
    expect(result.program).toBeDefined();
    expect(result.program?.questionEffects).toHaveLength(
      QUESTION_EFFECT_DEFINITIONS.length,
    );
    for (const effect of result.program?.questionEffects ?? []) {
      expect(effect.path.length).toBeGreaterThan(0);
      expect(effect.effect.length).toBeGreaterThan(20);
      expect(effect.support.length).toBeGreaterThan(0);
      expect(effect.ruleIds.length).toBeGreaterThan(0);
    }
  });

  it("builds an age-aware, complete two-day health plan from a novice baseline", () => {
    const result = generateProgram(noviceOlderHealthInput());
    const program = result.program;
    expect(program?.status).toBe("ready");
    const firstWeek = program?.weeks[0];
    const lifting =
      firstWeek?.sessions.filter((session) => session.kind === "lifting") ?? [];
    expect(lifting).toHaveLength(2);
    const patterns = lifting
      .flatMap((session) => session.exercises)
      .flatMap(
        (prescription) =>
          EXERCISES.find((item) => item.id === prescription.exerciseId)
            ?.patterns ?? [],
      );
    expect(patterns).toEqual(
      expect.arrayContaining([
        "squat",
        "hinge",
        "horizontal_push",
        "horizontal_pull",
        "trunk",
        "locomotion",
      ]),
    );
    expect(
      firstWeek?.sessions.find((session) => session.kind === "movement")
        ?.movementTarget?.steps,
    ).toBe(4000);
    expect(
      program?.questionEffects.find(
        (effect) => effect.path === "weight.ignoreAfterInitial",
      )?.used,
    ).toBe(true);
  });

  it("prescribes gradual daily movement for a powerlifting-focused plan", () => {
    const input = meetPowerlifterInput();
    input.dailyMovement = {
      trackingMethod: "phone",
      baselineSteps: 6500,
    };
    const program = generateProgram(input).program;
    expect(
      program?.weeks
        .slice(0, 4)
        .map(
          (week) =>
            week.sessions.find((session) => session.kind === "movement")
              ?.movementTarget?.steps,
        ),
    ).toEqual([7000, 7000, 7500, 7500]);
    expect(program?.loggingPlan.movementFields).toContain(
      "optional step count",
    );
  });

  it("prescribes walking minutes when no step counter is available", () => {
    const input = baseInput();
    input.dailyMovement = {
      trackingMethod: "none",
      baselineWalkingMinutes: 12,
    };
    delete input.generalFitness?.baselineSteps;
    const program = generateProgram(input).program;
    expect(
      program?.weeks
        .slice(0, 3)
        .map(
          (week) =>
            week.sessions.find((session) => session.kind === "movement")
              ?.movementTarget?.walkingMinutes,
        ),
    ).toEqual([17, 17, 22]);
  });

  it("back-plans meet phases, estimates all powerlifts, and avoids competition failure by default", () => {
    const result = generateProgram(meetPowerlifterInput());
    const program = result.program;
    expect(program?.horizonWeeks).toBe(14);
    expect(program?.weeks.at(-1)?.phase).toBe("taper");
    expect(program?.weeks.some((week) => week.phase === "peak")).toBe(true);
    expect(
      program?.baselines.every(
        (baseline) =>
          baseline.source === "observations" && baseline.confidence === "high",
      ),
    ).toBe(true);
    const competition =
      program?.weeks
        .flatMap((week) => week.sessions)
        .flatMap((session) => session.exercises)
        .filter(
          (prescription) =>
            EXERCISES.find((item) => item.id === prescription.exerciseId)
              ?.exerciseClass === "competition",
        ) ?? [];
    expect(competition.length).toBeGreaterThan(0);
    expect(competition.every((item) => item.targetRir.min >= 1)).toBe(true);
    expect(
      competition.every(
        (item) =>
          item.percentE1rm !== undefined &&
          item.percentE1rm >= 0.65 &&
          item.percentE1rm <= 0.92,
      ),
    ).toBe(true);
    const firstWeekExercises =
      program?.weeks[0]?.sessions.flatMap((session) => session.exercises) ?? [];
    expect(
      firstWeekExercises.filter(
        (item) => item.exerciseId === "competition_squat",
      ),
    ).toHaveLength(2);
    expect(
      firstWeekExercises.filter(
        (item) => item.exerciseId === "competition_bench",
      ),
    ).toHaveLength(3);
    expect(
      firstWeekExercises.filter(
        (item) => item.exerciseId === "competition_deadlift",
      ),
    ).toHaveLength(2);
    expect(
      firstWeekExercises.find((item) => item.exerciseId === "competition_squat")
        ?.performanceSeriesId,
    ).toContain("low_bar");
  });

  it("uses a short re-entry phase when returning to powerlifting specificity", () => {
    const input = meetPowerlifterInput();
    input.goals.horizon = { kind: "fixed", weeks: 8 };
    delete input.goals.event;
    input.powerlifting!.goal = "return_to_powerlifting";
    const phases =
      generateProgram(input).program?.weeks.map((week) => week.phase) ?? [];
    expect(phases).toHaveLength(8);
    expect(phases.slice(0, 2)).toEqual(["reentry", "reentry"]);
    expect(phases.slice(2).every((phase) => phase === "strength")).toBe(true);
  });

  it("distinguishes controlled AMRAPs from a single planned max-effort test", () => {
    const none = baseInput();
    const controlled = structuredClone(none);
    controlled.adaptation.amrapPolicy = "controlled";
    const maxEffort = structuredClone(none);
    maxEffort.adaptation.amrapPolicy = "max_effort";

    const markers = (input: typeof none) =>
      generateProgram(input).program?.weeks.flatMap((week) =>
        week.sessions.flatMap((session) =>
          session.exercises
            .filter((exercise) => exercise.amrapStopRir !== undefined)
            .map((exercise) => ({
              week: week.weekNumber,
              stopRir: exercise.amrapStopRir,
            })),
        ),
      ) ?? [];

    expect(markers(none)).toEqual([]);
    expect(markers(controlled).length).toBeGreaterThan(0);
    expect(markers(controlled).every((item) => item.stopRir === 1)).toBe(true);
    expect(markers(maxEffort)).toEqual([{ week: 6, stopRir: 0 }]);
  });

  it("permits one competition-lift max effort only in the final peak week of a test block", () => {
    const input = meetPowerlifterInput();
    input.powerlifting!.goal = "peak_or_test";
    input.adaptation.amrapPolicy = "max_effort";
    const program = generateProgram(input).program;
    const finalPeakWeek = program?.weeks
      .filter((week) => week.phase === "peak")
      .at(-1)?.weekNumber;
    const markers =
      program?.weeks.flatMap((week) =>
        week.sessions.flatMap((session) =>
          session.exercises
            .filter((exercise) => exercise.amrapStopRir === 0)
            .map((exercise) => ({
              week: week.weekNumber,
              exerciseId: exercise.exerciseId,
            })),
        ),
      ) ?? [];
    expect(markers).toHaveLength(1);
    expect(markers[0]?.week).toBe(finalPeakWeek);
    expect(markers[0]?.exerciseId).toBe("competition_squat");
  });

  it("uses explicit within-phase load progression instead of repeating identical loading weeks", () => {
    const program = generateProgram(meetPowerlifterInput()).program;
    const strengthWeeks =
      program?.weeks.filter((week) => week.phase === "strength") ?? [];
    expect(strengthWeeks.length).toBeGreaterThan(1);
    const squatPercent = strengthWeeks
      .slice(0, 2)
      .map(
        (week) =>
          week.sessions
            .flatMap((session) => session.exercises)
            .find(
              (exercise) =>
                exercise.exerciseId === "competition_squat" &&
                exercise.percentE1rm !== undefined,
            )?.percentE1rm,
      );
    expect(squatPercent[0]).toBeDefined();
    expect(squatPercent[1]).toBeGreaterThan(squatPercent[0] ?? 0);
    expect(
      strengthWeeks[0]?.sessions
        .flatMap((session) => session.exercises)
        .find((exercise) => exercise.exerciseId === "competition_squat")
        ?.progression.method,
    ).toBe("percentage_wave");
  });

  it("turns goal weights into different secondary-cardio doses", () => {
    const lowerSecondary = meetPowerlifterInput();
    lowerSecondary.goals.primaryWeight = 90;
    lowerSecondary.cardio.currentHardSessions = 1;
    const equalPriority = structuredClone(lowerSecondary);
    equalPriority.goals.primaryWeight = 50;
    const lowerCardio =
      generateProgram(lowerSecondary).program?.weeks[0]?.sessions.filter(
        (session) => session.cardio !== undefined,
      ) ?? [];
    const equalCardio =
      generateProgram(equalPriority).program?.weeks[0]?.sessions.filter(
        (session) => session.cardio !== undefined,
      ) ?? [];
    expect(equalCardio.length).toBeGreaterThan(lowerCardio.length);
    expect(
      equalCardio.some((session) => session.cardio?.intensity === "hard"),
    ).toBe(false);
    expect(
      generateProgram(equalPriority).program?.warnings.some(
        (warning) => warning.code === "cardio-recovery-capacity",
      ),
    ).toBe(true);
  });

  it("keeps lifting-support cardio easy even when recent hard cardio exists", () => {
    const input = meetPowerlifterInput();
    input.cardio.purpose = "lifting_support";
    input.cardio.currentHardSessions = 2;
    input.goals.primaryWeight = 50;
    const cardio =
      generateProgram(input).program?.weeks[0]?.sessions.filter(
        (session) => session.cardio !== undefined,
      ) ?? [];
    expect(cardio.length).toBeGreaterThan(0);
    expect(
      cardio.every((session) => session.cardio?.intensity !== "hard"),
    ).toBe(true);
  });

  it("uses calibration instead of guessing when a lift baseline is absent", () => {
    const input = meetPowerlifterInput();
    delete input.powerlifting?.observations.deadlift;
    const program = generateProgram(input).program;
    expect(
      program?.baselines.find((item) => item.lift === "deadlift")?.source,
    ).toBe("calibration_required");
    const deadlift = program?.weeks[0]?.sessions
      .flatMap((session) => session.exercises)
      .find((item) => item.exerciseId === "competition_deadlift");
    expect(deadlift?.load).toBeUndefined();
    expect(deadlift?.explanation).toContain("Calibrate the load today");
    expect(deadlift?.progression.instruction).toContain(
      "at most two calibration attempts",
    );
  });

  it("selects a feasible 5-day hypertrophy split and only eligible limited-equipment exercises", () => {
    const input = limitedEquipmentHypertrophyInput();
    const program = generateProgram(input).program;
    expect(program?.selectedSplit).toBe("ppl_upper_lower");
    const firstWeekExercises =
      program?.weeks[0]?.sessions.flatMap((session) => session.exercises) ?? [];
    expect(firstWeekExercises.length).toBeGreaterThan(10);
    expect(
      firstWeekExercises.every((prescription) => {
        const definition = EXERCISES.find(
          (item) => item.id === prescription.exerciseId,
        );
        return (
          definition !== undefined && isExerciseEligible(definition, input)
        );
      }),
    ).toBe(true);
    expect(
      firstWeekExercises.some((item) => item.alternativeChoices.length > 0),
    ).toBe(true);
  });

  it("hard-filters an excluded exercise without increasing the eligible pool", () => {
    const input = limitedEquipmentHypertrophyInput();
    const baseline =
      generateProgram(input).program?.weeks[0]?.sessions.flatMap(
        (session) => session.exercises,
      ) ?? [];
    input.safety.excludedExercises = ["dumbbell_bench"];
    const excluded =
      generateProgram(input).program?.weeks[0]?.sessions.flatMap(
        (session) => session.exercises,
      ) ?? [];
    expect(excluded.some((item) => item.exerciseId === "dumbbell_bench")).toBe(
      false,
    );
    const baselineEligible = EXERCISES.filter((item) =>
      isExerciseEligible(item, limitedEquipmentHypertrophyInput()),
    ).length;
    const excludedEligible = EXERCISES.filter((item) =>
      isExerciseEligible(item, input),
    ).length;
    expect(excludedEligible).toBeLessThanOrEqual(baselineEligible);
    expect(excluded.length).toBeLessThanOrEqual(baseline.length);
  });

  it("creates a cardio-priority plan with mostly easy work and two whole-body lifting days", () => {
    const program = generateProgram(cardioPriorityInput()).program;
    const firstWeek = program?.weeks[0];
    const cardio =
      firstWeek?.sessions.filter((session) => session.cardio !== undefined) ??
      [];
    const lifting =
      firstWeek?.sessions.filter((session) => session.kind === "lifting") ?? [];
    expect(cardio.length).toBeGreaterThanOrEqual(4);
    expect(cardio.length).toBeLessThanOrEqual(6);
    expect(
      cardio.filter((session) => session.cardio?.intensity === "hard").length,
    ).toBeLessThanOrEqual(2);
    expect(
      cardio.filter((session) => session.cardio?.intensity !== "hard").length,
    ).toBeGreaterThan(
      cardio.filter((session) => session.cardio?.intensity === "hard").length,
    );
    expect(lifting).toHaveLength(2);
    expect(
      cardio.every(
        (session) =>
          session.cardio?.heartRateBpm?.method === "heart_rate_reserve",
      ),
    ).toBe(true);
  });

  it("creates phased, role-specific sessions for a dated running event", () => {
    const input = cardioPriorityInput();
    input.goals.horizon = { kind: "fixed", weeks: 10 };
    input.goals.event = {
      type: "race",
      date: "2026-10-24",
      certainty: "confirmed",
    };
    input.cardio.goal = {
      type: "running_event",
      runningEvent: {
        distance: "10k",
        outcome: "target_time",
        targetTimeMinutes: 50,
        recentBestMinutes: 54,
        surface: "road",
        routeProfile: "rolling",
      },
    };
    input.cardio.runningBaseline = {
      runsPerWeek: 3,
      weeklyDistance: 15,
      distanceUnit: "mi",
      weeklyMinutes: 150,
      longestRunDistance: 6,
      longestRunMinutes: 60,
      continuousRunMinutes: 75,
    };
    const program = generateProgram(input).program;
    const firstCardio = program?.weeks[0]?.sessions
      .map((session) => session.cardio)
      .filter((cardio) => cardio !== undefined);
    expect(firstCardio?.map((cardio) => cardio.role)).toEqual(
      expect.arrayContaining(["easy", "long", "tempo"]),
    );
    expect(firstCardio?.every((cardio) => cardio.modality === "running")).toBe(
      true,
    );
    expect(
      firstCardio?.every((cardio) => (cardio.segments?.length ?? 0) > 0),
    ).toBe(true);
    expect(firstCardio?.some((cardio) => cardio.paceTarget !== undefined)).toBe(
      true,
    );
    expect(
      program?.weeks
        .at(-1)
        ?.sessions.some((session) => session.cardio?.eventPhase === "taper"),
    ).toBe(true);
  });

  it("prescribes bounded work intervals for a VO2max focus", () => {
    const input = cardioPriorityInput();
    input.cardio.goal = {
      type: "vo2max",
      vo2max: { modality: "cycling" },
    };
    const cardio = generateProgram(input)
      .program?.weeks[0]?.sessions.map((session) => session.cardio)
      .filter((item) => item !== undefined);
    const quality = cardio?.filter((item) => item.role === "intervals") ?? [];
    expect(quality.length).toBeGreaterThan(0);
    expect(
      quality.every(
        (item) =>
          item.modality === "cycling" &&
          item.intervals !== undefined &&
          item.intervals.repeats >= 2,
      ),
    ).toBe(true);
  });

  it("turns effort, device, and optional bodyweight answers into a concrete logging contract", () => {
    const input = meetPowerlifterInput();
    input.history.effortReporting = "rpe";
    input.cardio.heartRateDevice = "smartwatch";
    input.weight.ignoreAfterInitial = false;
    input.weight.weeklyCheckIns = true;
    const plan = generateProgram(input).program?.loggingPlan;
    expect(plan?.effortPrompt).toContain("RPE");
    expect(plan?.cardioFields.join(" ")).toContain("smartwatch");
    expect(plan?.bodyweightCheckIn).toBe("optional_weekly");
  });

  it("preserves low-volume competition skill inside hypertrophy only when selected", () => {
    const input = limitedEquipmentHypertrophyInput();
    input.facility.primaryEquipment.push("barbell", "rack", "plates");
    input.hypertrophy!.preserveCompetitionLifts = true;
    const preserved =
      generateProgram(input).program?.weeks[0]?.sessions.flatMap(
        (session) => session.exercises,
      ) ?? [];
    expect(
      preserved
        .filter((item) => item.exerciseId.startsWith("competition_"))
        .map((item) => item.exerciseId)
        .sort(),
    ).toEqual([
      "competition_bench",
      "competition_deadlift",
      "competition_squat",
    ]);
    input.hypertrophy!.preserveCompetitionLifts = false;
    const unpreserved =
      generateProgram(input).program?.weeks[0]?.sessions.flatMap(
        (session) => session.exercises,
      ) ?? [];
    expect(
      unpreserved.some((item) => item.exerciseId.startsWith("competition_")),
    ).toBe(false);
  });

  it("always supplies a default while exposing alternatives only when requested", () => {
    const input = limitedEquipmentHypertrophyInput();
    input.hypertrophy!.exerciseSelection = "user_selects";
    const manual = generateProgram(input).program;
    expect(manual?.status).toBe("ready");
    expect(manual?.unresolvedChoices).toHaveLength(0);
    expect(
      manual?.weeks[0]?.sessions
        .flatMap((session) => session.exercises)
        .some((item) => item.alternativeChoices.length > 0),
    ).toBe(true);
    input.hypertrophy!.exerciseSelection = "engine_decide";
    const automatic = generateProgram(input).program;
    expect(automatic?.status).toBe("ready");
    expect(
      automatic?.weeks[0]?.sessions
        .flatMap((session) => session.exercises)
        .every((item) => item.alternativeChoices.length === 0),
    ).toBe(true);
  });

  it("uses a two-on, one-off, two-on default for four-day powerlifting when every day is available", () => {
    const input = meetPowerlifterInput();
    input.schedule.preferredTrainingDays = [
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
    ];
    input.schedule.unavailableDays = [];
    const days =
      generateProgram(input)
        .program?.weeks[0]?.sessions.filter(
          (session) => session.exercises.length > 0,
        )
        .map((session) => session.day) ?? [];
    expect(days).toEqual(["monday", "tuesday", "thursday", "friday"]);
  });

  it("keeps a calendar week to seven ordered workout rows by combining same-day cardio and lifting", () => {
    const input = cardioPriorityInput();
    input.schedule.planningStyle = "calendar_days";
    input.schedule.preferredTrainingDays = [
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
    ];
    input.schedule.cardioFocusedDays = [
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
    ];
    input.schedule.unavailableDays = [];
    input.cardio.currentEasySessions = 4;
    input.cardio.currentModerateSessions = 1;
    input.cardio.currentHardSessions = 1;

    const sessions =
      generateProgram(input).program?.weeks[0]?.sessions.filter(
        (session) => session.kind !== "movement",
      ) ?? [];
    const days = sessions.map((session) => session.day);
    const dayOrder = [
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
    ];

    expect(sessions).toHaveLength(7);
    expect(
      sessions.filter((session) => session.cardio !== undefined),
    ).toHaveLength(6);
    expect(
      sessions.filter((session) => session.exercises.length > 0),
    ).toHaveLength(2);
    expect(
      sessions.filter((session) => session.kind === "combined"),
    ).toHaveLength(1);
    expect(new Set(days).size).toBe(days.length);
    expect(days).toEqual(
      [...days].sort(
        (left, right) =>
          dayOrder.indexOf(left ?? "") - dayOrder.indexOf(right ?? ""),
      ),
    );
  });

  it("shares lifting and cardio only on the weekdays selected in advanced scheduling", () => {
    const input = cardioPriorityInput();
    input.schedule.planningStyle = "calendar_days";
    input.schedule.preferredTrainingDays = [
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
    ];
    input.schedule.cardioFocusedDays = [
      ...input.schedule.preferredTrainingDays,
    ];
    input.schedule.unavailableDays = [];
    input.schedule.advanced = {
      minimumTrainingDays: 1,
      splitSessionDays: ["monday"],
      allowCombinedSessions: true,
      allowSeparateSameDay: true,
      durationPolicy: "allow_exceed",
    };
    input.cardio.currentEasySessions = 4;
    input.cardio.currentModerateSessions = 1;
    input.cardio.currentHardSessions = 1;

    const combined =
      generateProgram(input).program?.weeks[0]?.sessions.filter(
        (session) => session.kind === "combined",
      ) ?? [];
    expect(combined).toHaveLength(1);
    expect(combined[0]?.day).toBe("monday");
  });

  it("generates one actionable rep, effort, and cardio target", () => {
    const programs = [
      meetPowerlifterInput(),
      limitedEquipmentHypertrophyInput(),
      cardioPriorityInput(),
    ].map((input) => generateProgram(input).program);
    const exercises = programs.flatMap(
      (program) =>
        program?.weeks.flatMap((week) =>
          week.sessions.flatMap((session) => session.exercises),
        ) ?? [],
    );
    const cardio = programs.flatMap(
      (program) =>
        program?.weeks.flatMap((week) =>
          week.sessions
            .map((session) => session.cardio)
            .filter((item) => item !== undefined),
        ) ?? [],
    );

    expect(exercises.length).toBeGreaterThan(0);
    expect(
      exercises.every((exercise) => exercise.reps.min === exercise.reps.max),
    ).toBe(true);
    expect(
      exercises.every(
        (exercise) => exercise.targetRir.min === exercise.targetRir.max,
      ),
    ).toBe(true);
    expect(
      exercises
        .filter((exercise) => exercise.optional)
        .every((exercise) => exercise.skipRule?.startsWith("Complete this")),
    ).toBe(true);
    expect(
      cardio.every(
        (item) =>
          item.sessionRpe.min === item.sessionRpe.max &&
          item.talkTest.startsWith("Target RPE") &&
          (item.heartRateBpm === undefined ||
            item.heartRateBpm.target !== undefined),
      ),
    ).toBe(true);
  });

  it("always fits the duration or explicitly labels the overrun/infeasibility", () => {
    for (const input of [
      noviceOlderHealthInput(),
      meetPowerlifterInput(),
      limitedEquipmentHypertrophyInput(),
      cardioPriorityInput(),
    ]) {
      const program = generateProgram(input).program;
      for (const session of program?.weeks.flatMap((week) => week.sessions) ??
        []) {
        if (
          session.predictedMinutes > session.targetMinutes &&
          session.targetMinutes > 0
        ) {
          expect(["guideline_exceeded", "infeasible"]).toContain(
            session.durationStatus,
          );
          expect(
            program?.warnings.some((warning) =>
              warning.code.startsWith("duration-"),
            ),
          ).toBe(true);
        } else {
          expect(session.durationStatus).toBe("fits");
        }
      }
    }
  });

  it("creates a dumbbell-only travel version without rewriting later barbell weeks", () => {
    const input = meetPowerlifterInput();
    const program = generateProgram(input).program;
    if (program === undefined) throw new Error("Expected program");
    const originalWeek3 = structuredClone(program.weeks[2]);
    const variant = createEquipmentVariant(
      program,
      input,
      ["dumbbells", "bench", "treadmill"],
      1,
      2,
    );
    expect(variant.changedExerciseCount).toBeGreaterThan(0);
    expect(
      variant.program.weeks[0]?.sessions
        .flatMap((session) => session.exercises)
        .some((item) => item.exerciseId.startsWith("competition_")),
    ).toBe(false);
    expect(variant.program.weeks[2]).toEqual(originalWeek3);
    expect(
      variant.warnings.some((warning) =>
        warning.code.startsWith("travel-specificity"),
      ),
    ).toBe(true);
  });

  it("resolves a secondary-gym workout without changing any stored week", () => {
    const input = meetPowerlifterInput();
    input.facility.alternateEquipment = ["dumbbells", "bench", "treadmill"];
    const program = generateProgram(input).program;
    if (program === undefined) throw new Error("Expected program");
    const original = structuredClone(program);
    const session = program.weeks[0]?.sessions.find(
      (candidate) => candidate.exercises.length > 0,
    );
    if (session === undefined) throw new Error("Expected lifting session");
    const variant = createSessionEquipmentVariant(program, input, session.id);
    expect(variant.configured).toBe(true);
    expect(variant.changes.length).toBeGreaterThan(0);
    expect(program).toEqual(original);
    expect(variant.session.id).toBe(session.id);
  });

  it("offers safety-filtered replacements when no secondary gym is saved", () => {
    const input = meetPowerlifterInput();
    delete input.facility.alternateEquipment;
    const program = generateProgram(input).program;
    if (program === undefined) throw new Error("Expected program");
    const session = program.weeks[0]?.sessions.find(
      (candidate) => candidate.exercises.length > 0,
    );
    if (session === undefined) throw new Error("Expected lifting session");
    const variant = createSessionEquipmentVariant(program, input, session.id);
    expect(variant.configured).toBe(false);
    expect(
      variant.session.exercises.every(
        (exercise) => exercise.alternativeChoices.length > 0,
      ),
    ).toBe(true);
  });

  it("gives flexible plans a seven-day rhythm, respects blackouts, and combines same-day work", () => {
    const input = baseInput();
    input.goals.secondary = "cardio";
    input.goals.primaryWeight = 50;
    input.schedule.liftingDaysPerWeek = 3;
    input.schedule.planningStyle = "flexible_sequence";
    input.schedule.preferredTrainingDays = [
      "monday",
      "tuesday",
      "wednesday",
      "friday",
      "saturday",
    ];
    input.schedule.unavailableDays = ["thursday", "sunday"];
    input.schedule.cardioFocusedDays = ["tuesday", "saturday"];
    input.cardio.currentEasySessions = 4;
    input.cardio.typicalEasyMinutes = 25;

    const sessions =
      generateProgram(input).program?.weeks[0]?.sessions.filter(
        (session) => session.kind !== "movement",
      ) ?? [];
    const assignedDays = sessions.flatMap((session) =>
      session.day === undefined ? [] : [session.day],
    );
    expect(sessions.length).toBeLessThanOrEqual(5);
    expect(new Set(assignedDays).size).toBe(assignedDays.length);
    expect(
      assignedDays.every(
        (day) => !input.schedule.unavailableDays.includes(day),
      ),
    ).toBe(true);
    expect(sessions.some((session) => session.kind === "combined")).toBe(true);
    expect(
      sessions.filter((session) => session.exercises.length > 0),
    ).toHaveLength(3);
    expect(
      sessions.filter((session) => session.cardio !== undefined),
    ).toHaveLength(4);
  });

  it("keeps the chosen cardio modality in the majority while rotating acceptable alternatives", () => {
    const input = cardioPriorityInput();
    input.cardio.preferredModalities = ["cycling", "walking", "rowing"];
    input.cardio.varietyPreference = "broad_mix";
    input.facility.primaryEquipment = [
      ...input.facility.primaryEquipment,
      "cardio_bike",
      "rower",
    ];
    input.schedule.unavailableDays = [];
    const program = generateProgram(input).program;
    const modalities =
      program?.weeks
        .slice(0, 2)
        .flatMap((week) =>
          week.sessions.flatMap((session) =>
            session.cardio === undefined ? [] : [session.cardio.modality],
          ),
        ) ?? [];
    const primaryCount = modalities.filter(
      (modality) => modality === "cycling",
    ).length;
    expect(primaryCount).toBeGreaterThan(modalities.length / 2);
    expect(modalities.some((modality) => modality !== "cycling")).toBe(true);
  });

  it("prescribes bounded compatible supersets only after the user opts in", () => {
    const straightInput = limitedEquipmentHypertrophyInput();
    straightInput.schedule.targetLiftMinutes = 90;
    const pairedInput = structuredClone(straightInput);
    pairedInput.hypertrophy!.useSupersets = true;
    const straightProgram = generateProgram(straightInput).program;
    const pairedProgram = generateProgram(pairedInput).program;
    if (straightProgram === undefined || pairedProgram === undefined)
      throw new Error("Expected programs");

    expect(
      straightProgram.weeks
        .flatMap((week) => week.sessions)
        .flatMap((session) => session.setBlocks ?? [])
        .some((block) => block.type === "paired_superset"),
    ).toBe(false);

    const pairedSessions = pairedProgram.weeks.flatMap((week) =>
      week.sessions.filter((session) =>
        session.setBlocks?.some((block) => block.type === "paired_superset"),
      ),
    );
    expect(pairedSessions.length).toBeGreaterThan(0);
    for (const session of pairedProgram.weeks.flatMap(
      (week) => week.sessions,
    )) {
      const pairs = (session.setBlocks ?? []).filter(
        (block) => block.type === "paired_superset",
      );
      expect(pairs.length).toBeLessThanOrEqual(1);
      for (const block of pairs) {
        expect(block.sequence.map((item) => item.orderLabel)).toEqual([
          "A1",
          "A2",
        ]);
        const prescriptions = block.sequence.map((item) =>
          session.exercises.find(
            (exercise) => exercise.id === item.prescriptionId,
          ),
        );
        expect(prescriptions.every((item) => item !== undefined)).toBe(true);
        expect(new Set(prescriptions.map((item) => item?.sets)).size).toBe(1);
        expect(block.rounds).toBe(prescriptions[0]?.sets);
        expect(
          prescriptions.every((item) => item?.amrapStopRir === undefined),
        ).toBe(true);
        expect(
          prescriptions.every((item) => {
            const exercise = EXERCISES.find(
              (definition) => definition.id === item?.exerciseId,
            );
            return (
              exercise !== undefined &&
              ["stable_compound", "isolation", "trunk"].includes(
                exercise.exerciseClass,
              )
            );
          }),
        ).toBe(true);
      }
    }
    const straightMinutes = straightProgram.weeks[0]!.sessions.reduce(
      (sum, session) => sum + session.predictedMinutes,
      0,
    );
    const pairedMinutes = pairedProgram.weeks[0]!.sessions.reduce(
      (sum, session) => sum + session.predictedMinutes,
      0,
    );
    expect(pairedMinutes).toBeLessThan(straightMinutes);
    expect(generateProgram(pairedInput)).toEqual(
      generateProgram(structuredClone(pairedInput)),
    );
  });

  it("never places powerlifting competition work inside a superset", () => {
    const input = meetPowerlifterInput();
    input.goals.secondary = "hypertrophy";
    input.hypertrophy = {
      splitPreference: "auto",
      splitPreferenceStrength: "engine_decide",
      balance: "balanced",
      musclePriorities: [],
      preserveCompetitionLifts: true,
      exerciseSelection: "offer_choices",
      useSupersets: true,
    };
    const program = generateProgram(input).program;
    if (program === undefined) throw new Error("Expected program");
    expect(
      program.weeks
        .flatMap((week) => week.sessions)
        .flatMap((session) => session.setBlocks ?? [])
        .some((block) => block.type === "paired_superset"),
    ).toBe(true);
    for (const session of program.weeks.flatMap((week) => week.sessions)) {
      const pairedIds = new Set(
        (session.setBlocks ?? [])
          .filter((block) => block.type === "paired_superset")
          .flatMap((block) => block.sequence)
          .map((item) => item.prescriptionId),
      );
      expect(
        session.exercises
          .filter(
            (exercise) =>
              EXERCISES.find(
                (definition) => definition.id === exercise.exerciseId,
              )?.exerciseClass === "competition",
          )
          .every((exercise) => !pairedIds.has(exercise.id)),
      ).toBe(true);
    }
  });

  it("carries a permanent exercise replacement only into later workouts", () => {
    const input = meetPowerlifterInput();
    const program = generateProgram(input).program;
    if (program === undefined) throw new Error("Expected program");
    const firstSession = program.weeks[0]?.sessions.find(
      (session) => session.exercises.length > 0,
    );
    const candidate = firstSession?.exercises.find(
      (exercise) =>
        exercise.alternativeChoices.length > 0 &&
        program.weeks.some((week) =>
          week.sessions.some(
            (session) =>
              week.weekNumber > (firstSession?.weekNumber ?? 0) &&
              session.exercises.some(
                (later) => later.exerciseId === exercise.exerciseId,
              ),
          ),
        ),
    );
    if (firstSession === undefined || candidate === undefined)
      throw new Error("Expected a repeatable exercise with an alternative");
    const replacement = candidate.alternativeChoices[0];
    if (replacement === undefined) throw new Error("Expected alternative");

    const result = applyPermanentExerciseSubstitutions(
      program,
      [
        {
          originalExerciseId: candidate.exerciseId,
          replacementExerciseId: replacement.exerciseId,
        },
      ],
      firstSession.weekNumber,
      firstSession.sequence,
      input,
    );
    expect(result.changedPrescriptionCount).toBeGreaterThan(0);
    expect(result.program.version).toBe(program.version + 1);
    expect(
      result.program.weeks[0]?.sessions
        .find((session) => session.id === firstSession.id)
        ?.exercises.find((exercise) => exercise.id === candidate.id)
        ?.exerciseId,
    ).toBe(candidate.exerciseId);
    expect(
      result.program.weeks
        .flatMap((week) => week.sessions)
        .filter(
          (session) =>
            session.weekNumber > firstSession.weekNumber ||
            (session.weekNumber === firstSession.weekNumber &&
              session.sequence > firstSession.sequence),
        )
        .flatMap((session) => session.exercises)
        .some((exercise) => exercise.exerciseId === replacement.exerciseId),
    ).toBe(true);
    for (const session of result.program.weeks
      .flatMap((week) => week.sessions)
      .filter(
        (session) =>
          session.weekNumber > firstSession.weekNumber ||
          (session.weekNumber === firstSession.weekNumber &&
            session.sequence > firstSession.sequence),
      )) {
      expect(
        (session.setBlocks ?? []).flatMap((block) => block.sequence).length,
      ).toBe(session.exercises.length);
    }
  });
});
