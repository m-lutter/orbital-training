import { describe, expect, it } from "vitest";
import { canonicalRedirectUrl } from "./canonical-origin";

describe("canonicalRedirectUrl", () => {
  const canonical = "https://orbital-training.com";

  it("preserves the path and query when moving a legacy host", () => {
    expect(
      canonicalRedirectUrl(
        new URL(
          "https://powerlifting-app.example.workers.dev/programs/7?gym=secondary",
        ),
        "GET",
        canonical,
      )?.toString(),
    ).toBe("https://orbital-training.com/programs/7?gym=secondary");
  });

  it("does not redirect canonical, local, or in-flight write requests", () => {
    expect(
      canonicalRedirectUrl(
        new URL("https://orbital-training.com/dashboard"),
        "GET",
        canonical,
      ),
    ).toBeUndefined();
    expect(
      canonicalRedirectUrl(
        new URL("http://127.0.0.1:5173/dashboard"),
        "GET",
        canonical,
      ),
    ).toBeUndefined();
    expect(
      canonicalRedirectUrl(
        new URL("https://powerlifting-app.example.workers.dev/save"),
        "POST",
        canonical,
      ),
    ).toBeUndefined();
  });

  it("fails closed when the deployment value is malformed", () => {
    expect(
      canonicalRedirectUrl(
        new URL("https://legacy.example/dashboard"),
        "GET",
        "http://orbital-training.com/not-an-origin",
      ),
    ).toBeUndefined();
  });
});
