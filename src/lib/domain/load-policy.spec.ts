import { describe, expect, it } from "vitest";
import {
  loadIncrementForExercise,
  totalBarbellIncrement,
  totalBarbellIncrementFromInput,
  usesCanonicalBarbellIncrement,
} from "./load-policy.js";

describe("canonical load-increment policy", () => {
  it("treats questionnaire barbell input as the smallest plate per side", () => {
    expect(
      totalBarbellIncrementFromInput({
        units: "lb",
        facility: {
          primaryEquipment: [],
          barbellIncrement: 2.5,
          substitutionApproval: "recommend_then_ask",
        },
      }),
    ).toBe(5);
  });

  it("recognizes canonical current and future semantic versions", () => {
    expect(usesCanonicalBarbellIncrement("0.9.9")).toBe(false);
    expect(usesCanonicalBarbellIncrement("0.10.0")).toBe(true);
    expect(usesCanonicalBarbellIncrement("0.11.0")).toBe(true);
    expect(usesCanonicalBarbellIncrement("1.0.0")).toBe(true);
  });

  it("normalizes legacy values exactly once", () => {
    expect(
      totalBarbellIncrement({
        engineVersion: "0.9.0",
        loadSettings: {
          units: "lb",
          barbellIncrement: 2.5,
          dumbbellIncrement: 5,
        },
      }),
    ).toBe(5);
    expect(
      totalBarbellIncrement({
        engineVersion: "0.11.0",
        loadSettings: {
          units: "lb",
          barbellIncrement: 5,
          dumbbellIncrement: 5,
        },
      }),
    ).toBe(5);
  });

  it("uses the same policy for logging and adaptation", () => {
    const program = {
      engineVersion: "0.11.0",
      loadSettings: {
        units: "lb" as const,
        barbellIncrement: 5,
        dumbbellIncrement: 2.5,
      },
    };
    expect(loadIncrementForExercise(program, "competition_bench")).toBe(5);
    expect(loadIncrementForExercise(program, "dumbbell_bench")).toBe(2.5);
  });
});
