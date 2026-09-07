import { describe, expect, it } from "vitest";
import {
  EXERCISES,
  equipmentSupports,
  usesAddedBodyweightLoad,
} from "./exercises";

describe("bodyweight load presentation contract", () => {
  it("marks every catalog exercise whose logged load is added to bodyweight", () => {
    const addedLoadExercises = EXERCISES.filter(
      (exercise) => exercise.loadType === "added_to_bodyweight",
    ).map((exercise) => exercise.id);
    expect(addedLoadExercises).toEqual([
      "push_up",
      "feet_elevated_push_up",
      "slider_leg_curl",
      "pike_push_up",
      "pull_up",
      "close_grip_push_up",
      "plank",
      "dead_bug",
    ]);
    expect(addedLoadExercises.every(usesAddedBodyweightLoad)).toBe(true);
  });

  it("does not relabel externally loaded exercises as bodyweight", () => {
    expect(usesAddedBodyweightLoad("competition_squat")).toBe(false);
    expect(usesAddedBodyweightLoad("dumbbell_bench")).toBe(false);
  });
});

describe("Smith-machine equipment support", () => {
  it("provides purpose-matched squat, bench, and hinge options", () => {
    for (const id of ["smith_squat", "smith_bench", "smith_rdl"]) {
      const exercise = EXERCISES.find((item) => item.id === id);
      expect(exercise).toBeDefined();
      expect(
        equipmentSupports(exercise!, ["smith_machine", "bench", "plates"]),
      ).toBe(true);
    }
  });
});
