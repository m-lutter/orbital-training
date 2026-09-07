import { describe, expect, it } from "vitest";
import { generateProgram, type DayOfWeek, type IsoDate } from "$lib/domain";
import { meetPowerlifterInput } from "$lib/domain/tests/fixtures";
import { createStoredProgramV3 } from "$lib/engine/v3";
import { presentProgramOverview } from "./program-overview";

function draftWithFirstWeekDays(startDate: IsoDate, days: DayOfWeek[]) {
  const input = meetPowerlifterInput();
  input.goals.startDate = startDate;
  const generated = generateProgram(input);
  const program = generated.program;
  const firstWeek = program?.weeks[0];
  const template = firstWeek?.sessions.find(
    (session) => session.kind !== "movement",
  );
  if (
    program === undefined ||
    firstWeek === undefined ||
    template === undefined
  )
    throw new Error("Expected a generated first-week workout");

  const movement = firstWeek.sessions.filter(
    (session) => session.kind === "movement",
  );
  firstWeek.sessions = [
    ...days.map((day, index) => ({
      ...structuredClone(template),
      id: `w1-${day}`,
      day,
      sequence: index + 1,
    })),
    ...movement,
  ];
  return createStoredProgramV3(input, program);
}

describe("program overview presentation", () => {
  it("keeps the full calculation payload off the client route", () => {
    const input = meetPowerlifterInput();
    const generated = generateProgram(input);
    expect(generated.program).toBeDefined();
    const draft = createStoredProgramV3(input, generated.program!);
    const overview = presentProgramOverview(draft, {});
    const fullBytes = Buffer.byteLength(JSON.stringify(draft));
    const overviewJson = JSON.stringify(overview);

    expect(overview.weeks).toHaveLength(draft.program.weeks.length);
    expect(overview.weeks[0]?.sessions.length).toBeGreaterThan(0);
    expect(overview.weeks[0]).not.toHaveProperty("days");
    expect(overview.details.map((detail) => detail.title)).toContain(
      "Body weight",
    );
    expect(overviewJson).not.toContain('"alternativeChoices"');
    expect(overviewJson).not.toContain('"questionEffects"');
    expect(overviewJson).not.toContain("weight.initialBodyWeight");
    expect(overviewJson).not.toContain('"engineVersion"');
    expect(Buffer.byteLength(overviewJson)).toBeLessThan(fullBytes * 0.35);
  });

  it("leaves unknown workout weights blank in the overview", () => {
    const input = meetPowerlifterInput();
    const generated = generateProgram(input);
    const draft = createStoredProgramV3(input, generated.program!);
    const overview = presentProgramOverview(draft, {});

    expect(
      overview.weeks
        .flatMap((week) => week.sessions)
        .flatMap((session) =>
          session.exercises.map((exercise) => exercise.weight),
        ),
    ).toContain("");
    expect(JSON.stringify(overview)).not.toContain("Find your starting weight");
  });

  it("shows the effective start when the chosen boundary inverts workout order", () => {
    const draft = draftWithFirstWeekDays("2026-08-09", ["monday", "sunday"]);

    const overview = presentProgramOverview(draft, {});

    expect(draft.inputSnapshot.goals.startDate).toBe("2026-08-09");
    expect(overview.startDate).toBe("2026-08-10");
  });

  it("preserves the chosen start when workout order is already chronological", () => {
    const draft = draftWithFirstWeekDays("2026-08-10", ["tuesday", "thursday"]);

    const overview = presentProgramOverview(draft, {});

    expect(overview.startDate).toBe("2026-08-10");
  });
});
