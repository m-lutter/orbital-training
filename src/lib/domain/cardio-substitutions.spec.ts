import { describe, expect, it } from "vitest";
import {
  availableCardioModalities,
  createCardioModalityVariant,
  isCardioModality,
} from "./cardio-substitutions.js";
import { baseInput } from "./tests/fixtures.js";
import type { CardioPrescription } from "./types.js";

const prescription: CardioPrescription = {
  modality: "running",
  intensity: "hard",
  role: "intervals",
  eventPhase: "specific",
  minutes: 30,
  intervals: { workSeconds: 60, recoverySeconds: 120, repeats: 6 },
  segments: [
    { kind: "warmup", label: "Run slowly", minutes: 6, intensity: "easy" },
    {
      kind: "work",
      label: "Run fast",
      minutes: 6,
      distance: 1,
      distanceUnit: "mi",
      repeats: 6,
      intensity: "hard",
    },
    { kind: "recovery", label: "Jog recovery", minutes: 12, intensity: "easy" },
    { kind: "cooldown", label: "Walk", minutes: 6, intensity: "easy" },
  ],
  targetDistance: { value: 3, unit: "mi" },
  paceTarget: {
    minSecondsPerUnit: 400,
    maxSecondsPerUnit: 420,
    unit: "mi",
    basis: "benchmark",
  },
  heartRateBpm: { min: 140, max: 160, method: "percent_max" },
  sessionRpe: { min: 7, max: 8 },
  talkTest: "Run hard",
  placement: "Separate from lifting",
  ruleIds: ["CARDIO-01"],
};

describe("cardio modality alternatives", () => {
  it("limits choices to unique preferences supported by equipment and avoid-running", () => {
    const input = baseInput();
    input.cardio.preferredModalities = [
      "walking",
      "running",
      "cycling",
      "rowing",
      "elliptical",
      "swimming",
      "cycling",
    ];
    input.cardio.avoidRunning = true;
    input.facility.primaryEquipment = ["bodyweight", "cardio_bike", "pool"];
    expect(availableCardioModalities(input)).toEqual([
      "walking",
      "cycling",
      "swimming",
    ]);
  });

  it("checks the selected facility and does not invent a walking preference", () => {
    const input = baseInput();
    input.cardio.preferredModalities = ["cycling", "rowing"];
    input.facility.primaryEquipment = ["cardio_bike"];
    input.facility.alternateEquipment = ["rower"];
    expect(availableCardioModalities(input)).toEqual(["cycling"]);
    expect(availableCardioModalities(input, "secondary")).toEqual(["rowing"]);
    input.facility.alternateEquipment = [];
    expect(availableCardioModalities(input, "secondary")).toEqual([]);
  });

  it("requires explicit pool access for newly selectable swimming", () => {
    const input = baseInput();
    input.cardio.preferredModalities = ["swimming"];
    input.facility.primaryEquipment = ["bodyweight"];
    expect(availableCardioModalities(input)).toEqual([]);
    input.facility.primaryEquipment.push("pool");
    expect(availableCardioModalities(input)).toEqual(["swimming"]);
  });

  it("preserves effort, timed intervals, goal role and phase without false cross-modality targets", () => {
    const before = structuredClone(prescription);
    const changed = createCardioModalityVariant(prescription, "cycling");
    expect(changed).toMatchObject({
      modality: "cycling",
      minutes: 30,
      intensity: "hard",
      role: "intervals",
      eventPhase: "specific",
      intervals: prescription.intervals,
      sessionRpe: prescription.sessionRpe,
    });
    expect(changed.targetDistance).toBeUndefined();
    expect(changed.paceTarget).toBeUndefined();
    expect(changed.heartRateBpm).toBeUndefined();
    expect(changed.segments?.map((segment) => segment.minutes)).toEqual([
      6, 6, 12, 6,
    ]);
    expect(
      changed.segments?.every(
        (segment) =>
          segment.distance === undefined && segment.distanceUnit === undefined,
      ),
    ).toBe(true);
    expect(
      changed.segments?.every(
        (segment) => !/run|jog|walk/i.test(segment.label),
      ),
    ).toBe(true);
    expect(prescription).toEqual(before);
  });

  it("keeps all original targets when the original activity is selected", () => {
    const same = createCardioModalityVariant(prescription, "running");
    expect(same).toEqual(prescription);
    expect(same).not.toBe(prescription);
    expect(isCardioModality("forged")).toBe(false);
  });
});
