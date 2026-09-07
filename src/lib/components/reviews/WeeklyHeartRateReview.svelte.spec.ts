import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import type { WeeklyHeartRateReviewData } from "$lib/reviews/heart-rate";
import WeeklyHeartRateReview from "./WeeklyHeartRateReview.svelte";

const readyReview: WeeklyHeartRateReviewData = {
  status: "ready",
  lastSyncedAt: "2026-08-26T18:30:00Z",
  workouts: [
    {
      id: "workout-log-1",
      label: "Squat day",
      startedAt: "2026-08-25T10:00:00Z",
      endedAt: "2026-08-25T11:00:00Z",
      provider: "google_health",
      averageBpm: 132,
      maximumBpm: 166,
      buckets: [
        {
          bucketStart: "2026-08-25T10:05:00Z",
          averageBpm: 110,
          minimumBpm: 94,
          maximumBpm: 126,
          sampleCount: 12,
        },
        {
          bucketStart: "2026-08-25T10:10:00Z",
          averageBpm: 142,
          minimumBpm: 122,
          maximumBpm: 158,
          sampleCount: 18,
        },
        {
          bucketStart: "2026-08-25T10:15:00Z",
          averageBpm: 150,
          minimumBpm: 130,
          maximumBpm: 166,
          sampleCount: 16,
        },
      ],
    },
    {
      id: "workout-log-2",
      label: "Bench day",
      startedAt: "2026-08-26T12:00:00Z",
      endedAt: "2026-08-26T13:30:00Z",
      provider: "google_health",
      averageBpm: 128,
      maximumBpm: 158,
      buckets: [
        {
          bucketStart: "2026-08-26T12:10:00Z",
          averageBpm: 115,
          minimumBpm: 100,
          maximumBpm: 130,
          sampleCount: 10,
        },
        {
          bucketStart: "2026-08-26T12:15:00Z",
          averageBpm: 130,
          minimumBpm: 112,
          maximumBpm: 148,
          sampleCount: 14,
        },
        {
          bucketStart: "2026-08-26T12:20:00Z",
          averageBpm: 145,
          minimumBpm: 125,
          maximumBpm: 158,
          sampleCount: 12,
        },
      ],
    },
  ],
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.dataset.theme = "orbital";
});

describe("WeeklyHeartRateReview", () => {
  it("renders one accessible normalized comparison and chronological summaries", async () => {
    const result = render(WeeklyHeartRateReview, { heartRate: readyReview });

    await expect
      .element(
        page.getByRole("heading", { name: "Heart rate from your workouts" }),
      )
      .toBeVisible();
    await expect
      .element(page.getByRole("img"))
      .toHaveAttribute(
        "aria-label",
        expect.stringMatching(
          /2 of 2 workout traces are shown.*0 to 100.*heart rate from \d+ to \d+/i,
        ),
      );
    expect(
      result.container.querySelectorAll("svg.heart-rate-plot"),
    ).toHaveLength(1);
    expect(result.container.querySelectorAll(".heart-rate-range")).toHaveLength(
      0,
    );
    expect(
      result.container.querySelectorAll(".heart-rate-plot .series-line"),
    ).toHaveLength(2);
    await expect
      .element(page.getByText("% of logged workout duration"))
      .toBeVisible();
    await expect.element(page.getByText(/not a live feed/i)).toBeVisible();

    const rows = [...result.container.querySelectorAll(".series-list > li")];
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.getAttribute("data-workout-id"))).toEqual([
      "workout-log-1",
      "workout-log-2",
    ]);
    expect(rows[0].textContent).toMatch(
      /Squat day.*1 hr.*Google Health.*132 bpm.*166 bpm/s,
    );
    expect(rows[1].textContent).toMatch(
      /Bench day.*1 hr 30 min.*Google Health.*128 bpm.*158 bpm/s,
    );

    const drawOrder = [
      ...result.container.querySelectorAll<SVGGElement>(
        ".heart-rate-plot g[data-style-slot]",
      ),
    ].map((group) => {
      const seriesLine = group.querySelector(".series-line");
      const dashClass = [...(seriesLine?.classList ?? [])].find((name) =>
        name.startsWith("series-dash-"),
      );
      return Number(dashClass?.replace("series-dash-", ""));
    });
    expect(drawOrder).toEqual(
      [...drawOrder].sort((left, right) => left - right),
    );
  });

  it("toggles plotted traces without removing their summary rows", async () => {
    const result = render(WeeklyHeartRateReview, { heartRate: readyReview });
    const squatToggle = page.getByRole("button", {
      name: /Hide Squat day heart-rate trace/i,
    });

    await expect.element(squatToggle).toHaveAttribute("aria-pressed", "true");
    await squatToggle.click();
    await expect
      .element(
        page.getByRole("button", {
          name: /Show Squat day heart-rate trace/i,
        }),
      )
      .toHaveAttribute("aria-pressed", "false");
    expect(
      result.container.querySelector(
        '.heart-rate-plot g[data-workout-id="workout-log-1"]',
      ),
    ).toBeNull();
    expect(
      result.container.querySelector(
        '.series-list > li[data-workout-id="workout-log-1"]',
      )?.textContent,
    ).toMatch(/Squat day.*132 bpm.*166 bpm/s);
    await expect
      .element(page.getByRole("img"))
      .toHaveAttribute("aria-label", expect.stringContaining("1 of 2"));
    expect(
      result.container
        .querySelector(".sample-note")
        ?.textContent?.replace(/\s+/g, " "),
    ).toContain("across 1 of 2 workouts");

    await page
      .getByRole("button", { name: /Hide Bench day heart-rate trace/i })
      .click();
    await expect
      .element(page.getByText(/All workout traces are hidden/i))
      .toBeVisible();
    await expect
      .element(page.getByRole("img"))
      .toHaveAttribute(
        "aria-label",
        expect.stringContaining("No workout traces are currently shown"),
      );
    expect(
      result.container.querySelectorAll(".heart-rate-plot g[data-style-slot]"),
    ).toHaveLength(0);
  });

  it("distinguishes duplicate labels and renders a one-point trace as a marker", async () => {
    const result = render(WeeklyHeartRateReview, {
      heartRate: {
        status: "ready",
        workouts: [
          {
            id: "strength-monday",
            label: "Strength",
            startedAt: "2026-08-24T10:00:00Z",
            endedAt: "2026-08-24T11:00:00Z",
            provider: "google_health",
            averageBpm: 120,
            maximumBpm: 140,
            buckets: [
              {
                bucketStart: "2026-08-24T10:20:00Z",
                averageBpm: 120,
              },
            ],
          },
          {
            id: "strength-wednesday",
            label: "Strength",
            startedAt: "2026-08-26T10:00:00Z",
            endedAt: "2026-08-26T11:00:00Z",
            provider: "google_health",
            averageBpm: 130,
            maximumBpm: 150,
            buckets: [
              {
                bucketStart: "2026-08-26T10:10:00Z",
                averageBpm: 125,
              },
              {
                bucketStart: "2026-08-26T10:20:00Z",
                averageBpm: 135,
              },
            ],
          },
        ],
      },
    });

    await expect
      .element(
        page.getByRole("button", {
          name: /Hide Strength heart-rate trace from Mon, Aug 24/i,
        }),
      )
      .toBeVisible();
    await expect
      .element(
        page.getByRole("button", {
          name: /Hide Strength heart-rate trace from Wed, Aug 26/i,
        }),
      )
      .toBeVisible();
    expect(
      result.container.querySelectorAll(
        '.heart-rate-plot [data-workout-id="strength-monday"].series-line',
      ),
    ).toHaveLength(0);
    expect(
      result.container.querySelectorAll(
        '.heart-rate-plot [data-workout-id="strength-monday"].endpoint-marker',
      ),
    ).toHaveLength(1);
    expect(
      result.container.querySelectorAll(
        '.series-list > li[data-plotted="true"]',
      ),
    ).toHaveLength(2);
  });

  it("keeps an invalid-duration workout as a non-toggleable summary", async () => {
    const result = render(WeeklyHeartRateReview, {
      heartRate: {
        status: "ready",
        workouts: [
          {
            id: "workout-log-summary",
            label: "Bench day",
            startedAt: "2026-08-26T10:00:00Z",
            endedAt: "2026-08-26T10:00:00Z",
            provider: "google_health",
            averageBpm: 118,
            maximumBpm: 151,
            buckets: [
              {
                bucketStart: "2026-08-26T10:00:00Z",
                averageBpm: 118,
              },
            ],
          },
        ],
      },
    });

    await expect
      .element(page.getByText("118 bpm", { exact: true }))
      .toBeVisible();
    await expect
      .element(
        page.getByText(/Workout summaries synced.*no five-minute points/i),
      )
      .toBeVisible();
    await expect.element(page.getByText(/Summary only/i)).toBeVisible();
    await expect.element(page.getByRole("img")).not.toBeInTheDocument();
    expect(result.container.querySelectorAll(".series-toggle")).toHaveLength(0);
  });

  it("explains that delayed provider data can arrive after the review", async () => {
    render(WeeklyHeartRateReview, {
      heartRate: { status: "awaiting_sync", workouts: [] },
    });

    await expect
      .element(
        page.getByRole("heading", {
          name: "Waiting for your next health sync",
        }),
      )
      .toBeVisible();
    await expect
      .element(page.getByText(/do not\s+need to keep this page open/i))
      .toBeVisible();
    await expect.element(page.getByRole("img")).not.toBeInTheDocument();
  });

  it("distinguishes a successful empty week from a delayed sync", async () => {
    render(WeeklyHeartRateReview, {
      heartRate: { status: "ready", workouts: [] },
    });

    await expect
      .element(
        page.getByRole("heading", {
          name: "No synced workout heart rate this week",
        }),
      )
      .toBeVisible();
    await expect
      .element(page.getByText(/rest of this review is complete/i))
      .toBeVisible();
  });

  it("manually syncs connected data and refreshes the weekly review", async () => {
    const refresh = vi.fn(async () => {});
    let submittedBody: Record<string, unknown> | undefined;
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        submittedBody = JSON.parse(String(init?.body)) as Record<
          string,
          unknown
        >;
        return Response.json({ configured: true, succeeded: 1, failed: 0 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    render(WeeklyHeartRateReview, {
      heartRate: { status: "awaiting_sync", workouts: [] },
      refresh,
    });

    await page.getByRole("button", { name: "Check for synced data" }).click();

    await expect
      .element(page.getByText(/review now shows the latest available data/i))
      .toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/fitness/sync",
      expect.objectContaining({ method: "POST", credentials: "same-origin" }),
    );
    expect(submittedBody).toMatchObject({
      trigger: "manual",
      timeZone: expect.any(String),
      localDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("surfaces a recoverable manual-sync failure", async () => {
    const refresh = vi.fn(async () => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ message: "Unavailable" }, { status: 503 }),
      ),
    );
    render(WeeklyHeartRateReview, {
      heartRate: { status: "ready", workouts: [] },
      refresh,
    });

    await page.getByRole("button", { name: "Check for synced data" }).click();

    await expect
      .element(page.getByText(/could not check for synced heart-rate data/i))
      .toBeVisible();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("fits a phone viewport and uses the Cute comparison palette", async () => {
    await page.viewport(320, 800);
    document.documentElement.dataset.theme = "cute";
    try {
      const result = render(WeeklyHeartRateReview, { heartRate: readyReview });
      const surface = result.container.querySelector(".weekly-heart-rate");
      const firstLine = result.container.querySelector(
        ".heart-rate-plot .series-line",
      );
      const firstToggle = result.container.querySelector(".series-toggle");
      expect(surface).not.toBeNull();
      expect(firstLine).not.toBeNull();
      expect(firstToggle).not.toBeNull();
      expect(result.container.scrollWidth).toBeLessThanOrEqual(
        result.container.clientWidth,
      );
      await expect.element(page.getByRole("img")).toBeVisible();
      expect(getComputedStyle(surface as HTMLElement).color).toBe(
        "rgb(50, 21, 35)",
      );
      expect([
        "rgb(162, 14, 82)",
        "rgb(107, 75, 161)",
        "rgb(20, 106, 148)",
        "rgb(30, 122, 85)",
        "rgb(148, 96, 0)",
        "rgb(180, 35, 60)",
      ]).toContain(getComputedStyle(firstLine as SVGElement).stroke);
      expect(getComputedStyle(firstToggle as HTMLElement).boxShadow).toBe(
        "none",
      );
    } finally {
      document.documentElement.dataset.theme = "orbital";
      await page.viewport(1280, 720);
    }
  });
});
