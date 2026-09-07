import { describe, expect, it } from "vitest";
import { generateProgram } from "./generator";
import { programmingSafetyIssues } from "./safety";
import { validateQuestionnaire } from "./validation";
import { isIsoDate } from "./utils";
import { baseInput } from "./tests/fixtures";

describe("supported programming boundary", () => {
  it.each([13, 17, 101, Number.NaN])(
    "blocks unsupported age %s without guessing a youth prescription",
    (age) => {
      const input = baseInput();
      input.age = age;
      expect(
        programmingSafetyIssues(input).some((issue) => issue.path === "age"),
      ).toBe(true);
      expect(generateProgram(input).program).toBeUndefined();
    },
  );
  it.each([18, 68, 100])("accepts adult age %s within scope", (age) => {
    const input = baseInput();
    input.age = age;
    expect(programmingSafetyIssues(input)).toEqual([]);
  });
  it.each([true, false])(
    "requires clarification regardless of operational consent %s",
    (consent) => {
      const input = baseInput();
      input.safety.allowOperationalRestrictions = consent;
      input.safety.restrictedBodyAreas = ["shoulder"];
      input.safety.clinicianRestrictions = ["No loaded overhead work"];
      expect(programmingSafetyIssues(input)).toHaveLength(2);
      expect(generateProgram(input).program).toBeUndefined();
    },
  );
  it("retains explicit nonmedical exercise and movement exclusions", () => {
    const input = baseInput();
    input.safety.excludedMovements = ["vertical_push"];
    expect(programmingSafetyIssues(input)).toEqual([]);
  });
  it("rejects duplicate weekday capacity and inverted heart rates", () => {
    const input = baseInput();
    input.schedule.preferredTrainingDays = ["monday", "monday"];
    input.cardio.knownMaxHeartRate = 80;
    input.cardio.advanced = { restingHeartRate: 90 };
    expect(validateQuestionnaire(input).map((issue) => issue.path)).toEqual(
      expect.arrayContaining([
        "schedule.preferredTrainingDays",
        "cardio.advanced.restingHeartRate",
      ]),
    );
  });
  it("rejects nonexistent calendar dates rather than accepting JavaScript rollover", () => {
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2028-02-29")).toBe(true);
  });
});
