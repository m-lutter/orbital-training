import type { IsoDate, TrainingProgram } from "$lib/domain";
import { page } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import ProgramCalendar from "./ProgramCalendar.svelte";
import { buildProgramCalendar } from "./program-calendar";

const program = {
  horizonWeeks: 1,
  weeks: [
    {
      weekNumber: 1,
      sessions: [
        {
          id: "lift-1",
          sequence: 1,
          day: "tuesday",
          kind: "lifting",
          title: "Full body",
          exercises: [],
        },
        {
          id: "cardio-1",
          sequence: 2,
          day: "tuesday",
          kind: "cardio",
          title: "Easy cardio",
          exercises: [],
        },
      ],
    },
  ],
} as unknown as TrainingProgram;
const days = buildProgramCalendar(
  program,
  "2026-08-18" as IsoDate,
  "program-1",
);

describe("ProgramCalendar", () => {
  it("opens the same session as Next workout on a combined day", async () => {
    render(ProgramCalendar, {
      days,
      programId: "program-1",
      startDate: "2026-08-18" as IsoDate,
      sessionStatuses: { "lift-1": "completed" },
      nextSessionId: "cardio-1",
    });

    const nextDay = page.getByRole("link", {
      name: "2026-08-18: Lift + cardio",
    });
    await expect
      .element(nextDay)
      .toHaveAttribute("href", "/programs/program-1/workouts/cardio-1");
  });

  it("fits the 320 px mobile viewport without horizontal overflow", async () => {
    await page.viewport(320, 800);
    const result = await render(ProgramCalendar, {
      days,
      programId: "program-1",
      startDate: "2026-08-18" as IsoDate,
      sessionStatuses: {},
      nextSessionId: "lift-1",
    });

    expect(result.container.scrollWidth).toBeLessThanOrEqual(
      result.container.clientWidth,
    );
  });

  it("shows a seven-day program week without calendar-leading blanks", async () => {
    await page.viewport(320, 800);
    const result = render(ProgramCalendar, {
      days,
      programId: "program-1",
      startDate: "2026-08-18" as IsoDate,
      view: "week",
      sessionStatuses: {},
    });

    await expect
      .element(page.getByRole("heading", { name: "This week’s plan" }))
      .toBeVisible();
    await expect
      .element(page.getByRole("grid", { name: "Seven-day training plan" }))
      .toBeVisible();
    expect(result.container.querySelectorAll(".blank")).toHaveLength(0);
    await expect
      .element(page.getByText("Tue 18", { exact: true }))
      .toBeVisible();
  });

  it("aligns month leading cells to the first scheduled date", () => {
    const wrappingProgram = structuredClone(program);
    const monday = wrappingProgram.weeks[0]?.sessions[0];
    const sunday = wrappingProgram.weeks[0]?.sessions[1];
    if (monday === undefined || sunday === undefined)
      throw new Error("Expected two scheduled sessions");
    monday.day = "monday";
    monday.sequence = 1;
    sunday.day = "sunday";
    sunday.sequence = 2;
    const alignedDays = buildProgramCalendar(
      wrappingProgram,
      "2026-08-16" as IsoDate,
      "program-1",
    );
    const result = render(ProgramCalendar, {
      days: alignedDays,
      programId: "program-1",
      startDate: "2026-08-16" as IsoDate,
      sessionStatuses: {},
    });

    expect(alignedDays[0]?.isoDate).toBe("2026-08-17");
    expect(result.container.querySelectorAll(".blank")).toHaveLength(1);
  });

  it("uses light, readable training-day cards in Cute mode", () => {
    document.documentElement.dataset.theme = "cute";
    try {
      const result = render(ProgramCalendar, {
        days,
        programId: "program-1",
        startDate: "2026-08-18" as IsoDate,
        view: "week",
        sessionStatuses: {},
      });
      const trainingDay = result.container.querySelector(".calendar-day");
      expect(trainingDay).not.toBeNull();
      expect(getComputedStyle(trainingDay as HTMLElement).color).toBe(
        "rgb(50, 21, 35)",
      );
    } finally {
      document.documentElement.dataset.theme = "orbital";
    }
  });

  it("does not let the calendar bypass a required weekly review", async () => {
    render(ProgramCalendar, {
      days,
      programId: "program-1",
      startDate: "2026-08-18" as IsoDate,
      enabled: false,
      sessionStatuses: { "lift-1": "completed" },
      nextSessionId: undefined,
    });

    await expect
      .element(page.getByRole("link", { name: /2026-08-18/ }))
      .not.toBeInTheDocument();
  });
});
