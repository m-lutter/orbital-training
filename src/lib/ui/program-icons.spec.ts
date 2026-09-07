import { describe, expect, it } from "vitest";
import type { ProgramDraftV3 } from "$lib/engine";
import {
  cuteProgramIconMark,
  hasFullyCompletedProgram,
  programIconFromDraft,
  programIconFromPayload,
  programIconName,
  selectableProgramIcons,
} from "./program-icons";

describe("program icons", () => {
  it("maps old program values to the closest current badge", () => {
    expect(programIconName(undefined)).toBe("orbital_strength");
    expect(programIconName("unknown")).toBe("orbital_strength");
    expect(programIconName("orbiter")).toBe("deep_space_pathfinder");
    expect(programIconName("launch_vehicle")).toBe("launch_vector");
  });

  it("reads the presentation choice from the questionnaire snapshot", () => {
    const draft = {
      questionnaireFormValues: { programIcon: "launch_vehicle" },
    } as unknown as ProgramDraftV3;
    expect(programIconFromDraft(draft)).toBe("launch_vector");
    expect(programIconFromPayload(draft)).toBe("launch_vector");
  });

  it("keeps the gold badge out of the picker until it is unlocked", () => {
    expect(
      selectableProgramIcons(false).some(
        (option) => option.name === "lunar_completion",
      ),
    ).toBe(false);
    expect(
      selectableProgramIcons(true).some(
        (option) => option.name === "lunar_completion",
      ),
    ).toBe(true);
  });

  it("gives every saved badge a deterministic non-orbital cute mark", () => {
    const marks = selectableProgramIcons(true).map((option) =>
      cuteProgramIconMark(option.name),
    );
    expect(marks).toHaveLength(8);
    expect(new Set(marks).size).toBe(8);
    expect(marks.every((mark) => mark.length > 0)).toBe(true);
  });

  it("keeps the revised Cute icon meanings stable", () => {
    expect(cuteProgramIconMark("orbital_strength")).toBe("♥");
    expect(cuteProgramIconMark("orbital_relay")).toBe("✿");
    expect(cuteProgramIconMark("atlas_lifter")).toBe("dog");
    expect(cuteProgramIconMark("mission_control")).toBe("cat_silhouette");
    expect(cuteProgramIconMark("deep_space_pathfinder")).toBe("barbell");
  });

  it("requires every planned training session to be completed for the award", () => {
    const draft = {
      program: {
        weeks: [
          {
            sessions: [
              { id: "lift", kind: "lifting" },
              { id: "walk", kind: "movement" },
              { id: "cardio", kind: "cardio" },
            ],
          },
        ],
      },
    } as unknown as ProgramDraftV3;
    const log = (sessionId: string, status: "completed" | "partial") => ({
      programId: "program-1",
      programVersion: 1,
      sessionId,
      weekNumber: 1,
      sessionSequence: sessionId === "lift" ? 1 : 2,
      status,
      exerciseLogs: [],
    });
    expect(
      hasFullyCompletedProgram(draft, [
        log("lift", "completed"),
        log("cardio", "partial"),
      ]),
    ).toBe(false);
    expect(
      hasFullyCompletedProgram(draft, [
        log("lift", "completed"),
        log("cardio", "completed"),
      ]),
    ).toBe(true);
  });
});
