import { afterEach, describe, expect, it, vi } from "vitest";
import type { HealthSyncEnvelopeV1 } from "../health/types";
import { WorkerHealthSyncTransport } from "./transport";

const envelope: HealthSyncEnvelopeV1 = {
  schemaVersion: 1,
  syncRunId: "run-1",
  trigger: "manual",
  userId: "advisory-user-id",
  provider: "apple_healthkit",
  timeZone: "America/Chicago",
  window: {
    startAt: "2026-08-25T00:00:00.000Z",
    endAt: "2026-08-25T01:00:00.000Z",
  },
  batch: { index: 0, count: 1 },
  permissions: {
    read: {
      steps: true,
      heart_rate: false,
      resting_heart_rate: false,
      heart_rate_variability: false,
      sleep: false,
      active_energy: false,
      workout: false,
    },
    writeCompletedWorkouts: false,
    allowBackgroundRead: false,
    allowHistoryOlderThan30Days: false,
  },
  records: [],
  deletions: [],
  proposedCursor: { schemaVersion: 1, provider: "apple_healthkit" },
  generatedAt: "2026-08-25T01:00:00.000Z",
  truncated: false,
};

afterEach(() => vi.unstubAllGlobals());

describe("WorkerHealthSyncTransport", () => {
  it("uses the explicit connection endpoint before a device can sync", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ connected: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const client = {
      auth: {
        getSession: vi.fn(async () => ({
          data: { session: { access_token: "access-token" } },
          error: null,
        })),
        refreshSession: vi.fn(),
      },
    };
    const transport = new WorkerHealthSyncTransport(
      client as never,
      "https://orbital-training.com",
    );

    await transport.connect("apple_healthkit", envelope.permissions);

    expect(fetch).toHaveBeenCalledWith(
      "https://orbital-training.com/api/fitness/mobile/connect",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          schemaVersion: 1,
          provider: "apple_healthkit",
          permissions: envelope.permissions,
        }),
      }),
    );
  });

  it("uses the current Supabase bearer token at the Worker endpoint", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            accepted: true,
            receivedRecords: 0,
            receivedDeletions: 0,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetch);
    const client = {
      auth: {
        getSession: vi.fn(async () => ({
          data: { session: { access_token: "access-token" } },
          error: null,
        })),
        refreshSession: vi.fn(),
      },
    };
    const transport = new WorkerHealthSyncTransport(
      client as never,
      "https://orbital-training.com",
    );

    await transport.send(envelope);

    expect(fetch).toHaveBeenCalledWith(
      "https://orbital-training.com/api/fitness/mobile/sync",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer access-token",
        }),
      }),
    );
  });

  it("refreshes the session once after an unauthorized response", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accepted: true }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetch);
    const client = {
      auth: {
        getSession: vi.fn(async () => ({
          data: { session: { access_token: "stale-token" } },
          error: null,
        })),
        refreshSession: vi.fn(async () => ({
          data: { session: { access_token: "fresh-token" } },
          error: null,
        })),
      },
    };
    const transport = new WorkerHealthSyncTransport(
      client as never,
      "https://orbital-training.com",
    );

    await transport.send(envelope);

    expect(client.auth.refreshSession).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenLastCalledWith(
      "https://orbital-training.com/api/fitness/mobile/sync",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer fresh-token",
        }),
      }),
    );
  });
});
