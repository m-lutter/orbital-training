import { describe, expect, it } from "vitest";
import {
  foregroundSyncMinimumIntervalSeconds,
  validFitnessSyncTrigger,
  validLocalDate,
  validTimeZone,
} from "./validation";

describe("fitness foreground sync input", () => {
  it("accepts real calendar dates and rejects normalized overflow", () => {
    expect(validLocalDate("2026-08-25")).toBe("2026-08-25");
    expect(validLocalDate("2026-02-30")).toBeUndefined();
    expect(validLocalDate("08/25/2026")).toBeUndefined();
  });

  it("requires an IANA time zone", () => {
    expect(validTimeZone("America/Chicago")).toBe("America/Chicago");
    expect(validTimeZone("not/a-zone")).toBeUndefined();
  });

  it("bounds explicit manual refreshes more tightly than automatic sync", () => {
    expect(validFitnessSyncTrigger("manual")).toBe("manual");
    expect(validFitnessSyncTrigger("automatic")).toBe("automatic");
    expect(validFitnessSyncTrigger("force")).toBeUndefined();
    expect(foregroundSyncMinimumIntervalSeconds("manual")).toBe(5 * 60);
    expect(foregroundSyncMinimumIntervalSeconds("automatic")).toBe(6 * 60 * 60);
  });
});
