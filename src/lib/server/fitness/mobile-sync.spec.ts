import { describe, expect, it } from "vitest";
import {
  normalizeMobileSync,
  mobileConsentScopes,
  parseMobileConnectionRequest,
  parseMobileSyncEnvelope,
} from "./mobile-sync";

function envelope(records: unknown[]) {
  return {
    schemaVersion: 1,
    syncRunId: "health-run-1",
    trigger: "foreground_catch_up",
    userId: "advisory-only",
    provider: "apple_healthkit",
    timeZone: "America/Chicago",
    batch: { index: 0, count: 1 },
    permissions: {
      read: { steps: true, heart_rate: true },
      writeCompletedWorkouts: false,
      allowBackgroundRead: false,
      allowHistoryOlderThan30Days: false,
    },
    records,
    deletions: [],
  };
}

describe("mobile health sync", () => {
  it("accepts an explicit, bounded device connection request", () => {
    expect(
      parseMobileConnectionRequest({
        schemaVersion: 1,
        provider: "apple_healthkit",
        permissions: envelope([]).permissions,
      }),
    ).toEqual({
      provider: "apple_healthkit",
      permissions: {
        readScopes: ["steps", "heart_rate"],
        writeCompletedWorkouts: false,
        allowBackgroundRead: false,
        allowHistoryOlderThan30Days: false,
      },
    });
  });

  it("derives complete device consent scopes from the saved selection", () => {
    expect(
      mobileConsentScopes({
        readScopes: ["steps", "heart_rate"],
        writeCompletedWorkouts: true,
        allowBackgroundRead: false,
        allowHistoryOlderThan30Days: false,
      }),
    ).toEqual(["read:steps", "read:heart_rate", "write:completed_workouts"]);
  });

  it("aggregates daily steps and five-minute HR while retaining active samples", () => {
    const parsed = parseMobileSyncEnvelope(
      envelope([
        {
          schemaVersion: 1,
          kind: "steps",
          sourceRecordId: "steps-1",
          startAt: "2026-08-25T12:00:00Z",
          endAt: "2026-08-25T12:10:00Z",
          source: { origin: "apple_healthkit" },
          value: 5500,
          unit: "count",
        },
        {
          schemaVersion: 1,
          kind: "heart_rate",
          sourceRecordId: "hr-1",
          startAt: "2026-08-25T12:01:00Z",
          endAt: "2026-08-25T12:01:00Z",
          source: { origin: "apple_healthkit" },
          value: 120,
          unit: "bpm",
        },
        {
          schemaVersion: 1,
          kind: "heart_rate",
          sourceRecordId: "hr-2",
          startAt: "2026-08-25T12:04:00Z",
          endAt: "2026-08-25T12:04:00Z",
          source: { origin: "apple_healthkit" },
          value: 140,
          unit: "bpm",
        },
      ]),
    );
    expect(parsed).toBeDefined();
    const normalized = normalizeMobileSync(parsed!, {
      id: "capture-1",
      sourceSessionKey: "program-1:session-1",
      startedAt: "2026-08-25T12:00:00Z",
    });
    expect(normalized.metrics[0]?.steps).toBe(5500);
    expect(normalized.buckets[0]).toMatchObject({
      avgBpm: 130,
      minBpm: 120,
      maxBpm: 140,
      sampleCount: 2,
    });
    expect(normalized.rawSamples).toHaveLength(2);
    expect(normalized.rawSamples[0]?.sourceSessionKey).toBe(
      "program-1:session-1",
    );
  });

  it("preserves native provider statistics for five-minute HR buckets", () => {
    const parsed = parseMobileSyncEnvelope(
      envelope([
        {
          schemaVersion: 1,
          kind: "heart_rate_bucket",
          sourceRecordId: "aggregate:heart-rate:2026-08-25T12:00:00Z",
          startAt: "2026-08-25T12:00:00Z",
          endAt: "2026-08-25T12:05:00Z",
          source: { origin: "apple_healthkit" },
          averageBpm: 132.5,
          minimumBpm: 118,
          maximumBpm: 149,
          sampleCount: 42,
          unit: "bpm",
        },
      ]),
    );

    expect(parsed).toBeDefined();
    expect(normalizeMobileSync(parsed!).buckets).toEqual([
      {
        bucketStart: "2026-08-25T12:00:00.000Z",
        avgBpm: 132.5,
        minBpm: 118,
        maxBpm: 149,
        sampleCount: 42,
      },
    ]);
  });

  it("attributes a complete overnight sleep episode to its wake date", () => {
    const parsed = parseMobileSyncEnvelope(
      envelope([
        {
          schemaVersion: 1,
          kind: "sleep",
          sourceRecordId: "sleep-stage-1",
          startAt: "2026-08-26T04:00:00Z",
          endAt: "2026-08-26T06:00:00Z",
          source: { origin: "apple_healthkit" },
          stage: "asleep_core",
        },
        {
          schemaVersion: 1,
          kind: "sleep",
          sourceRecordId: "sleep-stage-2",
          startAt: "2026-08-26T06:00:00Z",
          endAt: "2026-08-26T12:00:00Z",
          source: { origin: "apple_healthkit" },
          stage: "asleep_deep",
        },
      ]),
    );

    expect(normalizeMobileSync(parsed!).metrics).toEqual([
      expect.objectContaining({
        metricDate: "2026-08-26",
        sleepStartAt: "2026-08-26T04:00:00.000Z",
        sleepEndAt: "2026-08-26T12:00:00.000Z",
        sleepMinutes: 480,
      }),
    ]);
  });

  it("rejects a source that does not match the authenticated device provider", () => {
    expect(
      parseMobileSyncEnvelope(
        envelope([
          {
            schemaVersion: 1,
            kind: "steps",
            sourceRecordId: "spoofed",
            startAt: "2026-08-25T12:00:00Z",
            endAt: "2026-08-25T12:01:00Z",
            source: { origin: "android_health_connect" },
            value: 10,
          },
        ]),
      ),
    ).toBeUndefined();
  });

  it("accepts only a valid active-workout timestamp as the workout signal", () => {
    const valid = {
      ...envelope([]),
      activeWorkout: {
        startedAt: "2026-08-25T12:00:00Z",
        sourceSessionKey: "program-1:session-1",
      },
    };
    const invalid = {
      ...envelope([]),
      activeWorkout: { startedAt: "not-a-date" },
    };

    expect(parseMobileSyncEnvelope(valid)?.activeWorkout).toBe(true);
    expect(parseMobileSyncEnvelope(valid)?.activeWorkoutSourceSessionKey).toBe(
      "program-1:session-1",
    );
    expect(parseMobileSyncEnvelope(invalid)?.activeWorkout).toBe(false);
  });

  it("retains only bounded, recognized native deletion identities", () => {
    const parsed = parseMobileSyncEnvelope({
      ...envelope([]),
      deletions: [
        { kind: "heart_rate", sourceRecordId: "deleted-hr-sample" },
        { kind: "workout", sourceRecordId: "deleted-workout" },
      ],
    });
    expect(parsed?.deletions).toEqual([
      { kind: "heart_rate", sourceRecordId: "deleted-hr-sample" },
      { kind: "workout", sourceRecordId: "deleted-workout" },
    ]);
  });
});
