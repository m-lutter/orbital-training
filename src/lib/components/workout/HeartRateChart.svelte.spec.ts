import { page } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import HeartRateChart from "./HeartRateChart.svelte";

describe("HeartRateChart", () => {
  it("renders an accessible post-workout chart from generic buckets", async () => {
    render(HeartRateChart, {
      telemetry: {
        workoutSessionId: "capture-1",
        status: "completed",
        startedAt: "2026-08-25T10:00:00Z",
        endedAt: "2026-08-25T10:10:00Z",
        samples: [],
        buckets: [
          {
            bucketStart: "2026-08-25T10:00:00Z",
            avgBpm: 110,
            minBpm: 100,
            maxBpm: 120,
            sampleCount: 10,
          },
          {
            bucketStart: "2026-08-25T10:05:00Z",
            avgBpm: 140,
            minBpm: 130,
            maxBpm: 150,
            sampleCount: 10,
          },
        ],
      },
    });

    await expect
      .element(page.getByRole("heading", { name: "Heart rate over time" }))
      .toBeVisible();
    await expect.element(page.getByText("125 bpm average")).toBeVisible();
    await expect
      .element(page.getByRole("img"))
      .toHaveAttribute(
        "aria-label",
        expect.stringContaining("100 to 150 beats per minute"),
      );
  });

  it("explains when a completed capture has not synced samples", async () => {
    render(HeartRateChart, {
      telemetry: {
        workoutSessionId: "capture-1",
        status: "completed",
        startedAt: "2026-08-25T10:00:00Z",
        endedAt: "2026-08-25T10:10:00Z",
        samples: [],
        buckets: [],
      },
    });
    await expect
      .element(page.getByText(/no heart-rate samples are available yet/i))
      .toBeVisible();
  });

  it("renders a live one-point chart with saved heart-rate zones", async () => {
    render(HeartRateChart, {
      live: true,
      zoneProfile: {
        maximumHeartRateBpm: 200,
        method: "percent_max",
      },
      telemetry: {
        workoutSessionId: "capture-1",
        status: "active",
        startedAt: "2026-08-25T10:00:00Z",
        endedAt: null,
        checkedAt: "2026-08-25T10:00:10Z",
        provider: "google_health",
        samples: [{ recordedAt: "2026-08-25T10:00:05Z", bpm: 145 }],
        buckets: [],
      },
    });

    await expect
      .element(page.getByText("Live · latest available"))
      .toBeVisible();
    await expect.element(page.getByText("Zone 3 140–159")).toBeVisible();
    await expect.element(page.getByRole("img")).toBeVisible();
    await expect
      .element(page.getByText(/1 source sample from Google Health/))
      .toBeVisible();
  });
});
