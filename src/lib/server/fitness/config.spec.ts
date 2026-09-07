import { describe, expect, it } from "vitest";
import {
  isCloudFitnessProvider,
  isDeviceFitnessProvider,
  isEnabledCloudFitnessProvider,
  isEnabledFitnessProvider,
  isFitnessProvider,
  providerCallbackUrl,
  requireEnabledCloudFitnessProvider,
  requireEnabledFitnessProvider,
} from "./config";

describe("fitness provider configuration", () => {
  it("keeps cloud and device providers explicit", () => {
    expect(isCloudFitnessProvider("google_health")).toBe(true);
    expect(isCloudFitnessProvider("apple_health")).toBe(false);
    expect(isDeviceFitnessProvider("health_connect")).toBe(true);
    expect(isFitnessProvider("whoop")).toBe(true);
    expect(isFitnessProvider("unknown")).toBe(false);
  });

  it("retains WHOOP as a dormant adapter but blocks it from this release", () => {
    expect(isEnabledCloudFitnessProvider("google_health")).toBe(true);
    expect(isEnabledCloudFitnessProvider("whoop")).toBe(false);
    expect(isEnabledFitnessProvider("apple_health")).toBe(true);
    expect(isEnabledFitnessProvider("health_connect")).toBe(true);
    expect(isEnabledFitnessProvider("whoop")).toBe(false);
    expect(() => requireEnabledCloudFitnessProvider("whoop")).toThrowError(
      expect.objectContaining({ status: 404 }),
    );
    expect(() => requireEnabledFitnessProvider("whoop")).toThrowError(
      expect.objectContaining({ status: 404 }),
    );
  });

  it("builds an exact callback URL from the canonical origin", () => {
    expect(
      providerCallbackUrl(
        { canonicalOrigin: "https://orbital-training.com" },
        "google_health",
      ),
    ).toBe(
      "https://orbital-training.com/api/fitness/connections/google_health/callback",
    );
  });
});
