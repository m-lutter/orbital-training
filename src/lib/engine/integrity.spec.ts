import { describe, expect, it } from "vitest";
import { generateProgram } from "$lib/domain/generator";
import { baseInput } from "$lib/domain/tests/fixtures";
import { createStoredProgramV3 } from "./v3";
import { parseProgramDraft } from "./parse";

function draft() {
  const input = baseInput();
  const program = generateProgram(input).program;
  if (!program) throw new Error("Expected program");
  return createStoredProgramV3(input, program);
}

describe("new-program relational integrity and legacy compatibility", () => {
  it("rejects zero-rep prescriptions and collisions with movement session IDs", () => {
    const value = draft();
    const session = value.program.weeks[0].sessions.find(
      (item) => item.exercises.length,
    )!;
    session.exercises[0].reps = { min: 0, max: 0 };
    expect(() => parseProgramDraft(value)).toThrow();
    const collision = draft();
    const first = collision.program.weeks[0].sessions[0];
    collision.program.weeks[0].sessions.push({
      ...structuredClone(first),
      kind: "movement",
      exercises: [],
      cardio: undefined,
    });
    expect(() => parseProgramDraft(collision)).toThrow();
  });
  it("survives JSON serialization including optional undefined questionnaire fields", () => {
    const value = draft();
    expect(parseProgramDraft(JSON.parse(JSON.stringify(value)))).toEqual(
      JSON.parse(JSON.stringify(value)),
    );
  });
  it.each([
    "session",
    "week",
    "horizon",
    "fingerprint",
    "version",
    "specificity",
  ])("rejects %s corruption", (kind) => {
    const value = draft();
    if (kind === "session")
      value.program.weeks[0].sessions[1].id =
        value.program.weeks[0].sessions[0].id;
    if (kind === "week") value.program.weeks[1].weekNumber = 1;
    if (kind === "horizon") value.program.horizonWeeks += 1;
    if (kind === "fingerprint") value.inputSnapshot.age += 1;
    if (kind === "version") value.policyVersion = "wrong";
    if (kind === "specificity")
      value.program.weeks[0].sessions
        .find((session) => session.exercises.length)
        ?.exercises.forEach((exercise) => {
          exercise.reps.max += 1;
        });
    expect(() => parseProgramDraft(value)).toThrow();
  });
  it("rejects malformed nested cardio and advanced input fields", () => {
    const value = draft();
    const cardio = value.program.weeks[0].sessions.find(
      (session) => session.cardio,
    )?.cardio;
    if (!cardio) throw new Error("Expected cardio");
    cardio.intervals = { repeats: -2, workSeconds: 60, recoverySeconds: 30 };
    expect(() => parseProgramDraft(value)).toThrow();
    const malformed = draft();
    malformed.inputSnapshot.cardio.advanced = {
      intensityMethod: "invalid" as "talk_test_rpe",
    };
    expect(() => parseProgramDraft(malformed)).toThrow();
  });
  it.each([
    "duplicate",
    "missing_required",
    "reduced_required",
    "mismatched_ids",
  ])("rejects %s short alternative", (kind) => {
    const value = draft();
    const session = value.program.weeks[0].sessions.find(
      (item) => item.exercises.length,
    )!;
    session.durationAlternative = {
      targetMinutes: session.targetMinutes,
      predictedMinutes: session.predictedMinutes,
      exerciseIds: session.exercises.map((item) => item.id),
      prescriptions: session.exercises.map((item) => ({
        prescriptionId: item.id,
        sets: item.sets,
      })),
      explanation: "Short plan",
    };
    expect(() => parseProgramDraft(value)).not.toThrow();
    const alternative = session.durationAlternative;
    const required = session.exercises.find((item) => !item.optional)!;
    if (kind === "duplicate") {
      alternative.prescriptions.push(alternative.prescriptions[0]);
      alternative.exerciseIds.push(alternative.exerciseIds[0]);
    }
    if (kind === "missing_required") {
      alternative.prescriptions = alternative.prescriptions.filter(
        (item) => item.prescriptionId !== required.id,
      );
      alternative.exerciseIds = alternative.exerciseIds.filter(
        (id) => id !== required.id,
      );
    }
    if (kind === "reduced_required")
      alternative.prescriptions.find(
        (item) => item.prescriptionId === required.id,
      )!.sets -= 1;
    if (kind === "mismatched_ids")
      alternative.exerciseIds[0] = "not-a-prescription";
    expect(() => parseProgramDraft(value)).toThrow();
  });
  it("keeps legacy adult/youth payloads readable without retroactively enforcing generation gates", () => {
    const value = draft();
    delete value.program.integrityVersion;
    delete value.program.effectiveScheduleStartDate;
    value.inputSnapshot.age = 13;
    value.inputSnapshot.safety.clinicianRestrictions = ["Legacy stored note"];
    value.engineVersion = "0.11.0";
    value.program.engineVersion = "0.11.0";
    expect(parseProgramDraft(value).schemaVersion).toBe(3);
  });
});
