import { generateProgram } from "$lib/domain";
import { QUESTIONNAIRE_DAYS, questionnaireStepForField } from "./contracts.js";
import { QuestionnaireFormError, parseQuestionnaireForm } from "./parse.js";

export { questionnaireStepForField } from "./contracts.js";

export type QuestionnaireStepValidation =
  { valid: true } | { valid: false; message: string; field: string };

function selected(formData: FormData, name: string): string[] {
  return formData
    .getAll(name)
    .map(String)
    .filter((value, index, all) => all.indexOf(value) === index);
}

function text(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

function cloneFormData(source: FormData): FormData {
  const copy = new FormData();
  for (const [name, value] of source.entries()) copy.append(name, value);
  return copy;
}

function directValidation(
  formData: FormData,
  throughStep: number,
): QuestionnaireStepValidation | undefined {
  const primary = text(formData, "primaryGoal");
  const secondary = text(formData, "secondaryGoal");
  const priority = text(formData, "primaryWeight");
  if (throughStep >= 1) {
    if (secondary !== "none" && priority === "100") {
      return {
        valid: false,
        field: "primaryWeight",
        message: "Choose how to divide priority between your two goals.",
      };
    }
    if (secondary !== "none" && secondary === primary) {
      return {
        valid: false,
        field: "secondaryGoal",
        message: "Choose a secondary goal that differs from your primary goal.",
      };
    }
  }

  if (throughStep >= 2) {
    const requestedLiftingDays = Number(text(formData, "liftingDaysPerWeek"));
    const preferred = selected(formData, "preferredTrainingDays").filter(
      (day) =>
        QUESTIONNAIRE_DAYS.includes(day as (typeof QUESTIONNAIRE_DAYS)[number]),
    );
    const unavailable = new Set(selected(formData, "unavailableDays"));
    const availablePreferred = preferred.filter((day) => !unavailable.has(day));
    const overlap = preferred.find((day) => unavailable.has(day));
    if (overlap !== undefined) {
      return {
        valid: false,
        field: "unavailableDays",
        message: `${overlap} cannot be both a training day and an unavailable day.`,
      };
    }
    if (
      Number.isInteger(requestedLiftingDays) &&
      requestedLiftingDays >= 1 &&
      requestedLiftingDays <= 6 &&
      availablePreferred.length < requestedLiftingDays
    ) {
      return {
        valid: false,
        field: "preferredTrainingDays",
        message: `You chose ${requestedLiftingDays} lifting days, but only ${availablePreferred.length} selected training ${availablePreferred.length === 1 ? "day is" : "days are"} available. Select at least ${requestedLiftingDays} days or lower your lifting frequency.`,
      };
    }
  }

  if (throughStep >= 4) {
    if (selected(formData, "primaryEquipment").length === 0) {
      return {
        valid: false,
        field: "primaryEquipment",
        message:
          "Select at least bodyweight/floor-space training or one available piece of equipment.",
      };
    }
    if (
      selected(formData, "usesAlternateGym").includes("yes") &&
      selected(formData, "alternateEquipment").length === 0
    ) {
      return {
        valid: false,
        field: "alternateEquipment",
        message: "Select the equipment available at your alternate gym.",
      };
    }
  }

  if (throughStep >= 6) {
    const needsHypertrophy =
      primary === "hypertrophy" || secondary === "hypertrophy";
    if (
      needsHypertrophy &&
      text(formData, "hypertrophyBalance") === "prioritized"
    ) {
      const priorities = [1, 2, 3]
        .map((rank) => text(formData, `musclePriority${rank}`))
        .filter(Boolean);
      if (priorities.length === 0) {
        return {
          valid: false,
          field: "musclePriority1",
          message:
            "Select at least one priority muscle or choose balanced development.",
        };
      }
      if (new Set(priorities).size !== priorities.length) {
        return {
          valid: false,
          field: "musclePriority1",
          message: "Choose a different muscle for each priority position.",
        };
      }
    }
  }

  return undefined;
}

/**
 * Runs the same parser and engine validation used by final submission, while
 * reporting only errors on the current or previously completed pages.
 */
export function validateQuestionnaireThroughStep(
  formData: FormData,
  throughStep: number,
  asOfDate: `${number}-${number}-${number}`,
): QuestionnaireStepValidation {
  const step = Math.max(1, Math.min(8, Math.trunc(throughStep)));
  const directIssue = directValidation(formData, step);
  if (directIssue !== undefined) return directIssue;

  const validationData = cloneFormData(formData);
  if (step < 8) validationData.set("disclaimerAccepted", "yes");

  let parsed;
  try {
    parsed = parseQuestionnaireForm(validationData, asOfDate);
  } catch (caughtError) {
    if (
      caughtError instanceof QuestionnaireFormError &&
      questionnaireStepForField(caughtError.path) <= step
    ) {
      return {
        valid: false,
        message: caughtError.message,
        field: caughtError.path,
      };
    }
    return { valid: true };
  }

  const issue = generateProgram(parsed.input).issues.find(
    (candidate) =>
      candidate.severity === "blocking" &&
      questionnaireStepForField(candidate.path) <= step,
  );
  return issue === undefined
    ? { valid: true }
    : { valid: false, message: issue.message, field: issue.path };
}
