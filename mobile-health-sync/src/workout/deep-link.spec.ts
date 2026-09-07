import { describe, expect, it } from "vitest";
import { parseWorkoutDeepLink } from "./deep-link";

describe("parseWorkoutDeepLink", () => {
  it("accepts the host-with-empty-path link emitted by the web app", () => {
    expect(
      parseWorkoutDeepLink(
        "orbitalhealth://workout?programId=program-1&sessionId=session-2&workoutSessionId=capture-3",
      ),
    ).toEqual({
      type: "start",
      programId: "program-1",
      sessionId: "session-2",
    });
  });

  it("accepts explicit start and stop paths", () => {
    expect(parseWorkoutDeepLink("orbitalhealth://workout/start")).toEqual({
      type: "start",
    });
    expect(parseWorkoutDeepLink("orbitalhealth://workout/stop")).toEqual({
      type: "stop",
    });
  });

  it("rejects unrelated schemes and actions", () => {
    expect(
      parseWorkoutDeepLink("https://orbital-training.com/workout"),
    ).toBeNull();
    expect(parseWorkoutDeepLink("orbitalhealth://workout/delete")).toBeNull();
  });
});
