import type { VerbalEffort } from "./types";

export type WorkoutEffortMode = "rpe" | "rir" | "verbal";
export type WorkoutFinishIntent = "save" | "complete" | "skip";
export const WORKOUT_AUTOSAVE_DEBOUNCE_MS = 75_000;
export const WORKOUT_AUTOSAVE_MIN_INTERVAL_MS = 180_000;
export const WORKOUT_AUTOSAVE_REQUEST_TIMEOUT_MS = 15_000;
export const WORKOUT_EXPLICIT_SAVE_REQUEST_TIMEOUT_MS = 20_000;

export type WorkoutSaveState = "dirty" | "saving" | "saved";

export function workoutActionAvailability(input: {
  saveState: WorkoutSaveState;
  explicitSaveInFlight: boolean;
}): { saveDisabled: boolean; finishDisabled: boolean } {
  return {
    saveDisabled: input.saveState === "saved" || input.explicitSaveInFlight,
    finishDisabled: input.explicitSaveInFlight,
  };
}

export interface WorkoutExplicitRetry {
  delayMs: number;
  expectedRevision?: string;
}

/**
 * Explicit user intent wins over a stale background revision. Retry only the
 * small set of structured conflicts that can be resolved without discarding
 * the form. The retry count is bounded to prevent a request loop.
 */
export function workoutExplicitRetry(
  value: unknown,
  retriesSoFar: number,
): WorkoutExplicitRetry | undefined {
  if (retriesSoFar >= 2 || typeof value !== "object" || value === null)
    return undefined;
  const result = value as Record<string, unknown>;
  const reason =
    typeof result.conflictReason === "string"
      ? result.conflictReason
      : typeof result.conflict === "string"
        ? result.conflict
        : undefined;

  if (["workout_revision", "program_revision"].includes(reason ?? "")) {
    const currentRevision =
      typeof result.currentRevision === "string" &&
      result.currentRevision.trim() !== ""
        ? result.currentRevision
        : "new";
    return { delayMs: 0, expectedRevision: currentRevision };
  }
  if (reason === "save_in_progress") {
    const retryAfterSeconds =
      typeof result.retryAfterSeconds === "number" &&
      Number.isFinite(result.retryAfterSeconds)
        ? result.retryAfterSeconds
        : 0.5;
    return {
      delayMs: Math.min(2_000, Math.max(250, retryAfterSeconds * 1_000)),
    };
  }
  return undefined;
}

export function nextWorkoutAutosaveDelay(
  lastSaveStartedAt: number,
  now = Date.now(),
): number {
  if (lastSaveStartedAt <= 0) return WORKOUT_AUTOSAVE_DEBOUNCE_MS;
  return Math.max(
    WORKOUT_AUTOSAVE_DEBOUNCE_MS,
    WORKOUT_AUTOSAVE_MIN_INTERVAL_MS - (now - lastSaveStartedAt),
  );
}

/**
 * Removes blank successful controls before an autosave request. Missing and
 * blank optional fields have the same server meaning, so this reduces transfer
 * without changing how a cleared value is interpreted.
 */
export function compactWorkoutFormData(source: FormData): FormData {
  const compact = new FormData();
  for (const [name, value] of source.entries()) {
    if (typeof value === "string" && value === "") continue;
    compact.append(name, value);
  }
  return compact;
}

/**
 * Marks a background request so the server can persist workout progress
 * without applying an explicit, permanent program substitution.
 */
export function autosaveWorkoutFormData(source: FormData): FormData {
  const autosave = compactWorkoutFormData(source);
  autosave.set("submissionMode", "autosave");
  return autosave;
}

export function workoutRequestsPermanentSubstitution(
  formData: FormData,
): boolean {
  return [...formData.entries()].some(
    ([name, value]) => name.endsWith(".scope") && value === "permanent",
  );
}

/** A stable comparison key used to avoid re-sending an unchanged draft. */
export function workoutFormFingerprint(formData: FormData): string {
  return JSON.stringify(
    [...formData.entries()].map(([name, value]) => [
      name,
      typeof value === "string"
        ? value
        : `${value.name}:${value.size}:${value.type}`,
    ]),
  );
}

export function isWorkoutSetTouched(
  formData: FormData,
  prefix: string,
  completed: boolean,
): boolean {
  return completed || formData.has(`${prefix}.touched`);
}

export function shouldPersistWorkoutExercise(input: {
  touchedSetCount: number;
  changedExercise: boolean;
  changedBlockMode: boolean;
  hasMissReason: boolean;
  hasPainEvent: boolean;
}): boolean {
  return (
    input.touchedSetCount > 0 ||
    input.changedExercise ||
    input.changedBlockMode ||
    input.hasMissReason ||
    input.hasPainEvent
  );
}

export interface SetEntryState {
  completed: boolean;
  reps?: number;
  rir?: number;
  rpe?: number;
  difficulty?: string;
}

export function verbalEffortForTargetRir(rir: number): VerbalEffort {
  if (rir >= 4) return "easy";
  if (rir >= 2) return "medium";
  if (rir > 0) return "difficult";
  return "impossible";
}

export function isSetEntrySufficient(
  entry: SetEntryState,
  effortMode: WorkoutEffortMode,
): boolean {
  if (
    !entry.completed ||
    entry.reps === undefined ||
    !Number.isFinite(entry.reps)
  )
    return false;
  if (effortMode === "rir")
    return entry.rir !== undefined && Number.isFinite(entry.rir);
  if (effortMode === "rpe")
    return entry.rpe !== undefined && Number.isFinite(entry.rpe);
  return ["easy", "medium", "difficult", "impossible"].includes(
    entry.difficulty ?? "",
  );
}

export function movementProgressState(
  entries: SetEntryState[],
  effortMode: WorkoutEffortMode,
  feedbackSaved: boolean,
): "not-started" | "partial" | "complete" {
  if (!entries.some((entry) => entry.completed)) return "not-started";
  return feedbackSaved &&
    entries.length > 0 &&
    entries.every((entry) => isSetEntrySufficient(entry, effortMode))
    ? "complete"
    : "partial";
}

export function shouldAutoStartWorkoutTimer(
  checked: boolean,
  running: boolean,
  elapsedSeconds: number,
): boolean {
  return checked && !running && elapsedSeconds === 0;
}

export function needsWorkoutMissReason(
  intent: WorkoutFinishIntent,
  requiredWorkComplete: boolean,
  cardioComplete: boolean,
): boolean {
  return (
    intent === "skip" ||
    (intent === "complete" && (!requiredWorkComplete || !cardioComplete))
  );
}

export function shouldAutosaveWorkout(
  saveState: "dirty" | "saving" | "saved",
  hasUserChanges: boolean,
  hasForm: boolean,
  historyFrozen: boolean,
): boolean {
  return saveState === "dirty" && hasUserChanges && hasForm && !historyFrozen;
}

export function shouldSendAutosaveBeacon(
  editRevision: number,
  beaconedRevision: number,
  activeSaveRevision: number | undefined,
): boolean {
  return activeSaveRevision === undefined && editRevision !== beaconedRevision;
}
