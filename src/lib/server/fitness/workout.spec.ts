import { beforeEach, describe, expect, it, vi } from "vitest";
import { FitnessProviderError } from "./provider-clients";

const mocked = vi.hoisted(() => ({
  claimFitnessSync: vi.fn(),
  completeFitnessSync: vi.fn(),
  failFitnessSync: vi.fn(),
  fetchGoogleWorkoutHeartRate: vi.fn(),
  ingestHeartRateSamples: vi.fn(),
  loadFitnessTokens: vi.fn(),
}));

vi.mock("./provider-data", () => ({
  fetchGoogleWorkoutHeartRate: mocked.fetchGoogleWorkoutHeartRate,
}));

vi.mock("./repository", () => ({
  claimFitnessSync: mocked.claimFitnessSync,
  completeFitnessSync: mocked.completeFitnessSync,
  failFitnessSync: mocked.failFitnessSync,
  ingestHeartRateSamples: mocked.ingestHeartRateSamples,
  loadFitnessTokens: mocked.loadFitnessTokens,
  fitnessServiceClient: () => {
    const query = {
      select: () => query,
      eq: () => query,
      order: () => query,
      limit: () => query,
      maybeSingle: async () => ({ data: null, error: null }),
    };
    return { from: () => query };
  },
}));

import { pollWorkoutHeartRate } from "./workout";

const connection = {
  id: "00000000-0000-4000-8000-000000000001",
  provider: "google_health",
  status: "active",
  generation: 3,
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  mocked.claimFitnessSync.mockResolvedValue({
    connectionId: "00000000-0000-4000-8000-000000000001",
    cursor: null,
    generation: 3,
    lastSuccessAt: null,
    leaseExpiresAt: "2026-08-26T18:01:00Z",
    leaseToken: "00000000-0000-4000-8000-000000000002",
    provider: "google_health",
    purpose: "workout",
  });
  mocked.loadFitnessTokens.mockResolvedValue({ accessToken: "access-token" });
  mocked.ingestHeartRateSamples.mockResolvedValue(undefined);
  mocked.completeFitnessSync.mockResolvedValue(undefined);
  mocked.failFitnessSync.mockResolvedValue(undefined);
});

describe("Google workout heart-rate collection", () => {
  it("fetches the capture window and tags every imported sample", async () => {
    mocked.fetchGoogleWorkoutHeartRate.mockResolvedValue([
      { sampledAt: "2026-08-26T17:05:00Z", bpm: 118 },
      { sampledAt: "2026-08-26T17:06:00Z", bpm: 132 },
    ]);

    await expect(
      pollWorkoutHeartRate({
        config: {} as never,
        connection,
        startedAt: "2026-08-26T17:00:00Z",
        endedAt: "2026-08-26T18:00:00Z",
        sourceSessionKey: "program-1:workout-1",
        userId: "00000000-0000-4000-8000-000000000003",
      }),
    ).resolves.toEqual({ status: "updated", sampleCount: 2 });

    expect(mocked.fetchGoogleWorkoutHeartRate).toHaveBeenCalledWith({
      accessToken: "access-token",
      startTime: "2026-08-26T17:00:00Z",
      endTime: "2026-08-26T18:00:00Z",
    });
    expect(mocked.ingestHeartRateSamples).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedGeneration: 3,
        samples: [
          {
            sampledAt: "2026-08-26T17:05:00Z",
            bpm: 118,
            sourceSessionKey: "program-1:workout-1",
          },
          {
            sampledAt: "2026-08-26T17:06:00Z",
            bpm: 132,
            sourceSessionKey: "program-1:workout-1",
          },
        ],
      }),
    );
    expect(mocked.completeFitnessSync).toHaveBeenCalledOnce();
  });

  it("records an actionable reconnect error when Google rejects access", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocked.fetchGoogleWorkoutHeartRate.mockRejectedValue(
      new FitnessProviderError("google_health", 403, "denied"),
    );

    await expect(
      pollWorkoutHeartRate({
        config: {} as never,
        connection,
        startedAt: "2026-08-26T17:00:00Z",
        endedAt: "2026-08-26T18:00:00Z",
        sourceSessionKey: "program-1:workout-1",
        userId: "00000000-0000-4000-8000-000000000003",
      }),
    ).resolves.toEqual({
      status: "failed",
      sampleCount: 0,
      errorCode: "provider_auth",
    });
    expect(mocked.failFitnessSync).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "provider_auth" }),
    );
  });
});
