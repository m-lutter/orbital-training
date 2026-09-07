import { generateProgram } from "$lib/domain";
import { meetPowerlifterInput } from "$lib/domain/tests/fixtures";
import { createStoredProgramV3 } from "$lib/engine";
import { describe, expect, it } from "vitest";
import {
  applyProgramReversePatch,
  createProgramReversePatch,
  parseProgramReversePatch,
  programReversePatchForWrite,
  reconstructProgramHistoryVersion,
} from "./program-history";

function versionPair() {
  const input = meetPowerlifterInput();
  const generated = generateProgram(input).program;
  if (generated === undefined) throw new Error("Fixture did not generate.");
  const previous = createStoredProgramV3(input, generated);
  const next = structuredClone(previous);
  next.program.version = 2;
  const changedExercise = next.program.weeks
    .flatMap((week) => week.sessions)
    .flatMap((session) => session.exercises)[0]!;
  changedExercise.reps.min += 1;
  changedExercise.reps.max += 1;
  next.decisions.push({
    input: "Week 1 review",
    effect: "One future target changed.",
    ruleIds: ["test.history"],
  });
  return { previous, next };
}

describe("compact program history", () => {
  it("reconstructs the preceding generated program exactly", () => {
    const { previous, next } = versionPair();
    const patch = createProgramReversePatch(previous, next);
    expect(applyProgramReversePatch(next, patch)).toEqual(previous);
    expect(next.program.version).toBe(2);
  });

  it("handles added, removed, and changed object values deterministically", () => {
    const { previous, next } = versionPair();
    previous.questionnaireFormValues = { retained: "yes", removed: "old" };
    next.questionnaireFormValues = { retained: "no", added: ["new"] };
    const first = createProgramReversePatch(previous, next);
    const second = createProgramReversePatch(previous, next);
    expect(first).toEqual(second);
    expect(applyProgramReversePatch(next, first)).toEqual(previous);
  });

  it("rejects malformed and prototype-polluting paths", () => {
    expect(() => parseProgramReversePatch({})).toThrow(
      "patch must be an array",
    );
    expect(() => parseProgramReversePatch([[1, ["__proto__"]]])).toThrow(
      "unsafe key",
    );
    expect(() => parseProgramReversePatch([[7, []]])).toThrow("unknown opcode");
  });

  it("falls back to a full historical snapshot when a patch is too large", () => {
    const { previous, next } = versionPair();
    previous.program.explanation = "x".repeat(300_000);
    next.program.explanation = "Updated explanation.";
    expect(programReversePatchForWrite(previous, next)).toBeNull();
  });

  it("reconstructs mixed full and reverse-patch history", () => {
    const { previous: version1, next: version2 } = versionPair();
    const version3 = structuredClone(version2);
    version3.program.version = 3;
    version3.program.warnings.push({
      code: "history-test",
      severity: "info",
      message: "A later version.",
      ruleIds: ["test.history"],
    });
    const patch2 = createProgramReversePatch(version2, version3);

    expect(
      reconstructProgramHistoryVersion(
        version3,
        [
          {
            versionNumber: 1,
            storageFormat: "full_v3",
            payload: version1,
          },
          {
            versionNumber: 2,
            storageFormat: "reverse_patch_v1",
            reversePatch: patch2,
          },
          {
            versionNumber: 3,
            storageFormat: "current_anchor_v1",
          },
        ],
        1,
      ),
    ).toEqual(version1);
  });

  it("rejects version-preserving structural corruption in a reverse patch", () => {
    const { previous, next } = versionPair();
    const patch = createProgramReversePatch(previous, next);
    patch.push([
      0,
      ["program", "weeks", 0, "sessions", 0, "exercises", 0, "sets"],
      0,
    ]);
    expect(() =>
      reconstructProgramHistoryVersion(
        next,
        [
          {
            versionNumber: 1,
            storageFormat: "reverse_patch_v1",
            reversePatch: patch,
          },
        ],
        1,
      ),
    ).toThrow("failed schema verification");
    expect(next.program.version).toBe(2);
    expect(
      next.program.weeks[0]!.sessions[0]!.exercises[0]!.sets,
    ).toBeGreaterThan(0);
  });

  it("rejects version-preserving relational corruption in current-engine snapshots", () => {
    const { previous, next } = versionPair();
    const corrupt = structuredClone(previous);
    corrupt.program.weeks[0]!.sessions[1]!.id =
      corrupt.program.weeks[0]!.sessions[0]!.id;
    expect(() =>
      reconstructProgramHistoryVersion(
        next,
        [
          {
            versionNumber: 1,
            storageFormat: "full_v3",
            payload: corrupt,
          },
        ],
        1,
      ),
    ).toThrow("failed schema verification");
  });

  it("validates the current anchor even when no reverse reconstruction is requested", () => {
    const { next } = versionPair();
    next.program.horizonWeeks += 1;
    expect(() => reconstructProgramHistoryVersion(next, [], 2)).toThrow(
      "failed schema verification",
    );
  });

  it("validates every intermediate snapshot rather than accepting a later repair", () => {
    const { previous, next } = versionPair();
    const current = structuredClone(next);
    current.program.version = 3;
    expect(() =>
      reconstructProgramHistoryVersion(
        current,
        [
          { versionNumber: 1, storageFormat: "full_v3", payload: previous },
          {
            versionNumber: 2,
            storageFormat: "reverse_patch_v1",
            reversePatch: [
              [0, ["program", "version"], 2],
              [
                0,
                ["program", "weeks", 0, "sessions", 0, "exercises", 0, "reps"],
                { min: "invalid", max: "invalid" },
              ],
            ],
          },
        ],
        1,
      ),
    ).toThrow("failed schema verification");
  });

  it("keeps pre-integrity V3 snapshots readable without rewriting history", () => {
    const { previous, next } = versionPair();
    delete previous.program.integrityVersion;
    delete previous.program.effectiveScheduleStartDate;
    for (const week of previous.program.weeks) {
      delete week.doseLedger;
      for (const session of week.sessions) {
        delete session.occurrenceDate;
        for (const item of session.exercises) {
          delete item.contextRole;
          delete item.phase;
          delete item.progression.repFloor;
          delete item.progression.repCeiling;
          delete item.progression.requiredSuccessfulExposures;
        }
      }
    }
    const original = structuredClone(previous);
    const restored = reconstructProgramHistoryVersion(
      next,
      [
        {
          versionNumber: 1,
          storageFormat: "full_v3",
          payload: previous,
        },
      ],
      1,
    );
    expect(restored).toEqual(original);
    expect(previous).toEqual(original);
    expect(restored).not.toBe(previous);
  });

  it("rejects duplicate rows rather than choosing an arbitrary history snapshot", () => {
    const { previous, next } = versionPair();
    expect(() =>
      reconstructProgramHistoryVersion(
        next,
        [
          { versionNumber: 1, storageFormat: "full_v3", payload: previous },
          { versionNumber: 1, storageFormat: "full_v3", payload: previous },
        ],
        1,
      ),
    ).toThrow("duplicate version rows");
  });
});
