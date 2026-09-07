import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  deferFitnessTask: vi.fn(),
  listFitnessConnections: vi.fn(),
  pollWorkoutHeartRate: vi.fn(),
  workoutTelemetryDelta: vi.fn(),
}));

vi.mock("$lib/server/fitness/config", () => ({
  fitnessConfigurationStatus: () => ({ baseConfigured: true }),
  fitnessRuntimeConfig: () => ({}),
}));

vi.mock("$lib/server/fitness/http", () => ({
  deferFitnessTask: mocked.deferFitnessTask,
  fitnessJsonErrorBoundary: async (
    _name: string,
    _fallback: string,
    operation: () => Promise<Response>,
  ) => operation(),
  requiredShortString: (value: unknown) => String(value),
  settleFitnessTask: vi.fn(),
}));

vi.mock("$lib/server/fitness/repository", () => ({
  listFitnessConnections: mocked.listFitnessConnections,
  requireFitnessUser: async () => ({
    user: { id: "00000000-0000-4000-8000-000000000001" },
    userClient: {},
  }),
}));

vi.mock("$lib/server/fitness/workout", () => ({
  assertOwnedProgram: vi.fn(),
  findWorkoutCapture: vi.fn(async () => ({
    id: "00000000-0000-4000-8000-000000000002",
    connectionId: "00000000-0000-4000-8000-000000000003",
    startedAt: "2026-08-26T17:00:00Z",
    endedAt: null,
  })),
  pollWorkoutHeartRate: mocked.pollWorkoutHeartRate,
  workoutSourceSessionKey: (programId: string, sessionId: string) =>
    `${programId}:${sessionId}`,
  workoutTelemetry: vi.fn(),
  workoutTelemetryDelta: mocked.workoutTelemetryDelta,
}));

import { GET } from "./+server";

beforeEach(() => {
  vi.clearAllMocks();
  mocked.listFitnessConnections.mockResolvedValue([
    {
      id: "00000000-0000-4000-8000-000000000003",
      provider: "google_health",
      status: "active",
      scopes: [
        "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
      ],
      last_error_code: null,
      last_synced_at: null,
      updated_at: "2026-08-26T16:00:00Z",
    },
  ]);
  mocked.pollWorkoutHeartRate.mockResolvedValue({
    status: "updated",
    sampleCount: 1,
  });
  mocked.workoutTelemetryDelta.mockResolvedValue({
    workoutSessionId: "00000000-0000-4000-8000-000000000002",
    status: "active",
    startedAt: "2026-08-26T17:00:00Z",
    endedAt: null,
    checkedAt: "2026-08-26T17:00:05Z",
    isDelta: true,
    hasMore: false,
    samples: [{ recordedAt: "2026-08-26T17:00:04Z", bpm: 132 }],
    buckets: [],
  });
});

describe("active workout capture status", () => {
  it("returns stored live samples while provider catch-up runs separately", async () => {
    const response = await GET({
      url: new URL(
        "https://orbital-training.com/api/fitness/workouts/workout-1?programId=00000000-0000-4000-8000-000000000010",
      ),
      params: { sessionId: "workout-1" },
      request: new Request("https://orbital-training.com"),
    } as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "active",
      provider: "google_health",
      isDelta: true,
      importStatus: "synced",
      samples: [{ recordedAt: "2026-08-26T17:00:04Z", bpm: 132 }],
    });
    expect(mocked.workoutTelemetryDelta).toHaveBeenCalledOnce();
    expect(mocked.deferFitnessTask).toHaveBeenCalledOnce();
  });
});
