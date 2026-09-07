import { describe, expect, it } from "vitest";
import { reconcileSleepEpisodes } from "./sleep-episodes";

describe("reconcileSleepEpisodes", () => {
  it("keeps an overnight episode together for wake-date attribution", () => {
    const [episode] = reconcileSleepEpisodes([
      {
        startAt: "2026-08-25T03:00:00.000Z",
        endAt: "2026-08-25T05:00:00.000Z",
        stage: "asleep_core",
      },
      {
        startAt: "2026-08-25T05:00:00.000Z",
        endAt: "2026-08-25T11:00:00.000Z",
        stage: "asleep_deep",
      },
    ]);
    expect(episode).toMatchObject({
      startAt: "2026-08-25T03:00:00.000Z",
      endAt: "2026-08-25T11:00:00.000Z",
      sleepMinutes: 480,
    });
  });

  it("does not double-count overlapping source intervals", () => {
    const [episode] = reconcileSleepEpisodes([
      {
        startAt: "2026-08-25T03:00:00.000Z",
        endAt: "2026-08-25T11:00:00.000Z",
        stage: "asleep_unspecified",
      },
      {
        startAt: "2026-08-25T04:00:00.000Z",
        endAt: "2026-08-25T06:00:00.000Z",
        stage: "asleep_deep",
      },
    ]);
    expect(episode?.sleepMinutes).toBe(480);
    expect(episode?.stages).toEqual({ light: 360, deep: 120 });
  });
});
