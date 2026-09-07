import { describe, expect, it } from "vitest";
import { generateProgram, generateProgramShell } from "./generate";
import type { PrimaryGoal, ProgramRequestV1 } from "./contracts";

const request = (
  goal: PrimaryGoal,
  liftingDaysPerWeek: number,
  cardioDaysPerWeek: number,
): ProgramRequestV1 => ({
  questionnaireVersion: 1,
  primaryGoal: goal,
  liftingDaysPerWeek,
  cardioDaysPerWeek,
  liftingSessionMinutes: 90,
  cardioSessionMinutes: 30,
  programLength: { mode: "fixed", weeks: 4 },
});

describe("generateProgram", () => {
  it("keeps legacy shell generation stable", () => {
    const program = generateProgramShell(request("powerlifting", 4, 2));
    expect(program.schemaVersion).toBe(1);
    expect(program.engineVersion).toBe("0.1.0");
  });

  it("creates powerlifting prescriptions with competition lifts", () => {
    const program = generateProgram(request("powerlifting", 4, 2));
    const first = program.weeks[0].sessions[0];
    expect(program.schemaVersion).toBe(2);
    expect(first.kind).toBe("lifting");
    if (first.kind !== "lifting") throw new Error("Expected lifting session");
    expect(
      first.exercises.some((item) => item.name === "Competition Squat"),
    ).toBe(true);
    expect(first.exercises[0].effort.scale).toBe("rpe");
  });

  it("selects a four-day upper/lower hypertrophy structure", () => {
    const program = generateProgram(request("hypertrophy", 4, 1));
    const titles = program.weeks[0].sessions
      .filter((item) => item.kind === "lifting")
      .map((item) => item.title);
    expect(titles).toEqual(["Upper A", "Lower A", "Upper B", "Lower B"]);
    expect(program.weeks[2].phase).toBe("intensification");
    expect(program.weeks[3].phase).toBe("recovery");
  });

  it("uses a mixed cardio structure for a cardio-focused user", () => {
    const program = generateProgram(request("cardio", 2, 4));
    const methods = program.weeks[0].sessions
      .filter((item) => item.kind === "cardio")
      .map((item) => item.prescription.method);
    expect(methods).toEqual(["easy-steady", "tempo", "recovery", "long-easy"]);
  });

  it("trims lower-priority exercises when time is limited", () => {
    const input = request("hypertrophy", 2, 0);
    input.liftingSessionMinutes = 30;
    const program = generateProgram(input);
    const first = program.weeks[0].sessions[0];
    expect(first.kind).toBe("lifting");
    if (first.kind !== "lifting") throw new Error("Expected lifting session");
    expect(first.exercises).toHaveLength(3);
  });
});
