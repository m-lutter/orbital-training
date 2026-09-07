import type { QuestionnaireInput, TrainingProgram, WeekLog } from "../index.js";

export function baseInput(): QuestionnaireInput {
  return {
    asOfDate: "2026-08-06",
    timeZone: "America/Chicago",
    age: 38,
    units: "lb",
    weight: {
      initialBodyWeight: 190,
      ignoreAfterInitial: false,
      dietGoal: "maintain",
      weeklyCheckIns: true,
    },
    safety: {
      disclaimerAccepted: true,
      allowOperationalRestrictions: true,
      excludedExercises: [],
      excludedMovements: [],
      restrictedBodyAreas: [],
      clinicianRestrictions: [],
    },
    goals: {
      primary: "health",
      primaryWeight: 100,
      startDate: "2026-08-10",
      horizon: { kind: "fixed", weeks: 6 },
    },
    schedule: {
      liftingDaysPerWeek: 2,
      planningStyle: "flexible_sequence",
      preferredTrainingDays: ["monday", "thursday"],
      unavailableDays: [],
      targetLiftMinutes: 50,
      targetCardioMinutes: 30,
      cardioFocusedDays: ["tuesday", "saturday"],
    },
    history: {
      resistanceTrainingYears: 1,
      recentConsistency: "one_to_two",
      effortFamiliarity: "basic",
      effortReporting: "verbal",
    },
    facility: {
      primaryEquipment: [
        "dumbbells",
        "bench",
        "machines",
        "cables",
        "cardio_bike",
        "treadmill",
      ],
      substitutionApproval: "recommend_then_ask",
    },
    recovery: {
      typicalSleepHours: "7",
      nightsBelowSixPerWeek: 1,
      workActivity: "sedentary",
      rotatingOrNightShifts: false,
      playsSport: false,
    },
    generalFitness: {
      emphasis: "balanced",
      chairStandConcern: false,
      balanceConcern: false,
      floorTransferConcern: false,
      dailyWalkingMinutes: 15,
      baselineSteps: 5000,
    },
    cardio: {
      purpose: "health",
      currentEasySessions: 1,
      currentModerateSessions: 0,
      currentHardSessions: 0,
      typicalEasyMinutes: 20,
      typicalModerateMinutes: 0,
      typicalHardMinutes: 0,
      longestRecentSessionMinutes: 30,
      preferredModalities: ["walking", "cycling"],
      avoidRunning: false,
      heartRateDevice: "smartwatch",
    },
    adaptation: {
      applyChanges: "automatic",
      missedWorkoutPolicy: "preserve_weekdays_drop_low_priority",
      amrapPolicy: "none",
      durationPolicy: "allow_exceed",
      substitutionPolicy: "recommend_then_ask",
    },
  };
}

export function noviceOlderHealthInput(): QuestionnaireInput {
  const input = baseInput();
  input.age = 68;
  input.weight.ignoreAfterInitial = true;
  input.weight.weeklyCheckIns = false;
  input.history.resistanceTrainingYears = 0;
  input.history.recentConsistency = "none";
  input.history.effortFamiliarity = "none";
  input.generalFitness = {
    emphasis: "function",
    chairStandConcern: true,
    balanceConcern: true,
    floorTransferConcern: true,
    dailyWalkingMinutes: 10,
    baselineSteps: 3500,
  };
  input.schedule.targetLiftMinutes = 40;
  return input;
}

export function meetPowerlifterInput(): QuestionnaireInput {
  const input = baseInput();
  input.age = 31;
  input.goals = {
    primary: "powerlifting",
    secondary: "cardio",
    primaryWeight: 80,
    startDate: "2026-08-10",
    horizon: { kind: "fixed", weeks: 12 },
    event: {
      type: "powerlifting_meet",
      date: "2026-11-14",
      certainty: "confirmed",
    },
  };
  input.schedule = {
    liftingDaysPerWeek: 4,
    planningStyle: "calendar_days",
    preferredTrainingDays: ["monday", "tuesday", "thursday", "saturday"],
    unavailableDays: ["wednesday"],
    targetLiftMinutes: 90,
    targetCardioMinutes: 25,
    cardioFocusedDays: ["wednesday", "sunday"],
    advanced: {
      minimumTrainingDays: 3,
      splitSessionDays: ["tuesday"],
      durationPolicy: "allow_exceed",
    },
  };
  input.history = {
    resistanceTrainingYears: 8,
    recentConsistency: "three_plus",
    effortFamiliarity: "confident",
    effortReporting: "rpe",
    recentSessionsPerWeek: 4,
  };
  input.facility = {
    primaryEquipment: [
      "barbell",
      "rack",
      "bench",
      "plates",
      "dumbbells",
      "cables",
      "machines",
      "pullup_bar",
      "cardio_bike",
      "treadmill",
    ],
    alternateEquipment: ["dumbbells", "bench", "treadmill"],
    barbellIncrement: 2.5,
    dumbbellIncrement: 5,
    substitutionApproval: "recommend_then_ask",
  };
  input.powerlifting = {
    goal: "meet_prep",
    squatStyle: "low_bar",
    benchStyle: "standard",
    deadliftStyle: "conventional",
    competitionStyle: "raw_sleeves",
    preserveCompetitionLifts: true,
    observations: {
      squat: [
        {
          load: 405,
          reps: 3,
          rir: 2,
          date: "2026-08-01",
          stableTechnique: true,
          completed: true,
        },
        {
          load: 395,
          reps: 4,
          rir: 2,
          date: "2026-07-25",
          stableTechnique: true,
          completed: true,
        },
      ],
      bench: [
        {
          load: 275,
          reps: 3,
          rir: 2,
          date: "2026-08-02",
          stableTechnique: true,
          completed: true,
        },
        {
          load: 265,
          reps: 5,
          rir: 2,
          date: "2026-07-24",
          stableTechnique: true,
          completed: true,
        },
      ],
      deadlift: [
        {
          load: 475,
          reps: 3,
          rir: 2,
          date: "2026-08-03",
          stableTechnique: true,
          completed: true,
        },
        {
          load: 455,
          reps: 5,
          rir: 2,
          date: "2026-07-23",
          stableTechnique: true,
          completed: true,
        },
      ],
    },
    advanced: {
      squatFrequencyPreference: 2,
      benchFrequencyPreference: 3,
      deadliftFrequencyPreference: 2,
      trainingMaxPercent: 98,
    },
  };
  input.cardio = {
    purpose: "health",
    currentEasySessions: 2,
    currentModerateSessions: 0,
    currentHardSessions: 0,
    typicalEasyMinutes: 20,
    typicalModerateMinutes: 0,
    typicalHardMinutes: 0,
    longestRecentSessionMinutes: 30,
    preferredModalities: ["cycling", "walking"],
    avoidRunning: false,
    heartRateDevice: "smartwatch",
  };
  input.recovery = {
    typicalSleepHours: "7.5",
    nightsBelowSixPerWeek: 0,
    workActivity: "sedentary",
    rotatingOrNightShifts: false,
    playsSport: false,
  };
  return input;
}

export function limitedEquipmentHypertrophyInput(): QuestionnaireInput {
  const input = baseInput();
  input.age = 27;
  input.goals = {
    primary: "hypertrophy",
    secondary: "health",
    primaryWeight: 70,
    startDate: "2026-08-10",
    horizon: { kind: "fixed", weeks: 8 },
  };
  input.schedule.liftingDaysPerWeek = 5;
  input.schedule.preferredTrainingDays = [
    "monday",
    "tuesday",
    "wednesday",
    "friday",
    "saturday",
  ];
  input.schedule.targetLiftMinutes = 55;
  input.history = {
    resistanceTrainingYears: 4,
    recentConsistency: "three_plus",
    effortFamiliarity: "confident",
    effortReporting: "rir",
    recentSessionsPerWeek: 5,
  };
  input.facility = {
    primaryEquipment: [
      "dumbbells",
      "bench",
      "machines",
      "cables",
      "cardio_bike",
    ],
    alternateEquipment: ["dumbbells", "bench"],
    dumbbellIncrement: 5,
    substitutionApproval: "recommend_then_ask",
  };
  input.hypertrophy = {
    splitPreference: "ppl_upper_lower",
    splitPreferenceStrength: "strong",
    balance: "prioritized",
    musclePriorities: [
      { muscle: "chest", rank: 1 },
      { muscle: "upper_back", rank: 2 },
    ],
    specializationBias: "chest",
    preserveCompetitionLifts: false,
    exerciseSelection: "offer_choices",
  };
  return input;
}

export function cardioPriorityInput(): QuestionnaireInput {
  const input = baseInput();
  input.age = 44;
  input.goals = {
    primary: "cardio",
    secondary: "health",
    primaryWeight: 70,
    startDate: "2026-08-10",
    horizon: { kind: "indefinite" },
  };
  input.schedule.liftingDaysPerWeek = 2;
  input.schedule.targetLiftMinutes = 45;
  input.schedule.targetCardioMinutes = 50;
  input.cardio = {
    purpose: "performance",
    currentEasySessions: 3,
    currentModerateSessions: 1,
    currentHardSessions: 1,
    typicalEasyMinutes: 40,
    typicalModerateMinutes: 35,
    typicalHardMinutes: 30,
    longestRecentSessionMinutes: 70,
    preferredModalities: ["running", "cycling"],
    avoidRunning: false,
    heartRateDevice: "chest_strap",
    knownMaxHeartRate: 181,
    advanced: {
      weeklyMinutes: 190,
      restingHeartRate: 54,
      intensityMethod: "heart_rate_reserve",
      maxHardSessions: 2,
    },
  };
  return input;
}

export function logExerciseAcrossWeeks(
  program: TrainingProgram,
  exerciseId: string,
  weeks: number[],
  rirDelta: number,
  options: { pain?: boolean; fail?: boolean } = {},
): WeekLog[] {
  return weeks.map((weekNumber) => {
    const week = program.weeks.find((item) => item.weekNumber === weekNumber);
    const session = week?.sessions.find((item) =>
      item.exercises.some((exercise) => exercise.exerciseId === exerciseId),
    );
    const prescription = session?.exercises.find(
      (item) => item.exerciseId === exerciseId,
    );
    if (session === undefined || prescription === undefined)
      throw new Error(`No ${exerciseId} in week ${weekNumber}`);
    const target =
      (prescription.targetRir.min + prescription.targetRir.max) / 2;
    return {
      weekNumber,
      sessions: [
        {
          sessionId: session.id,
          status: options.fail === true ? "partial" : "completed",
          durationMinutes: session.predictedMinutes,
          exercises: [
            {
              prescriptionId: prescription.id,
              exerciseId,
              sets: Array.from({ length: prescription.sets }, (_, index) => ({
                reps: prescription.reps.min,
                ...(prescription.load === undefined
                  ? { load: 50 }
                  : { load: prescription.load }),
                rir: Math.max(0, target + rirDelta),
                completed: !(
                  options.fail === true && index === prescription.sets - 1
                ),
                techniqueOkay: options.fail !== true,
                pain: options.pain === true,
              })),
            },
          ],
        },
      ],
    };
  });
}
