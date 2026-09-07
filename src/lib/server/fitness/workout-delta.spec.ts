import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  fitnessServiceClient: vi.fn(),
}));

vi.mock("./repository", () => ({
  claimFitnessSync: vi.fn(),
  completeFitnessSync: vi.fn(),
  failFitnessSync: vi.fn(),
  fitnessServiceClient: mocked.fitnessServiceClient,
  ingestHeartRateSamples: vi.fn(),
  listFitnessConnections: vi.fn(),
  loadFitnessTokens: vi.fn(),
}));

import {
  WORKOUT_TELEMETRY_DELTA_LIMIT,
  workoutTelemetryDelta,
} from "./workout";

function queryBuilder(rows: Array<{ bpm: number; sampled_at: string }>) {
  const builder: Record<string, ReturnType<typeof vi.fn>> & {
    then?: Promise<unknown>["then"];
  } = {};
  for (const method of ["select", "eq", "lte", "order", "limit", "gte", "gt"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.then = (resolve, reject) =>
    Promise.resolve({ data: rows, error: null }).then(resolve, reject);
  return builder;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("live workout telemetry delta", () => {
  it("uses an exclusive cursor and hard response cap", async () => {
    const rows = Array.from(
      { length: WORKOUT_TELEMETRY_DELTA_LIMIT + 1 },
      (_, index) => ({
        sampled_at: new Date(
          Date.parse("2026-08-26T17:00:01Z") + index * 1000,
        ).toISOString(),
        bpm: 100 + (index % 20),
      }),
    );
    const builder = queryBuilder(rows);
    mocked.fitnessServiceClient.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const telemetry = await workoutTelemetryDelta({
      after: "2026-08-26T17:00:00Z",
      config: {} as never,
      connectionId: "00000000-0000-4000-8000-000000000001",
      endedAt: null,
      sourceSessionKey: "program-1:workout-1",
      startedAt: "2026-08-26T16:55:00Z",
      userId: "00000000-0000-4000-8000-000000000003",
      workoutSessionId: "00000000-0000-4000-8000-000000000004",
    });

    expect(builder.gt).toHaveBeenCalledWith(
      "sampled_at",
      "2026-08-26T17:00:00.000Z",
    );
    expect(builder.limit).toHaveBeenCalledWith(
      WORKOUT_TELEMETRY_DELTA_LIMIT + 1,
    );
    expect(telemetry).toMatchObject({
      isDelta: true,
      hasMore: true,
      status: "active",
    });
    expect(telemetry.samples).toHaveLength(WORKOUT_TELEMETRY_DELTA_LIMIT);
  });

  it("starts an initial read at the capture boundary", async () => {
    const builder = queryBuilder([]);
    mocked.fitnessServiceClient.mockReturnValue({
      from: vi.fn(() => builder),
    });

    await workoutTelemetryDelta({
      config: {} as never,
      connectionId: "00000000-0000-4000-8000-000000000001",
      endedAt: null,
      sourceSessionKey: "program-1:workout-1",
      startedAt: "2026-08-26T16:55:00Z",
      userId: "00000000-0000-4000-8000-000000000003",
      workoutSessionId: "00000000-0000-4000-8000-000000000004",
    });

    expect(builder.gte).toHaveBeenCalledWith(
      "sampled_at",
      "2026-08-26T16:55:00.000Z",
    );
    expect(builder.gt).not.toHaveBeenCalled();
  });
});
