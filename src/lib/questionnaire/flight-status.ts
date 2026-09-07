import type { QuestionnaireStep } from "./contracts.js";

export const QUESTIONNAIRE_FLIGHT_MESSAGES: Record<
  QuestionnaireStep,
  readonly string[]
> = {
  1: [
    "Defining mission objectives",
    "Selecting the destination",
    "Setting performance requirements",
  ],
  2: [
    "Building the launch timeline",
    "Checking recovery windows",
    "Sequencing mission events",
  ],
  3: [
    "Sizing tanks and reserves",
    "Reviewing flight history",
    "Setting conservative operating limits",
  ],
  4: [
    "Auditing ground-support equipment",
    "Matching hardware to the mission",
    "Checking alternate launch sites",
  ],
  5: [
    "Running strength simulations",
    "Balancing the main engines",
    "Planning the peak-performance window",
  ],
  6: [
    "Allocating structural reinforcement",
    "Balancing training payloads",
    "Planning efficient assembly sequences",
  ],
  7: [
    "Running trajectory simulations",
    "Checking endurance reserves",
    "Balancing thrust and recovery",
  ],
  8: [
    "Completing the flight-readiness review",
    "Verifying mission constraints",
    "Preparing the launch plan",
  ],
};

export const QUESTIONNAIRE_CUTE_MESSAGES: Record<
  QuestionnaireStep,
  readonly string[]
> = {
  1: ["Choosing your goals", "Sketching your training plan"],
  2: ["Arranging your week", "Making room for recovery"],
  3: ["Learning your starting point", "Setting a comfortable first step"],
  4: ["Matching exercises to your gym", "Checking your equipment"],
  5: ["Planning your main lifts", "Balancing strength practice"],
  6: ["Shaping your muscle-building plan", "Choosing an effective split"],
  7: ["Building your cardio plan", "Balancing effort and recovery"],
  8: ["Checking the finishing touches", "Getting your plan ready"],
};

export function questionnaireFlightStatus(
  step: QuestionnaireStep,
  variation = 0,
): string {
  const messages = QUESTIONNAIRE_FLIGHT_MESSAGES[step];
  return (
    messages[Math.abs(Math.trunc(variation)) % messages.length] ?? messages[0]
  );
}

export function questionnaireCuteStatus(
  step: QuestionnaireStep,
  variation = 0,
): string {
  const messages = QUESTIONNAIRE_CUTE_MESSAGES[step];
  return (
    messages[Math.abs(Math.trunc(variation)) % messages.length] ?? messages[0]
  );
}
