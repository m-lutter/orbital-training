import { describe, expect, it } from "vitest";
import {
  buildActiveWorkoutReadWindow,
  buildReadWindow,
  shouldRunSync,
} from "./policy";

describe("active-workout sync policy", () => {
  it("uses a two-minute overlap from the last successful boundary", () => {
    expect(
      buildActiveWorkoutReadWindow({
        now: new Date("2026-08-25T15:30:00.000Z"),
        startedAt: "2026-08-25T15:00:00.000Z",
        cursor: {
          schemaVersion: 1,
          provider: "apple_healthkit",
          lastWindowEndAt: "2026-08-25T15:20:00.000Z",
        },
      }),
    ).toEqual({
      startAt: "2026-08-25T15:18:00.000Z",
      endAt: "2026-08-25T15:30:00.000Z",
    });
  });

  it("never reaches back before the workout start", () => {
    expect(
      buildActiveWorkoutReadWindow({
        now: new Date("2026-08-25T15:01:00.000Z"),
        startedAt: "2026-08-25T15:00:00.000Z",
        cursor: {
          schemaVersion: 1,
          provider: "android_health_connect",
          lastWindowEndAt: "2026-08-25T15:00:30.000Z",
        },
      }).startAt,
    ).toBe("2026-08-25T15:00:00.000Z");
  });

  it("runs an app-open sync only once per local day", () => {
    expect(
      shouldRunSync({
        trigger: "app_open_daily",
        now: new Date(2026, 7, 25, 9, 0),
        lastSuccessAt: new Date(2026, 7, 25, 8, 0).toISOString(),
      }),
    ).toBe(false);
  });

  it("does not turn ordinary foreground resumes into repeated same-day syncs", () => {
    expect(
      shouldRunSync({
        trigger: "foreground_catch_up",
        now: new Date(2026, 7, 25, 18, 0),
        lastSuccessAt: new Date(2026, 7, 25, 8, 0).toISOString(),
      }),
    ).toBe(false);
  });

  it("retries a same-day foreground sync only after a recorded failure", () => {
    expect(
      shouldRunSync({
        trigger: "foreground_catch_up",
        now: new Date(2026, 7, 25, 18, 0),
        lastSuccessAt: new Date(2026, 7, 25, 8, 0).toISOString(),
        catchUpNeededAt: new Date(2026, 7, 25, 17, 59).toISOString(),
      }),
    ).toBe(true);
  });

  it("starts ordinary snapshots at a local-day boundary", () => {
    const now = new Date(2026, 7, 25, 15, 30, 0, 0);
    const window = buildReadWindow({
      now,
      cursor: {
        schemaVersion: 1,
        provider: "apple_healthkit",
        lastWindowEndAt: new Date(2026, 7, 25, 14, 0, 0, 0).toISOString(),
      },
      allowHistoryOlderThan30Days: false,
    });
    const start = new Date(window.startAt);
    expect([
      start.getHours(),
      start.getMinutes(),
      start.getSeconds(),
      start.getMilliseconds(),
    ]).toEqual([0, 0, 0, 0]);
  });
});
