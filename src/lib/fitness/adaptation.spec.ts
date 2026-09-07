import { describe, expect, it } from "vitest";
import {
  summarizeWearableAdaptation,
  type WearableMetricRow,
} from "./adaptation";

function rows(values: Array<[string, number, number]>): WearableMetricRow[] {
  return values.map(([metricDate, sleepMinutes, restingHeartRateBpm]) => ({
    connectionId: "connection-1",
    provider: "apple_health",
    metricDate,
    sleepMinutes,
    restingHeartRateBpm,
    heartRateVariabilityMs: null,
  }));
}

describe("wearable adaptation summary", () => {
  it("flags only a sufficiently observed week-vs-baseline recovery change", () => {
    const baseline = Array.from(
      { length: 7 },
      (_, index) =>
        [`2026-08-${String(index + 4).padStart(2, "0")}`, 480, 55] as [
          string,
          number,
          number,
        ],
    );
    const current = Array.from(
      { length: 4 },
      (_, index) =>
        [`2026-08-${String(index + 18).padStart(2, "0")}`, 390, 62] as [
          string,
          number,
          number,
        ],
    );
    const summary = summarizeWearableAdaptation({
      rows: rows([...baseline, ...current]),
      weekStart: "2026-08-18",
      weekEnd: "2026-08-24",
    });
    expect(summary).toMatchObject({
      source: "Apple Health",
      caution: true,
      averageSleepMinutes: 390,
      baselineSleepMinutes: 480,
      averageRestingHeartRateBpm: 62,
      baselineRestingHeartRateBpm: 55,
    });
    expect(summary?.reasons).toHaveLength(2);
  });

  it("does not infer a trend from too few current days", () => {
    const summary = summarizeWearableAdaptation({
      rows: rows([
        ["2026-08-04", 480, 55],
        ["2026-08-05", 480, 55],
        ["2026-08-06", 480, 55],
        ["2026-08-07", 480, 55],
        ["2026-08-08", 480, 55],
        ["2026-08-18", 300, 70],
      ]),
      weekStart: "2026-08-18",
      weekEnd: "2026-08-24",
    });
    expect(summary?.caution).toBe(false);
    expect(summary?.reasons).toEqual([]);
  });
});
