import type { WearableDay } from "./contracts";

export interface StepTarget {
  steps?: number;
}

/**
 * Imported steps can answer the movement prompt only when they reach the
 * applicable goal. Below-goal and missing imports stay editable so the user
 * can correct incomplete device data.
 */
export function importedStepsMeetingGoal(
  wearableDay: WearableDay | undefined,
  target: StepTarget,
): number | undefined {
  if (
    target.steps === undefined ||
    wearableDay?.steps === null ||
    wearableDay?.steps === undefined ||
    !Number.isFinite(wearableDay.steps) ||
    wearableDay.steps < 0
  )
    return undefined;

  // Never let a lower device-side goal override the target the user is
  // following in Orbital. `goalMet` is useful server metadata, but the actual
  // imported count remains the source of truth for suppressing manual entry.
  const goal = Math.max(target.steps, wearableDay.stepGoal ?? target.steps);
  return wearableDay.steps >= goal ? Math.round(wearableDay.steps) : undefined;
}

export function wearableSourceLabel(source: string | null): string {
  if (source === null || source.trim() === "") return "your connected device";
  return source
    .trim()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
