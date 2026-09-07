import type { DayOfWeek, GoalDomain } from "$lib/domain";

/**
 * Stable questionnaire navigation contract.
 *
 * Field ownership used to be duplicated in the Svelte page and server-side
 * validation. Keep it here so a new parser or engine error path has one place
 * to declare which page owns the correction and which control receives focus.
 */
export const QUESTIONNAIRE_STEPS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
export type QuestionnaireStep = (typeof QUESTIONNAIRE_STEPS)[number];

export const QUESTIONNAIRE_DAY_OPTIONS = [
  ["monday", "Monday"],
  ["tuesday", "Tuesday"],
  ["wednesday", "Wednesday"],
  ["thursday", "Thursday"],
  ["friday", "Friday"],
  ["saturday", "Saturday"],
  ["sunday", "Sunday"],
] as const satisfies readonly (readonly [DayOfWeek, string])[];

export const QUESTIONNAIRE_DAYS = QUESTIONNAIRE_DAY_OPTIONS.map(
  ([value]) => value,
) as DayOfWeek[];

const STEP_FIELDS: Readonly<Record<QuestionnaireStep, readonly string[]>> = {
  1: [
    "name",
    "programIcon",
    "age",
    "units",
    "clientDate",
    "timeZone",
    "primaryGoal",
    "primaryWeight",
    "secondaryGoal",
    "startDate",
    "hasEvent",
    "eventType",
    "eventDate",
    "eventCertainty",
    "horizonKind",
    "horizonWeeks",
    "initialBodyWeight",
    "bodyweightTracking",
    "dietGoal",
    "weeklyWeightCheckIns",
  ],
  2: [
    "planningStyle",
    "liftingDaysPerWeek",
    "targetLiftMinutes",
    "preferredTrainingDays",
    "unavailableDays",
    "cardioFocusedDays",
    "scheduleAdvancedEnabled",
    "minimumTrainingDays",
    "splitSessionDays",
  ],
  3: [
    "resistanceTrainingYears",
    "recentConsistency",
    "effortFamiliarity",
    "effortReporting",
    "typicalSleepHours",
    "nightsBelowSixPerWeek",
    "workActivity",
    "rotatingOrNightShifts",
    "playsSport",
    "sport",
    "sportHoursPerWeek",
    "sportLowerBodyDemandSessions",
    "stepTrackingMethod",
    "baselineStepBand",
    "baselineSteps",
    "dailyWalkingMinutes",
    "historyAdvancedEnabled",
    "recentSessionsPerWeek",
    "generalFitnessEmphasis",
    "preserveCompetitionLiftsHealth",
    "chairStandConcern",
    "balanceConcern",
    "floorTransferConcern",
  ],
  4: [
    "primaryEquipment",
    "usesAlternateGym",
    "alternateEquipment",
    "hasMovementRestrictions",
    "excludedMovements",
    "facilityAdvancedEnabled",
    "barbellIncrement",
    "dumbbellIncrement",
  ],
  5: [
    "powerliftingGoal",
    "competitionStyle",
    "squatStyle",
    "benchStyle",
    "deadliftStyle",
    "powerliftingAdvancedEnabled",
    "squatFrequencyPreference",
    "benchFrequencyPreference",
    "deadliftFrequencyPreference",
    "trainingMaxPercent",
  ],
  6: [
    "hypertrophySplit",
    "splitPreferenceStrength",
    "hypertrophyBalance",
    "exerciseSelection",
    "useSupersets",
    "preserveCompetitionLiftsHypertrophy",
    "specializationBias",
    "hypertrophyAdvancedEnabled",
    "targetFrequencyPerMuscle",
  ],
  7: [
    "cardioPlanType",
    "cardioPurpose",
    "primaryCardioModality",
    "acceptableCardioModalities",
    "cardioVariety",
    "cardioFrequencyBand",
    "cardioDurationBand",
    "cardioTypicalEffort",
    "hardCardioFrequency",
    "avoidRunning",
    "heartRateDevice",
    "cardioAdvancedEnabled",
    "currentEasySessions",
    "currentModerateSessions",
    "currentHardSessions",
    "typicalEasyMinutes",
    "typicalModerateMinutes",
    "typicalHardMinutes",
    "longestRecentSessionMinutes",
    "cardioWeeklyMinutes",
    "restingHeartRate",
    "cardioIntensityMethod",
    "maxHardSessions",
    "knownMaxHeartRate",
    "runningEventDistance",
    "runningGoalOutcome",
    "runningTargetTimeMinutes",
    "runningRecentBestMinutes",
    "runningSurface",
    "runningRouteProfile",
    "runningSessionsPerWeek",
    "runningDistanceUnit",
    "runningWeeklyDistance",
    "runningWeeklyMinutes",
    "longestRunDistance",
    "longestRunMinutes",
    "continuousRunMinutes",
    "runningBenchmarkType",
    "runningBenchmarkDate",
    "runningBenchmarkDistance",
    "runningBenchmarkMinutes",
    "runningBenchmarkVo2max",
    "vo2maxModality",
    "vo2maxBenchmarkType",
    "vo2maxBenchmarkDate",
    "vo2maxBenchmarkDistance",
    "vo2maxBenchmarkDistanceUnit",
    "vo2maxBenchmarkMinutes",
    "vo2maxBenchmarkVo2max",
  ],
  8: [
    "adaptationAdvancedEnabled",
    "applyChanges",
    "missedWorkoutPolicy",
    "adaptationDurationPolicy",
    "amrapPolicy",
    "disclaimerAccepted",
  ],
};

const EXACT_FIELD_STEPS = new Map<string, QuestionnaireStep>(
  Object.entries(STEP_FIELDS).flatMap(([rawStep, fields]) => {
    const step = Number(rawStep) as QuestionnaireStep;
    return fields.map((field) => [field, step] as const);
  }),
);

const PREFIX_FIELD_STEPS: readonly (readonly [string, QuestionnaireStep])[] = [
  ["goals", 1],
  ["weight", 1],
  ["schedule", 2],
  ["history", 3],
  ["recovery", 3],
  ["generalFitness", 3],
  ["dailyMovement", 3],
  ["facility", 4],
  ["powerlifting", 5],
  ["hypertrophy", 6],
  ["musclePriority", 6],
  ["cardio", 7],
  ["adaptation", 8],
];

const CONTROL_ALIASES: Readonly<Record<string, string>> = {
  "goals.startDate": "startDate",
  "goals.event": "hasEvent",
  "goals.event.date": "eventDate",
  "goals.event.type": "eventType",
  "goals.secondary": "secondaryGoal",
  "goals.horizon.weeks": "horizonWeeks",
  "schedule.liftingDaysPerWeek": "liftingDaysPerWeek",
  "schedule.preferredTrainingDays": "preferredTrainingDays",
  "schedule.unavailableDays": "unavailableDays",
  "schedule.advanced.minimumTrainingDays": "minimumTrainingDays",
  "dailyMovement.trackingMethod": "stepTrackingMethod",
  "dailyMovement.baselineSteps": "baselineSteps",
  "dailyMovement.baselineWalkingMinutes": "dailyWalkingMinutes",
  "facility.primaryEquipment": "primaryEquipment",
  "facility.alternateEquipment": "alternateEquipment",
  "cardio.preferredModalities": "primaryCardioModality",
  "cardio.goal": "cardioPlanType",
  "cardio.goal.type": "cardioPlanType",
  "cardio.goal.runningEvent": "runningEventDistance",
  "cardio.goal.runningEvent.targetTimeMinutes": "runningTargetTimeMinutes",
  "cardio.runningBaseline": "runningSessionsPerWeek",
  "safety.disclaimerAccepted": "disclaimerAccepted",
};

export const QUESTIONNAIRE_ACTION_ONLY_FIELDS = [
  "programId",
  "questionnaireStep",
] as const;

export function questionnaireStepForField(field: string): QuestionnaireStep {
  const normalized = field.trim();
  const exact = EXACT_FIELD_STEPS.get(normalized);
  if (exact !== undefined) return exact;

  if (/^(squat|bench|deadlift)(Observation|Frequency)/.test(normalized))
    return 5;
  if (/^hardSets_/.test(normalized)) return 3;
  if (/^musclePriority[1-3]$/.test(normalized)) return 6;
  if (normalized === "safety.disclaimerAccepted") return 8;
  if (
    normalized === "safety.excludedMovements" ||
    normalized === "safety.excludedExercises"
  )
    return 4;

  const prefix = PREFIX_FIELD_STEPS.find(
    ([candidate]) =>
      normalized === candidate || normalized.startsWith(`${candidate}.`),
  );
  // Unknown boundary errors belong to final review instead of unexpectedly
  // sending a user back to page one or blocking an unvisited early page.
  return prefix?.[1] ?? 8;
}

export function questionnaireControlForField(
  field: string,
): string | undefined {
  const normalized = field.trim();
  if (normalized === "" || normalized === "questionnaire") return undefined;
  return CONTROL_ALIASES[normalized] ?? normalized.split(".").at(-1);
}

export function allQuestionnaireDays(): DayOfWeek[] {
  return [...QUESTIONNAIRE_DAYS];
}

export function normalizeQuestionnaireDays(
  values: readonly string[],
): DayOfWeek[] {
  return values.filter(
    (value, index, all): value is DayOfWeek =>
      QUESTIONNAIRE_DAYS.includes(value as DayOfWeek) &&
      all.indexOf(value) === index,
  );
}

export function isAllQuestionnaireDays(values: readonly string[]): boolean {
  const selected = new Set(values);
  return QUESTIONNAIRE_DAYS.every((day) => selected.has(day));
}

export function goalSpecificQuestionnaireSteps(
  primary: GoalDomain | string,
  secondary?: GoalDomain | "none" | string,
): QuestionnaireStep[] {
  const goals = new Set([
    primary,
    ...(secondary === undefined || secondary === "none" ? [] : [secondary]),
  ]);
  return [
    ...(goals.has("powerlifting") ? ([5] as const) : []),
    ...(goals.has("hypertrophy") ? ([6] as const) : []),
  ];
}

export function visibleQuestionnaireSteps(
  primary: GoalDomain | string,
  secondary?: GoalDomain | "none" | string,
): QuestionnaireStep[] {
  return [
    1,
    2,
    3,
    4,
    ...goalSpecificQuestionnaireSteps(primary, secondary),
    7,
    8,
  ];
}
