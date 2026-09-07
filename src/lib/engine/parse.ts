import type { ProgramDraft, ProgramDraftV3 } from "./contracts";
import { fingerprint, isIsoDate } from "$lib/domain/utils";
import { validateGeneratedProgram } from "$lib/domain/generation-invariants";

type UnknownRecord = Record<string, unknown>;

export class ProgramPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProgramPayloadError";
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown, maximum = 10_000): value is string {
  return typeof value === "string" && value.length <= maximum;
}

function isNonEmptyString(value: unknown, maximum = 10_000): value is string {
  return isString(value, maximum) && value.length > 0;
}

function isFiniteNumber(
  value: unknown,
  minimum = -Number.MAX_VALUE,
  maximum = Number.MAX_VALUE,
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function isInteger(
  value: unknown,
  minimum = Number.MIN_SAFE_INTEGER,
  maximum = Number.MAX_SAFE_INTEGER,
): value is number {
  return (
    Number.isInteger(value) &&
    Number(value) >= minimum &&
    Number(value) <= maximum
  );
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isOneOf<T extends string | number>(
  value: unknown,
  choices: readonly T[],
): value is T {
  return choices.includes(value as T);
}

function isStringArray(
  value: unknown,
  maximumItems = 1_000,
  maximumItemLength = 1_000,
): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maximumItems &&
    value.every((item) => isString(item, maximumItemLength))
  );
}

function isOptionalFiniteNumber(
  value: unknown,
  minimum: number,
  maximum: number,
): boolean {
  return value === undefined || isFiniteNumber(value, minimum, maximum);
}

function isOptionalString(value: unknown, maximum = 10_000): boolean {
  return value === undefined || isString(value, maximum);
}

function isQuestionnaireFormValues(value: unknown): boolean {
  return (
    isRecord(value) &&
    Object.keys(value).length <= 500 &&
    Object.values(value).every(
      (entry) =>
        isString(entry, 10_000) ||
        (Array.isArray(entry) &&
          entry.length <= 100 &&
          entry.every((item) => isString(item, 1_000))),
    )
  );
}

function hasCommonFields(value: UnknownRecord): boolean {
  return (
    isNonEmptyString(value.engineVersion, 100) &&
    isNonEmptyString(value.strategyId, 200) &&
    (value.continuation === "fixed" || value.continuation === "rolling") &&
    isRecord(value.inputSnapshot) &&
    Array.isArray(value.decisions) &&
    value.decisions.length <= 2_000 &&
    value.decisions.every(
      (decision) =>
        isRecord(decision) &&
        isNonEmptyString(decision.input, 500) &&
        isNonEmptyString(decision.effect, 10_000) &&
        isOptionalString(decision.support, 10_000) &&
        (decision.ruleIds === undefined ||
          isStringArray(decision.ruleIds, 100, 100)),
    )
  );
}

function isV1Session(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (value.kind === "lifting" || value.kind === "cardio") &&
    typeof value.targetMinutes === "number"
  );
}

function isV1Week(value: unknown): boolean {
  return (
    isRecord(value) &&
    Number.isInteger(value.weekNumber) &&
    Array.isArray(value.sessions) &&
    value.sessions.every(isV1Session)
  );
}

function isRepRange(value: unknown): boolean {
  return (
    isRecord(value) &&
    isFiniteNumber(value.min) &&
    isFiniteNumber(value.max) &&
    value.min <= value.max
  );
}

function isEffort(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.scale === "rpe" || value.scale === "rir") &&
    isFiniteNumber(value.target)
  );
}

const GOALS = ["powerlifting", "hypertrophy", "cardio", "health"] as const;
const DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;
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
  "pool",
  "outdoors",
] as const;
const MOVEMENTS = [
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
] as const;
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
] as const;

const PHASES = [
  "reentry",
  "base",
  "hypertrophy",
  "work_capacity",
  "strength",
  "specificity",
  "peak",
  "taper",
  "aerobic_base",
  "cardio_build",
  "review",
] as const;
const CARDIO_MODALITIES = [
  "walking",
  "running",
  "cycling",
  "rowing",
  "elliptical",
  "swimming",
  "rucking",
  "sport",
] as const;
const CARDIO_ROLES = [
  "recovery",
  "easy",
  "steady",
  "long",
  "tempo",
  "intervals",
  "benchmark",
] as const;
const INTENSITIES = ["easy", "moderate", "hard"] as const;

function isOptionalDate(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && isIsoDate(value));
}

function isBenchmark(value: unknown): boolean {
  return (
    value === undefined ||
    (isRecord(value) &&
      isOneOf(value.type, [
        "timed_distance",
        "twelve_minute",
        "wearable_vo2max",
      ] as const) &&
      isOptionalDate(value.date) &&
      isOptionalFiniteNumber(value.distance, 0, 1_000_000) &&
      (value.distanceUnit === undefined ||
        isOneOf(value.distanceUnit, ["mi", "km", "m", "yd"] as const)) &&
      isOptionalFiniteNumber(value.timeMinutes, 0, 10_080) &&
      isOptionalFiniteNumber(value.wearableVo2max, 1, 120))
  );
}

function isCardioDetails(value: UnknownRecord): boolean {
  if (value.role !== undefined && !isOneOf(value.role, CARDIO_ROLES))
    return false;
  if (
    value.eventPhase !== undefined &&
    !isOneOf(value.eventPhase, ["base", "build", "specific", "taper"] as const)
  )
    return false;
  if (
    value.targetDistance !== undefined &&
    (!isRecord(value.targetDistance) ||
      !isFiniteNumber(value.targetDistance.value, 0, 1_000) ||
      !isOneOf(value.targetDistance.unit, ["mi", "km"] as const))
  )
    return false;
  if (
    value.paceTarget !== undefined &&
    (!isRecord(value.paceTarget) ||
      !isFiniteNumber(value.paceTarget.minSecondsPerUnit, 1, 100_000) ||
      !isFiniteNumber(
        value.paceTarget.maxSecondsPerUnit,
        Number(value.paceTarget.minSecondsPerUnit),
        100_000,
      ) ||
      !isOneOf(value.paceTarget.unit, ["mi", "km"] as const) ||
      !isOneOf(value.paceTarget.basis, [
        "recent_best",
        "target_time",
        "benchmark",
      ] as const))
  )
    return false;
  if (
    value.intervals !== undefined &&
    (!isRecord(value.intervals) ||
      !isInteger(value.intervals.workSeconds, 1, 86_400) ||
      !isInteger(value.intervals.recoverySeconds, 0, 86_400) ||
      !isInteger(value.intervals.repeats, 1, 1_000))
  )
    return false;
  if (
    value.heartRateBpm !== undefined &&
    (!isRecord(value.heartRateBpm) ||
      !isFiniteNumber(value.heartRateBpm.min, 20, 250) ||
      !isFiniteNumber(
        value.heartRateBpm.max,
        Number(value.heartRateBpm.min),
        250,
      ) ||
      !isOptionalFiniteNumber(
        value.heartRateBpm.target,
        Number(value.heartRateBpm.min),
        Number(value.heartRateBpm.max),
      ) ||
      !isOneOf(value.heartRateBpm.method, [
        "heart_rate_reserve",
        "percent_max",
      ] as const))
  )
    return false;
  if (
    value.segments !== undefined &&
    (!Array.isArray(value.segments) ||
      value.segments.length > 100 ||
      !value.segments.every(
        (segment) =>
          isRecord(segment) &&
          isOneOf(segment.kind, [
            "warmup",
            "work",
            "recovery",
            "cooldown",
          ] as const) &&
          isString(segment.label, 2_000) &&
          isOptionalFiniteNumber(segment.minutes, 0, 1_440) &&
          isOptionalFiniteNumber(segment.distance, 0, 1_000) &&
          (segment.distanceUnit === undefined ||
            isOneOf(segment.distanceUnit, ["mi", "km"] as const)) &&
          (segment.repeats === undefined ||
            isInteger(
              segment.repeats,
              segment.kind === "recovery" ? 0 : 1,
              1_000,
            )) &&
          isOneOf(segment.intensity, INTENSITIES),
      ))
  )
    return false;
  return true;
}

function isAdvancedInput(value: UnknownRecord): boolean {
  const powerlifting = value.powerlifting as UnknownRecord | undefined;
  if (powerlifting?.advanced !== undefined) {
    const advanced = powerlifting.advanced;
    if (
      !isRecord(advanced) ||
      !isOptionalFiniteNumber(advanced.trainingMaxPercent, 50, 100) ||
      ![
        advanced.squatFrequencyPreference,
        advanced.benchFrequencyPreference,
        advanced.deadliftFrequencyPreference,
      ].every(
        (frequency) => frequency === undefined || isInteger(frequency, 1, 6),
      )
    )
      return false;
  }
  const hypertrophy = value.hypertrophy as UnknownRecord | undefined;
  if (
    hypertrophy?.specializationBias !== undefined &&
    !isOneOf(hypertrophy.specializationBias, [
      "arms",
      "chest",
      "back",
      "legs",
      "delts",
    ] as const)
  )
    return false;
  if (
    hypertrophy?.advanced !== undefined &&
    (!isRecord(hypertrophy.advanced) ||
      !(
        hypertrophy.advanced.targetFrequencyPerMuscle === undefined ||
        isInteger(hypertrophy.advanced.targetFrequencyPerMuscle, 1, 6)
      ))
  )
    return false;
  const cardio = value.cardio as UnknownRecord;
  if (cardio.advanced !== undefined) {
    const advanced = cardio.advanced;
    if (
      !isRecord(advanced) ||
      !isOptionalFiniteNumber(advanced.weeklyMinutes, 0, 10_080) ||
      !isOptionalFiniteNumber(advanced.restingHeartRate, 20, 200) ||
      !(
        advanced.maxHardSessions === undefined ||
        isInteger(advanced.maxHardSessions, 0, 7)
      ) ||
      !(
        advanced.intensityMethod === undefined ||
        isOneOf(advanced.intensityMethod, [
          "talk_test_rpe",
          "heart_rate_reserve",
          "pace_power",
        ] as const)
      )
    )
      return false;
  }
  const goal = cardio.goal as UnknownRecord | undefined;
  if (
    goal?.generalFocus !== undefined &&
    !isOneOf(goal.generalFocus, [
      "health",
      "aerobic_base",
      "performance",
    ] as const)
  )
    return false;
  if (goal?.type === "running_event" && !isRecord(goal.runningEvent))
    return false;
  if (goal?.type === "vo2max" && !isRecord(goal.vo2max)) return false;
  if (
    isRecord(goal?.vo2max) &&
    (!isOneOf(goal.vo2max.modality, CARDIO_MODALITIES) ||
      !isBenchmark(goal.vo2max.benchmark))
  )
    return false;
  if (
    isRecord(cardio.runningBaseline) &&
    !isBenchmark(cardio.runningBaseline.benchmark)
  )
    return false;
  return true;
}

function isEnumArray<T extends string>(
  value: unknown,
  choices: readonly T[],
  maximumItems = choices.length,
): boolean {
  return (
    Array.isArray(value) &&
    value.length <= maximumItems &&
    value.every((item) => isOneOf(item, choices))
  );
}

function isQuestionnaireInput(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const weight = value.weight;
  const safety = value.safety;
  const goals = value.goals;
  const schedule = value.schedule;
  const history = value.history;
  const facility = value.facility;
  const recovery = value.recovery;
  const cardio = value.cardio;
  const adaptation = value.adaptation;
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(String(value.asOfDate)) ||
    !isNonEmptyString(value.timeZone, 100) ||
    !isInteger(value.age, 13, 100) ||
    !isOneOf(value.units, ["lb", "kg"] as const) ||
    !isRecord(weight) ||
    !isOptionalFiniteNumber(weight.initialBodyWeight, 0, 2_000) ||
    !isBoolean(weight.ignoreAfterInitial) ||
    !isOneOf(weight.dietGoal, [
      "gain",
      "maintain",
      "lose",
      "no_goal",
    ] as const) ||
    !isBoolean(weight.weeklyCheckIns) ||
    !isRecord(safety) ||
    !isBoolean(safety.disclaimerAccepted) ||
    !isBoolean(safety.allowOperationalRestrictions) ||
    !isStringArray(safety.excludedExercises, 500, 200) ||
    !isEnumArray(safety.excludedMovements, MOVEMENTS) ||
    !isStringArray(safety.restrictedBodyAreas, 100, 200) ||
    !isStringArray(safety.clinicianRestrictions, 100, 2_000) ||
    !isRecord(goals) ||
    !isOneOf(goals.primary, GOALS) ||
    !(goals.secondary === undefined || isOneOf(goals.secondary, GOALS)) ||
    !isOneOf(goals.primaryWeight, [50, 60, 70, 80, 90, 100] as const) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(String(goals.startDate)) ||
    !isRecord(goals.horizon) ||
    !isOneOf(goals.horizon.kind, ["fixed", "indefinite"] as const) ||
    (goals.horizon.kind === "fixed" &&
      !isInteger(goals.horizon.weeks, 1, 53)) ||
    !isRecord(schedule) ||
    !isInteger(schedule.liftingDaysPerWeek, 1, 7) ||
    !isOneOf(schedule.planningStyle, [
      "flexible_sequence",
      "calendar_days",
    ] as const) ||
    !isEnumArray(schedule.preferredTrainingDays, DAYS) ||
    !isEnumArray(schedule.unavailableDays, DAYS) ||
    !isFiniteNumber(schedule.targetLiftMinutes, 1, 1_440) ||
    !isFiniteNumber(schedule.targetCardioMinutes, 1, 1_440) ||
    !isEnumArray(schedule.cardioFocusedDays, DAYS) ||
    !isRecord(history) ||
    !isFiniteNumber(history.resistanceTrainingYears, 0, 100) ||
    !isOneOf(history.recentConsistency, [
      "none",
      "sporadic",
      "one_to_two",
      "three_plus",
    ] as const) ||
    !isOneOf(history.effortFamiliarity, [
      "none",
      "basic",
      "confident",
    ] as const) ||
    !isOneOf(history.effortReporting, [
      "rpe",
      "rir",
      "auto",
      "verbal",
    ] as const) ||
    !isRecord(facility) ||
    !isEnumArray(facility.primaryEquipment, EQUIPMENT) ||
    !(
      facility.alternateEquipment === undefined ||
      isEnumArray(facility.alternateEquipment, EQUIPMENT)
    ) ||
    !isOptionalFiniteNumber(facility.barbellIncrement, 0.01, 100) ||
    !isOptionalFiniteNumber(facility.dumbbellIncrement, 0.01, 100) ||
    !isOneOf(facility.substitutionApproval, [
      "recommend_then_ask",
      "automatic",
      "manual_only",
    ] as const) ||
    !isRecord(recovery) ||
    !isOneOf(recovery.typicalSleepHours, [
      "<6",
      "6",
      "6.5",
      "7",
      "7.5",
      "8",
      "8.5",
      "9",
      "9.5",
      "10",
      ">10",
    ] as const) ||
    !isInteger(recovery.nightsBelowSixPerWeek, 0, 7) ||
    !isOneOf(recovery.workActivity, [
      "sedentary",
      "light",
      "moderate",
      "heavy",
    ] as const) ||
    !isBoolean(recovery.rotatingOrNightShifts) ||
    !isBoolean(recovery.playsSport) ||
    !isRecord(cardio) ||
    !isOneOf(cardio.purpose, [
      "health",
      "aerobic_base",
      "performance",
      "lifting_support",
      "recovery",
      "sport_support",
    ] as const) ||
    !isInteger(cardio.currentEasySessions, 0, 14) ||
    !isInteger(cardio.currentModerateSessions, 0, 14) ||
    !isInteger(cardio.currentHardSessions, 0, 14) ||
    !isFiniteNumber(cardio.typicalEasyMinutes, 0, 1_440) ||
    !isFiniteNumber(cardio.typicalModerateMinutes, 0, 1_440) ||
    !isFiniteNumber(cardio.typicalHardMinutes, 0, 1_440) ||
    !isFiniteNumber(cardio.longestRecentSessionMinutes, 0, 1_440) ||
    !isEnumArray(cardio.preferredModalities, [
      "walking",
      "running",
      "cycling",
      "rowing",
      "elliptical",
      "swimming",
      "rucking",
      "sport",
    ] as const) ||
    !isBoolean(cardio.avoidRunning) ||
    !isOneOf(cardio.heartRateDevice, [
      "none",
      "smartwatch",
      "chest_strap",
      "other",
    ] as const) ||
    !isRecord(adaptation) ||
    !isOneOf(adaptation.applyChanges, ["automatic", "ask_first"] as const) ||
    !isOneOf(adaptation.missedWorkoutPolicy, [
      "preserve_weekdays_drop_low_priority",
      "reflow_week",
    ] as const) ||
    !isOneOf(adaptation.amrapPolicy, [
      "none",
      "controlled",
      "max_effort",
    ] as const) ||
    !isOneOf(adaptation.durationPolicy, [
      "allow_exceed",
      "trim_low_priority",
      "offer_shorter",
    ] as const) ||
    !isOneOf(adaptation.substitutionPolicy, [
      "recommend_then_ask",
      "automatic",
      "manual_only",
    ] as const)
  )
    return false;

  if (goals.event !== undefined) {
    if (
      !isRecord(goals.event) ||
      !isOneOf(goals.event.type, [
        "powerlifting_meet",
        "mock_meet",
        "race",
        "sport_event",
        "other",
      ] as const) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(String(goals.event.date)) ||
      !isOneOf(goals.event.certainty, [
        "confirmed",
        "likely",
        "tentative",
      ] as const)
    )
      return false;
  }
  if (schedule.advanced !== undefined) {
    const advanced = schedule.advanced;
    if (
      !isRecord(advanced) ||
      !isInteger(advanced.minimumTrainingDays, 1, 7) ||
      !isEnumArray(advanced.splitSessionDays, DAYS) ||
      !(
        advanced.allowCombinedSessions === undefined ||
        isBoolean(advanced.allowCombinedSessions)
      ) ||
      !(
        advanced.allowSeparateSameDay === undefined ||
        isBoolean(advanced.allowSeparateSameDay)
      ) ||
      !isOneOf(advanced.durationPolicy, [
        "allow_exceed",
        "trim_low_priority",
        "offer_shorter",
      ] as const)
    )
      return false;
  }
  if (
    !isOptionalFiniteNumber(history.recentSessionsPerWeek, 0, 14) ||
    !(
      history.recentHardSetsPerMuscle === undefined ||
      (isRecord(history.recentHardSetsPerMuscle) &&
        Object.entries(history.recentHardSetsPerMuscle).every(
          ([muscle, sets]) =>
            isOneOf(muscle, MUSCLES) && isFiniteNumber(sets, 0, 100),
        ))
    ) ||
    !isOptionalString(recovery.sport, 200) ||
    !isOptionalFiniteNumber(recovery.sportHoursPerWeek, 0, 168) ||
    !isOptionalFiniteNumber(recovery.sportLowerBodyDemandSessions, 0, 14)
  )
    return false;

  const dailyMovement = value.dailyMovement;
  if (
    dailyMovement !== undefined &&
    (!isRecord(dailyMovement) ||
      !isOneOf(dailyMovement.trackingMethod, [
        "wearable",
        "phone",
        "other_pedometer",
        "none",
      ] as const) ||
      !isOptionalFiniteNumber(dailyMovement.baselineSteps, 0, 250_000) ||
      !isOptionalFiniteNumber(dailyMovement.baselineWalkingMinutes, 0, 1_440))
  )
    return false;

  const generalFitness = value.generalFitness;
  if (
    generalFitness !== undefined &&
    (!isRecord(generalFitness) ||
      !isOneOf(generalFitness.emphasis, [
        "balanced",
        "strength",
        "aerobic",
        "mobility",
        "function",
      ] as const) ||
      !(
        generalFitness.preserveCompetitionLifts === undefined ||
        isBoolean(generalFitness.preserveCompetitionLifts)
      ) ||
      !isBoolean(generalFitness.chairStandConcern) ||
      !isBoolean(generalFitness.balanceConcern) ||
      !isBoolean(generalFitness.floorTransferConcern) ||
      !isOptionalFiniteNumber(generalFitness.dailyWalkingMinutes, 0, 1_440) ||
      !isOptionalFiniteNumber(generalFitness.baselineSteps, 0, 250_000))
  )
    return false;

  const powerlifting = value.powerlifting;
  if (
    powerlifting !== undefined &&
    (!isRecord(powerlifting) ||
      !isOneOf(powerlifting.goal, [
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
      ] as const) ||
      !isOneOf(powerlifting.squatStyle, ["high_bar", "low_bar"] as const) ||
      !isOneOf(powerlifting.benchStyle, [
        "standard",
        "close_grip",
        "wide_grip",
      ] as const) ||
      !isOneOf(powerlifting.deadliftStyle, ["conventional", "sumo"] as const) ||
      !isOneOf(powerlifting.competitionStyle, [
        "raw_sleeves",
        "raw_wraps",
        "equipped",
      ] as const) ||
      !isBoolean(powerlifting.preserveCompetitionLifts) ||
      !isRecord(powerlifting.observations) ||
      !Object.entries(powerlifting.observations).every(
        ([lift, observations]) =>
          isOneOf(lift, ["squat", "bench", "deadlift"] as const) &&
          Array.isArray(observations) &&
          observations.length <= 100 &&
          observations.every(
            (observation) =>
              isRecord(observation) &&
              isFiniteNumber(observation.load, 0, 5_000) &&
              isInteger(observation.reps, 1, 100) &&
              isOptionalFiniteNumber(observation.rir, 0, 12) &&
              isOptionalFiniteNumber(observation.rpe, 1, 10) &&
              /^\d{4}-\d{2}-\d{2}$/.test(String(observation.date)) &&
              isBoolean(observation.stableTechnique) &&
              isBoolean(observation.completed),
          ),
      ))
  )
    return false;

  const hypertrophy = value.hypertrophy;
  if (
    hypertrophy !== undefined &&
    (!isRecord(hypertrophy) ||
      !isOneOf(hypertrophy.splitPreference, [
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
      ] as const) ||
      !isOneOf(hypertrophy.splitPreferenceStrength, [
        "engine_decide",
        "slight",
        "strong",
      ] as const) ||
      !isOneOf(hypertrophy.balance, ["balanced", "prioritized"] as const) ||
      !Array.isArray(hypertrophy.musclePriorities) ||
      hypertrophy.musclePriorities.length > 3 ||
      !hypertrophy.musclePriorities.every(
        (priority) =>
          isRecord(priority) &&
          isOneOf(priority.muscle, MUSCLES) &&
          isOneOf(priority.rank, [1, 2, 3] as const),
      ) ||
      !isBoolean(hypertrophy.preserveCompetitionLifts) ||
      !isOneOf(hypertrophy.exerciseSelection, [
        "engine_decide",
        "offer_choices",
        "user_selects",
      ] as const) ||
      !(
        hypertrophy.useSupersets === undefined ||
        isBoolean(hypertrophy.useSupersets)
      ))
  )
    return false;

  if (
    !(
      cardio.varietyPreference === undefined ||
      isOneOf(cardio.varietyPreference, [
        "mostly_primary",
        "regular_variety",
        "broad_mix",
      ] as const)
    ) ||
    !isOptionalFiniteNumber(cardio.knownMaxHeartRate, 25, 250)
  )
    return false;
  if (cardio.goal !== undefined) {
    const goal = cardio.goal;
    if (
      !isRecord(goal) ||
      !isOneOf(goal.type, ["general", "running_event", "vo2max"] as const)
    )
      return false;
    if (
      goal.runningEvent !== undefined &&
      (!isRecord(goal.runningEvent) ||
        !isOneOf(goal.runningEvent.distance, [
          "5k",
          "10k",
          "half_marathon",
          "marathon",
        ] as const) ||
        !isOneOf(goal.runningEvent.outcome, [
          "finish",
          "comfortable_finish",
          "improve_pb",
          "target_time",
        ] as const) ||
        !isOptionalFiniteNumber(
          goal.runningEvent.targetTimeMinutes,
          1,
          2_000,
        ) ||
        !isOptionalFiniteNumber(
          goal.runningEvent.recentBestMinutes,
          1,
          2_000,
        ) ||
        !isOneOf(goal.runningEvent.surface, [
          "road",
          "track",
          "trail",
          "treadmill",
          "mixed",
        ] as const) ||
        !isOneOf(goal.runningEvent.routeProfile, [
          "flat",
          "rolling",
          "hilly",
          "unknown",
        ] as const))
    )
      return false;
    if (
      goal.vo2max !== undefined &&
      (!isRecord(goal.vo2max) ||
        !isOneOf(goal.vo2max.modality, [
          "walking",
          "running",
          "cycling",
          "rowing",
          "elliptical",
          "swimming",
          "rucking",
          "sport",
        ] as const))
    )
      return false;
  }
  if (cardio.runningBaseline !== undefined) {
    const baseline = cardio.runningBaseline;
    if (
      !isRecord(baseline) ||
      !isInteger(baseline.runsPerWeek, 0, 14) ||
      !isOneOf(baseline.distanceUnit, ["mi", "km"] as const) ||
      !isOptionalFiniteNumber(baseline.weeklyDistance, 0, 1_000) ||
      !isOptionalFiniteNumber(baseline.weeklyMinutes, 0, 10_080) ||
      !isOptionalFiniteNumber(baseline.longestRunDistance, 0, 1_000) ||
      !isOptionalFiniteNumber(baseline.longestRunMinutes, 0, 1_440) ||
      !isOptionalFiniteNumber(baseline.continuousRunMinutes, 0, 1_440)
    )
      return false;
  }
  return isAdvancedInput(value);
}

function isExercise(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.category === "string" &&
    Array.isArray(value.muscles) &&
    value.muscles.every((muscle) => typeof muscle === "string") &&
    typeof value.sets === "number" &&
    isRepRange(value.reps) &&
    isEffort(value.effort) &&
    typeof value.restSeconds === "number" &&
    Array.isArray(value.substitutions) &&
    value.substitutions.every(
      (substitution) => typeof substitution === "string",
    )
  );
}

function isCardioPrescription(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.method === "string" &&
    typeof value.modality === "string" &&
    typeof value.durationMinutes === "number" &&
    isRepRange(value.intensityRpe) &&
    typeof value.structure === "string" &&
    typeof value.notes === "string"
  );
}

function isV2Session(value: unknown): boolean {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    typeof value.targetMinutes !== "number"
  )
    return false;
  if (value.kind === "lifting")
    return Array.isArray(value.exercises) && value.exercises.every(isExercise);
  if (value.kind === "cardio") return isCardioPrescription(value.prescription);
  return false;
}

function isV2Week(value: unknown): boolean {
  return (
    isRecord(value) &&
    Number.isInteger(value.weekNumber) &&
    (value.phase === "accumulation" ||
      value.phase === "intensification" ||
      value.phase === "recovery") &&
    Array.isArray(value.sessions) &&
    value.sessions.every(isV2Session)
  );
}

function isV3Exercise(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id, 200) &&
    isNonEmptyString(value.exerciseId, 200) &&
    isNonEmptyString(value.performanceSeriesId, 300) &&
    isOptionalString(value.contextRole, 300) &&
    (value.phase === undefined || isOneOf(value.phase, PHASES)) &&
    isNonEmptyString(value.name, 300) &&
    isOneOf(value.purpose, [
      "competition_skill",
      "strength",
      "hypertrophy",
      "low_fatigue_volume",
      "general_function",
      "trunk",
    ] as const) &&
    isInteger(value.sets, 1, 100) &&
    isRepRange(value.reps) &&
    isFiniteNumber((value.reps as UnknownRecord).min, 0, 100) &&
    isFiniteNumber((value.reps as UnknownRecord).max, 0, 100) &&
    isRepRange(value.targetRir) &&
    isFiniteNumber((value.targetRir as UnknownRecord).min, 0, 12) &&
    isFiniteNumber((value.targetRir as UnknownRecord).max, 0, 12) &&
    isOptionalFiniteNumber(value.percentE1rm, 0, 1.5) &&
    isOptionalFiniteNumber(value.load, 0, 5_000) &&
    isFiniteNumber(value.restSeconds, 0, 3_600) &&
    isFiniteNumber(value.priority, 0, 100) &&
    isBoolean(value.optional) &&
    isOptionalString(value.skipRule, 5_000) &&
    isOptionalFiniteNumber(value.amrapStopRir, 0, 12) &&
    isRecord(value.progression) &&
    ["percentage_wave", "double_progression", "calibration"].includes(
      String(value.progression.method),
    ) &&
    isNonEmptyString(value.progression.instruction, 10_000) &&
    (value.progression.repFloor === undefined ||
      isInteger(value.progression.repFloor, 1, 100)) &&
    (value.progression.repCeiling === undefined ||
      isInteger(
        value.progression.repCeiling,
        Number(value.progression.repFloor ?? 1),
        100,
      )) &&
    (value.progression.requiredSuccessfulExposures === undefined ||
      isInteger(value.progression.requiredSuccessfulExposures, 1, 100)) &&
    Array.isArray(value.alternativeChoices) &&
    value.alternativeChoices.length <= 100 &&
    value.alternativeChoices.every(
      (choice) =>
        isRecord(choice) &&
        isNonEmptyString(choice.exerciseId, 200) &&
        isNonEmptyString(choice.name, 300) &&
        isFiniteNumber(choice.score, -100_000, 100_000) &&
        isString(choice.tradeoff, 5_000),
    ) &&
    isString(value.explanation, 10_000) &&
    isStringArray(value.ruleIds, 100, 100)
  );
}

function isV3Cardio(value: unknown): boolean {
  return (
    isRecord(value) &&
    isCardioDetails(value) &&
    isOneOf(value.modality, [
      "walking",
      "running",
      "cycling",
      "rowing",
      "elliptical",
      "swimming",
      "rucking",
      "sport",
    ] as const) &&
    (value.intensity === "easy" ||
      value.intensity === "moderate" ||
      value.intensity === "hard") &&
    isFiniteNumber(value.minutes, 0, 1_440) &&
    isString(value.talkTest, 5_000) &&
    isRepRange(value.sessionRpe) &&
    isFiniteNumber((value.sessionRpe as UnknownRecord).min, 1, 10) &&
    isFiniteNumber((value.sessionRpe as UnknownRecord).max, 1, 10) &&
    isString(value.placement, 5_000) &&
    isStringArray(value.ruleIds, 100, 100)
  );
}

function isV3SetBlock(value: unknown): boolean {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !["straight", "paired_superset"].includes(String(value.type)) ||
    !Array.isArray(value.sequence) ||
    !value.sequence.every(
      (item) =>
        isRecord(item) &&
        typeof item.prescriptionId === "string" &&
        typeof item.orderLabel === "string",
    ) ||
    !Number.isInteger(value.rounds) ||
    Number(value.rounds) < 1 ||
    !isFiniteNumber(value.transitionSeconds, 0, 3_600) ||
    !isFiniteNumber(value.interRoundRestSeconds, 0, 3_600) ||
    !isFiniteNumber(value.sameExerciseRecoveryMinimumSeconds, 0, 3_600) ||
    value.fallback !== "unpair" ||
    typeof value.methodPolicyVersion !== "string" ||
    ![
      "straight_default",
      "antagonist_accessory",
      "noncompeting_accessory",
    ].includes(String(value.rationaleCode)) ||
    !["supported", "cautious"].includes(String(value.evidenceTag)) ||
    !isFiniteNumber(value.estimatedTimeSavedMinutes, 0, 1_440) ||
    !isString(value.instruction, 10_000) ||
    !isOptionalString(value.stopRule, 5_000)
  )
    return false;
  if (value.type === "straight") return value.sequence.length === 1;
  return (
    value.sequence.length === 2 &&
    value.sequence[0]?.orderLabel === "A1" &&
    value.sequence[1]?.orderLabel === "A2"
  );
}

function setBlocksMatchExercises(value: UnknownRecord): boolean {
  if (value.setBlocks === undefined) return true;
  if (!Array.isArray(value.setBlocks) || !value.setBlocks.every(isV3SetBlock))
    return false;
  const exercises = value.exercises as UnknownRecord[];
  const exerciseIds = exercises.map((exercise) => String(exercise.id));
  const blockIds = value.setBlocks.flatMap((block) =>
    (block as UnknownRecord).sequence instanceof Array
      ? ((block as UnknownRecord).sequence as UnknownRecord[]).map((item) =>
          String(item.prescriptionId),
        )
      : [],
  );
  return (
    blockIds.length === exerciseIds.length &&
    new Set(blockIds).size === blockIds.length &&
    blockIds.every((id) => exerciseIds.includes(id))
  );
}

function isV3Session(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !(
      isNonEmptyString(value.id, 300) &&
      isInteger(value.weekNumber, 1, 53) &&
      isInteger(value.sequence, 1, 100) &&
      ["lifting", "cardio", "combined", "movement"].includes(
        String(value.kind),
      ) &&
      isNonEmptyString(value.title, 500) &&
      isString(value.objective, 10_000) &&
      (value.day === undefined || isOneOf(value.day, DAYS)) &&
      isOptionalDate(value.occurrenceDate) &&
      Array.isArray(value.exercises) &&
      value.exercises.length <= 50 &&
      value.exercises.every(isV3Exercise) &&
      (value.cardio === undefined || isV3Cardio(value.cardio)) &&
      (value.movementTarget === undefined ||
        (isRecord(value.movementTarget) &&
          isOptionalFiniteNumber(value.movementTarget.steps, 0, 250_000) &&
          isOptionalFiniteNumber(
            value.movementTarget.walkingMinutes,
            0,
            1_440,
          ) &&
          isString(value.movementTarget.explanation, 5_000))) &&
      isFiniteNumber(value.predictedMinutes, 0, 1_440) &&
      isFiniteNumber(value.targetMinutes, 0, 1_440) &&
      ["fits", "guideline_exceeded", "infeasible"].includes(
        String(value.durationStatus),
      ) &&
      isString(value.explanation, 10_000)
    )
  )
    return false;
  if (value.durationAlternative !== undefined) {
    const alternative = value.durationAlternative;
    if (
      !isRecord(alternative) ||
      !isFiniteNumber(alternative.targetMinutes, 1, 1_440) ||
      !isFiniteNumber(alternative.predictedMinutes, 0, 1_440) ||
      !isStringArray(alternative.exerciseIds, 50, 300) ||
      !isString(alternative.explanation, 10_000) ||
      !Array.isArray(alternative.prescriptions) ||
      alternative.prescriptions.length > 50 ||
      !alternative.prescriptions.every(
        (item) =>
          isRecord(item) &&
          isNonEmptyString(item.prescriptionId, 300) &&
          isInteger(item.sets, 1, 100) &&
          (value.exercises as UnknownRecord[]).some(
            (exercise) =>
              exercise.id === item.prescriptionId &&
              Number(exercise.sets) >= Number(item.sets),
          ),
      )
    )
      return false;
    const choices = alternative.prescriptions as UnknownRecord[];
    const ids = choices.map((item) => item.prescriptionId);
    if (
      new Set(ids).size !== ids.length ||
      alternative.exerciseIds.length !== ids.length ||
      !(alternative.exerciseIds as string[]).every(
        (id, index) => id === ids[index],
      ) ||
      (value.exercises as UnknownRecord[]).some(
        (exercise) =>
          !exercise.optional &&
          !choices.some(
            (item) =>
              item.prescriptionId === exercise.id &&
              item.sets === exercise.sets,
          ),
      )
    )
      return false;
  }
  return setBlocksMatchExercises(value);
}

function isV3Week(value: unknown): boolean {
  return (
    isRecord(value) &&
    isInteger(value.weekNumber, 1, 53) &&
    isOneOf(value.phase, [
      "reentry",
      "base",
      "hypertrophy",
      "work_capacity",
      "strength",
      "specificity",
      "peak",
      "taper",
      "aerobic_base",
      "cardio_build",
      "review",
    ] as const) &&
    Array.isArray(value.sessions) &&
    value.sessions.length <= 50 &&
    value.sessions.every(isV3Session) &&
    value.sessions.every(
      (session) => isRecord(session) && session.weekNumber === value.weekNumber,
    ) &&
    isFiniteNumber(value.hardSetBudget, 0, 10_000) &&
    (value.doseLedger === undefined ||
      (Array.isArray(value.doseLedger) &&
        value.doseLedger.length <= MUSCLES.length &&
        value.doseLedger.every(
          (entry) =>
            isRecord(entry) &&
            isOneOf(entry.muscle, MUSCLES) &&
            [
              entry.directSets,
              entry.indirectSets,
              entry.effectiveSets,
              entry.targetMin,
              entry.targetMax,
            ].every((number) => isFiniteNumber(number, 0, 10_000)) &&
            Number(entry.targetMin) <= Number(entry.targetMax) &&
            isOneOf(entry.status, [
              "within_target",
              "below_target",
              "above_target",
            ] as const),
        ))) &&
    isString(value.explanation, 10_000)
  );
}

function isQuestionEffect(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonEmptyString(value.path, 500) &&
    isString(value.answer, 10_000) &&
    isNonEmptyString(value.effect, 10_000) &&
    isString(value.support, 10_000) &&
    isStringArray(value.ruleIds, 100, 100) &&
    isBoolean(value.used) &&
    (value.classification === undefined ||
      isOneOf(value.classification, [
        "behavioral",
        "validation_only",
        "metadata",
        "deferred",
      ] as const))
  );
}

function isWarning(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonEmptyString(value.code, 300) &&
    isOneOf(value.severity, ["info", "warning", "blocking"] as const) &&
    isNonEmptyString(value.message, 10_000) &&
    isStringArray(value.ruleIds, 100, 100)
  );
}

function isV3Program(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id, 300) &&
    isInteger(value.version, 1, 1_000_000) &&
    isNonEmptyString(value.engineVersion, 100) &&
    isNonEmptyString(value.policyVersion, 200) &&
    isOptionalString(value.originEngineVersion, 100) &&
    isOptionalString(value.originPolicyVersion, 200) &&
    (value.integrityVersion === undefined || value.integrityVersion === 1) &&
    isOptionalDate(value.effectiveScheduleStartDate) &&
    (value.adaptationEvidenceConsumedThrough === undefined ||
      (isRecord(value.adaptationEvidenceConsumedThrough) &&
        Object.entries(value.adaptationEvidenceConsumedThrough).every(
          ([key, week]) => key.length <= 2_000 && isInteger(week, 1, 53),
        ))) &&
    /^\d{4}-\d{2}-\d{2}$/.test(String(value.generatedForDate)) &&
    isNonEmptyString(value.inputFingerprint, 500) &&
    ["ready", "needs_input", "infeasible"].includes(String(value.status)) &&
    isString(value.goalContract, 10_000) &&
    isInteger(value.horizonWeeks, 1, 53) &&
    isBoolean(value.rolling) &&
    isRecord(value.loadSettings) &&
    isOneOf(value.loadSettings.units, ["lb", "kg"] as const) &&
    isFiniteNumber(value.loadSettings.barbellIncrement, 0.01, 100) &&
    isFiniteNumber(value.loadSettings.dumbbellIncrement, 0.01, 100) &&
    isRecord(value.adaptationSettings) &&
    isOneOf(value.adaptationSettings.applyChanges, [
      "automatic",
      "ask_first",
    ] as const) &&
    isOneOf(value.adaptationSettings.missedWorkoutPolicy, [
      "preserve_weekdays_drop_low_priority",
      "reflow_week",
    ] as const) &&
    isOneOf(value.adaptationSettings.amrapPolicy, [
      "none",
      "controlled",
      "max_effort",
    ] as const) &&
    isOneOf(value.adaptationSettings.durationPolicy, [
      "allow_exceed",
      "trim_low_priority",
      "offer_shorter",
    ] as const) &&
    isOneOf(value.adaptationSettings.substitutionPolicy, [
      "recommend_then_ask",
      "automatic",
      "manual_only",
    ] as const) &&
    isRecord(value.loggingPlan) &&
    isStringArray(value.loggingPlan.setFields, 100, 500) &&
    isString(value.loggingPlan.effortPrompt, 5_000) &&
    isStringArray(value.loggingPlan.sessionFields, 100, 500) &&
    isStringArray(value.loggingPlan.cardioFields, 100, 500) &&
    (value.loggingPlan.movementFields === undefined ||
      isStringArray(value.loggingPlan.movementFields, 100, 500)) &&
    isStringArray(value.loggingPlan.weeklyReviewFields, 100, 500) &&
    isOneOf(value.loggingPlan.bodyweightCheckIn, [
      "disabled",
      "optional_weekly",
    ] as const) &&
    (value.selectedSplit === undefined || isString(value.selectedSplit, 200)) &&
    Array.isArray(value.baselines) &&
    value.baselines.length <= 3 &&
    value.baselines.every(
      (baseline) =>
        isRecord(baseline) &&
        isOneOf(baseline.lift, ["squat", "bench", "deadlift"] as const) &&
        isOptionalFiniteNumber(baseline.e1rm, 0, 10_000) &&
        isOneOf(baseline.confidence, ["low", "moderate", "high"] as const) &&
        isOneOf(baseline.source, [
          "observations",
          "calibration_required",
        ] as const) &&
        isInteger(baseline.observationCount, 0, 10_000),
    ) &&
    Array.isArray(value.weeks) &&
    value.weeks.length >= 1 &&
    value.weeks.length <= 53 &&
    value.weeks.every(isV3Week) &&
    Array.isArray(value.questionEffects) &&
    value.questionEffects.length <= 2_000 &&
    value.questionEffects.every(isQuestionEffect) &&
    Array.isArray(value.warnings) &&
    value.warnings.length <= 2_000 &&
    value.warnings.every(isWarning) &&
    isStringArray(value.unresolvedChoices, 2_000, 5_000) &&
    isStringArray(value.triggeredRuleIds, 2_000, 100) &&
    isStringArray(value.reviewFingerprints, 1_000, 500) &&
    isString(value.explanation, 20_000)
  );
}

export function parseProgramDraft(value: unknown): ProgramDraft {
  if (!isRecord(value))
    throw new ProgramPayloadError("The stored program is not a JSON object.");
  if (!hasCommonFields(value))
    throw new ProgramPayloadError(
      "The stored program is missing or has invalid common fields.",
    );
  if (
    value.schemaVersion === 1 &&
    Array.isArray(value.weeks) &&
    value.weeks.every(isV1Week)
  )
    return structuredClone(value) as unknown as ProgramDraft;
  if (
    value.schemaVersion === 2 &&
    Array.isArray(value.weeks) &&
    value.weeks.every(isV2Week)
  )
    return structuredClone(value) as unknown as ProgramDraft;
  if (
    value.schemaVersion === 3 &&
    (value.questionnaireVersion === 2 || value.questionnaireVersion === 3) &&
    typeof value.policyVersion === "string" &&
    (value.questionnaireFormValues === undefined ||
      isQuestionnaireFormValues(value.questionnaireFormValues)) &&
    isQuestionnaireInput(value.inputSnapshot) &&
    isV3Program(value.program)
  ) {
    const draft = value as unknown as ProgramDraftV3;
    if (
      draft.program.integrityVersion === 1 &&
      (draft.engineVersion !== draft.program.engineVersion ||
        draft.policyVersion !== draft.program.policyVersion ||
        draft.program.inputFingerprint !== fingerprint(draft.inputSnapshot) ||
        draft.program.horizonWeeks !== draft.program.weeks.length ||
        (draft.program.status === "ready" &&
          validateGeneratedProgram(draft.program).some(
            (issue) => issue.severity === "blocking",
          )) ||
        draft.program.weeks.some((week) =>
          week.sessions.some(
            (session) =>
              session.occurrenceDate !== undefined &&
              draft.inputSnapshot.goals.event !== undefined &&
              session.occurrenceDate >= draft.inputSnapshot.goals.event.date,
          ),
        ))
    )
      throw new ProgramPayloadError(
        "The stored program has invalid relational integrity data.",
      );
    return structuredClone(draft);
  }
  if (
    value.schemaVersion !== 1 &&
    value.schemaVersion !== 2 &&
    value.schemaVersion !== 3
  )
    throw new ProgramPayloadError(
      `Unsupported program schema version: ${String(value.schemaVersion)}.`,
    );
  throw new ProgramPayloadError(
    "The stored program has invalid week or session data.",
  );
}

function repairLegacyProgramDraft(draft: ProgramDraft): void {
  if (draft.schemaVersion !== 3) return;
  for (const exercise of draft.program.weeks
    .flatMap((week) => week.sessions)
    .flatMap((session) => session.exercises)) {
    if (
      exercise.exerciseId === "competition_squat" &&
      !/\bsquat\b/i.test(exercise.name)
    )
      exercise.name = `${exercise.name} squat`;
  }
}

/**
 * Repairs known presentation-only defects in legacy payloads on a detached
 * clone. Strict parsing above never rewrites data supplied by the caller.
 */
export function normalizeLegacyProgramDraft(value: ProgramDraft): ProgramDraft {
  const draft = structuredClone(value);
  repairLegacyProgramDraft(draft);
  return draft;
}

/** Database read boundary: strict validation followed by explicit legacy repair. */
export function readProgramDraft(value: unknown): ProgramDraft {
  const draft = parseProgramDraft(value);
  repairLegacyProgramDraft(draft);
  return draft;
}
