import { generateProgram } from "$lib/domain";
import { baseInput } from "$lib/domain/tests/fixtures";
import { createStoredProgramV3 } from "$lib/engine";
import { describe, expect, it } from "vitest";
import {
  questionnaireEditFormValues,
  questionnaireFormValuesForStorage,
  questionnaireToFormValues,
} from "./serialize";

function storedProgram(formValues?: Record<string, string | string[]>) {
  const input = baseInput();
  const program = generateProgram(input).program;
  if (program === undefined) throw new Error("Expected generated program");
  return createStoredProgramV3(input, program, formValues);
}

describe("questionnaire edit-state serialization", () => {
  it("restores the exact successful form state instead of inferred defaults", () => {
    const draft = storedProgram({
      name: "Old name",
      programIcon: "launch_vehicle",
      primaryGoal: "health",
      secondaryGoal: "none",
      primaryWeight: "100",
      preferredTrainingDays: ["monday", "wednesday", "friday"],
      scheduleAdvancedEnabled: "yes",
      splitSessionDays: [],
      cardioWeeklyMinutes: "",
    });
    expect(questionnaireEditFormValues("Current name", draft)).toEqual({
      name: "Current name",
      programIcon: "launch_vehicle",
      primaryGoal: "health",
      secondaryGoal: "none",
      primaryWeight: "100",
      preferredTrainingDays: ["monday", "wednesday", "friday"],
      scheduleAdvancedEnabled: "yes",
      splitSessionDays: [],
      cardioWeeklyMinutes: "",
    });
  });

  it("returns a clone so editing cannot mutate the immutable saved snapshot", () => {
    const draft = storedProgram({
      preferredTrainingDays: ["monday", "friday"],
    });
    const values = questionnaireEditFormValues("Plan", draft);
    values.preferredTrainingDays = ["sunday"];
    expect(draft.questionnaireFormValues?.preferredTrainingDays).toEqual([
      "monday",
      "friday",
    ]);
  });

  it("reconstructs older schema-v3 programs that predate exact form storage", () => {
    const draft = storedProgram();
    expect(questionnaireEditFormValues("Legacy plan", draft)).toEqual(
      questionnaireToFormValues("Legacy plan", draft.inputSnapshot),
    );
  });

  it("removes action-only fields without mutating submitted values", () => {
    const submitted = {
      programId: "5e2ddf3c-bb55-491d-80ad-60ad46225f1a",
      questionnaireStep: "2",
      primaryGoal: "health",
      preferredTrainingDays: ["monday", "thursday"],
    };
    expect(questionnaireFormValuesForStorage(submitted)).toEqual({
      primaryGoal: "health",
      preferredTrainingDays: ["monday", "thursday"],
    });
    expect(submitted.programId).toBe("5e2ddf3c-bb55-491d-80ad-60ad46225f1a");
  });
});
