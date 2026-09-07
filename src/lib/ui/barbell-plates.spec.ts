import { describe, expect, it } from "vitest";
import {
  calculatePlatePlan,
  isBarbellExercise,
  layoutPlateGeometry,
} from "./barbell-plates";

describe("barbell plate visualization", () => {
  it("loads 225 lb as two 45 lb plates per side", () => {
    expect(
      calculatePlatePlan(225, "lb", "iron").plates.map((plate) => plate.value),
    ).toEqual([45, 45]);
  });

  it("loads 185 lb as one 45 and one 25 per side", () => {
    const plan = calculatePlatePlan(185, "lb", "colored");
    expect(plan.plates.map((plate) => plate.value)).toEqual([45, 25]);
    const geometry = layoutPlateGeometry(plan.plates, plan.unit);
    expect(geometry[0]?.height).toBe(geometry[1]?.height);
    expect(geometry[1]?.x).toBe(
      (geometry[0]?.x ?? 0) + (geometry[0]?.width ?? 0),
    );
  });

  it("keeps full-size plates tall and steps down smaller change plates", () => {
    const plan = calculatePlatePlan(165, "lb", "colored");
    const geometry = layoutPlateGeometry(plan.plates, plan.unit);
    expect(plan.plates.map((plate) => plate.value)).toEqual([45, 10, 5]);
    expect(geometry[0]?.height).toBeGreaterThan(geometry[1]?.height ?? 0);
    expect(geometry[1]?.height).toBeGreaterThan(geometry[2]?.height ?? 0);
  });

  it("converts pound targets to the closest loadable metric total", () => {
    const plan = calculatePlatePlan(225, "lb", "metric");
    expect(plan.unit).toBe("kg");
    expect(Math.abs(plan.displayedTotal * 2.2046226218 - 225)).toBeLessThan(2);
  });

  it("only displays for exercises that use a barbell and plates", () => {
    expect(isBarbellExercise("competition_squat")).toBe(true);
    expect(isBarbellExercise("one_arm_dumbbell_row")).toBe(false);
  });
});
