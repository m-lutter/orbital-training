import { describe, expect, it } from "vitest";
import {
  heartRateReviewLogsForWeek,
  loadWeeklyHeartRateReview,
  matchRetrospectiveWorkouts,
  type HeartRateReviewWorkoutLog,
  type RetrospectiveWorkoutSummary,
} from "./retrospective-workouts";
import type { Database } from "$lib/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";

const log = (overrides: Partial<HeartRateReviewWorkoutLog> = {}) => ({
  id: "workout-log-1",
  label: "Day 1 · Squat",
  status: "completed",
  startedAt: "2026-08-25T15:00:00Z",
  completedAt: "2026-08-25T16:00:00Z",
  durationMinutes: 60,
  ...overrides,
});

const summary = (overrides: Partial<RetrospectiveWorkoutSummary> = {}) => ({
  id: "google-workout-1",
  connectionId: "google-connection-1",
  provider: "google_health",
  workoutType: "strength_training",
  startedAt: "2026-08-25T15:05:00Z",
  endedAt: "2026-08-25T15:58:00Z",
  ...overrides,
});

describe("retrospective workout heart-rate matching", () => {
  it("selects completed logs from exactly the requested week", () => {
    expect(
      heartRateReviewLogsForWeek({
        weekNumber: 2,
        sessions: [{ id: "session-2", sequence: 2, title: " Bench " }],
        logs: [
          {
            ...log(),
            sessionId: "session-1",
            sessionSequence: 1,
            weekNumber: 1,
          },
          {
            ...log({ id: "week-2" }),
            sessionId: "session-2",
            sessionSequence: 2,
            weekNumber: 2,
          },
          {
            ...log({ id: "unfinished", status: "in_progress" }),
            sessionId: "session-2",
            sessionSequence: 2,
            weekNumber: 2,
          },
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        id: "week-2",
        label: "Workout 2 · Bench",
        status: "completed",
      }),
    ]);
  });

  it("matches one uniquely overlapping Google strength workout", () => {
    expect(matchRetrospectiveWorkouts([log()], [summary()])).toEqual([
      { log: log(), summary: summary() },
    ]);
  });

  it("does not associate an unrelated exercise from time overlap alone", () => {
    expect(
      matchRetrospectiveWorkouts(
        [log()],
        [summary({ workoutType: "running" })],
      ),
    ).toEqual([]);
  });

  it("rejects weak overlap and incomplete Orbital logs", () => {
    expect(
      matchRetrospectiveWorkouts(
        [log(), log({ id: "in-progress", status: "in_progress" })],
        [
          summary({
            startedAt: "2026-08-25T15:45:00Z",
            endedAt: "2026-08-25T16:40:00Z",
          }),
        ],
      ),
    ).toEqual([]);
  });

  it("rejects ambiguous provider records instead of guessing", () => {
    expect(
      matchRetrospectiveWorkouts(
        [log()],
        [
          summary(),
          summary({
            id: "google-workout-duplicate",
            startedAt: "2026-08-25T15:06:00Z",
          }),
        ],
      ),
    ).toEqual([]);
  });

  it("honors an explicit provider identity with a bounded time sanity check", () => {
    const identified = summary({
      workoutType: "unknown",
      extensions: { orbitalWorkoutLogId: "workout-log-1" },
    });
    expect(matchRetrospectiveWorkouts([log()], [identified])).toEqual([
      { log: log(), summary: identified },
    ]);
    expect(
      matchRetrospectiveWorkouts(
        [log()],
        [
          {
            ...identified,
            startedAt: "2026-08-26T15:05:00Z",
            endedAt: "2026-08-26T15:58:00Z",
          },
        ],
      ),
    ).toEqual([]);
  });

  it("uses a bounded recorded duration for a stale workout page", () => {
    expect(
      matchRetrospectiveWorkouts(
        [
          log({
            startedAt: "2026-08-23T15:00:00Z",
            durationMinutes: 60,
          }),
        ],
        [summary()],
      ),
    ).toHaveLength(1);
  });
});

interface FakeResult {
  data: unknown;
  error: { code: string } | null;
}

interface RecordedCall {
  arguments: unknown[];
  method: string;
  table: string;
}

class FakeQuery {
  constructor(
    private readonly table: string,
    private readonly result: FakeResult,
    private readonly calls: RecordedCall[],
  ) {}

  private chain(method: string, arguments_: unknown[]): this {
    this.calls.push({ table: this.table, method, arguments: arguments_ });
    return this;
  }

  select(...arguments_: unknown[]) {
    return this.chain("select", arguments_);
  }

  eq(...arguments_: unknown[]) {
    return this.chain("eq", arguments_);
  }

  in(...arguments_: unknown[]) {
    return this.chain("in", arguments_);
  }

  gte(...arguments_: unknown[]) {
    return this.chain("gte", arguments_);
  }

  lte(...arguments_: unknown[]) {
    return this.chain("lte", arguments_);
  }

  or(...arguments_: unknown[]) {
    return this.chain("or", arguments_);
  }

  order(...arguments_: unknown[]) {
    return this.chain("order", arguments_);
  }

  limit(...arguments_: unknown[]) {
    return this.chain("limit", arguments_);
  }

  then<TResult1 = FakeResult, TResult2 = never>(
    onfulfilled?:
      ((value: FakeResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

describe("weekly heart-rate review loader", () => {
  it("uses completed log windows and works without provider summaries", async () => {
    const calls: RecordedCall[] = [];
    const results: Record<string, FakeResult> = {
      fitness_connections: {
        data: [
          {
            id: "google-connection-1",
            provider: "google_health",
            status: "active",
            last_synced_at: "2026-08-26T18:00:00Z",
          },
        ],
        error: null,
      },
      fitness_workout_summaries: {
        data: null,
        error: { code: "PGRST205" },
      },
      fitness_hr_5m: {
        data: [
          {
            connection_id: "google-connection-1",
            bucket_start: "2026-08-25T15:00:00Z",
            minimum_bpm: 100,
            maximum_bpm: 150,
            average_bpm: 125,
            sample_count: 20,
          },
          {
            connection_id: "google-connection-1",
            bucket_start: "2026-08-25T16:05:00Z",
            minimum_bpm: 80,
            maximum_bpm: 100,
            average_bpm: 90,
            sample_count: 20,
          },
        ],
        error: null,
      },
    };
    const client = {
      from(table: string) {
        return new FakeQuery(table, results[table], calls);
      },
    } as unknown as SupabaseClient<Database>;

    const review = await loadWeeklyHeartRateReview({
      client,
      userId: "user-1",
      workoutLogs: [
        log({
          startedAt: "2026-08-25T15:02:00Z",
          completedAt: "2026-08-25T16:00:00Z",
        }),
      ],
    });

    expect(review).toEqual({
      status: "ready",
      lastSyncedAt: "2026-08-26T18:00:00Z",
      workouts: [
        {
          id: "workout-log-1",
          label: "Day 1 · Squat",
          startedAt: "2026-08-25T15:02:00.000Z",
          endedAt: "2026-08-25T16:00:00.000Z",
          provider: "google_health",
          averageBpm: 125,
          maximumBpm: 150,
          buckets: [
            {
              bucketStart: "2026-08-25T15:00:00.000Z",
              averageBpm: 125,
              minimumBpm: 100,
              maximumBpm: 150,
              sampleCount: 20,
            },
          ],
        },
      ],
    });
    expect(
      calls.filter(
        (call) => call.table === "fitness_hr_5m" && call.method === "select",
      ),
    ).toHaveLength(1);
    expect(
      calls.find(
        (call) => call.table === "fitness_hr_5m" && call.method === "limit",
      )?.arguments,
    ).toEqual([970]);
  });

  it("keeps both partial edge buckets for an off-boundary eight-hour workout", async () => {
    const calls: RecordedCall[] = [];
    const bucketStart = Date.parse("2026-08-25T15:00:00Z");
    const results: Record<string, FakeResult> = {
      fitness_connections: {
        data: [
          {
            id: "google-connection-1",
            provider: "google_health",
            status: "active",
            last_synced_at: "2026-08-26T18:00:00Z",
          },
        ],
        error: null,
      },
      fitness_workout_summaries: { data: [], error: null },
      fitness_hr_5m: {
        data: Array.from({ length: 97 }, (_, index) => ({
          connection_id: "google-connection-1",
          bucket_start: new Date(
            bucketStart + index * 5 * 60_000,
          ).toISOString(),
          minimum_bpm: 100,
          maximum_bpm: 150,
          average_bpm: 125,
          sample_count: 20,
        })),
        error: null,
      },
    };
    const client = {
      from(table: string) {
        return new FakeQuery(table, results[table], calls);
      },
    } as unknown as SupabaseClient<Database>;

    const review = await loadWeeklyHeartRateReview({
      client,
      userId: "user-1",
      workoutLogs: [
        log({
          startedAt: "2026-08-25T15:02:00Z",
          completedAt: "2026-08-25T23:02:00Z",
          durationMinutes: 480,
        }),
      ],
    });

    expect(review.workouts[0]?.buckets).toHaveLength(97);
    expect(review.workouts[0]?.buckets.at(-1)?.bucketStart).toBe(
      "2026-08-25T23:00:00.000Z",
    );
  });

  it("returns unavailable instead of exposing a bucket query failure", async () => {
    const calls: RecordedCall[] = [];
    const results: Record<string, FakeResult> = {
      fitness_connections: {
        data: [
          {
            id: "google-connection-1",
            provider: "google_health",
            status: "active",
            last_synced_at: "2026-08-26T18:00:00Z",
          },
        ],
        error: null,
      },
      fitness_workout_summaries: { data: [], error: null },
      fitness_hr_5m: { data: null, error: { code: "57014" } },
    };
    const client = {
      from(table: string) {
        return new FakeQuery(table, results[table], calls);
      },
    } as unknown as SupabaseClient<Database>;

    await expect(
      loadWeeklyHeartRateReview({
        client,
        userId: "user-1",
        workoutLogs: [log()],
      }),
    ).resolves.toEqual({
      status: "unavailable",
      lastSyncedAt: "2026-08-26T18:00:00Z",
      workouts: [],
    });
  });
});
