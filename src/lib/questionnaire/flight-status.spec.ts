import { describe, expect, it } from "vitest";
import {
  QUESTIONNAIRE_FLIGHT_MESSAGES,
  questionnaireFlightStatus,
} from "./flight-status";

describe("questionnaire flight status", () => {
  it("provides several themed messages for every questionnaire page", () => {
    for (const step of [1, 2, 3, 4, 5, 6, 7, 8] as const) {
      expect(QUESTIONNAIRE_FLIGHT_MESSAGES[step].length).toBeGreaterThanOrEqual(
        3,
      );
      expect(questionnaireFlightStatus(step)).toBeTruthy();
    }
  });

  it("selects a stable variation without leaving the page category", () => {
    expect(questionnaireFlightStatus(2, 4)).toBe(
      QUESTIONNAIRE_FLIGHT_MESSAGES[2][1],
    );
  });
});
