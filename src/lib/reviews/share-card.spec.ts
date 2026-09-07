import { describe, expect, it } from "vitest";
import { buildWeeklyReviewShareSvg } from "./share-card";

const model = {
  programName: "Base & Build",
  weekNumber: 1,
  headline: "You nailed the plan this week!",
  takeaway: "Useful work is in the bank.",
  metrics: {
    weekNumber: 1,
    plannedSessions: 3,
    completedSessions: 3,
    partialSessions: 0,
    skippedSessions: 0,
    plannedSets: 12,
    completedSets: 12,
    requiredPlannedSets: 9,
    requiredCompletedSets: 9,
    accessoryPlannedSets: 3,
    accessoryCompletedSets: 3,
    plannedCardioMinutes: 30,
    completedCardioMinutes: 30,
    cardioDistance: 0,
    cardioDistanceUnit: "mi" as const,
    cardioSteps: 0,
  },
  charts: [
    {
      id: "volume",
      title: "Total lifting volume",
      unit: "lb × reps",
      weeks: [1],
      goal: "powerlifting" as const,
      series: [{ label: "All lifts", color: "#3158a6", values: [12000] }],
    },
  ],
};

describe("weekly review share card", () => {
  it("creates a portrait image source with the key review information", () => {
    const svg = buildWeeklyReviewShareSvg(model);
    expect(svg).toContain('width="1080" height="1350"');
    expect(svg).toContain("You nailed the plan");
    expect(svg).toContain("12,000");
    expect(svg).toContain("9/9 sets");
  });

  it("escapes user-controlled program names", () => {
    expect(buildWeeklyReviewShareSvg(model)).toContain("Base &amp; Build");
  });

  it("renders recent weeks as a trend instead of only the latest value", () => {
    const svg = buildWeeklyReviewShareSvg({
      ...model,
      weekNumber: 3,
      charts: [
        {
          ...model.charts[0]!,
          weeks: [1, 2, 3],
          series: [
            {
              label: "All lifts",
              color: "#3158a6",
              values: [10_000, 11_000, 12_000],
            },
          ],
        },
      ],
    });
    expect(svg).toContain(">W1<");
    expect(svg).toContain(">W2<");
    expect(svg).toContain(">W3<");
    expect(svg).toContain("All lifts 12,000");
  });
});
