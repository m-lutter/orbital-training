import { describe, expect, it } from "vitest";
import { defaultLiftSessionMinutes } from "./defaults";

describe("questionnaire defaults", () => {
  it("allows longer rest periods in a new powerlifting program", () => {
    expect(defaultLiftSessionMinutes("powerlifting")).toBe(75);
  });

  it.each(["hypertrophy", "health", "cardio"] as const)(
    "defaults a new %s program to sixty-minute lifting sessions",
    (goal) => {
      expect(defaultLiftSessionMinutes(goal)).toBe(60);
    },
  );
});
