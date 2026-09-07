import type { QuestionnaireInput, ValidationIssue } from "./types.js";
import { daysBetween, isIsoDate } from "./utils.js";
import { programmingSafetyIssues } from "./safety.js";

export function validateQuestionnaire(
  input: QuestionnaireInput,
): ValidationIssue[] {
  const issues: ValidationIssue[] = programmingSafetyIssues(input);
  const blocking = (path: string, message: string, ruleIds: string[]): void => {
    issues.push({ path, severity: "blocking", message, ruleIds });
  };
  const warning = (path: string, message: string, ruleIds: string[]): void => {
    issues.push({ path, severity: "warning", message, ruleIds });
  };

  if (!input.safety.disclaimerAccepted) {
    blocking(
      "safety.disclaimerAccepted",
      "The training disclaimer must be accepted before a program can be created.",
      ["SAFE-2"],
    );
  }
  try {
    if (input.timeZone.length < 1) throw new RangeError("Missing time zone");
    new Intl.DateTimeFormat("en-US", { timeZone: input.timeZone }).format(
      new Date(0),
    );
  } catch {
    blocking(
      "timeZone",
      "A valid IANA time zone is required for local day and week boundaries.",
      ["HORIZON-1", "ADAPT-4"],
    );
  }
  if (!isIsoDate(input.asOfDate) || !isIsoDate(input.goals.startDate)) {
    blocking(
      "goals.startDate",
      "The as-of and start dates must use YYYY-MM-DD.",
      ["HORIZON-1"],
    );
  } else if (daysBetween(input.asOfDate, input.goals.startDate) < 0) {
    blocking(
      "goals.startDate",
      "The program start date cannot be before the current as-of date.",
      ["HORIZON-1"],
    );
  }
  if (input.goals.event !== undefined) {
    if (!isIsoDate(input.goals.event.date)) {
      blocking("goals.event.date", "The event date must use YYYY-MM-DD.", [
        "HORIZON-1",
      ]);
    } else if (daysBetween(input.goals.startDate, input.goals.event.date) < 7) {
      blocking(
        "goals.event.date",
        "The event is less than one week after the start date; there is no safe planning runway.",
        ["HORIZON-1"],
      );
    } else if (
      daysBetween(input.goals.startDate, input.goals.event.date) > 371
    ) {
      blocking(
        "goals.event.date",
        "This engine publishes at most 53 weeks at once. Choose a nearer planning start date for a later event.",
        ["HORIZON-1"],
      );
    }
  }
  if (
    input.goals.horizon.kind === "fixed" &&
    (input.goals.horizon.weeks < 2 || input.goals.horizon.weeks > 16)
  ) {
    blocking(
      "goals.horizon.weeks",
      "A fixed program block must be between 2 and 16 weeks.",
      ["HORIZON-1"],
    );
  }
  if (
    input.schedule.liftingDaysPerWeek < 1 ||
    input.schedule.liftingDaysPerWeek > 6
  ) {
    blocking(
      "schedule.liftingDaysPerWeek",
      "Choose between one and six lifting days per week.",
      ["SPLIT-1"],
    );
  }
  if (
    input.schedule.targetLiftMinutes < 20 ||
    input.schedule.targetLiftMinutes > 180
  ) {
    blocking(
      "schedule.targetLiftMinutes",
      "Lifting-session guidance must be between 20 and 180 minutes.",
      ["TIME-1"],
    );
  }
  if (
    input.schedule.targetCardioMinutes < 5 ||
    input.schedule.targetCardioMinutes > 180
  ) {
    blocking(
      "schedule.targetCardioMinutes",
      "Cardio-session guidance must be between 5 and 180 minutes.",
      ["TIME-1", "CARDIO-2"],
    );
  }
  if (input.schedule.advanced !== undefined) {
    if (
      input.schedule.advanced.minimumTrainingDays < 1 ||
      input.schedule.advanced.minimumTrainingDays >
        input.schedule.liftingDaysPerWeek
    ) {
      blocking(
        "schedule.advanced.minimumTrainingDays",
        "Minimum training days must be at least one and cannot exceed requested lifting days.",
        ["SPLIT-1"],
      );
    }
  }
  for (const field of [
    "preferredTrainingDays",
    "unavailableDays",
    "cardioFocusedDays",
  ] as const) {
    if (new Set(input.schedule[field]).size !== input.schedule[field].length) {
      blocking(`schedule.${field}`, "Select each weekday only once.", [
        "SCHED-1",
      ]);
    }
  }
  const availableDays = [
    ...new Set(input.schedule.preferredTrainingDays),
  ].filter((day) => !input.schedule.unavailableDays.includes(day));
  if (availableDays.length < input.schedule.liftingDaysPerWeek) {
    blocking(
      "schedule.preferredTrainingDays",
      "Fewer available training days were selected than the requested number of weekly lifting sessions.",
      ["SPLIT-1"],
    );
  }
  if (input.goals.primaryWeight < 100 && input.goals.secondary === undefined) {
    blocking(
      "goals.secondary",
      "A secondary goal is required when the primary goal receives less than 100% priority.",
      ["GOAL-1"],
    );
  }
  if (input.goals.secondary === input.goals.primary) {
    blocking(
      "goals.secondary",
      "Primary and secondary goals must be different.",
      ["GOAL-1"],
    );
  }
  if (input.cardio.goal?.type === "running_event") {
    if (input.cardio.goal.runningEvent === undefined) {
      blocking(
        "cardio.goal.runningEvent",
        "Running-event details are required.",
        ["CARDIO-4"],
      );
    }
    if (input.goals.event?.type !== "race") {
      blocking(
        "cardio.goal.runningEvent",
        "A running-event plan requires a scheduled race date.",
        ["HORIZON-1", "CARDIO-4"],
      );
    }
    if (input.cardio.avoidRunning) {
      blocking(
        "cardio.avoidRunning",
        "Running cannot be excluded from a running-event plan.",
        ["SAFE-1", "CARDIO-4"],
      );
    }
    const race = input.cardio.goal.runningEvent;
    if (
      race?.outcome === "target_time" &&
      race.targetTimeMinutes === undefined
    ) {
      blocking(
        "cardio.goal.runningEvent.targetTimeMinutes",
        "A target-time race goal needs a finish time.",
        ["CARDIO-4"],
      );
    }
    if ((input.cardio.runningBaseline?.runsPerWeek ?? 0) === 0) {
      warning(
        "cardio.runningBaseline",
        "No recent running was reported. The first weeks use run/walk sessions and conservative progression.",
        ["CARDIO-2", "CARDIO-4"],
      );
    }
  }
  if (
    input.cardio.goal?.type === "vo2max" &&
    input.cardio.goal.vo2max === undefined
  ) {
    blocking("cardio.goal.vo2max", "Choose a modality for the VO₂max plan.", [
      "CARDIO-5",
    ]);
  }
  if (
    input.cardio.advanced?.restingHeartRate !== undefined &&
    input.cardio.knownMaxHeartRate !== undefined &&
    input.cardio.advanced.restingHeartRate >= input.cardio.knownMaxHeartRate
  ) {
    blocking(
      "cardio.advanced.restingHeartRate",
      "Resting heart rate must be lower than maximum heart rate.",
      ["CARDIO-2"],
    );
  }
  if (
    input.cardio.goal?.type === "vo2max" &&
    input.cardio.goal.vo2max?.modality === "running" &&
    input.cardio.avoidRunning
  ) {
    blocking(
      "cardio.goal.vo2max",
      "Choose a non-running VO₂max modality or allow running.",
      ["SAFE-1", "CARDIO-5"],
    );
  }
  const needsPowerlifting =
    input.goals.primary === "powerlifting" ||
    input.goals.secondary === "powerlifting";
  const needsHypertrophy =
    input.goals.primary === "hypertrophy" ||
    input.goals.secondary === "hypertrophy";
  const needsHealth =
    input.goals.primary === "health" || input.goals.secondary === "health";
  if (needsPowerlifting && input.powerlifting === undefined) {
    blocking(
      "powerlifting",
      "Powerlifting goal details are required for a powerlifting goal.",
      ["DOSE-1"],
    );
  }
  if (
    input.powerlifting !== undefined &&
    ["meet_prep", "peak_or_test"].includes(input.powerlifting.goal) &&
    input.goals.event === undefined
  ) {
    blocking(
      "goals.event",
      "Meet preparation and peaking require a dated meet, mock meet, or test endpoint.",
      ["HORIZON-1"],
    );
  }
  if (
    input.powerlifting !== undefined &&
    input.powerlifting.goal.includes("specialization") &&
    Object.values(input.powerlifting.observations).every(
      (observations) => (observations?.length ?? 0) === 0,
    )
  ) {
    warning(
      "powerlifting.observations",
      "Specialization was selected without recent lift observations; the first block uses calibration before reallocating dose aggressively.",
      ["BASE-1", "BASE-2", "DOSE-2"],
    );
  }
  if (needsHypertrophy && input.hypertrophy === undefined) {
    blocking(
      "hypertrophy",
      "Hypertrophy split and priority details are required for a hypertrophy goal.",
      ["SPLIT-1", "DOSE-2"],
    );
  }
  if (needsHealth && input.generalFitness === undefined) {
    blocking(
      "generalFitness",
      "General-fitness details are required for a health goal.",
      ["HEALTH-1"],
    );
  }
  const equipment = new Set(input.facility.primaryEquipment);
  if (
    needsPowerlifting &&
    !(
      equipment.has("barbell") &&
      equipment.has("plates") &&
      equipment.has("rack") &&
      equipment.has("bench")
    )
  ) {
    warning(
      "facility.primaryEquipment",
      "A full competition-lift setup is unavailable. The engine can maintain muscle and general strength but cannot optimize all three competition lifts.",
      ["EX-2"],
    );
  }
  if (input.weight.weeklyCheckIns && input.weight.ignoreAfterInitial) {
    warning(
      "weight.weeklyCheckIns",
      "Weekly check-ins are ignored because bodyweight tracking is disabled after onboarding.",
      ["WEIGHT-1"],
    );
  }
  if (
    input.cardio.avoidRunning &&
    input.cardio.preferredModalities.length === 1 &&
    input.cardio.preferredModalities[0] === "running"
  ) {
    blocking(
      "cardio.preferredModalities",
      "Running is both the only preferred modality and explicitly excluded; choose another modality.",
      ["SAFE-1", "CARDIO-1"],
    );
  }
  if (
    input.recovery.playsSport &&
    input.recovery.sportHoursPerWeek === undefined
  ) {
    warning(
      "recovery.sportHoursPerWeek",
      "Sport hours are missing, so external training demand is estimated conservatively.",
      ["REC-1"],
    );
  }
  if (input.goals.horizon.kind === "fixed" && input.goals.event !== undefined) {
    const eventWeeks = Math.floor(
      daysBetween(input.goals.startDate, input.goals.event.date) / 7,
    );
    if (Math.abs(eventWeeks - input.goals.horizon.weeks) > 1) {
      warning(
        "goals.horizon",
        "The fixed horizon and event date disagree; the dated event controls phase back-planning.",
        ["HORIZON-1"],
      );
    }
  }
  return issues;
}
