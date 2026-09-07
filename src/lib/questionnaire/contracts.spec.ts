import { describe, expect, it } from "vitest";
import {
  allQuestionnaireDays,
  goalSpecificQuestionnaireSteps,
  isAllQuestionnaireDays,
  normalizeQuestionnaireDays,
  questionnaireControlForField,
  questionnaireStepForField,
  visibleQuestionnaireSteps,
} from "./contracts";

describe("questionnaire navigation contracts", () => {
  it.each([
    ["goals.event.date", 1],
    ["schedule.preferredTrainingDays", 2],
    ["recovery.typicalSleepHours", 3],
    ["generalFitness.balanceConcern", 3],
    ["facility.primaryEquipment", 4],
    ["safety.excludedMovements", 4],
    ["squatObservation2Date", 5],
    ["powerlifting.observations", 5],
    ["musclePriority3", 6],
    ["useSupersets", 6],
    ["cardio.preferredModalities", 7],
    ["knownMaxHeartRate", 7],
    ["adaptation.applyChanges", 8],
    ["safety.disclaimerAccepted", 8],
  ] as const)("maps %s to step %i", (field, step) => {
    expect(questionnaireStepForField(field)).toBe(step);
  });

  it("sends an unknown boundary error to final review instead of page one", () => {
    expect(questionnaireStepForField("future.unregisteredBoundary")).toBe(8);
    expect(questionnaireStepForField("questionnaire")).toBe(8);
  });

  it("maps machine paths to the control that can receive focus", () => {
    expect(questionnaireControlForField("goals.event.date")).toBe("eventDate");
    expect(questionnaireControlForField("schedule.preferredTrainingDays")).toBe(
      "preferredTrainingDays",
    );
    expect(questionnaireControlForField("questionnaire")).toBeUndefined();
  });

  it("builds goal-specific navigation without duplicate or obsolete pages", () => {
    expect(visibleQuestionnaireSteps("health", "none")).toEqual([
      1, 2, 3, 4, 7, 8,
    ]);
    expect(visibleQuestionnaireSteps("powerlifting", "hypertrophy")).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    expect(
      goalSpecificQuestionnaireSteps("hypertrophy", "powerlifting"),
    ).toEqual([5, 6]);
  });
});

describe("questionnaire day contracts", () => {
  it("normalizes invalid and duplicate submitted days", () => {
    expect(
      normalizeQuestionnaireDays(["monday", "monday", "not-a-day", "sunday"]),
    ).toEqual(["monday", "sunday"]);
  });

  it("recognizes all seven days without relying on array length", () => {
    const days = allQuestionnaireDays();
    expect(isAllQuestionnaireDays(days)).toBe(true);
    expect(isAllQuestionnaireDays([...days.slice(0, 6), "monday"])).toBe(false);
  });

  it("returns a fresh all-days value for each consumer", () => {
    const first = allQuestionnaireDays();
    first.pop();
    expect(allQuestionnaireDays()).toHaveLength(7);
  });
});
