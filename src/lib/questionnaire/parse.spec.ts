import { generateProgram } from "$lib/domain";
import { describe, expect, it } from "vitest";
import { QuestionnaireFormError, parseQuestionnaireForm } from "./parse";

function validHealthForm(): FormData {
  const form = new FormData();
  const values: Record<string, string> = {
    name: "Balanced health plan",
    timeZone: "America/Chicago",
    age: "42",
    units: "lb",
    primaryGoal: "health",
    primaryWeight: "100",
    secondaryGoal: "none",
    startDate: "2026-08-10",
    horizonKind: "fixed",
    horizonWeeks: "8",
    bodyweightTracking: "ignore",
    planningStyle: "flexible_sequence",
    liftingDaysPerWeek: "2",
    targetLiftMinutes: "45",
    resistanceTrainingYears: "1",
    recentConsistency: "one_to_two",
    effortFamiliarity: "basic",
    effortReporting: "auto",
    typicalSleepHours: "7.5",
    nightsBelowSixPerWeek: "1",
    workActivity: "sedentary",
    generalFitnessEmphasis: "balanced",
    dailyWalkingMinutes: "20",
    baselineSteps: "5000",
    cardioPurpose: "health",
    primaryCardioModality: "walking",
    currentEasySessions: "1",
    currentModerateSessions: "0",
    currentHardSessions: "0",
    typicalEasyMinutes: "20",
    longestRecentSessionMinutes: "30",
    heartRateDevice: "none",
    amrapPolicy: "none",
  };
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  form.append("preferredTrainingDays", "monday");
  form.append("preferredTrainingDays", "thursday");
  form.append("cardioFocusedDays", "tuesday");
  form.append("primaryEquipment", "dumbbells");
  form.append("primaryEquipment", "bench");
  form.set("disclaimerAccepted", "yes");
  return form;
}

function replaceSelections(
  form: FormData,
  name: string,
  values: string[],
): void {
  form.delete(name);
  for (const value of values) form.append(name, value);
}

describe("parseQuestionnaireForm", () => {
  it("parses the core questionnaire and applies documented advanced defaults", () => {
    const parsed = parseQuestionnaireForm(validHealthForm(), "2026-08-07");
    expect(parsed.name).toBe("Balanced health plan");
    expect(parsed.input.timeZone).toBe("America/Chicago");
    expect(parsed.input.weight.ignoreAfterInitial).toBe(true);
    expect(parsed.input.weight.weeklyCheckIns).toBe(false);
    expect(parsed.input.adaptation).toEqual({
      applyChanges: "automatic",
      missedWorkoutPolicy: "preserve_weekdays_drop_low_priority",
      amrapPolicy: "none",
      durationPolicy: "allow_exceed",
      substitutionPolicy: "recommend_then_ask",
    });
    expect(parsed.input.schedule.targetCardioMinutes).toBe(20);
    expect(parsed.input.safety.restrictedBodyAreas).toEqual([]);
    expect(generateProgram(parsed.input).program?.status).toBe("ready");
  });

  it("turns selected movement restrictions into exercise eligibility rules", () => {
    const form = validHealthForm();
    form.set("hasMovementRestrictions", "yes");
    form.append("excludedMovements", "vertical_push");
    form.append("excludedMovements", "carry");
    const parsed = parseQuestionnaireForm(form, "2026-08-07");
    expect(parsed.input.safety).toMatchObject({
      allowOperationalRestrictions: true,
      excludedMovements: ["vertical_push", "carry"],
    });
  });

  it("accepts Smith-machine access as first-class equipment", () => {
    const form = validHealthForm();
    form.append("primaryEquipment", "smith_machine");
    const parsed = parseQuestionnaireForm(form, "2026-08-07");
    expect(parsed.input.facility.primaryEquipment).toContain("smith_machine");
  });

  it("records explicit pool access for swimming availability", () => {
    const form = validHealthForm();
    form.append("primaryEquipment", "pool");
    const parsed = parseQuestionnaireForm(form, "2026-08-07");
    expect(parsed.input.facility.primaryEquipment).toContain("pool");
  });

  it("ignores a stale priority split when no secondary goal is selected", () => {
    const form = validHealthForm();
    form.set("primaryWeight", "50");
    expect(
      parseQuestionnaireForm(form, "2026-08-07").input.goals,
    ).toMatchObject({ primaryWeight: 100, primary: "health" });
  });

  it("requires goal priority only when a secondary goal is selected", () => {
    const form = validHealthForm();
    form.set("secondaryGoal", "cardio");
    form.delete("primaryWeight");
    expect(() => parseQuestionnaireForm(form, "2026-08-07")).toThrowError(
      QuestionnaireFormError,
    );
    expect(() => parseQuestionnaireForm(form, "2026-08-07")).toThrow(
      "valid goal priority",
    );
  });

  it("rejects a day marked both preferred and unavailable", () => {
    const form = validHealthForm();
    form.append("unavailableDays", "monday");
    expect(() => parseQuestionnaireForm(form, "2026-08-07")).toThrow(
      "cannot be both preferred and unavailable",
    );
  });

  it("requires a dated endpoint for meet prep or peaking", () => {
    const form = validHealthForm();
    form.set("primaryGoal", "powerlifting");
    form.set("powerliftingGoal", "peak_or_test");
    form.set("preserveCompetitionLifts", "yes");
    expect(() => parseQuestionnaireForm(form, "2026-08-07")).toThrow(
      "require a dated meet",
    );
  });

  it("turns a recent powerlifting set into a load-calibration observation", () => {
    const form = validHealthForm();
    form.set("primaryGoal", "powerlifting");
    form.set("powerliftingGoal", "general_powerlifting");
    form.set("preserveCompetitionLifts", "yes");
    form.set("squatObservation1Enabled", "yes");
    form.set("squatObservation1Load", "405");
    form.set("squatObservation1Reps", "3");
    form.set("squatObservation1EffortRating", "rir_2");
    form.set("squatObservation1Date", "2026-08-01");
    form.set("squatObservation1StableTechnique", "yes");
    form.set("primaryEquipment", "barbell");
    form.append("primaryEquipment", "rack");
    form.append("primaryEquipment", "bench");
    form.append("primaryEquipment", "plates");
    const parsed = parseQuestionnaireForm(form, "2026-08-07");
    const program = generateProgram(parsed.input).program;
    expect(
      program?.baselines.find((item) => item.lift === "squat")?.source,
    ).toBe("observations");
    expect(
      program?.baselines.find((item) => item.lift === "deadlift")?.source,
    ).toBe("calibration_required");
  });

  it("automatically preserves the competition lifts for powerlifting", () => {
    const form = validHealthForm();
    form.set("primaryGoal", "powerlifting");
    form.set("secondaryGoal", "hypertrophy");
    form.set("primaryWeight", "80");
    form.set("powerliftingGoal", "general_powerlifting");
    form.set("hypertrophySplit", "auto");
    form.set("splitPreferenceStrength", "engine_decide");
    form.set("hypertrophyBalance", "balanced");
    form.set("exerciseSelection", "engine_decide");
    form.delete("preserveCompetitionLiftsHypertrophy");
    // A stale value from an older saved form must not disable lift practice.
    form.set("preserveCompetitionLifts", "no");
    for (const equipment of ["barbell", "rack", "plates"])
      form.append("primaryEquipment", equipment);

    const parsed = parseQuestionnaireForm(form, "2026-08-07");
    expect(parsed.input.powerlifting?.preserveCompetitionLifts).toBe(true);
    expect(parsed.input.hypertrophy?.preserveCompetitionLifts).toBe(true);
    const exerciseIds =
      generateProgram(parsed.input).program?.weeks[0]?.sessions.flatMap(
        (session) => session.exercises.map((exercise) => exercise.exerciseId),
      ) ?? [];
    expect(exerciseIds).toEqual(
      expect.arrayContaining([
        "competition_squat",
        "competition_bench",
        "competition_deadlift",
      ]),
    );
  });

  it("adds optional competition-lift practice to general fitness only when selected", () => {
    const form = validHealthForm();
    for (const equipment of ["barbell", "rack", "plates"])
      form.append("primaryEquipment", equipment);
    form.set("preserveCompetitionLiftsHealth", "yes");

    const selected = parseQuestionnaireForm(form, "2026-08-07");
    const selectedIds =
      generateProgram(selected.input).program?.weeks[0]?.sessions.flatMap(
        (session) => session.exercises.map((exercise) => exercise.exerciseId),
      ) ?? [];
    expect(selectedIds).toEqual(
      expect.arrayContaining([
        "competition_squat",
        "competition_bench",
        "competition_deadlift",
      ]),
    );

    form.set("preserveCompetitionLiftsHealth", "no");
    const unselected = parseQuestionnaireForm(form, "2026-08-07");
    const unselectedIds =
      generateProgram(unselected.input).program?.weeks[0]?.sessions.flatMap(
        (session) => session.exercises.map((exercise) => exercise.exerciseId),
      ) ?? [];
    expect(
      unselectedIds.some((exerciseId) => exerciseId.startsWith("competition_")),
    ).toBe(false);
  });

  it("combines the primary cardio modality with distinct acceptable alternatives", () => {
    const form = validHealthForm();
    form.append("acceptableCardioModalities", "cycling");
    form.append("acceptableCardioModalities", "walking");
    const parsed = parseQuestionnaireForm(form, "2026-08-07");
    expect(parsed.input.cardio.preferredModalities).toEqual([
      "walking",
      "cycling",
    ]);
  });

  it("derives cardio-session length from recent cardio instead of asking for a target", () => {
    const form = validHealthForm();
    form.set("primaryGoal", "cardio");
    form.set("typicalEasyMinutes", "40");
    form.set("longestRecentSessionMinutes", "70");
    form.set("targetCardioMinutes", "90");
    const parsed = parseQuestionnaireForm(form, "2026-08-07");
    expect(parsed.input.schedule.targetCardioMinutes).toBe(40);
  });

  it("limits user-selected fixed blocks to sixteen weeks", () => {
    const form = validHealthForm();
    form.set("horizonWeeks", "17");
    expect(() => parseQuestionnaireForm(form, "2026-08-07")).toThrow(
      "from 2 to 16",
    );
  });

  it("parses all three AMRAP permissions", () => {
    const form = validHealthForm();
    form.set("amrapPolicy", "max_effort");
    expect(
      parseQuestionnaireForm(form, "2026-08-07").input.adaptation.amrapPolicy,
    ).toBe("max_effort");
  });

  it("uses the event date as the horizon instead of requiring a second length answer", () => {
    const form = validHealthForm();
    form.set("hasEvent", "yes");
    form.set("eventType", "race");
    form.set("eventDate", "2026-10-05");
    form.set("eventCertainty", "confirmed");
    form.delete("horizonKind");
    form.delete("horizonWeeks");
    const parsed = parseQuestionnaireForm(form, "2026-08-07");
    expect(parsed.input.goals.horizon).toEqual({ kind: "fixed", weeks: 8 });
  });

  it("keeps substitution approval at recommend-then-ask without a user question", () => {
    const form = validHealthForm();
    form.set("adaptationAdvancedEnabled", "yes");
    form.set("applyChanges", "automatic");
    form.set("missedWorkoutPolicy", "preserve_weekdays_drop_low_priority");
    form.set("adaptationDurationPolicy", "allow_exceed");
    const parsed = parseQuestionnaireForm(form, "2026-08-07");
    expect(parsed.input.adaptation.substitutionPolicy).toBe(
      "recommend_then_ask",
    );
  });

  it("parses a dated meet-prep questionnaire without collecting unused federation data", () => {
    const form = validHealthForm();
    form.set("primaryGoal", "powerlifting");
    form.set("liftingDaysPerWeek", "4");
    replaceSelections(form, "preferredTrainingDays", [
      "monday",
      "tuesday",
      "thursday",
      "saturday",
    ]);
    form.set("targetLiftMinutes", "90");
    form.set("hasEvent", "yes");
    form.set("eventType", "powerlifting_meet");
    form.set("eventDate", "2026-11-02");
    form.set("eventCertainty", "confirmed");
    form.set("powerliftingGoal", "meet_prep");
    form.set("preserveCompetitionLifts", "yes");
    form.set("primaryEquipment", "bodyweight");
    for (const equipment of ["barbell", "rack", "bench", "plates"]) {
      form.append("primaryEquipment", equipment);
    }
    form.delete("horizonKind");
    form.delete("horizonWeeks");
    const parsed = parseQuestionnaireForm(form, "2026-08-07");
    expect(parsed.input.powerlifting?.goal).toBe("meet_prep");
    const program = generateProgram(parsed.input).program;
    expect(program?.status).toBe("ready");
    expect(
      program?.baselines.every(
        (baseline) => baseline.source === "calibration_required",
      ),
    ).toBe(true);
  });

  it("parses a five-day prioritized hypertrophy questionnaire", () => {
    const form = validHealthForm();
    form.set("primaryGoal", "hypertrophy");
    form.set("liftingDaysPerWeek", "5");
    replaceSelections(form, "preferredTrainingDays", [
      "monday",
      "tuesday",
      "wednesday",
      "friday",
      "saturday",
    ]);
    form.set("targetLiftMinutes", "75");
    form.set("hypertrophySplit", "ppl_upper_lower");
    form.set("splitPreferenceStrength", "slight");
    form.set("hypertrophyBalance", "prioritized");
    form.set("musclePriority1", "biceps");
    form.set("musclePriority2", "chest");
    form.set("specializationBias", "arms");
    form.set("exerciseSelection", "offer_choices");
    form.set("useSupersets", "yes");
    form.set("preserveCompetitionLiftsHypertrophy", "no");
    form.set("primaryEquipment", "bodyweight");
    form.append("primaryEquipment", "dumbbells");
    form.append("primaryEquipment", "bench");
    form.append("primaryEquipment", "machines");
    const parsed = parseQuestionnaireForm(form, "2026-08-07");
    expect(parsed.input.hypertrophy?.splitPreference).toBe("ppl_upper_lower");
    expect(parsed.input.hypertrophy?.musclePriorities).toEqual([
      { muscle: "biceps", rank: 1 },
      { muscle: "chest", rank: 2 },
    ]);
    expect(parsed.input.hypertrophy?.useSupersets).toBe(true);
    expect(generateProgram(parsed.input).program?.selectedSplit).toBe(
      "ppl_upper_lower",
    );
  });

  it("parses a sport-support cardio questionnaire with a common sport", () => {
    const form = validHealthForm();
    form.set("primaryGoal", "cardio");
    form.set("playsSport", "yes");
    form.set("sport", "basketball");
    form.set("sportHoursPerWeek", "4");
    form.set("sportLowerBodyDemandSessions", "2");
    form.set("cardioPurpose", "sport_support");
    form.set("primaryCardioModality", "cycling");
    form.append("primaryEquipment", "cardio_bike");
    const parsed = parseQuestionnaireForm(form, "2026-08-07");
    expect(parsed.input.recovery.sport).toBe("basketball");
    expect(parsed.input.cardio.purpose).toBe("sport_support");
    expect(generateProgram(parsed.input).program?.status).toBe("ready");
  });

  it("turns beginner-friendly cardio ranges into conservative numeric inputs", () => {
    const form = validHealthForm();
    for (const field of [
      "currentEasySessions",
      "currentModerateSessions",
      "currentHardSessions",
      "typicalEasyMinutes",
      "longestRecentSessionMinutes",
    ])
      form.delete(field);
    form.set("cardioFrequencyBand", "three_to_four");
    form.set("cardioDurationBand", "31_to_45");
    form.set("cardioTypicalEffort", "easy_moderate_mix");
    form.set("hardCardioFrequency", "none");
    form.set("cardioVariety", "broad_mix");

    const cardio = parseQuestionnaireForm(form, "2026-08-07").input.cardio;
    expect(cardio.currentEasySessions).toBe(2);
    expect(cardio.currentModerateSessions).toBe(1);
    expect(cardio.currentHardSessions).toBe(0);
    expect(cardio.typicalEasyMinutes).toBe(35);
    expect(cardio.longestRecentSessionMinutes).toBe(45);
    expect(cardio.varietyPreference).toBe("broad_mix");
  });

  it("keeps exact cardio counts behind advanced settings", () => {
    const form = validHealthForm();
    form.set("cardioFrequencyBand", "five_plus");
    form.set("cardioDurationBand", "46_to_60");
    form.set("cardioTypicalEffort", "includes_hard");
    form.set("hardCardioFrequency", "twice_or_more");
    form.set("cardioAdvancedEnabled", "yes");
    form.set("currentEasySessions", "3");
    form.set("currentModerateSessions", "1");
    form.set("currentHardSessions", "1");
    form.set("typicalEasyMinutes", "28");
    form.set("typicalModerateMinutes", "22");
    form.set("typicalHardMinutes", "16");
    form.set("longestRecentSessionMinutes", "42");

    const cardio = parseQuestionnaireForm(form, "2026-08-07").input.cardio;
    expect(cardio.currentEasySessions).toBe(3);
    expect(cardio.currentModerateSessions).toBe(1);
    expect(cardio.currentHardSessions).toBe(1);
    expect(cardio.typicalEasyMinutes).toBe(28);
    expect(cardio.longestRecentSessionMinutes).toBe(42);
  });

  it("uses the simple cardio ranges when advanced numeric boxes are left blank", () => {
    const form = validHealthForm();
    form.set("cardioFrequencyBand", "three_to_four");
    form.set("cardioDurationBand", "31_to_45");
    form.set("cardioTypicalEffort", "easy_moderate_mix");
    form.set("hardCardioFrequency", "none");
    form.set("cardioAdvancedEnabled", "yes");
    for (const field of [
      "currentEasySessions",
      "currentModerateSessions",
      "currentHardSessions",
      "typicalEasyMinutes",
      "typicalModerateMinutes",
      "typicalHardMinutes",
      "longestRecentSessionMinutes",
    ])
      form.set(field, "");

    const cardio = parseQuestionnaireForm(form, "2026-08-07").input.cardio;
    expect(cardio.currentEasySessions).toBe(2);
    expect(cardio.currentModerateSessions).toBe(1);
    expect(cardio.currentHardSessions).toBe(0);
    expect(cardio.typicalEasyMinutes).toBe(35);
    expect(cardio.typicalModerateMinutes).toBe(35);
    expect(cardio.longestRecentSessionMinutes).toBe(45);
  });

  it("allows lifting and cardio together on each selected day", () => {
    const form = validHealthForm();
    form.set("scheduleAdvancedEnabled", "yes");
    form.set("minimumTrainingDays", "1");
    form.append("splitSessionDays", "monday");
    form.append("splitSessionDays", "thursday");
    const schedule = parseQuestionnaireForm(form, "2026-08-07").input.schedule;
    expect(schedule.advanced?.allowCombinedSessions).toBe(true);
    expect(schedule.advanced?.allowSeparateSameDay).toBe(true);
    expect(schedule.advanced?.splitSessionDays).toEqual(["monday", "thursday"]);
  });

  it("keeps lifting and cardio separate when no same-day days are selected", () => {
    const form = validHealthForm();
    form.set("scheduleAdvancedEnabled", "yes");
    form.set("minimumTrainingDays", "1");
    const schedule = parseQuestionnaireForm(form, "2026-08-07").input.schedule;
    expect(schedule.advanced?.allowCombinedSessions).toBe(false);
    expect(schedule.advanced?.allowSeparateSameDay).toBe(false);
    expect(schedule.advanced?.splitSessionDays).toEqual([]);
  });

  it("turns a beginner-friendly step range into a conservative baseline", () => {
    const form = validHealthForm();
    form.delete("baselineSteps");
    form.delete("dailyWalkingMinutes");
    form.set("stepTrackingMethod", "phone");
    form.set("baselineStepBand", "5000_7499");
    const movement = parseQuestionnaireForm(form, "2026-08-07").input
      .dailyMovement;
    expect(movement).toEqual({
      trackingMethod: "phone",
      baselineSteps: 6250,
    });
  });

  it("uses walking time when the user cannot count steps", () => {
    const form = validHealthForm();
    form.delete("baselineSteps");
    form.set("stepTrackingMethod", "none");
    form.set("dailyWalkingMinutes", "18");
    const movement = parseQuestionnaireForm(form, "2026-08-07").input
      .dailyMovement;
    expect(movement).toEqual({
      trackingMethod: "none",
      baselineWalkingMinutes: 18,
    });
  });

  it("requires an explicit RPE/RIR familiarity choice", () => {
    const form = validHealthForm();
    form.delete("effortFamiliarity");
    expect(() => parseQuestionnaireForm(form, "2026-08-07")).toThrow(
      "Select a valid effort-rating familiarity",
    );
  });

  it("parses a dated running-event goal and its recent running baseline", () => {
    const form = validHealthForm();
    form.set("primaryGoal", "cardio");
    form.set("hasEvent", "yes");
    form.set("eventType", "race");
    form.set("eventDate", "2026-10-18");
    form.set("eventCertainty", "confirmed");
    form.set("cardioPlanType", "running_event");
    form.set("cardioPurpose", "performance");
    form.set("primaryCardioModality", "running");
    form.set("runningEventDistance", "10k");
    form.set("runningGoalOutcome", "target_time");
    form.set("runningTargetTimeMinutes", "52.5");
    form.set("runningRecentBestMinutes", "55");
    form.set("runningSurface", "road");
    form.set("runningRouteProfile", "rolling");
    form.set("runningSessionsPerWeek", "3");
    form.set("runningDistanceUnit", "mi");
    form.set("runningWeeklyDistance", "14");
    form.set("runningWeeklyMinutes", "140");
    form.set("longestRunDistance", "6");
    form.set("longestRunMinutes", "62");
    form.set("continuousRunMinutes", "75");

    const cardio = parseQuestionnaireForm(form, "2026-08-07").input.cardio;
    expect(cardio.goal).toMatchObject({
      type: "running_event",
      runningEvent: {
        distance: "10k",
        outcome: "target_time",
        targetTimeMinutes: 52.5,
        surface: "road",
        routeProfile: "rolling",
      },
    });
    expect(cardio.runningBaseline).toMatchObject({
      runsPerWeek: 3,
      weeklyDistance: 14,
      weeklyMinutes: 140,
      longestRunMinutes: 62,
    });
  });

  it("parses a VO2max focus without requiring a benchmark", () => {
    const form = validHealthForm();
    form.set("primaryGoal", "cardio");
    form.set("cardioPlanType", "vo2max");
    form.set("cardioPurpose", "performance");
    form.set("primaryCardioModality", "cycling");
    form.set("vo2maxModality", "cycling");
    form.set("vo2maxBenchmarkType", "none");
    expect(
      parseQuestionnaireForm(form, "2026-08-07").input.cardio.goal,
    ).toEqual({
      type: "vo2max",
      vo2max: { modality: "cycling", benchmark: undefined },
    });
  });

  it("keeps the unit attached to a VO2max distance benchmark", () => {
    const form = validHealthForm();
    form.set("primaryGoal", "cardio");
    form.set("cardioPlanType", "vo2max");
    form.set("cardioPurpose", "performance");
    form.set("primaryCardioModality", "rowing");
    form.set("vo2maxModality", "rowing");
    form.set("vo2maxBenchmarkType", "twelve_minute");
    form.set("vo2maxBenchmarkDistance", "2800");
    form.set("vo2maxBenchmarkDistanceUnit", "m");
    form.set("vo2maxBenchmarkMinutes", "12");

    expect(
      parseQuestionnaireForm(form, "2026-08-07").input.cardio.goal?.vo2max
        ?.benchmark,
    ).toMatchObject({
      type: "twelve_minute",
      distance: 2800,
      distanceUnit: "m",
      timeMinutes: 12,
    });
  });
});
