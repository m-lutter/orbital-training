import { error } from "@sveltejs/kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deferFitnessTask,
  fitnessJsonErrorBoundary,
  readFitnessObject,
  requiredShortString,
  settleFitnessTask,
} from "./http";

afterEach(() => vi.restoreAllMocks());

describe("fitness HTTP validation", () => {
  it("accepts a small JSON object", async () => {
    const value = await readFitnessObject(
      new Request("https://orbital-training.com/api/fitness/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ programId: "program-1" }),
      }),
    );
    expect(value).toEqual({ programId: "program-1" });
  });

  it("rejects empty identifiers", () => {
    expect(() => requiredShortString("", "Program")).toThrow();
  });

  it("returns a stable JSON message for an unexpected server failure", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await fitnessJsonErrorBoundary(
      "workout_capture_start",
      "Workout capture could not start.",
      async () => {
        throw new TypeError("provider details must not reach the client");
      },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      message: "Workout capture could not start.",
    });
    expect(log).toHaveBeenCalledWith("Unexpected fitness API failure:", {
      operation: "workout_capture_start",
      type: "TypeError",
    });
  });

  it("preserves deliberate HTTP errors", async () => {
    await expect(
      fitnessJsonErrorBoundary(
        "workout_capture_start",
        "Workout capture could not start.",
        async () => {
          throw error(409, "Connect a wearable first.");
        },
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("does not fail a response when deferred work has no execution context", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(() =>
      deferFitnessTask(
        { platform: { ctx: undefined } as never },
        "completed_workout_heart_rate_refresh",
        Promise.reject(new TypeError("provider unavailable")),
      ),
    ).not.toThrow();

    await vi.waitFor(() => expect(warn).toHaveBeenCalledOnce());
  });

  it("reports whether bounded provider work settled before its deadline", async () => {
    await expect(
      settleFitnessTask(Promise.resolve("updated"), 50),
    ).resolves.toEqual({ settled: true, value: "updated" });
    await expect(
      settleFitnessTask(new Promise(() => undefined), 1),
    ).resolves.toEqual({ settled: false });
  });
});
