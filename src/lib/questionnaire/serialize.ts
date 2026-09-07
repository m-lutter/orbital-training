import type {
  CardioInput,
  PerformanceObservation,
  QuestionnaireInput,
} from "$lib/domain";
import type { ProgramDraftV3 } from "$lib/engine";
import { QUESTIONNAIRE_ACTION_ONLY_FIELDS } from "./contracts.js";

export type SerializedQuestionnaireFormValues = Record<
  string,
  string | string[]
>;

function stringValue(value: string | number | undefined): string {
  return value === undefined ? "" : String(value);
}

function yes(value: boolean): string {
  return value ? "yes" : "no";
}

function durationBand(cardio: CardioInput): string {
  const minutes =
    cardio.currentEasySessions > 0
      ? cardio.typicalEasyMinutes
      : cardio.currentModerateSessions > 0
        ? cardio.typicalModerateMinutes
        : cardio.currentHardSessions > 0
          ? cardio.typicalHardMinutes
          : 20;
  if (minutes < 15) return "under_15";
  if (minutes <= 30) return "15_to_30";
  if (minutes <= 45) return "31_to_45";
  if (minutes <= 60) return "46_to_60";
  return "over_60";
}

function cardioFrequencyBand(cardio: CardioInput): string {
  const total =
    cardio.currentEasySessions +
    cardio.currentModerateSessions +
    cardio.currentHardSessions;
  if (total === 0) return "none";
  if (total === 1) return "occasional";
  if (total <= 2) return "one_to_two";
  if (total <= 4) return "three_to_four";
  return "five_plus";
}

function cardioEffortBand(cardio: CardioInput): string {
  if (cardio.currentHardSessions > 0) return "includes_hard";
  if (cardio.currentEasySessions > 0 && cardio.currentModerateSessions > 0)
    return "easy_moderate_mix";
  if (cardio.currentModerateSessions > 0) return "mostly_moderate";
  return "mostly_easy";
}

function hardFrequency(cardio: CardioInput): string {
  if (cardio.currentHardSessions >= 2) return "twice_or_more";
  if (cardio.currentHardSessions === 1) return "once_weekly";
  return "none";
}

function stepBand(steps: number | undefined): string {
  if (steps === undefined) return "unknown";
  if (steps < 3000) return "under_3000";
  if (steps < 5000) return "3000_4999";
  if (steps < 7500) return "5000_7499";
  if (steps < 10000) return "7500_9999";
  return "10000_plus";
}

function addObservation(
  values: SerializedQuestionnaireFormValues,
  lift: "squat" | "bench" | "deadlift",
  observation: PerformanceObservation,
  index: number,
): void {
  const prefix = `${lift}Observation${index}`;
  values[`${prefix}Enabled`] = "yes";
  values[`${prefix}Load`] = String(observation.load);
  values[`${prefix}Reps`] = String(observation.reps);
  values[`${prefix}EffortRating`] =
    observation.rir !== undefined
      ? `rir_${observation.rir}`
      : `rpe_${observation.rpe ?? 8}`;
  values[`${prefix}Date`] = observation.date;
  values[`${prefix}StableTechnique`] = yes(observation.stableTechnique);
}

/**
 * Rebuilds the user-facing questionnaire from the immutable input snapshot.
 * Derived fields (for example cardio ranges) are deliberately conservative;
 * advanced exact values are retained whenever the user originally supplied
 * them.
 */
export function questionnaireToFormValues(
  name: string,
  input: QuestionnaireInput,
): SerializedQuestionnaireFormValues {
  const values: SerializedQuestionnaireFormValues = {
    name,
    age: String(input.age),
    units: input.units,
    clientDate: input.asOfDate,
    timeZone: input.timeZone,
    primaryGoal: input.goals.primary,
    primaryWeight: String(input.goals.primaryWeight),
    secondaryGoal: input.goals.secondary ?? "none",
    startDate: input.goals.startDate,
    hasEvent: yes(input.goals.event !== undefined),
    horizonKind: input.goals.horizon.kind,
    horizonWeeks:
      input.goals.horizon.kind === "fixed"
        ? String(input.goals.horizon.weeks)
        : "4",
    initialBodyWeight: stringValue(input.weight.initialBodyWeight),
    bodyweightTracking: input.weight.ignoreAfterInitial ? "ignore" : "track",
    dietGoal: input.weight.dietGoal,
    weeklyWeightCheckIns: yes(input.weight.weeklyCheckIns),
    liftingDaysPerWeek: String(input.schedule.liftingDaysPerWeek),
    planningStyle: input.schedule.planningStyle,
    preferredTrainingDays: input.schedule.preferredTrainingDays,
    unavailableDays: input.schedule.unavailableDays,
    targetLiftMinutes: String(input.schedule.targetLiftMinutes),
    cardioFocusedDays: input.schedule.cardioFocusedDays,
    resistanceTrainingYears: String(input.history.resistanceTrainingYears),
    recentConsistency: input.history.recentConsistency,
    effortFamiliarity: input.history.effortFamiliarity,
    effortReporting: input.history.effortReporting,
    typicalSleepHours: input.recovery.typicalSleepHours,
    nightsBelowSixPerWeek: String(input.recovery.nightsBelowSixPerWeek),
    workActivity: input.recovery.workActivity,
    rotatingOrNightShifts: yes(input.recovery.rotatingOrNightShifts),
    playsSport: yes(input.recovery.playsSport),
    stepTrackingMethod:
      input.dailyMovement?.trackingMethod ??
      (input.generalFitness?.baselineSteps !== undefined
        ? "other_pedometer"
        : "none"),
    baselineStepBand: stepBand(
      input.dailyMovement?.baselineSteps ?? input.generalFitness?.baselineSteps,
    ),
    baselineSteps: stringValue(
      input.dailyMovement?.baselineSteps ?? input.generalFitness?.baselineSteps,
    ),
    dailyWalkingMinutes: stringValue(
      input.dailyMovement?.baselineWalkingMinutes ??
        input.generalFitness?.dailyWalkingMinutes ??
        15,
    ),
    primaryEquipment: input.facility.primaryEquipment,
    usesAlternateGym: yes(input.facility.alternateEquipment !== undefined),
    alternateEquipment: input.facility.alternateEquipment ?? [],
    cardioPlanType: input.cardio.goal?.type ?? "general",
    cardioPurpose: input.cardio.purpose,
    primaryCardioModality: input.cardio.preferredModalities[0] ?? "walking",
    acceptableCardioModalities: input.cardio.preferredModalities.slice(1),
    cardioVariety: input.cardio.varietyPreference ?? "regular_variety",
    cardioFrequencyBand: cardioFrequencyBand(input.cardio),
    cardioDurationBand: durationBand(input.cardio),
    cardioTypicalEffort: cardioEffortBand(input.cardio),
    hardCardioFrequency: hardFrequency(input.cardio),
    avoidRunning: yes(input.cardio.avoidRunning),
    heartRateDevice: input.cardio.heartRateDevice,
    amrapPolicy: input.adaptation.amrapPolicy,
    disclaimerAccepted: yes(input.safety.disclaimerAccepted),
    hasMovementRestrictions: yes(input.safety.excludedMovements.length > 0),
    excludedMovements: input.safety.excludedMovements,
  };

  const cardioGoal = input.cardio.goal;
  if (cardioGoal?.runningEvent !== undefined) {
    values.runningEventDistance = cardioGoal.runningEvent.distance;
    values.runningGoalOutcome = cardioGoal.runningEvent.outcome;
    values.runningTargetTimeMinutes = stringValue(
      cardioGoal.runningEvent.targetTimeMinutes,
    );
    values.runningRecentBestMinutes = stringValue(
      cardioGoal.runningEvent.recentBestMinutes,
    );
    values.runningSurface = cardioGoal.runningEvent.surface;
    values.runningRouteProfile = cardioGoal.runningEvent.routeProfile;
  }
  if (cardioGoal?.vo2max !== undefined) {
    values.vo2maxModality = cardioGoal.vo2max.modality;
    const benchmark = cardioGoal.vo2max.benchmark;
    values.vo2maxBenchmarkType = benchmark?.type ?? "none";
    values.vo2maxBenchmarkDate = benchmark?.date ?? "";
    values.vo2maxBenchmarkDistance = stringValue(benchmark?.distance);
    values.vo2maxBenchmarkDistanceUnit = benchmark?.distanceUnit ?? "km";
    values.vo2maxBenchmarkMinutes = stringValue(benchmark?.timeMinutes);
    values.vo2maxBenchmarkVo2max = stringValue(benchmark?.wearableVo2max);
  }
  if (input.cardio.runningBaseline !== undefined) {
    const baseline = input.cardio.runningBaseline;
    values.runningSessionsPerWeek = String(baseline.runsPerWeek);
    values.runningDistanceUnit = baseline.distanceUnit;
    values.runningWeeklyDistance = stringValue(baseline.weeklyDistance);
    values.runningWeeklyMinutes = stringValue(baseline.weeklyMinutes);
    values.longestRunDistance = stringValue(baseline.longestRunDistance);
    values.longestRunMinutes = stringValue(baseline.longestRunMinutes);
    values.continuousRunMinutes = stringValue(baseline.continuousRunMinutes);
    values.runningBenchmarkType = baseline.benchmark?.type ?? "none";
    values.runningBenchmarkDate = baseline.benchmark?.date ?? "";
    values.runningBenchmarkDistance = stringValue(baseline.benchmark?.distance);
    values.runningBenchmarkMinutes = stringValue(
      baseline.benchmark?.timeMinutes,
    );
    values.runningBenchmarkVo2max = stringValue(
      baseline.benchmark?.wearableVo2max,
    );
  }

  if (input.goals.event !== undefined) {
    values.eventType = input.goals.event.type;
    values.eventDate = input.goals.event.date;
    values.eventCertainty = input.goals.event.certainty;
  }

  if (input.schedule.advanced !== undefined) {
    values.scheduleAdvancedEnabled = "yes";
    values.minimumTrainingDays = String(
      input.schedule.advanced.minimumTrainingDays,
    );
    values.splitSessionDays = input.schedule.advanced.splitSessionDays;
    values.allowCombinedSessions = yes(
      input.schedule.advanced.allowCombinedSessions !== false,
    );
    values.allowSeparateSameDay = yes(
      input.schedule.advanced.allowSeparateSameDay !== false,
    );
  }

  if (
    input.history.recentSessionsPerWeek !== undefined ||
    input.history.recentHardSetsPerMuscle !== undefined
  ) {
    values.historyAdvancedEnabled = "yes";
    values.recentSessionsPerWeek = stringValue(
      input.history.recentSessionsPerWeek,
    );
    for (const [muscle, sets] of Object.entries(
      input.history.recentHardSetsPerMuscle ?? {},
    ))
      values[`hardSets_${muscle}`] = String(sets);
  }

  if (input.recovery.playsSport) {
    values.sport = input.recovery.sport ?? "other";
    values.sportHoursPerWeek = stringValue(input.recovery.sportHoursPerWeek);
    values.sportLowerBodyDemandSessions = stringValue(
      input.recovery.sportLowerBodyDemandSessions,
    );
  }

  if (input.facility.barbellIncrement || input.facility.dumbbellIncrement) {
    values.facilityAdvancedEnabled = "yes";
    values.barbellIncrement = stringValue(input.facility.barbellIncrement);
    values.dumbbellIncrement = stringValue(input.facility.dumbbellIncrement);
  }

  if (input.generalFitness !== undefined) {
    values.generalFitnessEmphasis = input.generalFitness.emphasis;
    values.preserveCompetitionLiftsHealth = yes(
      input.generalFitness.preserveCompetitionLifts === true,
    );
    values.chairStandConcern = yes(input.generalFitness.chairStandConcern);
    values.balanceConcern = yes(input.generalFitness.balanceConcern);
    values.floorTransferConcern = yes(
      input.generalFitness.floorTransferConcern,
    );
  }

  if (input.powerlifting !== undefined) {
    const powerlifting = input.powerlifting;
    values.powerliftingGoal = powerlifting.goal;
    values.squatStyle = powerlifting.squatStyle;
    values.benchStyle = powerlifting.benchStyle;
    values.deadliftStyle = powerlifting.deadliftStyle;
    values.competitionStyle = powerlifting.competitionStyle;
    for (const lift of ["squat", "bench", "deadlift"] as const) {
      powerlifting.observations[lift]
        ?.slice(0, 2)
        .forEach((observation, index) =>
          addObservation(values, lift, observation, index + 1),
        );
    }
    if (powerlifting.advanced !== undefined) {
      values.powerliftingAdvancedEnabled = "yes";
      values.squatFrequencyPreference = stringValue(
        powerlifting.advanced.squatFrequencyPreference,
      );
      values.benchFrequencyPreference = stringValue(
        powerlifting.advanced.benchFrequencyPreference,
      );
      values.deadliftFrequencyPreference = stringValue(
        powerlifting.advanced.deadliftFrequencyPreference,
      );
      values.trainingMaxPercent = stringValue(
        powerlifting.advanced.trainingMaxPercent,
      );
    }
  }

  if (input.hypertrophy !== undefined) {
    const hypertrophy = input.hypertrophy;
    values.hypertrophySplit = hypertrophy.splitPreference;
    values.splitPreferenceStrength = hypertrophy.splitPreferenceStrength;
    values.hypertrophyBalance = hypertrophy.balance;
    values.exerciseSelection = hypertrophy.exerciseSelection;
    values.useSupersets = yes(hypertrophy.useSupersets === true);
    values.preserveCompetitionLiftsHypertrophy = yes(
      hypertrophy.preserveCompetitionLifts,
    );
    values.specializationBias = hypertrophy.specializationBias ?? "";
    for (const priority of hypertrophy.musclePriorities)
      values[`musclePriority${priority.rank}`] = priority.muscle;
    if (hypertrophy.advanced !== undefined) {
      values.hypertrophyAdvancedEnabled = "yes";
      values.targetFrequencyPerMuscle = stringValue(
        hypertrophy.advanced.targetFrequencyPerMuscle,
      );
    }
  }

  if (input.cardio.advanced !== undefined) {
    values.cardioAdvancedEnabled = "yes";
    values.currentEasySessions = String(input.cardio.currentEasySessions);
    values.currentModerateSessions = String(
      input.cardio.currentModerateSessions,
    );
    values.currentHardSessions = String(input.cardio.currentHardSessions);
    values.typicalEasyMinutes = String(input.cardio.typicalEasyMinutes);
    values.typicalModerateMinutes = String(input.cardio.typicalModerateMinutes);
    values.typicalHardMinutes = String(input.cardio.typicalHardMinutes);
    values.longestRecentSessionMinutes = String(
      input.cardio.longestRecentSessionMinutes,
    );
    values.cardioWeeklyMinutes = stringValue(
      input.cardio.advanced.weeklyMinutes,
    );
    values.restingHeartRate = stringValue(
      input.cardio.advanced.restingHeartRate,
    );
    values.cardioIntensityMethod =
      input.cardio.advanced.intensityMethod ?? "talk_test_rpe";
    values.maxHardSessions = stringValue(input.cardio.advanced.maxHardSessions);
    values.knownMaxHeartRate = stringValue(input.cardio.knownMaxHeartRate);
  }

  if (
    input.adaptation.applyChanges !== "automatic" ||
    input.adaptation.missedWorkoutPolicy !==
      "preserve_weekdays_drop_low_priority" ||
    input.adaptation.durationPolicy !== "allow_exceed"
  ) {
    values.adaptationAdvancedEnabled = "yes";
    values.applyChanges = input.adaptation.applyChanges;
    values.missedWorkoutPolicy = input.adaptation.missedWorkoutPolicy;
    values.adaptationDurationPolicy = input.adaptation.durationPolicy;
  }

  return values;
}

/**
 * Prefers the exact successful form snapshot added by the validation patch.
 * Older schema-v3 programs fall back to the normalized input reconstruction.
 */
export function questionnaireEditFormValues(
  name: string,
  draft: ProgramDraftV3,
): SerializedQuestionnaireFormValues {
  if (draft.questionnaireFormValues === undefined)
    return questionnaireToFormValues(name, draft.inputSnapshot);
  const values = structuredClone(draft.questionnaireFormValues);
  values.name = name;
  return values;
}

/** Removes action-only controls before the exact form snapshot is persisted. */
export function questionnaireFormValuesForStorage(
  values: SerializedQuestionnaireFormValues,
): SerializedQuestionnaireFormValues {
  const stored = structuredClone(values);
  for (const field of QUESTIONNAIRE_ACTION_ONLY_FIELDS) delete stored[field];

  const scalar = (name: string): string => {
    const value = stored[name];
    return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
  };
  const deleteMatching = (pattern: RegExp): void => {
    for (const field of Object.keys(stored)) {
      if (pattern.test(field)) delete stored[field];
    }
  };
  const activeGoals = new Set([
    scalar("primaryGoal"),
    ...(scalar("secondaryGoal") === "none" ? [] : [scalar("secondaryGoal")]),
  ]);

  // This was an older powerlifting question. Powerlifting now answers it
  // implicitly, so never preserve a stale editable value.
  delete stored.preserveCompetitionLifts;

  if (!activeGoals.has("powerlifting")) {
    deleteMatching(
      /^(powerlifting|preserveCompetitionLifts$|competitionStyle$|squatStyle$|benchStyle$|deadliftStyle$|squatObservation|benchObservation|deadliftObservation|squatFrequencyPreference$|benchFrequencyPreference$|deadliftFrequencyPreference$|trainingMaxPercent$)/,
    );
  }
  if (!activeGoals.has("hypertrophy")) {
    deleteMatching(
      /^(hypertrophy|splitPreferenceStrength$|musclePriority[1-3]$|exerciseSelection$|useSupersets$|preserveCompetitionLiftsHypertrophy$|specializationBias$|targetFrequencyPerMuscle$)/,
    );
  }
  if (!activeGoals.has("health")) {
    deleteMatching(
      /^(generalFitnessEmphasis$|preserveCompetitionLiftsHealth$|chairStandConcern$|balanceConcern$|floorTransferConcern$)/,
    );
  }
  if (
    activeGoals.has("powerlifting") ||
    activeGoals.has("hypertrophy") ||
    !activeGoals.has("health")
  )
    delete stored.preserveCompetitionLiftsHealth;
  if (activeGoals.has("powerlifting"))
    delete stored.preserveCompetitionLiftsHypertrophy;

  if (scalar("hasEvent") !== "yes")
    deleteMatching(/^(eventType|eventDate|eventCertainty)$/);
  if (scalar("bodyweightTracking") !== "track")
    deleteMatching(/^(dietGoal|weeklyWeightCheckIns)$/);
  if (scalar("playsSport") !== "yes")
    deleteMatching(/^(sport|sportHoursPerWeek|sportLowerBodyDemandSessions)$/);
  if (scalar("usesAlternateGym") !== "yes") delete stored.alternateEquipment;
  if (scalar("hasMovementRestrictions") !== "yes")
    delete stored.excludedMovements;
  if (scalar("hypertrophyBalance") !== "prioritized")
    deleteMatching(/^(musclePriority[1-3]|specializationBias)$/);
  if (scalar("cardioPlanType") !== "running_event")
    deleteMatching(
      /^(runningEventDistance|runningGoalOutcome|runningTargetTimeMinutes|runningRecentBestMinutes|runningSurface|runningRouteProfile)$/,
    );
  if (scalar("cardioPlanType") !== "vo2max")
    deleteMatching(/^vo2max(Benchmark|Modality)/);
  const runningRelevant =
    scalar("cardioPlanType") === "running_event" ||
    scalar("primaryCardioModality") === "running" ||
    scalar("vo2maxModality") === "running";
  if (!runningRelevant)
    deleteMatching(
      /^(runningSessionsPerWeek|runningDistanceUnit|runningWeeklyDistance|runningWeeklyMinutes|longestRunDistance|longestRunMinutes|continuousRunMinutes|runningBenchmark)/,
    );

  const advancedGroups: readonly (readonly [string, RegExp])[] = [
    [
      "scheduleAdvancedEnabled",
      /^(minimumTrainingDays|splitSessionDays|allowCombinedSessions|allowSeparateSameDay)$/,
    ],
    ["historyAdvancedEnabled", /^(recentSessionsPerWeek|hardSets_)/],
    ["facilityAdvancedEnabled", /^(barbellIncrement|dumbbellIncrement)$/],
    [
      "powerliftingAdvancedEnabled",
      /^(squatFrequencyPreference|benchFrequencyPreference|deadliftFrequencyPreference|trainingMaxPercent)$/,
    ],
    ["hypertrophyAdvancedEnabled", /^targetFrequencyPerMuscle$/],
    [
      "cardioAdvancedEnabled",
      /^(currentEasySessions|currentModerateSessions|currentHardSessions|typicalEasyMinutes|typicalModerateMinutes|typicalHardMinutes|longestRecentSessionMinutes|cardioWeeklyMinutes|restingHeartRate|cardioIntensityMethod|maxHardSessions|knownMaxHeartRate)$/,
    ],
    [
      "adaptationAdvancedEnabled",
      /^(applyChanges|missedWorkoutPolicy|adaptationDurationPolicy)$/,
    ],
  ];
  for (const [toggle, pattern] of advancedGroups) {
    if (scalar(toggle) !== "yes") deleteMatching(pattern);
  }

  return stored;
}
