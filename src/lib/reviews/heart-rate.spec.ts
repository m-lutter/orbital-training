import { describe, expect, it } from "vitest";
import {
  weeklyHeartRateOverlayModel,
  type WeeklyHeartRateWorkout,
} from "./heart-rate";

function workout(
  id: string,
  overrides: Partial<WeeklyHeartRateWorkout> = {},
): WeeklyHeartRateWorkout {
  return {
    id,
    label: `Workout ${id}`,
    startedAt: "2026-08-25T10:00:00Z",
    endedAt: "2026-08-25T11:00:00Z",
    buckets: [],
    ...overrides,
  };
}

function xValues(points: string): number[] {
  return points.split(" ").map((point) => Number(point.split(",")[0]));
}

describe("weekly heart-rate overlay model", () => {
  it("aligns the same relative progress across different workout durations", () => {
    const model = weeklyHeartRateOverlayModel([
      workout("short", {
        endedAt: "2026-08-25T11:00:00Z",
        buckets: [
          {
            bucketStart: "2026-08-25T10:12:30Z",
            averageBpm: 120,
          },
          {
            bucketStart: "2026-08-25T10:18:30Z",
            averageBpm: 130,
          },
        ],
      }),
      workout("long", {
        endedAt: "2026-08-25T12:00:00Z",
        buckets: [
          {
            bucketStart: "2026-08-25T10:27:30Z",
            averageBpm: 125,
          },
          {
            bucketStart: "2026-08-25T10:33:30Z",
            averageBpm: 135,
          },
        ],
      }),
    ]);

    const short = model.series.find((series) => series.workout.id === "short")!;
    const long = model.series.find((series) => series.workout.id === "long")!;
    expect(short.durationMinutes).toBe(60);
    expect(long.durationMinutes).toBe(120);
    expect(xValues(short.segments[0].averagePoints)[0]).toBeCloseTo(26, 2);
    expect(xValues(long.segments[0].averagePoints)[0]).toBeCloseTo(26, 2);
  });

  it("clamps overlapping edge buckets without expanding the logged duration", () => {
    const model = weeklyHeartRateOverlayModel([
      workout("edges", {
        startedAt: "2026-08-25T10:04:00Z",
        endedAt: "2026-08-25T10:31:00Z",
        buckets: [
          {
            bucketStart: "2026-08-25T09:55:00Z",
            averageBpm: 90,
          },
          {
            bucketStart: "2026-08-25T10:00:00Z",
            averageBpm: 100,
          },
          {
            bucketStart: "2026-08-25T10:30:00Z",
            averageBpm: 150,
          },
          {
            bucketStart: "2026-08-25T10:31:00Z",
            averageBpm: 170,
          },
        ],
      }),
    ]);

    const series = model.series[0];
    const points = series.segments.flatMap((segment) =>
      xValues(segment.averagePoints),
    );
    expect(series.bucketCount).toBe(2);
    expect(points).toEqual([2, 98]);
  });

  it("preserves missing-data gaps instead of connecting them", () => {
    const model = weeklyHeartRateOverlayModel([
      workout("gaps", {
        buckets: [
          { bucketStart: "2026-08-25T10:05:00Z", averageBpm: 110 },
          { bucketStart: "2026-08-25T10:10:00Z", averageBpm: 120 },
          { bucketStart: "2026-08-25T10:30:00Z", averageBpm: 140 },
          { bucketStart: "2026-08-25T10:35:00Z", averageBpm: 145 },
        ],
      }),
    ]);

    expect(model.series[0].segments).toHaveLength(2);
    expect(
      model.series[0].segments.map((segment) => segment.pointCount),
    ).toEqual([2, 2]);
  });

  it("keeps buckets ten minutes apart in one contiguous segment", () => {
    const model = weeklyHeartRateOverlayModel([
      workout("contiguous", {
        buckets: [
          { bucketStart: "2026-08-25T10:05:00Z", averageBpm: 110 },
          { bucketStart: "2026-08-25T10:15:00Z", averageBpm: 130 },
        ],
      }),
    ]);

    expect(model.series[0].segments).toHaveLength(1);
    expect(model.series[0].segments[0].pointCount).toBe(2);
  });

  it("keeps a single point as its own marker segment", () => {
    const model = weeklyHeartRateOverlayModel([
      workout("single", {
        buckets: [{ bucketStart: "2026-08-25T10:20:00Z", averageBpm: 135 }],
      }),
    ]);

    const segment = model.series[0].segments[0];
    expect(segment.pointCount).toBe(1);
    expect(segment.averagePoints.split(" ")).toHaveLength(1);
    expect(segment.endPoint.x).toBeCloseTo(38, 2);
  });

  it("keeps invalid-duration data summary-only and out of the visible y-domain", () => {
    const model = weeklyHeartRateOverlayModel([
      workout("plotted", {
        buckets: [
          { bucketStart: "2026-08-25T10:05:00Z", averageBpm: 100 },
          { bucketStart: "2026-08-25T10:10:00Z", averageBpm: 110 },
        ],
      }),
      workout("summary", {
        startedAt: "2026-08-25T12:00:00Z",
        endedAt: "2026-08-25T12:00:00Z",
        averageBpm: 200,
        maximumBpm: 260,
        buckets: [{ bucketStart: "2026-08-25T12:00:00Z", averageBpm: 250 }],
      }),
    ]);

    const summary = model.series.find(
      (series) => series.workout.id === "summary",
    )!;
    expect(summary.durationMinutes).toBeUndefined();
    expect(summary.segments).toHaveLength(0);
    expect(summary.averageBpm).toBe(200);
    expect(summary.maximumBpm).toBe(260);
    expect(model.domain).toEqual({ minimumBpm: 90, maximumBpm: 120 });
  });

  it("resolves hash collisions consistently regardless of input order", () => {
    const firstBySlot = new Map<number, string>();
    let collision: [string, string] | undefined;
    for (let index = 0; index < 200 && collision === undefined; index += 1) {
      const id = `identity-${index}`;
      const slot = weeklyHeartRateOverlayModel([workout(id)]).series[0].style
        .slot;
      const previous = firstBySlot.get(slot);
      if (previous !== undefined) collision = [previous, id];
      else firstBySlot.set(slot, id);
    }
    expect(collision).toBeDefined();
    const identities = collision!;
    const forward = weeklyHeartRateOverlayModel(
      identities.map((id) => workout(id)),
    );
    const reversed = weeklyHeartRateOverlayModel(
      identities.toReversed().map((id) => workout(id)),
    );
    const forwardSlots = Object.fromEntries(
      forward.series.map((series) => [series.workout.id, series.style.slot]),
    );
    const reversedSlots = Object.fromEntries(
      reversed.series.map((series) => [series.workout.id, series.style.slot]),
    );

    expect(new Set(Object.values(forwardSlots)).size).toBe(2);
    expect(reversedSlots).toEqual(forwardSlots);
    const nonColorIdentities = forward.series.map(
      (series) => `${series.style.dashIndex}:${series.style.marker}`,
    );
    expect(new Set(nonColorIdentities).size).toBe(2);
  });
});
