import { describe, expect, it } from "vitest";
import type { TrainingProgram } from "$lib/domain";
import {
  buildProgramCalendar,
  calendarDayHref,
  calendarLeadingBlanks,
  highlightedCalendarDate,
} from "./program-calendar";

const PROGRAM_WEEK_DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

function programFixture(): TrainingProgram {
  return {
    horizonWeeks: 4,
    weeks: Array.from({ length: 4 }, (_, weekIndex) => ({
      weekNumber: weekIndex + 1,
      phase: "accumulation",
      hardSetBudget: 4,
      explanation: "",
      sessions: [
        {
          id: `w${weekIndex + 1}-lift`,
          weekNumber: weekIndex + 1,
          sequence: 1,
          day: "tuesday",
          kind: "lifting",
          title: "Full body",
          objective: "",
          exercises: [],
          predictedMinutes: 60,
          targetMinutes: 60,
          durationStatus: "fits",
          explanation: "",
        },
        {
          id: `w${weekIndex + 1}-cardio`,
          weekNumber: weekIndex + 1,
          sequence: 2,
          day: "thursday",
          kind: "cardio",
          title: "Easy cardio",
          objective: "",
          exercises: [],
          predictedMinutes: 25,
          targetMinutes: 25,
          durationStatus: "fits",
          explanation: "",
        },
      ],
    })),
  } as unknown as TrainingProgram;
}

function mondayThroughSundayFixture(): TrainingProgram {
  const program = programFixture();
  for (const week of program.weeks) {
    const template = week.sessions[0];
    if (template === undefined) throw new Error("Expected a scheduled session");
    week.sessions = PROGRAM_WEEK_DAYS.map((day, index) => ({
      ...structuredClone(template),
      id: `w${week.weekNumber}-${day}`,
      day,
      sequence: index + 1,
    }));
  }
  return program;
}

describe("first-month program calendar", () => {
  it("maps four weeks of dated sessions without changing the program", () => {
    const days = buildProgramCalendar(
      programFixture(),
      "2026-08-18",
      "program-1",
    );
    expect(days).toHaveLength(28);
    expect(days[0]).toMatchObject({
      isoDate: "2026-08-18",
      kind: "lifting",
      sessionIds: ["w1-lift"],
      href: "/programs/program-1/workouts/w1-lift",
    });
    expect(days[2]).toMatchObject({ isoDate: "2026-08-20", kind: "cardio" });
    expect(days[7]).toMatchObject({ weekNumber: 2, kind: "lifting" });
  });

  it("can render one program week beginning on the program's own start-date boundary", () => {
    const days = buildProgramCalendar(
      programFixture(),
      "2026-08-18",
      "program-1",
      { startWeek: 2, dayCount: 7 },
    );
    expect(days).toHaveLength(7);
    expect(days[0]).toMatchObject({
      isoDate: "2026-08-25",
      weekNumber: 2,
      sessionIds: ["w2-lift"],
    });
    expect(days.at(-1)?.isoDate).toBe("2026-08-31");
  });

  it.each([
    ["monday", "2026-08-31", "2026-08-31", "2026-09-06"],
    ["tuesday", "2026-09-01", "2026-09-07", "2026-09-13"],
    ["wednesday", "2026-09-02", "2026-09-07", "2026-09-13"],
    ["thursday", "2026-09-03", "2026-09-07", "2026-09-13"],
    ["friday", "2026-09-04", "2026-09-07", "2026-09-13"],
    ["saturday", "2026-09-05", "2026-09-07", "2026-09-13"],
    ["sunday", "2026-09-06", "2026-09-07", "2026-09-13"],
  ])(
    "aligns a Monday-first plan after a %s raw start date",
    (_weekday, startDate, expectedMonday, expectedSunday) => {
      const days = buildProgramCalendar(
        mondayThroughSundayFixture(),
        startDate,
        "program-1",
        { dayCount: 7 },
      );

      expect(days[0]).toMatchObject({
        isoDate: expectedMonday,
        day: "monday",
        sessionIds: ["w1-monday"],
      });
      expect(days.at(-1)).toMatchObject({
        isoDate: expectedSunday,
        day: "sunday",
        sessionIds: ["w1-sunday"],
      });
      expect(days.map((day) => day.day)).toEqual(PROGRAM_WEEK_DAYS);
      expect(days.map((day) => day.sessionIds)).toEqual(
        PROGRAM_WEEK_DAYS.map((day) => [`w1-${day}`]),
      );
    },
  );

  it.each([
    ["week rollover", "2026-08-30", 2, "2026-09-07", "2026-09-13"],
    ["new year", "2026-12-30", 1, "2027-01-04", "2027-01-10"],
    ["spring DST", "2026-03-08", 1, "2026-03-09", "2026-03-15"],
    ["fall DST", "2026-10-31", 1, "2026-11-02", "2026-11-08"],
  ])(
    "keeps Monday-to-Sunday dates ordered across %s",
    (_boundary, startDate, startWeek, expectedMonday, expectedSunday) => {
      const days = buildProgramCalendar(
        mondayThroughSundayFixture(),
        startDate,
        "program-1",
        { startWeek, dayCount: 7 },
      );

      expect(days[0]?.isoDate).toBe(expectedMonday);
      expect(days.at(-1)?.isoDate).toBe(expectedSunday);
      expect(days[0]?.sessionIds).toEqual([`w${startWeek}-monday`]);
      expect(days.at(-1)?.sessionIds).toEqual([`w${startWeek}-sunday`]);
    },
  );

  it("creates Sunday-first leading cells", () => {
    expect(calendarLeadingBlanks("2026-08-18")).toHaveLength(2);
  });

  it("shows lifting and cardio on the same day as one combined calendar day", () => {
    const program = programFixture();
    const firstWeekCardio = program.weeks[0]?.sessions[1];
    if (firstWeekCardio) firstWeekCardio.day = "tuesday";
    const firstDay = buildProgramCalendar(
      program,
      "2026-08-18",
      "program-1",
    )[0];
    expect(firstDay).toMatchObject({
      kind: "combined",
      title: "Lift + cardio",
      sessionIds: ["w1-lift", "w1-cardio"],
      href: "/programs/program-1/workouts/w1-lift",
    });
  });

  it("highlights the first program date before any training day is finished", () => {
    const days = buildProgramCalendar(
      programFixture(),
      "2026-08-17",
      "program-1",
    );
    expect(days[0]?.kind).toBe("rest");
    expect(highlightedCalendarDate(days, {})).toBe("2026-08-17");
  });

  it("uses the same selected workout as the dashboard action", () => {
    const days = buildProgramCalendar(
      programFixture(),
      "2026-08-17",
      "program-1",
    );
    expect(highlightedCalendarDate(days, {}, "w1-lift")).toBe("2026-08-18");
  });

  it("opens the shared next workout when lifting and cardio share a date", () => {
    const program = programFixture();
    const firstWeekCardio = program.weeks[0]?.sessions[1];
    if (firstWeekCardio) firstWeekCardio.day = "tuesday";
    const day = buildProgramCalendar(program, "2026-08-18", "program-1")[0];
    expect(day?.kind).toBe("combined");
    expect(
      day === undefined
        ? undefined
        : calendarDayHref(day, "program-1", "w1-cardio"),
    ).toBe("/programs/program-1/workouts/w1-cardio");
  });

  it("advances to the earliest unfinished non-rest day after training begins", () => {
    const days = buildProgramCalendar(
      programFixture(),
      "2026-08-18",
      "program-1",
    );
    expect(
      highlightedCalendarDate(days, {
        "w1-lift": "completed",
      }),
    ).toBe("2026-08-20");
    expect(
      highlightedCalendarDate(days, {
        "w1-lift": "completed",
        "w1-cardio": "partial",
      }),
    ).toBe("2026-08-25");
  });
});
