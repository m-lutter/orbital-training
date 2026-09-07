import { page } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import QuestionnaireProgress from "./QuestionnaireProgress.svelte";

const labels = {
  1: "Goals",
  2: "Schedule",
  3: "Experience",
  4: "Equipment",
  5: "Powerlifting",
  6: "Hypertrophy",
  7: "Cardio",
  8: "Review",
} as const;

describe("QuestionnaireProgress", () => {
  it("keeps unseen future sections locked and sends accessible navigation", async () => {
    const onstepchange = vi.fn();
    render(QuestionnaireProgress, {
      editingProgram: false,
      step: 1,
      stepPosition: 1,
      steps: [1, 2, 5, 8],
      labels,
      visitedSteps: [1],
      flightStatus: "Sizing tanks",
      cuteStatus: "Getting things ready",
      onstepchange,
    });

    await expect
      .element(page.getByRole("button", { name: "Schedule" }))
      .toBeEnabled();
    await expect
      .element(page.getByRole("button", { name: "Powerlifting" }))
      .toBeDisabled();
    await page.getByRole("button", { name: "Schedule" }).click();
    expect(onstepchange).toHaveBeenCalledWith(2);
  });

  it("fits a 320 px viewport without creating page-level overflow", async () => {
    await page.viewport(320, 800);
    const result = render(QuestionnaireProgress, {
      editingProgram: true,
      step: 7,
      stepPosition: 6,
      steps: [1, 2, 3, 4, 7, 8],
      labels,
      visitedSteps: [1, 2, 3, 4, 7],
      flightStatus: "Running trajectory simulations",
      cuteStatus: "Shaping your plan",
      onstepchange: vi.fn(),
    });

    expect(result.container.scrollWidth).toBeLessThanOrEqual(
      result.container.clientWidth,
    );
    await expect
      .element(page.getByLabelText("Step 6 of 6"))
      .toBeInTheDocument();
  });
});
