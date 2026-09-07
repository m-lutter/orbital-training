import { describe, expect, it } from "vitest";
import {
  generateLegacyProgramV2 as generateProgram,
  generateLegacyProgramV1 as generateProgramShell,
  parseProgramDraft,
} from "./index";

const input = {
  questionnaireVersion: 1 as const,
  primaryGoal: "powerlifting" as const,
  liftingDaysPerWeek: 4,
  cardioDaysPerWeek: 2,
  liftingSessionMinutes: 90,
  cardioSessionMinutes: 30,
  programLength: { mode: "fixed" as const, weeks: 4 },
};

describe("parseProgramDraft", () => {
  it("accepts legacy schema-v1 programs", () => {
    const stored = generateProgramShell(input);
    const parsed = parseProgramDraft(stored);
    expect(parsed.schemaVersion).toBe(1);
    if (parsed.schemaVersion !== 1) throw new Error("Expected schema v1");
    parsed.weeks[0]!.sessions[0]!.targetMinutes = 999;
    expect(stored.weeks[0]!.sessions[0]!.targetMinutes).not.toBe(999);
  });

  it("accepts schema-v2 prescriptions", () => {
    expect(parseProgramDraft(generateProgram(input)).schemaVersion).toBe(2);
  });

  it("rejects malformed schema-v2 exercises", () => {
    const program = generateProgram(input);
    const malformed = structuredClone(program) as unknown as {
      weeks: Array<{ sessions: Array<Record<string, unknown>> }>;
    };
    malformed.weeks[0].sessions[0].exercises = [
      { name: "No prescription fields" },
    ];
    expect(() => parseProgramDraft(malformed)).toThrow(
      "invalid week or session data",
    );
  });
});
