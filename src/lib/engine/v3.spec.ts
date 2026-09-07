import { generateProgram } from "$lib/domain";
import { baseInput, meetPowerlifterInput } from "$lib/domain/tests/fixtures";
import { describe, expect, it } from "vitest";
import {
  normalizeLegacyProgramDraft,
  parseProgramDraft,
  readProgramDraft,
} from "./parse";
import { createStoredProgramV3 } from "./v3";

describe("schema-v3 program storage", () => {
  it("round-trips a full generated program through the payload parser", () => {
    const input = meetPowerlifterInput();
    const program = generateProgram(input).program;
    if (program === undefined) throw new Error("Expected generated program");
    const stored = createStoredProgramV3(input, program);
    expect(stored.questionnaireVersion).toBe(3);
    expect(parseProgramDraft(structuredClone(stored))).toEqual(stored);
    expect(
      stored.decisions.some((decision) => decision.input === "timeZone"),
    ).toBe(true);
  });

  it("returns a detached payload without mutating or sharing the caller's data", () => {
    const input = baseInput();
    const program = generateProgram(input).program;
    if (program === undefined) throw new Error("Expected generated program");
    const stored = createStoredProgramV3(input, program);
    const before = structuredClone(stored);
    const parsed = parseProgramDraft(stored);
    expect(stored).toEqual(before);
    if (parsed.schemaVersion !== 3) throw new Error("Expected schema v3");
    parsed.program.weeks[0]!.explanation = "changed after parsing";
    expect(stored).toEqual(before);
  });

  it("keeps legacy repair separate from strict parsing", () => {
    const input = meetPowerlifterInput();
    const program = generateProgram(input).program;
    if (program === undefined) throw new Error("Expected generated program");
    const stored = createStoredProgramV3(input, program);
    const squat = stored.program.weeks
      .flatMap((week) => week.sessions)
      .flatMap((session) => session.exercises)
      .find((exercise) => exercise.exerciseId === "competition_squat");
    if (squat === undefined) throw new Error("Expected competition squat");
    squat.name = "Competition low-bar";
    const strict = parseProgramDraft(stored);
    if (strict.schemaVersion !== 3) throw new Error("Expected schema v3");
    expect(
      strict.program.weeks
        .flatMap((week) => week.sessions)
        .flatMap((session) => session.exercises)
        .find((exercise) => exercise.exerciseId === "competition_squat")?.name,
    ).toBe("Competition low-bar");
    const normalized = normalizeLegacyProgramDraft(strict);
    const read = readProgramDraft(stored);
    if (normalized.schemaVersion !== 3 || read.schemaVersion !== 3)
      throw new Error("Expected schema v3");
    expect(
      normalized.program.weeks
        .flatMap((week) => week.sessions)
        .flatMap((session) => session.exercises)
        .find((exercise) => exercise.exerciseId === "competition_squat")?.name,
    ).toBe("Competition low-bar squat");
    expect(read).toEqual(normalized);
    expect(squat.name).toBe("Competition low-bar");
  });

  it("retains the exact successful questionnaire values for later editing", () => {
    const input = baseInput();
    const program = generateProgram(input).program;
    if (program === undefined) throw new Error("Expected generated program");
    const formValues = {
      primaryGoal: "health",
      secondaryGoal: "none",
      primaryWeight: "100",
      preferredTrainingDays: ["monday", "wednesday", "friday"],
      scheduleAdvancedEnabled: "yes",
      cardioWeeklyMinutes: "",
    };
    const stored = createStoredProgramV3(input, program, formValues);
    const parsed = parseProgramDraft(structuredClone(stored));
    expect(parsed.schemaVersion).toBe(3);
    if (parsed.schemaVersion !== 3) throw new Error("Expected schema v3");
    expect(parsed.questionnaireFormValues).toEqual(formValues);
  });

  it("clones form values so later UI mutations cannot rewrite saved history", () => {
    const input = baseInput();
    const program = generateProgram(input).program;
    if (program === undefined) throw new Error("Expected generated program");
    const formValues = {
      preferredTrainingDays: ["monday", "friday"],
    };
    const stored = createStoredProgramV3(input, program, formValues);
    formValues.preferredTrainingDays[0] = "sunday";
    expect(stored.questionnaireFormValues?.preferredTrainingDays).toEqual([
      "monday",
      "friday",
    ]);
  });

  it("rejects malformed saved questionnaire form values", () => {
    const input = baseInput();
    const program = generateProgram(input).program;
    if (program === undefined) throw new Error("Expected generated program");
    const stored = createStoredProgramV3(input, program, {
      primaryGoal: "health",
    }) as unknown as Record<string, unknown>;
    stored.questionnaireFormValues = { preferredTrainingDays: ["monday", 2] };
    expect(() => parseProgramDraft(stored)).toThrow(
      "invalid week or session data",
    );
  });

  it("rejects malformed v3 session data", () => {
    const input = baseInput();
    const program = generateProgram(input).program;
    if (program === undefined) throw new Error("Expected generated program");
    const stored = createStoredProgramV3(input, program);
    const malformed = structuredClone(stored) as unknown as Record<
      string,
      unknown
    >;
    const nestedProgram = malformed.program as {
      weeks: { sessions: unknown[] }[];
    };
    nestedProgram.weeks[0]!.sessions = [{ id: "broken" }];
    expect(() => parseProgramDraft(malformed)).toThrow(
      "invalid week or session data",
    );
  });

  it("round-trips prescribed set blocks and rejects orphaned block entries", () => {
    const input = baseInput();
    input.goals = {
      ...input.goals,
      primary: "hypertrophy",
    };
    input.hypertrophy = {
      splitPreference: "full_body",
      splitPreferenceStrength: "slight",
      balance: "balanced",
      musclePriorities: [],
      preserveCompetitionLifts: false,
      exerciseSelection: "offer_choices",
      useSupersets: true,
    };
    const program = generateProgram(input).program;
    if (program === undefined) throw new Error("Expected generated program");
    const stored = createStoredProgramV3(input, program);
    expect(parseProgramDraft(structuredClone(stored))).toEqual(stored);

    const malformed = structuredClone(stored);
    const session = malformed.program.weeks
      .flatMap((week) => week.sessions)
      .find((item) => (item.setBlocks?.length ?? 0) > 0);
    if (session?.setBlocks === undefined) throw new Error("Expected blocks");
    session.setBlocks[0]!.sequence[0]!.prescriptionId = "orphan";
    expect(() => parseProgramDraft(malformed)).toThrow(
      "invalid week or session data",
    );
  });
});
