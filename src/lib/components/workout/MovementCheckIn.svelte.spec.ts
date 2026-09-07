import { page } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import MovementCheckIn from "./MovementCheckIn.svelte";

describe("MovementCheckIn", () => {
  it("saves a clear answer and closes immediately", async () => {
    const oncontinue = vi.fn();
    render(MovementCheckIn, {
      props: {
        target: { steps: 8000, explanation: "Daily movement" },
        answer: "",
        oncontinue,
      },
    });

    await expect
      .element(page.getByRole("button", { name: "Continue" }))
      .not.toBeInTheDocument();
    await page.getByRole("button", { name: "Yes", exact: true }).click();
    expect(oncontinue).toHaveBeenCalledOnce();
  });

  it("fits the bottom-sheet presentation on a 320 px phone", async () => {
    await page.viewport(320, 800);
    const result = render(MovementCheckIn, {
      props: {
        target: { walkingMinutes: 30, explanation: "Daily movement" },
        answer: "untracked",
        oncontinue: vi.fn(),
      },
    });

    expect(result.container.scrollWidth).toBeLessThanOrEqual(
      result.container.clientWidth,
    );
    await expect
      .element(page.getByRole("dialog", { name: "Yesterday’s movement" }))
      .toBeVisible();
  });

  it("suppresses manual step entry when imported steps reached the goal", async () => {
    const oncontinue = vi.fn();
    render(MovementCheckIn, {
      props: {
        target: { steps: 8_000, explanation: "Daily movement" },
        wearableDay: {
          date: "2026-08-24",
          steps: 8_450,
          stepGoal: 8_000,
          goalMet: true,
          source: "fitbit",
          syncedAt: "2026-08-25T08:00:00Z",
        },
        oncontinue,
      },
    });

    await expect.element(page.getByText("8,450 steps imported")).toBeVisible();
    await expect
      .element(page.getByRole("dialog", { name: "Yesterday’s movement" }))
      .toHaveAttribute("data-answer", "yes");
    await expect
      .element(page.getByLabelText("Yesterday’s steps (optional)"))
      .not.toBeInTheDocument();
    await page.getByRole("button", { name: "Continue" }).click();
    expect(oncontinue).toHaveBeenCalledOnce();
  });
});
