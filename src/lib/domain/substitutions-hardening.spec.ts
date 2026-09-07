import { describe, expect, it } from "vitest";
import { generateProgram } from "./generator";
import {
  applyPermanentExerciseSubstitutions,
  createEquipmentVariant,
} from "./substitutions";
import { estimateSessionMinutes } from "./duration";
import { baseInput, meetPowerlifterInput } from "./tests/fixtures";
import { createStoredProgramV3 } from "../engine/v3";
import { parseProgramDraft } from "../engine/parse";
import { EXERCISES } from "./exercises";

describe("substitution integrity", () => {
  it("returns omitted unavailable work and clears stale blocks/short options even without a replacement", () => {
    const input = meetPowerlifterInput();
    const program = generateProgram(input).program!;
    input.safety.excludedExercises = EXERCISES.map((item) => item.id);
    const before = structuredClone(program);
    const result = createEquipmentVariant(program, input, [], 1);
    expect(result.changedExerciseCount).toBeGreaterThan(0);
    expect(
      result.changes.some((change) => change.after?.startsWith("Omitted:")),
    ).toBe(true);
    for (const session of result.program.weeks[0].sessions.filter(
      (session) => session.kind === "lifting",
    )) {
      expect(session.exercises).toHaveLength(0);
      expect(session.setBlocks).toEqual([]);
      expect(session.durationAlternative).toBeUndefined();
      expect(session.predictedMinutes).toBe(0);
    }
    expect(result.program.weeks[1]).toEqual(before.weeks[1]);
    expect(program).toEqual(before);
  });

  it.each([true, false])(
    "recalculates only changed future sessions with questionnaire context=%s",
    (withInput) => {
      const input = baseInput();
      const program = generateProgram(input).program!;
      const first = program.weeks[0].sessions.find((session) =>
        session.exercises.some((item) => item.alternativeChoices.length),
      )!;
      const original = first.exercises.find(
        (item) => item.alternativeChoices.length,
      )!;
      const replacement = original.alternativeChoices[0].exerciseId;
      const before = structuredClone(program);
      const result = applyPermanentExerciseSubstitutions(
        program,
        [
          {
            originalExerciseId: original.exerciseId,
            replacementExerciseId: replacement,
          },
        ],
        first.weekNumber,
        first.sequence,
        withInput ? input : undefined,
      );
      expect(result.changedPrescriptionCount).toBeGreaterThan(0);
      expect(
        result.program.weeks[0].sessions.find(
          (session) => session.id === first.id,
        ),
      ).toEqual(first);
      for (const session of result.program.weeks.flatMap(
        (week) => week.sessions,
      )) {
        if (!session.exercises.some((item) => item.exerciseId === replacement))
          continue;
        expect(session.predictedMinutes).toBe(
          estimateSessionMinutes(
            session.exercises,
            session.cardio?.minutes ?? 0,
            session.setBlocks,
          ),
        );
        expect(session.durationAlternative).toBeUndefined();
      }
      expect(() =>
        parseProgramDraft(createStoredProgramV3(input, result.program)),
      ).not.toThrow();
      expect(program).toEqual(before);
    },
  );
});
