import { describe, expect, it } from "vitest";
import {
  createWorkoutSaveGuard,
  createWorkoutSaveSingleFlight,
} from "./workout-save-guard";

describe("workout save guard", () => {
  it("allows normal saves and stops a rapid request loop", () => {
    const check = createWorkoutSaveGuard({
      burstLimit: 3,
      windowMs: 30_000,
      cooldownMs: 60_000,
    });

    expect(check("user:program:session", 1_000).allowed).toBe(true);
    expect(check("user:program:session", 2_000).allowed).toBe(true);
    expect(check("user:program:session", 3_000).allowed).toBe(true);
    expect(check("user:program:session", 4_000)).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });
    expect(check("user:program:session", 34_000)).toEqual({
      allowed: false,
      retryAfterSeconds: 30,
    });
  });

  it("isolates sessions and resets after the cooldown", () => {
    const check = createWorkoutSaveGuard({
      burstLimit: 1,
      windowMs: 10_000,
      cooldownMs: 20_000,
    });

    expect(check("session-a", 0).allowed).toBe(true);
    expect(check("session-a", 1_000).allowed).toBe(false);
    expect(check("session-b", 1_000).allowed).toBe(true);
    expect(check("session-a", 21_000).allowed).toBe(true);
  });

  it("admits only one in-flight save per workout and releases the slot", () => {
    const acquire = createWorkoutSaveSingleFlight();

    const first = acquire("user:program:session");
    expect(first).toBeDefined();
    expect(acquire("user:program:session")).toBeUndefined();
    expect(acquire("user:program:other-session")).toBeDefined();

    first?.release();
    const next = acquire("user:program:session");
    expect(next).toBeDefined();

    // A repeated old release must not clear the newer admission.
    first?.release();
    expect(acquire("user:program:session")).toBeUndefined();
    next?.release();
  });

  it("bounds in-flight bookkeeping", () => {
    const acquire = createWorkoutSaveSingleFlight(1);
    const first = acquire("session-a");

    expect(first).toBeDefined();
    expect(acquire("session-b")).toBeUndefined();
    first?.release();
    expect(acquire("session-b")).toBeDefined();
  });
});
