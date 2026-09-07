import { describe, expect, it } from "vitest";
import { importedStepsMeetingGoal, wearableSourceLabel } from "./movement";

describe("imported movement data", () => {
  it("uses imported steps only after the applicable goal is reached", () => {
    expect(
      importedStepsMeetingGoal(
        {
          date: "2026-08-24",
          steps: 8_250,
          stepGoal: 8_000,
          goalMet: true,
          source: "apple_health",
          syncedAt: "2026-08-25T12:00:00Z",
        },
        { steps: 7_500 },
      ),
    ).toBe(8_250);
    expect(
      importedStepsMeetingGoal(
        {
          date: "2026-08-24",
          steps: 7_999,
          stepGoal: 8_000,
          goalMet: false,
          source: "fitbit",
          syncedAt: null,
        },
        { steps: 7_500 },
      ),
    ).toBeUndefined();
  });

  it("falls back to the program target and formats provider labels", () => {
    expect(
      importedStepsMeetingGoal(
        {
          date: "2026-08-24",
          steps: 6_100,
          stepGoal: null,
          goalMet: false,
          source: null,
          syncedAt: null,
        },
        { steps: 6_000 },
      ),
    ).toBe(6_100);
    expect(wearableSourceLabel("apple_health")).toBe("Apple Health");
    expect(wearableSourceLabel(null)).toBe("your connected device");
  });

  it("does not let a lower device goal suppress Orbital's step target", () => {
    expect(
      importedStepsMeetingGoal(
        {
          date: "2026-08-24",
          steps: 8_500,
          stepGoal: 8_000,
          goalMet: true,
          source: "google_health",
          syncedAt: "2026-08-25T12:00:00Z",
        },
        { steps: 10_000 },
      ),
    ).toBeUndefined();
  });
});
