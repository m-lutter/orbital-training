import { page } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import CardioLogger from "./CardioLogger.svelte";

const cardio = {
  modality: "running" as const,
  intensity: "moderate" as const,
  minutes: 30,
  role: "intervals" as const,
  intervals: { workSeconds: 60, recoverySeconds: 90, repeats: 6 },
  segments: [
    {
      kind: "warmup" as const,
      label: "Easy warm-up",
      minutes: 8,
      intensity: "easy" as const,
    },
  ],
  talkTest: "RPE 6: you should still be able to speak in short sentences.",
  sessionRpe: { min: 5, max: 7 },
  placement: "After lifting",
  ruleIds: ["cardio-test"],
};

describe("CardioLogger", () => {
  it("switches today's activity while preserving exact time and intervals", async () => {
    render(CardioLogger, {
      cardio: {
        ...cardio,
        targetDistance: { value: 3, unit: "mi" },
        heartRateBpm: { min: 140, max: 160, method: "percent_max" },
      },
      availableModalities: ["running", "cycling"],
      runningEvent: true,
      distanceUnit: "mi",
      elevationUnit: "ft",
      hasHeartRateDevice: true,
      distance: 3,
      averageHeartRate: 150,
      completedMinutes: 30,
    });
    await expect.element(page.getByRole("status")).not.toBeInTheDocument();
    await page
      .getByLabelText("Cardio activity for this workout")
      .selectOptions("cycling");
    await expect
      .element(page.getByRole("heading", { name: "Intervals Cycling" }))
      .toBeVisible();
    await expect
      .element(page.getByText("30 minutes · Moderate · target RPE 6"))
      .toBeVisible();
    await expect
      .element(page.getByText(/6\s*×\s*60-second work\s*intervals/))
      .toBeVisible();
    await expect.element(page.getByRole("status")).toBeVisible();
    await expect
      .element(page.getByRole("status"))
      .toHaveTextContent(/does not replace\s+running-specific preparation/);
    await expect
      .element(page.getByText("Distance target:", { exact: false }))
      .not.toBeInTheDocument();
    await expect
      .element(page.getByText("Optional heart-rate guide:", { exact: false }))
      .not.toBeInTheDocument();
    await expect
      .element(page.getByLabelText("Distance (mi, optional)"))
      .toHaveValue(null);
    await expect
      .element(page.getByLabelText("Average heart rate (optional)"))
      .toHaveValue(null);
    await expect
      .element(page.getByLabelText("Minutes completed"))
      .toHaveValue(30);
    await expect
      .element(page.getByLabelText("Surface (optional)"))
      .not.toBeInTheDocument();
  });

  it("reloads a saved legacy alternate even when it is no longer offered", async () => {
    render(CardioLogger, {
      cardio,
      availableModalities: ["running"],
      selectedModality: "swimming",
      distanceUnit: "mi",
      elevationUnit: "ft",
      hasHeartRateDevice: false,
    });
    await expect
      .element(page.getByRole("heading", { name: "Intervals Swimming" }))
      .toBeVisible();
    await expect
      .element(page.getByLabelText("Cardio activity for this workout"))
      .toHaveValue("swimming");
    await expect
      .element(
        page.getByRole("option", { name: "Swimming (previously saved)" }),
      )
      .toBeInTheDocument();
  });

  it("shows the prescribed session and relevant tracking fields", async () => {
    render(CardioLogger, {
      cardio,
      distanceUnit: "mi",
      elevationUnit: "ft",
      hasHeartRateDevice: true,
      completedMinutes: 30,
      sessionRpe: 6,
      source: "watch",
    });

    await expect
      .element(page.getByRole("heading", { name: "Intervals Running" }))
      .toBeVisible();
    await expect
      .element(page.getByLabelText("Average heart rate (optional)"))
      .toBeInTheDocument();
    await expect
      .element(page.getByLabelText("Minutes completed"))
      .toHaveValue(30);
  });

  it("uses one column and avoids overflow on a 320 px phone", async () => {
    await page.viewport(320, 800);
    const result = render(CardioLogger, {
      cardio,
      distanceUnit: "mi",
      elevationUnit: "ft",
      hasHeartRateDevice: false,
      source: "manual",
    });

    expect(result.container.scrollWidth).toBeLessThanOrEqual(
      result.container.clientWidth,
    );
  });
});
