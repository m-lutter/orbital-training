import { describe, expect, it } from "vitest";
import { elapsedTimerSeconds, remainingTimerSeconds } from "./timers";

describe("wall-clock workout timers", () => {
  it("catches up after interval callbacks are throttled in the background", () => {
    expect(elapsedTimerSeconds(12, 1_000, 66_400)).toBe(77);
    expect(remainingTimerSeconds(91_000, 66_400)).toBe(25);
  });

  it("does not produce negative time when a clock moves or a rest ends", () => {
    expect(elapsedTimerSeconds(10, 5_000, 4_000)).toBe(10);
    expect(remainingTimerSeconds(5_000, 8_000)).toBe(0);
  });
});
