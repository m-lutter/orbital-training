import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import type { WorkoutCaptureController } from "$lib/fitness/contracts";
import { WORKOUT_CAPTURE_POLL_MS } from "$lib/fitness/workout-capture";
import WearableWorkoutCapture from "./WearableWorkoutCapture.svelte";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("WearableWorkoutCapture", () => {
  it("does not label a background status poll as Ending", async () => {
    let active = false;
    let holdNextGet = false;
    let releaseGet: ((response: Response) => void) | undefined;
    const intervalSpy = vi.spyOn(window, "setInterval");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/start") && init?.method === "POST") {
          active = true;
          return Response.json({
            workoutSessionId: "capture-1",
            status: "active",
            startedAt: "2026-08-25T10:00:00Z",
          });
        }
        if (holdNextGet) {
          holdNextGet = false;
          return await new Promise<Response>((resolve) => {
            releaseGet = resolve;
          });
        }
        if (!active) return new Response(null, { status: 404 });
        return Response.json({
          workoutSessionId: "capture-1",
          status: "active",
          startedAt: "2026-08-25T10:00:00Z",
          endedAt: null,
          samples: [],
          buckets: [],
        });
      }),
    );

    render(WearableWorkoutCapture, {
      programId: "program-1",
      sessionId: "session-1",
    });
    const start = page.getByRole("button", { name: "Start workout capture" });
    await expect.element(start).toBeEnabled();
    await start.click();
    await expect.element(page.getByText("Recording")).toBeVisible();

    const poll = intervalSpy.mock.calls.find(
      ([, delay]) => delay === WORKOUT_CAPTURE_POLL_MS,
    )?.[0];
    if (typeof poll !== "function") throw new Error("Poll callback was absent");
    holdNextGet = true;
    poll();
    await vi.waitFor(() => expect(releaseGet).toBeDefined());
    await expect
      .element(page.getByRole("button", { name: "End workout capture" }))
      .toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "End workout capture" }))
      .toBeEnabled();
    await expect.element(page.getByText("Ending…")).not.toBeInTheDocument();
    releaseGet?.(
      Response.json({
        workoutSessionId: "capture-1",
        status: "active",
        startedAt: "2026-08-25T10:00:00Z",
        endedAt: null,
        samples: [],
        buckets: [],
      }),
    );
  });

  it("requires confirmation and resets an accidental capture", async () => {
    let active = true;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith("/reset") && init?.method === "POST") {
          active = false;
          return Response.json({ reset: true });
        }
        if (!active) return new Response(null, { status: 404 });
        return Response.json({
          workoutSessionId: "capture-1",
          status: "active",
          startedAt: "2026-08-25T10:00:00Z",
          endedAt: null,
          samples: [],
          buckets: [],
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(WearableWorkoutCapture, {
      programId: "program-1",
      sessionId: "session-1",
    });
    const reset = page.getByRole("button", { name: "Reset capture" });
    await expect.element(reset).toBeEnabled();
    await reset.click();
    await expect
      .element(page.getByText(/Resetting discards this capture/))
      .toBeVisible();
    await page.getByRole("button", { name: "Reset and discard" }).click();
    await expect.element(page.getByText("Not started")).toBeVisible();
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input).endsWith("/reset") && init?.method === "POST",
      ),
    ).toBe(true);
  });

  it("clears a cached recording when the server no longer has it", async () => {
    const captureChanges: Array<unknown> = [];
    localStorage.setItem(
      "orbital-workout-capture-v1:program-1:session-1",
      JSON.stringify({
        schemaVersion: 1,
        workoutSessionId: "stale-capture",
        status: "active",
        startedAt: "2026-08-25T10:00:00Z",
        endedAt: null,
      }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { message: "No workout capture has started." },
          { status: 404 },
        ),
      ),
    );

    render(WearableWorkoutCapture, {
      programId: "program-1",
      sessionId: "session-1",
      oncapturechange: (capture) => captureChanges.push(capture),
    });

    await expect.element(page.getByText("Not started")).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Start workout capture" }))
      .toBeEnabled();
    expect(
      localStorage.getItem("orbital-workout-capture-v1:program-1:session-1"),
    ).toBeNull();
    expect(captureChanges.at(-1)).toBeUndefined();
  });

  it("treats ending an already-missing capture as a successful cleanup", async () => {
    localStorage.setItem(
      "orbital-workout-capture-v1:program-1:session-1",
      JSON.stringify({
        schemaVersion: 1,
        workoutSessionId: "capture-1",
        status: "active",
        startedAt: "2026-08-25T10:00:00Z",
        endedAt: null,
      }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith("/end") && init?.method === "POST") {
          return Response.json(
            { message: "Workout capture was not found." },
            { status: 404 },
          );
        }
        return Response.json({
          workoutSessionId: "capture-1",
          status: "active",
          startedAt: "2026-08-25T10:00:00Z",
          endedAt: null,
          samples: [],
          buckets: [],
        });
      }),
    );

    render(WearableWorkoutCapture, {
      programId: "program-1",
      sessionId: "session-1",
    });

    const end = page.getByRole("button", { name: "End workout capture" });
    await expect.element(end).toBeEnabled();
    await end.click();
    await expect.element(page.getByText("Not started")).toBeVisible();
    await expect
      .element(page.getByText("Workout capture was not found."))
      .not.toBeInTheDocument();
    expect(
      localStorage.getItem("orbital-workout-capture-v1:program-1:session-1"),
    ).toBeNull();
  });

  it("recovers a capture when the start response is lost after creation", async () => {
    let active = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith("/start") && init?.method === "POST") {
          active = true;
          return Response.json({ message: "Internal Error" }, { status: 500 });
        }
        if (!active) return new Response(null, { status: 404 });
        return Response.json({
          workoutSessionId: "capture-1",
          status: "active",
          startedAt: "2026-08-25T10:00:00Z",
          endedAt: null,
          samples: [],
          buckets: [],
        });
      }),
    );

    render(WearableWorkoutCapture, {
      programId: "program-1",
      sessionId: "session-1",
    });

    const start = page.getByRole("button", { name: "Start workout capture" });
    await expect.element(start).toBeEnabled();
    await start.click();
    await expect.element(page.getByText("Recording")).toBeVisible();
    await expect
      .element(page.getByText("Internal Error"))
      .not.toBeInTheDocument();
  });

  it("starts explicitly and persists the capture identifier", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/start") && init?.method === "POST")
          return new Response(
            JSON.stringify({
              workoutSessionId: "capture-1",
              status: "recording",
              startedAt: "2026-08-25T10:00:00Z",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        return new Response(null, { status: 404 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    render(WearableWorkoutCapture, {
      programId: "program-1",
      sessionId: "session-1",
    });

    const start = page.getByRole("button", { name: "Start workout capture" });
    await expect.element(start).toBeEnabled();
    await start.click();
    await expect.element(page.getByText("Recording")).toBeVisible();
    expect(
      localStorage.getItem("orbital-workout-capture-v1:program-1:session-1"),
    ).toContain("capture-1");
  });

  it("restores completed telemetry and offers the post-workout chart", async () => {
    localStorage.setItem(
      "orbital-workout-capture-v1:program-1:session-1",
      JSON.stringify({
        schemaVersion: 1,
        workoutSessionId: "capture-1",
        status: "completed",
        startedAt: "2026-08-25T10:00:00Z",
        endedAt: "2026-08-25T10:10:00Z",
      }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              workoutSessionId: "capture-1",
              status: "completed",
              startedAt: "2026-08-25T10:00:00Z",
              endedAt: "2026-08-25T10:10:00Z",
              samples: [
                { recordedAt: "2026-08-25T10:00:00Z", bpm: 110 },
                { recordedAt: "2026-08-25T10:05:00Z", bpm: 140 },
              ],
              buckets: [],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );
    render(WearableWorkoutCapture, {
      programId: "program-1",
      sessionId: "session-1",
    });

    await expect
      .element(page.getByRole("heading", { name: "Heart rate over time" }))
      .toBeVisible();
  });

  it("polls active capture, catches up online, and exposes a safe end control", async () => {
    let controller: WorkoutCaptureController | undefined;
    let active = false;
    let getCount = 0;
    const intervalSpy = vi.spyOn(window, "setInterval");
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/start") && init?.method === "POST") {
          active = true;
          return Response.json({
            workoutSessionId: "capture-1",
            status: "active",
            startedAt: "2026-08-25T10:00:00Z",
          });
        }
        if (url.endsWith("/end") && init?.method === "POST") {
          active = false;
          return Response.json({
            workoutSessionId: "capture-1",
            status: "completed",
            startedAt: "2026-08-25T10:00:00Z",
            endedAt: "2026-08-25T10:10:00Z",
            samples: [
              { recordedAt: "2026-08-25T10:00:30Z", bpm: 108 },
              { recordedAt: "2026-08-25T10:01:00Z", bpm: 142 },
            ],
            buckets: [
              {
                bucketStart: "2026-08-25T10:00:00Z",
                avgBpm: 120,
                minBpm: 100,
                maxBpm: 130,
                sampleCount: 20,
              },
            ],
          });
        }
        getCount += 1;
        if (!active) return new Response(null, { status: 404 });
        return Response.json({
          workoutSessionId: "capture-1",
          status: "active",
          startedAt: "2026-08-25T10:00:00Z",
          endedAt: null,
          samples: [{ recordedAt: "2026-08-25T10:00:30Z", bpm: 108 }],
          buckets: [],
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    render(WearableWorkoutCapture, {
      programId: "program-1",
      sessionId: "session-1",
      oncontrollerchange: (next) => (controller = next),
    });

    await page.getByRole("button", { name: "Start workout capture" }).click();
    await expect.element(page.getByText("Recording")).toBeVisible();
    await vi.waitFor(() => expect(controller).toBeDefined());

    const pollCall = intervalSpy.mock.calls.find(
      ([, delay]) => delay === WORKOUT_CAPTURE_POLL_MS,
    );
    expect(pollCall).toBeDefined();
    expect(getCount).toBe(1);
    const poll = pollCall?.[0];
    if (typeof poll !== "function") throw new Error("Poll callback was absent");
    poll();
    await vi.waitFor(() => expect(getCount).toBe(2));
    await new Promise((resolve) => window.setTimeout(resolve, 50));

    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(getCount).toBe(3));
    await new Promise((resolve) => window.setTimeout(resolve, 50));

    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(getCount).toBe(4));

    if (controller === undefined)
      throw new Error("Workout capture controller was absent");
    await expect(controller.endCapture()).resolves.toBe(true);
    await expect
      .element(page.getByRole("heading", { name: "Heart rate over time" }))
      .toBeVisible();
    await expect.element(page.getByText("125 bpm average")).toBeVisible();
  });

  it("appends a five-second live delta and keeps the chart after ending", async () => {
    localStorage.setItem(
      "orbital-workout-capture-v1:program-1:session-1",
      JSON.stringify({
        schemaVersion: 1,
        workoutSessionId: "capture-1",
        status: "active",
        startedAt: "2026-08-25T10:00:00Z",
        endedAt: null,
      }),
    );
    let getCount = 0;
    const intervalSpy = vi.spyOn(window, "setInterval");
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith("/end") && init?.method === "POST") {
          return Response.json({
            workoutSessionId: "capture-1",
            status: "complete",
            startedAt: "2026-08-25T10:00:00Z",
            endedAt: "2026-08-25T10:00:20Z",
            samples: [],
            buckets: [],
          });
        }
        getCount += 1;
        return Response.json({
          workoutSessionId: "capture-1",
          status: "active",
          startedAt: "2026-08-25T10:00:00Z",
          endedAt: null,
          checkedAt:
            getCount === 1 ? "2026-08-25T10:00:10Z" : "2026-08-25T10:00:15Z",
          isDelta: true,
          provider: "google_health",
          samples: [
            {
              recordedAt:
                getCount === 1
                  ? "2026-08-25T10:00:05Z"
                  : "2026-08-25T10:00:12Z",
              bpm: getCount === 1 ? 100 : 145,
            },
          ],
          buckets: [],
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(WearableWorkoutCapture, {
      programId: "program-1",
      sessionId: "session-1",
      zoneProfile: {
        maximumHeartRateBpm: 200,
        method: "percent_max",
      },
    });

    await expect
      .element(page.getByText(/1 source sample from Google Health/))
      .toBeVisible();
    const poll = intervalSpy.mock.calls.find(
      ([, delay]) => delay === WORKOUT_CAPTURE_POLL_MS,
    )?.[0];
    if (typeof poll !== "function") throw new Error("Poll callback was absent");
    poll();
    await vi.waitFor(() => expect(getCount).toBe(2));
    await expect
      .element(page.getByText(/2 source samples from Google Health/))
      .toBeVisible();
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes("after=2026-08-25T10%3A00%3A00.000Z"),
      ),
    ).toBe(true);

    await page.getByRole("button", { name: "End workout capture" }).click();
    await expect.element(page.getByText("Capture ended").first()).toBeVisible();
    await expect
      .element(page.getByText(/2 source samples from Google Health/))
      .toBeVisible();
  });
});
