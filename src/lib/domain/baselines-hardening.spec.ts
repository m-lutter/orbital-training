import { describe, expect, it } from "vitest";
import {
  baselineForLift,
  calculateBaselines,
  estimateE1rm,
} from "./baselines.js";
import type { PerformanceObservation } from "./types.js";
import { meetPowerlifterInput } from "./tests/fixtures.js";

const observation: PerformanceObservation = {
  load: 100,
  reps: 5,
  rir: 2,
  date: "2026-08-25",
  completed: true,
  stableTechnique: true,
};

describe("conservative baseline evidence", () => {
  it("rejects nonfinite, nonpositive or internally contradictory observations", () => {
    for (const load of [0, -10, Number.NaN, Number.POSITIVE_INFINITY])
      expect(estimateE1rm({ ...observation, load })).toBeUndefined();
    expect(estimateE1rm({ ...observation, reps: 1.5 })).toBeUndefined();
    expect(estimateE1rm({ ...observation, rir: Number.NaN })).toBeUndefined();
    expect(estimateE1rm({ ...observation, rpe: 4 })).toBeUndefined();
  });

  it("rejects future, stale and invalid calendar dates relative to the explicit planning date", () => {
    for (const date of [
      "2026-09-03",
      "2026-01-01",
      "2026-02-30",
      "not-a-date",
    ]) {
      expect(
        baselineForLift(
          "squat",
          [{ ...observation, date: date as PerformanceObservation["date"] }],
          "2026-09-02",
        ),
      ).toMatchObject({
        confidence: "low",
        source: "calibration_required",
        observationCount: 0,
      });
    }
  });

  it("uses the questionnaire as-of date rather than the machine clock", () => {
    const input = meetPowerlifterInput();
    input.asOfDate = "2026-08-20";
    input.powerlifting!.observations.squat = [observation];
    expect(
      calculateBaselines(input).find((item) => item.lift === "squat")?.source,
    ).toBe("calibration_required");
  });

  it("requires agreement and recent higher-quality evidence for high confidence", () => {
    const agreeing: PerformanceObservation[] = [
      observation,
      { ...observation, load: 102, date: "2026-08-20" },
    ];
    expect(baselineForLift("squat", agreeing, "2026-09-02").confidence).toBe(
      "high",
    );
    expect(baselineForLift("squat", agreeing, "2026-10-20").confidence).toBe(
      "moderate",
    );
  });

  it("does not call repeated sets from one dated session high-confidence independent evidence", () => {
    expect(
      baselineForLift(
        "squat",
        [observation, { ...observation, load: 102 }],
        "2026-09-02",
      ).confidence,
    ).toBe("moderate");
  });

  it("treats RPE-derived RIR quality the same as directly reported RIR", () => {
    const lowQuality: PerformanceObservation[] = [
      { ...observation, rir: undefined, rpe: 6 },
      { ...observation, date: "2026-08-20", rir: undefined, rpe: 6 },
    ];
    expect(baselineForLift("squat", lowQuality, "2026-09-02").confidence).toBe(
      "moderate",
    );
  });

  it("does not let a lone recent outlier override two agreeing observations", () => {
    const result = baselineForLift(
      "squat",
      [
        { ...observation, load: 300, date: "2026-09-01" },
        observation,
        { ...observation, load: 102, date: "2026-08-20" },
      ],
      "2026-09-02",
    );
    expect(result.e1rm).toBeLessThan(130);
    expect(result.confidence).toBe("moderate");
    expect(result.observationCount).toBe(2);
  });

  it("returns a conservative low-confidence estimate for two conflicting observations", () => {
    const result = baselineForLift(
      "squat",
      [observation, { ...observation, load: 200 }],
      "2026-09-02",
    );
    expect(result.confidence).toBe("low");
    expect(result.e1rm).toBeCloseTo(123.3, 1);
  });
});
