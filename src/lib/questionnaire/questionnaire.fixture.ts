export type QuestionnaireGoal =
  "powerlifting" | "hypertrophy" | "cardio" | "health";

export type QuestionnaireScenario = {
  label: string;
  primary: QuestionnaireGoal;
  secondary?: QuestionnaireGoal;
  liftingDays: number;
  planningStyle: "calendar_days" | "flexible_sequence";
  advancedSchedule?: boolean;
  supersets?: boolean;
  cardioPlan?: "general" | "running_event" | "vo2max";
};

export function setQuestionnaireValues(
  form: FormData,
  values: Record<string, string>,
): void {
  for (const [name, value] of Object.entries(values)) form.set(name, value);
}

export function appendAllQuestionnaireDays(form: FormData, name: string): void {
  for (const day of [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ])
    form.append(name, day);
}

/**
 * Complete, valid questionnaire fixture used across boundary tests.
 * Keep defaults ordinary and explicit so a production default change does not
 * silently change what a contract test is exercising.
 */
export function questionnaireScenarioForm(
  scenario: QuestionnaireScenario,
): FormData {
  const form = new FormData();
  setQuestionnaireValues(form, {
    name: scenario.label,
    programIcon: "launch_vehicle",
    timeZone: "America/Chicago",
    age: "35",
    units: "lb",
    primaryGoal: scenario.primary,
    secondaryGoal: scenario.secondary ?? "none",
    primaryWeight: scenario.secondary === undefined ? "100" : "80",
    startDate: "2026-08-10",
    horizonKind: "fixed",
    horizonWeeks: "4",
    bodyweightTracking: "ignore",
    planningStyle: scenario.planningStyle,
    liftingDaysPerWeek: String(scenario.liftingDays),
    targetLiftMinutes: scenario.primary === "powerlifting" ? "75" : "60",
    resistanceTrainingYears: "3",
    recentConsistency: "three_plus",
    effortFamiliarity: "basic",
    effortReporting: "auto",
    typicalSleepHours: "7.5",
    nightsBelowSixPerWeek: "1",
    workActivity: "light",
    generalFitnessEmphasis: "balanced",
    dailyWalkingMinutes: "25",
    baselineSteps: "6500",
    powerliftingGoal: "general_powerlifting",
    preserveCompetitionLifts: "yes",
    hypertrophySplit: "auto",
    splitPreferenceStrength: "engine_decide",
    hypertrophyBalance: "balanced",
    exerciseSelection: "engine_decide",
    preserveCompetitionLiftsHypertrophy: "yes",
    cardioPurpose: scenario.primary === "cardio" ? "performance" : "health",
    primaryCardioModality: "walking",
    cardioFrequencyBand: "one_to_two",
    cardioDurationBand: "15_to_30",
    cardioTypicalEffort: "mostly_easy",
    hardCardioFrequency: "none",
    cardioVariety: "regular_variety",
    heartRateDevice: "none",
    amrapPolicy: "none",
    disclaimerAccepted: "yes",
  });

  if (scenario.supersets) form.set("useSupersets", "yes");
  appendAllQuestionnaireDays(form, "preferredTrainingDays");
  form.append("cardioFocusedDays", "wednesday");
  for (const equipment of [
    "bodyweight",
    "barbell",
    "rack",
    "bench",
    "plates",
    "dumbbells",
    "cables",
    "machines",
    "pullup_bar",
    "treadmill",
  ])
    form.append("primaryEquipment", equipment);

  if (scenario.advancedSchedule) {
    form.set("scheduleAdvancedEnabled", "yes");
    form.set(
      "minimumTrainingDays",
      String(Math.max(1, scenario.liftingDays - 1)),
    );
    appendAllQuestionnaireDays(form, "splitSessionDays");
  }

  if (scenario.cardioPlan === "running_event") {
    setQuestionnaireValues(form, {
      hasEvent: "yes",
      eventType: "race",
      eventDate: "2026-10-18",
      eventCertainty: "confirmed",
      cardioPlanType: "running_event",
      cardioPurpose: "performance",
      primaryCardioModality: "running",
      runningEventDistance: "10k",
      runningGoalOutcome: "target_time",
      runningTargetTimeMinutes: "52.5",
      runningSurface: "road",
      runningRouteProfile: "rolling",
      runningSessionsPerWeek: "3",
      runningDistanceUnit: "mi",
      runningWeeklyDistance: "14",
      runningWeeklyMinutes: "140",
      longestRunDistance: "6",
      longestRunMinutes: "62",
      continuousRunMinutes: "75",
      runningBenchmarkType: "none",
    });
  } else if (scenario.cardioPlan === "vo2max") {
    form.append("primaryEquipment", "rower");
    setQuestionnaireValues(form, {
      cardioPlanType: "vo2max",
      cardioPurpose: "performance",
      primaryCardioModality: "rowing",
      vo2maxModality: "rowing",
      vo2maxBenchmarkType: "twelve_minute",
      vo2maxBenchmarkDistance: "2800",
      vo2maxBenchmarkDistanceUnit: "m",
      vo2maxBenchmarkMinutes: "12",
    });
  } else {
    form.set("cardioPlanType", "general");
  }

  return form;
}

export function questionnaireFormFromValues(
  values: Record<string, string | string[]>,
): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(values)) {
    for (const entry of Array.isArray(value) ? value : [value])
      form.append(name, entry);
  }
  return form;
}
