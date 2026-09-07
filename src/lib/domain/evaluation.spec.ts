import { describe, expect, it } from "vitest";
import { generateProgram } from "./generator";
import {
  compareProgramCandidates,
  programQualitySnapshot,
  summarizeTrainingOutcomes,
} from "./evaluation";
import { baseInput } from "./tests/fixtures";

describe("offline engine evaluation", () => {
  it("reports exact prescriptions and no invariant failures for the reference persona", () => {
    const input = baseInput();
    const program = generateProgram(input).program!;
    const snapshot = programQualitySnapshot(program, input);
    expect(snapshot.blockingInvariants).toEqual([]);
    expect(snapshot.specificPrescriptions).toBe(snapshot.exerciseExposures);
  });
  it("compares candidates without changing either active plan", () => {
    const program = generateProgram(baseInput()).program!;
    const original = structuredClone(program);
    const next = structuredClone(program);
    next.weeks[0].sessions[0].title = "Candidate only";
    expect(compareProgramCandidates(program, next).changedSessionIds).toEqual([
      program.weeks[0].sessions[0].id,
    ]);
    expect(program).toEqual(original);
  });
  it("keeps no-data outcomes undefined and deduplicates repeated logs", () => {
    const program = generateProgram(baseInput()).program!;
    expect(
      summarizeTrainingOutcomes(program, []).completionFraction,
    ).toBeUndefined();
    const session = program.weeks[0].sessions[0];
    const log = {
      weekNumber: 1,
      sessions: [
        {
          sessionId: session.id,
          status: "completed" as const,
          durationMinutes: session.predictedMinutes + 5,
          exercises: [],
        },
      ],
    };
    expect(summarizeTrainingOutcomes(program, [log, log])).toMatchObject({
      attempted: 1,
      completed: 1,
      meanAbsoluteDurationErrorMinutes: 5,
    });
  });
});
