import { describe, expect, it } from "vitest";
import {
  autosaveWorkoutFormData,
  compactWorkoutFormData,
  isWorkoutSetTouched,
  isSetEntrySufficient,
  movementProgressState,
  nextWorkoutAutosaveDelay,
  needsWorkoutMissReason,
  shouldAutosaveWorkout,
  shouldAutoStartWorkoutTimer,
  shouldSendAutosaveBeacon,
  shouldPersistWorkoutExercise,
  verbalEffortForTargetRir,
  workoutActionAvailability,
  workoutExplicitRetry,
  workoutFormFingerprint,
  workoutRequestsPermanentSubstitution,
  WORKOUT_AUTOSAVE_DEBOUNCE_MS,
  WORKOUT_AUTOSAVE_MIN_INTERVAL_MS,
  WORKOUT_AUTOSAVE_REQUEST_TIMEOUT_MS,
  WORKOUT_EXPLICIT_SAVE_REQUEST_TIMEOUT_MS,
} from "./form-state";

describe("workout form state", () => {
  it("uses a longer server quiet period and removes blank autosave fields", () => {
    expect(WORKOUT_AUTOSAVE_DEBOUNCE_MS).toBe(75_000);
    expect(WORKOUT_AUTOSAVE_MIN_INTERVAL_MS).toBe(180_000);
    expect(WORKOUT_AUTOSAVE_REQUEST_TIMEOUT_MS).toBe(15_000);
    expect(WORKOUT_EXPLICIT_SAVE_REQUEST_TIMEOUT_MS).toBe(20_000);
    expect(nextWorkoutAutosaveDelay(0, 1_000)).toBe(75_000);
    expect(nextWorkoutAutosaveDelay(1_000, 61_000)).toBe(120_000);
    expect(nextWorkoutAutosaveDelay(1_000, 181_000)).toBe(75_000);
    const source = new FormData();
    source.append("completed", "on");
    source.append("optional", "");

    const compact = compactWorkoutFormData(source);
    expect([...compact.entries()]).toEqual([["completed", "on"]]);
    expect(workoutFormFingerprint(compact)).toBe(
      JSON.stringify([["completed", "on"]]),
    );
  });

  it("marks only background requests as autosaves", () => {
    const source = new FormData();
    source.set("submissionMode", "explicit");
    source.set("exercise.squat.scope", "permanent");
    source.set("optional", "");

    expect([...autosaveWorkoutFormData(source).entries()]).toEqual([
      ["submissionMode", "autosave"],
      ["exercise.squat.scope", "permanent"],
    ]);
    expect(source.get("submissionMode")).toBe("explicit");
    expect(workoutRequestsPermanentSubstitution(source)).toBe(true);
    source.set("exercise.squat.scope", "today");
    expect(workoutRequestsPermanentSubstitution(source)).toBe(false);
  });

  it("never makes background saving or substitutions block workout actions", () => {
    expect(
      workoutActionAvailability({
        saveState: "dirty",
        explicitSaveInFlight: false,
      }),
    ).toEqual({ saveDisabled: false, finishDisabled: false });

    expect(
      workoutActionAvailability({
        saveState: "dirty",
        explicitSaveInFlight: true,
      }),
    ).toEqual({ saveDisabled: true, finishDisabled: true });

    expect(
      workoutActionAvailability({
        saveState: "saved",
        explicitSaveInFlight: false,
      }),
    ).toEqual({ saveDisabled: true, finishDisabled: false });
  });

  it("rebases explicit form data without creating an unbounded retry loop", () => {
    expect(
      workoutExplicitRetry(
        {
          conflictReason: "workout_revision",
          currentRevision: "2026-08-26T01:00:00.000Z",
        },
        0,
      ),
    ).toEqual({
      delayMs: 0,
      expectedRevision: "2026-08-26T01:00:00.000Z",
    });
    expect(
      workoutExplicitRetry({ conflictReason: "program_revision" }, 0),
    ).toEqual({ delayMs: 0, expectedRevision: "new" });
    expect(
      workoutExplicitRetry(
        { conflictReason: "save_in_progress", retryAfterSeconds: 1 },
        0,
      ),
    ).toEqual({ delayMs: 1_000 });
    expect(
      workoutExplicitRetry({ conflictReason: "rate_limited" }, 0),
    ).toBeUndefined();
    expect(
      workoutExplicitRetry({ conflictReason: "workout_revision" }, 2),
    ).toBeUndefined();
  });

  it("stores only touched workout work while retaining meaningful exceptions", () => {
    const form = new FormData();
    expect(isWorkoutSetTouched(form, "exercise.squat.set.1", false)).toBe(
      false,
    );
    form.set("exercise.squat.set.1.touched", "true");
    expect(isWorkoutSetTouched(form, "exercise.squat.set.1", false)).toBe(true);
    expect(
      shouldPersistWorkoutExercise({
        touchedSetCount: 0,
        changedExercise: false,
        changedBlockMode: false,
        hasMissReason: false,
        hasPainEvent: false,
      }),
    ).toBe(false);
    expect(
      shouldPersistWorkoutExercise({
        touchedSetCount: 0,
        changedExercise: true,
        changedBlockMode: false,
        hasMissReason: false,
        hasPainEvent: false,
      }),
    ).toBe(true);
  });

  it("prefills verbal effort from the prescription", () => {
    expect(verbalEffortForTargetRir(5)).toBe("easy");
    expect(verbalEffortForTargetRir(3)).toBe("medium");
    expect(verbalEffortForTargetRir(1)).toBe("difficult");
    expect(verbalEffortForTargetRir(0)).toBe("impossible");
  });

  it("does not mark a checked set sufficient when required feedback is blank", () => {
    expect(isSetEntrySufficient({ completed: true, reps: 5 }, "rir")).toBe(
      false,
    );
    expect(
      isSetEntrySufficient({ completed: true, reps: 5, rir: 2 }, "rir"),
    ).toBe(true);
    expect(
      isSetEntrySufficient(
        { completed: true, reps: 5, difficulty: "medium" },
        "verbal",
      ),
    ).toBe(true);
  });

  it("keeps a movement amber until its set data and check-in are complete", () => {
    const set = { completed: true, reps: 5, rir: 2 };
    expect(movementProgressState([set], "rir", false)).toBe("partial");
    expect(movementProgressState([set], "rir", true)).toBe("complete");
    expect(movementProgressState([{ completed: false }], "rir", true)).toBe(
      "not-started",
    );
  });

  it("starts the workout clock only on the first completed set", () => {
    expect(shouldAutoStartWorkoutTimer(true, false, 0)).toBe(true);
    expect(shouldAutoStartWorkoutTimer(true, false, 12)).toBe(false);
    expect(shouldAutoStartWorkoutTimer(true, true, 0)).toBe(false);
    expect(shouldAutoStartWorkoutTimer(false, false, 0)).toBe(false);
  });

  it("asks for a reason only when finishing incomplete work or skipping", () => {
    expect(needsWorkoutMissReason("save", false, false)).toBe(false);
    expect(needsWorkoutMissReason("complete", true, true)).toBe(false);
    expect(needsWorkoutMissReason("complete", false, true)).toBe(true);
    expect(needsWorkoutMissReason("skip", true, true)).toBe(true);
  });

  it("does not create an empty log when an untouched workout page closes", () => {
    expect(shouldAutosaveWorkout("dirty", false, true, false)).toBe(false);
    expect(shouldAutosaveWorkout("dirty", true, true, false)).toBe(true);
    expect(shouldAutosaveWorkout("saved", true, true, false)).toBe(false);
    expect(shouldAutosaveWorkout("dirty", true, true, true)).toBe(false);
  });

  it("sends at most one exit beacon for a revision not already saving", () => {
    expect(shouldSendAutosaveBeacon(4, 3, undefined)).toBe(true);
    expect(shouldSendAutosaveBeacon(4, 4, undefined)).toBe(false);
    expect(shouldSendAutosaveBeacon(4, 3, 4)).toBe(false);
    expect(shouldSendAutosaveBeacon(5, 4, 4)).toBe(false);
  });
});
