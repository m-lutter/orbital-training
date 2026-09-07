import type { DayOfWeek, TrainingProgram } from "$lib/domain";
import { describe, expect, it } from "vitest";
import {
  addIsoDateDays,
  parseIsoDate,
  programScheduleDateOffset,
  programScheduleStartDate,
  scheduledProgramWeekDates,
} from "./program-dates";

const ORDERED_WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

function programFixture(
  sessions: Array<{ day?: DayOfWeek; sequence: number; kind?: string }>,
): TrainingProgram {
  return {
    horizonWeeks: 2,
    weeks: [1, 2].map((weekNumber) => ({
      weekNumber,
      sessions: sessions.map((session, index) => ({
        id: `w${weekNumber}-session-${index + 1}`,
        weekNumber,
        sequence: session.sequence,
        ...(session.day === undefined ? {} : { day: session.day }),
        kind: session.kind ?? "lifting",
        title: "Session",
        exercises: [],
      })),
    })),
  } as unknown as TrainingProgram;
}

describe("scheduled program dates", () => {
  it("keeps every ordered weekday subset chronological for every raw start weekday", () => {
    const rawStarts = ORDERED_WEEKDAYS.map((_, offset) =>
      addIsoDateDays("2026-08-31", offset),
    );

    for (
      let weekdayMask = 1;
      weekdayMask < 1 << ORDERED_WEEKDAYS.length;
      weekdayMask += 1
    ) {
      const days = ORDERED_WEEKDAYS.filter(
        (_, index) => (weekdayMask & (1 << index)) !== 0,
      );
      const program = programFixture(
        days.map((day, index) => ({ day, sequence: index + 1 })),
      );

      for (const rawStart of rawStarts) {
        const scheduleStart = programScheduleStartDate(program, rawStart);
        const offsets = days.map((day) => {
          const date = scheduledProgramWeekDates(program, rawStart, 1).find(
            (candidate) => candidate.day === day,
          );
          if (date === undefined) throw new Error(`Missing ${day}`);
          return Math.floor(
            (parseIsoDate(date.isoDate).getTime() -
              parseIsoDate(scheduleStart).getTime()) /
              86_400_000,
          );
        });

        expect(offsets, `${rawStart}: ${days.join(", ")}`).toEqual(
          [...offsets].sort((left, right) => left - right),
        );
        expect(
          programScheduleDateOffset(program, rawStart, scheduleStart),
        ).toBe(0);
        expect(
          programScheduleDateOffset(
            program,
            rawStart,
            addIsoDateDays(scheduleStart, 6),
          ),
        ).toBe(6);
      }
    }
  });

  it("uses workout sequence rather than storage order to find the first day", () => {
    const program = programFixture([
      { day: "sunday", sequence: 2 },
      { day: "monday", sequence: 1 },
    ]);
    const before = structuredClone(program);

    expect(programScheduleStartDate(program, "2026-09-06")).toBe("2026-09-07");
    expect(program).toEqual(before);
  });

  it("preserves the chosen boundary when scheduled dates are already ordered", () => {
    const program = programFixture([
      { day: "tuesday", sequence: 1 },
      { day: "thursday", sequence: 2 },
    ]);
    expect(programScheduleStartDate(program, "2026-08-31")).toBe("2026-08-31");
  });

  it("keeps movement dates in the same shifted program week", () => {
    const program = programFixture([
      { day: "monday", sequence: 1 },
      { day: "sunday", sequence: 2 },
    ]);

    expect(programScheduleDateOffset(program, "2026-09-06", "2026-09-06")).toBe(
      -1,
    );
    expect(programScheduleDateOffset(program, "2026-09-06", "2026-09-07")).toBe(
      0,
    );
    expect(programScheduleDateOffset(program, "2026-09-06", "2026-09-13")).toBe(
      6,
    );
    expect(programScheduleDateOffset(program, "2026-09-06", "2026-09-14")).toBe(
      7,
    );
  });

  it("builds later program weeks from the aligned schedule boundary", () => {
    const program = programFixture([
      { day: "monday", sequence: 1 },
      { day: "sunday", sequence: 2 },
    ]);

    expect(
      scheduledProgramWeekDates(program, "2026-08-30", 2).map((day) => [
        day.day,
        day.isoDate,
      ]),
    ).toEqual([
      ["monday", "2026-09-07"],
      ["tuesday", "2026-09-08"],
      ["wednesday", "2026-09-09"],
      ["thursday", "2026-09-10"],
      ["friday", "2026-09-11"],
      ["saturday", "2026-09-12"],
      ["sunday", "2026-09-13"],
    ]);
  });

  it("falls back to the chosen date when sessions have no weekday", () => {
    const program = programFixture([{ sequence: 1 }]);
    expect(programScheduleStartDate(program, "2026-09-06")).toBe("2026-09-06");
  });

  it("does not infer an anchor from later sessions or a later week", () => {
    const undatedFirst = programFixture([
      { sequence: 1 },
      { day: "monday", sequence: 2 },
    ]);
    expect(programScheduleStartDate(undatedFirst, "2026-09-06")).toBe(
      "2026-09-06",
    );

    const blankFirstWeek = programFixture([{ day: "monday", sequence: 1 }]);
    const firstWeek = blankFirstWeek.weeks[0];
    if (firstWeek !== undefined) firstWeek.sessions = [];
    expect(programScheduleStartDate(blankFirstWeek, "2026-09-06")).toBe(
      "2026-09-06",
    );
  });
});
