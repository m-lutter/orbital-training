import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PERMISSION_SELECTION } from "../health/permissions";
import type {
  HealthPermissionSelection,
  HealthProvider,
  HealthSyncEnvelopeV1,
} from "../health/types";
import type { HealthStateStore } from "../storage/storage";
import { HealthSyncEngine } from "./engine";
import type { HealthSyncTransport } from "./transport";

const selection: HealthPermissionSelection = {
  ...DEFAULT_PERMISSION_SELECTION,
  read: { ...DEFAULT_PERMISSION_SELECTION.read, heart_rate: true },
};

function harness() {
  const envelopes: HealthSyncEnvelopeV1[] = [];
  const provider: HealthProvider = {
    name: "android_health_connect",
    getAvailability: vi.fn(async () => ({ available: true })),
    requestPermissions: vi.fn(async () => undefined),
    read: vi.fn(async ({ window }) => ({
      records: [
        {
          schemaVersion: 1 as const,
          kind: "heart_rate" as const,
          sourceRecordId: "hr-1",
          startAt: window.endAt,
          endAt: window.endAt,
          source: { origin: "android_health_connect" as const },
          value: 121,
          unit: "bpm" as const,
        },
      ],
      deletions: [],
      nextCursor: {
        schemaVersion: 1 as const,
        provider: "android_health_connect" as const,
        lastWindowEndAt: window.endAt,
      },
      truncated: false,
    })),
    writeCompletedWorkout: vi.fn(async () => null),
    openPermissionSettings: vi.fn(async () => undefined),
  };
  const store = {
    getPermissions: vi.fn(async () => selection),
    getLastSuccess: vi.fn(async () => "2026-08-25T15:20:00.000Z"),
    getCatchUpNeeded: vi.fn(async () => null),
    getCursor: vi.fn(async () => ({
      schemaVersion: 1 as const,
      provider: "android_health_connect" as const,
      lastWindowEndAt: "2026-08-25T15:20:00.000Z",
    })),
    commitSuccess: vi.fn(async () => undefined),
    markCatchUpNeeded: vi.fn(async () => undefined),
  } as unknown as HealthStateStore;
  const transport: HealthSyncTransport = {
    connect: vi.fn(async () => undefined),
    send: vi.fn(async (envelope: HealthSyncEnvelopeV1) => {
      envelopes.push(envelope);
      return {
        accepted: true as const,
        receivedRecords: envelope.records.length,
        receivedDeletions: envelope.deletions.length,
      };
    }),
  };
  return { envelopes, provider, store, transport };
}

describe("HealthSyncEngine", () => {
  it("includes the device time zone in an authenticated sync envelope", async () => {
    const value = harness();
    const engine = new HealthSyncEngine({
      userId: "user-1",
      provider: value.provider,
      store: value.store,
      transport: value.transport,
      now: () => new Date("2026-08-26T15:30:00.000Z"),
      timeZone: () => "America/Chicago",
    });

    await engine.sync("app_open_daily");

    expect(value.envelopes).toHaveLength(1);
    expect(value.envelopes[0]?.timeZone).toBe("America/Chicago");
  });

  it("forces a bounded incremental poll during an active workout", async () => {
    const value = harness();
    const engine = new HealthSyncEngine({
      userId: "user-1",
      provider: value.provider,
      store: value.store,
      transport: value.transport,
      now: () => new Date("2026-08-25T15:30:00.000Z"),
      timeZone: () => "UTC",
    });

    await engine.sync("foreground_catch_up", {
      force: true,
      selection,
      activeWorkoutStartedAt: "2026-08-25T15:00:00.000Z",
    });

    expect(value.provider.read).toHaveBeenCalledWith(
      expect.objectContaining({
        window: {
          startAt: "2026-08-25T15:18:00.000Z",
          endAt: "2026-08-25T15:30:00.000Z",
        },
      }),
    );
    expect(value.envelopes).toHaveLength(1);
    expect(value.envelopes[0]?.activeWorkout).toEqual({
      startedAt: "2026-08-25T15:00:00.000Z",
    });
  });

  it("checks server capture state even when an active poll has no new samples", async () => {
    const value = harness();
    vi.mocked(value.provider.read).mockResolvedValueOnce({
      records: [],
      deletions: [],
      nextCursor: {
        schemaVersion: 1,
        provider: "android_health_connect",
        lastWindowEndAt: "2026-08-26T15:30:00.000Z",
      },
      truncated: false,
    });
    const engine = new HealthSyncEngine({
      userId: "user-1",
      provider: value.provider,
      store: value.store,
      transport: value.transport,
      now: () => new Date("2026-08-26T15:30:00.000Z"),
      timeZone: () => "America/Chicago",
    });

    const result = await engine.sync("foreground_catch_up", {
      force: true,
      selection,
      activeWorkoutStartedAt: "2026-08-26T15:00:00.000Z",
    });

    expect(result).toMatchObject({ status: "completed", records: 0 });
    expect(value.transport.send).toHaveBeenCalledOnce();
    expect(value.store.commitSuccess).toHaveBeenCalledOnce();
  });

  it("refuses to commit a terminal cursor for an unread truncated tail", async () => {
    const value = harness();
    vi.mocked(value.provider.read).mockResolvedValueOnce({
      records: [],
      deletions: [],
      nextCursor: {
        schemaVersion: 1,
        provider: "android_health_connect",
        lastWindowEndAt: "2026-08-26T15:30:00.000Z",
      },
      truncated: true,
    });
    const engine = new HealthSyncEngine({
      userId: "user-1",
      provider: value.provider,
      store: value.store,
      transport: value.transport,
      now: () => new Date("2026-08-26T15:30:00.000Z"),
      timeZone: () => "America/Chicago",
    });

    await expect(
      engine.sync("foreground_catch_up", { force: true, selection }),
    ).rejects.toThrow("resumable cursor");
    expect(value.store.commitSuccess).not.toHaveBeenCalled();
    expect(value.store.markCatchUpNeeded).toHaveBeenCalledOnce();
  });
});
