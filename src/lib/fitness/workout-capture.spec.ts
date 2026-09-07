import { describe, expect, it } from "vitest";
import {
  capturePhase,
  heartRateZoneForBpm,
  heartRateZones,
  heartRateChartModel,
  heartRatePoints,
  parseWorkoutCaptureStart,
  parseWorkoutHeartRateContract,
  mergeWorkoutHeartRateContracts,
  readWorkoutCaptureCache,
  workoutCaptureStorageKey,
  writeWorkoutCaptureCache,
  WORKOUT_CAPTURE_POLL_MS,
} from "./workout-capture";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

describe("workout capture state", () => {
  it("uses a five-second visible-page telemetry cadence", () => {
    expect(WORKOUT_CAPTURE_POLL_MS).toBe(5_000);
  });

  it("round-trips a provider-neutral capture across page instances", () => {
    const storage = new MemoryStorage();
    const key = workoutCaptureStorageKey("program-1", "session-1");
    writeWorkoutCaptureCache(storage, key, {
      schemaVersion: 1,
      workoutSessionId: "capture-1",
      status: "recording",
      startedAt: "2026-08-25T10:00:00Z",
      endedAt: null,
    });
    expect(readWorkoutCaptureCache(storage, key)).toMatchObject({
      workoutSessionId: "capture-1",
      status: "recording",
    });
    expect(capturePhase("recording")).toBe("active");
    expect(capturePhase("completed")).toBe("complete");
  });

  it("keeps only the expected companion deep-link scheme", () => {
    expect(
      parseWorkoutCaptureStart({
        workoutSessionId: "capture-1",
        status: "active",
        startedAt: "2026-08-25T10:00:00Z",
        mobileDeepLink:
          "orbitalhealth://workout?programId=program-1&sessionId=session-1",
      })?.mobileDeepLink,
    ).toContain("orbitalhealth://workout");
    expect(
      parseWorkoutCaptureStart({
        workoutSessionId: "capture-1",
        status: "active",
        startedAt: "2026-08-25T10:00:00Z",
        mobileDeepLink: "https://example.test/unsafe",
      })?.mobileDeepLink,
    ).toBeUndefined();
  });

  it("uses summary buckets when raw telemetry is unavailable", () => {
    const parsed = parseWorkoutHeartRateContract({
      workoutSessionId: "capture-1",
      status: "completed",
      startedAt: "2026-08-25T10:00:00Z",
      endedAt: "2026-08-25T11:00:00Z",
      samples: [{ recordedAt: "bad", bpm: 900 }],
      buckets: [
        {
          bucketStart: "2026-08-25T10:05:00Z",
          avgBpm: 130,
          minBpm: 120,
          maxBpm: 145,
          sampleCount: 15,
        },
        {
          bucketStart: "2026-08-25T10:00:00Z",
          avgBpm: 110,
          minBpm: 100,
          maxBpm: 125,
          sampleCount: 12,
        },
      ],
    });
    expect(parsed?.samples).toEqual([]);
    expect(heartRatePoints(parsed!)).toEqual([
      expect.objectContaining({ bpm: 110 }),
      expect.objectContaining({ bpm: 130 }),
    ]);
    expect(heartRateChartModel(heartRatePoints(parsed!))).toMatchObject({
      minimumBpm: 100,
      maximumBpm: 145,
      averageBpm: 121,
      sampleCount: 27,
    });
  });

  it("prefers precise raw samples over five-minute buckets", () => {
    const parsed = parseWorkoutHeartRateContract({
      workoutSessionId: "capture-1",
      status: "completed",
      startedAt: "2026-08-25T10:00:00Z",
      endedAt: "2026-08-25T10:05:00Z",
      samples: [
        { recordedAt: "2026-08-25T10:00:30Z", bpm: 101 },
        { recordedAt: "2026-08-25T10:01:00Z", bpm: 137 },
        { recordedAt: "2026-08-25T10:01:30Z", bpm: 119 },
      ],
      buckets: [
        {
          bucketStart: "2026-08-25T10:00:00Z",
          avgBpm: 160,
          minBpm: 150,
          maxBpm: 170,
          sampleCount: 120,
        },
      ],
    });

    expect(heartRatePoints(parsed!)).toEqual([
      expect.objectContaining({ bpm: 101, sampleCount: 1 }),
      expect.objectContaining({ bpm: 137, sampleCount: 1 }),
      expect.objectContaining({ bpm: 119, sampleCount: 1 }),
    ]);
    expect(heartRateChartModel(heartRatePoints(parsed!))).toMatchObject({
      minimumBpm: 101,
      maximumBpm: 137,
      averageBpm: 119,
      sampleCount: 3,
    });
  });

  it("merges bounded deltas and never regresses a completed capture", () => {
    const initial = parseWorkoutHeartRateContract({
      workoutSessionId: "capture-1",
      status: "active",
      startedAt: "2026-08-25T10:00:00Z",
      endedAt: null,
      checkedAt: "2026-08-25T10:00:05Z",
      isDelta: true,
      samples: [{ recordedAt: "2026-08-25T10:00:02Z", bpm: 100 }],
      buckets: [],
    })!;
    const delta = parseWorkoutHeartRateContract({
      workoutSessionId: "capture-1",
      status: "active",
      startedAt: "2026-08-25T10:00:00Z",
      endedAt: null,
      checkedAt: "2026-08-25T10:00:10Z",
      isDelta: true,
      samples: [
        { recordedAt: "2026-08-25T10:00:02Z", bpm: 100 },
        { recordedAt: "2026-08-25T10:00:07Z", bpm: 140 },
      ],
      buckets: [],
    })!;
    const completed = parseWorkoutHeartRateContract({
      workoutSessionId: "capture-1",
      status: "complete",
      startedAt: "2026-08-25T10:00:00Z",
      endedAt: "2026-08-25T10:00:12Z",
      samples: [],
      buckets: [],
    })!;
    const merged = mergeWorkoutHeartRateContracts(initial, delta);
    expect(merged.samples).toEqual([
      { recordedAt: "2026-08-25T10:00:02Z", bpm: 100 },
      { recordedAt: "2026-08-25T10:00:07Z", bpm: 140 },
    ]);
    const ended = mergeWorkoutHeartRateContracts(merged, completed);
    expect(ended.status).toBe("complete");
    expect(ended.samples).toHaveLength(2);
    const staleActive = mergeWorkoutHeartRateContracts(ended, delta);
    expect(staleActive.status).toBe("complete");
    expect(staleActive.endedAt).toBe("2026-08-25T10:00:12Z");
  });

  it("calculates accessible zones only from a saved maximum", () => {
    expect(heartRateZones(null)).toEqual([]);
    const zones = heartRateZones({
      maximumHeartRateBpm: 200,
      method: "percent_max",
    });
    expect(zones).toHaveLength(5);
    expect(zones[2]).toMatchObject({
      label: "Zone 3",
      minimumBpm: 140,
      maximumBpm: 159,
    });
    expect(heartRateZoneForBpm(zones, 145)?.key).toBe("z3");
  });

  it("keeps a one-sample marker and separates long telemetry gaps", () => {
    const one = heartRateChartModel([
      {
        recordedAt: "2026-08-25T10:00:05Z",
        bpm: 120,
        minBpm: 120,
        maxBpm: 120,
        sampleCount: 1,
      },
    ]);
    expect(one).toMatchObject({
      latestBpm: 120,
      polylines: [expect.any(String)],
    });
    const separated = heartRateChartModel([
      {
        recordedAt: "2026-08-25T10:00:00Z",
        bpm: 100,
        minBpm: 100,
        maxBpm: 100,
        sampleCount: 1,
      },
      {
        recordedAt: "2026-08-25T10:00:05Z",
        bpm: 105,
        minBpm: 105,
        maxBpm: 105,
        sampleCount: 1,
      },
      {
        recordedAt: "2026-08-25T10:05:00Z",
        bpm: 130,
        minBpm: 130,
        maxBpm: 130,
        sampleCount: 1,
      },
    ]);
    expect(separated?.polylines).toHaveLength(2);
  });
});
