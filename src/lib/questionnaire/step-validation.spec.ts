import { describe, expect, it } from "vitest";
import {
  questionnaireStepForField,
  validateQuestionnaireThroughStep,
} from "./step-validation";

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
    horizonWeeks: "4",
    bodyweightTracking: "ignore",
    planningStyle: "calendar_days",
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
    cardioFrequencyBand: "one_to_two",
    cardioDurationBand: "15_to_30",
    cardioTypicalEffort: "mostly_easy",
    hardCardioFrequency: "none",
    cardioVariety: "regular_variety",
    heartRateDevice: "none",
    amrapPolicy: "none",
  };
  for (const [name, value] of Object.entries(values)) form.set(name, value);
  form.append("preferredTrainingDays", "monday");
  form.append("preferredTrainingDays", "thursday");
  form.append("cardioFocusedDays", "tuesday");
  form.append("primaryEquipment", "dumbbells");
  form.append("primaryEquipment", "bench");
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

describe("questionnaire page validation", () => {
  it("accepts all seven preferred days for a six-day request", () => {
    const form = validHealthForm();
    form.set("liftingDaysPerWeek", "6");
    replaceSelections(form, "preferredTrainingDays", [
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
    ]);
    expect(validateQuestionnaireThroughStep(form, 2, "2026-08-07")).toEqual({
      valid: true,
    });
  });

  it("blocks leaving schedule when selected days cannot fit the lifts", () => {
    const form = validHealthForm();
    form.set("liftingDaysPerWeek", "4");
    expect(validateQuestionnaireThroughStep(form, 2, "2026-08-07")).toEqual(
      expect.objectContaining({
        valid: false,
        field: "preferredTrainingDays",
      }),
    );
  });

  it("applies the selected-day requirement to flexible scheduling", () => {
    const form = validHealthForm();
    form.set("planningStyle", "flexible_sequence");
    form.set("liftingDaysPerWeek", "3");
    expect(validateQuestionnaireThroughStep(form, 2, "2026-08-07")).toEqual(
      expect.objectContaining({
        valid: false,
        field: "preferredTrainingDays",
      }),
    );
  });

  it("does not let duplicate values masquerade as additional training days", () => {
    const form = validHealthForm();
    form.set("liftingDaysPerWeek", "3");
    form.append("preferredTrainingDays", "monday");
    form.append("preferredTrainingDays", "monday");
    expect(validateQuestionnaireThroughStep(form, 2, "2026-08-07")).toEqual(
      expect.objectContaining({
        valid: false,
        field: "preferredTrainingDays",
      }),
    );
  });

  it("reports a preferred and unavailable overlap before the day count", () => {
    const form = validHealthForm();
    form.append("unavailableDays", "monday");
    expect(validateQuestionnaireThroughStep(form, 2, "2026-08-07")).toEqual(
      expect.objectContaining({ valid: false, field: "unavailableDays" }),
    );
  });

  it("blocks an advanced fallback frequency above planned lifting days", () => {
    const form = validHealthForm();
    form.set("scheduleAdvancedEnabled", "yes");
    form.set("minimumTrainingDays", "3");
    expect(validateQuestionnaireThroughStep(form, 2, "2026-08-07")).toEqual(
      expect.objectContaining({
        valid: false,
        field: "schedule.advanced.minimumTrainingDays",
      }),
    );
  });

  it("does not require goal priority without a secondary goal", () => {
    const form = validHealthForm();
    form.delete("primaryWeight");
    expect(validateQuestionnaireThroughStep(form, 1, "2026-08-07")).toEqual({
      valid: true,
    });
  });

  it("requires a priority split after a secondary goal is selected", () => {
    const form = validHealthForm();
    form.set("secondaryGoal", "cardio");
    form.set("primaryWeight", "100");
    expect(validateQuestionnaireThroughStep(form, 1, "2026-08-07")).toEqual(
      expect.objectContaining({ valid: false, field: "primaryWeight" }),
    );
  });

  it("rejects matching primary and secondary goals even if submitted manually", () => {
    const form = validHealthForm();
    form.set("secondaryGoal", "health");
    form.set("primaryWeight", "80");
    expect(validateQuestionnaireThroughStep(form, 1, "2026-08-07")).toEqual(
      expect.objectContaining({ valid: false, field: "secondaryGoal" }),
    );
  });

  it("blocks an event date without one week of planning runway", () => {
    const form = validHealthForm();
    form.set("hasEvent", "yes");
    form.set("eventType", "race");
    form.set("eventDate", "2026-08-15");
    form.set("eventCertainty", "confirmed");
    expect(validateQuestionnaireThroughStep(form, 1, "2026-08-07")).toEqual(
      expect.objectContaining({
        valid: false,
        field: "goals.event.date",
      }),
    );
  });

  it("ignores errors on future pages until the user reaches them", () => {
    const form = validHealthForm();
    form.set("primaryGoal", "hypertrophy");
    form.set("hypertrophyBalance", "prioritized");
    form.delete("hypertrophySplit");
    expect(validateQuestionnaireThroughStep(form, 2, "2026-08-07")).toEqual({
      valid: true,
    });
  });

  it("requires primary and alternate gym equipment on the equipment page", () => {
    const noPrimary = validHealthForm();
    noPrimary.delete("primaryEquipment");
    expect(
      validateQuestionnaireThroughStep(noPrimary, 4, "2026-08-07"),
    ).toEqual(expect.objectContaining({ field: "primaryEquipment" }));

    const noAlternate = validHealthForm();
    noAlternate.set("usesAlternateGym", "yes");
    expect(
      validateQuestionnaireThroughStep(noAlternate, 4, "2026-08-07"),
    ).toEqual(expect.objectContaining({ field: "alternateEquipment" }));
  });

  it("requires distinct hypertrophy priorities when prioritization is enabled", () => {
    const missing = validHealthForm();
    missing.set("primaryGoal", "hypertrophy");
    missing.set("hypertrophyBalance", "prioritized");
    expect(validateQuestionnaireThroughStep(missing, 6, "2026-08-07")).toEqual(
      expect.objectContaining({ field: "musclePriority1" }),
    );

    const duplicate = validHealthForm();
    duplicate.set("primaryGoal", "hypertrophy");
    duplicate.set("hypertrophyBalance", "prioritized");
    duplicate.set("musclePriority1", "chest");
    duplicate.set("musclePriority2", "chest");
    expect(
      validateQuestionnaireThroughStep(duplicate, 6, "2026-08-07"),
    ).toEqual(expect.objectContaining({ field: "musclePriority1" }));
  });

  it("blocks contradictory running preferences on the cardio page", () => {
    const form = validHealthForm();
    form.set("primaryCardioModality", "running");
    form.set("avoidRunning", "yes");
    expect(validateQuestionnaireThroughStep(form, 7, "2026-08-07")).toEqual(
      expect.objectContaining({
        valid: false,
        field: "cardio.preferredModalities",
      }),
    );
  });

  it("blocks advanced cardio counts above fourteen sessions", () => {
    const form = validHealthForm();
    form.set("cardioAdvancedEnabled", "yes");
    form.set("currentEasySessions", "8");
    form.set("currentModerateSessions", "7");
    form.set("currentHardSessions", "0");
    expect(validateQuestionnaireThroughStep(form, 7, "2026-08-07")).toEqual(
      expect.objectContaining({
        valid: false,
        field: "currentEasySessions",
      }),
    );
  });

  it("defers the disclaimer until review and then requires it", () => {
    const form = validHealthForm();
    expect(validateQuestionnaireThroughStep(form, 7, "2026-08-07")).toEqual({
      valid: true,
    });
    expect(validateQuestionnaireThroughStep(form, 8, "2026-08-07")).toEqual(
      expect.objectContaining({
        valid: false,
        field: "safety.disclaimerAccepted",
      }),
    );
  });

  it("maps engine paths back to the page that can fix them", () => {
    expect(questionnaireStepForField("goals.event.date")).toBe(1);
    expect(questionnaireStepForField("schedule.preferredTrainingDays")).toBe(2);
    expect(questionnaireStepForField("recovery.typicalSleepHours")).toBe(3);
    expect(questionnaireStepForField("facility.primaryEquipment")).toBe(4);
    expect(questionnaireStepForField("powerlifting.observations")).toBe(5);
    expect(questionnaireStepForField("hypertrophy.musclePriorities")).toBe(6);
    expect(questionnaireStepForField("cardio.preferredModalities")).toBe(7);
    expect(questionnaireStepForField("adaptation.applyChanges")).toBe(8);
    expect(questionnaireStepForField("safety.disclaimerAccepted")).toBe(8);
  });
});
