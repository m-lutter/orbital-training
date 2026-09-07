import { page } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import type { ExercisePrescription, TrainingSession } from "$lib/domain";
import ShorterWorkoutOption from "./ShorterWorkoutOption.svelte";

function exercise(
  id: string,
  name: string,
  optional: boolean,
): ExercisePrescription {
  return {
    id,
    name,
    optional,
    exerciseId: id,
    performanceSeriesId: id,
    purpose: "hypertrophy",
    sets: 3,
    reps: { min: 10, max: 10 },
    targetRir: { min: 2, max: 2 },
    load: 20,
    restSeconds: 90,
    priority: 1,
    progression: { method: "double_progression", instruction: "" },
    alternativeChoices: [],
    explanation: "",
    ruleIds: [],
  };
}

function session(): TrainingSession {
  return {
    id: "w1s1",
    weekNumber: 1,
    sequence: 1,
    kind: "lifting",
    title: "Strength",
    objective: "",
    explanation: "",
    targetMinutes: 30,
    predictedMinutes: 50,
    durationStatus: "guideline_exceeded",
    exercises: [
      exercise("bench", "Bench press", false),
      exercise("curl", "Dumbbell curl", true),
      exercise("raise", "Lateral raise", true),
    ],
    durationAlternative: {
      targetMinutes: 30,
      predictedMinutes: 32,
      exerciseIds: ["bench", "curl"],
      prescriptions: [
        { prescriptionId: "bench", sets: 3 },
        { prescriptionId: "curl", sets: 1 },
      ],
      explanation: "Optional sets removed",
    },
  };
}

describe("ShorterWorkoutOption", () => {
  it("shows exact optional doses without changing the original prescription", async () => {
    const original = session();
    const before = structuredClone(original);
    render(ShorterWorkoutOption, { session: original, units: "kg" });
    await page
      .getByText("Optional shorter lifting plan · about 32 minutes")
      .click();
    await expect
      .element(
        page.getByText("3 sets × 10 reps · stop at 2 RIR · rest 90 seconds."),
      )
      .toBeVisible();
    await expect
      .element(
        page.getByText("1 set × 10 reps · stop at 2 RIR · rest 90 seconds."),
      )
      .toBeVisible();
    await expect
      .element(
        page.getByText("0 sets today · skip this optional exercise for time."),
      )
      .toBeVisible();
    await expect
      .element(page.getByText(/There is no catch-up debt/))
      .toBeVisible();
    await expect
      .element(page.getByText(/Required work still exceeds/))
      .toBeVisible();
    expect(original).toEqual(before);
  });

  it("shows the selected replacement and its own load, not the original's load", async () => {
    render(ShorterWorkoutOption, {
      session: session(),
      units: "kg",
      exerciseNames: { curl: "Cable curl" },
      loadTargets: { curl: 15 },
    });
    await page
      .getByText("Optional shorter lifting plan · about 32 minutes")
      .click();
    await expect
      .element(page.getByText("Cable curl", { exact: true }))
      .toBeVisible();
    await expect.element(page.getByText("Load: 15 kg.")).toBeVisible();
    await expect
      .element(page.getByText("Dumbbell curl", { exact: true }))
      .not.toBeInTheDocument();
  });

  it("does not display malformed alternatives that drop required sets", async () => {
    const invalid = session();
    invalid.durationAlternative!.prescriptions[0]!.sets = 1;
    const result = render(ShorterWorkoutOption, {
      session: invalid,
      units: "kg",
    });
    expect(result.container.querySelector("details")).toBeNull();
  });

  it("uses one exact target for legacy internal ranges", async () => {
    const legacy = session();
    legacy.exercises[0]!.reps = { min: 8, max: 12 };
    legacy.exercises[0]!.targetRir = { min: 2, max: 4 };
    render(ShorterWorkoutOption, { session: legacy, units: "kg" });
    await page
      .getByText("Optional shorter lifting plan · about 32 minutes")
      .click();
    await expect
      .element(
        page.getByText("3 sets × 10 reps · stop at 3 RIR · rest 90 seconds."),
      )
      .toBeVisible();
  });
});
