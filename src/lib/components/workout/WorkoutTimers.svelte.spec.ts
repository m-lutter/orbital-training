import { page } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import WorkoutTimers from "./WorkoutTimers.svelte";

function props(overrides: Record<string, unknown> = {}) {
  return {
    cardioOnly: false,
    predictedMinutes: 75,
    cardioMinutes: 30,
    workoutSeconds: 90,
    workoutRunning: false,
    restSeconds: 120,
    restRunning: true,
    ontoggleworkout: vi.fn(),
    onresetworkout: vi.fn(),
    ontogglerest: vi.fn(),
    onclearrest: vi.fn(),
    ...overrides,
  };
}

describe("WorkoutTimers", () => {
  it("shows cardio elapsed and remaining time without a rest timer", async () => {
    render(WorkoutTimers, props({ cardioOnly: true }));

    await expect
      .element(page.getByText("01:30 elapsed · 28:30 left"))
      .toBeInTheDocument();
    await expect.element(page.getByText("Rest")).not.toBeInTheDocument();
  });

  it("keeps timer controls inside a 320 px phone viewport", async () => {
    await page.viewport(320, 800);
    const result = render(WorkoutTimers, props());

    expect(result.container.scrollWidth).toBeLessThanOrEqual(
      result.container.clientWidth,
    );
  });

  it("uses the light timer treatment in Cute mode", () => {
    document.documentElement.dataset.theme = "cute";
    try {
      const result = render(WorkoutTimers, props());
      const timer = result.container.querySelector(".timer-bar");
      expect(timer).not.toBeNull();
      expect(getComputedStyle(timer as HTMLElement).color).toBe(
        "rgb(50, 21, 35)",
      );
    } finally {
      document.documentElement.dataset.theme = "orbital";
    }
  });
});
