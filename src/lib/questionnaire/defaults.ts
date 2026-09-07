import type { GoalDomain } from "$lib/domain";

/**
 * New-program defaults live outside the form component so they can be tested
 * and reused without coupling them to the questionnaire UI.
 */
export function defaultLiftSessionMinutes(goal: GoalDomain): number {
  return goal === "powerlifting" ? 75 : 60;
}
