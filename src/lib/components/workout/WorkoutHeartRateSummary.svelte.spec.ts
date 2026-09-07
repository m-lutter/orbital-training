import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import WorkoutHeartRateSummary from "./WorkoutHeartRateSummary.svelte";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("WorkoutHeartRateSummary", () => {
  it("retries an empty result and displays samples imported moments later", async () => {
    let requestCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        requestCount += 1;
        return Response.json({
          workoutSessionId: "capture-1",
          status: "complete",
          startedAt: "2026-08-25T10:00:00Z",
          endedAt: "2026-08-25T10:10:00Z",
          samples:
            requestCount === 1
              ? []
              : [
                  { recordedAt: "2026-08-25T10:01:00Z", bpm: 110 },
                  { recordedAt: "2026-08-25T10:08:00Z", bpm: 140 },
                ],
          buckets: [],
        });
      }),
    );

    render(WorkoutHeartRateSummary, {
      initialTelemetry: {
        workoutSessionId: "capture-1",
        status: "complete",
        startedAt: "2026-08-25T10:00:00Z",
        endedAt: "2026-08-25T10:10:00Z",
        samples: [],
        buckets: [],
      },
      statusUrl: "/api/fitness/workouts/session-1?programId=program-1",
      retryDelaysMs: [0, 0],
    });

    await expect.element(page.getByText("125 bpm average")).toBeVisible();
    await expect
      .element(page.getByText("Heart-rate samples imported."))
      .toBeVisible();
    expect(requestCount).toBe(2);
  });

  it("explains when the provider responded but had no workout samples", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          workoutSessionId: "capture-1",
          status: "complete",
          startedAt: "2026-08-25T10:00:00Z",
          endedAt: "2026-08-25T10:10:00Z",
          importStatus: "no_provider_samples",
          samples: [],
          buckets: [],
        }),
      ),
    );

    render(WorkoutHeartRateSummary, {
      initialTelemetry: {
        workoutSessionId: "capture-1",
        status: "complete",
        startedAt: "2026-08-25T10:00:00Z",
        endedAt: "2026-08-25T10:10:00Z",
        samples: [],
        buckets: [],
      },
      statusUrl: "/api/fitness/workouts/session-1?programId=program-1",
      retryDelaysMs: [0],
    });

    await expect
      .element(page.getByText(/responded successfully/))
      .toBeVisible();
  });

  it("turns a failed status request into a recoverable message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { message: "Workout capture could not be checked." },
          { status: 500 },
        ),
      ),
    );

    render(WorkoutHeartRateSummary, {
      initialTelemetry: {
        workoutSessionId: "capture-1",
        status: "complete",
        startedAt: "2026-08-25T10:00:00Z",
        endedAt: "2026-08-25T10:10:00Z",
        samples: [],
        buckets: [],
      },
      statusUrl: "/api/fitness/workouts/session-1?programId=program-1",
      retryDelaysMs: [0],
    });

    await expect
      .element(
        page.getByText(
          "Heart-rate data could not be checked. Your workout is still saved.",
        ),
      )
      .toBeVisible();
  });
});
