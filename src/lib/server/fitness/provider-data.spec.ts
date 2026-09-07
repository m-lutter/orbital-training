import { describe, expect, it, vi } from "vitest";
import {
  fetchGoogleWorkoutHeartRate,
  fitnessSyncDateRange,
  parseGoogleHeartRateBuckets,
  parseGoogleHeartRateSamples,
  syncGoogleHealth,
} from "./provider-data";

describe("fitness provider normalization", () => {
  it("normalizes Google five-minute rollups without inventing sample counts", () => {
    expect(
      parseGoogleHeartRateBuckets([
        {
          startTime: "2026-08-25T15:00:00Z",
          endTime: "2026-08-25T15:05:00Z",
          heartRate: {
            beatsPerMinuteAvg: 121.5,
            beatsPerMinuteMin: 96,
            beatsPerMinuteMax: 148,
          },
        },
      ]),
    ).toEqual([
      {
        bucketStart: "2026-08-25T15:00:00.000Z",
        avgBpm: 121.5,
        minBpm: 96,
        maxBpm: 148,
      },
    ]);
  });

  it("drops malformed or physiologically invalid HR samples", () => {
    expect(
      parseGoogleHeartRateSamples([
        {
          dataPointName: "users/me/dataTypes/heart-rate/dataPoints/sample-1",
          heartRate: {
            sampleTime: { physicalTime: "2026-08-25T15:00:04Z" },
            beatsPerMinute: "132",
          },
        },
        {
          heartRate: {
            sampleTime: { physicalTime: "not-a-time" },
            beatsPerMinute: 500,
          },
        },
      ]),
    ).toEqual([
      {
        sampledAt: "2026-08-25T15:00:04.000Z",
        bpm: 132,
        sourceRecordId: "users/me/dataTypes/heart-rate/dataPoints/sample-1",
      },
    ]);
  });

  it("sorts and deduplicates detailed samples before database batching", () => {
    expect(
      parseGoogleHeartRateSamples([
        {
          dataPointName: "later",
          heartRate: {
            sampleTime: { physicalTime: "2026-08-25T15:00:10Z" },
            beatsPerMinute: 140,
          },
        },
        {
          dataPointName: "earlier",
          heartRate: {
            sampleTime: { physicalTime: "2026-08-25T15:00:05Z" },
            beatsPerMinute: 110,
          },
        },
        {
          dataPointName: "later-reconciled",
          heartRate: {
            sampleTime: { physicalTime: "2026-08-25T15:00:10Z" },
            beatsPerMinute: 141,
          },
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        sampledAt: "2026-08-25T15:00:05.000Z",
        bpm: 110,
      }),
      expect.objectContaining({
        sampledAt: "2026-08-25T15:00:10.000Z",
        bpm: 141,
        sourceRecordId: "later-reconciled",
      }),
    ]);
  });

  it("covers the current review week in a bounded catch-up window", () => {
    expect(fitnessSyncDateRange("2026-08-25")).toEqual({
      startDate: "2026-08-18",
      endDate: "2026-08-26",
    });
  });

  it("uses Google Health's documented snake-case filter field paths", async () => {
    const requested: URL[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      requested.push(url);
      return new Response(
        JSON.stringify(
          url.pathname.endsWith(":reconcile")
            ? { dataPoints: [] }
            : { rollupDataPoints: [] },
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    await syncGoogleHealth({
      accessToken: "token",
      startDate: "2026-08-18",
      endDate: "2026-08-26",
      timeZone: "America/Chicago",
      now: new Date("2026-08-25T18:00:00Z"),
      fetcher: fetcher as typeof fetch,
    });
    await fetchGoogleWorkoutHeartRate({
      accessToken: "token",
      startTime: "2026-08-25T15:00:00Z",
      endTime: "2026-08-25T16:00:00Z",
      fetcher: fetcher as typeof fetch,
    });

    const filters = requested
      .map((url) => url.searchParams.get("filter"))
      .filter((value): value is string => value !== null);
    expect(filters).toEqual(
      expect.arrayContaining([
        'daily_resting_heart_rate.date >= "2026-08-18" AND daily_resting_heart_rate.date < "2026-08-26"',
        'daily_heart_rate_variability.date >= "2026-08-18" AND daily_heart_rate_variability.date < "2026-08-26"',
        'sleep.interval.civil_end_time >= "2026-08-18" AND sleep.interval.civil_end_time < "2026-08-26"',
        'exercise.interval.civil_start_time >= "2026-08-18" AND exercise.interval.civil_start_time < "2026-08-26"',
        'heart_rate.sample_time.physical_time >= "2026-08-25T15:00:00Z" AND heart_rate.sample_time.physical_time < "2026-08-25T16:00:00Z"',
      ]),
    );
  });

  it("paginates the eight-day heart-rate rollup", async () => {
    const rollupBodies: Array<Record<string, unknown>> = [];
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        const isHeartRateRollup =
          url.pathname.includes("/heart-rate/") &&
          url.pathname.endsWith(":rollUp");
        if (!isHeartRateRollup) {
          return new Response(
            JSON.stringify(
              url.pathname.endsWith(":reconcile")
                ? { dataPoints: [] }
                : { rollupDataPoints: [] },
            ),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        rollupBodies.push(body);
        const pageToken = body.pageToken;
        return new Response(
          JSON.stringify({
            rollupDataPoints: [
              {
                startTime:
                  pageToken === undefined
                    ? "2026-08-18T18:00:00Z"
                    : "2026-08-18T18:05:00Z",
                heartRate: {
                  beatsPerMinuteAvg: 120,
                  beatsPerMinuteMin: 100,
                  beatsPerMinuteMax: 140,
                },
              },
            ],
            ...(pageToken === undefined ? { nextPageToken: "next-page" } : {}),
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    );

    const result = await syncGoogleHealth({
      accessToken: "token",
      startDate: "2026-08-18",
      endDate: "2026-08-26",
      timeZone: "America/Chicago",
      now: new Date("2026-08-26T18:00:00Z"),
      fetcher: fetcher as typeof fetch,
    });

    expect(rollupBodies).toEqual([
      expect.objectContaining({
        range: {
          startTime: "2026-08-18T18:00:00.000Z",
          endTime: "2026-08-26T18:00:00.000Z",
        },
      }),
      expect.objectContaining({ pageToken: "next-page" }),
    ]);
    expect(result.heartRateBuckets).toHaveLength(2);
  });
});
