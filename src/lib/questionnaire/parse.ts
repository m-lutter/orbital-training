import type {
  AdaptationPreferenceInput,
  CardioInput,
  CardioModality,
  DailyMovementInput,
  DayOfWeek,
  Equipment,
  GeneralFitnessInput,
  GoalDomain,
  HypertrophyInput,
  HypertrophySplit,
  MovementPattern,
  Muscle,
  PerformanceObservation,
  PowerliftingInput,
  QuestionnaireInput,
  RecoveryInput,
  TrainingHistoryInput,
  UnitSystem,
} from "$lib/domain";

export const QUESTIONNAIRE_VERSION = 3 as const;

export type QuestionnaireFormValues = Record<string, string | string[]>;

export interface ParsedQuestionnaire {
  name: string;
  input: QuestionnaireInput;
  values: QuestionnaireFormValues;
}

export class QuestionnaireFormError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(message);
    this.name = "QuestionnaireFormError";
  }
}

const DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const satisfies readonly DayOfWeek[];

const GOALS = [
  "powerlifting",
  "hypertrophy",
  "cardio",
  "health",
] as const satisfies readonly GoalDomain[];

const EQUIPMENT = [
  "bodyweight",
  "barbell",
  "rack",
  "bench",
  "plates",
  "dumbbells",
  "cables",
  "machines",
  "smith_machine",
  "pullup_bar",
  "bands",
  "cardio_bike",
  "treadmill",
  "rower",
  "elliptical",
  "outdoors",
  "pool",
] as const satisfies readonly Equipment[];

const CARDIO_MODALITIES = [
  "walking",
  "running",
  "cycling",
  "rowing",
  "elliptical",
  "swimming",
  "rucking",
  "sport",
] as const satisfies readonly CardioModality[];

const MUSCLES = [
  "chest",
  "upper_chest",
  "lats",
  "upper_back",
  "quads",
  "hamstrings",
  "glutes",
  "calves",
  "biceps",
  "triceps",
  "front_delts",
  "side_delts",
  "rear_delts",
  "trunk",
] as const satisfies readonly Muscle[];

const MOVEMENT_PATTERNS = [
  "squat",
  "hinge",
  "horizontal_push",
  "vertical_push",
  "horizontal_pull",
  "vertical_pull",
  "knee_flexion",
  "elbow_flexion",
  "elbow_extension",
  "lateral_raise",
  "calf_raise",
  "trunk",
  "carry",
  "locomotion",
] as const satisfies readonly MovementPattern[];

const HYPERTROPHY_SPLITS = [
  "auto",
  "full_body",
  "upper_lower",
  "push_pull",
  "ppl",
  "ppl_upper_lower",
  "arnold",
  "torso_limbs",
  "body_part",
  "priority_hybrid",
] as const satisfies readonly HypertrophySplit[];

const SPORTS = [
  "basketball",
  "soccer",
  "american_football",
  "baseball_softball",
  "hockey",
  "rugby",
  "tennis_racquet",
  "combat",
  "running_endurance",
  "cycling",
  "swimming",
  "strength_sport",
  "golf",
  "other",
] as const;

const RECENT_SET_EFFORTS = [
  "rir_4",
  "rir_3.5",
  "rir_3",
  "rir_2.5",
  "rir_2",
  "rir_1.5",
  "rir_1",
  "rir_0.5",
  "rir_0",
  "rpe_6",
  "rpe_6.5",
  "rpe_7",
  "rpe_7.5",
  "rpe_8",
  "rpe_8.5",
  "rpe_9",
  "rpe_9.5",
  "rpe_10",
] as const;

function captureValues(formData: FormData): QuestionnaireFormValues {
  const values: QuestionnaireFormValues = {};
  for (const key of new Set(formData.keys())) {
    const entries = formData
      .getAll(key)
      .filter((value): value is string => typeof value === "string");
    values[key] = entries.length > 1 ? entries : (entries[0] ?? "");
  }
  return values;
}

export function captureQuestionnaireFormValues(
  formData: FormData,
): QuestionnaireFormValues {
  return captureValues(formData);
}

function text(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

function choice<T extends string>(
  formData: FormData,
  name: string,
  allowed: readonly T[],
  label: string,
): T {
  const value = text(formData, name);
  if (!allowed.includes(value as T)) {
    throw new QuestionnaireFormError(`Select a valid ${label}.`, name);
  }
  return value as T;
}

function optionalChoice<T extends string>(
  formData: FormData,
  name: string,
  allowed: readonly T[],
): T | undefined {
  const value = text(formData, name);
  if (value === "") return undefined;
  if (!allowed.includes(value as T)) {
    throw new QuestionnaireFormError("Select a valid option.", name);
  }
  return value as T;
}

function choices<T extends string>(
  formData: FormData,
  name: string,
  allowed: readonly T[],
): T[] {
  const selected = formData
    .getAll(name)
    .map(String)
    .filter((value, index, all) => all.indexOf(value) === index);
  if (selected.some((value) => !allowed.includes(value as T))) {
    throw new QuestionnaireFormError(
      "One or more selections are invalid.",
      name,
    );
  }
  return selected as T[];
}

function numberValue(
  formData: FormData,
  name: string,
  minimum: number,
  maximum: number,
  label: string,
  integer = false,
): number {
  const raw = text(formData, name);
  const value = Number(raw);
  if (
    raw === "" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum ||
    (integer && !Number.isInteger(value))
  ) {
    throw new QuestionnaireFormError(
      `${label} must be ${integer ? "a whole number " : ""}from ${minimum} to ${maximum}.`,
      name,
    );
  }
  return value;
}

function optionalNumber(
  formData: FormData,
  name: string,
  minimum: number,
  maximum: number,
  label: string,
  integer = false,
): number | undefined {
  if (text(formData, name) === "") return undefined;
  return numberValue(formData, name, minimum, maximum, label, integer);
}

function enabled(formData: FormData, name: string): boolean {
  return formData.getAll(name).some((value) => value === "yes");
}

function isoDate(
  formData: FormData,
  name: string,
  label: string,
): `${number}-${number}-${number}` {
  const value = text(formData, name);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new QuestionnaireFormError(`${label} must be a valid date.`, name);
  }
  return value as `${number}-${number}-${number}`;
}

function weeksBetween(start: string, end: string): number {
  return Math.max(
    1,
    Math.floor(
      (Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) /
        604_800_000,
    ),
  );
}

function parseObservations(
  formData: FormData,
  lift: "squat" | "bench" | "deadlift",
  asOfDate: string,
): PerformanceObservation[] | undefined {
  const observations: PerformanceObservation[] = [];
  for (const index of [1, 2]) {
    const prefix = `${lift}Observation${index}`;
    if (!enabled(formData, `${prefix}Enabled`)) continue;
    const effortRating = choice(
      formData,
      `${prefix}EffortRating`,
      RECENT_SET_EFFORTS,
      "effort rating",
    );
    const [scale, rawEffort] = effortRating.split("_") as [
      "rir" | "rpe",
      string,
    ];
    const effort = Number(rawEffort);
    const date = isoDate(formData, `${prefix}Date`, "Performance date");
    if (date > asOfDate) {
      throw new QuestionnaireFormError(
        "Recent performance dates cannot be in the future.",
        `${prefix}Date`,
      );
    }
    observations.push({
      load: numberValue(formData, `${prefix}Load`, 1, 5000, "Load"),
      reps: numberValue(formData, `${prefix}Reps`, 1, 10, "Repetitions", true),
      ...(scale === "rir" ? { rir: effort } : { rpe: effort }),
      date,
      stableTechnique:
        choice(
          formData,
          `${prefix}StableTechnique`,
          ["yes", "no"] as const,
          "technique answer",
        ) === "yes",
      completed: true,
    });
  }
  return observations.length === 0 ? undefined : observations;
}

function parsePowerlifting(
  formData: FormData,
  asOfDate: string,
): PowerliftingInput {
  const observations: PowerliftingInput["observations"] = {};
  for (const lift of ["squat", "bench", "deadlift"] as const) {
    const parsed = parseObservations(formData, lift, asOfDate);
    if (parsed !== undefined) observations[lift] = parsed;
  }

  const advanced = enabled(formData, "powerliftingAdvancedEnabled")
    ? {
        squatFrequencyPreference: optionalNumber(
          formData,
          "squatFrequencyPreference",
          1,
          6,
          "Squat frequency",
          true,
        ),
        benchFrequencyPreference: optionalNumber(
          formData,
          "benchFrequencyPreference",
          1,
          6,
          "Bench frequency",
          true,
        ),
        deadliftFrequencyPreference: optionalNumber(
          formData,
          "deadliftFrequencyPreference",
          1,
          6,
          "Deadlift frequency",
          true,
        ),
        trainingMaxPercent: optionalNumber(
          formData,
          "trainingMaxPercent",
          80,
          100,
          "Training-max percentage",
        ),
      }
    : undefined;

  return {
    goal: choice(
      formData,
      "powerliftingGoal",
      [
        "general_powerlifting",
        "return_to_powerlifting",
        "meet_prep",
        "peak_or_test",
        "work_capacity",
        "powerlifting_hypertrophy",
        "squat_specialization",
        "bench_specialization",
        "deadlift_specialization",
        "lower_specialization",
        "upper_specialization",
      ] as const,
      "powerlifting goal",
    ),
    squatStyle:
      optionalChoice(formData, "squatStyle", [
        "high_bar",
        "low_bar",
      ] as const) ?? "low_bar",
    benchStyle:
      optionalChoice(formData, "benchStyle", [
        "standard",
        "close_grip",
        "wide_grip",
      ] as const) ?? "standard",
    deadliftStyle:
      optionalChoice(formData, "deadliftStyle", [
        "conventional",
        "sumo",
      ] as const) ?? "conventional",
    competitionStyle:
      optionalChoice(formData, "competitionStyle", [
        "raw_sleeves",
        "raw_wraps",
        "equipped",
      ] as const) ?? "raw_sleeves",
    // Selecting powerlifting already answers this question. Do not ask users
    // whether a powerlifting program should retain the three competition lifts.
    preserveCompetitionLifts: true,
    observations,
    ...(advanced === undefined ? {} : { advanced }),
  };
}

function parseHypertrophy(
  formData: FormData,
  powerliftingSelected: boolean,
): HypertrophyInput {
  const balance = choice(
    formData,
    "hypertrophyBalance",
    ["balanced", "prioritized"] as const,
    "hypertrophy balance",
  );
  const priorities: HypertrophyInput["musclePriorities"] = [];
  if (balance === "prioritized") {
    for (const rank of [1, 2, 3] as const) {
      const muscle = optionalChoice(formData, `musclePriority${rank}`, MUSCLES);
      if (muscle !== undefined) priorities.push({ muscle, rank });
    }
    if (priorities.length === 0) {
      throw new QuestionnaireFormError(
        "Select at least one priority muscle or choose balanced development.",
        "musclePriority1",
      );
    }
    if (
      new Set(priorities.map((item) => item.muscle)).size !== priorities.length
    ) {
      throw new QuestionnaireFormError(
        "Each priority muscle must be different.",
        "musclePriority1",
      );
    }
  }

  return {
    splitPreference: choice(
      formData,
      "hypertrophySplit",
      HYPERTROPHY_SPLITS,
      "hypertrophy split",
    ),
    splitPreferenceStrength: choice(
      formData,
      "splitPreferenceStrength",
      ["engine_decide", "slight", "strong"] as const,
      "split preference strength",
    ),
    balance,
    musclePriorities: priorities,
    ...(balance === "prioritized"
      ? {
          specializationBias: optionalChoice(formData, "specializationBias", [
            "arms",
            "chest",
            "back",
            "legs",
            "delts",
          ] as const),
        }
      : {}),
    preserveCompetitionLifts:
      powerliftingSelected ||
      choice(
        formData,
        "preserveCompetitionLiftsHypertrophy",
        ["yes", "no"] as const,
        "competition-lift preference",
      ) === "yes",
    exerciseSelection: choice(
      formData,
      "exerciseSelection",
      ["engine_decide", "offer_choices", "user_selects"] as const,
      "exercise-selection preference",
    ),
    useSupersets: enabled(formData, "useSupersets"),
    ...(enabled(formData, "hypertrophyAdvancedEnabled")
      ? {
          advanced: {
            targetFrequencyPerMuscle: optionalNumber(
              formData,
              "targetFrequencyPerMuscle",
              1,
              6,
              "Target muscle frequency",
              true,
            ),
          },
        }
      : {}),
  };
}

function parseDailyMovement(formData: FormData): DailyMovementInput {
  const exactSteps = optionalNumber(
    formData,
    "baselineSteps",
    0,
    100000,
    "Average daily steps",
    true,
  );
  const band = optionalChoice(formData, "baselineStepBand", [
    "unknown",
    "under_3000",
    "3000_4999",
    "5000_7499",
    "7500_9999",
    "10000_plus",
  ] as const);
  const bandSteps =
    band === "under_3000"
      ? 2500
      : band === "3000_4999"
        ? 4000
        : band === "5000_7499"
          ? 6250
          : band === "7500_9999"
            ? 8750
            : band === "10000_plus"
              ? 11000
              : undefined;
  const trackingMethod =
    optionalChoice(formData, "stepTrackingMethod", [
      "wearable",
      "phone",
      "other_pedometer",
      "none",
    ] as const) ?? (exactSteps !== undefined ? "other_pedometer" : "none");
  return trackingMethod === "none"
    ? {
        trackingMethod,
        baselineWalkingMinutes:
          optionalNumber(
            formData,
            "dailyWalkingMinutes",
            0,
            600,
            "Daily walking minutes",
            true,
          ) ?? 15,
      }
    : {
        trackingMethod,
        ...((exactSteps ?? bandSteps) === undefined
          ? {}
          : { baselineSteps: exactSteps ?? bandSteps }),
      };
}

function parseGeneralFitness(
  formData: FormData,
  dailyMovement: DailyMovementInput,
): GeneralFitnessInput {
  return {
    emphasis: choice(
      formData,
      "generalFitnessEmphasis",
      ["balanced", "strength", "aerobic", "mobility", "function"] as const,
      "general-fitness emphasis",
    ),
    preserveCompetitionLifts: enabled(
      formData,
      "preserveCompetitionLiftsHealth",
    ),
    chairStandConcern: enabled(formData, "chairStandConcern"),
    balanceConcern: enabled(formData, "balanceConcern"),
    floorTransferConcern: enabled(formData, "floorTransferConcern"),
    dailyWalkingMinutes: dailyMovement.baselineWalkingMinutes,
    baselineSteps: dailyMovement.baselineSteps,
  };
}

function parseHistory(formData: FormData): TrainingHistoryInput {
  const advanced = enabled(formData, "historyAdvancedEnabled");
  const effortReporting = choice(
    formData,
    "effortReporting",
    ["rpe", "rir", "auto", "verbal"] as const,
    "effort-reporting method",
  );
  const hardSets: Partial<Record<Muscle, number>> = {};
  if (advanced) {
    for (const muscle of MUSCLES) {
      const value = optionalNumber(
        formData,
        `hardSets_${muscle}`,
        0,
        40,
        `${muscle} hard sets`,
        true,
      );
      if (value !== undefined) hardSets[muscle] = value;
    }
  }
  return {
    resistanceTrainingYears: numberValue(
      formData,
      "resistanceTrainingYears",
      0,
      80,
      "Resistance-training experience",
    ),
    recentConsistency: choice(
      formData,
      "recentConsistency",
      ["none", "sporadic", "one_to_two", "three_plus"] as const,
      "recent training consistency",
    ),
    effortFamiliarity: choice(
      formData,
      "effortFamiliarity",
      ["none", "basic", "confident"] as const,
      "effort-rating familiarity",
    ),
    effortReporting,
    ...(advanced
      ? {
          recentSessionsPerWeek: optionalNumber(
            formData,
            "recentSessionsPerWeek",
            0,
            14,
            "Recent weekly sessions",
            true,
          ),
          ...(Object.keys(hardSets).length === 0
            ? {}
            : { recentHardSetsPerMuscle: hardSets }),
        }
      : {}),
  };
}

function parseRecovery(formData: FormData): RecoveryInput {
  const playsSport = enabled(formData, "playsSport");
  return {
    typicalSleepHours: choice(
      formData,
      "typicalSleepHours",
      ["6", "6.5", "7", "7.5", "8", "8.5", "9", "9.5", "10"] as const,
      "typical sleep duration",
    ),
    nightsBelowSixPerWeek: numberValue(
      formData,
      "nightsBelowSixPerWeek",
      0,
      7,
      "Nights below six hours",
      true,
    ),
    workActivity: choice(
      formData,
      "workActivity",
      ["sedentary", "light", "moderate", "heavy"] as const,
      "work-activity level",
    ),
    rotatingOrNightShifts: enabled(formData, "rotatingOrNightShifts"),
    playsSport,
    ...(playsSport
      ? {
          sport: choice(formData, "sport", SPORTS, "sport"),
          sportHoursPerWeek: numberValue(
            formData,
            "sportHoursPerWeek",
            0.5,
            40,
            "Weekly sport hours",
          ),
          sportLowerBodyDemandSessions: numberValue(
            formData,
            "sportLowerBodyDemandSessions",
            0,
            14,
            "Lower-body-demanding sport sessions",
            true,
          ),
        }
      : {}),
  };
}

function parseCardio(formData: FormData): CardioInput {
  const planType =
    optionalChoice(formData, "cardioPlanType", [
      "general",
      "running_event",
      "vo2max",
    ] as const) ?? "general";
  const frequencyBand = optionalChoice(formData, "cardioFrequencyBand", [
    "none",
    "occasional",
    "one_to_two",
    "three_to_four",
    "five_plus",
  ] as const);
  const durationBand = optionalChoice(formData, "cardioDurationBand", [
    "under_15",
    "15_to_30",
    "31_to_45",
    "46_to_60",
    "over_60",
  ] as const);
  const effortBand = optionalChoice(formData, "cardioTypicalEffort", [
    "mostly_easy",
    "easy_moderate_mix",
    "mostly_moderate",
    "includes_hard",
  ] as const);
  const bandTotal =
    frequencyBand === undefined
      ? undefined
      : (
          {
            none: 0,
            occasional: 1,
            one_to_two: 2,
            three_to_four: 3,
            five_plus: 5,
          } as const
        )[frequencyBand];
  const bandMinutes =
    durationBand === undefined
      ? undefined
      : (
          {
            under_15: 10,
            "15_to_30": 20,
            "31_to_45": 35,
            "46_to_60": 50,
            over_60: 75,
          } as const
        )[durationBand];
  const bandLongest =
    frequencyBand === "none"
      ? 0
      : durationBand === undefined
        ? undefined
        : (
            {
              under_15: 15,
              "15_to_30": 30,
              "31_to_45": 45,
              "46_to_60": 60,
              over_60: 90,
            } as const
          )[durationBand];
  const hardFrequency = optionalChoice(formData, "hardCardioFrequency", [
    "none",
    "less_than_weekly",
    "once_weekly",
    "twice_or_more",
  ] as const);
  const bandHard = Math.min(
    bandTotal ?? 0,
    hardFrequency === "once_weekly"
      ? 1
      : hardFrequency === "twice_or_more"
        ? 2
        : 0,
  );
  const bandNonHard = Math.max(0, (bandTotal ?? 0) - bandHard);
  const bandModerate =
    effortBand === "mostly_moderate"
      ? bandNonHard
      : effortBand === "easy_moderate_mix"
        ? Math.floor(bandNonHard / 2)
        : 0;
  const bandEasy = Math.max(0, bandNonHard - bandModerate);

  const advancedCardio = enabled(formData, "cardioAdvancedEnabled");
  const acceptsNumericOverrides = frequencyBand === undefined || advancedCardio;
  const explicitEasySessions = acceptsNumericOverrides
    ? optionalNumber(
        formData,
        "currentEasySessions",
        0,
        14,
        "Easy cardio sessions",
        true,
      )
    : undefined;
  const explicitModerateSessions = acceptsNumericOverrides
    ? optionalNumber(
        formData,
        "currentModerateSessions",
        0,
        14,
        "Moderate cardio sessions",
        true,
      )
    : undefined;
  const explicitHardSessions = acceptsNumericOverrides
    ? optionalNumber(
        formData,
        "currentHardSessions",
        0,
        7,
        "Hard cardio sessions",
        true,
      )
    : undefined;
  const easySessions = explicitEasySessions ?? bandEasy;
  const moderateSessions = explicitModerateSessions ?? bandModerate;
  const hardSessions = explicitHardSessions ?? bandHard;
  if (easySessions + moderateSessions + hardSessions > 14) {
    throw new QuestionnaireFormError(
      "Current cardio sessions cannot total more than 14 per week.",
      "currentEasySessions",
    );
  }
  const primaryModality = choice(
    formData,
    "primaryCardioModality",
    CARDIO_MODALITIES,
    "primary cardio modality",
  );
  const acceptableModalities = choices(
    formData,
    "acceptableCardioModalities",
    CARDIO_MODALITIES,
  );
  const modalities = [primaryModality, ...acceptableModalities].filter(
    (value, index, all) => all.indexOf(value) === index,
  );
  const heartRateDevice = choice(
    formData,
    "heartRateDevice",
    ["none", "smartwatch", "chest_strap", "other"] as const,
    "heart-rate device",
  );
  const selectedPurpose = choice(
    formData,
    "cardioPurpose",
    [
      "health",
      "aerobic_base",
      "performance",
      "lifting_support",
      "recovery",
      "sport_support",
    ] as const,
    "cardio purpose",
  );
  const distanceUnit =
    optionalChoice(formData, "runningDistanceUnit", ["mi", "km"] as const) ??
    "mi";
  const parseBenchmark = (prefix: "running" | "vo2max") => {
    const type = optionalChoice(formData, `${prefix}BenchmarkType`, [
      "none",
      "timed_distance",
      "twelve_minute",
      "wearable_vo2max",
    ] as const);
    if (type === undefined || type === "none") return undefined;
    const benchmarkDistanceUnit =
      prefix === "running"
        ? distanceUnit
        : (optionalChoice(formData, "vo2maxBenchmarkDistanceUnit", [
            "mi",
            "km",
            "m",
            "yd",
          ] as const) ?? (type === "twelve_minute" ? "m" : "km"));
    return {
      type,
      ...(text(formData, `${prefix}BenchmarkDate`) === ""
        ? {}
        : {
            date: isoDate(formData, `${prefix}BenchmarkDate`, "Benchmark date"),
          }),
      ...(type === "wearable_vo2max"
        ? {
            wearableVo2max: numberValue(
              formData,
              `${prefix}BenchmarkVo2max`,
              10,
              100,
              "Wearable VO₂max estimate",
            ),
          }
        : {
            distance: numberValue(
              formData,
              `${prefix}BenchmarkDistance`,
              0.1,
              benchmarkDistanceUnit === "m" || benchmarkDistanceUnit === "yd"
                ? 100_000
                : 100,
              "Benchmark distance",
            ),
            distanceUnit: benchmarkDistanceUnit,
            timeMinutes: numberValue(
              formData,
              `${prefix}BenchmarkMinutes`,
              1,
              1440,
              "Benchmark time",
            ),
          }),
    };
  };
  const runningRelevant =
    planType === "running_event" ||
    primaryModality === "running" ||
    (planType === "vo2max" &&
      optionalChoice(formData, "vo2maxModality", CARDIO_MODALITIES) ===
        "running");
  const runningBaseline = runningRelevant
    ? {
        runsPerWeek:
          optionalNumber(
            formData,
            "runningSessionsPerWeek",
            0,
            14,
            "Runs per week",
            true,
          ) ?? 0,
        distanceUnit,
        weeklyDistance: optionalNumber(
          formData,
          "runningWeeklyDistance",
          0,
          300,
          "Weekly running distance",
        ),
        weeklyMinutes: optionalNumber(
          formData,
          "runningWeeklyMinutes",
          0,
          3000,
          "Weekly running time",
          true,
        ),
        longestRunDistance: optionalNumber(
          formData,
          "longestRunDistance",
          0,
          100,
          "Longest recent run",
        ),
        longestRunMinutes: optionalNumber(
          formData,
          "longestRunMinutes",
          0,
          1440,
          "Longest recent run time",
          true,
        ),
        continuousRunMinutes: optionalNumber(
          formData,
          "continuousRunMinutes",
          0,
          1440,
          "Continuous running capacity",
          true,
        ),
        benchmark: parseBenchmark("running"),
      }
    : undefined;
  const goal =
    planType === "running_event"
      ? {
          type: planType,
          runningEvent: {
            distance: choice(
              formData,
              "runningEventDistance",
              ["5k", "10k", "half_marathon", "marathon"] as const,
              "event distance",
            ),
            outcome: choice(
              formData,
              "runningGoalOutcome",
              [
                "finish",
                "comfortable_finish",
                "improve_pb",
                "target_time",
              ] as const,
              "event goal",
            ),
            targetTimeMinutes: optionalNumber(
              formData,
              "runningTargetTimeMinutes",
              10,
              1440,
              "Target finish time",
            ),
            recentBestMinutes: optionalNumber(
              formData,
              "runningRecentBestMinutes",
              5,
              1440,
              "Recent best time",
            ),
            surface: choice(
              formData,
              "runningSurface",
              ["road", "track", "trail", "treadmill", "mixed"] as const,
              "event surface",
            ),
            routeProfile: choice(
              formData,
              "runningRouteProfile",
              ["flat", "rolling", "hilly", "unknown"] as const,
              "route profile",
            ),
          },
        }
      : planType === "vo2max"
        ? {
            type: planType,
            vo2max: {
              modality: choice(
                formData,
                "vo2maxModality",
                CARDIO_MODALITIES,
                "VO₂max modality",
              ),
              benchmark: parseBenchmark("vo2max"),
            },
          }
        : {
            type: planType,
            generalFocus: (selectedPurpose === "performance"
              ? "performance"
              : selectedPurpose === "aerobic_base"
                ? "aerobic_base"
                : "health") as "health" | "aerobic_base" | "performance",
          };
  return {
    purpose: planType === "general" ? selectedPurpose : "performance",
    currentEasySessions: easySessions,
    currentModerateSessions: moderateSessions,
    currentHardSessions: hardSessions,
    typicalEasyMinutes:
      easySessions === 0
        ? 0
        : acceptsNumericOverrides
          ? (optionalNumber(
              formData,
              "typicalEasyMinutes",
              5,
              600,
              "Typical easy-cardio duration",
              true,
            ) ??
            bandMinutes ??
            20)
          : (bandMinutes ?? 20),
    typicalModerateMinutes:
      moderateSessions === 0
        ? 0
        : acceptsNumericOverrides
          ? (optionalNumber(
              formData,
              "typicalModerateMinutes",
              5,
              600,
              "Typical moderate-cardio duration",
              true,
            ) ??
            bandMinutes ??
            20)
          : (bandMinutes ?? 20),
    typicalHardMinutes:
      hardSessions === 0
        ? 0
        : acceptsNumericOverrides
          ? (optionalNumber(
              formData,
              "typicalHardMinutes",
              5,
              300,
              "Typical hard-cardio duration",
              true,
            ) ??
            bandMinutes ??
            20)
          : (bandMinutes ?? 20),
    longestRecentSessionMinutes: acceptsNumericOverrides
      ? (optionalNumber(
          formData,
          "longestRecentSessionMinutes",
          0,
          600,
          "Longest recent cardio session",
          true,
        ) ??
        bandLongest ??
        30)
      : (bandLongest ?? 30),
    preferredModalities: modalities,
    varietyPreference:
      optionalChoice(formData, "cardioVariety", [
        "mostly_primary",
        "regular_variety",
        "broad_mix",
      ] as const) ?? "regular_variety",
    avoidRunning: enabled(formData, "avoidRunning"),
    heartRateDevice,
    goal,
    ...(runningBaseline === undefined ? {} : { runningBaseline }),
    ...(advancedCardio
      ? {
          knownMaxHeartRate:
            heartRateDevice === "none"
              ? undefined
              : optionalNumber(
                  formData,
                  "knownMaxHeartRate",
                  80,
                  240,
                  "Known maximum heart rate",
                  true,
                ),
          advanced: {
            weeklyMinutes: optionalNumber(
              formData,
              "cardioWeeklyMinutes",
              0,
              3000,
              "Weekly cardio minutes",
              true,
            ),
            restingHeartRate:
              heartRateDevice === "none"
                ? undefined
                : optionalNumber(
                    formData,
                    "restingHeartRate",
                    25,
                    150,
                    "Resting heart rate",
                    true,
                  ),
            intensityMethod: optionalChoice(formData, "cardioIntensityMethod", [
              "talk_test_rpe",
              "heart_rate_reserve",
              "pace_power",
            ] as const),
            maxHardSessions: optionalNumber(
              formData,
              "maxHardSessions",
              0,
              3,
              "Maximum hard sessions",
              true,
            ),
          },
        }
      : {}),
  };
}

export function deriveTargetCardioMinutes(
  cardio: CardioInput,
  primaryGoal: GoalDomain,
): number {
  const observedDurations = [
    cardio.typicalEasyMinutes,
    cardio.typicalModerateMinutes,
    cardio.typicalHardMinutes,
  ].filter((minutes) => minutes > 0);
  const defaultMinutes =
    primaryGoal === "cardio" ? 30 : primaryGoal === "health" ? 25 : 20;
  const recentSessionBaseline =
    observedDurations.length === 0
      ? defaultMinutes
      : Math.max(...observedDurations);
  const runningBaselineMinutes = cardio.runningBaseline?.longestRunMinutes;
  const recentCapacityCeiling =
    (runningBaselineMinutes ?? cardio.longestRecentSessionMinutes) > 0
      ? (runningBaselineMinutes ?? cardio.longestRecentSessionMinutes) + 5
      : defaultMinutes;
  const goalAppropriateCeiling =
    cardio.goal?.type === "running_event"
      ? 180
      : primaryGoal === "cardio"
        ? 90
        : 60;

  return Math.max(
    10,
    Math.min(
      Math.max(
        recentSessionBaseline,
        cardio.goal?.type === "running_event"
          ? Math.min(45, runningBaselineMinutes ?? 30)
          : 0,
      ),
      recentCapacityCeiling,
      goalAppropriateCeiling,
    ),
  );
}

function parseAdaptation(formData: FormData): AdaptationPreferenceInput {
  const advanced = enabled(formData, "adaptationAdvancedEnabled");
  return {
    applyChanges: advanced
      ? choice(
          formData,
          "applyChanges",
          ["automatic", "ask_first"] as const,
          "adaptation policy",
        )
      : "automatic",
    missedWorkoutPolicy: advanced
      ? choice(
          formData,
          "missedWorkoutPolicy",
          ["preserve_weekdays_drop_low_priority", "reflow_week"] as const,
          "missed-workout policy",
        )
      : "preserve_weekdays_drop_low_priority",
    amrapPolicy: choice(
      formData,
      "amrapPolicy",
      ["none", "controlled", "max_effort"] as const,
      "AMRAP preference",
    ),
    durationPolicy: advanced
      ? choice(
          formData,
          "adaptationDurationPolicy",
          ["allow_exceed", "trim_low_priority", "offer_shorter"] as const,
          "duration policy",
        )
      : "allow_exceed",
    substitutionPolicy: "recommend_then_ask",
  };
}

export function parseQuestionnaireForm(
  formData: FormData,
  asOfDate: `${number}-${number}-${number}`,
): ParsedQuestionnaire {
  const values = captureValues(formData);
  const name = text(formData, "name");
  if (name.length < 1 || name.length > 100) {
    throw new QuestionnaireFormError(
      "Enter a program name between 1 and 100 characters.",
      "name",
    );
  }

  const primary = choice(formData, "primaryGoal", GOALS, "primary goal");
  const secondaryRaw = choice(
    formData,
    "secondaryGoal",
    ["none", ...GOALS] as const,
    "secondary goal",
  );
  const primaryWeight =
    secondaryRaw === "none"
      ? ("100" as const)
      : choice(
          formData,
          "primaryWeight",
          ["50", "60", "70", "80", "90"] as const,
          "goal priority",
        );
  const secondary = secondaryRaw === "none" ? undefined : secondaryRaw;
  if (secondary === primary) {
    throw new QuestionnaireFormError(
      "Primary and secondary goals must be different.",
      "secondaryGoal",
    );
  }

  const startDate = isoDate(formData, "startDate", "Start date");
  const hasEvent = enabled(formData, "hasEvent");
  const event = hasEvent
    ? {
        type: choice(
          formData,
          "eventType",
          [
            "powerlifting_meet",
            "mock_meet",
            "race",
            "sport_event",
            "other",
          ] as const,
          "event type",
        ),
        date: isoDate(formData, "eventDate", "Event date"),
        certainty: choice(
          formData,
          "eventCertainty",
          ["confirmed", "likely", "tentative"] as const,
          "event certainty",
        ),
      }
    : undefined;
  const horizon = hasEvent
    ? {
        kind: "fixed" as const,
        weeks: weeksBetween(startDate, event?.date ?? startDate),
      }
    : choice(
          formData,
          "horizonKind",
          ["fixed", "indefinite"] as const,
          "program length",
        ) === "indefinite"
      ? { kind: "indefinite" as const }
      : {
          kind: "fixed" as const,
          weeks: numberValue(
            formData,
            "horizonWeeks",
            2,
            16,
            "Program length",
            true,
          ),
        };

  const preferredTrainingDays = choices(
    formData,
    "preferredTrainingDays",
    DAYS,
  );
  const unavailableDays = choices(formData, "unavailableDays", DAYS);
  const overlap = preferredTrainingDays.find((day) =>
    unavailableDays.includes(day),
  );
  if (overlap !== undefined) {
    throw new QuestionnaireFormError(
      `${overlap} cannot be both preferred and unavailable.`,
      "unavailableDays",
    );
  }

  const scheduleAdvanced = enabled(formData, "scheduleAdvancedEnabled");
  const splitSessionDays = scheduleAdvanced
    ? choices(formData, "splitSessionDays", DAYS)
    : [];
  const adaptation = parseAdaptation(formData);
  const units = choice(
    formData,
    "units",
    ["lb", "kg"] as const,
    "unit system",
  ) as UnitSystem;
  const primaryEquipment = choices(formData, "primaryEquipment", EQUIPMENT);
  if (primaryEquipment.length === 0) {
    throw new QuestionnaireFormError(
      "Select at least bodyweight/floor-space training or one available piece of equipment.",
      "primaryEquipment",
    );
  }
  const usesAlternateGym = enabled(formData, "usesAlternateGym");
  const alternateEquipment = usesAlternateGym
    ? choices(formData, "alternateEquipment", EQUIPMENT)
    : undefined;
  if (usesAlternateGym && alternateEquipment?.length === 0) {
    throw new QuestionnaireFormError(
      "Select the equipment available at the alternate gym.",
      "alternateEquipment",
    );
  }

  const needsPowerlifting =
    primary === "powerlifting" || secondary === "powerlifting";
  const needsHypertrophy =
    primary === "hypertrophy" || secondary === "hypertrophy";
  const needsHealth = primary === "health" || secondary === "health";
  const powerlifting = needsPowerlifting
    ? parsePowerlifting(formData, asOfDate)
    : undefined;
  const cardio = parseCardio(formData);
  const targetCardioMinutes = deriveTargetCardioMinutes(cardio, primary);
  if (cardio.goal?.type === "running_event") {
    if (event?.type !== "race") {
      throw new QuestionnaireFormError(
        "Running-event training needs a scheduled race date. On Goals, choose a scheduled event and select Race.",
        "hasEvent",
      );
    }
    if (
      cardio.goal.runningEvent?.outcome === "target_time" &&
      cardio.goal.runningEvent.targetTimeMinutes === undefined
    ) {
      throw new QuestionnaireFormError(
        "Enter the finish time you want to train toward.",
        "runningTargetTimeMinutes",
      );
    }
    if (cardio.avoidRunning) {
      throw new QuestionnaireFormError(
        "Running cannot be avoided in a running-event plan. Choose another cardio goal or allow running.",
        "avoidRunning",
      );
    }
  }
  if (
    powerlifting !== undefined &&
    (powerlifting.goal === "meet_prep" ||
      powerlifting.goal === "peak_or_test") &&
    !hasEvent
  ) {
    throw new QuestionnaireFormError(
      "Meet preparation and peaking require a dated meet, mock meet, or test event.",
      "hasEvent",
    );
  }
  if (
    powerlifting?.goal === "meet_prep" &&
    event?.type !== "powerlifting_meet"
  ) {
    throw new QuestionnaireFormError(
      "Upcoming meet preparation requires the event type to be Powerlifting meet.",
      "eventType",
    );
  }
  if (
    powerlifting?.goal === "peak_or_test" &&
    event !== undefined &&
    !["powerlifting_meet", "mock_meet"].includes(event.type)
  ) {
    throw new QuestionnaireFormError(
      "A powerlifting peak must end at a powerlifting meet or mock meet/strength test.",
      "eventType",
    );
  }

  const trackingWeight =
    choice(
      formData,
      "bodyweightTracking",
      ["ignore", "track"] as const,
      "bodyweight-tracking preference",
    ) === "track";
  const timeZone = text(formData, "timeZone");
  try {
    if (timeZone.length < 1) throw new RangeError("Missing time zone");
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
  } catch {
    throw new QuestionnaireFormError(
      "Select or reload to detect a valid time zone.",
      "timeZone",
    );
  }
  const dailyMovement = parseDailyMovement(formData);
  const input: QuestionnaireInput = {
    asOfDate,
    timeZone,
    age: numberValue(formData, "age", 18, 100, "Age (adult programming)", true),
    units,
    weight: {
      initialBodyWeight: optionalNumber(
        formData,
        "initialBodyWeight",
        20,
        1500,
        "Initial bodyweight",
      ),
      ignoreAfterInitial: !trackingWeight,
      dietGoal: trackingWeight
        ? choice(
            formData,
            "dietGoal",
            ["gain", "maintain", "lose", "no_goal"] as const,
            "diet goal",
          )
        : "no_goal",
      weeklyCheckIns:
        trackingWeight &&
        choice(
          formData,
          "weeklyWeightCheckIns",
          ["yes", "no"] as const,
          "weekly bodyweight check-in preference",
        ) === "yes",
    },
    safety: {
      disclaimerAccepted: enabled(formData, "disclaimerAccepted"),
      allowOperationalRestrictions: enabled(
        formData,
        "hasMovementRestrictions",
      ),
      excludedExercises: [],
      excludedMovements: enabled(formData, "hasMovementRestrictions")
        ? choices(formData, "excludedMovements", MOVEMENT_PATTERNS)
        : [],
      restrictedBodyAreas: [],
      clinicianRestrictions: [],
    },
    goals: {
      primary,
      ...(secondary === undefined ? {} : { secondary }),
      primaryWeight: Number(primaryWeight) as 50 | 60 | 70 | 80 | 90 | 100,
      startDate,
      horizon,
      ...(event === undefined ? {} : { event }),
    },
    schedule: {
      liftingDaysPerWeek: numberValue(
        formData,
        "liftingDaysPerWeek",
        1,
        6,
        "Lifting days",
        true,
      ),
      planningStyle: choice(
        formData,
        "planningStyle",
        ["flexible_sequence", "calendar_days"] as const,
        "planning style",
      ),
      preferredTrainingDays,
      unavailableDays,
      targetLiftMinutes: numberValue(
        formData,
        "targetLiftMinutes",
        20,
        180,
        "Target lifting-session duration",
        true,
      ),
      targetCardioMinutes,
      cardioFocusedDays: choices(formData, "cardioFocusedDays", DAYS),
      ...(scheduleAdvanced
        ? {
            advanced: {
              minimumTrainingDays: numberValue(
                formData,
                "minimumTrainingDays",
                1,
                6,
                "Minimum training days",
                true,
              ),
              splitSessionDays,
              allowCombinedSessions: splitSessionDays.length > 0,
              allowSeparateSameDay: splitSessionDays.length > 0,
              durationPolicy: adaptation.durationPolicy,
            },
          }
        : {}),
    },
    history: parseHistory(formData),
    facility: {
      primaryEquipment,
      ...(alternateEquipment === undefined ? {} : { alternateEquipment }),
      barbellIncrement: enabled(formData, "facilityAdvancedEnabled")
        ? optionalNumber(
            formData,
            "barbellIncrement",
            0.1,
            100,
            "Barbell increment",
          )
        : undefined,
      dumbbellIncrement: enabled(formData, "facilityAdvancedEnabled")
        ? optionalNumber(
            formData,
            "dumbbellIncrement",
            0.1,
            100,
            "Dumbbell increment",
          )
        : undefined,
      substitutionApproval: adaptation.substitutionPolicy,
    },
    recovery: parseRecovery(formData),
    dailyMovement,
    ...(needsHealth
      ? { generalFitness: parseGeneralFitness(formData, dailyMovement) }
      : {}),
    ...(powerlifting === undefined ? {} : { powerlifting }),
    ...(needsHypertrophy
      ? { hypertrophy: parseHypertrophy(formData, needsPowerlifting) }
      : {}),
    cardio,
    adaptation,
  };

  return { name, input, values };
}
